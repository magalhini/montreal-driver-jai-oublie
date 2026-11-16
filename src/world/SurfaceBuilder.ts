import * as THREE from 'three';
import type { Vec2 } from '../types';

export type HeightFn = (x: number, z: number) => number;

/**
 * Builds terrain-following surfaces: rectangular patches tessellated only where the ground is not planar,
 * strips along polylines and polygons of any shape (T41), and vertical walls (curbs, quay walls). Normals come from the height function so seams between patches
 * shade continuously. UVs are world x/z times `uvScale`.
 */
export class SurfaceBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  constructor(
    private h: HeightFn,
    private uvScale = 1,
    private color?: THREE.Color,
  ) {}

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c?: THREE.Color): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    const cc = c ?? this.color;
    if (cc) this.col.push(cc.r, cc.g, cc.b);
    return this.pos.length / 3 - 1;
  }

  /** Segments needed along one axis so the surface stays within 2 cm of the true height. */
  private segments(x0: number, z0: number, x1: number, z1: number, alongX: boolean, cell: number): number {
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.ceil(len / cell));
    const across = [0, 0.5, 1];
    for (const t of across) {
      const a = alongX ? z0 + (z1 - z0) * t : x0 + (x1 - x0) * t;
      const P = (s: number) => (alongX ? this.h(x0 + (x1 - x0) * s, a) : this.h(a, z0 + (z1 - z0) * s));
      const h0 = P(0);
      const h1 = P(1);
      for (let k = 1; k < n; k++) {
        const s = k / n;
        if (Math.abs(P(s) - (h0 + (h1 - h0) * s)) > 0.02) return n;
      }
    }
    return 1;
  }

  /** Terrain patch over [x0,x1] x [z0,z1] at height h + off, cells of about `cell` meters where it bends. */
  patch(x0: number, z0: number, x1: number, z1: number, off = 0, cell = 2, c?: THREE.Color, down = false): void {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
    const nx = this.segments(x0, z0, x1, z1, true, cell);
    const nz = this.segments(x0, z0, x1, z1, false, cell);
    const base = this.vertexCount;
    const e = 0.3;
    for (let j = 0; j <= nz; j++) {
      const z = z0 + ((z1 - z0) * j) / nz;
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx;
        const y = this.h(x, z);
        const dx = (this.h(x + e, z) - this.h(x - e, z)) / (2 * e);
        const dz = (this.h(x, z + e) - this.h(x, z - e)) / (2 * e);
        const l = Math.hypot(dx, 1, dz);
        const s = down ? -1 : 1;
        this.vert(x, y + off, z, (s * -dx) / l, s / l, (s * -dz) / l, x * this.uvScale, z * this.uvScale, c);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = base + j * (nx + 1) + i;
        const b = a + 1;
        const d = a + nx + 1;
        const cc = d + 1;
        if (down) this.idx.push(a, b, d, b, cc, d);
        else this.idx.push(a, d, b, b, d, cc);
      }
    }
  }

  /** A vertex on the surface at (x, z) + off, normal from the height field. */
  private surfVert(x: number, z: number, off: number, c?: THREE.Color): number {
    const e = 0.3;
    const dx = (this.h(x + e, z) - this.h(x - e, z)) / (2 * e);
    const dz = (this.h(x, z + e) - this.h(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    return this.vert(x, this.h(x, z) + off, z, -dx / l, 1 / l, -dz / l, x * this.uvScale, z * this.uvScale, c);
  }

  /** Upward-facing triangle (winding fixed from the xz positions); slivers with no area are dropped. */
  private tri(a: number, b: number, c: number): void {
    const P = this.pos;
    const cr = (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]) - (P[b * 3 + 2] - P[a * 3 + 2]) * (P[c * 3] - P[a * 3]);
    if (Math.abs(cr) < 2e-4) return;
    if (cr < 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  /** True when the straight line a-b strays more than 2 cm from the ground (sampled at quarters). */
  private bends(ax: number, az: number, bx: number, bz: number): boolean {
    const ha = this.h(ax, az);
    const hb = this.h(bx, bz);
    for (const t of [0.25, 0.5, 0.75]) if (Math.abs(this.h(ax + (bx - ax) * t, az + (bz - az) * t) - (ha + (hb - ha) * t)) > 0.02) return true;
    return false;
  }

  /**
   * Terrain-following strip between two polylines of equal length (`left[i]` faces `right[i]`): road
   * ribbons, curbstone bands. Each quad is split along and across where the ground bends (one across count
   * for the whole strip, so neighbors share their edges).
   */
  strip(left: Vec2[], right: Vec2[], off = 0, cell = 2, c?: THREE.Color): void {
    const n = Math.min(left.length, right.length);
    if (n < 2) return;
    let across = 1;
    for (let i = 0; i < n; i++) {
      const w = Math.hypot(right[i].x - left[i].x, right[i].z - left[i].z);
      if (this.bends(left[i].x, left[i].z, right[i].x, right[i].z)) across = Math.max(across, Math.ceil(w / cell));
    }
    const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    let prev: number[] = [];
    for (let i = 0; i < n; i++) {
      let steps = 1;
      if (i > 0) {
        const m0 = lerp(left[i - 1], right[i - 1], 0.5);
        const m1 = lerp(left[i], right[i], 0.5);
        const len = Math.hypot(m1.x - m0.x, m1.z - m0.z);
        if (len > cell && (this.bends(m0.x, m0.z, m1.x, m1.z) || this.bends(left[i - 1].x, left[i - 1].z, left[i].x, left[i].z) || this.bends(right[i - 1].x, right[i - 1].z, right[i].x, right[i].z)))
          steps = Math.ceil(len / cell);
      }
      for (let k = i === 0 ? steps : 1; k <= steps; k++) {
        const t = k / steps;
        const L = i === 0 ? left[0] : lerp(left[i - 1], left[i], t);
        const R = i === 0 ? right[0] : lerp(right[i - 1], right[i], t);
        const row: number[] = [];
        for (let j = 0; j <= across; j++) {
          const p = lerp(L, R, j / across);
          row.push(this.surfVert(p.x, p.z, off, c));
        }
        if (prev.length) for (let j = 0; j < across; j++) (this.tri(prev[j], prev[j + 1], row[j]), this.tri(prev[j + 1], row[j + 1], row[j]));
        prev = row;
      }
    }
  }

  /**
   * Terrain-following polygon (with holes): triangulated by `THREE.ShapeUtils`, then each triangle split
   * at edge midpoints where the edge is longer than `cell` and the ground bends under it. The split depends
   * only on the edge's endpoints, so triangles sharing an edge split it the same way (no cracks).
   */
  polygon(contour: Vec2[], holes: Vec2[][] = [], off = 0, cell = 4, c?: THREE.Color): void {
    const v2 = (pts: Vec2[]) => pts.map((p) => new THREE.Vector2(p.x, p.z));
    const all = [contour, ...holes].flat();
    const faces = THREE.ShapeUtils.triangulateShape(v2(contour), holes.map(v2));
    const split = (a: Vec2, b: Vec2) => {
      if (a.x > b.x || (a.x === b.x && a.z > b.z)) [a, b] = [b, a]; // same answer from both triangles
      return Math.hypot(b.x - a.x, b.z - a.z) > cell && this.bends(a.x, a.z, b.x, b.z);
    };
    const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    const emit = (a: Vec2, b: Vec2, d: Vec2, depth: number): void => {
      const sab = depth < 30 && split(a, b);
      const sbd = depth < 30 && split(b, d);
      const sda = depth < 30 && split(d, a);
      if (!sab && !sbd && !sda) {
        this.tri(this.surfVert(a.x, a.z, off, c), this.surfVert(b.x, b.z, off, c), this.surfVert(d.x, d.z, off, c));
        return;
      }
      const n = depth + 1;
      const mab = mid(a, b);
      const mbd = mid(b, d);
      const mda = mid(d, a);
      if (sab && sbd && sda) {
        emit(a, mab, mda, n);
        emit(mab, b, mbd, n);
        emit(mda, mbd, d, n);
        emit(mab, mbd, mda, n);
      } else if (sab && sbd) {
        emit(mab, b, mbd, n);
        emit(a, mab, mbd, n);
        emit(a, mbd, d, n);
      } else if (sbd && sda) {
        emit(mbd, d, mda, n);
        emit(b, mbd, mda, n);
        emit(b, mda, a, n);
      } else if (sda && sab) {
        emit(mda, a, mab, n);
        emit(d, mda, mab, n);
        emit(d, mab, b, n);
      } else if (sab) {
        emit(a, mab, d, n);
        emit(mab, b, d, n);
      } else if (sbd) {
        emit(b, mbd, a, n);
        emit(mbd, d, a, n);
      } else {
        emit(d, mda, b, n);
        emit(mda, a, b, n);
      }
    };
    for (const [i, j, k] of faces) emit(all[i], all[j], all[k], 0);
  }

  /**
   * Vertical wall along a line from (x0,z0) to (x1,z1) facing `normal`, from bottom(x,z) to top(x,z).
   * UV: u = distance along the wall, v = height.
   */
  wall(x0: number, z0: number, x1: number, z1: number, normal: { x: number; z: number }, bottom: HeightFn, top: HeightFn, cell = 2, c?: THREE.Color): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.01) return;
    const n = Math.max(1, Math.ceil(len / cell));
    const base = this.vertexCount;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const yb = bottom(x, z);
      const yt = Math.max(yb, top(x, z));
      this.vert(x, yb, z, normal.x, 0, normal.z, t * len * this.uvScale, yb * this.uvScale, c);
      this.vert(x, yt, z, normal.x, 0, normal.z, t * len * this.uvScale, yt * this.uvScale, c);
    }
    // wind so the face points along `normal`
    const dx = x1 - x0;
    const dz = z1 - z0;
    const flip = dx * normal.z - dz * normal.x < 0;
    for (let k = 0; k < n; k++) {
      const a = base + k * 2;
      const b = a + 1;
      const c2 = a + 2;
      const d = a + 3;
      if (flip) this.idx.push(a, b, c2, c2, b, d);
      else this.idx.push(a, c2, b, c2, d, b);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  mesh(material: THREE.Material): THREE.Mesh {
    return new THREE.Mesh(this.geometry(), material);
  }
}
