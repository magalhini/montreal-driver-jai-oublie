import type { Rng } from '../core/Rng';
import type { AABB, Block, Building, Lane, RoadEdge, RoadNode, Vec2 } from '../types';
import type { CityFeatures } from './Features';
import type { CityGround } from './Ground';
import { pointAt, project } from './Polyline';
import { RoadIndex, type RoadHit } from './RoadIndex';

export type { RoadHit } from './RoadIndex';

/** Point at fraction t of a lane's length (two-point lanes: the plain lerp the grid always used). */
export function lanePoint(l: Lane, t: number): Vec2 {
  if (l.pts.length > 2) return pointAt(l.pts, l.cum, t * l.length);
  return { x: l.start.x + (l.end.x - l.start.x) * t, z: l.start.z + (l.end.z - l.start.z) * t };
}

/** City data: road graph, blocks and buildings plus spatial queries. Pure data, no three.js. */
export class CityModel {
  xs: number[] = []; // vertical road centerlines (run along Z)
  zs: number[] = []; // horizontal road centerlines (run along X)
  hwX: number[] = []; // half width of vertical road i
  hwZ: number[] = []; // half width of horizontal road j
  nodes: RoadNode[] = [];
  edges: RoadEdge[] = [];
  lanes: Lane[] = [];
  blocks: Block[] = [];
  buildings: Building[] = [];
  /** Extra static colliders (boundary walls etc.). */
  walls: AABB[] = [];
  bounds: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  depotBlock!: Block;
  depotPos: Vec2 = { x: 0, z: 0 };
  waterZ = 0;
  /** Junctions stay at height 0. Tokyo leaves this off and keeps its hills. */
  flatGround = false;
  features!: CityFeatures;
  terrain!: CityGround;
  private edgeMap = new Map<string, RoadEdge>();
  private index: RoadIndex | null = null;

  get nx(): number {
    return this.xs.length;
  }
  get nz(): number {
    return this.zs.length;
  }

  nodeAt(i: number, j: number): RoadNode {
    return this.nodes[j * this.nx + i];
  }

  registerEdge(e: RoadEdge): void {
    this.edgeMap.set(`${Math.min(e.a, e.b)}_${Math.max(e.a, e.b)}`, e);
  }

  edgeBetween(a: number, b: number): RoadEdge | undefined {
    return this.edgeMap.get(`${Math.min(a, b)}_${Math.max(a, b)}`);
  }

  otherNode(e: RoadEdge, n: number): number {
    return e.a === n ? e.b : e.a;
  }

  /** Lanes on edge e that leave node n. */
  lanesLeaving(e: RoadEdge, n: number): number[] {
    return e.a === n ? e.lanesAB : e.lanesBA;
  }

  lanesEntering(e: RoadEdge, n: number): number[] {
    return e.b === n ? e.lanesAB : e.lanesBA;
  }

  /** Build the spatial index (T38): call once nodes, edges, lanes and blocks exist, before any query below. */
  finishLayout(): void {
    this.index = new RoadIndex(this.nodes, this.edges, this.lanes, this.blocks);
  }

  private get idx(): RoadIndex {
    if (!this.index) throw new Error('CityModel: finishLayout() not called yet');
    return this.index;
  }

  roadAt(p: Vec2): RoadHit | null {
    return this.idx.roadAt(p);
  }

  /** Lane whose half of the road contains p (by lateral offset), and p's offset from its line (+ = left). */
  laneOnEdge(e: RoadEdge, p: Vec2): { lane: Lane; lateral: number } {
    return this.idx.laneOnEdge(e, p);
  }

  laneAt(p: Vec2): { lane: Lane; lateral: number } | null {
    const hit = this.roadAt(p);
    if (!hit || !hit.edge) return null;
    return this.laneOnEdge(hit.edge, p);
  }

  blockAt(p: Vec2): Block | null {
    return this.idx.blockAt(p);
  }

  /** Point inside a junction (or within `margin` of it)? */
  nodeBoxAt(p: Vec2, margin = 0): RoadNode | null {
    return this.idx.nodeBoxAt(p, margin);
  }

  nearestNode(p: Vec2): RoadNode {
    return this.idx.nearestNode(p);
  }

  /** Nearest point on any lane's line; `t` is the fraction of the lane's length. */
  nearestLanePoint(p: Vec2): { lane: Lane; t: number; pos: Vec2; dist: number } {
    let bestLane = this.lanes[0];
    let bestT = 0;
    let bestD = Infinity;
    for (const l of this.lanes) {
      if (l.pts.length > 2) {
        const pr = project(l.pts, l.cum, p);
        if (pr.dist * pr.dist < bestD) {
          bestD = pr.dist * pr.dist;
          bestLane = l;
          bestT = pr.s / l.length;
        }
        continue;
      }
      const dx = l.end.x - l.start.x;
      const dz = l.end.z - l.start.z;
      const t = Math.max(0, Math.min(1, ((p.x - l.start.x) * dx + (p.z - l.start.z) * dz) / (l.length * l.length)));
      const qx = l.start.x + dx * t;
      const qz = l.start.z + dz * t;
      const d = (p.x - qx) ** 2 + (p.z - qz) ** 2;
      if (d < bestD) {
        bestD = d;
        bestLane = l;
        bestT = t;
      }
    }
    return { lane: bestLane, t: bestT, pos: lanePoint(bestLane, bestT), dist: Math.sqrt(bestD) };
  }

  /** Random lane point within an annulus around center (null if none found). */
  randomLanePointNear(rng: Rng, center: Vec2, rMin: number, rMax: number, tries = 30): { lane: Lane; t: number; pos: Vec2 } | null {
    for (let k = 0; k < tries; k++) {
      const lane = rng.pick(this.lanes);
      const t = rng.range(0.05, 0.85);
      const pos = lanePoint(lane, t);
      const d = Math.hypot(pos.x - center.x, pos.z - center.z);
      if (d >= rMin && d <= rMax) return { lane, t, pos };
    }
    return null;
  }

  edgeSpeedLimit(edgeId: number): number {
    return this.edges[edgeId].speedLimit;
  }
}
