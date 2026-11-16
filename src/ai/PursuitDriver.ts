import { clamp, dot, fwd, leftOf } from '../core/math';
import type { World } from '../core/World';
import type { AABB, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import type { Pathfinder, Route } from './Pathfinding';

/** Chase balance knobs (live-tunable from the debug panel). */
export const PURSUIT_TUNING = {
  /** Flanking pursuers (every second unit) route to where the player will be this many seconds ahead (0 = off). */
  flankLead: 3.2,
  /** ...out to at most this far ahead of the player (m), and only while further than `flankUntil` from them. */
  flankMax: 75,
  flankUntil: 35,
  /** Pursuer top speed in m/s (each cop gets 0.88..1x). */
  topSpeed: 38,
  /** Closing speed (m/s) when making contact with the target: a bump or PIT, not a full-speed ram. */
  ramSpeed: 5,
  /** Speed through a 90 degree route corner. */
  cornerSpeed: 11,
  /** Seconds without any cop seeing the player before the pursuit ends. */
  loseTime: 12,
  /** During a pursuit, dispatch reports the player's real position this often (seen or not). */
  pingInterval: 4,
};

/** Straight-line chasing (no route) when the target is visible and closer than this. */
const DIRECT_RANGE = 50;
const REPLAN = 0.6;
const DECEL = 7;
const APPROACH_DECEL = 6;
/** Center distance at which a cop is touching the target. */
const CONTACT_DIST = 5.5;
const FEELER_ANGLE = 0.45;
const AVOID_GAIN = 0.9;
/** Seconds at a standstill while trying to move before backing up. */
const STUCK_DELAY = 1;
/** Reverse time grows with consecutive attempts; odd attempts back out straight, even ones counter-steer. */
const REVERSE_TIME = [1.3, 1.6, 2.0];
const blocksSight = (b: AABB) => 'height' in b;

export interface ChaseTarget {
  pos: Vec2;
  vel: Vec2;
  /** Car to ram (excluded from obstacle feelers); null when chasing a remembered position. */
  car: Car | null;
}

/**
 * Pursuit controller for one car: follows an A* route when far or out of sight, drives straight at a
 * predicted lead point when close (rear-quarter PIT when alongside), ignores signals, steers around
 * obstacles with three feelers and backs out when wedged against something.
 */
export class PursuitDriver {
  /** Seconds of continuous stalling (for despawning hopeless cases). */
  stuckFor = 0;
  mode: 'route' | 'direct' = 'route';
  route: Route | null = null;
  private seg = 0;
  private replan: number;
  private stallT = 0;
  private reverseT = 0;
  private reverseSteer = 0;
  private attempts = 0;

  constructor(
    private world: World,
    readonly car: Car,
    private finder: Pathfinder,
    /** Multiplier on `PURSUIT_TUNING.topSpeed`. */
    public skill = 1,
    /** Steer around other cars (false: only static obstacles, push through traffic). */
    private avoidCars = true,
    /**
     * Flanker (0..1 share of `PURSUIT_TUNING.flankLead`): out of sight or far away, routes to a point ahead of
     * the player instead of to the player, so it comes out of a side street in front rather than queueing
     * behind the lead car.
     */
    public flank = 0,
  ) {
    this.replan = world.rng.range(0, REPLAN);
  }

  get maxSpeed(): number {
    return PURSUIT_TUNING.topSpeed * this.skill;
  }

  drive(target: ChaseTarget, dt: number): void {
    const car = this.car;
    const s = car.phys.state;
    const v = s.speed;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      car.input.throttle = 0;
      car.input.brake = 1;
      car.input.handbrake = false;
      car.input.steer = this.reverseSteer;
      return;
    }

    const d = Math.hypot(target.pos.x - s.pos.x, target.pos.z - s.pos.z);
    const visible = d < DIRECT_RANGE && !this.world.statics.segmentBlocked(s.pos, target.pos, blocksSight);
    this.mode = visible ? 'direct' : 'route';

    let aim: Vec2;
    let vt = this.maxSpeed;
    if (this.mode === 'direct') {
      aim = this.leadPoint(target, d);
      const tv = Math.hypot(target.vel.x, target.vel.z);
      if (target.car && d < 7 && tv < 2) vt = 0; // box in a stopped target
      else if (!target.car && d < 10) vt = 0; // reached the last known position: wait there
      else {
        // Close in at the target's speed plus a margin that shrinks to a firm bump at contact.
        const tvf = Math.max(0, dot(target.vel, fwd(s.yaw)));
        vt = Math.min(vt, tvf + PURSUIT_TUNING.ramSpeed + Math.sqrt(2 * APPROACH_DECEL * Math.max(0, d - 5)));
        // In contact: match speed instead of bulldozing the target down the street.
        if (target.car && d < CONTACT_DIST) vt = Math.min(vt, tvf * 0.9);
      }
    } else {
      this.replan -= dt;
      if (!this.route || this.replan <= 0) {
        this.replan = REPLAN;
        this.route = this.finder.findRoute(s.pos, this.goal(target, d), { heading: fwd(s.yaw) });
        this.seg = 0;
      }
      if (!this.route || this.route.points.length < 2) aim = target.pos;
      else {
        this.advance();
        aim = this.lookahead(clamp(5 + Math.max(0, v) * 0.45, 6, 18));
        vt = Math.min(vt, this.cornerSpeed());
      }
    }

    // Steering: pure pursuit toward the aim point, plus feeler avoidance.
    const f = fwd(s.yaw);
    const l = leftOf(s.yaw);
    const rel = { x: aim.x - s.pos.x, z: aim.z - s.pos.z };
    const lat = dot(rel, l);
    const ahead = dot(rel, f);
    const wb = car.phys.spec.cgToFront + car.phys.spec.cgToRear;
    const vAbs = Math.max(1, Math.abs(v));
    let steer: number;
    if (ahead < 0 && Math.abs(lat) < -ahead * 2) steer = lat > 0 ? -1 : 1;
    else steer = clamp(-Math.atan2(2 * wb * lat, Math.max(1, rel.x * rel.x + rel.z * rel.z)) / car.phys.maxSteerAt(vAbs), -1, 1);

    const reach = clamp(6 + Math.max(0, v) * 0.9, 8, 40);
    const fc = this.feeler(s.yaw, reach, target.car);
    const fl = this.feeler(s.yaw + FEELER_ANGLE, reach, target.car);
    const fr = this.feeler(s.yaw - FEELER_ANGLE, reach, target.car);
    if (fc < reach) steer -= Math.sign(fl - fr || 1) * AVOID_GAIN * (1 - fc / reach);
    if (fl < 3) steer += 0.4 * (1 - fl / 3);
    if (fr < 3) steer -= 0.4 * (1 - fr / 3);
    car.input.steer = clamp(steer, -1, 1);
    // Don't drive into walls faster than we can stop.
    if (fc < reach) vt = Math.min(vt, Math.max(4, Math.sqrt(2 * DECEL * Math.max(0, fc - 4))));
    // Target stopped nearby but the way is blocked (usually by another cop): hold position, close the box.
    if (this.mode === 'direct' && target.car && d < 14 && target.car.speed < 2 && fc < 3) vt = 0;

    // Speed control (brake input at a standstill would select reverse, so only brake while moving).
    if (v < vt) {
      car.input.throttle = clamp((vt - v) * 0.5 + car.phys.state.slope * 3, 0.35, 1);
      car.input.brake = 0;
    } else {
      car.input.throttle = 0;
      car.input.brake = v > 1.5 ? clamp((v - vt) * 0.2, 0.1, 1) : 0;
    }
    car.input.handbrake = false;

    // Wedged: trying to move but not moving. Back up with the wheel turned the other way.
    if (vt > 3 && Math.abs(v) < 0.8) {
      this.stallT += dt;
      this.stuckFor += dt;
      if (this.stallT > STUCK_DELAY) {
        this.stallT = 0;
        this.reverseT = REVERSE_TIME[Math.min(this.attempts, REVERSE_TIME.length - 1)];
        this.reverseSteer = this.attempts % 2 === 0 ? 0 : -Math.sign(car.input.steer || 1);
        this.attempts++;
        this.route = null;
      }
    } else if (Math.abs(v) > 3) {
      this.stallT = 0;
      this.attempts = 0;
      this.stuckFor = Math.max(0, this.stuckFor - dt * 2);
    }
  }

  /** Route goal: the target, or for a flanker still far off, a point ahead of it along its velocity. */
  private goal(t: ChaseTarget, d: number): Vec2 {
    const T = PURSUIT_TUNING;
    const v = Math.hypot(t.vel.x, t.vel.z);
    if (this.flank <= 0 || !t.car || v < 8 || d < T.flankUntil) return t.pos;
    const ahead = Math.min(T.flankMax, v * T.flankLead * this.flank);
    return { x: t.pos.x + (t.vel.x / v) * ahead, z: t.pos.z + (t.vel.z / v) * ahead };
  }

  /** Forget stall state (after the car was relocated). */
  resetStuck(): void {
    this.stuckFor = this.stallT = this.reverseT = this.attempts = 0;
    this.route = null;
  }

  /** Where to aim: the predicted target position, or its rear quarter when alongside (PIT). */
  private leadPoint(t: ChaseTarget, d: number): Vec2 {
    const s = this.car.phys.state;
    const closing = Math.max(5, Math.max(0, s.speed) - dot(t.vel, fwd(s.yaw)) * 0.5);
    const lead = clamp(d / closing, 0, 1.2);
    const p = { x: t.pos.x + t.vel.x * lead, z: t.pos.z + t.vel.z * lead };
    if (t.car && d < 12 && t.car.speed > 6) {
      const tf = fwd(t.car.yaw);
      const tl = leftOf(t.car.yaw);
      const side = dot({ x: s.pos.x - t.pos.x, z: s.pos.z - t.pos.z }, tl) > 0 ? 1 : -1;
      p.x += -tf.x * 1.4 + tl.x * side * 0.6;
      p.z += -tf.z * 1.4 + tl.z * side * 0.6;
    }
    return p;
  }

  /** Free distance along a ray from the car's nose (statics and other cars, not the chase target). */
  private feeler(yaw: number, reach: number, ignore: Car | null): number {
    const car = this.car;
    const dir = fwd(yaw);
    const o = { x: car.pos.x + fwd(car.yaw).x * car.halfL, z: car.pos.z + fwd(car.yaw).z * car.halfL };
    let best = this.world.statics.rayDistance(o, dir, reach);
    if (!this.avoidCars) return best;
    for (const c of this.world.cars) {
      if (c === car || c === ignore || c.removed) continue;
      const rx = c.pos.x - o.x;
      const rz = c.pos.z - o.z;
      const along = rx * dir.x + rz * dir.z;
      if (along <= 0 || along > best) continue;
      const side = Math.abs(rx * dir.z - rz * dir.x);
      if (side < c.halfW + car.halfW + 0.3) best = Math.max(0, along - c.halfL);
    }
    return best;
  }

  private advance(): void {
    const pts = this.route!.points;
    const p = this.car.pos;
    while (this.seg < pts.length - 2) {
      const a = pts[this.seg];
      const b = pts[this.seg + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      if (((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1) < 1) break;
      this.seg++;
    }
  }

  private lookahead(dist: number): Vec2 {
    const pts = this.route!.points;
    const p = this.car.pos;
    let i = this.seg;
    let a = pts[i];
    let b = pts[i + 1];
    let len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const t = clamp(((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (len * len), 0, 1);
    let remaining = dist + t * len;
    while (remaining > len && i < pts.length - 2) {
      remaining -= len;
      i++;
      a = pts[i];
      b = pts[i + 1];
      len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    }
    const u = Math.min(remaining / len, 1);
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
  }

  /** Highest speed that still makes the next route corner. */
  private cornerSpeed(): number {
    const pts = this.route!.points;
    const p = this.car.pos;
    let dist = Math.hypot(pts[this.seg + 1].x - p.x, pts[this.seg + 1].z - p.z);
    for (let i = this.seg + 1; i < pts.length - 1 && dist < 120; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const d0 = { x: b.x - a.x, z: b.z - a.z };
      const d1 = { x: c.x - b.x, z: c.z - b.z };
      const cos = dot(d0, d1) / ((Math.hypot(d0.x, d0.z) || 1) * (Math.hypot(d1.x, d1.z) || 1));
      if (cos < 0.7) return Math.sqrt(PURSUIT_TUNING.cornerSpeed ** 2 + 2 * DECEL * Math.max(0, dist - 6));
      dist += Math.hypot(d1.x, d1.z);
    }
    return Infinity;
  }
}
