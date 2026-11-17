import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import { Pathfinder, type Route } from '../ai/Pathfinding';
import type { AABB, Lane, OrientedBox, RoadEdge, StreetClass, Vec2 } from '../types';
import { inDriveway } from '../world/Features';
import type { Pothole } from '../world/Potholes';
import { laneOffset, type CityModel } from '../world/RoadGraph';

/**
 * Rue barrée and cone lines (PRD 5.2, 5.3, Phase 7): pure data, rolled once per session from the city seed
 * plus a run salt, then frozen.
 *
 * - Hard closures fence off the middle of one edge: a work zone between two barricade lines, curb to building
 *   line, with an excavator, a gravel pile or a trench inside. Boulevards close one direction only (the other
 *   half stays open, and driving it the wrong way is the wrong-way offense). Static colliders, real damage.
 *   The AI pathfinder and traffic drop the whole edge; the GPS never hears about it.
 * - The sidewalk parts of a fence leave a gap on the pedestrians' walking line, too narrow for any car.
 * - Soft closures are cone tapers that close one lane, never more. Traffic does not drive into that lane (it
 *   takes another lane or another road); every pathfinder keeps the edge.
 * - Loose cones are everywhere, as in Montreal: around pits, at corners, by the curb, on the sidewalks, in
 *   parking bays (nobody parks there), in parks and squares, in front of the fences. No line, no offense.
 *
 * Session rules (PRD 5.2): for the lane drivers, one way at a time, every junction still reaches every other
 * and no way into a junction is a dead end; the GPS route from the spawn to the garage crosses at least one
 * fence; and neither the spawn's nor the garage's edge is ever closed.
 */
export type ClosureSide = 'both' | 'ab' | 'ba';
export type ClosureSign = 'rueBarree' | 'voieBarree' | 'detourLeft' | 'detourRight' | 'locale';
export type WorkDressing = 'excavator' | 'gravel' | 'trench';

/** One barricade line across the road, seen from the traffic it stops. */
export interface Fence {
  /** Ends of the line on the ground (lateral order: `a` on the fence's left as you face it). */
  a: Vec2;
  b: Vec2;
  /** Unit direction the signs face (toward the traffic that meets this fence). */
  facing: Vec2;
  /** Lateral span of the road part (curb to curb, or the closed half) and of the sidewalk parts, in edge lateral (m). */
  road: [number, number];
  walks: [number, number][];
  /** Boards on the rails, left to right as you face them. */
  signs: ClosureSign[];
  /** The cross street the DÉTOUR tab names (the arrow can lie: it is a sign, not a nav aid). */
  detourName: string | null;
}

export interface HardClosure {
  id: number;
  edge: number;
  side: ClosureSide;
  /** Work zone along the edge centerline from its start (`pts[0]`), and laterally (+ = left of a -> b, m). */
  s0: number;
  s1: number;
  lat0: number;
  lat1: number;
  /** Front (at s0, facing node a) and back (at s1, facing node b). */
  fences: [Fence, Fence];
  /** Barrier run along the centerline, partial closures only (between the two fences). */
  spine: { a: Vec2; b: Vec2 } | null;
  dressing: WorkDressing;
  /** A worker in an orange vest inside the fence (view only; nobody can drive in to hit them). */
  worker: boolean;
  /** Middle of the zone and the edge's direction a -> b. */
  center: Vec2;
  dir: Vec2;
  /** Lanes that run into a fence. */
  lanes: number[];
  colliders: AABB[];
}

/**
 * A soft closure: a taper of cones that closes one lane, then a short run along its line. Only ever one lane:
 * the AI never drives into it (`Roadworks.conedLane`), and hitting its cones counts against the player
 * (`Chantier.ts`).
 */
export interface ConeLine {
  id: number;
  edge: number;
  /** Across the lane at the taper's middle (for the AI's distance to it). */
  a: Vec2;
  b: Vec2;
  cones: Vec2[];
  /** The one lane it closes. */
  lanes: number[];
  /** A DÉTOUR board on a stand at the curb end, facing the traffic in `facing`. */
  board: { pos: Vec2; facing: Vec2; left: boolean } | null;
}

/**
 * A lane merge (the orange "lane ends" diamond): on a road with more than one lane each way, one lane is coned
 * off in a taper ahead of a hard obstacle in it (an excavator, or a rue-barrée barricade block), and opens again
 * a little past it. Traffic in that lane signals and waits for a gap to merge over (`LaneDriver`); the player
 * just has to get round it.
 */
export interface LaneMerge {
  id: number;
  edge: number;
  /** The lane that ends, and the lane it merges into (same road, same way). */
  lane: number;
  into: number;
  /** Which way the traffic moves over, seen from the driver. */
  side: 'left' | 'right';
  /** Where the taper starts (on the closed lane's line) and the front of the obstacle. */
  taper: Vec2;
  front: Vec2;
  /** Obstacle box in edge terms: s along the centerline from `pts[0]`, lateral (+ = left of a -> b). */
  s0: number;
  s1: number;
  lat0: number;
  lat1: number;
  /** Lateral of the box's side that faces the open lane. */
  open: number;
  /** Direction of travel in the closed lane. */
  dir: Vec2;
  kind: 'machine' | 'barricade';
  /** Diamonds at the curb ahead of the taper, facing the traffic. */
  signs: { pos: Vec2; facing: Vec2 }[];
  /** Taper, the run along the lane line beside the obstacle, and the short taper where the lane opens again. */
  cones: Vec2[];
  colliders: AABB[];
}

/** Where a session's GPS test runs from and to. */
export interface ClosureAnchors {
  spawn: Vec2;
  /** Direction the car starts in (the GPS plans from it). */
  heading: Vec2;
  goal: Vec2;
}

/** How the roll treats each street class. Playtest numbers. */
export const CLOSURE_ROLL: Record<StreetClass, { hard: number; soft: number }> = {
  /** Chance that an edge gets a fence, and (otherwise) a cone line. Streets: about one block in six or seven. */
  boulevard: { hard: 0.05, soft: 0.1 },
  street: { hard: 0.15, soft: 0.08 },
  cobble: { hard: 0.1, soft: 0.06 },
};

export const CLOSURE_TUNING = {
  /** Most fences in a session (the detour is a nuisance, not a maze) and most cone lines. */
  maxHard: 52,
  maxLines: 40,
  /** Work zone length along the street (m). */
  zone: [10, 18] as [number, number],
  /** Keep the zone this far from the junction boxes (m): there is always room to see it and turn round. */
  endGap: 22,
  /** Cones in a lane taper (across the lane, over `taper` m) and along the lane line after it. */
  taperCones: [4, 6] as [number, number],
  taper: [7, 11] as [number, number],
  runCones: [2, 4] as [number, number],
  /**
   * Loose cones (Montreal's staple): chance per big pit, per junction corner, per open edge in the curb lane,
   * per sidewalk side, per curb parking bay, per park / square, and cones in front of each fence.
   */
  pitCones: 0.2,
  cornerCones: 0.3,
  edgeCones: 0.25,
  walkCones: 0.35,
  bayCones: 0.035,
  parkCones: 0.7,
  fenceCones: [1, 3] as [number, number],
  /** Lane merges: chance per boulevard (per edge) and most in a session; taper and obstacle lengths (m). */
  merge: 0.16,
  maxMerges: 16,
  mergeTaper: 16,
  obstacle: [9, 14] as [number, number],
};

const SALT = 0xc0e5;
/** How deep a barricade line's collider is (m). */
const FENCE_DEPTH = 0.5;
/** The sidewalk part of a fence stops this short of the building line (m). */
const WALK_INSET = 0.2;
/**
 * Pedestrians walk this far from the curb, give or take 0.55 m (`ai/Pedestrians.ts` INSET / MAX_LATERAL).
 * Sidewalk fences leave a gap that wide around it: the narrowest car in the game is 1.4 m across.
 */
const PED_LINE = 2.2;
export const PED_GAP = 1.25;

/** Shared empty set: the GPS pathfinder's blocked edges. */
export const NO_EDGES: ReadonlySet<number> = new Set();

/** Edge frame on a straight edge: point at (s, lat) and the unit direction. */
function frame(e: RoadEdge) {
  const p0 = e.pts[0];
  const p1 = e.pts[e.pts.length - 1];
  const L = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
  const t = { x: (p1.x - p0.x) / L, z: (p1.z - p0.z) / L };
  // left of the direction (`leftVec`): (dz, -dx)
  const at = (s: number, lat: number): Vec2 => ({ x: p0.x + t.x * s + t.z * lat, z: p0.z + t.z * s - t.x * lat });
  return { L, t, at };
}

/** Collider for a strip from (s0..s1) x (lat0..lat1) of an edge: the AABB, with an `obb` if the edge is not axis aligned. */
function strip(e: RoadEdge, s0: number, s1: number, lat0: number, lat1: number): AABB {
  const f = frame(e);
  const pts = [f.at(s0, lat0), f.at(s0, lat1), f.at(s1, lat0), f.at(s1, lat1)];
  const box: AABB = {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  };
  if (Math.abs(f.t.x) > 1e-6 && Math.abs(f.t.z) > 1e-6) {
    const c = f.at((s0 + s1) / 2, (lat0 + lat1) / 2);
    // Local +Z along the edge
    const obb: OrientedBox = { cx: c.x, cz: c.z, hx: Math.abs(lat1 - lat0) / 2, hz: Math.abs(s1 - s0) / 2, yaw: Math.atan2(f.t.x, f.t.z) };
    box.obb = obb;
  }
  return box;
}

/** Sign of the lateral offset on the side where a -> b lanes run. */
const AB_SIDE = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;

/** Lanes of an edge whose line lies between lat0 and lat1. */
function lanesBetween(city: CityModel, e: RoadEdge, lat0: number, lat1: number): number[] {
  const out: number[] = [];
  for (const id of [...e.lanesAB, ...e.lanesBA]) {
    const l = city.lanes[id];
    const lat = (l.from === e.a ? AB_SIDE : -AB_SIDE) * laneOffset(e, l.index);
    if (lat >= Math.min(lat0, lat1) && lat <= Math.max(lat0, lat1)) out.push(id);
  }
  return out;
}

/** Name of a street crossing this edge at node n (for the DÉTOUR tab). */
function crossName(city: CityModel, e: RoadEdge, n: number): string | null {
  for (const id of city.nodes[n].edges) {
    const o = city.edges[id];
    if (o.id !== e.id && o.axis !== e.axis && o.name) return o.name.name;
  }
  return null;
}

/** Session roll: deterministic for a seed, an anchor pair and a salt. */
export class Closures {
  readonly hard: HardClosure[] = [];
  readonly lines: ConeLine[] = [];
  /** Cones with no line: around pits, at corners, in front of the fences. */
  readonly loose: Vec2[] = [];
  /** Edges the AI drops (every hard closure, partial or not). */
  readonly closed = new Set<number>();
  /** Did the GPS route from the anchors cross a fence (debug)? How many rolls were dropped by the rules? */
  gpsHitsFence = false;
  dropped = 0;
  private readonly byEdge = new Map<number, HardClosure>();
  private readonly linesByEdge = new Map<number, ConeLine>();
  /** Lanes a cone line closes (the AI treats them as blocked one way). */
  private readonly conedLanes = new Set<number>();
  /** Curb parking bays with cones in them (keys of their rounded positions): no car is parked there. */
  private readonly bays = new Set<string>();

  constructor(
    private readonly city: CityModel,
    seed: number,
    readonly salt: number,
    anchors: ClosureAnchors,
    pits: readonly Pothole[] = [],
  ) {
    const rng = new Rng((seed ^ SALT ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
    const keep = new Set<number>([city.nearestLanePoint(anchors.spawn).lane.edgeId, city.nearestLanePoint(anchors.goal).lane.edgeId]);
    this.rollHard(rng, keep);
    this.ensureGpsHitsFence(rng, keep, anchors);
    this.finishHard(rng);
    this.rollLines(rng);
    // Merges roll from their own stream, so adding them moved nothing else
    this.rollMerges(new Rng((seed ^ SALT ^ 0x3e46 ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0));
    this.rollLoose(rng, pits);
  }

  /** Lane merges (`LaneMerge`), by edge and by the closed lane. */
  readonly merges: LaneMerge[] = [];
  private readonly mergeByLane = new Map<number, LaneMerge>();

  /** The lane ends ahead (a merge): distance to the taper and the lane to move into. Null once at the taper. */
  mergeAhead(lane: Lane, p: Vec2): { dist: number; into: number } | null {
    const m = this.mergeByLane.get(lane.id);
    if (!m) return null;
    const d = (m.taper.x - p.x) * m.dir.x + (m.taper.z - p.z) * m.dir.z;
    return d > 0 ? { dist: d, into: m.into } : null;
  }

  mergeLane(id: number): boolean {
    return this.mergeByLane.has(id);
  }

  /** Edges with any work on them (fence, cone taper, merge): the boulevard islands keep off them. */
  get busyEdges(): Set<number> {
    return new Set([...this.closed, ...this.lines.map((l) => l.edge), ...this.merges.map((m) => m.edge)]);
  }

  closedEdge(id: number): boolean {
    return this.closed.has(id);
  }

  conedLane(id: number): boolean {
    return this.conedLanes.has(id);
  }

  /** A curb bay taken by cones (ParkedCars leaves it empty). */
  reservedBay(p: Vec2): boolean {
    return this.bays.has(bayKey(p));
  }

  hardOn(edge: number): HardClosure | undefined {
    return this.byEdge.get(edge);
  }

  lineOn(edge: number): ConeLine | undefined {
    return this.linesByEdge.get(edge);
  }

  get colliders(): AABB[] {
    return [...this.hard.flatMap((h) => h.colliders), ...this.merges.flatMap((m) => m.colliders)];
  }

  /** Meters along `lane` from `p` to the next fence that crosses it (Infinity: none ahead). */
  barrierAhead(lane: Lane, p: Vec2): number {
    // Past the start of a merge taper still in the closed lane: the obstacle is the wall
    const m = this.mergeByLane.get(lane.id);
    if (m && !this.mergeAhead(lane, p)) {
      const d = (m.front.x - p.x) * m.dir.x + (m.front.z - p.z) * m.dir.z;
      if (d > 0) return d;
    }
    const h = this.byEdge.get(lane.edgeId);
    if (!h || !h.lanes.includes(lane.id)) return Infinity;
    return this.aheadOf(lane, p, h.fences.map((f) => mid(f.a, f.b)));
  }

  /** Meters along `lane` from `p` to the cone line across it (Infinity: none ahead). */
  conesAhead(lane: Lane, p: Vec2): number {
    const l = this.linesByEdge.get(lane.edgeId);
    if (!l || !l.lanes.includes(lane.id)) return Infinity;
    return this.aheadOf(lane, p, [mid(l.a, l.b)]);
  }

  /** Inside a work zone, or within `margin` of it (curb parking keeps out). */
  inWorkZone(p: Vec2, margin = 0): boolean {
    for (const h of this.hard) {
      const f = frame(this.city.edges[h.edge]);
      const s = (p.x - f.at(0, 0).x) * f.t.x + (p.z - f.at(0, 0).z) * f.t.z;
      if (s < h.s0 - margin || s > h.s1 + margin) continue;
      const lat = (p.x - f.at(0, 0).x) * f.t.z - (p.z - f.at(0, 0).z) * f.t.x;
      if (lat >= h.lat0 - margin && lat <= h.lat1 + margin) return true;
    }
    for (const m of this.merges) {
      const f = frame(this.city.edges[m.edge]);
      const o = f.at(0, 0);
      const s = (p.x - o.x) * f.t.x + (p.z - o.z) * f.t.z;
      if (s < m.s0 - margin || s > m.s1 + margin) continue;
      const lat = (p.x - o.x) * f.t.z - (p.z - o.z) * f.t.x;
      if (lat >= m.lat0 - margin && lat <= m.lat1 + margin) return true;
    }
    return false;
  }

  // ---- lane merges ---------------------------------------------------------------------------------------

  private rollMerges(rng: Rng): void {
    const T = CLOSURE_TUNING;
    for (const e of this.city.edges) {
      // Rolled for every boulevard, so one outcome does not reshuffle the rest
      if (e.lanesPerDir < 2) continue;
      const take = rng.chance(T.merge);
      const ab = rng.chance(0.5);
      const curb = rng.chance(0.7);
      const where = rng.next();
      const obsLen = rng.range(T.obstacle[0], T.obstacle[1]);
      const kind: LaneMerge['kind'] = rng.chance(0.55) ? 'machine' : 'barricade';
      if (!take || this.merges.length >= T.maxMerges || this.closed.has(e.id) || this.linesByEdge.has(e.id)) continue;
      const f = frame(e);
      const ids = ab ? e.lanesAB : e.lanesBA;
      if (ids.length < 2) continue;
      // Room: 55 m to see the signs and merge, the taper, the obstacle, 8 m to open again, 15 m to the junction
      const need = 55 + T.mergeTaper + 3 + obsLen + 8 + 15;
      if (f.L < need) continue;
      const lanes = ids.map((id) => this.city.lanes[id]).sort((x, y) => x.index - y.index);
      const closed = curb ? lanes[lanes.length - 1] : lanes[0];
      const into = curb ? lanes[lanes.length - 2] : lanes[1];
      const sgn = ab ? AB_SIDE : -AB_SIDE;
      // Travel distance u from where the lane enters the edge, to the edge's s
      const S = (u: number) => (ab ? u : f.L - u);
      const dir = ab ? f.t : { x: -f.t.x, z: -f.t.z };
      const outer = sgn * (curb ? e.median + e.laneWidth * lanes.length : e.median);
      const boundary = sgn * (e.median + e.laneWidth * (curb ? lanes.length - 1 : 1));
      const toward = Math.sign(boundary - outer);
      const centre = sgn * laneOffset(e, closed.index);
      const u0 = 55 + where * (f.L - need);
      const u1 = u0 + T.mergeTaper;
      const o0 = u1 + 3;
      const o1 = o0 + obsLen;
      // The obstacle box: from just off the lane line out to the curb (the parking band too), or in to the centre
      // (the cones beside it stand between the box and the open lane)
      const edgeLat = boundary - toward * 0.9;
      const farLat = curb ? sgn * (e.width / 2 - 0.1) : sgn * 0.05;
      const lat0 = Math.min(edgeLat, farLat);
      const lat1 = Math.max(edgeLat, farLat);
      const s0 = Math.min(S(o0), S(o1));
      const s1 = Math.max(S(o0), S(o1));
      // Cones: the taper from the outer edge in to the lane line, the run beside the obstacle, the opening taper
      const cones: Vec2[] = [];
      const coneLat = boundary - toward * 0.45;
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        cones.push(f.at(S(u0 + k * T.mergeTaper), outer + (coneLat - outer) * k + toward * 0.3 * (1 - k)));
      }
      for (let u = u1 + 3; u < o1 + 0.5; u += 3.2) cones.push(f.at(S(u), coneLat));
      for (let i = 1; i <= 3; i++) cones.push(f.at(S(o1 + 2 + i * 2.2), coneLat + (outer + toward * 0.3 - coneLat) * (i / 3)));
      // Which way traffic moves over, as the driver sees it: left of the travel direction is +lat when a -> b
      const leftLat = ab ? 1 : -1;
      const side = (boundary - outer) * leftLat > 0 ? 'left' : 'right';
      const curbLat = sgn * (e.width / 2 + 0.5);
      const facing = { x: -dir.x, z: -dir.z };
      const m: LaneMerge = {
        id: this.merges.length,
        edge: e.id,
        lane: closed.id,
        into: into.id,
        side,
        taper: f.at(S(u0), centre),
        front: f.at(S(o0), centre),
        s0,
        s1,
        lat0,
        lat1,
        open: edgeLat,
        dir,
        kind,
        signs: [
          { pos: f.at(S(u0 - 45), curbLat), facing },
          { pos: f.at(S(u0 - 12), curbLat), facing },
        ],
        cones,
        colliders: [strip(e, s0, s1, lat0, lat1)],
      };
      this.merges.push(m);
      this.mergeByLane.set(closed.id, m);
    }
  }

  private aheadOf(lane: Lane, p: Vec2, pts: Vec2[]): number {
    const sCar = (p.x - lane.start.x) * lane.dir.x + (p.z - lane.start.z) * lane.dir.z;
    let best = Infinity;
    for (const q of pts) {
      const s = (q.x - lane.start.x) * lane.dir.x + (q.z - lane.start.z) * lane.dir.z;
      if (s > sCar && s - sCar < best) best = s - sCar;
    }
    return best;
  }

  // ---- hard closures -------------------------------------------------------------------------------------

  private rollHard(rng: Rng, keep: Set<number>): void {
    const order = this.city.edges.map((e) => ({ e, r: rng.next() })).sort((x, y) => x.r - y.r);
    for (const { e } of order) {
      if (this.closed.size >= CLOSURE_TUNING.maxHard) break;
      if (keep.has(e.id) || !rng.chance(CLOSURE_ROLL[e.cls].hard)) continue;
      this.tryClose(rng, e, e.cls === 'boulevard' ? (rng.chance(0.5) ? 'ab' : 'ba') : 'both');
    }
  }

  /** Close an edge if it fits and the rules still hold; otherwise drop it (the newest closure). */
  private tryClose(rng: Rng, e: RoadEdge, side: ClosureSide): boolean {
    if (this.closed.has(e.id)) return false;
    const zone = this.placeZone(rng, e);
    if (!zone) return false;
    this.closed.add(e.id);
    if (!this.aiConnected()) {
      this.closed.delete(e.id);
      this.dropped++;
      return false;
    }
    const h = this.build(rng, e, side, zone[0], zone[1]);
    this.hard.push(h);
    this.byEdge.set(e.id, h);
    return true;
  }

  /** A spot mid-block, clear of driveways and alley mouths (the garages must stay reachable). */
  private placeZone(rng: Rng, e: RoadEdge): [number, number] | null {
    const T = CLOSURE_TUNING;
    const f = frame(e);
    const len = rng.range(T.zone[0], T.zone[1]);
    const room = f.L - 2 * T.endGap - len;
    if (room < 0) return null;
    const half = e.width / 2 + CONFIG.SIDEWALK;
    for (let k = 0; k < 6; k++) {
      // Middle half of the block first
      const s0 = T.endGap + room * (0.25 + 0.5 * rng.next());
      let clear = true;
      for (let s = s0 - 3; s <= s0 + len + 3 && clear; s += 2)
        for (const lat of [-half, half]) if (inDriveway(this.city.features, f.at(s, lat), 2)) clear = false;
      if (clear) return [s0, s0 + len];
    }
    return null;
  }

  /**
   * What the lane drivers need from the city, one way at a time: a direction of an edge is open unless it is
   * fenced or every lane that way is coned. Every way into a junction must leave a way out that is not back
   * along the same road (no U-turns in junctions), and every junction must still reach every other.
   */
  private aiConnected(): boolean {
    const { nodes, edges } = this.city;
    const open = (e: RoadEdge, from: number): boolean => {
      if (this.closed.has(e.id)) return false;
      const ls = this.city.lanesLeaving(e, from);
      return ls.length > 0 && ls.some((id) => !this.conedLanes.has(id));
    };
    for (const n of nodes) {
      for (const id of n.edges) {
        const e = edges[id];
        if (!open(e, e.a === n.id ? e.b : e.a)) continue;
        if (!n.edges.some((o) => o !== id && open(edges[o], n.id))) return false;
      }
    }
    const reach = (forward: boolean): number => {
      const seen = new Uint8Array(nodes.length);
      const stack = [0];
      seen[0] = 1;
      let count = 1;
      while (stack.length) {
        const n = stack.pop()!;
        for (const id of nodes[n].edges) {
          const e = edges[id];
          const o = e.a === n ? e.b : e.a;
          if (seen[o] || !(forward ? open(e, n) : open(e, o))) continue;
          seen[o] = 1;
          count++;
          stack.push(o);
        }
      }
      return count;
    };
    return reach(true) === nodes.length && reach(false) === nodes.length;
  }

  /** The GPS (no closures) from the anchors: if its route misses every fence, close an edge on it. */
  private ensureGpsHitsFence(rng: Rng, keep: Set<number>, anchors: ClosureAnchors): void {
    const route = new Pathfinder(this.city).findRoute(anchors.spawn, anchors.goal, { heading: anchors.heading });
    if (!route) return;
    if (this.routeHitsFence(route)) {
      this.gpsHitsFence = true;
      return;
    }
    // Middle edges of the route (never the first or last), streets first, in a random order
    const on = this.routeEdges(route)
      .slice(1, -1)
      .filter((x) => !keep.has(x.e.id))
      .map((x) => ({ ...x, r: rng.next() + (x.e.cls === 'boulevard' ? 1 : 0) }))
      .sort((p, q) => p.r - q.r);
    for (const { e } of on) {
      // At the cap, the newest closure off the route makes room
      if (this.closed.size >= CLOSURE_TUNING.maxHard) {
        const drop = [...this.hard].reverse().find((h) => !on.some((x) => x.e.id === h.edge));
        if (drop) this.remove(drop);
      }
      if (this.tryClose(rng, e, 'both')) {
        this.gpsHitsFence = true;
        return;
      }
    }
  }

  private remove(h: HardClosure): void {
    this.hard.splice(this.hard.indexOf(h), 1);
    this.byEdge.delete(h.edge);
    this.closed.delete(h.edge);
    this.dropped++;
  }

  /** The edges a route drives along, in order, and which way (true: a -> b). */
  private routeEdges(route: Route): { e: RoadEdge; ab: boolean }[] {
    const out: { e: RoadEdge; ab: boolean }[] = [];
    const n = route.nodes;
    for (let i = 0; i + 1 < n.length; i++) {
      const e = this.city.edgeBetween(n[i], n[i + 1]);
      if (e) out.push({ e, ab: e.a === n[i] });
    }
    return out;
  }

  /**
   * Does the route drive into a fence on one of the edges it takes end to end? (The edges it starts and ends on
   * are left out: the session rule never closes the spawn's or the garage's edge.)
   */
  routeHitsFence(route: Route): boolean {
    return this.routeEdges(route).some(({ e, ab }) => {
      const h = this.byEdge.get(e.id);
      return !!h && (h.side === 'both' || (h.side === 'ab') === ab);
    });
  }

  /** Geometry, signs, colliders. */
  private build(rng: Rng, e: RoadEdge, side: ClosureSide, s0: number, s1: number): HardClosure {
    const f = frame(e);
    const hw = e.width / 2;
    const walk = hw + CONFIG.SIDEWALK - WALK_INSET;
    // Lateral range of the closed part: the whole street, or the half whose lanes run the closed way
    const sgn = side === 'both' ? 0 : side === 'ab' ? AB_SIDE : -AB_SIDE;
    const SPINE = 0.6;
    let lat0: number;
    let lat1: number;
    if (sgn === 0) [lat0, lat1] = [-walk, walk];
    else [lat0, lat1] = sgn > 0 ? [0.05, walk] : [-walk, -0.05];
    const road: [number, number] = sgn === 0 ? [-hw, hw] : sgn > 0 ? [0.05, hw] : [-hw, -0.05];
    // Sidewalk fence panels, either side of a gap on the pedestrians' walking line (PED_GAP: too narrow for a car)
    const walks: [number, number][] = [];
    const g0 = hw + PED_LINE - PED_GAP / 2;
    const g1 = hw + PED_LINE + PED_GAP / 2;
    if (lat0 < -hw) walks.push([lat0, -g1], [-g0, -hw]);
    if (lat1 > hw) walks.push([hw, g0], [g1, lat1]);
    const partial = sgn !== 0;
    const fence = (s: number, toward: 1 | -1, node: number): Fence => {
      // Facing back toward the node the traffic comes from; `a` on the left as you look at the signs
      const facing = { x: f.t.x * toward, z: f.t.z * toward };
      const L = f.at(s, toward < 0 ? lat1 : lat0);
      const R = f.at(s, toward < 0 ? lat0 : lat1);
      const detour = rng.chance(0.65);
      const signs: ClosureSign[] = [partial ? 'voieBarree' : 'rueBarree'];
      if (detour) signs.push(rng.chance(0.5) ? 'detourLeft' : 'detourRight');
      else if (!partial) signs.push('locale');
      if (rng.chance(0.5)) signs.reverse();
      return { a: L, b: R, facing, road, walks, signs, detourName: detour && rng.chance(0.75) ? crossName(this.city, e, node) : null };
    };
    const fences: [Fence, Fence] = [fence(s0, -1, e.a), fence(s1, 1, e.b)];
    // One box for the road part and one per sidewalk panel run, at each fence (the gaps stay open)
    const colliders: AABB[] = [];
    for (const s of [s0, s1])
      for (const [a, b2] of [road, ...walks]) colliders.push(strip(e, s - FENCE_DEPTH / 2, s + FENCE_DEPTH / 2, a, b2));
    let spine: HardClosure['spine'] = null;
    if (partial) {
      const lat = sgn * (0.05 + SPINE / 2);
      spine = { a: f.at(s0, lat), b: f.at(s1, lat) };
      colliders.push(strip(e, s0, s1, sgn * 0.05, sgn * (0.05 + SPINE)));
    }
    const lanes = lanesBetween(this.city, e, road[0], road[1]);
    const dressing: WorkDressing = rng.chance(0.45) ? 'excavator' : rng.chance(0.6) ? 'gravel' : 'trench';
    return {
      id: this.hard.length ? Math.max(...this.hard.map((h) => h.id)) + 1 : 0,
      edge: e.id,
      side,
      s0,
      s1,
      lat0,
      lat1,
      fences,
      spine,
      dressing,
      worker: rng.chance(0.5),
      center: f.at((s0 + s1) / 2, (lat0 + lat1) / 2),
      dir: f.t,
      lanes,
      colliders,
    };
  }

  /** Cones in front of each fence (loose ones: they belong to no line). */
  private finishHard(rng: Rng): void {
    const T = CLOSURE_TUNING;
    for (const h of this.hard) {
      const e = this.city.edges[h.edge];
      const f = frame(e);
      for (const [k, fe] of h.fences.entries()) {
        const out = k === 0 ? -1 : 1;
        const s = k === 0 ? h.s0 : h.s1;
        const n = rng.int(T.fenceCones[0], T.fenceCones[1]);
        for (let i = 0; i < n; i++) {
          const lat = rng.range(fe.road[0] + 0.6, fe.road[1] - 0.6);
          this.loose.push(f.at(s + out * rng.range(1.4, 5), lat));
        }
      }
    }
  }

  // ---- cone lines ----------------------------------------------------------------------------------------

  private rollLines(rng: Rng): void {
    const T = CLOSURE_TUNING;
    for (const e of this.city.edges) {
      // Rolled for every edge, so one outcome does not reshuffle the rest
      const take = rng.chance(CLOSURE_ROLL[e.cls].soft);
      const where = rng.next();
      const ab = rng.chance(0.5);
      const pickLane = rng.next();
      const taper = rng.range(T.taper[0], T.taper[1]);
      const nTaper = rng.int(T.taperCones[0], T.taperCones[1]);
      const nRun = rng.int(T.runCones[0], T.runCones[1]);
      const board = rng.chance(0.5);
      const boardLeft = rng.chance(0.5);
      if (!take || this.closed.has(e.id) || this.lines.length >= T.maxLines) continue;
      const f = frame(e);
      const ids = ab ? e.lanesAB : e.lanesBA;
      if (!ids.length || f.L < 2 * T.endGap + taper + 10) continue;
      // Boulevards: the curb lane most often; streets have one lane each way
      const lane = this.city.lanes[ids[ids.length > 1 && pickLane < 0.55 ? ids.length - 1 : Math.floor(pickLane * ids.length)]];
      const sgn = ab ? AB_SIDE : -AB_SIDE;
      const centre = sgn * laneOffset(e, lane.index);
      const half = e.laneWidth / 2 - 0.4;
      // Along the lane's own direction: d = +1 when it runs a -> b
      const d = ab ? 1 : -1;
      const s0 = ab ? T.endGap + where * (f.L - 2 * T.endGap - taper - 8) : f.L - T.endGap - where * (f.L - 2 * T.endGap - taper - 8);
      // The taper starts at the lane's curb-side edge (outer) and closes in to the inner edge
      const outer = centre + sgn * half;
      const inner = centre - sgn * half;
      const cones: Vec2[] = [];
      for (let i = 0; i < nTaper; i++) {
        const u = i / (nTaper - 1);
        cones.push(f.at(s0 + d * taper * u + rng.range(-0.15, 0.15), outer + (inner - outer) * u + rng.range(-0.1, 0.1)));
      }
      for (let i = 1; i <= nRun; i++) cones.push(f.at(s0 + d * (taper + i * 3.2), inner + rng.range(-0.1, 0.1)));
      const mid = s0 + (d * taper) / 2;
      const facing = ab ? { x: -f.t.x, z: -f.t.z } : f.t;
      const curbLat = sgn * (e.width / 2 - Math.max(0.6, e.parking * 0.5));
      this.conedLanes.add(lane.id);
      if (!this.aiConnected()) {
        this.conedLanes.delete(lane.id);
        this.dropped++;
        continue;
      }
      const line: ConeLine = {
        id: this.lines.length,
        edge: e.id,
        a: f.at(mid, outer),
        b: f.at(mid, inner),
        cones,
        lanes: [lane.id],
        board: board ? { pos: f.at(s0 - d * 3, curbLat), facing, left: boardLeft } : null,
      };
      this.lines.push(line);
      this.linesByEdge.set(e.id, line);
    }
  }

  // ---- loose cones ---------------------------------------------------------------------------------------

  private rollLoose(rng: Rng, pits: readonly Pothole[]): void {
    const T = CLOSURE_TUNING;
    const city = this.city;
    const f0 = city.features;
    // Around big pits (the patch crew's marker that never got picked up)
    for (const p of pits) {
      const take = rng.chance(T.pitCones);
      const n = rng.int(1, 3);
      const a0 = rng.range(0, Math.PI * 2);
      if (!take || p.depth !== 'big' || this.closed.has(p.edge)) continue;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i * Math.PI * 2) / n + rng.range(-0.4, 0.4);
        const r = p.r + rng.range(0.5, 1.1);
        this.loose.push({ x: p.pos.x + Math.cos(a) * r, z: p.pos.z + Math.sin(a) * r });
      }
    }
    for (const e of city.edges) {
      const f = frame(e);
      const hw = e.width / 2;
      const curbLat = (s: number) => s * (hw - Math.max(0.5, e.parking * 0.5));
      // A corner: one or two cones at the curb just out of the junction
      const corner = rng.chance(T.cornerCones);
      const atA = rng.chance(0.5);
      const side = rng.sign();
      const nCorner = rng.int(1, 2);
      // Somewhere along an open block: a cone or three by the curb
      const along = rng.chance(T.edgeCones);
      const where = rng.range(0.2, 0.8);
      const side2 = rng.sign();
      const nAlong = rng.int(1, 3);
      // On each sidewalk: by the curb or against the buildings, clear of the walking line
      const walk = [rng.chance(T.walkCones), rng.chance(T.walkCones)];
      const walkAt = [rng.range(0.1, 0.9), rng.range(0.1, 0.9)];
      const walkN = [rng.int(1, 3), rng.int(1, 3)];
      const walkOut = [rng.chance(0.5), rng.chance(0.5)];
      if (this.closed.has(e.id)) continue;
      if (corner) for (let i = 0; i < nCorner; i++) this.loose.push(f.at(atA ? 3 + i * 1.6 : f.L - 3 - i * 1.6, curbLat(side) + rng.range(-0.3, 0.3)));
      if (along) for (let i = 0; i < nAlong; i++) this.loose.push(f.at(where * f.L + i * rng.range(1.2, 2.4), curbLat(side2) + rng.range(-0.6, 0.4) * side2));
      for (const k of [0, 1]) {
        if (!walk[k]) continue;
        const sg = k ? 1 : -1;
        const off = walkOut[k] ? 0.55 : CONFIG.SIDEWALK - 0.5;
        for (let i = 0; i < walkN[k]; i++) {
          const p = f.at(walkAt[k] * f.L + i * 1.1, sg * (hw + off));
          if (!inDriveway(f0, p, 1)) this.loose.push(p);
        }
      }
    }
    // A cone or two left standing in a parking bay, so nobody parks there
    for (const b of f0.curb) {
      const take = rng.chance(T.bayCones);
      const two = rng.chance(0.5);
      if (!take || this.closed.has(b.edge)) continue;
      this.bays.add(bayKey(b.pos));
      const fw = { x: Math.sin(b.yaw), z: Math.cos(b.yaw) };
      if (two) for (const k of [-1.4, 1.4]) this.loose.push({ x: b.pos.x + fw.x * k, z: b.pos.z + fw.z * k });
      else this.loose.push({ ...b.pos });
    }
    // Parks, squares and the Old Port's lawns: a little cluster where something is (or was) being fixed
    const inBox = (b: AABB, m: number): Vec2 => ({ x: rng.range(b.minX + m, b.maxX - m), z: rng.range(b.minZ + m, b.maxZ - m) });
    const cluster = (c: Vec2) => {
      for (let i = rng.int(2, 4); i > 0; i--) this.loose.push({ x: c.x + rng.range(-1.6, 1.6), z: c.z + rng.range(-1.6, 1.6) });
    };
    for (const pk of f0.parks ?? []) if (rng.chance(T.parkCones)) cluster(inBox(pk.lawn, 3));
    for (const sq of f0.squares ?? []) if (rng.chance(T.parkCones)) cluster(inBox(rng.pick(sq.lawns.length ? sq.lawns : [sq.plaza]), 2.5));
    for (const l of f0.port?.lawns ?? []) if (rng.chance(T.parkCones * 0.6)) cluster(inBox(l, 2.5));
  }
}

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
const bayKey = (p: Vec2): string => `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`;

/**
 * The run salt: `?closures=<n>` in the URL replays a roll, otherwise every page load rolls a new one. The
 * headless tools (fingerprint, soak) pass their own.
 */
export function closureSalt(): number {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('closures') : null;
  const n = q !== null ? Number(q) : NaN;
  return Number.isFinite(n) ? n >>> 0 : Math.floor(Math.random() * 1e6);
}

/**
 * Mission ends (PRD 5.1): a lane on the Guy / Sherbrooke side, pointed east, and the garage farthest east
 * (Jacques Pneu, the Berri side). The roll keeps the GPS path between them crossing a fence, and never
 * closes either of those edges. Free roam uses the same spawn, so it is not inside a work zone either.
 */
export function defaultAnchors(city: CityModel): ClosureAnchors {
  const goal = eastGarage(city);
  const start = westSpawn(city);
  return { spawn: start.pos, heading: start.heading, goal };
}

/** The eastern pit's service circle, or a point on the east edge when the city has no garages. */
function eastGarage(city: CityModel): Vec2 {
  const pits = city.features.pitStops;
  if (!pits.length) return { x: city.bounds.maxX - 100, z: (city.bounds.minZ + city.bounds.maxZ) / 2 };
  const east = pits.reduce((a, p) => (p.bay.x > a.bay.x ? p : a));
  return { x: east.bay.x, z: east.bay.z };
}

/**
 * Eastbound lane in the northwest of the grid (Guy / Sherbrooke), mid-block so the car is not sitting in
 * a junction. Falls back to the northwestern-most eastbound lane if that corner has none.
 */
function westSpawn(city: CityModel): { pos: Vec2; heading: Vec2 } {
  const b = city.bounds;
  const xMax = b.minX + (b.maxX - b.minX) * 0.22;
  const zMax = b.minZ + (b.maxZ - b.minZ) * 0.32;
  const along = (l: { start: Vec2; end: Vec2 }): Vec2 => ({
    x: l.start.x + (l.end.x - l.start.x) * 0.45,
    z: l.start.z + (l.end.z - l.start.z) * 0.45,
  });
  const eastbound = city.lanes.filter((l) => l.dir.x > 0.75 && l.length > 40);
  const pool = eastbound.filter((l) => {
    const p = along(l);
    return p.x <= xMax && p.z <= zMax;
  });
  const lanes = pool.length ? pool : eastbound;
  let best = lanes[0] ?? city.lanes[0];
  let bestKey = Infinity;
  for (const l of lanes) {
    const p = along(l);
    const key = p.x + p.z + l.index * 30;
    if (key < bestKey) {
      bestKey = key;
      best = l;
    }
  }
  const guess = along(best);
  const hit = city.nearestLanePoint(guess);
  const lane = hit.lane.id === best.id ? hit.lane : best;
  const pos = hit.lane.id === best.id ? hit.pos : guess;
  return { pos, heading: { x: lane.dir.x, z: lane.dir.z } };
}
