import { fwd, leftOf } from '../core/math';
import type { AABB, Facing, OrientedBox, Vec2 } from '../types';

/**
 * A building's local frame (T39). Facings are local: N = -Z, S = +Z, E = +X, W = -X, so an axis-aligned
 * building (yaw 0) reads exactly as before. Pure data: placement code turns local offsets into world points
 * with `at`, and gets each facade's outward normal, center and width from `faceOf`.
 */
export interface Frame {
  center: Vec2;
  yaw: number;
  /** World directions of the local +X and +Z axes (unit). */
  ax: Vec2;
  az: Vec2;
  /** Half extents along local X and Z. */
  hx: number;
  hz: number;
  /** World point at local (x, z) from the center. */
  at(x: number, z: number): Vec2;
  /** Local coordinates of a world point. */
  local(p: Vec2): Vec2;
  faceOf(f: Facing): Face;
}

export interface Face {
  facing: Facing;
  /** Outward unit normal (world). */
  normal: Vec2;
  /** Middle of the facade at ground level (world). */
  center: Vec2;
  /** Length of the facade. */
  width: number;
  /** World direction the facade's u coordinate runs along (local +X on N / S faces, +Z on E / W, as in the facade shader). */
  along: Vec2;
}

const LOCAL_N: Record<Facing, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** The frame of a box: its `obb` when it has one, else its AABB with yaw 0. */
export function frameOf(b: AABB): Frame {
  const o = b.obb;
  if (o) return makeFrame(o.cx, o.cz, o.hx, o.hz, o.yaw);
  return makeFrame((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2, 0);
}

function makeFrame(cx: number, cz: number, hx: number, hz: number, yaw: number): Frame {
  const ax = yaw === 0 ? { x: 1, z: 0 } : leftOf(yaw);
  const az = yaw === 0 ? { x: 0, z: 1 } : fwd(yaw);
  const at = (x: number, z: number): Vec2 => ({ x: cx + ax.x * x + az.x * z, z: cz + ax.z * x + az.z * z });
  return {
    center: { x: cx, z: cz },
    yaw,
    ax,
    az,
    hx,
    hz,
    at,
    local: (p) => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      return { x: dx * ax.x + dz * ax.z, z: dx * az.x + dz * az.z };
    },
    faceOf: (f) => {
      const [lx, lz] = LOCAL_N[f];
      const ns = f === 'N' || f === 'S';
      return {
        facing: f,
        normal: { x: ax.x * lx + az.x * lz, z: ax.z * lx + az.z * lz },
        center: at(lx * hx, lz * hz),
        width: ns ? 2 * hx : 2 * hz,
        along: ns ? { ...ax } : { ...az },
      };
    },
  };
}

/** Corners of an oriented box (world), counter-clockwise seen from above with yaw 0: -x-z, +x-z, +x+z, -x+z. */
export function obbCorners(o: OrientedBox): Vec2[] {
  const f = makeFrame(o.cx, o.cz, o.hx, o.hz, o.yaw);
  return [f.at(-o.hx, -o.hz), f.at(o.hx, -o.hz), f.at(o.hx, o.hz), f.at(-o.hx, o.hz)];
}

/** A rotated box as a collider: the AABB bound plus the exact shape. */
export function orientedBox(cx: number, cz: number, hx: number, hz: number, yaw: number): AABB & { obb: OrientedBox } {
  const obb = { cx, cz, hx, hz, yaw };
  const ex = Math.abs(Math.cos(yaw)) * hx + Math.abs(Math.sin(yaw)) * hz;
  const ez = Math.abs(Math.sin(yaw)) * hx + Math.abs(Math.cos(yaw)) * hz;
  return { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, obb };
}

/** True when two oriented boxes overlap, each grown by `margin` (separating axis test on their four axes). */
export function obbsOverlap(a: OrientedBox, b: OrientedBox, margin = 0): boolean {
  const axes = [leftOf(a.yaw), fwd(a.yaw), leftOf(b.yaw), fwd(b.yaw)];
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const r = (o: OrientedBox, n: Vec2) => {
    const x = leftOf(o.yaw);
    const z = fwd(o.yaw);
    return (o.hx + margin) * Math.abs(x.x * n.x + x.z * n.z) + (o.hz + margin) * Math.abs(z.x * n.x + z.z * n.z);
  };
  return axes.every((n) => Math.abs(dx * n.x + dz * n.z) < r(a, n) + r(b, n));
}

/**
 * Where to lay out a building's dressing (T40): `box` with facings on its sides as on any AABB, then `point` /
 * `dir` map the results to the world. An axis-aligned building is laid out in world coordinates (its own
 * AABB, identity mapping, so the output is exactly what it always was); a rotated one in its local frame,
 * centered on 0, placed by the frame's yaw.
 */
export interface Layout {
  box: AABB;
  /** Null for axis-aligned buildings (identity mapping). */
  frame: Frame | null;
  point(p: Vec2): Vec2;
  dir(v: Vec2): Vec2;
}

const SAME = (v: Vec2): Vec2 => v;

export function layoutOf(b: AABB): Layout {
  if (!b.obb) return { box: b, frame: null, point: SAME, dir: SAME };
  const f = frameOf(b);
  return {
    box: { minX: -f.hx, maxX: f.hx, minZ: -f.hz, maxZ: f.hz },
    frame: f,
    point: (p) => f.at(p.x, p.z),
    dir: (v) => ({ x: f.ax.x * v.x + f.az.x * v.z, z: f.ax.z * v.x + f.az.z * v.z }),
  };
}
