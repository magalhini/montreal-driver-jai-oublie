import { CONFIG } from '../config';
import { clamp } from '../core/math';
import type { Vec2 } from '../types';
import type { CityFeatures } from './Features';
import type { CityGround } from './Ground';
import type { CityModel } from './RoadGraph';
import { RAISED, surfaceAt } from './Surfaces';


/** Flat stretch before every junction (crosswalk + stop line stay level). */
export const FLAT = CONFIG.STOP_OFFSET + 1.5;
/** Length of the parabolic vertical curve at each end of a slope: shorter = sharper crests = more air. */
const EASE = 8;
export const MAX_GRADE = 0.17;
const HARBOR_WATER = -0.6;

/** Fraction 0..1 along a slope with parabolic ends of fraction e and a straight middle (C1 continuous). */
function ease(u: number, e: number): number {
  const m = 1 / (1 - e);
  if (u < e) return (m * u * u) / (2 * e);
  if (u > 1 - e) return 1 - (m * (1 - u) * (1 - u)) / (2 * e);
  return m * (u - e / 2);
}

/** Road height along an edge: flat by each junction, sloped between. */
export function profile(t: number, tA: number, tB: number, hA: number, hB: number): number {
  if (hA === hB) return hA;
  const a = tA + FLAT;
  const b = tB - FLAT;
  if (t <= a) return hA;
  if (t >= b) return hB;
  const span = b - a;
  return hA + (hB - hA) * ease((t - a) / span, Math.min(0.45, EASE / span));
}

const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * City height field (pure data). Junctions are flat at their node height; roads are level across and follow
 * a slope profile between junctions; blocks are Coons patches matching their four bounding roads; bridges add a
 * hump over the canal; jump ramps and the hotels' drive-up ramps and decks sit on top.
 */
export class Terrain implements CityGround {
  readonly nodeH: number[];

  constructor(
    private city: CityModel,
    private features: CityFeatures,
  ) {
    this.nodeH = computeNodeHeights(city);
  }

  node(i: number, j: number): number {
    return this.nodeH[j * this.city.nx + i];
  }

  /** Index of the road column whose strip (plus `margin`) contains x, or -1. */
  roadCol(x: number, margin = 0): number {
    const c = this.city;
    for (let i = 0; i < c.nx; i++) if (Math.abs(x - c.xs[i]) <= c.hwX[i] + margin) return i;
    return -1;
  }

  roadRow(z: number, margin = 0): number {
    const c = this.city;
    for (let j = 0; j < c.nz; j++) if (Math.abs(z - c.zs[j]) <= c.hwZ[j] + margin) return j;
    return -1;
  }

  /** Height along x-road row j between columns i and i + 1. */
  xRoad(j: number, i: number, x: number): number {
    const c = this.city;
    return profile(x, c.xs[i] + c.hwX[i], c.xs[i + 1] - c.hwX[i + 1], this.node(i, j), this.node(i + 1, j));
  }

  zRoad(i: number, j: number, z: number): number {
    const c = this.city;
    return profile(z, c.zs[j] + c.hwZ[j], c.zs[j + 1] - c.hwZ[j + 1], this.node(i, j), this.node(i, j + 1));
  }

  /** Terrain without bridges, ramps or the canal. */
  base(x: number, z: number): number {
    const c = this.city;
    const nx = c.nx;
    const nz = c.nz;
    let col = this.roadCol(x);
    let row = this.roadRow(z);
    // Beyond the outer roads the terrain continues level with them
    if (col < 0 && (x < c.xs[0] || x > c.xs[nx - 1])) col = x < c.xs[0] ? 0 : nx - 1;
    if (row < 0 && (z < c.zs[0] || z > c.zs[nz - 1])) row = z < c.zs[0] ? 0 : nz - 1;
    if (col >= 0 && row >= 0) return this.node(col, row);
    const si = col >= 0 ? col : spanIndex(c.xs, x);
    const sj = row >= 0 ? row : spanIndex(c.zs, z);
    if (col >= 0) return this.zRoad(col, sj, z);
    if (row >= 0) return this.xRoad(row, si, x);
    // Coons patch over block (si, sj)
    const x0 = c.xs[si] + c.hwX[si];
    const x1 = c.xs[si + 1] - c.hwX[si + 1];
    const z0 = c.zs[sj] + c.hwZ[sj];
    const z1 = c.zs[sj + 1] - c.hwZ[sj + 1];
    const u = clamp((x - x0) / (x1 - x0), 0, 1);
    const v = clamp((z - z0) / (z1 - z0), 0, 1);
    const h00 = this.node(si, sj);
    const h10 = this.node(si + 1, sj);
    const h01 = this.node(si, sj + 1);
    const h11 = this.node(si + 1, sj + 1);
    if (h00 === 0 && h10 === 0 && h01 === 0 && h11 === 0) return 0;
    const N = this.xRoad(sj, si, x);
    const S = this.xRoad(sj + 1, si, x);
    const W = this.zRoad(si, sj, z);
    const E = this.zRoad(si + 1, sj, z);
    return (1 - v) * N + v * S + (1 - u) * W + u * E - ((1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11);
  }

  /** Bridge hump above the base (0 off the bridge strips). */
  hump(x: number, z: number): number {
    const k = this.features.canal;
    if (!k) return 0;
    const d = Math.abs(z - k.zc);
    if (d >= k.humpHalf) return 0;
    if (this.roadCol(x, CONFIG.SIDEWALK) < 0) return 0;
    return (k.humpHeight / 2) * (1 + Math.cos((Math.PI * d) / k.humpHalf));
  }

  /** Over the canal water (not on a bridge)? */
  inCanal(x: number, z: number): boolean {
    const k = this.features.canal;
    return !!k && z > k.z0 && z < k.z1 && x > k.x0 && x < k.x1 && this.roadCol(x, CONFIG.SIDEWALK) < 0;
  }

  isWater(x: number, z: number): boolean {
    return this.inCanal(x, z);
  }

  heightAt(x: number, z: number): number {
    if (this.inCanal(x, z)) return this.features.canal!.bed;
    return this.base(x, z) + this.hump(x, z);
  }

  waterAt(x: number, z: number): number | null {
    if (this.inCanal(x, z)) return this.features.canal!.water;
    if (z > this.city.waterZ) return HARBOR_WATER;
    return null;
  }

  /** Raised sidewalk / block slab here (visual curb offset)? */
  curbAt(x: number, z: number): number {
    return RAISED[surfaceAt(this.city, { x, z })] ? CONFIG.CURB_HEIGHT : 0;
  }

  /** Visual ground: drivable height plus the curb on sidewalks. */
  surfaceY(x: number, z: number): number {
    return this.heightAt(x, z) + this.curbAt(x, z);
  }

  /** Height gradient (dh/dx, dh/dz) by central differences. */
  gradient(x: number, z: number, out: Vec2 = { x: 0, z: 0 }, e = 0.4): Vec2 {
    out.x = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    out.z = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return out;
  }
}

/** Index i with arr[i] < v < arr[i + 1], clamped to the valid spans. */
function spanIndex(arr: number[], v: number): number {
  for (let i = 0; i < arr.length - 1; i++) if (v < arr[i + 1]) return i;
  return arr.length - 2;
}

/**
 * Junction heights: a big hill in the north-west whose east-west streets bounce up and down (alternating
 * columns), and a smaller ridge in the north-east. Grades are relaxed to stay drivable.
 */
export function computeNodeHeights(city: CityModel): number[] {
  const nx = city.nx;
  const nz = city.nz;
  if (city.flatGround) return new Array<number>(nx * nz).fill(0);
  const h = new Array<number>(nx * nz).fill(0);
  // The hill grows with the grid (tuned on 10 x 10 blocks)
  const k = Math.min(nx - 1, nz - 1) / 10;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const d = Math.hypot((i - 1.6 * k) / (3.3 * k), (j - 1.4 * k) / (3.0 * k));
      const dome = 22 * smooth(1 - d);
      const bounce = (i % 2 === 0 ? 1 : -1) * 5 * smooth((1 - d) * 1.6);
      // the ridge sits near the north-east corner whatever the grid size
      const r = Math.hypot((i - (nx - 1 - 1.7)) / 2.0, (j - 2.0) / 1.25);
      const ridge = 12 * smooth(1 - r) + (i % 2 === 0 ? 1 : -1) * 3.5 * smooth((1 - r) * 1.5);
      h[j * nx + i] = Math.max(0, dome + bounce) + Math.max(0, ridge);
    }
  }
  // Relax edges steeper than MAX_GRADE over their sloped run
  for (let it = 0; it < 40; it++) {
    let worst = 0;
    for (const e of city.edges) {
      const a = city.nodes[e.a];
      const b = city.nodes[e.b];
      const ext = e.axis === 'x' ? a.hx + b.hx : a.hz + b.hz;
      const run = e.length - ext - 2 * FLAT;
      const maxD = MAX_GRADE * run;
      const d = h[b.id] - h[a.id];
      if (Math.abs(d) > maxD) {
        const fix = (Math.abs(d) - maxD) / 2 + 0.01;
        h[a.id] += Math.sign(d) * fix;
        h[b.id] -= Math.sign(d) * fix;
        worst = Math.max(worst, Math.abs(d) - maxD);
      }
    }
    if (worst < 0.01) break;
  }
  return h.map((v) => Math.round(Math.max(0, v) * 10) / 10);
}
