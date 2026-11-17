import { approach, clamp, cross, dot, fwd, leftOf } from '../core/math';
import type { VehicleInput, VehicleState } from '../types';
import { FLAT_GROUND, type Ground } from '../world/Ground';
import type { CarSpec } from './CarSpec';

const G = 9.81;
/** How much longitudinal tire force eats into lateral grip (friction-circle coupling). */
const COUPLING = 0.55;
const MAX_YAW_RATE = 2.9;
/** A terrain rise steeper than this over 0.3 m in front of the car is a wall (ramp backs, quay walls). */
const CLIFF = 0.3;
const TRACK = 0.8;
/** Reverse drive force as a share of the engine force through the reverse ratio (was 0.6, which made reversing a crawl). */
const REVERSE_PUSH = 1.0;
/** Still rolling the old way faster than this (m/s) after a D <-> R swap: keep braking. */
const SWAP_ROLL = 0.15;
/**
 * Steering rack speed keeps pace with the speed-limited lock: at speed the wheel still takes about as long
 * to wind on as it does in town (instead of snapping to the small high-speed lock in 0.1 s), but never
 * slower than this share of the base rate. Keyboard taps at 100+ km/h become lane changes, not twitches.
 */
const STEER_RATE_MIN = 0.55;
/** Engine braking at the redline as a share of peak torque (pumping + drivetrain losses on a closed throttle). */
const ENGINE_BRAKE = 0.32;
/** ...but never more than this many g: a closed throttle slows the car, it doesn't lock the rear axle. */
const ENGINE_BRAKE_MAX_G = 0.085;
/** Seconds on the starter before the engine catches (IMPROVEMENTS #21). */
const CRANK_TIME = 0.75;
/** Park pawl: locks the rear axle up to this many g (well past what the tires can hold). */
const PARK_LOCK_G = 1.5;
/** Engine braking fades out between a closed throttle and this much pedal. */
const ENGINE_BRAKE_THROTTLE = 0.15;
/** Rear friction-circle coupling while the driven wheels spin: a spinning tire has little side grip left. */
const SPIN_COUPLING = 0.62;
/**
 * Clutch-dump launch (the pit-garage burnout). Z is a throttle that slips the clutch: the engine stays in the
 * power band, the driven wheels spin, and the car still drives forward — harder than a hooked launch. This
 * extra force is full at a standstill and gone once road speed catches that engine speed. Holding Z after the
 * wheels hook is ordinary throttle.
 */
const CLUTCH_SLIP_FORCE = 0.55;
/** Body bounce after a bump: about 1.5 Hz, light enough to rise back up once before it settles. */
const HEAVE_W = 9.4;
const HEAVE_Z = 0.23;
/** Nose nod, a little slower and deader than the heave so it dips and comes back without pecking. */
const NOD_W = 8;
const NOD_Z = 0.34;
/** Travel stops (m, rad). Past these the spring rebounds, the way a bump stop would. */
const HEAVE_MIN = -0.15;
const HEAVE_MAX = 0.08;
const NOD_LIMIT = 0.09;

/**
 * Lateral tire force curve: rises to 1 at x = 1, then falls by `falloff`.
 * Montreal Driver tunes grip from outside (`VehiclePhysics.surfaceGrip`: slush, summer tires). Do not change the
 * tire curve for map content.
 */
function tireCurve(x: number, falloff: number): number {
  if (x <= 1) return x * (2 - x);
  return 1 - falloff * Math.min(1, (x - 1) / 2.5);
}

/**
 * Bicycle-model arcade vehicle (2D + yaw). Pure simulation, no rendering.
 * Positive yaw rotates forward (sin, cos) toward the car's left.
 */
export class VehiclePhysics {
  /** The world's ground (set once the city exists). */
  static ground: Ground = FLAT_GROUND;
  /** Tire grip multiplier for road conditions (wet roads in the rain; set by main from the weather). */
  static surfaceGrip = 1;
  state: VehicleState;
  /** True when rear wheels exceed traction (burnout / power slide). */
  wheelspin = false;
  rearLocked = false;
  /** Points toward the car for the latest terrain-wall hit. Meaningful while `state.wallHit` > 0. */
  wallNormal = { x: 0, z: 1 };
  private shiftTimer = 0;
  /**
   * This press of the clutch dump has already hooked. Further holding is plain throttle until the button
   * is released, so an upshift doesn't open the clutch again.
   */
  private dumpHooked = false;
  /** Just placed (spawn / teleport): match the ground's motion before testing for take-off. */
  private fresh = true;
  private smoothAccel = 0;
  /** Seconds the throttle has been closed in gear (engine braking eases in). */
  private liftT = 0;
  /**
   * Ignition (IMPROVEMENTS #21). Off: no drive, the gearbox in P (rear axle locked, the car holds on any hill),
   * revs fall to 0, lamps dark (see `Car.lampsOn`). Restarting cranks for a moment before it catches.
   */
  engineOn = true;
  /** Seconds left on the starter motor (> 0 while cranking). */
  private starter = 0;
  private parkInput: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: true, burnout: false };

  /** Switch off (the gearbox goes to P). */
  stopEngine(): void {
    this.engineOn = false;
    this.starter = 0;
  }

  /** Turn the key: cranks for a moment, then the engine catches. */
  startEngine(): void {
    if (this.engineOn || this.starter > 0) return;
    this.starter = CRANK_TIME;
  }

  get cranking(): boolean {
    return this.starter > 0;
  }

  constructor(
    public spec: CarSpec,
    pos = { x: 0, z: 0 },
    yaw = 0,
  ) {
    this.state = {
      pos: { ...pos },
      vel: { x: 0, z: 0 },
      yaw,
      yawRate: 0,
      steerAngle: 0,
      rpm: spec.idleRpm,
      gear: 1,
      speed: 0,
      slipFront: 0,
      slipRear: 0,
      accelF: 0,
      accelL: 0,
      damage: 0,
      y: 0,
      vy: 0,
      airborne: false,
      airTime: 0,
      pitch: 0,
      roll: 0,
      slope: 0,
      load: 1,
      water: 0,
      landT: 99,
      landImpact: 0,
      heave: 0,
      heaveV: 0,
      susPitch: 0,
      susPitchV: 0,
      wallHit: 0,
    };
    this.settle();
  }

  /** Put the car on the ground, at rest vertically. */
  settle(): void {
    const s = this.state;
    s.y = VehiclePhysics.ground.heightAt(s.pos.x, s.pos.z);
    s.vy = 0;
    s.airborne = false;
    s.load = 1;
    s.water = 0;
    s.heave = 0;
    s.heaveV = 0;
    s.susPitch = 0;
    s.susPitchV = 0;
    this.fresh = true;
  }

  get mass(): number {
    return this.spec.mass;
  }

  get inertia(): number {
    const sp = this.spec;
    return sp.mass * (sp.cgToFront ** 2 + sp.cgToRear ** 2) * 0.5 * sp.inertiaScale;
  }

  /** Max steering angle allowed at the current speed. */
  maxSteerAt(speed: number): number {
    return this.spec.maxSteer / (1 + Math.abs(speed) / this.spec.steerSpeedFalloff);
  }

  teleport(pos: { x: number; z: number }, yaw: number): void {
    const s = this.state;
    s.pos = { ...pos };
    s.yaw = yaw;
    s.vel = { x: 0, z: 0 };
    s.yawRate = 0;
    s.steerAngle = 0;
    s.gear = 1;
    this.engineOn = true;
    this.starter = 0;
    this.dumpHooked = false;
    this.settle();
  }

  step(input: VehicleInput, dt: number): void {
    const sp = this.spec;
    const s = this.state;
    const parked = !this.engineOn;
    if (parked) {
      // In P: no pedals, the wheel still turns
      this.parkInput.steer = input.steer;
      input = this.parkInput;
      s.gear = 1;
    }
    const m = sp.mass;
    const I = this.inertia;
    const a = sp.cgToFront;
    const b = sp.cgToRear;
    const L = a + b;

    const f = fwd(s.yaw);
    const l = leftOf(s.yaw);
    // Terrain under the axles and sides: attitude, grade and the downhill pull
    const gnd = VehiclePhysics.ground;
    const hF = gnd.heightAt(s.pos.x + f.x * a, s.pos.z + f.z * a);
    const hR = gnd.heightAt(s.pos.x - f.x * b, s.pos.z - f.z * b);
    const hL = gnd.heightAt(s.pos.x + l.x * TRACK, s.pos.z + l.z * TRACK);
    const hRt = gnd.heightAt(s.pos.x - l.x * TRACK, s.pos.z - l.z * TRACK);
    const gradF = clamp((hF - hR) / L, -0.6, 0.6);
    const gradL = clamp((hL - hRt) / (2 * TRACK), -0.6, 0.6);
    s.slope = gradF;
    const vf = dot(s.vel, f);
    const vl = dot(s.vel, l);
    const speed = Math.hypot(s.vel.x, s.vel.z);
    s.speed = vf;

    // --- Steering ---
    const maxSteer = this.maxSteerAt(vf);
    let target = -input.steer * maxSteer;
    if (vf > 3 && sp.driftAssist > 0) {
      const beta = Math.atan2(vl, Math.abs(vf));
      target += clamp(beta * sp.driftAssist * 0.7, -sp.maxSteer * 0.6, sp.maxSteer * 0.6);
    }
    target = clamp(target, -sp.maxSteer, sp.maxSteer);
    // Winding back toward center (including the first half of a flick to the other side) uses the faster
    // return rate, so counter-steering catches a slide as quickly as the self-centering wheel would.
    const toward = target - s.steerAngle;
    const returning = s.steerAngle !== 0 && Math.sign(toward) !== Math.sign(s.steerAngle);
    const rack = Math.max(STEER_RATE_MIN, maxSteer / sp.maxSteer);
    s.steerAngle = approach(s.steerAngle, target, (returning ? sp.steerReturn : sp.steerSpeed) * rack * dt);

    // --- Drive / brake mode ---
    // The gear flips below 1 m/s; until the car has actually stopped rolling the old way, the brakes stay on
    // alongside the new direction's drive, so D <-> R doesn't coast through zero on engine force alone.
    let drive = 0;
    let brake = 0;
    if (s.gear === -1) {
      if (input.throttle > 0.05) {
        if (vf < -1) brake = input.throttle;
        else {
          s.gear = 1;
          drive = input.throttle;
          if (vf < -SWAP_ROLL) brake = input.throttle;
        }
      } else {
        drive = input.brake;
        if (vf > SWAP_ROLL) brake = input.brake;
      }
    } else {
      drive = input.throttle;
      if (input.brake > 0.05) {
        if (vf > 1) brake = input.brake;
        else if (input.throttle < 0.05) {
          s.gear = -1;
          drive = input.brake;
          if (vf > SWAP_ROLL) brake = input.brake;
        }
      } else if (vf < -SWAP_ROLL) brake = input.throttle;
    }

    // --- Engine & gearbox ---
    const nG = sp.gears.length;
    const ratio = (s.gear === -1 ? sp.reverseGear : sp.gears[s.gear - 1]) * sp.finalDrive;
    const wheelRpm = (Math.abs(vf) / sp.wheelRadius) * (60 / (2 * Math.PI));
    const lockedRpm = Math.max(sp.idleRpm, wheelRpm * ratio);
    let rpm = lockedRpm;
    // Clutch dump. The tach sits up in the power band, ahead of the wheels, until road speed catches it.
    // That is the spin, and the extra drive force. Once it hooks, this hold of Z is ordinary throttle.
    const dumpRpm = Math.min(sp.redline * 0.9, Math.max(sp.peakRpm, sp.redline * 0.78));
    const dumping =
      input.burnout && !parked && !s.airborne && s.water < 0.3 && s.gear >= 1 && drive > 0.85;
    if (!input.burnout || parked) this.dumpHooked = false;
    const rawSlip = dumping ? clamp((dumpRpm - wheelRpm * ratio) / (dumpRpm - sp.idleRpm), 0, 1) : 0;
    if (dumping && rawSlip < 0.06) this.dumpHooked = true;
    const clutchSlip = this.dumpHooked ? 0 : rawSlip;
    if (clutchSlip > 0.04) rpm = Math.max(rpm, dumpRpm);
    else if (this.wheelspin && drive > 0.1) rpm = Math.max(rpm, Math.min(sp.redline, s.rpm + 6000 * dt * drive));
    this.shiftTimer -= dt;
    if (s.gear >= 1 && this.shiftTimer <= 0) {
      // Shifts follow the wheels, not the slipped tach, so a dump doesn't upshift itself out of the launch.
      const shiftRpm = clutchSlip > 0.04 ? lockedRpm : rpm;
      if (clutchSlip < 0.2 && shiftRpm > sp.redline * 0.93 && s.gear < nG) {
        s.gear++;
        this.shiftTimer = 0.28;
      } else if (s.gear > 1) {
        const lowerRpm = wheelRpm * sp.gears[s.gear - 2] * sp.finalDrive;
        if (lowerRpm < sp.redline * 0.7 && shiftRpm < sp.peakRpm * 0.75) {
          s.gear--;
          this.shiftTimer = 0.2;
        }
      }
    }
    if (parked) this.ignition(dt);
    else s.rpm = s.rpm + (Math.min(rpm, sp.redline) - s.rpm) * Math.min(1, dt * 18);
    const r = s.rpm;
    const tq =
      r < sp.peakRpm
        ? 0.55 + 0.45 * ((r - sp.idleRpm) / (sp.peakRpm - sp.idleRpm))
        : 1 - 0.38 * ((r - sp.peakRpm) / (sp.redline - sp.peakRpm));
    const limiter = r >= sp.redline * 0.995 ? 0.2 : 1;
    const shifting = this.shiftTimer > 0.12 ? 0.25 : 1;
    const slipBoost = 1 + CLUTCH_SLIP_FORCE * clutchSlip;
    const engineForce =
      ((sp.peakTorque * (1 - 0.45 * Math.min(1, s.damage)) * tq * ratio * sp.driveEfficiency) / sp.wheelRadius) *
      drive *
      limiter *
      shifting *
      slipBoost;
    const driveForce = s.gear === -1 ? -engineForce * REVERSE_PUSH : engineForce;
    // Closed throttle in gear: the engine holds the car back, harder in the low gears and at high revs. It
    // eases in over a few tenths (throttle closing, driveline lash). Applied along the body rather than through
    // the rear tires' friction circle: the nose still dips on a lift (weight transfer, a little lift-off
    // rotation), but a lift alone doesn't break the rear loose.
    let engineHold = 0;
    if (!parked && s.gear >= 1 && drive < ENGINE_BRAKE_THROTTLE && vf > 1.5 && !s.airborne && s.water < 0.3) {
      const revs = clamp((r - sp.idleRpm) / (sp.redline - sp.idleRpm), 0, 1);
      const hold = (sp.peakTorque * ENGINE_BRAKE * (0.25 + 0.75 * revs) * ratio) / sp.wheelRadius;
      this.liftT += dt;
      // fades out over the first bit of pedal travel, so a light (AI) cruise throttle doesn't pulse
      const closed = 1 - drive / ENGINE_BRAKE_THROTTLE;
      engineHold = Math.min(hold, ENGINE_BRAKE_MAX_G * m * G) * closed * clamp((vf - 1.5) / 3, 0, 1) * clamp(this.liftT / 0.35, 0, 1);
    } else this.liftT = 0;

    // --- Axle loads with longitudinal weight transfer ---
    const transfer = (m * this.smoothAccel * sp.cgHeight) / L;
    // Vertical load: light over crests, none in the air or in water
    const grip = s.airborne || s.water > 0.3 ? 0 : s.load;
    const fzF = Math.max(0.2 * m * G, (m * G * b) / L - transfer) * grip;
    const fzR = Math.max(0.2 * m * G, (m * G * a) / L + transfer) * grip;
    const muF = sp.gripFront * VehiclePhysics.surfaceGrip;
    const muR = sp.gripRear * (input.handbrake ? sp.handbrakeGrip : 1) * VehiclePhysics.surfaceGrip;
    const maxF = muF * fzF;
    const maxR = muR * fzR;

    // --- Longitudinal forces ---
    const lowSpeedScale = clamp(Math.abs(vf) / 0.6, 0, 1);
    const dirF = vf >= 0 ? 1 : -1;
    const brakeF = -dirF * brake * sp.brakeForce * sp.brakeBiasFront * lowSpeedScale;
    let fxR = driveForce - dirF * brake * sp.brakeForce * (1 - sp.brakeBiasFront) * lowSpeedScale;
    this.rearLocked = input.handbrake && Math.abs(vf) > 2;
    if (input.handbrake) fxR += -dirF * (parked ? PARK_LOCK_G * m * G : sp.handbrakeForce) * lowSpeedScale;
    this.wheelspin = clutchSlip > 0.08 || (Math.abs(fxR) > maxR * 0.98 && drive > 0.2);
    // The dump is allowed through the tire cap, fading back to normal grip as the clutch hooks.
    const driveCap = maxR * slipBoost;
    fxR = clamp(fxR, -driveCap, driveCap);
    const fxF = clamp(brakeF, -maxF, maxF);

    // --- Lateral tire forces (slip angles in wheel frame) ---
    const sd = Math.sin(s.steerAngle);
    const cd = Math.cos(s.steerAngle);
    const wf = { x: f.x * cd + l.x * sd, z: f.z * cd + l.z * sd };
    const wl = { x: -f.x * sd + l.x * cd, z: -f.z * sd + l.z * cd };
    const w = s.yawRate;
    const rF = { x: f.x * a, z: f.z * a };
    const rR = { x: -f.x * b, z: -f.z * b };
    const vFront = { x: s.vel.x + w * rF.z, z: s.vel.z - w * rF.x };
    const vRear = { x: s.vel.x + w * rR.z, z: s.vel.z - w * rR.x };
    const vwfF = dot(vFront, wf);
    const vwlF = dot(vFront, wl);
    const vwfR = dot(vRear, f);
    const vwlR = dot(vRear, l);
    const minV = 2.5;
    const alphaF = Math.atan2(vwlF, Math.max(Math.abs(vwfF), minV));
    const alphaR = Math.atan2(vwlR, Math.max(Math.abs(vwfR), minV));
    s.slipFront = Math.abs(alphaF);
    s.slipRear = Math.abs(alphaR);
    const latCapF = Math.sqrt(Math.max(0, maxF * maxF - (COUPLING * fxF) ** 2));
    const latCapR = Math.sqrt(Math.max(0, maxR * maxR - ((this.wheelspin ? SPIN_COUPLING : COUPLING) * fxR) ** 2));
    const B = sp.corneringStiffness;
    const fyF = -Math.sign(alphaF) * tireCurve(Math.abs(alphaF) * B, sp.peakFalloff * 0.5) * latCapF;
    const fyR = -Math.sign(alphaR) * tireCurve(Math.abs(alphaR) * B, sp.peakFalloff) * latCapR;

    const FF = { x: wf.x * fxF + wl.x * fyF, z: wf.z * fxF + wl.z * fyF };
    const FR = { x: f.x * fxR + l.x * fyR, z: f.z * fxR + l.z * fyR };

    // --- Resistance + gravity along the slope (brakes hold a car that is stopped on a hill) ---
    const holding = (brake > 0.05 || input.handbrake) && speed < 1;
    const pull = s.airborne || s.water > 0.3 || holding ? 0 : -m * G;
    const fx = FF.x + FR.x - engineHold * f.x - sp.drag * s.vel.x * speed - sp.rollingResistance * s.vel.x * grip + pull * (gradF * f.x + gradL * l.x);
    const fz = FF.z + FR.z - engineHold * f.z - sp.drag * s.vel.z * speed - sp.rollingResistance * s.vel.z * grip + pull * (gradF * f.z + gradL * l.z);

    // --- Yaw torque ---
    let torque = cross(rF, FF) + cross(rR, FR);
    torque -= sp.yawDamping * w * I * 0.6;
    if (Math.abs(vf) > 4 && sp.driftAssist > 0) {
      const beta = Math.atan2(vl, Math.abs(vf));
      const excess = beta - clamp(beta, -0.42, 0.42);
      torque += sp.driftAssist * I * 8 * excess;
    }

    // --- Integrate ---
    const ax = fx / m;
    const az = fz / m;
    s.vel.x += ax * dt;
    s.vel.z += az * dt;
    s.yawRate = clamp(s.yawRate + (torque / I) * dt, -MAX_YAW_RATE, MAX_YAW_RATE);

    if (s.airborne) s.yawRate *= 1 - Math.min(1, dt * 0.4);
    if (s.water > 0.3) {
      const k = Math.exp(-2.2 * dt);
      s.vel.x *= k;
      s.vel.z *= k;
      s.yawRate *= k;
    }
    const idle = drive < 0.05;
    const newSpeed = Math.hypot(s.vel.x, s.vel.z);
    if (newSpeed < 0.4 && idle && !s.airborne && (holding || Math.abs(gradF) < 0.03)) {
      const k = brake > 0 || input.handbrake ? 0.75 : 0.95;
      s.vel.x *= k;
      s.vel.z *= k;
      if (newSpeed < 0.05) {
        s.vel.x = 0;
        s.vel.z = 0;
      }
    }
    if (newSpeed < 1.5) s.yawRate *= 1 - Math.min(1, 6 * dt * (1.5 - newSpeed));

    s.pos.x += s.vel.x * dt;
    s.pos.z += s.vel.z * dt;
    s.yaw += s.yawRate * dt;
    this.terrainWall(dt);
    this.stepVertical(dt, hF, hR, gradL);

    const accF = ax * f.x + az * f.z;
    this.smoothAccel += (clamp(accF, -12, 12) - this.smoothAccel) * Math.min(1, dt * 8);
    s.accelF = this.smoothAccel;
    s.accelL += (ax * l.x + az * l.z - s.accelL) * Math.min(1, dt * 8);
  }

  /** Engine off: revs run down to 0; on the starter they chug, then flare as it catches and settle to idle. */
  private ignition(dt: number): void {
    const s = this.state;
    if (this.starter > 0) {
      this.starter -= dt;
      s.rpm = 260 + 90 * Math.sin(this.starter * 55) + 40 * Math.sin(this.starter * 23);
      if (this.starter <= 0) {
        this.engineOn = true;
        s.rpm = this.spec.idleRpm * 1.9;
      }
    } else s.rpm = Math.max(0, s.rpm - (s.rpm * 2.5 + 400) * dt);
  }

  /** Terrain cliffs in front of the car (ramp backs, quay walls seen from the water) stop it like a wall. */
  private terrainWall(dt: number): void {
    const s = this.state;
    s.wallHit = 0;
    const sp = Math.hypot(s.vel.x, s.vel.z);
    if (sp < 0.3) return;
    const dx = s.vel.x / sp;
    const dz = s.vel.z / sp;
    const reach = this.spec.halfLength;
    const g = VehiclePhysics.ground;
    const lead = g.heightAt(s.pos.x + dx * reach, s.pos.z + dz * reach);
    if (lead - s.y < 0.35) return;
    const before = g.heightAt(s.pos.x + dx * (reach - 0.3), s.pos.z + dz * (reach - 0.3));
    if (lead - before < CLIFF) return;
    s.pos.x -= s.vel.x * dt;
    s.pos.z -= s.vel.z * dt;
    this.wallNormal.x = -dx;
    this.wallNormal.z = -dz;
    s.vel.x -= 1.25 * sp * dx;
    s.vel.z -= 1.25 * sp * dz;
    s.yawRate *= 0.5;
    s.wallHit = sp;
  }

  /** Follow the ground, take off where it falls away faster than gravity, fly, land, sink in water. */
  private stepVertical(dt: number, hF: number, hR: number, gradL: number): void {
    const s = this.state;
    const g = VehiclePhysics.ground;
    const h = g.heightAt(s.pos.x, s.pos.z);
    const water = g.waterAt(s.pos.x, s.pos.z);
    s.landT += dt;
    if (!s.airborne) {
      const vyFollow = clamp((h - s.y) / dt, -25, 25);
      const ay = (vyFollow - s.vy) / dt;
      if (this.fresh) {
        this.fresh = false;
        s.vy = this.groundRate(h);
        s.y = h;
      } else if (ay < -G && h < s.y + s.vy * dt) {
        s.airborne = true;
        s.airTime = 0;
      } else {
        s.load += (clamp(1 + ay / G, 0.2, 2.2) - s.load) * Math.min(1, dt * 14);
        s.vy = vyFollow;
        s.y = h;
      }
    }
    if (s.airborne) {
      s.airTime += dt;
      s.load = 0;
      const wet = water !== null && s.y < water;
      s.vy -= G * (wet ? 0.25 : 1) * dt;
      if (wet) s.vy *= Math.exp(-5 * dt);
      s.y += s.vy * dt;
      if (s.y <= h) {
        // Landing: the ground's own vertical speed under the moving car vs ours
        const vyGround = this.groundRate(h);
        s.landImpact = Math.max(0, vyGround - s.vy);
        s.landT = 0;
        s.y = h;
        s.vy = vyGround;
        s.airborne = false;
        s.load = 1 + Math.min(1.2, s.landImpact * 0.12);
      }
    }
    s.water = water !== null ? Math.max(0, water - s.y) : 0;
    if (s.water > 0.3 && !s.airborne) {
      // sunk to the bed
      s.vy = 0;
      s.y = h;
    }

    // Attitude: follow the ground, or the flight path in the air
    const L = this.spec.cgToFront + this.spec.cgToRear;
    if (s.airborne) {
      const hs = Math.hypot(s.vel.x, s.vel.z);
      const path = clamp(Math.atan2(s.vy, Math.max(hs, 4)) * 0.85, -0.6, 0.6);
      s.pitch += (path - s.pitch) * Math.min(1, dt * 1.6);
      s.roll *= 1 - Math.min(1, dt * 1.2);
    } else {
      const k = Math.min(1, dt * 22);
      s.pitch += (Math.atan2(hF - hR, L) - s.pitch) * k;
      s.roll += (Math.atan(gradL) - s.roll) * k;
    }
    this.stepSuspension(dt);
  }

  /**
   * The body riding a bump. Terrain pitch is pulled back onto the road every step, so a pothole's nod and
   * heave live on their own springs: drop in, come back up, settle. Wheels are not part of this.
   */
  private stepSuspension(dt: number): void {
    const s = this.state;
    s.heaveV += (-HEAVE_W * HEAVE_W * s.heave - 2 * HEAVE_Z * HEAVE_W * s.heaveV) * dt;
    s.heave += s.heaveV * dt;
    if (s.heave < HEAVE_MIN) {
      s.heave = HEAVE_MIN;
      if (s.heaveV < 0) s.heaveV *= -0.3;
    } else if (s.heave > HEAVE_MAX) {
      s.heave = HEAVE_MAX;
      if (s.heaveV > 0) s.heaveV *= -0.3;
    }
    s.susPitchV += (-NOD_W * NOD_W * s.susPitch - 2 * NOD_Z * NOD_W * s.susPitchV) * dt;
    s.susPitch += s.susPitchV * dt;
    if (s.susPitch < -NOD_LIMIT) {
      s.susPitch = -NOD_LIMIT;
      if (s.susPitchV < 0) s.susPitchV *= -0.25;
    } else if (s.susPitch > NOD_LIMIT) {
      s.susPitch = NOD_LIMIT;
      if (s.susPitchV > 0) s.susPitchV *= -0.25;
    }
  }

  /** Rate the ground rises under the car as it moves (m/s). */
  private groundRate(h: number): number {
    const s = this.state;
    const g = VehiclePhysics.ground;
    const e = 0.4;
    const sp = Math.hypot(s.vel.x, s.vel.z);
    if (sp < 0.1) return 0;
    const ahead = g.heightAt(s.pos.x + (s.vel.x / sp) * e, s.pos.z + (s.vel.z / sp) * e);
    return clamp(((ahead - h) / e) * sp, -20, 20);
  }
}
