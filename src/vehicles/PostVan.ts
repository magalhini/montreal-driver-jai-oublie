import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { extrude, inset, lerp2, mirrorX, onX, onZ, rrect, shade, strip, type V2 } from './CarGeometry';
import { look, type Kit, type Look } from './CarKit';
import { AMBER, GLOW, MATTE, REFLECTOR, WHITE, rgb } from './CarMaterial';
import { box, plate, rb, rect, rod, roundCabFront, type TruckCtx } from './TruckCab';

// ---------------------------------------------------------------------------
// Canada Post step van: short sloping hood, tall flat windshield, one box from
// the cab to the roll-up door. Red on top, white below, a blue swoosh between
// them rising from behind the front wheel to the back. Dimensions match
// `TRUCK_DIMS.postvan` (length 5.72 with the bumpers, wheels at z = 1.75 / -1.3).
// The CANADA POST / POSTES CANADA panels are a textured mesh (`postLivery`).
// ---------------------------------------------------------------------------

const ZF = 2.72; // front face (grille)
const ZR = -2.78; // rear face (roll-up door)
const Y0 = 0.5; // body bottom
const ROOF = 2.62;
const HW = 1.0;

/** The swoosh: white below it from just behind the front wheel arch to the rear corner. */
const ZS = 1.12;
const ZB = ZR + 0.05;
const YW = Y0 + 0.05;
const SWOOSH_TOP = 1.7;

const BLUE = rgb(0.012, 0.07, 0.4);
const STEEL = rgb(0.06, 0.06, 0.065);
const GREY = rgb(0.28, 0.29, 0.3);
const SILVER = rgb(0.55, 0.56, 0.58);

/** Top of the white at z (0 at the front tip, rising fast behind the cab, flattening toward the back). */
function swoosh(z: number): { y: number; u: number } {
  const u = (ZS - z) / (ZS - ZB);
  return { y: YW + 0.02 + (SWOOSH_TOP - YW - 0.02) * (1 - (1 - u) * (1 - u)), u };
}

/** Points along the swoosh, front to rear. */
function swooshLine(n: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const z = ZS + (ZB - ZS) * (i / n);
    out.push([z, swoosh(z).y]);
  }
  return out;
}

/** Wheel arch along the body bottom at `y`, rear side to front side. */
function arch(zc: number, R: number, cy: number, y: number, n = 14): V2[] {
  const a = Math.asin((y - cy) / R);
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const phi = Math.PI - a + (2 * a - Math.PI) * (i / n);
    out.push([zc + Math.cos(phi) * R, cy + Math.sin(phi) * R]);
  }
  return out;
}

/** Any simple (z, y) polygon on the plane x, facing +x. `onX` fans, which only suits convex outlines. */
function panel(poly: V2[], x: number): THREE.BufferGeometry {
  const tris = THREE.ShapeUtils.triangulateShape(
    poly.map(([z, y]) => new THREE.Vector2(z, y)),
    [],
  );
  const pts = poly.map(([z, y]) => new THREE.Vector3(x, y, z));
  const P: number[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (const [i, j, k] of tris) {
    let b = pts[j];
    let c = pts[k];
    const a = pts[i];
    if (e1.subVectors(b, a).cross(e2.subVectors(c, a)).x < 0) [b, c] = [c, b];
    P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const N = new Float32Array(P.length);
  for (let i = 0; i < N.length; i += 3) N[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}

function sides(kit: Kit, g: THREE.BufferGeometry, l: Look): void {
  kit.add(g, l);
  kit.add(mirrorX(g), l);
}

export function buildPostVan(c: TruckCtx): void {
  const { kit, body, dark, seam, trim, chrome, glass, heads, tails, headPos, tailPos, wf, wr, r } = c;
  const white = look(WHITE);
  const blue = look(BLUE);
  const steel = look(STEEL, MATTE);
  const grey = look(GREY);
  const silver = look(SILVER);
  const amber = look(AMBER, GLOW);
  const redRefl = look(REFLECTOR, GLOW);

  // --- Shell: one extruded side profile, both wheel arches cut out of the bottom ---
  const R = r + 0.08;
  const cy = r + 0.03;
  const ws: [V2, V2] = [
    [2.2, 1.28],
    [2.0, 2.44],
  ];
  const prof: V2[] = [
    [ZF, Y0],
    [ZF, 1.02],
    [2.69, 1.1],
    [2.6, 1.15],
    [2.26, 1.24],
    ws[0],
    ws[1],
    [1.93, 2.53],
    [1.82, 2.59],
    [1.6, ROOF],
    [ZR + 0.08, ROOF],
    [ZR + 0.02, ROOF - 0.04],
    [ZR, ROOF - 0.1],
    [ZR, Y0],
  ];
  const shell = extrude([...prof, ...arch(wr, R, cy, Y0), ...arch(wf, R, cy, Y0)], HW * 2, 0.04, 0.05, 3);
  kit.add(
    shade(shell),
    (p, n, cap) => {
      if (!cap && (Math.hypot(p.z - wf, p.y - cy) < R + 0.03 || Math.hypot(p.z - wr, p.y - cy) < R + 0.03)) return dark;
      if (n.y < -0.6) return dark;
      return body;
    },
    shell.cap,
  );

  // --- Livery: white below the swoosh, the blue band riding on it (pointed at the front), red above ---
  const line = swooshLine(28);
  const lowArch = arch(wr, R + 0.005, cy, YW);
  sides(kit, panel([[ZS, YW], ...line, [ZB, YW], ...lowArch], HW + 0.004), white);
  const band = line.slice(1).map(([z, y]): V2 => [z, y + 0.17 * Math.sqrt(swoosh(z).u)]);
  sides(kit, panel([...line, ...band.reverse()], HW + 0.006), blue);

  // --- Cab: windshield (two panes), door openings, mirrors ---
  const [wa, wb] = ws;
  const len = Math.hypot(wb[0] - wa[0], wb[1] - wa[1]);
  const hwG = HW - 0.11;
  kit.add(strip([lerp2(wa, wb, 0.02 / len), lerp2(wa, wb, 1 - 0.025 / len)], -hwG - 0.022, hwG + 0.022, 0.003), trim);
  kit.add(strip([lerp2(wa, wb, 0.04 / len), lerp2(wa, wb, 1 - 0.045 / len)], -hwG, hwG, 0.006), glass);
  kit.add(strip([lerp2(wa, wb, 0.04 / len), lerp2(wa, wb, 1 - 0.045 / len)], -0.018, 0.018, 0.009), trim);
  const wp = [lerp2(wa, wb, 0.06 / len), lerp2(wa, wb, 0.09 / len)];
  kit.add(strip(wp, -hwG * 0.9, -0.08, 0.012), dark);
  kit.add(strip(wp, 0.06, hwG * 0.85, 0.012), dark);
  const win: V2[] = [
    [1.96, 1.38],
    [1.9, 2.34],
    [1.04, 2.34],
    [1.04, 1.38],
  ];
  sides(kit, onX(inset(win, -0.025), HW + 0.004), trim);
  sides(kit, onX(win, HW + 0.007), glass);
  // Sliding door edges (the doorway runs from the windshield pillar back to z = 0.94)
  for (const z of [0.94, 2.02]) kit.both(box(HW - 0.002, HW + 0.007, Y0 + 0.08, 2.44, z - 0.007, z + 0.007), seam);
  kit.both(box(HW - 0.002, HW + 0.012, 1.18, 1.24, 1.06, 1.2), dark); // door pull
  {
    const mz = 2.28;
    const mx = HW + 0.19;
    kit.both(rb(mz - 0.035, mz + 0.035, 1.56, 1.96, mx - 0.07, mx + 0.07, 0.03, 0.012), dark);
    kit.both(onZ(rrect(mx, 1.76, 0.12, 0.36, 0.02), mz - 0.037, -1), glass);
    kit.both(rod([HW - 0.01, 1.98, 2.3], [mx, 1.92, mz + 0.01], 0.012), dark);
    kit.both(rod([HW - 0.01, 1.45, 2.3], [mx, 1.6, mz + 0.01], 0.012), dark);
  }

  // --- Front: grille, square headlamps, turn lamps, bumper ---
  const zf = ZF + 0.004;
  rect(kit, 0, 0.8, 0.66, 0.36, 0.02, zf, 1, look(rgb(0.012, 0.012, 0.014), MATTE));
  for (let y = 0.66; y < 0.95; y += 0.055) rect(kit, 0, y, 0.6, 0.018, 0.005, zf + 0.004, 1, silver);
  for (const s of [-1, 1]) {
    rect(kit, s * 0.64, 0.86, 0.3, 0.24, 0.02, zf, 1, chrome);
    rect(kit, s * 0.64, 0.86, 0.26, 0.2, 0.015, zf + 0.003, 1, dark);
    heads.push(onZ(rrect(s * 0.64, 0.86, 0.23, 0.17, 0.014), zf + 0.008, 1));
    headPos.push([s * 0.64, 0.86, ZF + 0.08]);
    rect(kit, s * 0.64, 0.67, 0.2, 0.07, 0.012, zf, 1, amber);
  }
  kit.both(box(HW - 0.01, HW + 0.012, 0.64, 0.72, 2.48, 2.6), amber); // side markers
  for (const x of [-0.14, 0, 0.14]) kit.add(box(x - 0.03, x + 0.03, ROOF - 0.03, ROOF + 0.02, 1.62, 1.68), amber); // cab roof lamps
  kit.add(rb(ZF - 0.06, ZF + 0.14, 0.34, 0.56, -HW, HW, 0.04, 0.02), grey);
  plate(kit, 0.45, ZF + 0.142, 1, false);

  // --- Rear: same livery across the back, roll-up door, lamps, bumper ---
  const zr = ZR - 0.004;
  const fw = 2 * (HW - 0.06);
  rect(kit, 0, (YW + SWOOSH_TOP) / 2, fw, SWOOSH_TOP - YW, 0.01, zr, -1, white);
  rect(kit, 0, SWOOSH_TOP + 0.085, fw, 0.17, 0.005, zr, -1, blue);
  const dz = zr - 0.004;
  for (let y = 0.86; y < 2.42; y += 0.16) rect(kit, 0, y, 1.5, 0.012, 0.003, dz, -1, seam);
  for (const s of [-1, 1]) rect(kit, s * 0.76, 1.56, 0.02, 1.6, 0.005, dz, -1, seam);
  rect(kit, 0, 0.84, 0.22, 0.05, 0.01, dz - 0.004, -1, dark); // door handle
  for (const s of [-1, 1]) {
    rect(kit, s * 0.88, 1.0, 0.13, 0.38, 0.02, dz, -1, dark);
    tails.push(onZ(rrect(s * 0.88, 1.04, 0.1, 0.24, 0.015), dz - 0.004, -1));
    tailPos.push([s * 0.88, 1.04, ZR - 0.06]);
    rect(kit, s * 0.88, 0.86, 0.1, 0.06, 0.01, dz - 0.004, -1, amber);
    rect(kit, s * 0.82, ROOF - 0.16, 0.1, 0.05, 0.01, zr, -1, redRefl);
    kit.both(box(HW - 0.01, HW + 0.012, 0.64, 0.72, -2.68, -2.56), redRefl); // rear side markers
  }
  kit.add(rb(ZR - 0.12, ZR + 0.06, 0.36, 0.52, -HW + 0.02, HW - 0.02, 0.03, 0.015), grey);
  kit.add(box(-0.5, 0.5, 0.5, 0.53, ZR - 0.11, ZR - 0.02), steel); // step
  plate(kit, 0.7, dz - 0.004, -1, true);

  // --- Running gear under the body ---
  for (const s of [-1, 1]) kit.add(box(s * 0.36, s * 0.46, 0.34, Y0 + 0.01, ZR + 0.2, ZF - 0.3), steel);
  kit.add(rod([-0.74, r, wf], [0.74, r, wf], 0.045), steel);
  kit.add(rod([-0.7, r, wr], [0.7, r, wr], 0.06, 8), steel);

  roundCabFront(c, ZF, 2.3, HW, 0.06, 0.025);
}

let livery: { geo: THREE.BufferGeometry; mat: THREE.Material } | undefined;

/** The blue CANADA POST / POSTES CANADA panel high on each side, toward the back. Built once and shared. */
export function postLivery(): { geo: THREE.BufferGeometry; mat: THREE.Material } | undefined {
  if (livery || typeof document === 'undefined') return livery;
  const w = 1024;
  const h = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1a3c8c';
  g.fillRect(0, 0, w, h);
  // Two columns either side of the round badge: CANADA / POST, POSTES / CANADA
  const R = 92;
  const col = w / 2 - R - 56;
  let size = 96;
  const font = () => `900 ${size}px "Arial Black", "Arial Bold", Arial, sans-serif`;
  g.font = font();
  while (Math.max(...['CANADA', 'POSTES'].map((t) => g.measureText(t).width)) > col && size > 40) {
    size -= 4;
    g.font = font();
  }
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText('CANADA', 36, h * 0.3);
  g.fillText('POST', 36, h * 0.72);
  g.textAlign = 'right';
  g.fillText('POSTES', w - 36, h * 0.3);
  g.fillText('CANADA', w - 36, h * 0.72);
  // Badge: red disc, white chevron pointing ahead
  g.fillStyle = '#e3141c';
  g.beginPath();
  g.arc(w / 2, h / 2, R, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(w / 2 - 52, h / 2 - 40);
  g.lineTo(w / 2 + 58, h / 2);
  g.lineTo(w / 2 - 52, h / 2 + 40);
  g.lineTo(w / 2 - 22, h / 2);
  g.closePath();
  g.fill();

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const pw = 2.0;
  const ph = pw / 4;
  const z = -0.85;
  const y = 2.12;
  const x = HW + 0.008;
  // Read front to back on both flanks: the +x side's u axis runs to the rear, the -x side's to the front
  const right = new THREE.PlaneGeometry(pw, ph).rotateY(Math.PI / 2).translate(x, y, z);
  const left = new THREE.PlaneGeometry(pw, ph).rotateY(-Math.PI / 2).translate(-x, y, z);
  livery = {
    geo: mergeGeometries([right, left])!,
    mat: new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0.05 }),
  };
  return livery;
}
