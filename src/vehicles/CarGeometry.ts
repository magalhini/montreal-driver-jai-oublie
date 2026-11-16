import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Geometry helpers. Profiles are (z, y) pairs in the car's side view: +z is the
// nose, y is up. Extrusions run across the width (x).
// ---------------------------------------------------------------------------

export type V2 = [number, number];
export type XY = [number, number];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Vector3();
export const PX = new THREE.Vector3(1, 0, 0);
export const PZ = new THREE.Vector3(0, 0, 1);
export const NZ = new THREE.Vector3(0, 0, -1);

/** Non-indexed copy without uvs; flat normals unless `smooth` (keeps the source normals). */
export function prep(g: THREE.BufferGeometry, smooth = false): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out.getAttribute('uv')) out.deleteAttribute('uv');
  if (!smooth) out.computeVertexNormals();
  return out;
}

export function fromArray(arr: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

/** Mirror across x = 0 (flips winding back to front-facing). */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const P: number[] = [];
  const N: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    for (const k of [i, i + 2, i + 1]) {
      P.push(-p.getX(k), p.getY(k), p.getZ(k));
      N.push(-n.getX(k), n.getY(k), n.getZ(k));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return out;
}

/** Convex polygon as a triangle fan, wound to face `facing`. */
export function fan(pts: THREE.Vector3[], facing: THREE.Vector3): THREE.BufferGeometry {
  const arr: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[0];
    let b = pts[i];
    let c = pts[i + 1];
    _n.subVectors(b, a).cross(_m.subVectors(c, a));
    if (_n.dot(facing) < 0) [b, c] = [c, b];
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  return fromArray(arr);
}

/** Flat polygon (x, y) on the plane z, facing +z (dir 1) or -z (dir -1). */
export function onZ(poly: XY[], z: number, dir: 1 | -1): THREE.BufferGeometry {
  return fan(
    poly.map(([x, y]) => new THREE.Vector3(x, y, z)),
    dir > 0 ? PZ : NZ,
  );
}

/** Flat polygon (z, y) on the plane x, facing +x. */
export function onX(poly: V2[], x: number): THREE.BufferGeometry {
  return fan(
    poly.map(([z, y]) => new THREE.Vector3(x, y, z)),
    PX,
  );
}

/**
 * Same panel as `onX`, split on a grid. A later warp bends each cell; one big quad would stay a
 * straight chord and cut through the curved side.
 */
export function onXGrid(poly: V2[], x: number, step: number): THREE.BufferGeometry {
  if (poly.length < 3 || step <= 0) return onX(poly, x);
  let z0 = Infinity;
  let z1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [z, y] of poly) {
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (z1 - z0 <= step * 1.5 && y1 - y0 <= step * 1.5) return onX(poly, x);
  const zs = [z0];
  for (let z = z0 + step; z < z1 - step * 0.25; z += step) zs.push(z);
  zs.push(z1);
  const ys = [y0];
  for (let y = y0 + step; y < y1 - step * 0.25; y += step) ys.push(y);
  ys.push(y1);
  const P: number[] = [];
  const N: number[] = [];
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const zA = zs[i];
      const zB = zs[i + 1];
      const yA = ys[j];
      const yB = ys[j + 1];
      let cell = clip(poly, [zA, yB], [zA, yA]);
      if (cell.length < 3) continue;
      cell = clip(cell, [zB, yA], [zB, yB]);
      if (cell.length < 3) continue;
      cell = clip(cell, [zA, yA], [zB, yA]);
      if (cell.length < 3) continue;
      cell = clip(cell, [zB, yB], [zA, yB]);
      if (cell.length < 3) continue;
      const g = onX(cell, x);
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      for (let k = 0; k < p.count; k++) {
        P.push(p.getX(k), p.getY(k), p.getZ(k));
        N.push(n.getX(k), n.getY(k), n.getZ(k));
      }
    }
  }
  if (P.length === 0) return onX(poly, x);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return g;
}

/** Rounded rectangle outline centered at (cx, cy). */
export function rrect(cx: number, cy: number, w: number, h: number, rad: number, seg = 2): XY[] {
  const out: XY[] = [];
  const r = Math.min(rad, w / 2, h / 2);
  const corners: XY[] = [
    [cx + w / 2 - r, cy + h / 2 - r],
    [cx - w / 2 + r, cy + h / 2 - r],
    [cx - w / 2 + r, cy - h / 2 + r],
    [cx + w / 2 - r, cy - h / 2 + r],
  ];
  corners.forEach(([x, y], q) => {
    for (let i = 0; i <= seg; i++) {
      const a = (q + i / seg) * (Math.PI / 2);
      out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
  });
  return out;
}

export function circle(cx: number, cy: number, r: number, n = 18): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < n; i++) out.push([cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r]);
  return out;
}

export function ring(r0: number, r1: number, x: number, y: number, z: number, dir: 1 | -1, n = 18): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(r0, r1, n, 1);
  if (dir < 0) g.rotateY(Math.PI);
  g.translate(x, y, z);
  return prep(g);
}

export interface Ext {
  g: THREE.BufferGeometry;
  cap: Uint8Array;
}

/**
 * Extrudes a (z, y) profile across the width, centered on x = 0. The bevel rounds the
 * edges between the flat sides (caps) and the profile surfaces without growing the outline.
 */
export function extrude(pts: V2[], width: number, bs: number, bt = bs, seg = 2, steps = 1): Ext {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const bevel = bs > 0 && bt > 0;
  const depth = Math.max(0.002, width - (bevel ? 2 * bt : 0));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps,
    curveSegments: 1,
    bevelEnabled: bevel,
    bevelThickness: bt,
    bevelSize: bs,
    bevelOffset: -bs,
    bevelSegments: seg,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  const cap = new Uint8Array(g.getAttribute('position').count / 3);
  for (const gr of g.groups) if (gr.materialIndex === 0) cap.fill(1, gr.start / 3, (gr.start + gr.count) / 3);
  g.clearGroups();
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return { g, cap };
}

const qPos = (v: number) => Math.round(v * 10000);
const posKey = (x: number, y: number, z: number) => `${qPos(x)},${qPos(y)},${qPos(z)}`;
const edgeKey = (a: number[], b: number[]) => {
  const A = posKey(a[0], a[1], a[2]);
  const B = posKey(b[0], b[1], b[2]);
  return A < B ? `${A}|${B}` : `${B}|${A}`;
};

interface SideTri {
  p: number[];
  cap: number;
}

function pushSide(a: number[], b: number[], c: number[], cap: number, out: SideTri[]): void {
  out.push({ p: [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]], cap });
}

/** Replace one triangle with the splits of the edges that have a midpoint this pass. Winding stays. */
function emitSplit(a: number[], b: number[], c: number[], mab: number[] | undefined, mbc: number[] | undefined, mca: number[] | undefined, cap: number, out: SideTri[]): void {
  const n = (mab ? 1 : 0) + (mbc ? 1 : 0) + (mca ? 1 : 0);
  if (n === 0) pushSide(a, b, c, cap, out);
  else if (n === 3 && mab && mbc && mca) {
    pushSide(a, mab, mca, cap, out);
    pushSide(mab, b, mbc, cap, out);
    pushSide(mca, mbc, c, cap, out);
    pushSide(mab, mbc, mca, cap, out);
  } else if (n === 1) {
    if (mab) {
      pushSide(a, mab, c, cap, out);
      pushSide(mab, b, c, cap, out);
    } else if (mbc) {
      pushSide(a, b, mbc, cap, out);
      pushSide(a, mbc, c, cap, out);
    } else if (mca) {
      pushSide(a, b, mca, cap, out);
      pushSide(mca, b, c, cap, out);
    }
  } else if (!mca && mab && mbc) {
    pushSide(a, mab, c, cap, out);
    pushSide(mab, mbc, c, cap, out);
    pushSide(mab, b, mbc, cap, out);
  } else if (!mab && mbc && mca) {
    pushSide(a, b, mbc, cap, out);
    pushSide(a, mbc, mca, cap, out);
    pushSide(mbc, c, mca, cap, out);
  } else if (mab && mca) {
    pushSide(a, mab, mca, cap, out);
    pushSide(mab, b, mca, cap, out);
    pushSide(mca, b, c, cap, out);
  }
}

/**
 * The extruded side is one polygon, so a warp that moves the outline by different amounts folds the
 * big triangles through the doors. Split long side edges, and the wall triangles that share them,
 * until the skin can follow the bend.
 */
export function refineSides(e: Ext, maxLen: number): void {
  const src = e.g.getAttribute('position').array as Float32Array;
  let tris: SideTri[] = [];
  for (let t = 0; t < e.cap.length; t++) {
    const o = t * 9;
    tris.push({
      p: [src[o], src[o + 1], src[o + 2], src[o + 3], src[o + 4], src[o + 5], src[o + 6], src[o + 7], src[o + 8]],
      cap: e.cap[t],
    });
  }
  const max2 = maxLen * maxLen;
  for (let pass = 0; pass < 12; pass++) {
    const mids = new Map<string, number[]>();
    const consider = (a: number[], b: number[]) => {
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const dz = a[2] - b[2];
      if (dx * dx + dy * dy + dz * dz <= max2) return;
      const k = edgeKey(a, b);
      if (!mids.has(k)) mids.set(k, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    };
    for (const t of tris) {
      if (!t.cap) continue;
      const v0 = t.p.slice(0, 3);
      const v1 = t.p.slice(3, 6);
      const v2 = t.p.slice(6, 9);
      consider(v0, v1);
      consider(v1, v2);
      consider(v2, v0);
    }
    if (mids.size === 0) break;
    const next: SideTri[] = [];
    for (const t of tris) {
      const a = t.p.slice(0, 3);
      const b = t.p.slice(3, 6);
      const c = t.p.slice(6, 9);
      emitSplit(a, b, c, mids.get(edgeKey(a, b)), mids.get(edgeKey(b, c)), mids.get(edgeKey(c, a)), t.cap, next);
    }
    tris = next;
  }
  const pos = new Float32Array(tris.length * 9);
  const cap = new Uint8Array(tris.length);
  for (let t = 0; t < tris.length; t++) {
    pos.set(tris[t].p, t * 9);
    cap[t] = tris[t].cap;
  }
  e.g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  e.g.deleteAttribute('normal');
  e.cap = cap;
}

/** Normals: flat on the caps, smoothed across profile/bevel faces that meet within `crease` radians. */
export function shade(e: Ext, crease = 0.9): THREE.BufferGeometry {
  const pa = e.g.getAttribute('position') as THREE.BufferAttribute;
  const p = pa.array as Float32Array;
  const tris = p.length / 9;
  const fnrm = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    _a.set(p[o], p[o + 1], p[o + 2]);
    _b.set(p[o + 3] - _a.x, p[o + 4] - _a.y, p[o + 5] - _a.z);
    _c.set(p[o + 6] - _a.x, p[o + 7] - _a.y, p[o + 8] - _a.z);
    _n.crossVectors(_b, _c).normalize();
    fnrm[t * 3] = _n.x;
    fnrm[t * 3 + 1] = _n.y;
    fnrm[t * 3 + 2] = _n.z;
  }
  const key = (v: number) => `${Math.round(p[v * 3] * 2000)},${Math.round(p[v * 3 + 1] * 2000)},${Math.round(p[v * 3 + 2] * 2000)}`;
  const shared = new Map<string, number[]>();
  for (let v = 0; v < tris * 3; v++) {
    if (e.cap[(v / 3) | 0]) continue;
    const k = key(v);
    const list = shared.get(k);
    if (list) list.push((v / 3) | 0);
    else shared.set(k, [(v / 3) | 0]);
  }
  const cos = Math.cos(crease);
  const out = new Float32Array(p.length);
  for (let v = 0; v < tris * 3; v++) {
    const t = (v / 3) | 0;
    let nx = fnrm[t * 3];
    let ny = fnrm[t * 3 + 1];
    let nz = fnrm[t * 3 + 2];
    if (!e.cap[t]) {
      const fx = nx;
      const fy = ny;
      const fz = nz;
      nx = ny = nz = 0;
      for (const u of shared.get(key(v)) ?? [t]) {
        const ux = fnrm[u * 3];
        const uy = fnrm[u * 3 + 1];
        const uz = fnrm[u * 3 + 2];
        if (ux * fx + uy * fy + uz * fz >= cos) {
          nx += ux;
          ny += uy;
          nz += uz;
        }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
    }
    out[v * 3] = nx;
    out[v * 3 + 1] = ny;
    out[v * 3 + 2] = nz;
  }
  e.g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return e.g;
}

/** Tumblehome: narrows everything above y0 linearly to scale s at y1. */
export function taper(g: THREE.BufferGeometry, y0: number, y1: number, s: number): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    p.setX(i, p.getX(i) * (1 + (s - 1) * k));
  }
  p.needsUpdate = true;
  return g;
}

/** Rounded box: rounded-rect profile in (z, y) extruded over [x0, x1] with soft edges. */
export function rbox(z0: number, z1: number, y0: number, y1: number, x0: number, x1: number, rad: number, bevel = 0.012): THREE.BufferGeometry {
  const pts = rrect((z0 + z1) / 2, (y0 + y1) / 2, Math.abs(z1 - z0), Math.abs(y1 - y0), rad, 2);
  const e = extrude(pts, x1 - x0, bevel, bevel, 1);
  e.g.translate((x0 + x1) / 2, 0, 0);
  return shade(e, 1.0);
}

/**
 * Quads that follow a (z, y) polyline over [x0, x1], lifted `off` along the outward normal.
 * The polyline must run front to rear over the top (outward = left-hand normal).
 */
export function strip(pts: V2[], x0: number, x1: number, off: number): THREE.BufferGeometry {
  const arr: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [az, ay] = pts[i];
    const [bz, by] = pts[i + 1];
    const l = Math.hypot(bz - az, by - ay) || 1;
    const nz = (by - ay) / l;
    const ny = -(bz - az) / l;
    const A = [ay + ny * off, az + nz * off];
    const B = [by + ny * off, bz + nz * off];
    arr.push(x0, A[0], A[1], x1, A[0], A[1], x1, B[0], B[1]);
    arr.push(x0, A[0], A[1], x1, B[0], B[1], x0, B[0], B[1]);
  }
  return fromArray(arr);
}

/** Point at parameter t (0..1) on segment a→b. */
export const lerp2 = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Sub-polyline between z0 > z1 of a front-to-rear polyline, endpoints interpolated. */
export function slice(pts: V2[], z0: number, z1: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a[0] < z1 || b[0] > z0 || a[0] === b[0]) continue;
    const ta = THREE.MathUtils.clamp((z0 - a[0]) / (b[0] - a[0]), 0, 1);
    const tb = THREE.MathUtils.clamp((z1 - a[0]) / (b[0] - a[0]), 0, 1);
    if (out.length === 0) out.push(lerp2(a, b, ta));
    out.push(lerp2(a, b, tb));
  }
  return out;
}

/** Height of a front-to-rear polyline at z. */
export function yAt(pts: V2[], z: number): number {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (z <= a[0] && z >= b[0] && a[0] !== b[0]) return a[1] + ((b[1] - a[1]) * (z - a[0])) / (b[0] - a[0]);
  }
  return pts[z > pts[0][0] ? 0 : pts.length - 1][1];
}

export function area(poly: V2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Sutherland-Hodgman: keep the part of the polygon left of the directed line a→b. */
export function clip(poly: V2[], a: V2, b: V2): V2[] {
  const side = (p: V2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) out.push(lerp2(p, q, sp / (sp - sq)));
  }
  return out;
}

/** Shrinks a convex polygon by d. */
export function inset(poly: V2[], d: number): V2[] {
  const pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-4;
  });
  const s = area(pts) > 0 ? 1 : -1;
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const t: V2 = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
    const n: V2 = [-t[1] * s, t[0] * s];
    return { p: [p[0] + n[0] * d, p[1] + n[1] * d] as V2, t };
  });
  return lines.map((L1, i) => {
    const L0 = lines[(i + lines.length - 1) % lines.length];
    const den = L0.t[0] * L1.t[1] - L0.t[1] * L1.t[0];
    if (Math.abs(den) < 1e-6) return L1.p;
    const u = ((L1.p[0] - L0.p[0]) * L1.t[1] - (L1.p[1] - L0.p[1]) * L1.t[0]) / den;
    return [L0.p[0] + L0.t[0] * u, L0.p[1] + L0.t[1] * u] as V2;
  });
}

export function disc(r: number, x: number, y: number, z: number, dir: 1 | -1): THREE.BufferGeometry {
  return onZ(circle(x, y, r), z, dir);
}

/** Moves (x, y, z). Used to round a body in plan without adding triangles. */
export type Warp3 = (x: number, y: number, z: number) => [number, number, number];

/**
 * Applies a warp in place. Normals take the inverse transpose of its Jacobian, sampled by finite
 * differences, so a bend keeps its shading. Coincident vertices stay coincident: the warp is a
 * function of position only.
 */
export function warpArrays(pos: ArrayLike<number> & { [i: number]: number }, nrm: ArrayLike<number> & { [i: number]: number }, w: Warp3): void {
  const e = 1e-4;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    const p = w(x, y, z);
    const px = w(x + e, y, z);
    const py = w(x, y + e, z);
    const pz = w(x, y, z + e);
    const a00 = (px[0] - p[0]) / e;
    const a10 = (px[1] - p[1]) / e;
    const a20 = (px[2] - p[2]) / e;
    const a01 = (py[0] - p[0]) / e;
    const a11 = (py[1] - p[1]) / e;
    const a21 = (py[2] - p[2]) / e;
    const a02 = (pz[0] - p[0]) / e;
    const a12 = (pz[1] - p[1]) / e;
    const a22 = (pz[2] - p[2]) / e;
    const det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
    const nx = nrm[i];
    const ny = nrm[i + 1];
    const nz = nrm[i + 2];
    pos[i] = p[0];
    pos[i + 1] = p[1];
    pos[i + 2] = p[2];
    if (Math.abs(det) < 1e-8) continue;
    const inv = 1 / det;
    const i00 = (a11 * a22 - a12 * a21) * inv;
    const i01 = (a02 * a21 - a01 * a22) * inv;
    const i02 = (a01 * a12 - a02 * a11) * inv;
    const i10 = (a12 * a20 - a10 * a22) * inv;
    const i11 = (a00 * a22 - a02 * a20) * inv;
    const i12 = (a02 * a10 - a00 * a12) * inv;
    const i20 = (a10 * a21 - a11 * a20) * inv;
    const i21 = (a01 * a20 - a00 * a21) * inv;
    const i22 = (a00 * a11 - a01 * a10) * inv;
    // n' = (J^{-1})^T n
    const mx = i00 * nx + i10 * ny + i20 * nz;
    const my = i01 * nx + i11 * ny + i21 * nz;
    const mz = i02 * nx + i12 * ny + i22 * nz;
    const l = Math.hypot(mx, my, mz) || 1;
    nrm[i] = mx / l;
    nrm[i + 1] = my / l;
    nrm[i + 2] = mz / l;
  }
}

export function warpGeo(g: THREE.BufferGeometry, w: Warp3): void {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  if (!p || !n) return;
  warpArrays(p.array as Float32Array, n.array as Float32Array, w);
}
