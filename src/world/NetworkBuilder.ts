import { CONFIG, KMH } from '../config';
import type { Lane, RoadEdge, RoadNode, Vec2 } from '../types';
import { cumulative, offset, reversed, sampleCatmull, segDir, slice } from './Polyline';
import type { CityModel } from './RoadGraph';

/** One road between two nodes of a hand-made or generated network (T38; Lumina's generator uses it too). */
export interface EdgeSpec {
  a: number;
  b: number;
  /** Points the centerline passes through between the two nodes (Catmull-Rom); none = straight. */
  via?: Vec2[];
  /** Or the full centerline from node a to node b, already sampled (arcs, ring roads). */
  line?: Vec2[];
  lanesPerDir: number;
  /** Lanes only run a -> b. */
  oneWay?: boolean;
  avenue?: boolean;
  speedKmh: number;
  /** Road width curb to curb (default: lanes x lane width, plus the median on avenues; one-way: +2 m). */
  width?: number;
}

/** Lane width for hand-made networks (Montreal's grid sets widths per street class in `maps/montreal/layout.ts`). */
const LANE = 6;
const LW = () => LANE;

/**
 * Turns node positions and edge specs into the city's road graph: centerlines trimmed back to each junction,
 * convex junction polygons sized so arms meeting at sharp angles don't overlap outside them, lanes offset on
 * the drive side (start 1 m past the junction, stop line `STOP_OFFSET` before the next). Sets `signalized` /
 * `control` (3+ arms = signal) and registers every edge. Call `city.finishLayout()` once blocks exist.
 */
export function buildNetwork(city: CityModel, positions: Vec2[], specs: EdgeSpec[]): void {
  const nodes: RoadNode[] = positions.map((pos, id) => ({
    id,
    gi: -1,
    gj: -1,
    pos: { ...pos },
    hx: 0,
    hz: 0,
    edges: [],
    signalized: false,
    poly: [],
    control: 'none',
  }));
  city.nodes.push(...nodes);

  const lines = specs.map((s) => s.line ?? (s.via?.length ? sampleCatmull([positions[s.a], ...s.via, positions[s.b]]) : [positions[s.a], positions[s.b]]));
  const width = (s: EdgeSpec) => s.width ?? s.lanesPerDir * (s.oneWay ? 1 : 2) * LW() + (s.avenue ? 0.5 : 0) + (s.oneWay ? 2 : 0);

  // Arms at each node: direction away from the node and half width
  const arms: { spec: number; dir: Vec2; hw: number }[][] = nodes.map(() => []);
  specs.forEach((s, k) => {
    const l = lines[k];
    const hw = width(s) / 2;
    arms[s.a].push({ spec: k, dir: segDir(l, 0), hw });
    const r = reversed(l);
    arms[s.b].push({ spec: k, dir: segDir(r, 0), hw });
  });
  const radius = arms.map((list) => {
    if (list.length === 0) return 0;
    let r = Math.max(...list.map((a) => a.hw)) + 1.5;
    if (list.length === 2 && list[0].dir.x * list[1].dir.x + list[0].dir.z * list[1].dir.z < -0.9) return Math.max(...list.map((a) => a.hw));
    const sorted = list.map((a) => ({ ...a, ang: Math.atan2(a.dir.z, a.dir.x) })).sort((p, q) => p.ang - q.ang);
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const q = sorted[(i + 1) % sorted.length];
      let gap = q.ang - p.ang;
      if (gap <= 0) gap += Math.PI * 2;
      if (gap < Math.PI) r = Math.max(r, Math.max(p.hw, q.hw) / Math.tan(gap / 2) + 1);
    }
    return Math.min(r, 30);
  });

  const side = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;
  const armPts: Vec2[][] = nodes.map(() => []);
  specs.forEach((s, k) => {
    const full = lines[k];
    const cum = cumulative(full);
    const L = cum[cum.length - 1];
    const ra = radius[s.a];
    const rb = radius[s.b];
    if (L - ra - rb < 4) throw new Error(`buildNetwork: edge ${s.a}-${s.b} too short for its junctions`);
    const pts = slice(full, cum, ra, L - rb);
    const a = nodes[s.a];
    const b = nodes[s.b];
    const lanesPerDir = s.lanesPerDir;
    const e: RoadEdge = {
      id: city.edges.length,
      a: a.id,
      b: b.id,
      axis: Math.abs(b.pos.x - a.pos.x) >= Math.abs(b.pos.z - a.pos.z) ? 'x' : 'z',
      pts,
      oneWay: !!s.oneWay,
      lanesPerDir,
      avenue: !!s.avenue,
      cls: s.avenue ? 'boulevard' : 'street',
      laneWidth: LW(),
      parking: 0,
      median: s.avenue ? 0.25 : 0,
      width: width(s),
      speedLimit: s.speedKmh * KMH,
      length: L,
      lanesAB: [],
      lanesBA: [],
    };
    city.edges.push(e);
    city.registerEdge(e);
    a.edges.push(e.id);
    b.edges.push(e.id);

    // Junction polygon corners where the trimmed road meets each end
    const hw = e.width / 2;
    const d0 = segDir(pts, 0);
    const d1 = segDir(reversed(pts), 0);
    const p0 = pts[0];
    const p1 = pts[pts.length - 1];
    armPts[a.id].push({ x: p0.x + d0.z * hw, z: p0.z - d0.x * hw }, { x: p0.x - d0.z * hw, z: p0.z + d0.x * hw });
    armPts[b.id].push({ x: p1.x + d1.z * hw, z: p1.z - d1.x * hw }, { x: p1.x - d1.z * hw, z: p1.z + d1.x * hw });

    const med = e.median;
    const lane = (line: Vec2[], from: RoadNode, to: RoadNode, index: number, lateral: number): number => {
      const off = offset(line, lateral);
      const oc = cumulative(off);
      const ol = oc[oc.length - 1];
      const lp = slice(off, oc, 1, ol - CONFIG.STOP_OFFSET);
      const lc = cumulative(lp);
      const l: Lane = {
        id: city.lanes.length,
        edgeId: e.id,
        from: from.id,
        to: to.id,
        index,
        start: lp[0],
        end: lp[lp.length - 1],
        dir: segDir(lp, 0),
        endDir: segDir(lp, lp.length - 2),
        pts: lp,
        cum: lc,
        length: lc[lc.length - 1],
      };
      city.lanes.push(l);
      return l.id;
    };
    if (e.oneWay) {
      const span = lanesPerDir * LW();
      for (let k2 = 0; k2 < lanesPerDir; k2++) e.lanesAB.push(lane(pts, a, b, k2, side * (LW() * (k2 + 0.5) - span / 2)));
    } else {
      const back = reversed(pts);
      for (let k2 = 0; k2 < lanesPerDir; k2++) {
        e.lanesAB.push(lane(pts, a, b, k2, side * (med + LW() * (k2 + 0.5))));
        e.lanesBA.push(lane(back, b, a, k2, side * (med + LW() * (k2 + 0.5))));
      }
    }
  });

  for (const n of nodes) {
    n.poly = convexHull(armPts[n.id]);
    let hx = 0;
    let hz = 0;
    for (const p of n.poly) {
      hx = Math.max(hx, Math.abs(p.x - n.pos.x));
      hz = Math.max(hz, Math.abs(p.z - n.pos.z));
    }
    n.hx = hx;
    n.hz = hz;
    n.signalized = n.edges.length >= 3;
    n.control = n.signalized ? 'signal' : 'none';
  }
}

/** Convex hull (monotone chain), counter-clockwise in the shoelace sense of `polygonArea`. */
export function convexHull(points: Vec2[]): Vec2[] {
  const p = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
