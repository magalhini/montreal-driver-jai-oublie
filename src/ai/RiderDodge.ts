import { clamp, dot, fwd, leftOf, leftVec, wrapAngle } from '../core/math';
import type { World } from '../core/World';
import type { SimSystem, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import { curbRoom, curbVec, pathDir, RIDER_HALF_L, RIDER_HALF_W, type Rider } from './Rider';

/** Seconds of a fast car's motion predicted when looking for riders in its way. */
const LOOKAHEAD = 0.9;
const PREDICT_STEPS = 4;
/** Lateral gap a rider wants between itself and the side of a passing car. */
const RIDER_CLEAR = 0.3;
/** Swerve limits from the riding line: up onto the sidewalk (the curb is 0.65 m away) or out into the lane. */
const SWERVE_CURB = 1.6;
const SWERVE_ROAD = -2.2;
const CURB_AT = 0.65;
/** Fastest sideways hop (m/s) when a car is about to hit the rider. */
const HOP_RATE = 7;
/** A dodge of at least this much, forced by the player at speed, is a near miss. */
const NEAR_MISS_SWERVE = 0.8;
const NEAR_MISS_SPEED = 4.5;
const NEAR_MISS_COOLDOWN = 1.2;
/** Cars this much higher than the rider (in the air) pass over it. */
const OVERHEAD = 1.4;

interface Threat {
  t: number;
  u: Vec2;
  lat: number;
  clear: number;
}

/**
 * Keeps bicycles and scooters out of the way of fast cars that don't follow traffic rules (the player, cops
 * running with sirens): riders swerve toward the curb (hopping up onto the sidewalk if needed) or out into the
 * lane, brake for cars cutting across, and a last-resort push-out means no car ever overlaps a rider.
 * Forcing a big swerve at speed is a `pedEndangered` near miss.
 */
export class RiderDodge implements SimSystem {
  readonly stats = { swerves: 0, hops: 0, brakes: 0, shoves: 0, nearMisses: 0 };
  private path: Vec2[] = Array.from({ length: PREDICT_STEPS + 1 }, () => ({ x: 0, z: 0 }));
  private halfW = 0;
  private halfL = 0;
  private nearMissCooldown = 0;

  constructor(private world: World) {}

  update(dt: number): void {
    const w = this.world;
    this.nearMissCooldown -= dt;
    if (!w.riders.length) return;
    for (const car of w.cars) {
      if (car.removed || car.speed < 1) continue;
      if (car !== w.player && !car.siren) continue;
      this.predict(car);
      const reach = car.speed * LOOKAHEAD + this.halfL + 4;
      for (const r of w.riders) {
        if (Math.abs(r.pos.x - car.pos.x) > reach || Math.abs(r.pos.z - car.pos.z) > reach) continue;
        if (car.y - w.city.terrain.heightAt(r.pos.x, r.pos.z) > OVERHEAD) continue;
        const th = this.threat(r, car);
        if (th) this.react(r, th, car);
      }
    }
    for (const r of w.riders) for (const car of w.cars) if (!car.removed) this.keepClear(r, car, dt);
  }

  /** Sample the car's path for the next LOOKAHEAD seconds, turning at its current yaw rate. */
  private predict(car: Car): void {
    const s = car.phys.state;
    const speed = car.speed;
    const heading = Math.atan2(s.vel.x, s.vel.z);
    const slip = wrapAngle(car.yaw - heading);
    const c = Math.abs(Math.cos(slip));
    const sn = Math.abs(Math.sin(slip));
    this.halfW = car.halfW * c + car.halfL * sn;
    this.halfL = car.halfL * c + car.halfW * sn;
    const turn = clamp(s.yawRate, -1.5, 1.5);
    const h = LOOKAHEAD / PREDICT_STEPS;
    this.path[0].x = car.pos.x;
    this.path[0].z = car.pos.z;
    for (let k = 1; k <= PREDICT_STEPS; k++) {
      const d = fwd(heading + turn * (k - 0.5) * h);
      this.path[k].x = this.path[k - 1].x + d.x * speed * h;
      this.path[k].z = this.path[k - 1].z + d.z * speed * h;
    }
  }

  /** Is the rider (as a box along its heading) inside the area the car will sweep? */
  private threat(r: Rider, car: Car): Threat | null {
    const h = LOOKAHEAD / PREDICT_STEPS;
    const segLen = car.speed * h;
    const rf = fwd(r.heading);
    for (let k = 0; k < PREDICT_STEPS; k++) {
      const a = this.path[k];
      const b = this.path[k + 1];
      const u = { x: (b.x - a.x) / segLen, z: (b.z - a.z) / segLen };
      const lv = leftVec(u);
      // rider footprint across / along the car's path
      const extW = Math.abs(dot(rf, lv)) * RIDER_HALF_L + Math.abs(dot(leftVec(rf), lv)) * RIDER_HALF_W;
      const extL = Math.abs(dot(rf, u)) * RIDER_HALF_L + Math.abs(dot(leftVec(rf), u)) * RIDER_HALF_W;
      const rel = { x: r.pos.x - a.x, z: r.pos.z - a.z };
      const along = dot(rel, u);
      if (along < (k === 0 ? -this.halfL - extL : 0) || along > segLen + this.halfL + extL) continue;
      const lat = dot(rel, lv);
      const clear = this.halfW + extW + RIDER_CLEAR;
      if (Math.abs(lat) >= clear) continue;
      return { t: k * h + Math.max(0, along - this.halfL - extL) / car.speed, u, lat, clear };
    }
    return null;
  }

  /**
   * Pick the smaller sideways move that clears the car's path (room permitting) and stick to that side while
   * the danger lasts; hop sideways fast when impact is close; brake if swerving can't help (car crossing ahead).
   */
  private react(r: Rider, th: Threat, car: Car): void {
    const n = curbVec(pathDir(r));
    const k = dot(n, leftVec(th.u));
    if (Math.abs(k) < 0.45) {
      if (r.brakeT <= 0) this.stats.brakes++;
      r.brakeT = Math.max(r.brakeT, 1.2);
      return;
    }
    const curbMax = Math.min(SWERVE_CURB, r.swerve + Math.max(0, curbRoom(this.world, r.pos, n, 3) - RIDER_HALF_W - 0.1));
    // Swerve that puts the rider just clear of either side of the car's path
    const a = r.swerve + ((th.clear + 0.2) - th.lat) / k;
    const b = r.swerve + (-(th.clear + 0.2) - th.lat) / k;
    const towardCurb = Math.max(a, b);
    const towardRoad = Math.min(a, b);
    let side = r.dodgeSide;
    if (side === 0) {
      const cost = (t: number) => Math.abs(t - r.swerve) + 10 * Math.abs(t - clamp(t, SWERVE_ROAD, curbMax));
      side = cost(towardCurb) <= cost(towardRoad) ? 1 : -1;
    }
    const want = side > 0 ? towardCurb : towardRoad;
    const goal = clamp(want, SWERVE_ROAD, curbMax);
    if (Math.abs(goal - want) > 0.05) r.brakeT = Math.max(r.brakeT, 0.8);
    const delta = goal - r.swerve;
    if (r.dodgeSide === 0 && Math.abs(delta) > 0.15) {
      this.stats.swerves++;
      if (goal > CURB_AT && r.swerve <= CURB_AT) this.stats.hops++;
    }
    r.dodgeSide = side;
    r.swerveTarget = side > 0 ? Math.max(goal, r.swerveTarget) : Math.min(goal, r.swerveTarget);
    r.swerveHold = 1.3;
    // Hop sideways as fast as it takes to be clear in time (up to a startled jump)
    r.swerveRate = Math.max(r.swerveRate, clamp((Math.abs(r.swerveTarget - r.swerve) / Math.max(th.t - 0.1, 0.08)) * 1.2, 0, HOP_RATE));
    const w = this.world;
    if (car === w.player && car.speed >= NEAR_MISS_SPEED && Math.abs(delta) >= NEAR_MISS_SWERVE && this.nearMissCooldown <= 0 && !w.controlLocked) {
      this.nearMissCooldown = NEAR_MISS_COOLDOWN;
      this.stats.nearMisses++;
      w.events.emit({ type: 'offense', kind: 'pedEndangered', pos: { x: r.pos.x, z: r.pos.z }, witnessed: false });
    }
  }

  /**
   * Last line of defence: push the rider sideways out of the car's body (now and after this step), never
   * along the car (no carrying a bike on the bumper).
   */
  private keepClear(r: Rider, car: Car, dt: number): void {
    const reach = car.halfL + RIDER_HALF_L + 1;
    if (Math.abs(r.pos.x - car.pos.x) > reach || Math.abs(r.pos.z - car.pos.z) > reach) return;
    if (car.y - this.world.city.terrain.heightAt(r.pos.x, r.pos.z) > OVERHEAD) return;
    const s = car.phys.state;
    const rad = RIDER_HALF_W + 0.04;
    const d = pathDir(r);
    const n = curbVec(d);
    for (const ahead of [0, dt]) {
      const cx = car.pos.x + s.vel.x * ahead;
      const cz = car.pos.z + s.vel.z * ahead;
      const yaw = car.yaw + s.yawRate * ahead;
      const f = fwd(yaw);
      const l = leftOf(yaw);
      // rider as a short capsule along its heading: its two ends and its center
      const rf = fwd(r.heading);
      let push = 0;
      let side = 0;
      for (const e of [-0.6, 0, 0.6]) {
        const rel = { x: r.pos.x + rf.x * e - cx, z: r.pos.z + rf.z * e - cz };
        const a = dot(rel, f);
        const b = dot(rel, l);
        const ex = car.halfL + rad;
        const ey = car.halfW + rad;
        if (Math.abs(a) >= ex || Math.abs(b) >= ey) continue;
        side ||= Math.abs(b) > 0.05 ? Math.sign(b) : Math.sign(dot(n, l)) || 1;
        push = Math.max(push, ey - side * b);
      }
      if (push <= 0) continue;
      const dx = l.x * side * push;
      const dz = l.z * side * push;
      // Keep the rider where it was put: the push becomes path progress and a held swerve
      r.along = Math.max(0, r.along + dx * d.x + dz * d.z);
      r.swerve += dx * n.x + dz * n.z;
      r.swerveTarget = r.swerve;
      r.swerveHold = Math.max(r.swerveHold, 0.5);
      r.pos.x += dx;
      r.pos.z += dz;
      r.speed *= 0.7;
      this.stats.shoves++;
    }
  }
}
