import { clamp, dot, fwd, leftOf, leftVec, wrapAngle, yawOf } from '../core/math';
import type { World } from '../core/World';
import type { OffenseKind, Vec2 } from '../types';
import { surfaceAt } from '../world/Surfaces';
import type { Ped, Pedestrians } from './Pedestrians';

/** Seconds of player motion predicted when looking for peds in the way. */
const LOOKAHEAD = 0.6;
const PREDICT_STEPS = 4;
/** Lateral clearance a ped wants between its center and the side of the car. */
const PED_CLEAR = 0.8;
/** Hard limit: no ped center is ever closer than this to the car body. */
const BODY_MARGIN = 0.35;
/** Below this player speed peds sidestep instead of diving. */
const DIVE_SPEED = 3;
/** A dive caused by the player at or above this speed is a near-miss offense. */
const NEAR_MISS_SPEED = 4.5;
const NEAR_MISS_COOLDOWN = 1.2;
/** A diving ped's body extends about this far past its feet position. */
const BODY_REACH = 1;
const HORN_RADIUS = 22;
const SIDEWALK_MIN_SPEED = 3;
const SIDEWALK_DELAY = 0.3;
const SIDEWALK_REPEAT = 2.5;
/** Leaving the sidewalk for less than this does not end a sidewalk run (curb bounces). */
const SIDEWALK_GRACE = 1;

export const DIVE_AIR = 0.42;
export const DIVE_DOWN = 0.75;
export const DIVE_GETUP = 0.55;
export const STEP_T = 0.4;
/** Running speed while panicked, as a multiple of the ped's walking speed. */
export const PANIC_PACE = 3;

export type DodgeKind = 'none' | 'step' | 'dive';

/** Per-ped reaction state (mixed into `Ped`). */
export interface DodgeState {
  dodge: DodgeKind;
  /** Seconds since the current dodge started. */
  dodgeT: number;
  dodgeFrom: Vec2;
  dodgeTo: Vec2;
  /** Seconds of panicked running left (horn). */
  panic: number;
}

export const dodgeState = (): DodgeState => ({ dodge: 'none', dodgeT: 0, dodgeFrom: { x: 0, z: 0 }, dodgeTo: { x: 0, z: 0 }, panic: 0 });

interface Threat {
  /** Seconds until the car body reaches the ped. */
  t: number;
  /** Unit direction of the predicted path segment that hits the ped. */
  u: Vec2;
  /** Signed offset of the ped from that segment (positive = left of the path). */
  lat: number;
  /** Lateral distance from the path at which the ped is clear. */
  clear: number;
}

/**
 * Keeps pedestrians out of the player's way: peds in the predicted path dive or sidestep, the horn makes
 * nearby peds run, and a hard push-out guarantees the car never overlaps a ped (there is no contact).
 * Emits `pedEndangered` on near-misses and `sidewalk` while the player drives off the road.
 */
export class PedestrianDodge {
  /** Counters for the debug overlay; `pushes` counts peds the prediction missed at speed. */
  readonly stats = { dives: 0, steps: 0, pushes: 0, nearMisses: 0, sidewalk: 0 };
  private path: Vec2[] = Array.from({ length: PREDICT_STEPS + 1 }, () => ({ x: 0, z: 0 }));
  private halfW = 0;
  private halfL = 0;
  private hornPending = false;
  private nearMissCooldown = 0;
  private sidewalkT = 0;
  private offSidewalkT = 0;
  private nextSidewalkEmit = SIDEWALK_DELAY;

  constructor(
    private world: World,
    private peds: Pedestrians,
  ) {
    world.events.on('horn', () => (this.hornPending = true));
  }

  /** Advance a dodging ped. Returns true while the dodge owns the ped's movement. */
  move(p: Ped, dt: number): boolean {
    if (p.dodge === 'none') return false;
    p.dodgeT += dt;
    const dive = p.dodge === 'dive';
    const air = dive ? DIVE_AIR : STEP_T;
    const u = Math.min(1, p.dodgeT / air);
    const e = 1 - (1 - u) * (1 - u);
    const x = p.dodgeFrom.x + (p.dodgeTo.x - p.dodgeFrom.x) * e;
    const z = p.dodgeFrom.z + (p.dodgeTo.z - p.dodgeFrom.z) * e;
    p.vel.x = (x - p.pos.x) / dt;
    p.vel.z = (z - p.pos.z) / dt;
    p.phase += Math.hypot(p.vel.x, p.vel.z) * dt * 4.2;
    p.pos.x = x;
    p.pos.z = z;
    if (dive && u < 1) {
      const dir = yawOf({ x: p.dodgeTo.x - p.dodgeFrom.x, z: p.dodgeTo.z - p.dodgeFrom.z });
      p.heading += wrapAngle(dir - p.heading) * Math.min(1, dt * 14);
    }
    p.onRoad = !!this.world.city.roadAt(p.pos);
    if (p.dodgeT >= (dive ? DIVE_AIR + DIVE_DOWN + DIVE_GETUP : STEP_T)) {
      p.dodge = 'none';
      if (p.waiting) this.peds.giveUpCrossing(p);
    }
    return true;
  }

  /** Run after peds have moved for this step, before cars move. */
  update(dt: number): void {
    const w = this.world;
    const car = w.player;
    this.nearMissCooldown -= dt;
    this.predictPath();
    const speed = car.speed;
    const reach = speed * LOOKAHEAD + this.halfL + PED_CLEAR + 2;
    const horn = this.hornPending;
    this.hornPending = false;

    for (const p of this.peds.peds) {
      if (!p.active) continue;
      if (p.panic > 0) p.panic -= dt;
      const rx = p.pos.x - car.pos.x;
      const rz = p.pos.z - car.pos.z;
      if (horn && rx * rx + rz * rz < HORN_RADIUS * HORN_RADIUS) this.scare(p, { x: rx, z: rz });
      if (Math.abs(rx) > reach || Math.abs(rz) > reach) continue;
      // Airborne divers are committed; peds lying down or walking can still react
      const busy = p.dodge === 'step' || (p.dodge === 'dive' && p.dodgeT < DIVE_AIR);
      if (!busy && speed > 0.5) {
        const th = this.threat(p);
        if (th) this.startDodge(p, th, speed);
      }
      this.keepClear(p, dt);
    }
    this.watchSidewalk(dt);
  }

  /** Sample the player's path for the next LOOKAHEAD seconds, turning at the current yaw rate. */
  private predictPath(): void {
    const car = this.world.player;
    const s = car.phys.state;
    const speed = car.speed;
    const heading = speed > 0.3 ? Math.atan2(s.vel.x, s.vel.z) : car.yaw;
    // Drifting sideways makes the swept footprint wider
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

  /** Is the ped inside the area the car body will sweep over the lookahead? */
  private threat(p: Ped): Threat | null {
    const speed = this.world.player.speed;
    const h = LOOKAHEAD / PREDICT_STEPS;
    const segLen = speed * h;
    const clear = this.halfW + PED_CLEAR;
    for (let k = 0; k < PREDICT_STEPS; k++) {
      const a = this.path[k];
      const b = this.path[k + 1];
      const u = { x: (b.x - a.x) / segLen, z: (b.z - a.z) / segLen };
      const r = { x: p.pos.x - a.x, z: p.pos.z - a.z };
      const along = dot(r, u);
      if (along < (k === 0 ? -this.halfL : 0) || along > segLen + this.halfL) continue;
      const lat = dot(r, leftVec(u));
      if (Math.abs(lat) >= clear) continue;
      return { t: k * h + Math.max(0, along - this.halfL) / speed, u, lat, clear };
    }
    return null;
  }

  private startDodge(p: Ped, th: Threat, speed: number): void {
    const lv = leftVec(th.u);
    let side = Math.abs(th.lat) < 0.15 ? (this.world.rng.chance(0.5) ? 1 : -1) : Math.sign(th.lat);
    const dive = speed >= DIVE_SPEED;
    const pad = dive ? BODY_REACH : 0.3;
    const needOwn = th.clear + 0.25 - side * th.lat;
    const roomOwn = this.room(p.pos, { x: lv.x * side, z: lv.z * side }) - pad;
    let need = needOwn;
    let room = roomOwn;
    if (roomOwn < needOwn) {
      const needOther = th.clear + 0.25 + side * th.lat;
      const roomOther = this.room(p.pos, { x: -lv.x * side, z: -lv.z * side }) - pad;
      if (roomOther >= needOther || roomOther - needOther > roomOwn - needOwn) {
        side = -side;
        need = needOther;
        room = roomOther;
      }
    }
    const dist = Math.max(0, Math.min(dive ? clamp(need + 0.6, 1.6, 4.5) : need + 0.2, room));
    p.dodge = dive ? 'dive' : 'step';
    p.dodgeT = 0;
    p.dodgeFrom.x = p.pos.x;
    p.dodgeFrom.z = p.pos.z;
    p.dodgeTo.x = p.pos.x + lv.x * side * dist;
    p.dodgeTo.z = p.pos.z + lv.z * side * dist;
    if (dive) this.stats.dives++;
    else this.stats.steps++;
    if (dive && speed >= NEAR_MISS_SPEED && this.nearMissCooldown <= 0 && !this.world.controlLocked) {
      this.nearMissCooldown = NEAR_MISS_COOLDOWN;
      this.stats.nearMisses++;
      this.offense('pedEndangered', p.pos);
    }
  }

  /** Free distance from `pos` along `dir` before a building or prop (capped). */
  private room(pos: Vec2, dir: Vec2): number {
    return Math.min(this.world.statics.rayDistance(pos, dir, 6), 6);
  }

  /** Last line of defence: push a ped out of the car body, now and where the car will be after this step. */
  private keepClear(p: Ped, dt: number): void {
    const car = this.world.player;
    const s = car.phys.state;
    const ex = car.halfL + BODY_MARGIN;
    const ey = car.halfW + BODY_MARGIN;
    for (const ahead of [0, dt]) {
      const cx = car.pos.x + s.vel.x * ahead;
      const cz = car.pos.z + s.vel.z * ahead;
      const yaw = car.yaw + s.yawRate * ahead;
      const f = fwd(yaw);
      const l = leftOf(yaw);
      const r = { x: p.pos.x - cx, z: p.pos.z - cz };
      let a = dot(r, f);
      let b = dot(r, l);
      if (Math.abs(a) >= ex || Math.abs(b) >= ey) continue;
      if (ey - Math.abs(b) <= ex - Math.abs(a)) b = (b < 0 ? -1 : 1) * ey;
      else a = (a < 0 ? -1 : 1) * ex;
      const nx = cx + f.x * a + l.x * b;
      const nz = cz + f.z * a + l.z * b;
      // Shift the dodge path too, so the scripted dive does not pull the ped back in
      p.dodgeFrom.x += nx - p.pos.x;
      p.dodgeFrom.z += nz - p.pos.z;
      p.dodgeTo.x += nx - p.pos.x;
      p.dodgeTo.z += nz - p.pos.z;
      p.pos.x = nx;
      p.pos.z = nz;
      if (car.speed > DIVE_SPEED) this.stats.pushes++;
    }
  }

  /** Horn: run away from the car along the sidewalk instead of crossing. */
  private scare(p: Ped, away: Vec2): void {
    p.panic = this.world.rng.range(1.6, 2.6);
    if (p.waiting) {
      this.peds.giveUpCrossing(p, away);
      return;
    }
    const g = this.peds.graph;
    const e = g.edges[p.edge];
    if (dot(g.dir(e, p.to), away) < 0) p.to = g.other(e, p.to);
  }

  private watchSidewalk(dt: number): void {
    const w = this.world;
    const car = w.player;
    const p = car.pos;
    // Raised pavement only: lots, driveways, yards, arcades and garages are fair game (IMPROVEMENTS #11)
    const off = car.speed > SIDEWALK_MIN_SPEED && !car.phys.state.airborne && surfaceAt(w.city, p) === 'sidewalk';
    if (off && !w.controlLocked) {
      this.offSidewalkT = 0;
      this.sidewalkT += dt;
      if (this.sidewalkT >= this.nextSidewalkEmit) {
        this.nextSidewalkEmit += SIDEWALK_REPEAT;
        this.stats.sidewalk++;
        this.offense('sidewalk', p);
      }
    } else if ((this.offSidewalkT += dt) > SIDEWALK_GRACE) {
      this.sidewalkT = 0;
      this.nextSidewalkEmit = SIDEWALK_DELAY;
    }
  }

  /** Raw detection; whether police saw it is decided by Heat (T24/T25). */
  private offense(kind: OffenseKind, pos: Vec2): void {
    this.world.events.emit({ type: 'offense', kind, pos: { x: pos.x, z: pos.z }, witnessed: false });
  }
}
