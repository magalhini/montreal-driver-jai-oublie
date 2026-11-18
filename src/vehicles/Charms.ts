import * as THREE from 'three';
import { bake, Kit, look, paintBase } from './CarKit';
import { CHROME, GLOW, MATTE, PAINT, rgb } from './CarMaterial';
import type { CharmId } from './Tuning';

/**
 * Charms that hang from the rearview mirror (picked at the pit garage): the Tim Hortons cup every car comes with,
 * and an orange cone, a bagel and a croissant for sale. Pivot at the origin (the mirror),
 * hanging down -y, face toward -z (the driver). About 5 cm tall. Drawn with a `carMaterial`.
 */
const GOLD = look(rgb(0.9, 0.62, 0.2), CHROME);
const BLACK = look(rgb(0.012, 0.012, 0.014), MATTE);

const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => flat(new THREE.BoxGeometry(w, h, d)).translate(x, y, z);
const ball = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => flat(new THREE.SphereGeometry(r, 12, 9)).scale(sx, sy, sz).translate(x, y, z);
const cone = (r: number, h: number, x: number, y: number, z: number, tilt = 0) => flat(new THREE.ConeGeometry(r, h, 10)).rotateZ(tilt).translate(x, y, z);

/** Cord from the mirror to the knot the toy hangs from. */
function cord(k: Kit, len = 0.056): void {
  k.add(box(0.002, len, 0.002, 0, -len / 2, 0), GOLD);
  k.add(box(0.007, 0.006, 0.006, 0, -len - 0.002, 0), GOLD);
}

/** A Montreal orange traffic cone: black base, white reflective bands. */
function cone2(k: Kit): void {
  const orange = look(rgb(0.85, 0.09, 0.0), PAINT);
  const band = look(rgb(0.92, 0.92, 0.9), GLOW);
  cord(k, 0.07);
  // Body tapers from 1.2 cm at the base to the tip under the knot
  const top = -0.075;
  const bottom = -0.114;
  const r0 = 0.0125;
  k.add(cone(r0, top - bottom, 0, (top + bottom) / 2, 0), orange);
  const at = (y: number) => (r0 * (y - top)) / (bottom - top);
  for (const y of [-0.088, -0.101]) k.add(flat(new THREE.CylinderGeometry(at(y + 0.0025) + 0.0007, at(y - 0.0025) + 0.0007, 0.005, 12, 1, true)).translate(0, y, 0), band);
  k.add(box(0.03, 0.004, 0.03, 0, bottom - 0.002, 0), BLACK);
}

/** A Montreal bagel, sesame side to the driver. */
function bagel(k: Kit): void {
  const crust = look(rgb(0.34, 0.14, 0.03), MATTE);
  const seed = look(rgb(0.92, 0.86, 0.7), MATTE);
  cord(k);
  const R = 0.0125;
  const tube = 0.0082;
  const cy = -0.058 - R - tube;
  k.add(flat(new THREE.TorusGeometry(R, tube, 8, 20)).translate(0, cy, 0), crust);
  // Seeds on the face toward the driver (-z), scattered round the ring
  for (let i = 0; i < 16; i++) {
    const a = i * 2.39996;
    const lat = ((i * 0.37) % 1) * 1.6 - 0.8;
    const rr = R + Math.sin(lat) * tube * 0.7;
    const z = -Math.cos(lat) * tube - 0.0004;
    k.add(ball(0.0013, Math.cos(a) * rr, cy + Math.sin(a) * rr, z, 1.6, 0.9, 0.6), seed);
  }
}

/** A croissant, horns down, the layers in two shades of gold. */
function croissant(k: Kit): void {
  const gold = look(rgb(0.62, 0.3, 0.06), PAINT);
  const dark = look(rgb(0.42, 0.17, 0.03), PAINT);
  cord(k, 0.07);
  const cy = -0.1;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const th = Math.PI * (0.12 + 0.76 * u);
    const x = Math.cos(th) * 0.023;
    const y = cy + Math.sin(th) * 0.017;
    const fat = Math.sin(Math.PI * (0.08 + 0.84 * u));
    const r = 0.0035 + 0.0062 * fat;
    // Each layer is a lozenge along the arc
    const g = ball(r, 0, 0, 0, 1.25, 1, 1).rotateZ(th + Math.PI / 2).translate(x, y, 0);
    k.add(g, i % 2 ? dark : gold);
  }
}

/** A Tim Hortons cup: red paper, white lid, the white script panel toward the driver. The free one. */
function timmies(k: Kit): void {
  const red = look(rgb(0.62, 0.03, 0.04), MATTE);
  const white = look(rgb(0.9, 0.88, 0.85), MATTE);
  const brown = look(rgb(0.36, 0.2, 0.09), MATTE);
  cord(k, 0.068);
  const top = -0.076;
  const h = 0.032;
  k.add(flat(new THREE.CylinderGeometry(0.0115, 0.0088, h, 14)).translate(0, top - h / 2, 0), red);
  // Lid: rim, raised top and the sip spout facing the driver
  k.add(flat(new THREE.CylinderGeometry(0.0123, 0.0123, 0.003, 14)).translate(0, top + 0.0012, 0), white);
  k.add(flat(new THREE.CylinderGeometry(0.0095, 0.0112, 0.003, 14)).translate(0, top + 0.004, 0), white);
  k.add(box(0.004, 0.0015, 0.0025, 0, top + 0.0058, -0.0075), brown);
  // The name panel, a red cursive hint on it: a long crossbar over forward-slanted strokes, two tall capitals
  // and the small letters after them. The driver sees it from -z, so the line reads from +x to -x.
  const zf = -0.0108;
  k.add(box(0.012, 0.009, 0.001, 0, top - 0.013, zf), white);
  const stroke = (x: number, y: number, h: number, tilt = 0.35) =>
    k.add(flat(new THREE.BoxGeometry(0.0009, h, 0.0012)).rotateZ(tilt).translate(x, y, zf - 0.0006), red);
  stroke(0.0003, top - 0.0106, 0.0098, Math.PI / 2 - 0.06); // crossbar, rising a touch to the driver's right
  stroke(0.0036, top - 0.0136, 0.0056); // T
  for (const x of [0.0021, 0.0012, 0.0003]) stroke(x, top - 0.0148, 0.0028); // im
  stroke(-0.0013, top - 0.0136, 0.0056); // H
  stroke(-0.0027, top - 0.0136, 0.0056);
  for (const x of [-0.0038, -0.0047]) stroke(x, top - 0.0148, 0.0028); // ortons
}

const BUILDERS: Record<CharmId, (k: Kit) => void> = { cone: cone2, bagel, croissant, timmies };

const cache = new Map<CharmId, THREE.BufferGeometry>();

/** The charm's geometry (cached and shared: don't dispose it). Null for an id an old save left behind. */
export function charmGeometry(id: CharmId): THREE.BufferGeometry | null {
  if (!BUILDERS[id]) return null;
  let g = cache.get(id);
  if (!g) {
    const k = new Kit();
    BUILDERS[id](k);
    g = paintBase(bake(k), new THREE.Color());
    cache.set(id, g);
  }
  return g;
}
