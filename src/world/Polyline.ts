import type { Vec2 } from '../types';

/**
 * Polylines (T37): the shape of every road edge and lane. Pure math on `Vec2[]` with a cumulative length
 * table (`cum[i]` = arc length at `pts[i]`, `cum[0] = 0`). Grid roads are two-point lines; curved roads are
 * sampled about every 2 m with the helpers at the bottom.
 */

export function cumulative(pts: Vec2[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return cum;
}

/** Segment index containing arc length s (clamped to the line). */
export function segmentAt(cum: number[], s: number): number {
  const last = cum.length - 2;
  if (s <= 0) return 0;
  if (s >= cum[last + 1]) return last;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Point at arc length s (clamped). */
export function pointAt(pts: Vec2[], cum: number[], s: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
  const i = segmentAt(cum, s);
  const l = cum[i + 1] - cum[i] || 1;
  const t = Math.min(1, Math.max(0, (s - cum[i]) / l));
  out.x = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
  out.z = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
  return out;
}

/** Unit direction of the segment at arc length s. */
export function tangentAt(pts: Vec2[], cum: number[], s: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
  const i = segmentAt(cum, s);
  return segDir(pts, i, out);
}

export function segDir(pts: Vec2[], i: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
  const dx = pts[i + 1].x - pts[i].x;
  const dz = pts[i + 1].z - pts[i].z;
  const l = Math.hypot(dx, dz) || 1;
  out.x = dx / l;
  out.z = dz / l;
  return out;
}

export interface Projection {
  /** Arc length of the closest point (clamped to the line). */
  s: number;
  /** Signed distance to the left of the line (positive = left, as `leftVec`). */
  lateral: number;
  /** Segment index of the closest point. */
  seg: number;
  /** Distance to the closest point. */
  dist: number;
}

/** Closest point on the line to p. */
export function project(pts: Vec2[], cum: number[], p: Vec2): Projection {
  let best: Projection = { s: 0, lateral: 0, seg: 0, dist: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const dx = pts[i + 1].x - a.x;
    const dz = pts[i + 1].z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    const qx = a.x + dx * t - p.x;
    const qz = a.z + dz * t - p.z;
    const d = Math.hypot(qx, qz);
    if (d < best.dist) {
      const l = Math.sqrt(l2);
      // left of (dx, dz) is (dz, -dx): lateral = (p - a) . left / |d|
      best = { s: cum[i] + t * l, lateral: ((p.x - a.x) * dz - (p.z - a.z) * dx) / l, seg: i, dist: d };
    }
  }
  return best;
}

/**
 * The line shifted sideways by d (positive = left). Joints are mitered, with the miter capped at 4x d so
 * a hairpin does not shoot a spike out.
 */
export function offset(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  if (n < 2) return pts.map((p) => ({ ...p }));
  const dirs: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) dirs.push(segDir(pts, i));
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = dirs[Math.max(0, i - 1)];
    const b = dirs[Math.min(n - 2, i)];
    // left normals
    const nax = a.z;
    const naz = -a.x;
    const nbx = b.z;
    const nbz = -b.x;
    let mx = nax + nbx;
    let mz = naz + nbz;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      mx = nbx;
      mz = nbz;
    } else {
      mx /= ml;
      mz /= ml;
    }
    const cos = mx * nbx + mz * nbz;
    const k = Math.min(4, 1 / Math.max(cos, 0.25));
    out.push({ x: pts[i].x + mx * d * k, z: pts[i].z + mz * d * k });
  }
  return out;
}

/** Copy of the line cut to arc lengths [s0, s1]. */
export function slice(pts: Vec2[], cum: number[], s0: number, s1: number): Vec2[] {
  const out = [pointAt(pts, cum, s0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push({ ...pts[i] });
  out.push(pointAt(pts, cum, s1));
  return out;
}

export const reversed = (pts: Vec2[]): Vec2[] => pts.slice().reverse();

/** Number of pieces to cut a curve of this length into for about `step` meter spacing. */
const pieces = (length: number, step: number) => Math.max(1, Math.ceil(length / step));

/** Cubic Bézier from a to d with control points b, c, sampled about every `step` meters (end points included). */
export function sampleBezier(a: Vec2, b: Vec2, c: Vec2, d: Vec2, step = 2): Vec2[] {
  const rough = Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z) + Math.hypot(d.x - c.x, d.z - c.z);
  const n = pieces(rough, step);
  const out: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push({ x: w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x, z: w0 * a.z + w1 * b.z + w2 * c.z + w3 * d.z });
  }
  return out;
}

/** Circular arc around c from angle a0 to a1 (radians, measured with x = sin, z = cos like yaw). */
export function sampleArc(c: Vec2, r: number, a0: number, a1: number, step = 2): Vec2[] {
  const n = pieces(Math.abs(a1 - a0) * r, step);
  const out: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push({ x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r });
  }
  return out;
}

/** Centripetal Catmull-Rom through the control points (end points included), about every `step` meters. */
export function sampleCatmull(ctrl: Vec2[], step = 2): Vec2[] {
  if (ctrl.length < 3) return ctrl.map((p) => ({ ...p }));
  const P = [mirror(ctrl[1], ctrl[0]), ...ctrl, mirror(ctrl[ctrl.length - 2], ctrl[ctrl.length - 1])];
  const out: Vec2[] = [{ ...ctrl[0] }];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1e-4);
    const t2 = t1 + Math.sqrt(Math.hypot(p2.x - p1.x, p2.z - p1.z) || 1e-4);
    const t3 = t2 + Math.sqrt(Math.hypot(p3.x - p2.x, p3.z - p2.z) || 1e-4);
    const n = pieces(Math.hypot(p2.x - p1.x, p2.z - p1.z), step);
    for (let k = 1; k <= n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const A1 = mixT(p0, p1, t0, t1, t);
      const A2 = mixT(p1, p2, t1, t2, t);
      const A3 = mixT(p2, p3, t2, t3, t);
      const B1 = mixT(A1, A2, t0, t2, t);
      const B2 = mixT(A2, A3, t1, t3, t);
      out.push(mixT(B1, B2, t1, t2, t));
    }
  }
  return out;
}

const mirror = (p: Vec2, about: Vec2): Vec2 => ({ x: 2 * about.x - p.x, z: 2 * about.z - p.z });
function mixT(a: Vec2, b: Vec2, ta: number, tb: number, t: number): Vec2 {
  const w = (t - ta) / (tb - ta || 1);
  return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
}
