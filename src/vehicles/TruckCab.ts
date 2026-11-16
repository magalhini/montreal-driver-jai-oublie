import * as THREE from 'three';
import { extrude, inset, lerp2, mirrorX, onX, onZ, prep, rrect, shade, strip, taper, warpArrays, warpGeo, type V2, type Warp3, type XY } from './CarGeometry';
import { look, type Kit, type Look } from './CarKit';
import { GLOW, MATTE, PLATE_INK, PLATE_KEI, PLATE_WHITE, rgb } from './CarMaterial';

// ---------------------------------------------------------------------------
// Shared pieces of the cab-over trucks: build context, small solids and the
// cab shell (side profile with the front wheel arch, glass, doors, wipers).
// ---------------------------------------------------------------------------

export type P3 = [number, number, number];

/** Shared state while building one truck. */
export interface TruckCtx {
  kit: Kit;
  hw: number;
  r: number;
  wf: number;
  wr: number;
  body: Look;
  seam: Look;
  dark: Look;
  trim: Look;
  chrome: Look;
  glass: Look;
  heads: THREE.BufferGeometry[];
  tails: THREE.BufferGeometry[];
  headPos: P3[];
  tailPos: P3[];
}

/** Plain box. */
export const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry =>
  prep(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));

/** Rounded box, lighter than CarGeometry's rbox: (z, y) corners with `seg` segments, soft x edges. */
export function rb(z0: number, z1: number, y0: number, y1: number, x0: number, x1: number, rad: number, bev = 0.008, seg = 1): THREE.BufferGeometry {
  const e = extrude(rrect((z0 + z1) / 2, (y0 + y1) / 2, Math.abs(z1 - z0), Math.abs(y1 - y0), rad, seg), Math.abs(x1 - x0), bev, bev, 1);
  e.g.translate((x0 + x1) / 2, 0, 0);
  return shade(e, 1.0);
}

/** Box rounded in its (x, y) cross-section, running along z (tanks, rails, bars). */
export function xbox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rad: number, bev = 0.008, seg = 1): THREE.BufferGeometry {
  const e = extrude(rrect((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, rad, seg), z1 - z0, bev, bev, 1);
  const g = shade(e, 1.0);
  g.rotateY(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

/** Vertical rib on the +x side: outer face plus its front and rear faces (6 triangles). */
export function rib(z: number, w: number, y0: number, y1: number, x0: number, x1: number): THREE.BufferGeometry[] {
  const a = z - w / 2;
  const b = z + w / 2;
  const xy: XY[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return [
    onX(
      [
        [a, y0],
        [b, y0],
        [b, y1],
        [a, y1],
      ],
      x1,
    ),
    onZ(xy, b, 1),
    onZ(xy, a, -1),
  ];
}

const _up = new THREE.Vector3(0, 1, 0);
/** Open tube between two points (lock bars, mirror stays, pipes). */
export function rod(a: P3, b: P3, r: number, seg = 6): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return prep(g, true);
}

/** Rounded rectangle decal on a z plane. */
export const rect = (kit: Kit, x: number, y: number, w: number, h: number, rad: number, z: number, dir: 1 | -1, l: Look): void =>
  kit.add(onZ(rrect(x, y, w, h, rad), z, dir), l);

/** Thin plate (fender, mudguard) following a front-to-rear (z, y) polyline over [x0, x1], visible from both sides, on both flanks. */
export function sheet(kit: Kit, pts: V2[], x0: number, x1: number, l: Look): void {
  kit.both(strip(pts, x0, x1, 0), l);
  kit.both(strip([...pts].reverse(), x0, x1, 0), l);
}

/** Flat rubber flap (both faces) on the plane z, on both flanks. */
export function flap(kit: Kit, x0: number, x1: number, y0: number, y1: number, z: number, l: Look): void {
  const poly = rrect((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0.01);
  for (const d of [1, -1] as const) kit.both(onZ(poly, z + d * 0.004, d), l);
}

/** Japanese number plate (white, or yellow for kei) with stamped characters. */
export function plate(kit: Kit, y: number, z: number, dir: 1 | -1, lit: boolean, kei: boolean): void {
  kit.add(onZ(rrect(0, y, 0.33, 0.165, 0.012), z, dir), look(kei ? PLATE_KEI : PLATE_WHITE, lit ? GLOW : MATTE));
  const ink = look(kei ? rgb(0.02, 0.02, 0.02) : PLATE_INK, MATTE);
  kit.add(onZ(rrect(0.02, y + 0.048, 0.14, 0.022, 0.004), z + dir * 0.004, dir), ink);
  kit.add(onZ(rrect(0.035, y - 0.022, 0.2, 0.06, 0.006), z + dir * 0.004, dir), ink);
  kit.add(onZ(rrect(-0.12, y - 0.022, 0.03, 0.04, 0.006), z + dir * 0.004, dir), ink);
}

/** Cab-over cab shell description (z forward, y up). */
export interface CabSpec {
  W: number;
  /** Outline from the front-bottom up the face, over the roof and down the back; the bottom (with the front arch) is added. */
  prof: V2[];
  /** Windshield base and top (points of `prof`). */
  ws: [V2, V2];
  bevel: number; // rounding of the side edges (x)
  bevelP: number; // ... and in the profile
  /** Tumblehome: the cab narrows linearly above y0 to scale s at y1. */
  taper: [number, number, number];
  /** Door glass outline (z, y) and the door seam box [front z, rear z, bottom y, top y]. */
  win: V2[];
  door: [number, number, number, number];
  pillar: number;
  /** Wheel arch radius beyond the tire, center lift above the axle. */
  arch: [number, number];
}

/**
 * Softens a cab-over's front corners in plan. Only vertices ahead of `fromZ` move, so the box or the bed
 * behind the cab stays square. No extra triangles.
 */
export function roundCabFront(c: TruckCtx, faceZ: number, fromZ: number, halfW: number, pull: number, pinch: number): void {
  const w: Warp3 = (x, y, z) => {
    if (z <= fromZ) return [x, y, z];
    const t = Math.min(1, (z - fromZ) / Math.max(0.05, faceZ - fromZ));
    const u = Math.min(1.05, Math.abs(x) / halfW);
    const k = t * t;
    return [x * (1 - pinch * k), y, z - pull * u * u * k];
  };
  warpArrays(c.kit.pos, c.kit.nrm, w);
  for (const g of c.heads) warpGeo(g, w);
  for (const p of c.headPos) {
    const n = w(p[0], p[1], p[2]);
    p[0] = n[0];
    p[1] = n[1];
    p[2] = n[2];
  }
}

/** Builds the cab shell; returns a function that adds decals following the cab's tumblehome. */
export function buildCab(c: TruckCtx, s: CabSpec): (g: THREE.BufferGeometry, l: Look) => void {
  const { kit, body, dark, seam, glass, trim, r, wf } = c;
  const hwc = s.W / 2;
  const y0 = s.prof[0][1];
  const R = r + s.arch[0];
  const cy = r + s.arch[1];
  const a = Math.asin((y0 - cy) / R);
  const bottom: V2[] = [];
  for (let i = 0; i <= 14; i++) {
    const phi = Math.PI - a + (2 * a - Math.PI) * (i / 14);
    bottom.push([wf + Math.cos(phi) * R, cy + Math.sin(phi) * R]);
  }
  const shell = extrude([...s.prof, ...bottom], s.W, s.bevelP, s.bevel, 3);
  const [ty0, ty1, ts] = s.taper;
  taper(shell.g, ty0, ty1, ts);
  kit.add(
    shade(shell),
    (p, n, cap) => {
      if (!cap && Math.hypot(p.z - wf, p.y - cy) < R + 0.03) return dark;
      if (n.y < -0.6) return dark;
      return body;
    },
    shell.cap,
  );
  const decal = (g: THREE.BufferGeometry, l: Look) => {
    // Copy first. Callers mirror this same geometry for the other door, and tapering it in place
    // would scale that side a second time so the glass sinks into the cab.
    const copy = g.clone();
    taper(copy, ty0, ty1, ts);
    copy.computeVertexNormals();
    kit.add(copy, l);
  };

  // Windshield: black rubber surround, glass on top
  const [wa, wb] = s.ws;
  const len = Math.hypot(wb[0] - wa[0], wb[1] - wa[1]);
  const hwG = hwc - s.bevel - s.pillar;
  decal(strip([lerp2(wa, wb, 0.02 / len), lerp2(wa, wb, 1 - 0.025 / len)], -hwG - 0.022, hwG + 0.022, 0.003), trim);
  decal(strip([lerp2(wa, wb, 0.04 / len), lerp2(wa, wb, 1 - 0.045 / len)], -hwG, hwG, 0.006), glass);
  // Wipers parked at the base
  const wp = [lerp2(wa, wb, 0.06 / len), lerp2(wa, wb, 0.085 / len)];
  decal(strip(wp, -hwG * 0.9, -0.08, 0.012), dark);
  decal(strip(wp, 0.02, hwG * 0.8, 0.012), dark);

  // Door glass with a rubber surround, door shut lines
  const sx = hwc + 0.003;
  for (const [poly, l, x] of [
    [inset(s.win, -0.02), trim, sx],
    [s.win, glass, sx + 0.003],
  ] as const) {
    const g = onX(poly as V2[], x);
    decal(g, l);
    decal(mirrorX(g), l);
  }
  const [dz0, dz1, dy0, dy1] = s.door;
  const t = 0.006;
  const lines: V2[][] = [
    [
      [dz0 + t, dy0],
      [dz0 + t, dy1],
      [dz0 - t, dy1],
      [dz0 - t, dy0],
    ],
    [
      [dz1 + t, dy0],
      [dz1 + t, dy1],
      [dz1 - t, dy1],
      [dz1 - t, dy0],
    ],
    [
      [dz0, dy1 - t],
      [dz0, dy1 + t],
      [dz1, dy1 + t],
      [dz1, dy1 - t],
    ],
    [
      [dz0, dy0 - t],
      [dz0, dy0 + t],
      [dz1, dy0 + t],
      [dz1, dy0 - t],
    ],
  ];
  for (const ln of lines) {
    const g = onX(ln, sx + 0.002);
    decal(g, seam);
    decal(mirrorX(g), seam);
  }
  return decal;
}
