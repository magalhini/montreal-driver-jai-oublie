import { CONFIG } from '../config';
import type { Block, Lane, RoadEdge, RoadNode, Vec2 } from '../types';

/** A straight piece of an edge's centerline with its frame (unit direction from `a`) and half width. */
interface Seg {
  edge: RoadEdge;
  /** Segment index in `edge.pts` (> 0: its start is a bend, covered by a disc of the half width). */
  i: number;
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  hw: number;
}

/** A node's convex junction polygon as outward half planes: inside when nx * x + nz * z - c <= 0 for all. */
interface NodeArea {
  node: RoadNode;
  planes: { nx: number; nz: number; c: number }[];
}

export interface RoadHit {
  edge: RoadEdge | null; // null when inside a junction
  node: RoadNode | null; // set when inside a junction
}

const CELL = 8;

/**
 * Spatial lookups on any road network (T38): which edge / junction / block a point is on, from a uniform hash
 * of edge segments, junction polygons and blocks. On the grid every frame here is axis-aligned, so the math
 * reduces exactly to the old column / row scans (unit directions are exactly 0 / ±1).
 */
export class RoadIndex {
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly segCells: (Seg[] | undefined)[];
  private readonly nodeCells: (NodeArea[] | undefined)[];
  private readonly blockCells: (Block[] | undefined)[];
  private readonly areas: NodeArea[];

  constructor(
    private readonly nodes: RoadNode[],
    edges: RoadEdge[],
    private readonly lanes: Lane[],
    blocks: Block[],
  ) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const grow = (x: number, z: number, r = 0) => {
      minX = Math.min(minX, x - r);
      minZ = Math.min(minZ, z - r);
      maxX = Math.max(maxX, x + r);
      maxZ = Math.max(maxZ, z + r);
    };
    for (const n of nodes) for (const p of n.poly) grow(p.x, p.z);
    for (const e of edges) for (const p of e.pts) grow(p.x, p.z, e.width / 2);
    for (const b of blocks) for (const p of b.poly) grow(p.x, p.z);
    this.x0 = Math.floor(minX - 1);
    this.z0 = Math.floor(minZ - 1);
    this.nx = Math.max(1, Math.ceil((maxX + 1 - this.x0) / CELL));
    this.nz = Math.max(1, Math.ceil((maxZ + 1 - this.z0) / CELL));
    const n = this.nx * this.nz;
    this.segCells = new Array(n);
    this.nodeCells = new Array(n);
    this.blockCells = new Array(n);

    for (const e of edges) {
      const hw = e.width / 2;
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i];
        const b = e.pts[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 1e-9) continue;
        const s: Seg = { edge: e, i, ax: a.x, az: a.z, ux: dx / len, uz: dz / len, len, hw };
        this.insert(this.segCells, Math.min(a.x, b.x) - hw, Math.min(a.z, b.z) - hw, Math.max(a.x, b.x) + hw, Math.max(a.z, b.z) + hw, s);
      }
    }
    this.areas = nodes.map((node) => ({ node, planes: halfPlanes(node.poly) }));
    for (const a of this.areas) {
      const [x0, z0, x1, z1] = bbox(a.node.poly);
      this.insert(this.nodeCells, x0, z0, x1, z1, a);
    }
    for (const b of blocks) this.insert(this.blockCells, b.min.x, b.min.z, b.max.x, b.max.z, b);
  }

  private insert<T>(cells: (T[] | undefined)[], x0: number, z0: number, x1: number, z1: number, item: T): void {
    const i0 = Math.max(0, Math.floor((x0 - this.x0) / CELL));
    const j0 = Math.max(0, Math.floor((z0 - this.z0) / CELL));
    const i1 = Math.min(this.nx - 1, Math.floor((x1 - this.x0) / CELL));
    const j1 = Math.min(this.nz - 1, Math.floor((z1 - this.z0) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        (cells[k] ??= []).push(item);
      }
    }
  }

  private cell(p: Vec2): number {
    const i = Math.floor((p.x - this.x0) / CELL);
    const j = Math.floor((p.z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  /** Junction (wins where they overlap) or edge under p, or null off the road. */
  roadAt(p: Vec2): RoadHit | null {
    const k = this.cell(p);
    if (k < 0) return null;
    const areas = this.nodeCells[k];
    if (areas) for (const a of areas) if (inside(a.planes, p.x, p.z, 0)) return { edge: null, node: a.node };
    const segs = this.segCells[k];
    if (segs) for (const s of segs) if (onSeg(s, p)) return { edge: s.edge, node: null };
    return null;
  }

  /** Lane whose part of the road contains p (by lateral offset), and p's offset from that lane's line (+ = left). */
  laneOnEdge(e: RoadEdge, p: Vec2): { lane: Lane; lateral: number } {
    const lat = lateralOn(e.pts, p);
    const LW = e.laneWidth;
    let ids: number[];
    let idx: number;
    if (e.oneWay) {
      // One-way lanes span the road side to side; like two-way roads, the last lane is at the drive-side curb
      ids = e.lanesAB;
      const toward = CONFIG.DRIVE_SIDE === 'left' ? lat : -lat;
      idx = Math.min(ids.length - 1, Math.max(0, Math.floor((toward + (ids.length * LW) / 2) / LW)));
    } else {
      const abSide = CONFIG.DRIVE_SIDE === 'left' ? lat > 0 : lat < 0;
      ids = abSide ? e.lanesAB : e.lanesBA;
      // The parking band counts as the curb lane
      idx = Math.min(ids.length - 1, Math.max(0, Math.floor((Math.abs(lat) - e.median) / LW)));
    }
    const lane = this.lanes[ids[idx]];
    return { lane, lateral: lateralOn(lane.pts, p) };
  }

  blockAt(p: Vec2): Block | null {
    const k = this.cell(p);
    if (k < 0) return null;
    const blocks = this.blockCells[k];
    if (!blocks) return null;
    for (const b of blocks) {
      if (p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z) continue;
      if (b.rect || inPolygon(b.poly, p.x, p.z)) return b;
    }
    return null;
  }

  /** Junction containing p, or within `margin` of its polygon (mitered: square corners on a box). */
  nodeBoxAt(p: Vec2, margin = 0): RoadNode | null {
    const hit = this.roadAt(p);
    if (hit?.node) return hit.node;
    if (margin > 0) for (const a of this.areas) if (inside(a.planes, p.x, p.z, margin)) return a.node;
    return null;
  }

  nearestNode(p: Vec2): RoadNode {
    let best = this.nodes[0];
    let bestD = Infinity;
    for (const n of this.nodes) {
      const d = (n.pos.x - p.x) ** 2 + (n.pos.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }
}

function onSeg(s: Seg, p: Vec2): boolean {
  const rx = p.x - s.ax;
  const rz = p.z - s.az;
  const along = rx * s.ux + rz * s.uz;
  if (along >= 0 && along <= s.len && Math.abs(rx * s.uz - rz * s.ux) <= s.hw) return true;
  // The outside of a bend: a disc at the joint
  return s.i > 0 && rx * rx + rz * rz <= s.hw * s.hw;
}

/** Signed offset of p from the closest segment of a line (+ = left of its direction, as `leftVec`). */
export function lateralOn(pts: Vec2[], p: Vec2): number {
  let best = Infinity;
  let lat = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const dx = pts[i + 1].x - a.x;
    const dz = pts[i + 1].z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const rx = p.x - a.x;
    const rz = p.z - a.z;
    const along = Math.min(len, Math.max(0, rx * ux + rz * uz));
    const d = (rx - ux * along) ** 2 + (rz - uz * along) ** 2;
    if (d < best) {
      best = d;
      lat = rx * uz - rz * ux;
    }
  }
  return lat;
}

function bbox(poly: Vec2[]): [number, number, number, number] {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    z0 = Math.min(z0, p.z);
    x1 = Math.max(x1, p.x);
    z1 = Math.max(z1, p.z);
  }
  return [x0, z0, x1, z1];
}

/** Shoelace area (sign = winding). */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Outward half planes of a convex polygon (either winding). */
function halfPlanes(poly: Vec2[]): { nx: number; nz: number; c: number }[] {
  const s = polygonArea(poly) >= 0 ? 1 : -1;
  const out: { nx: number; nz: number; c: number }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-9) continue;
    // With positive shoelace area (x * z' - x' * z > 0) the outside of edge a -> b is (dz, -dx)
    const nx = (dz / l) * s;
    const nz = (-dx / l) * s;
    out.push({ nx, nz, c: nx * a.x + nz * a.z });
  }
  return out;
}

function inside(planes: { nx: number; nz: number; c: number }[], x: number, z: number, margin: number): boolean {
  for (const h of planes) if (h.nx * x + h.nz * z - h.c > margin) return false;
  return planes.length > 0;
}

/** Even-odd point in polygon. */
export function inPolygon(poly: Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
