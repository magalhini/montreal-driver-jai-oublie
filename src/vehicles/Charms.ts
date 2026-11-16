import * as THREE from 'three';
import { bake, Kit, look, paintBase } from './CarKit';
import { CHROME, GLOW, MATTE, PAINT, rgb } from './CarMaterial';
import type { CharmId } from './Tuning';

/**
 * Charms that hang from the rearview mirror (picked at the pit garage). Pivot at the origin (the mirror),
 * hanging down -y, face toward -z (the driver). About 5 cm tall. Drawn with a `carMaterial`.
 */
const GOLD = look(rgb(0.9, 0.62, 0.2), CHROME);
const RED = look(rgb(0.45, 0.025, 0.035), MATTE);
const WHITE = look(rgb(0.82, 0.8, 0.76), MATTE);
const BLACK = look(rgb(0.012, 0.012, 0.014), MATTE);
const PINK = look(rgb(0.9, 0.35, 0.42), MATTE);

const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => flat(new THREE.BoxGeometry(w, h, d)).translate(x, y, z);
const ball = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => flat(new THREE.SphereGeometry(r, 12, 9)).scale(sx, sy, sz).translate(x, y, z);
const cone = (r: number, h: number, x: number, y: number, z: number, tilt = 0) => flat(new THREE.ConeGeometry(r, h, 10)).rotateZ(tilt).translate(x, y, z);
/** Ring around the vertical axis (a collar), or facing sideways (a curled tail). */
const ring = (r: number, tube: number, x: number, y: number, z: number, sideways = false) => {
  const g = flat(new THREE.TorusGeometry(r, tube, 6, 18));
  return (sideways ? g.rotateY(Math.PI / 2) : g.rotateX(Math.PI / 2)).translate(x, y, z);
};

/** Cord from the mirror to the knot the toy hangs from. */
function cord(k: Kit, len = 0.056): void {
  k.add(box(0.002, len, 0.002, 0, -len / 2, 0), GOLD);
  k.add(box(0.007, 0.006, 0.006, 0, -len - 0.002, 0), GOLD);
}

function omamori(k: Kit): void {
  cord(k);
  k.add(box(0.034, 0.05, 0.008, 0, -0.088, 0), RED);
  k.add(box(0.02, 0.028, 0.001, 0, -0.084, -0.0045), look(rgb(0.7, 0.45, 0.12), GLOW));
}

function panda(k: Kit): void {
  cord(k);
  k.add(ball(0.015, 0, -0.074, 0), WHITE);
  for (const s of [-1, 1]) {
    k.add(ball(0.0055, s * 0.011, -0.062, 0.002), BLACK);
    k.add(ball(0.0042, s * 0.0058, -0.0745, -0.0128, 1, 1.3, 0.55), BLACK);
    k.add(ball(0.0062, s * 0.0135, -0.095, -0.005, 1, 1.5, 1), BLACK);
    k.add(ball(0.0068, s * 0.0085, -0.115, -0.007), BLACK);
  }
  k.add(ball(0.0022, 0, -0.0805, -0.0145), BLACK);
  k.add(ball(0.0165, 0, -0.1, 0, 1, 1.1, 0.95), WHITE);
}

function shiba(k: Kit): void {
  const tan = look(rgb(0.62, 0.27, 0.06), MATTE);
  const cream = look(rgb(0.86, 0.76, 0.58), MATTE);
  cord(k);
  k.add(ball(0.015, 0, -0.074, 0), tan);
  k.add(ball(0.0075, 0, -0.079, -0.0115, 1.2, 0.8, 1), cream);
  k.add(ball(0.0022, 0, -0.0765, -0.0188), BLACK);
  for (const s of [-1, 1]) {
    k.add(cone(0.0055, 0.011, s * 0.0095, -0.0605, 0, -s * 0.35), tan);
    k.add(ball(0.0018, s * 0.0055, -0.0705, -0.0136), BLACK);
    k.add(ball(0.0045, s * 0.0065, -0.113, -0.0095), cream);
  }
  k.add(ball(0.015, 0, -0.1, 0.002, 1, 1.05, 1.05), tan);
  k.add(ball(0.009, 0, -0.095, -0.0105, 1, 1.1, 0.6), cream);
  k.add(ring(0.0055, 0.0024, 0, -0.092, 0.017, true), tan);
}

function neko(k: Kit): void {
  const white = look(rgb(0.88, 0.86, 0.82), PAINT);
  cord(k);
  k.add(ball(0.016, 0, -0.102, 0, 1, 1.15, 0.9), white);
  k.add(ball(0.0155, 0, -0.073, 0), white);
  for (const s of [-1, 1]) {
    k.add(cone(0.005, 0.009, s * 0.0095, -0.0605, 0, -s * 0.3), white);
    k.add(ball(0.0016, s * 0.0055, -0.0715, -0.0145), BLACK);
  }
  k.add(ball(0.0015, 0, -0.0755, -0.0152), PINK);
  k.add(ring(0.0105, 0.002, 0, -0.0855, 0), look(rgb(0.6, 0.03, 0.03), MATTE));
  k.add(ball(0.0033, 0, -0.0885, -0.0108), GOLD);
  // The beckoning paw, raised beside the face, and the other one on the belly
  k.add(ball(0.0055, 0.0145, -0.079, -0.004, 1, 1.4, 1), white);
  k.add(ball(0.0048, 0.0155, -0.0665, -0.006), white);
  k.add(ball(0.0045, -0.0075, -0.1, -0.0135), white);
}

function daruma(k: Kit): void {
  cord(k);
  k.add(ball(0.019, 0, -0.09, 0, 1, 1.12, 0.95), look(rgb(0.55, 0.03, 0.03), PAINT));
  k.add(ball(0.011, 0, -0.084, -0.0142, 1.05, 0.9, 0.4), look(rgb(0.86, 0.82, 0.74), MATTE));
  // One eye filled in for a wish made, the other left blank until it comes true
  k.add(ball(0.0028, -0.0048, -0.0828, -0.0188, 1, 1, 0.5), BLACK);
  k.add(ball(0.0028, 0.0048, -0.0828, -0.0188, 1, 1, 0.5), look(rgb(0.95, 0.95, 0.92), MATTE));
  k.add(box(0.012, 0.0018, 0.002, 0, -0.0885, -0.0186), GOLD);
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

/** A die: pips on the face toward the driver and on the two sides (+x, -x). */
function die(k: Kit, x: number, y: number, ry: number, front: number, left: number, right: number): void {
  const s = 0.018;
  const o = s / 2 + 0.0004;
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, 0);
  k.add(box(s, s, s, 0, 0, 0).applyMatrix4(m), look(rgb(0.86, 0.85, 0.82), MATTE));
  const face = (n: number, place: (u: number, v: number) => THREE.BufferGeometry) => {
    for (const [u, v] of PIPS[n]) k.add(place(u * 0.0048, v * 0.0048).applyMatrix4(m), BLACK);
  };
  face(front, (u, v) => box(0.0034, 0.0034, 0.001, u, v, -o));
  face(left, (u, v) => box(0.001, 0.0034, 0.0034, o, v, u));
  face(right, (u, v) => box(0.001, 0.0034, 0.0034, -o, v, u));
}

function dice(k: Kit): void {
  k.add(box(0.002, 0.03, 0.002, 0, -0.015, 0), GOLD);
  k.add(box(0.02, 0.002, 0.002, 0, -0.03, 0), GOLD);
  k.add(box(0.002, 0.034, 0.002, -0.009, -0.047, 0), GOLD);
  k.add(box(0.002, 0.046, 0.002, 0.009, -0.053, 0), GOLD);
  die(k, -0.009, -0.072, 0.35, 5, 3, 4);
  die(k, 0.009, -0.084, -0.3, 3, 2, 5);
}

function duck(k: Kit): void {
  const yellow = look(rgb(0.92, 0.62, 0.02), PAINT);
  cord(k, 0.05);
  k.add(ball(0.016, 0, -0.1, 0.002, 1.1, 0.8, 1.25), yellow);
  k.add(ball(0.0105, 0, -0.082, -0.008), yellow);
  k.add(ball(0.005, 0, -0.084, -0.0185, 1.2, 0.5, 1.3), look(rgb(0.9, 0.22, 0.01), PAINT));
  for (const s of [-1, 1]) k.add(ball(0.0016, s * 0.0058, -0.079, -0.0158), BLACK);
  k.add(cone(0.004, 0.008, 0, -0.093, 0.02), yellow);
}

function teru(k: Kit): void {
  const cloth = look(rgb(0.9, 0.9, 0.88), MATTE);
  cord(k);
  k.add(ball(0.013, 0, -0.075, 0), cloth);
  k.add(cone(0.017, 0.028, 0, -0.1, 0), cloth);
  k.add(ring(0.0062, 0.0017, 0, -0.0865, 0), RED);
  for (const s of [-1, 1]) k.add(ball(0.0016, s * 0.0045, -0.0735, -0.0123), BLACK);
  k.add(box(0.0055, 0.001, 0.001, 0, -0.0785, -0.0125), BLACK);
}

const BUILDERS: Record<Exclude<CharmId, 'none'>, (k: Kit) => void> = { omamori, panda, shiba, neko, daruma, dice, duck, teru };

const cache = new Map<CharmId, THREE.BufferGeometry>();

/** The charm's geometry (cached and shared: don't dispose it), or null for an empty mirror. */
export function charmGeometry(id: CharmId): THREE.BufferGeometry | null {
  if (id === 'none') return null;
  let g = cache.get(id);
  if (!g) {
    const k = new Kit();
    BUILDERS[id](k);
    g = paintBase(bake(k), new THREE.Color());
    cache.set(id, g);
  }
  return g;
}
