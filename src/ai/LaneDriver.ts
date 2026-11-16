import { CONFIG } from '../config';
import { clamp, dot, fwd, leftOf, leftVec } from '../core/math';
import type { Walker, World } from '../core/World';
import type { Lane, RoadNode, TurnType, Vec2 } from '../types';
import type { Blinker, Car } from '../vehicles/Car';
import { pointAt } from '../world/Polyline';
import { RIDER_HALF_L, RIDER_HALF_W } from './Rider';

/** Turn across oncoming traffic, and the one that keeps to the curb side. */
export const HARD_TURN: TurnType = CONFIG.DRIVE_SIDE === 'left' ? 'right' : 'left';
export const EASY_TURN: TurnType = CONFIG.DRIVE_SIDE === 'left' ? 'left' : 'right';
/** Side gap kept when passing a bicycle / scooter, and the most a car moves over in its lane to get it. */
const PASS_GAP = 0.45;
const NUDGE_MAX = 0.75;
/** Passing a rider: at most this much faster than it (m/s). */
const PASS_DELTA = 6;
/** Which way the curb is from the lane line (offset + = left). */
const CURB_SIDE = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;
const CURB_BLINKER: Blinker = CONFIG.DRIVE_SIDE === 'left' ? 'left' : 'right';

/** Going through on amber only if the stop line is less than this many seconds away (yellow lasts 3 s). */
const AMBER_REACH = 2.1;
/** Look-ahead times (s) for pedestrians on the road: now, and where they are walking to. */
const PED_LOOK = [0, 0.75, 1.5];
const PED_AHEAD = PED_LOOK[PED_LOOK.length - 1];

/**
 * Pedestrians any driver might have to stop for this step: out on the road, or walking onto it within the
 * look-ahead. Built once per step (by sim time) and shared by every driver, so each car only checks a few.
 */
const roadPeds: Walker[] = [];
let roadPedsAt = NaN;
function pedsOnRoad(world: World): Walker[] {
  if (world.time === roadPedsAt) return roadPeds;
  roadPedsAt = world.time;
  roadPeds.length = 0;
  for (const p of world.pedestrians) {
    if (!p.active) continue;
    if (p.onRoad || ((p.vel.x !== 0 || p.vel.z !== 0) && world.city.roadAt({ x: p.pos.x + p.vel.x * PED_AHEAD, z: p.pos.z + p.vel.z * PED_AHEAD })))
      roadPeds.push(p);
  }
  return roadPeds;
}

/** Live-tunable driver behavior (Debug "Traffic AI" folder). */
export const DRIVER_TUNING = {
  /** Pedestrians out on the road this close to the path's line (beyond the car's half width) are waited for (m). */
  pedClear: 1.4,
  /** Stop this far short of a pedestrian (m). */
  pedGap: 1.6,
  /** Signal a turn this far before the stop line (m). */
  signalAt: 38,
  /** Pull over for a siren closing from behind within this distance (m); how far over (m), speed while yielding (x limit). */
  sirenRange: 55,
  yieldNudge: 1.1,
  yieldSpeed: 0.4,
  /** Swerve toward the curb when a car comes head-on in our lane, this many seconds from impact; how far (m). */
  evadeTime: 2.5,
  evadeNudge: 1.35,
  /** Reaction time before pulling away from a standstill (s), for the calmest drivers (pushy ones are ~40% quicker). */
  launchMin: 0.25,
  launchMax: 0.85,
};

/** The driver of each AI car, so opposing turners can settle who goes first (see `passesOpposingTurner`). */
const DRIVER_OF = new WeakMap<Car, LaneDriver>();

/** All-way stops (ARRÊT at every approach): stop at the line, then first stopped, first through. */
export const STOP_TUNING = {
  /** Counts as stopped below this (m/s): calm drivers. The pushiest roll it at `rollSpeed`, a Montreal stop. */
  stopSpeed: 0.6,
  rollSpeed: 1.8,
  /** Seconds at the line before going, calm .. pushy. */
  dwellMax: 0.9,
  dwellMin: 0.3,
  /** At the line: within this of where the car settles behind the stop line (m). */
  reach: 1.6,
  /** A car let through that has not got into the junction after this long goes back to waiting (s). */
  goneTimeout: 6,
};

/** One car at an all-way stop: waiting since `since`, or let through (`going`) at `goneAt`. */
interface StopEntry {
  driver: LaneDriver;
  /** The approach lane it stopped in. */
  lane: number;
  since: number;
  going: boolean;
  goneAt: number;
}

/** Who is at each stop junction, per world (the soak builds several worlds in one process). */
const STOP_QUEUES = new WeakMap<World, Map<number, StopEntry[]>>();

/** Look into the junction for a stranded car this far before the stop line (m), and what counts as stranded (m/s). */
const BOX_LOOK = 14;
const BOX_STUCK_SPEED = 2.5;

export interface NextLeg {
  lane: Lane;
  turn: TurnType;
}

/**
 * Curb-side turns: swing this far away from the corner (still inside the lane) on the way in, end this far off
 * the middle of the new lane (not more: a car turning across from the other side may be entering the lane
 * beside it), on this radius (m).
 */
const CURB_SWING = 0.8;
const CURB_EXIT = 0.2;
const CURB_RADIUS = 4.6;

/**
 * The path of a curb-side turn (the rear axle follows it). Lanes run ~2 m from a square curb corner, too close
 * to go round on any radius a car can steer, so: drift out toward the lane's far side after the stop line, take
 * a true circular arc tangent to that line and to the next lane's (barely offset), and ease into its middle. Returns
 * the points after `l.end` up to the arc's end, and the next lane's remaining line; null where it doesn't fit.
 */
function curbTurn(l: Lane, n: Lane, side: 1 | -1): { pts: Vec2[]; tail: Vec2[] } | null {
  const d0 = l.endDir;
  const d1 = n.dir;
  const cos = clamp(dot(d0, d1), -1, 1);
  const theta = Math.acos(cos);
  if (theta < 0.5 || theta > 2.6) return null;
  // The two lane lines moved away from the corner, and where they cross
  const o0 = leftVec(d0);
  const o1 = leftVec(d1);
  const a0 = { x: l.end.x - o0.x * side * CURB_SWING, z: l.end.z - o0.z * side * CURB_SWING };
  const a1 = { x: n.start.x - o1.x * side * CURB_EXIT, z: n.start.z - o1.z * side * CURB_EXIT };
  const den = d0.x * d1.z - d0.z * d1.x;
  const t = ((a1.x - a0.x) * d1.z - (a1.z - a0.z) * d1.x) / den;
  const c = { x: a0.x + d0.x * t, z: a0.z + d0.z * t };
  // Keep a few meters after the stop line to drift out (a tighter arc if the junction is small)
  const half = Math.tan(theta / 2);
  const R = Math.min(CURB_RADIUS, (t - 2.5) / half);
  if (R < 3.6) return null;
  const tl = R * half;
  const t0 = { x: c.x - d0.x * tl, z: c.z - d0.z * tl };
  const into = dot({ x: c.x + d1.x * tl - n.start.x, z: c.z + d1.z * tl - n.start.z }, d1);
  const back = into + 5;
  if (n.length < back + 3) return null;
  const o = { x: t0.x + o0.x * side * R, z: t0.z + o0.z * side * R };
  const pts: Vec2[] = [t0];
  const a = Math.atan2(t0.z - o.z, t0.x - o.x);
  // The radius vector turns with the heading; `leftVec` is a clockwise quarter turn in atan2(z, x) terms
  const sweep = -theta * side;
  for (let k = 1; k <= 6; k++) {
    const ang = a + (sweep * k) / 6;
    pts.push({ x: o.x + Math.cos(ang) * R, z: o.z + Math.sin(ang) * R });
  }
  const join = pointAt(n.pts, n.cum, back);
  return { pts, tail: [join, ...n.pts.filter((_, i) => n.cum[i] > back + 0.5)] };
}

export function turnType(d0: Vec2, d1: Vec2): TurnType {
  const s = dot(d1, leftVec(d0));
  if (s > 0.5) return 'left';
  if (s < -0.5) return 'right';
  return 'straight';
}

/** Lane-following AI that obeys signals, keeps distance (IDM) and yields on crossing turns. */
export class LaneDriver {
  lane: Lane;
  next!: NextLeg;
  path: Vec2[] = [];
  seg = 0;
  speedMul: number;
  /** Speed through turns (m/s) and comfortable acceleration (m/s^2): lower for trucks. */
  turnSpeed = 6.5;
  aMax = 2.2;
  stuckTime = 0;
  /** Sideways offset from the lane line (+ = left), eased toward the nudge needed to pass riders. */
  offset = 0;
  /** Latest reason the car is stopped (for debugging / police). */
  waiting: 'none' | 'light' | 'traffic' = 'none';
  /**
   * Personality, 0 (calm) .. 1 (pushy): pushy drivers run a little faster, follow closer, pull away sooner
   * and go through later ambers.
   */
  readonly temper: number;
  /** Time headway kept to the car ahead (s). */
  private headway: number;
  /** Was holding at a standstill last step; reaction time left before pulling away. */
  private held = false;
  private launchT = 0;
  /** Seconds left pulled over for a siren behind / swerving from a car coming head-on in our lane. */
  private yieldT = 0;
  private evadeT = 0;
  /** What the driver is reacting to right now (debug overlay). */
  mood: 'cruise' | 'yield' | 'evade' | 'ped' = 'cruise';
  /**
   * Route choice (the player's autopilot): picks the leg to take at the next junction among the allowed ones,
   * or null for the usual random pick. Unset for traffic.
   */
  prefer: ((opts: NextLeg[]) => NextLeg | null) | null = null;
  /** Extra speed cap (m/s), e.g. slowing to turn into a car park. */
  speedCap = Infinity;
  /** Run the lights (and the ARRÊT signs). A speeder still brakes for the car in front. */
  ignoreLights = false;
  /** Lane id this car was let through an all-way stop from (-1: none). */
  private clearedLane = -1;
  /** Blinker held on regardless of the route (pulling over). */
  forceBlinker: Blinker | null = null;

  constructor(
    private world: World,
    readonly car: Car,
    lane: Lane,
  ) {
    this.lane = lane;
    DRIVER_OF.set(car, this);
    this.temper = world.rng.next();
    this.speedMul = 0.86 + 0.16 * this.temper + world.rng.range(-0.03, 0.03);
    this.headway = 1.45 - 0.55 * this.temper;
    this.chooseNext();
    this.buildPath();
    this.seg = 0;
  }

  /** Re-attach to the nearest lane (after a pursuit etc.). */
  reattach(): void {
    const hit = this.world.city.nearestLanePoint(this.car.pos);
    this.lane = hit.lane;
    this.offset = 0;
    this.yieldT = 0;
    this.evadeT = 0;
    this.held = false;
    this.launchT = 0;
    this.clearedLane = -1;
    this.car.blinker = null;
    this.chooseNext();
    this.buildPath();
    this.seg = 0;
  }

  /** Pick the next junction leg again (after `prefer` changes its mind), unless it's too close to change. */
  replan(): void {
    if (this.pastLane || this.distToStopLine() < 30) return;
    this.chooseNext();
    this.buildPath();
  }

  private chooseNext(): void {
    const city = this.world.city;
    const rng = this.world.rng;
    const node = city.nodes[this.lane.to];
    const edge = city.edges[this.lane.edgeId];
    const opts: { lane: Lane; turn: TurnType; w: number }[] = [];
    for (const eid of node.edges) {
      if (eid === edge.id) continue;
      const e = city.edges[eid];
      const leaving = city.lanesLeaving(e, node.id);
      // One-way roads have no lanes leaving at their far end
      if (leaving.length === 0) continue;
      const d1 = city.lanes[leaving[0]].dir;
      const turn = turnType(this.lane.endDir, d1);
      if (edge.lanesPerDir > 1) {
        // Turn from the lane next to it: the curb-side turn from the curb lane, the crossing turn from the inner
        // lane. A boulevard's middle lanes go straight (turning from one would cut across the lane beside it).
        const inner = this.lane.index === 0;
        const curb = this.lane.index === edge.lanesPerDir - 1;
        if (!curb && turn === EASY_TURN) continue;
        if (!inner && turn === HARD_TURN) continue;
      }
      const idx = turn === 'straight' ? Math.min(this.lane.index, leaving.length - 1) : turn === EASY_TURN ? leaving.length - 1 : 0;
      opts.push({ lane: city.lanes[leaving[idx]], turn, w: turn === 'straight' ? 1.4 : 1 });
    }
    if (opts.length === 0) {
      // dead end fallback: allow anything
      for (const eid of node.edges) {
        if (eid === edge.id) continue;
        const e = city.edges[eid];
        const ids = city.lanesLeaving(e, node.id);
        if (ids.length === 0) continue;
        const l = city.lanes[ids[0]];
        opts.push({ lane: l, turn: turnType(this.lane.endDir, l.dir), w: 1 });
      }
    }
    const preferred = this.prefer?.(opts);
    if (preferred) {
      this.next = { lane: preferred.lane, turn: preferred.turn };
      return;
    }
    const total = opts.reduce((s, o) => s + o.w, 0);
    let r = rng.next() * total;
    for (const o of opts) {
      r -= o.w;
      if (r <= 0) {
        this.next = { lane: o.lane, turn: o.turn };
        return;
      }
    }
    this.next = { lane: opts[0].lane, turn: opts[0].turn };
  }

  /** First path segment on the next lane (where `advance` switches lanes); set by `buildPath`. */
  private joinSeg = 0;

  private buildPath(): void {
    const l = this.lane;
    const n = this.next.lane;
    // T37: the lane's own line (two points on straight roads), the junction connector, then the next lane
    const pts: Vec2[] = [...l.pts];
    let tail = n.pts;
    if (this.next.turn !== 'straight') {
      // Corner: where the two lane lines cross
      const d0 = l.endDir;
      const d1 = n.dir;
      const den = d0.x * d1.z - d0.z * d1.x;
      let c: Vec2;
      if (Math.abs(den) > 0.2) {
        const t = ((n.start.x - l.end.x) * d1.z - (n.start.z - l.end.z) * d1.x) / den;
        c = { x: l.end.x + d0.x * t, z: l.end.z + d0.z * t };
      } else c = Math.abs(d0.x) > 0.5 ? { x: n.start.x, z: l.end.z } : { x: l.end.x, z: n.start.z };
      const curb = this.next.turn === EASY_TURN ? curbTurn(l, n, this.next.turn === 'left' ? 1 : -1) : null;
      if (curb) {
        pts.push(...curb.pts);
        tail = curb.tail;
      } else {
        for (let k = 1; k <= 5; k++) {
          const t = k / 6;
          const u = 1 - t;
          pts.push({
            x: u * u * l.end.x + 2 * u * t * c.x + t * t * n.start.x,
            z: u * u * l.end.z + 2 * u * t * c.z + t * t * n.start.z,
          });
        }
      }
    }
    this.joinSeg = pts.length;
    pts.push(...tail);
    this.path = pts;
  }

  /** Path segments of the current lane (it ends at the stop line): segments from here on are the junction. */
  private get laneSegs(): number {
    return this.lane.pts.length - 1;
  }

  /** Past the stop line: in the junction connector (the next lane switches in at `nextLaneSeg`). */
  private get pastLane(): boolean {
    return this.seg >= this.laneSegs;
  }

  /** Index of the path segment where the next lane takes over (its start, or a bit past it after a curb-side turn). */
  private get nextLaneSeg(): number {
    return this.joinSeg;
  }

  private advance(): void {
    const p = this.car.pos;
    while (this.seg < this.path.length - 2) {
      const a = this.path[this.seg];
      const b = this.path[this.seg + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1);
      if (t < 1) break;
      this.seg++;
    }
    if (this.seg >= this.nextLaneSeg) {
      this.lane = this.next.lane;
      // A turn at a stop is for this pass only: a car looping the block meets the same lane again
      this.clearedLane = -1;
      this.chooseNext();
      this.buildPath();
      this.seg = 0;
    }
  }

  /** Point `dist` meters ahead along the path from the car's projection. */
  private lookahead(dist: number): Vec2 {
    const p = this.car.pos;
    let a = this.path[this.seg];
    let b = this.path[this.seg + 1];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    let segLen = Math.hypot(dx, dz) || 1;
    let t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (segLen * segLen), 0, 1);
    let remaining = dist + t * segLen;
    let i = this.seg;
    while (remaining > segLen && i < this.path.length - 2) {
      remaining -= segLen;
      i++;
      a = this.path[i];
      b = this.path[i + 1];
      dx = b.x - a.x;
      dz = b.z - a.z;
      segLen = Math.hypot(dx, dz) || 1;
    }
    t = Math.min(remaining / segLen, 1.5);
    return { x: a.x + dx * t, z: a.z + dz * t };
  }

  distToStopLine(): number {
    if (this.pastLane) return -1;
    // along the current segment to its end, then the rest of the lane (T37: lanes can bend)
    const i = this.seg;
    const a = this.path[i];
    const b = this.path[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const along = dot({ x: b.x - this.car.pos.x, z: b.z - this.car.pos.z }, { x: (b.x - a.x) / segLen, z: (b.z - a.z) / segLen });
    return along + this.lane.cum[this.laneSegs] - this.lane.cum[i + 1];
  }

  /** Took its turn at the all-way stop it is driving through (soak: a crossing without it is a stop run). */
  get stopCleared(): boolean {
    return this.clearedLane === this.lane.id;
  }

  private mustStopForSignal(dStop: number, v: number): boolean {
    if (this.ignoreLights || dStop < 0) return false;
    const city = this.world.city;
    const node = city.nodes[this.lane.to];
    if (node.control === 'stop' && this.clearedLane !== this.lane.id && this.holdAtStop(node, dStop, v)) return true;
    const st = this.world.lights.state(node.id, this.lane.edgeId);
    if (st === 'red') return dStop > -0.5;
    // Amber: stop if it can be done braking at this driver's comfort level (pushy drivers go through later),
    // or if the line is too far to reach before red anyway (a slow turning car would enter on red)
    if (st === 'yellow') return dStop > (v * v) / (2 * (4.5 - 1.2 * this.temper)) + 1 || dStop > v * AMBER_REACH;
    if (dStop < BOX_LOOK && this.boxBlocked(node)) return true;
    if (this.next.turn === HARD_TURN && dStop < 30) return this.oncomingTraffic(node.pos);
    return false;
  }

  /**
   * All-way stop: come to a stop at the line, wait a moment, then go in the order cars stopped. Cars from the
   * opposite approach that both go straight or turn to the curb may go together; anything crossing waits for
   * the junction to clear. Returns true while this car must hold at the line.
   */
  private holdAtStop(node: RoadNode, dStop: number, v: number): boolean {
    const T = STOP_TUNING;
    const settle = this.car.halfL + 0.5 + 2.2; // where the IDM parks the car behind the virtual leader at the line
    const pushy = this.temper ** 3;
    if (dStop > settle + T.reach || v > T.stopSpeed + (T.rollSpeed - T.stopSpeed) * pushy) return true;
    const now = this.world.time;
    const q = this.stopQueue(node.id);
    let me = q.find((e) => e.driver === this);
    if (!me) {
      me = { driver: this, lane: this.lane.id, since: now, going: false, goneAt: 0 };
      q.push(me);
    }
    if (now - me.since < T.dwellMax - (T.dwellMax - T.dwellMin) * this.temper) return true;
    for (const e of q) {
      if (e === me) continue;
      if (e.going ? !this.stopsCompatible(e.driver) : e.since < me.since || (e.since === me.since && e.driver.car.id < this.car.id)) return true;
    }
    if (this.stopBoxBusy(node, q)) return true;
    me.going = true;
    me.goneAt = now;
    this.clearedLane = this.lane.id;
    return false;
  }

  /** The queue at a stop junction, with cars gone through, despawned or stalled after their turn sorted out. */
  private stopQueue(nodeId: number): StopEntry[] {
    let byNode = STOP_QUEUES.get(this.world);
    if (!byNode) STOP_QUEUES.set(this.world, (byNode = new Map()));
    let q = byNode.get(nodeId);
    if (!q) byNode.set(nodeId, (q = []));
    const now = this.world.time;
    for (let i = q.length - 1; i >= 0; i--) {
      const e = q[i];
      const d = e.driver;
      if (d.car.removed || DRIVER_OF.get(d.car) !== d || d.lane.id !== e.lane || d.ignoreLights) {
        q.splice(i, 1);
      } else if (e.going && !d.pastLane && d.car.speed < 0.5 && now - e.goneAt > STOP_TUNING.goneTimeout) {
        // Let through but stuck behind traffic on the far side: back in line, so the cross street can move
        e.going = false;
        e.since = now;
        d.clearedLane = -1;
      }
    }
    return q;
  }

  /**
   * Taking our turn at a stop, a car standing at another line of the same junction is waiting for us to clear:
   * it is behind its own line, not in our way, even when the turn briefly points our nose at it (on a narrow
   * street the car at the far line sits right beside the lane we turn into).
   */
  private waitsForMyTurn(o: Car): boolean {
    if (this.clearedLane !== this.lane.id || o.speed > 0.5) return false;
    const od = DRIVER_OF.get(o);
    if (!od || od.car !== o) return false;
    const q = STOP_QUEUES.get(this.world)?.get(this.lane.to);
    return !!q?.some((e) => e.driver === od && !e.going);
  }

  /** Both cars can be in the junction at once: opposite approaches, neither turning across the other. */
  private stopsCompatible(o: LaneDriver): boolean {
    if (this.next.turn === HARD_TURN || o.next.turn === HARD_TURN) return false;
    return dot(o.lane.endDir, this.lane.endDir) < -0.7;
  }

  /**
   * Any car in the junction that is not a compatible car taking its turn: the player, a chase, or someone
   * stopped half way across (for a ped, say). Going in beside a stopped one is how two cars end up nose to
   * nose in the box, each waiting for the other.
   */
  private stopBoxBusy(node: RoadNode, q: StopEntry[]): boolean {
    const city = this.world.city;
    for (const o of this.world.cars) {
      if (o === this.car || o.removed || o.kind === 'parked') continue;
      if (Math.abs(o.pos.x - node.pos.x) > node.hx + 2 || Math.abs(o.pos.z - node.pos.z) > node.hz + 2) continue;
      if (city.nodeBoxAt(o.pos, 1) !== node) continue;
      const od = DRIVER_OF.get(o);
      if (od && q.some((e) => e.driver === od && e.going) && this.stopsCompatible(od)) continue;
      return true;
    }
    return false;
  }

  /**
   * Don't block the box: a car still in the junction from the last phase (a turner that waited for a bike, a
   * car nosing out of a queue) and sitting on our way through it. Entering anyway is how two turners end up
   * nose to nose waiting on each other, which the tighter Montreal lanes made easy. Cars going our way are
   * left to the following logic.
   */
  private boxBlocked(node: RoadNode): boolean {
    const city = this.world.city;
    const f = fwd(this.car.yaw);
    for (const o of this.world.cars) {
      if (o === this.car || o.removed || o.speed > BOX_STUCK_SPEED) continue;
      if (Math.abs(o.pos.x - node.pos.x) > node.hx + 2 || Math.abs(o.pos.z - node.pos.z) > node.hz + 2) continue;
      if (city.nodeBoxAt(o.pos, 1) !== node || dot(fwd(o.yaw), f) > 0.5) continue;
      const q = this.onPath(o.pos);
      if (q.s > 0 && Math.abs(q.lat) < this.car.halfW + o.halfW + 0.5) return true;
    }
    return false;
  }

  /**
   * Two cars turning across traffic from opposite approaches meet in the middle of the junction and pass
   * driver side to driver side. On Montreal's narrower lanes each one's path runs close enough to the other to
   * read as blocked, and both would wait forever: the lower car id goes first, as long as the other is clear
   * of its path; the other keeps waiting for it.
   */
  private passesOpposingTurner(o: Car): boolean {
    if (this.next.turn !== HARD_TURN || o.id < this.car.id) return false;
    const od = DRIVER_OF.get(o);
    if (!od || od.car !== o || od.next.turn !== HARD_TURN || !od.pastLane) return false;
    if (od.lane.to !== this.lane.to || dot(od.lane.endDir, this.lane.endDir) > -0.5) return false;
    return Math.abs(this.onPath(o.pos).lat) >= this.car.halfW + o.halfW + 0.15;
  }

  private oncomingTraffic(nodePos: Vec2): boolean {
    const d0 = this.lane.endDir;
    // Every oncoming lane, out to the far curb: a fixed 8 m missed the outer lane of a boulevard
    const reach = this.world.city.edges[this.lane.edgeId].width / 2 + 2;
    for (const o of this.world.cars) {
      if (o === this.car || o.removed) continue;
      const rel = { x: o.pos.x - nodePos.x, z: o.pos.z - nodePos.z };
      const ahead = dot(rel, d0);
      // A fast car is a threat from further out: the turn from the line takes about 4.5 s to clear
      const closing = -dot(o.vel, d0);
      if (ahead < -8 || ahead > Math.max(45, closing * 4.5)) continue;
      if (Math.abs(dot(rel, leftVec(d0))) > reach) continue;
      if (closing > 2) return true;
    }
    for (const r of this.world.riders) {
      const rel = { x: r.pos.x - nodePos.x, z: r.pos.z - nodePos.z };
      const ahead = dot(rel, d0);
      if (ahead > -8 && ahead < 35 && Math.abs(dot(rel, leftVec(d0))) < 8 && dot(r.vel, d0) < -1) return true;
    }
    return false;
  }

  /**
   * Where a point sits relative to this car's path (lane, junction, next lane): distance along it from the car
   * (negative = behind), signed offset from the line (+ = left) and whether that bit of path is a turn.
   */
  private onPath(p: Vec2): { s: number; lat: number; curve: boolean; ux: number; uz: number } {
    const car = this.car.pos;
    let best = { s: 0, lat: Infinity, curve: false, ux: 0, uz: 1 };
    let bestD = Infinity;
    let acc = 0;
    for (let i = this.seg; i < this.path.length - 1 && acc < 45; i++) {
      const a = this.path[i];
      const b = this.path[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      if (i === this.seg) acc = -((car.x - a.x) * ux + (car.z - a.z) * uz);
      const t = clamp((p.x - a.x) * ux + (p.z - a.z) * uz, 0, len);
      const qx = p.x - a.x - ux * t;
      const qz = p.z - a.z - uz * t;
      const d = qx * qx + qz * qz;
      if (d < bestD) {
        bestD = d;
        best = { s: acc + t, lat: qx * uz - qz * ux, curve: this.next.turn !== 'straight' && i >= this.laneSegs && i < this.nextLaneSeg, ux, uz };
      }
      acc += len;
    }
    return best;
  }

  /**
   * Bicycles / scooters near the car's path: pass them with a nudge to the side (and not much faster than
   * them) once there is room, else follow them (no room, in a turn: no cutting across a rider).
   */
  private scanRiders(f: Vec2, turning: boolean): { gap: number; vLead: number; nudge: number; pass: number } {
    const car = this.car;
    const out = { gap: Infinity, vLead: 0, nudge: 0, pass: Infinity };
    if (!this.world.riders.length) return out;
    const need = car.halfW + RIDER_HALF_W + PASS_GAP;
    const touch = car.halfW + RIDER_HALF_W + 0.2;
    let carLat: number | null = null;
    for (const r of this.world.riders) {
      if (Math.abs(r.pos.x - car.pos.x) > 40 || Math.abs(r.pos.z - car.pos.z) > 40) continue;
      const q = this.onPath(r.pos);
      if (q.s < -car.halfL - RIDER_HALF_L || q.s > 35 || Math.abs(q.lat) >= need) continue;
      const nudge = q.lat > 0 ? q.lat - need : q.lat + need;
      const conflict = out.nudge !== 0 && Math.sign(nudge) !== Math.sign(out.nudge);
      const canPass = !turning && !q.curve && !conflict && Math.abs(nudge) <= NUDGE_MAX;
      if (canPass) {
        if (Math.abs(nudge) > Math.abs(out.nudge)) out.nudge = nudge;
        out.pass = Math.min(out.pass, r.speed);
      }
      carLat ??= this.onPath(car.pos).lat;
      const clearNow = Math.abs(q.lat - carLat) >= touch;
      // Ahead of the nose: follow until there is room; beside the front half while turning: wait if really close
      const ahead = q.s > car.halfL;
      const follow = ahead ? !canPass || !clearNow : !canPass && !clearNow && q.s > -car.halfL * 0.5;
      if (follow) {
        const g = Math.max(0.05, q.s - car.halfL - RIDER_HALF_L);
        if (g < out.gap) {
          out.gap = g;
          out.vLead = dot(r.vel, f);
        }
      }
    }
    return out;
  }

  /**
   * Pedestrians out on the road on or near the path ahead (a crosswalk the car turns across, someone getting up
   * after diving out of the player's way): returns the gap to stop short of the nearest one.
   */
  private scanPeds(): number {
    const car = this.car;
    const reach = car.halfW + DRIVER_TUNING.pedClear;
    let gap = Infinity;
    const city = this.world.city;
    for (const p of pedsOnRoad(this.world)) {
      const moving = Math.abs(p.vel.x) + Math.abs(p.vel.z) > 0.3;
      if (Math.abs(p.pos.x - car.pos.x) > 30 || Math.abs(p.pos.z - car.pos.z) > 30) continue;
      // where they are, and where they are walking to over the next second and a half (someone stepping
      // off the curb into the crosswalk a turning car is about to cross), projected along the path's line;
      // only points out on the road count
      const q = this.onPath(p.pos);
      const vs = p.vel.x * q.ux + p.vel.z * q.uz;
      const vl = p.vel.x * q.uz - p.vel.z * q.ux;
      for (const t of PED_LOOK) {
        if (t > 0 && !moving) break;
        const sAt = q.s + vs * t;
        // beside the car's tail they are no longer in the way (they wait for the car to pass, see Pedestrians)
        if (sAt < car.halfL * 0.6 || sAt > 28 || Math.abs(q.lat + vl * t) > reach) continue;
        if (t === 0 ? !p.onRoad : !city.roadAt({ x: p.pos.x + p.vel.x * t, z: p.pos.z + p.vel.z * t })) continue;
        gap = Math.min(gap, Math.max(0.05, sAt - car.halfL - DRIVER_TUNING.pedGap));
        break;
      }
    }
    return gap;
  }

  /** A siren closing from behind in this direction of travel. */
  private sirenBehind(f: Vec2, l: Vec2, v: number): boolean {
    const car = this.car;
    for (const o of this.world.cars) {
      if (!o.siren || o === car || o.removed) continue;
      const rx = o.pos.x - car.pos.x;
      const rz = o.pos.z - car.pos.z;
      const along = rx * f.x + rz * f.z;
      if (along > -2 || along < -DRIVER_TUNING.sirenRange) continue;
      if (Math.abs(rx * l.x + rz * l.z) > 7) continue;
      if (o.vel.x * f.x + o.vel.z * f.z > v + 1) return true;
    }
    return false;
  }

  /** Something coming head-on in this car's lane (the player on the wrong side, a cop cutting through). */
  private headOn(f: Vec2, l: Vec2, v: number): boolean {
    const car = this.car;
    for (const o of this.world.cars) {
      if (o === car || o.removed) continue;
      const rx = o.pos.x - car.pos.x;
      const rz = o.pos.z - car.pos.z;
      const along = rx * f.x + rz * f.z;
      if (along < 3 || along > 70) continue;
      if (Math.abs(rx * l.x + rz * l.z) > car.halfW + o.halfW + 0.6) continue;
      const vo = o.vel.x * f.x + o.vel.z * f.z;
      if (vo > -4) continue;
      if ((along - car.halfL - o.halfL) / (v - vo) < DRIVER_TUNING.evadeTime) return true;
    }
    return false;
  }

  private signal(side: Blinker): void {
    if (this.car.blinker === side) return;
    this.car.blinker = side;
    this.car.blinkT = 0;
  }

  /** Compute inputs for this step. */
  drive(): void {
    this.advance();
    const car = this.car;
    const s = car.phys.state;
    const v = Math.max(0, s.speed);
    const f = fwd(s.yaw);
    const l = leftOf(s.yaw);
    const dStop = this.distToStopLine();
    const turning = this.next.turn !== 'straight';
    const riders = this.scanRiders(f, turning && (this.pastLane || dStop < 15));
    const inTurn = turning && this.pastLane;
    const T = DRIVER_TUNING;
    // Reactions: pull over for a siren behind, swerve from a car coming at us in our lane
    if (!inTurn && this.headOn(f, l, v)) this.evadeT = 1.2;
    else this.evadeT = Math.max(0, this.evadeT - 1 / 60);
    if (this.sirenBehind(f, l, v)) this.yieldT = 2.5;
    else this.yieldT = Math.max(0, this.yieldT - 1 / 60);
    const curbLane = this.lane.index === this.world.city.edges[this.lane.edgeId].lanesPerDir - 1;
    let want = riders.nudge;
    let rate = 2.5;
    this.mood = 'cruise';
    if (this.evadeT > 0) {
      this.mood = 'evade';
      if (want === 0) want = CURB_SIDE * T.evadeNudge;
      rate = 8;
    } else if (this.yieldT > 0) {
      this.mood = 'yield';
      // the curb lane moves over to the curb, an inner lane toward the center line: the cop splits them
      if (want === 0 && !inTurn) want = (curbLane ? CURB_SIDE : -CURB_SIDE) * T.yieldNudge;
      rate = 3.5;
    }
    this.offset += (want - this.offset) * (rate / 60);

    // Steering (pure pursuit), shifted sideways by the nudge
    // Short look-ahead through junction turns: a long one aims across the corner and cuts it
    const Ld = turning && (this.pastLane || dStop < 6) ? clamp(2.5 + v * 0.3, 3, 6) : clamp(4 + v * 0.55, 5, 15);
    // Classic pure pursuit, from the rear axle (steering from the middle of the car lets the rear wheels cut
    // inside on tight turns); `lookahead` measures from the car's middle
    const rb = car.phys.spec.cgToRear;
    const tp = this.lookahead(Math.max(1, Ld - rb));
    tp.x += l.x * this.offset;
    tp.z += l.z * this.offset;
    const rel = { x: tp.x - (s.pos.x - f.x * rb), z: tp.z - (s.pos.z - f.z * rb) };
    const lat = dot(rel, l);
    const ld2 = Math.max(1, rel.x * rel.x + rel.z * rel.z);
    const wb = car.phys.spec.cgToFront + car.phys.spec.cgToRear;
    const delta = Math.atan2(2 * wb * lat, ld2);
    car.input.steer = clamp(-delta / car.phys.maxSteerAt(v), -1, 1);

    // Target speed
    const limit = this.world.city.edges[this.lane.edgeId].speedLimit * this.speedMul;
    // Careful on steep blocks: crests would throw the car into the air
    const nh = this.world.city.terrain.nodeH;
    const grade = Math.abs(nh[this.lane.to] - nh[this.lane.from]) / Math.max(1, this.lane.length);
    let v0 = limit * (1 - clamp(grade * 2.6, 0, 0.45));
    if (riders.pass < Infinity) v0 = Math.min(v0, riders.pass + PASS_DELTA);
    // Curb-side turns are tighter than turns across the junction: take them slower
    if (turning && (this.pastLane || dStop < 25)) v0 = Math.min(v0, this.next.turn === EASY_TURN ? this.turnSpeed * 0.75 : this.turnSpeed);
    if (this.yieldT > 0) v0 = Math.min(v0, limit * T.yieldSpeed);
    // Something coming head-on: stand on the brakes while swerving
    if (this.evadeT > 0) v0 = Math.min(v0, 3);
    v0 = Math.min(v0, this.speedCap);

    // Turn signals: on approaching the junction, off once on the new road; toward the curb while pulling over
    if (this.forceBlinker) this.signal(this.forceBlinker);
    else if (turning && (this.pastLane || (dStop >= 0 && dStop < T.signalAt))) this.signal(this.next.turn as Blinker);
    else if (this.yieldT > 0 && curbLane) this.signal(CURB_BLINKER);
    else this.signal(null);

    // IDM with leader + virtual stop-line leader
    let gap = Infinity;
    let vLead = 0;
    this.waiting = 'none';
    // Through a turn the car ahead is round the curve, off to the side of our heading: measure along the path
    const alongPath = turning && (this.pastLane || dStop < 12);
    for (const o of this.world.cars) {
      if (o === car || o.removed) continue;
      const r = { x: o.pos.x - s.pos.x, z: o.pos.z - s.pos.z };
      const ahead = dot(r, f);
      if (ahead <= 0 || ahead > 45) continue;
      if (inTurn && this.passesOpposingTurner(o)) continue;
      if (this.waitsForMyTurn(o)) continue;
      // Its footprint in our frame (a car turning away still has its tail in our lane): half extents across / along
      const c = Math.abs(dot(fwd(o.yaw), f));
      const sn = Math.sqrt(Math.max(0, 1 - c * c));
      const across = o.halfL * sn + o.halfW * c;
      const along = o.halfL * c + o.halfW * sn;
      let g = Infinity;
      if (Math.abs(dot(r, l)) - across <= car.halfW + (turning && this.pastLane ? 0.85 : 0.35)) g = ahead - car.halfL - along;
      if (alongPath && ahead < 25) {
        const q = this.onPath(o.pos);
        if (q.s > 0 && Math.abs(q.lat) < car.halfW + o.halfW + 0.3) g = Math.min(g, q.s - car.halfL - o.halfL);
      }
      if (g < gap) {
        gap = g;
        vLead = dot(o.vel, f);
        this.waiting = 'traffic';
      }
    }
    if (riders.gap < gap) {
      gap = riders.gap;
      vLead = riders.vLead;
      this.waiting = 'traffic';
    }
    const pedGap = this.scanPeds();
    if (pedGap < gap) {
      gap = pedGap;
      vLead = 0;
      this.waiting = 'traffic';
      if (this.mood === 'cruise') this.mood = 'ped';
    }
    if (this.mustStopForSignal(dStop, v)) {
      const g = dStop - car.halfL - 0.5;
      if (g < gap) {
        gap = g;
        vLead = 0;
        this.waiting = 'light';
      }
    }
    const aMax = this.aMax;
    const bComf = 3.2;
    const s0 = 2.2;
    let acc: number;
    if (gap === Infinity) acc = aMax * (1 - (v / v0) ** 4);
    else {
      const sStar = s0 + v * this.headway + (v * (v - vLead)) / (2 * Math.sqrt(aMax * bComf));
      acc = gap <= 0.2 ? -9 : aMax * (1 - (v / v0) ** 4 - (Math.max(0, sStar) / gap) ** 2);
    }

    // Reaction time: a car that was waiting at a standstill pulls away a moment after it could (queues
    // ripple off the line instead of all moving at once)
    const holding = acc < 0 && v < 1.2;
    if (holding) this.held = true;
    else if (this.held) {
      this.held = false;
      this.launchT = this.world.rng.range(T.launchMin, T.launchMax) * (1 - 0.4 * this.temper);
    }
    if (this.launchT > 0) this.launchT -= 1 / 60;

    // Feed-forward the hill: gravity along the slope adds to the acceleration we need
    const need = acc + 9.81 * s.slope;
    if (holding || (this.launchT > 0 && v < 1.2)) {
      car.input.throttle = 0;
      car.input.brake = 0;
      car.input.handbrake = true;
    } else if (need >= 0) {
      car.input.throttle = clamp(need / 1.6, 0, 1);
      car.input.brake = 0;
      car.input.handbrake = false;
    } else if (v < 1.2) {
      // Creeping downhill: coast. Brake input below 1 m/s selects reverse (the player's brake / reverse key).
      car.input.throttle = 0;
      car.input.brake = 0;
      car.input.handbrake = false;
    } else {
      car.input.throttle = 0;
      car.input.brake = clamp(-need / 7, 0.05, 1);
      car.input.handbrake = false;
    }

    // Stuck tracking (not counting legit waits)
    if (v < 0.4 && this.waiting === 'none') this.stuckTime += 1 / 60;
    else if (v < 0.4 && this.waiting === 'traffic') this.stuckTime += 0.3 / 60;
    else this.stuckTime = Math.max(0, this.stuckTime - 2 / 60);
  }
}
