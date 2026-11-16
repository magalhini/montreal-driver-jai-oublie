import { CONFIG } from '../config';
import { clamp, dot, fwd, leftVec, wrapAngle } from '../core/math';
import type { World } from '../core/World';
import type { DistrictType, Lane, SimSystem, TurnType, Vec2 } from '../types';
import { corridorGap, CURB_OFFSET, curbVec, pathDir, RIDER_HALF_L, RIDER_HALF_W, turnType, type Rider, type RiderKind } from './Rider';


const EASY_TURN: TurnType = CONFIG.DRIVE_SIDE === 'left' ? 'left' : 'right';
const SPAWN_MIN = 60;
const SPAWN_MAX = 170;
const DESPAWN = 200;
/** Stopped this long behind a car that is stopped too: go around it (up onto the sidewalk or out into the lane). */
const GO_AROUND_AFTER = 2.5;
const DISTRICT_WEIGHT: Record<DistrictType, number> = { residential: 1, shotengai: 1, downtown: 0.75, depot: 0.6, harbor: 0.45 };

/** Live-tunable riding knobs (debug panel). */
export const RIDER_TUNING = {
  /** Share of riders on 50 cc scooters (the rest pedal). */
  scooters: 0.3,
  bicycle: [3.8, 5.8] as [number, number],
  scooter: [7.5, 10] as [number, number],
};

/**
 * Bicycles and 50 cc scooters riding along the curb of the outer lanes around the player (IMPROVEMENTS #12).
 * Kinematic (no physics): they follow a curb-side line, stop at signals, keep their distance from cars and
 * other riders, and filter past queues. Cars pass them with a nudge (`LaneDriver`); `RiderDodge` gets them
 * out of the way of the player and of cops with sirens.
 */
export class Riders implements SimSystem {
  readonly pool: Rider[] = [];
  target = CONFIG.MAX_RIDERS;
  private spawnTimer = 0;
  private nextId = 0;

  constructor(private world: World) {}

  get count(): number {
    return this.world.riders.length;
  }

  /** Fill the area right away (game start). */
  populate(): void {
    for (let k = 0; k < this.target * 6 && this.count < this.target; k++) this.trySpawn(20, true);
  }

  /** Place a rider on the curb side of `lane`'s road (the outer lane, same direction) at parameter t. */
  spawn(lane: Lane, t: number, kind?: RiderKind): Rider | null {
    const w = this.world;
    const rng = w.rng;
    const edge = w.city.edges[lane.edgeId];
    const ids = edge.lanesAB.includes(lane.id) ? edge.lanesAB : edge.lanesBA;
    const outer = w.city.lanes[ids[ids.length - 1]];
    let r = this.pool.find((p) => !p.active);
    if (!r) {
      r = {
        id: this.nextId++,
        active: false,
        kind: 'bicycle',
        pos: { x: 0, z: 0 },
        prev: { x: 0, z: 0 },
        heading: 0,
        prevHeading: 0,
        vel: { x: 0, z: 0 },
        speed: 0,
        cruise: 4,
        lane: outer,
        next: outer,
        turn: 'straight',
        path: [],
        seg: 0,
        along: 0,
        swerve: 0,
        swerveTarget: 0,
        swerveHold: 0,
        dodgeSide: 0,
        swerveRate: 0,
        brakeT: 0,
        waiting: 'none',
        braking: false,
        blockedT: 0,
        stuck: 0,
        phase: 0,
        lean: 0,
        look: 0,
      };
      this.pool.push(r);
    }
    r.kind = kind ?? (rng.chance(RIDER_TUNING.scooters) ? 'scooter' : 'bicycle');
    const [lo, hi] = RIDER_TUNING[r.kind];
    r.cruise = rng.range(lo, hi);
    r.speed = r.cruise * 0.8;
    r.lane = outer;
    this.chooseNext(r);
    this.buildPath(r);
    r.seg = 0;
    r.along = outer.length * t;
    r.swerve = r.swerveTarget = r.swerveHold = r.brakeT = r.dodgeSide = r.swerveRate = 0;
    r.waiting = 'none';
    r.stuck = 0;
    r.blockedT = 0;
    r.phase = rng.range(0, Math.PI * 2);
    r.lean = 0;
    r.look = rng.int(0, 1e6);
    r.active = true;
    this.place(r);
    r.prev.x = r.pos.x;
    r.prev.z = r.pos.z;
    r.heading = r.prevHeading = Math.atan2(outer.dir.x, outer.dir.z);
    w.riders.push(r);
    return r;
  }

  private trySpawn(rMin: number, ignoreView = false): void {
    const w = this.world;
    const pp = w.player.pos;
    const hit = w.city.randomLanePointNear(w.rng, pp, rMin, SPAWN_MAX);
    if (!hit) return;
    const c = curbVec(hit.lane.dir);
    const pos = { x: hit.pos.x + c.x * (CURB_OFFSET + 2), z: hit.pos.z + c.z * (CURB_OFFSET + 2) };
    const block = w.city.blockAt(pos);
    if (block && !w.rng.chance(DISTRICT_WEIGHT[block.district])) return;
    const dx = hit.pos.x - pp.x;
    const dz = hit.pos.z - pp.z;
    const d = Math.hypot(dx, dz);
    if (!ignoreView && d < 140 && dot({ x: dx, z: dz }, fwd(w.player.yaw)) > -0.3 * d) return;
    for (const o of w.cars) if (!o.removed && Math.hypot(o.pos.x - hit.pos.x, o.pos.z - hit.pos.z) < 10) return;
    for (const o of w.riders) if (Math.hypot(o.pos.x - hit.pos.x, o.pos.z - hit.pos.z) < 12) return;
    this.spawn(hit.lane, hit.t);
  }

  private despawn(r: Rider): void {
    r.active = false;
  }

  /** Next lane at the junction ahead: straight on or the curb-side turn; the crossing turn only at dead ends. */
  private chooseNext(r: Rider): void {
    const { city, rng } = this.world;
    const node = city.nodes[r.lane.to];
    const opts: { lane: Lane; turn: TurnType; w: number }[] = [];
    let fallback: { lane: Lane; turn: TurnType } | null = null;
    for (const eid of node.edges) {
      if (eid === r.lane.edgeId) continue;
      const ids = city.lanesLeaving(city.edges[eid], node.id);
      if (ids.length === 0) continue; // the far end of a one-way road
      const lane = city.lanes[ids[ids.length - 1]];
      const turn = turnType(r.lane.endDir, lane.dir);
      if (turn === 'straight' || turn === EASY_TURN) opts.push({ lane, turn, w: turn === 'straight' ? 1.6 : 1 });
      else fallback = { lane, turn };
    }
    if (!opts.length) {
      const f = fallback ?? { lane: r.lane, turn: 'straight' as TurnType };
      r.next = f.lane;
      r.turn = f.turn;
      return;
    }
    let x = rng.next() * opts.reduce((s, o) => s + o.w, 0);
    let pick = opts[0];
    for (const o of opts) {
      x -= o.w;
      if (x <= 0) {
        pick = o;
        break;
      }
    }
    r.next = pick.lane;
    r.turn = pick.turn;
  }

  private buildPath(r: Rider): void {
    const off = (p: Vec2, d: Vec2) => {
      const c = curbVec(d);
      return { x: p.x + c.x * CURB_OFFSET, z: p.z + c.z * CURB_OFFSET };
    };
    const l = r.lane;
    const n = r.next;
    const s0 = off(l.start, l.dir);
    const e0 = off(l.end, l.dir);
    const s1 = off(n.start, n.dir);
    const e1 = off(n.end, n.dir);
    const pts = [s0, e0];
    if (r.turn !== 'straight') {
      const c = Math.abs(l.dir.x) > 0.5 ? { x: s1.x, z: e0.z } : { x: e0.x, z: s1.z };
      for (let k = 1; k <= 5; k++) {
        const t = k / 6;
        const u = 1 - t;
        pts.push({ x: u * u * e0.x + 2 * u * t * c.x + t * t * s1.x, z: u * u * e0.z + 2 * u * t * c.z + t * t * s1.z });
      }
    }
    pts.push(s1, e1);
    r.path = pts;
  }

  private segLen(r: Rider, i: number): number {
    const a = r.path[i];
    const b = r.path[i + 1];
    return Math.hypot(b.x - a.x, b.z - a.z) || 0.001;
  }

  /** Position from the path parameter and swerve. */
  private place(r: Rider): void {
    const a = r.path[r.seg];
    const b = r.path[r.seg + 1];
    const len = this.segLen(r, r.seg);
    const d = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    const c = curbVec(d);
    const t = Math.min(r.along / len, 1);
    r.pos.x = a.x + (b.x - a.x) * t + c.x * r.swerve;
    r.pos.z = a.z + (b.z - a.z) * t + c.z * r.swerve;
  }

  /** Point `dist` meters further along the path (no swerve). */
  private ahead(r: Rider, dist: number): Vec2 {
    let i = r.seg;
    let s = r.along + dist;
    while (i < r.path.length - 2 && s > this.segLen(r, i)) {
      s -= this.segLen(r, i);
      i++;
    }
    const a = r.path[i];
    const b = r.path[i + 1];
    const t = s / this.segLen(r, i);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Meters to this lane's stop line (curb side), or -1 past it. */
  private distToStop(r: Rider): number {
    return r.seg === 0 ? this.segLen(r, 0) - r.along : -1;
  }

  private mustStop(r: Rider, dStop: number): boolean {
    if (dStop < 0) return false;
    const w = this.world;
    const node = w.city.nodes[r.lane.to];
    const st = w.lights.state(node.id, r.lane.edgeId);
    if (st === 'red') return true;
    if (st === 'yellow') return dStop > (r.speed * r.speed) / 6 + 0.5;
    if (r.turn !== 'straight' && r.turn !== EASY_TURN && dStop < 20) {
      // Crossing turn (dead ends only): wait for a gap in oncoming traffic
      const d0 = r.lane.dir;
      for (const o of w.cars) {
        const rel = { x: o.pos.x - node.pos.x, z: o.pos.z - node.pos.z };
        const along = dot(rel, d0);
        if (along > -8 && along < 45 && Math.abs(dot(rel, leftVec(d0))) < 8 && dot(o.vel, d0) < -2) return true;
      }
    }
    return false;
  }

  /** Gap to the nearest car or rider in the rider's corridor ahead, its speed along our heading, and whether it's a stopped car. */
  private leader(r: Rider, f: Vec2): { gap: number; v: number; stoppedCar: boolean } {
    const l = leftVec(f);
    let gap = Infinity;
    let v = 0;
    let stoppedCar = false;
    for (const o of this.world.cars) {
      if (o.removed) continue;
      const rx = o.pos.x - r.pos.x;
      const rz = o.pos.z - r.pos.z;
      const reach = 30 + o.halfL;
      if (rx * rx + rz * rz > reach * reach) continue;
      const g = corridorGap(r.pos, f, RIDER_HALF_W + 0.1, o);
      if (g < gap) {
        gap = g;
        v = dot(o.vel, f);
        stoppedCar = o.speed < 0.5;
      }
    }
    for (const o of this.world.riders) {
      if (o === r) continue;
      const rel = { x: o.pos.x - r.pos.x, z: o.pos.z - r.pos.z };
      const along = dot(rel, f);
      if (along <= 0 || along > 25 || Math.abs(dot(rel, l)) > RIDER_HALF_W * 2 + 0.1) continue;
      const g = along - RIDER_HALF_L * 2;
      if (g < gap) {
        gap = g;
        v = dot(o.vel, f);
        stoppedCar = false;
      }
    }
    return { gap, v, stoppedCar };
  }

  private ride(r: Rider, dt: number): void {
    const w = this.world;
    const f = fwd(r.heading);
    // Target speed: cruise, slower up hills / through turns / while dodging
    const h0 = w.city.terrain.heightAt(r.pos.x, r.pos.z);
    const grade = w.city.terrain.heightAt(r.pos.x + f.x, r.pos.z + f.z) - h0;
    let v0 = r.cruise * clamp(1 - grade * (r.kind === 'bicycle' ? 4 : 1.5), 0.45, 1.25);
    const dStop = this.distToStop(r);
    if (r.turn !== 'straight' && (r.seg > 0 || dStop < 12)) v0 = Math.min(v0, r.kind === 'bicycle' ? 3.2 : 5);
    if (Math.abs(r.swerve) > 0.4) v0 *= 0.6;
    if (r.brakeT > 0) v0 = 0;

    const lead = this.leader(r, f);
    let gap = lead.gap;
    let vLead = lead.v;
    r.waiting = gap < 6 ? 'traffic' : 'none';
    // Stuck behind a stopped car (double-parked, or waiting to turn across us): ride around it
    if (lead.stoppedCar && gap < 2.5 && r.speed < 0.3) r.blockedT += dt;
    else r.blockedT = Math.max(0, r.blockedT - dt);
    if (r.blockedT > GO_AROUND_AFTER && r.swerveHold <= 0) {
      const n = curbVec(pathDir(r));
      const curbRoom = w.statics.rayDistance(r.pos, n, 3);
      r.swerveTarget = curbRoom > 1.6 ? 1.3 : -1.8;
      r.swerveHold = 3;
      r.blockedT = 0;
    }
    if (this.mustStop(r, dStop)) {
      const g = dStop - RIDER_HALF_L - 0.3;
      if (g < gap) {
        gap = g;
        vLead = 0;
        r.waiting = 'light';
      }
    }
    const aMax = r.kind === 'bicycle' ? 1.2 : 2;
    const v = r.speed;
    let acc: number;
    if (gap === Infinity) acc = aMax * (1 - (v / Math.max(v0, 0.1)) ** 4);
    else {
      const sStar = 1.2 + v * 0.9 + (v * (v - vLead)) / (2 * Math.sqrt(aMax * 2.5));
      acc = gap <= 0.1 ? -8 : aMax * (1 - (v / Math.max(v0, 0.1)) ** 4 - (Math.max(0, sStar) / gap) ** 2);
    }
    if (v0 === 0) acc = Math.min(acc, -6);
    r.speed = clamp(v + Math.max(acc, -7) * dt, 0, 14);
    r.braking = acc < -0.8 && r.speed > 0.2;

    // Advance along the path; switch lanes at the far side of the junction
    r.along += r.speed * dt;
    while (r.seg < r.path.length - 2 && r.along > this.segLen(r, r.seg)) {
      r.along -= this.segLen(r, r.seg);
      r.seg++;
    }
    if (r.seg >= r.path.length - 2) {
      r.lane = r.next;
      this.chooseNext(r);
      this.buildPath(r);
      r.seg = 0;
    }
    if (r.along > this.segLen(r, r.seg)) r.along = this.segLen(r, r.seg);

    // Swerve toward its goal, then ease back to the line once the danger has passed
    if (r.swerveHold > 0) r.swerveHold -= dt;
    else {
      r.swerveTarget *= Math.max(0, 1 - dt * 1.2);
      r.dodgeSide = 0;
      r.swerveRate = 0;
    }
    const rate = Math.max(r.kind === 'bicycle' ? 3.2 : 4.2, r.swerveRate) * dt;
    r.swerve += clamp(r.swerveTarget - r.swerve, -rate, rate);
    if (r.brakeT > 0) r.brakeT -= dt;
    this.place(r);

    // Heading toward a point a little ahead (smooths corners and swerves); lean into the curve
    const look = this.ahead(r, 2.4);
    const c = curbVec(fwd(r.heading));
    const tx = look.x + c.x * r.swerveTarget - r.pos.x;
    const tz = look.z + c.z * r.swerveTarget - r.pos.z;
    const prevH = r.heading;
    if (tx * tx + tz * tz > 0.01) r.heading += wrapAngle(Math.atan2(tx, tz) - r.heading) * Math.min(1, dt * 8);
    const yawRate = wrapAngle(r.heading - prevH) / dt;
    r.lean += (clamp(Math.atan((r.speed * yawRate) / 9.81), -0.45, 0.45) - r.lean) * Math.min(1, dt * 6);
    r.vel.x = (r.pos.x - r.prev.x) / dt;
    r.vel.z = (r.pos.z - r.prev.z) / dt;
    r.phase += (r.speed * dt) / (r.kind === 'bicycle' ? 0.55 : 0.3);

    if (r.speed < 0.3 && r.waiting === 'none') r.stuck += dt;
    else if (r.speed < 0.3 && r.waiting === 'traffic') r.stuck += dt * 0.3;
    else r.stuck = Math.max(0, r.stuck - dt * 2);
  }

  update(dt: number): void {
    const w = this.world;
    const pp = w.player.pos;
    for (const r of w.riders) {
      r.prev.x = r.pos.x;
      r.prev.z = r.pos.z;
      r.prevHeading = r.heading;
      const d = Math.hypot(r.pos.x - pp.x, r.pos.z - pp.z);
      if (d > DESPAWN || (r.stuck > 15 && d > 45) || w.city.terrain.waterAt(r.pos.x, r.pos.z) !== null) {
        this.despawn(r);
        continue;
      }
      this.ride(r, dt);
    }
    if (w.riders.some((r) => !r.active)) w.riders = w.riders.filter((r) => r.active);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.3;
      if (this.count < this.target) this.trySpawn(SPAWN_MIN);
    }
  }
}
