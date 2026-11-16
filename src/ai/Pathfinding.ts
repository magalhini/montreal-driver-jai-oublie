import { CONFIG } from '../config';
import { dot, leftVec, segT } from '../core/math';
import { cumulative, pointAt, project, reversed, segDir } from '../world/Polyline';
import type { CityModel } from '../world/RoadGraph';
import type { RoadEdge, Vec2 } from '../types';

export interface Route {
  /** Road nodes passed through, in order. */
  nodes: number[];
  /** Polyline along road centerlines: snapped start, node centers, snapped goal. */
  points: Vec2[];
  /** Meters along `points`. */
  length: number;
  /** Estimated seconds, including turn / signal / U-turn costs. */
  cost: number;
}

export interface RouteOptions {
  /** Current direction of travel; starting away from it costs `uTurn` seconds. */
  heading?: Vec2;
  /** Never start against `heading` (lane-bound drivers can't turn around mid-block) instead of paying `uTurn`. */
  noUTurn?: boolean;
  /** Arrive on the goal's edge from this node (i.e. driving in a given direction along it), not the other end. */
  goalFrom?: number;
}

/** Point on an edge centerline. `t` runs 0 at node a to 1 at node b. */
export interface RoadPoint {
  edge: RoadEdge;
  t: number;
  pos: Vec2;
  dist: number;
}

/** Extra seconds added on top of length / speedLimit. */
export interface PathCosts {
  /** Turn that keeps to the curb side (left in Japan). */
  easyTurn: number;
  /** Turn across oncoming traffic. */
  hardTurn: number;
  /** Passing through a signalized node (average wait). */
  signal: number;
  /** Passing an all-way stop (stopping, waiting a turn). */
  stop: number;
  /** Starting against the current heading. */
  uTurn: number;
}

export const DEFAULT_COSTS: PathCosts = { easyTurn: 1.5, hardTurn: 3, signal: 1.5, stop: 2.5, uTurn: 8 };

/** A turn sharper than this (between arrival and departure directions) is priced as a turn. */
const STRAIGHT_COS = Math.cos((35 * Math.PI) / 180);

/**
 * A* over road nodes with travel-time cost. Search states are (node, arrival edge) so turns can be priced
 * from the angle between the arriving and leaving roads (T43) and U-turns at junctions (back along the
 * same edge) are excluded. Buffers are reused between calls, so re-running every ~0.5 s allocates only the
 * returned route.
 */
export class Pathfinder {
  private readonly goal: number;
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private stamp = 0;
  private heapF: number[] = [];
  private heapS: number[] = [];
  private readonly invMaxSpeed: number;
  private readonly hardIsLeft = CONFIG.DRIVE_SIDE === 'right';
  /** First state of each node: one per arriving edge (in `node.edges` order), then one for the route start. */
  private readonly base: Int32Array;
  private readonly nodeOf: Int32Array;
  /** Direction from each node out along each of its edges, by state slot. */
  private readonly armDir: Vec2[];
  /** Every road straight and axis aligned: Manhattan distance stays admissible (tighter); else straight line. */
  private readonly manhattan: boolean;
  private readonly lines = new Map<RoadEdge, { line: Vec2[]; cum: number[] }>();
  /** Nodes expanded by the last search (debug). */
  expanded = 0;

  constructor(
    private readonly city: CityModel,
    readonly costs: PathCosts = { ...DEFAULT_COSTS },
  ) {
    this.base = new Int32Array(city.nodes.length);
    let n = 0;
    for (const nd of city.nodes) {
      this.base[nd.id] = n;
      n += nd.edges.length + 1;
    }
    this.nodeOf = new Int32Array(n + 1);
    this.armDir = new Array<Vec2>(n);
    for (const nd of city.nodes) {
      nd.edges.forEach((eid, k) => {
        const e = city.edges[eid];
        this.armDir[this.base[nd.id] + k] = segDir(e.a === nd.id ? e.pts : reversed(e.pts), 0);
      });
      for (let k = 0; k <= nd.edges.length; k++) this.nodeOf[this.base[nd.id] + k] = nd.id;
    }
    n += 1;
    this.goal = n - 1;
    this.manhattan = city.edges.every((e) => e.pts.length === 2 && (e.pts[0].x === e.pts[1].x || e.pts[0].z === e.pts[1].z));
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.invMaxSpeed = 1 / Math.max(...city.edges.map((e) => e.speedLimit));
  }

  /** An edge's line from node center to node center, through its curve. */
  private full(e: RoadEdge): { line: Vec2[]; cum: number[] } {
    let f = this.lines.get(e);
    if (!f) {
      const line = [this.city.nodes[e.a].pos, ...e.pts, this.city.nodes[e.b].pos];
      this.lines.set(e, (f = { line, cum: cumulative(line) }));
    }
    return f;
  }

  /** Nearest point on any road centerline (node to node, through curves). */
  snap(p: Vec2): RoadPoint {
    const { city } = this;
    let best: RoadPoint | null = null;
    for (const e of city.edges) {
      const a = city.nodes[e.a].pos;
      const b = city.nodes[e.b].pos;
      if (e.pts.length === 2) {
        const t = segT(p, a, b);
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const d = Math.hypot(p.x - x, p.z - z);
        if (!best || d < best.dist) best = { edge: e, t, pos: { x, z }, dist: d };
        continue;
      }
      const { line, cum } = this.full(e);
      const pr = project(line, cum, p);
      if (!best || pr.dist < best.dist) best = { edge: e, t: pr.s / cum[cum.length - 1], pos: pointAt(line, cum, pr.s), dist: pr.dist };
    }
    return best!;
  }

  /** Direction of travel along edge e at fraction t, heading for node `to`. */
  private travelDir(e: RoadEdge, t: number, to: number): Vec2 {
    const { line, cum } = this.full(e);
    const L = cum[cum.length - 1];
    let d: Vec2;
    if (e.pts.length === 2) {
      const a = this.city.nodes[e.a].pos;
      const b = this.city.nodes[e.b].pos;
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      d = { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
    } else {
      const s = Math.min(L - 1e-6, Math.max(1e-6, t * L));
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < s) i++;
      d = segDir(line, i);
    }
    return to === e.b ? d : { x: -d.x, z: -d.z };
  }

  /** State for arriving at `node` along edge `eid`. */
  private stateOf(node: number, eid: number): number {
    return this.base[node] + this.city.nodes[node].edges.indexOf(eid);
  }

  findRoute(fromPos: Vec2, toPos: Vec2, opts: RouteOptions = {}): Route | null {
    const { city, costs } = this;
    const from = this.snap(fromPos);
    const to = this.snap(toPos);
    this.begin();

    // Start: drive along the start edge toward either end node.
    for (const [node, frac] of [
      [from.edge.a, from.t],
      [from.edge.b, 1 - from.t],
    ] as const) {
      const other = city.otherNode(from.edge, node);
      if (!city.lanesLeaving(from.edge, other).length) continue;
      const cost = (frac * from.edge.length) / from.edge.speedLimit + this.startPenalty(this.travelDir(from.edge, from.t, node), opts);
      this.relax(this.stateOf(node, from.edge.id), cost, -1, this.h(node, to.pos));
    }
    // Start and goal on the same edge: drive straight there.
    if (from.edge === to.edge && from.t !== to.t && (opts.goalFrom === undefined || opts.goalFrom === (to.t > from.t ? from.edge.a : from.edge.b))) {
      const ab = to.t > from.t;
      const lanes = ab ? from.edge.lanesAB : from.edge.lanesBA;
      if (lanes.length) {
        const dir = this.travelDir(from.edge, from.t, ab ? from.edge.b : from.edge.a);
        const cost = (Math.abs(to.t - from.t) * from.edge.length) / from.edge.speedLimit + this.startPenalty(dir, opts);
        this.relax(this.goal, cost, -1, 0);
      }
    }

    while (this.heapS.length) {
      const s = this.pop();
      if (this.closed[s] === this.stamp) continue;
      this.closed[s] = this.stamp;
      if (s === this.goal) return this.build(from, to, this.g[s]);
      this.expanded++;
      const node = this.nodeOf[s];
      const arrive = s - this.base[node];
      const n = city.nodes[node];
      const gs = this.g[s];
      const pass = n.signalized ? costs.signal : n.control === 'stop' ? costs.stop : 0;

      for (let k = 0; k < n.edges.length; k++) {
        const e = city.edges[n.edges[k]];
        if (!city.lanesLeaving(e, node).length) continue;
        const next = city.otherNode(e, node);
        const turn = this.turnCost(node, arrive, k);
        if (turn === Infinity) continue;
        if (e === to.edge && (opts.goalFrom === undefined || opts.goalFrom === node)) {
          const frac = next === to.edge.b ? to.t : 1 - to.t;
          this.relax(this.goal, gs + pass + turn + (frac * e.length) / e.speedLimit, s, 0);
        }
        const cost = gs + pass + turn + e.length / e.speedLimit;
        this.relax(this.stateOf(next, e.id), cost, s, this.h(next, to.pos));
      }
    }
    return null;
  }

  private build(from: RoadPoint, to: RoadPoint, cost: number): Route {
    const nodes: number[] = [];
    const via: number[] = [];
    for (let s = this.parent[this.goal]; s >= 0; s = this.parent[s]) {
      const node = this.nodeOf[s];
      nodes.push(node);
      via.push(this.city.nodes[node].edges[s - this.base[node]]);
    }
    nodes.reverse();
    via.reverse();
    // Points along the centerlines: through each curved edge's own points, straight between node centers otherwise
    const city = this.city;
    const points: Vec2[] = [from.pos];
    const tAt = (e: RoadEdge, node: number) => (node === e.b ? 1 : 0);
    if (!nodes.length) points.push(...this.along(from.edge, from.t, to.t));
    nodes.forEach((id, i) => {
      const e = city.edges[via[i]];
      points.push(...this.along(e, i === 0 ? from.t : tAt(e, nodes[i - 1]), tAt(e, id)), city.nodes[id].pos);
    });
    if (nodes.length) points.push(...this.along(to.edge, tAt(to.edge, nodes[nodes.length - 1]), to.t));
    points.push(to.pos);
    for (let i = points.length - 1; i > 0; i--) {
      const a = points[i - 1];
      const b = points[i];
      if (Math.abs(a.x - b.x) + Math.abs(a.z - b.z) < 0.01) points.splice(i, 1);
    }
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    return { nodes, points, length, cost };
  }

  private startPenalty(dir: Vec2, opts: RouteOptions): number {
    const h = opts.heading;
    return h && dot(h, dir) < -0.3 * Math.hypot(h.x, h.z) ? (opts.noUTurn ? Infinity : this.costs.uTurn) : 0;
  }

  /** Interior points of edge e's line strictly between fractions t0 and t1, in travel order (none on straight roads). */
  private along(e: RoadEdge, t0: number, t1: number): Vec2[] {
    if (e.pts.length <= 2) return [];
    const { line, cum } = this.full(e);
    const L = cum[cum.length - 1];
    const lo = Math.min(t0, t1) * L + 0.01;
    const hi = Math.max(t0, t1) * L - 0.01;
    const out = line.filter((_, i) => cum[i] > lo && cum[i] < hi);
    return t1 >= t0 ? out : out.reverse();
  }

  /**
   * Seconds for leaving `node` by its edge slot `depart` after arriving by slot `arrive` (the start slot: no
   * cost). Back out along the arrival edge is a U-turn (not allowed); within 35 degrees of straight is free;
   * otherwise a turn to the curb side or across traffic.
   */
  private turnCost(node: number, arrive: number, depart: number): number {
    const n = this.city.nodes[node];
    if (arrive === n.edges.length) return 0;
    if (arrive === depart) return Infinity; // U-turn inside a junction
    const a = this.armDir[this.base[node] + arrive];
    const d0 = { x: -a.x, z: -a.z };
    const d1 = this.armDir[this.base[node] + depart];
    if (dot(d0, d1) > STRAIGHT_COS) return 0;
    const left = dot(d1, leftVec(d0)) > 0;
    return left === this.hardIsLeft ? this.costs.hardTurn : this.costs.easyTurn;
  }

  /** Lower bound on the time to the goal at top speed: Manhattan on an axis-aligned grid, else straight line. */
  private h(node: number, goal: Vec2): number {
    const p = this.city.nodes[node].pos;
    const d = this.manhattan ? Math.abs(p.x - goal.x) + Math.abs(p.z - goal.z) : Math.hypot(p.x - goal.x, p.z - goal.z);
    return d * this.invMaxSpeed;
  }

  private begin(): void {
    this.stamp++;
    this.heapF.length = 0;
    this.heapS.length = 0;
    this.expanded = 0;
  }

  private relax(s: number, g: number, parent: number, h: number): void {
    if (g === Infinity || this.closed[s] === this.stamp) return;
    if (this.seen[s] === this.stamp && this.g[s] <= g) return;
    this.seen[s] = this.stamp;
    this.g[s] = g;
    this.parent[s] = parent;
    this.push(g + h, s);
  }

  private push(f: number, s: number): void {
    const F = this.heapF;
    const S = this.heapS;
    let i = F.length;
    F.push(f);
    S.push(s);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= f) break;
      F[i] = F[p];
      S[i] = S[p];
      i = p;
    }
    F[i] = f;
    S[i] = s;
  }

  private pop(): number {
    const F = this.heapF;
    const S = this.heapS;
    const top = S[0];
    const f = F.pop()!;
    const s = S.pop()!;
    const n = F.length;
    if (n === 0) return top;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && F[c + 1] < F[c]) c++;
      if (F[c] >= f) break;
      F[i] = F[c];
      S[i] = S[c];
      i = c;
    }
    F[i] = f;
    S[i] = s;
    return top;
  }
}
