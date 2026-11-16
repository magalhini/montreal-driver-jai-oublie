import type { AABB, Vec2 } from '../types';

const CELL = 16;
const key = (ix: number, iz: number) => (ix + 4096) * 8192 + (iz + 4096);

/**
 * Static AABB spatial hash with region queries and segment raycasts. Boxes with `off` set are skipped (doors).
 * Rotated boxes are hashed and returned by `query` by their bound; the segment tests use their `obb`.
 */
export class SpatialHash {
  readonly boxes: AABB[] = [];
  private cells = new Map<number, number[]>();
  private stamp: Uint32Array = new Uint32Array(0);
  private stampId = 1;

  constructor(boxes: AABB[]) {
    for (const b of boxes) this.insert(b);
    this.stamp = new Uint32Array(this.boxes.length);
  }

  private insert(b: AABB): void {
    const id = this.boxes.length;
    this.boxes.push(b);
    const x0 = Math.floor(b.minX / CELL);
    const x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL);
    const z1 = Math.floor(b.maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(id);
      }
    }
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: AABB[] = []): AABB[] {
    out.length = 0;
    const id = ++this.stampId;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(key(ix, iz));
        if (!arr) continue;
        for (const i of arr) {
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          const b = this.boxes[i];
          if (b.off || b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  /** True if the segment a→b intersects any box (only boxes taller than `minHeight` if they carry height). */
  segmentBlocked(a: Vec2, b: Vec2, filter?: (box: AABB) => boolean): boolean {
    const boxes = this.query(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), this.tmp);
    for (const box of boxes) {
      if (filter && !filter(box)) continue;
      if (segmentHitsBox(a, b, box)) return true;
    }
    return false;
  }

  /** Distance along ray to first hit, or Infinity. */
  rayDistance(a: Vec2, dir: Vec2, maxDist: number): number {
    const b = { x: a.x + dir.x * maxDist, z: a.z + dir.z * maxDist };
    const boxes = this.query(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), this.tmp);
    let best = Infinity;
    for (const box of boxes) {
      const t = segmentBoxT(a, b, box);
      if (t < best) best = t;
    }
    return best === Infinity ? Infinity : best * maxDist;
  }

  private tmp: AABB[] = [];
}

/** Slab test; returns entry t in 0..1 or Infinity. Rotated boxes (`obb`) are tested in their own frame. */
export function segmentBoxT(a: Vec2, b: Vec2, box: AABB): number {
  const o = box.obb;
  if (!o) return slabT(a.x, a.z, b.x - a.x, b.z - a.z, box.minX, box.maxX, box.minZ, box.maxZ);
  // Local axes: +X = (cos, -sin), +Z = (sin, cos) (see OrientedBox)
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const ax = a.x - o.cx;
  const az = a.z - o.cz;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return slabT(ax * c - az * s, ax * s + az * c, dx * c - dz * s, dx * s + dz * c, -o.hx, o.hx, -o.hz, o.hz);
}

function slabT(px: number, pz: number, dx: number, dz: number, minX: number, maxX: number, minZ: number, maxZ: number): number {
  let t0 = 0;
  let t1 = 1;
  for (const [p, d, lo, hi] of [
    [px, dx, minX, maxX],
    [pz, dz, minZ, maxZ],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return Infinity;
    } else {
      let ta = (lo - p) / d;
      let tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

export function segmentHitsBox(a: Vec2, b: Vec2, box: AABB): boolean {
  return segmentBoxT(a, b, box) !== Infinity;
}
