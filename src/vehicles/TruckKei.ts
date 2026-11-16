import * as THREE from 'three';
import { disc, onZ, prep, ring, rrect, type V2 } from './CarGeometry';
import { look, type Look } from './CarKit';
import { AMBER, CHROME, GLASS, GLOW, LAMP, MATTE, rgb } from './CarMaterial';
import { box, buildCab, flap, plate, rb, rect, rod, roundCabFront, sheet, xbox, type CabSpec, type TruckCtx } from './TruckCab';

// ---------------------------------------------------------------------------
// Kei flatbed: tiny cab-over, drop-side bed with a guard frame, some cargo.
// ---------------------------------------------------------------------------

const ZF = 1.65;
const ZC = 0.47;
const CAB_W = 1.46;

const CAB: CabSpec = {
  W: CAB_W,
  prof: [
    [ZF, 0.42],
    [ZF, 0.95],
    [1.545, 1.62],
    [1.52, 1.68],
    [1.478, 1.728],
    [1.4, 1.76],
    [1.3, 1.774],
    [0.75, 1.78],
    [0.58, 1.77],
    [0.505, 1.74],
    [0.475, 1.69],
    [ZC, 1.55],
    [ZC, 0.42],
  ],
  ws: [
    [ZF, 0.95],
    [1.545, 1.62],
  ],
  bevel: 0.065,
  bevelP: 0.05,
  taper: [1.0, 1.78, 0.955],
  win: [
    [1.44, 1.07],
    [1.355, 1.6],
    [0.6, 1.62],
    [0.6, 1.07],
  ],
  door: [1.5, 0.55, 0.68, 1.69],
  pillar: 0.045,
  arch: [0.045, 0.01],
};

const BED_Y = 0.665; // bed floor top
const GATE_Y = 0.94;
const BZ0 = -1.7;
const BZ1 = 0.42;
const STEEL = rgb(0.06, 0.06, 0.065);
const GREY = rgb(0.24, 0.24, 0.25);

/** Kei flatbed; `load` picks the cargo (see `keiLoad`). `work` is the player's truck: a fitted bed instead of a random load. */
export function buildKeiTruck(c: TruckCtx, load: number, work = false): void {
  const { kit, body, dark, trim, chrome, glass, heads, tails, headPos, tailPos, wf, wr, r, hw } = c;
  const hwc = CAB_W / 2;
  const steel = look(STEEL, MATTE);
  const grey = look(GREY);
  const amber = look(AMBER, GLOW);

  // --- Cab ---
  buildCab(c, CAB);
  const zf = ZF + 0.003;
  // Round headlamps in chrome rings, black garnish between them, amber corner lamps below
  rect(kit, 0, 0.7, 0.72, 0.1, 0.02, zf, 1, dark);
  for (const y of [0.68, 0.72]) rect(kit, 0, y, 0.66, 0.012, 0.004, zf + 0.004, 1, chrome);
  for (const s of [-1, 1]) {
    rect(kit, s * 0.5, 0.7, 0.21, 0.19, 0.03, zf, 1, dark);
    kit.add(ring(0.074, 0.092, s * 0.5, 0.7, zf + 0.004, 1), chrome);
    heads.push(disc(0.076, s * 0.5, 0.7, zf + 0.008, 1));
    headPos.push([s * 0.5, 0.7, ZF + 0.08]);
  }
  kit.both(rb(ZF - 0.13, ZF + 0.012, 0.555, 0.635, 0.58, hwc + 0.005, 0.025, 0.01, 2), amber);
  kit.both(box(hwc - 0.008, hwc + 0.01, 0.72, 0.76, 1.15, 1.24), amber); // side turn repeater
  // Slot vent under the windshield
  rect(kit, 0, 0.87, 0.62, 0.035, 0.012, zf, 1, dark);
  // Steel bumper, plate
  kit.add(rb(ZF - 0.05, ZF + 0.06, 0.3, 0.43, -0.74, 0.74, 0.03, 0.02, 2), grey);
  kit.add(box(-0.6, 0.6, 0.25, 0.31, ZF - 0.03, ZF + 0.03), steel);
  plate(kit, 0.4, ZF + 0.064, 1, false, true);
  // Door mirrors, handles, step
  kit.both(rb(1.39, 1.45, 1.12, 1.24, hwc + 0.06, hwc + 0.17, 0.03, 0.01), dark);
  kit.both(onZ(rrect(hwc + 0.115, 1.18, 0.09, 0.1, 0.02), 1.388, -1), glass);
  kit.both(rod([hwc - 0.01, 1.1, 1.43], [hwc + 0.08, 1.15, 1.42], 0.01), dark);
  kit.both(box(hwc - 0.01, hwc + 0.015, 1.0, 1.03, 0.68, 0.78), dark);
  kit.both(box(hwc - 0.2, hwc - 0.02, 0.35, 0.4, 0.52, 0.8), steel);
  flap(kit, hwc - 0.2, hwc - 0.03, 0.1, 0.36, 0.5, steel);
  // Rear window (seen through the guard frame)
  rect(kit, 0, 1.43, 1.06, 0.3, 0.04, ZC - 0.003, -1, trim);
  rect(kit, 0, 1.43, 1.02, 0.26, 0.035, ZC - 0.006, -1, glass);

  // --- Chassis ---
  for (const s of [-1, 1]) kit.add(box(s * 0.32, s * 0.38, 0.34, 0.5, -1.62, 1.3), steel);
  kit.add(box(-0.5, 0.5, 0.26, 0.42, 0.6, 1.35), steel);
  kit.add(rod([-0.55, r, wf], [0.55, r, wf], 0.035), steel);
  kit.add(rod([-0.52, r, wr], [0.52, r, wr], 0.045, 8), steel);
  kit.add(xbox(-0.1, 0.1, r - 0.1, r + 0.09, wr - 0.1, wr + 0.12, 0.07), steel);
  kit.add(xbox(-0.62, -0.3, 0.32, 0.5, -0.25, 0.25, 0.05), steel); // fuel tank
  kit.add(rod([-0.42, 0.27, -1.1], [-0.42, 0.27, -1.62], 0.025), look(rgb(0.35, 0.35, 0.36), CHROME));
  kit.add(disc(0.02, -0.42, 0.27, -1.621, -1), dark);
  for (let z = BZ1 - 0.08; z > BZ0 + 0.05; z -= 0.3) {
    if (Math.abs(z - wr) < 0.36) continue;
    kit.add(box(-0.69, 0.69, 0.52, 0.6, z - 0.025, z + 0.025), steel);
  }
  const fender: V2[] = [
    [wr + 0.38, 0.3],
    [wr + 0.3, 0.59],
    [wr - 0.3, 0.59],
    [wr - 0.38, 0.3],
  ];
  sheet(kit, fender, 0.48, 0.71, steel);
  flap(kit, 0.48, 0.71, 0.1, 0.32, wr - 0.39, steel);

  // --- Bed: floor, drop-side gates with stamped ribs, corner posts, hook rail ---
  kit.add(rb(BZ0 + 0.02, BZ1, 0.6, BED_Y, -hw + 0.005, hw - 0.005, 0.015, 0.01), body);
  for (const x of [-0.45, -0.15, 0.15, 0.45]) kit.add(box(x - 0.02, x + 0.02, BED_Y, BED_Y + 0.008, BZ0 + 0.1, BZ1 - 0.06), body);
  kit.both(rb(BZ0 + 0.06, BZ1 - 0.03, BED_Y, GATE_Y, hw - 0.04, hw - 0.005, 0.012, 0.008), body);
  kit.add(rb(BZ0, BZ0 + 0.04, BED_Y, GATE_Y, -hw + 0.05, hw - 0.05, 0.012, 0.008), body);
  kit.add(rb(BZ1 - 0.04, BZ1, BED_Y, GATE_Y, -hw + 0.05, hw - 0.05, 0.012, 0.008), body);
  for (const y of [0.745, 0.855]) {
    kit.both(box(hw - 0.01, hw + 0.004, y - 0.014, y + 0.014, BZ0 + 0.14, BZ1 - 0.1), body);
    kit.add(box(-hw + 0.12, hw - 0.12, y - 0.014, y + 0.014, BZ0 - 0.008, BZ0 + 0.01), body);
  }
  for (const z of [BZ0 + 0.02, BZ1 - 0.02]) kit.both(rb(z - 0.035, z + 0.035, 0.58, GATE_Y + 0.012, hw - 0.055, hw + 0.003, 0.012, 0.008), look(0.85));
  kit.both(box(hw - 0.04, hw, 0.52, 0.605, BZ0 + 0.02, BZ1), grey);
  for (const z of [0.15, -0.6, -1.35]) kit.both(box(hw - 0.025, hw + 0.004, 0.48, 0.53, z - 0.02, z + 0.02), steel);
  for (const z of [-0.2, -1.15]) kit.both(box(hw - 0.004, hw + 0.012, 0.6, 0.66, z - 0.04, z + 0.04), steel);
  kit.both(box(hw - 0.2, hw - 0.12, GATE_Y - 0.06, GATE_Y - 0.02, BZ0 - 0.018, BZ0 - 0.002), chrome);

  // --- Guard frame ("torii") behind the cab, with short arms over the roof ---
  const frame = look(rgb(0.05, 0.05, 0.055));
  const fz0 = BZ1 - 0.035;
  const fz1 = BZ1 + 0.005;
  const top = 1.86;
  kit.both(box(hw - 0.09, hw - 0.05, GATE_Y, top, fz0, fz1), frame);
  kit.add(box(-hw + 0.05, hw - 0.05, top - 0.04, top, fz0, fz1 + 0.24), frame);
  for (const x of [-0.45, -0.22, 0, 0.22, 0.45]) kit.add(box(x - 0.012, x + 0.012, GATE_Y, top - 0.04, fz0 + 0.008, fz1 - 0.008), frame);
  kit.add(box(-hw + 0.09, hw - 0.09, 1.25, 1.28, fz0 + 0.005, fz1 - 0.005), frame);
  kit.both(box(hw - 0.1, hw - 0.06, top - 0.04, top, fz1, fz1 + 0.24), frame);

  // --- Rear: steel bar, combination lamps under the bed corners, kei plate ---
  kit.add(rb(BZ0 - 0.02, BZ0 + 0.04, 0.3, 0.41, -0.7, 0.7, 0.02, 0.012), grey);
  const lz = BZ0 - 0.02;
  for (const s of [-1, 1]) {
    kit.add(rb(lz, BZ0 + 0.06, 0.43, 0.585, s * 0.49, s * 0.735, 0.015, 0.008), dark);
    tails.push(onZ(rrect(s * 0.575, 0.53, 0.14, 0.09, 0.01), lz - 0.004, -1));
    rect(kit, s * 0.685, 0.53, 0.075, 0.09, 0.01, lz - 0.002, -1, amber);
    rect(kit, s * 0.6, 0.462, 0.17, 0.028, 0.006, lz - 0.002, -1, look(rgb(0.55, 0.55, 0.55), GLASS));
    tailPos.push([s * 0.575, 0.53, lz - 0.07]);
  }
  rect(kit, 0, 0.505, 0.36, 0.19, 0.01, BZ0 - 0.006, -1, steel);
  plate(kit, 0.505, BZ0 - 0.012, -1, true, true);

  if (work) workFit(c);
  else cargo(c, load);
  roundCabFront(c, ZF, 1.22, hwc, 0.042, 0.032);
}

/** Player's truck: beacon, lamp guards, a company stripe, and a packed bed (spare, toolbox, jerry can, ladder). */
function workFit(c: TruckCtx): void {
  const { kit, chrome, dark } = c;
  const hwc = CAB_W / 2;
  const y = BED_Y;
  const steel = look(STEEL, MATTE);
  const cream = look(rgb(0.9, 0.78, 0.35));
  kit.both(box(hwc - 0.004, hwc + 0.012, 1.0, 1.045, 0.62, 1.42), cream);
  for (const s of [-1, 1]) {
    kit.add(box(s * 0.5 - 0.09, s * 0.5 + 0.09, 0.688, 0.708, 1.678, 1.694), chrome);
    kit.add(box(s * 0.488, s * 0.512, 0.62, 0.78, 1.678, 1.694), chrome);
  }
  kit.add(box(-0.09, 0.09, 1.78, 1.81, 1.08, 1.26), steel);
  kit.both(box(hwc - 0.16, hwc - 0.135, 1.774, 1.796, 0.68, 1.3), dark);
  kit.add(prep(new THREE.CylinderGeometry(0.065, 0.08, 0.1, 10).translate(0, 1.86, 1.16)), look(rgb(0.95, 0.38, 0.04), LAMP));
  kit.add(box(-0.07, 0.07, 1.86, 1.94, 0.36, 0.5), look(rgb(0.95, 0.85, 0.55), GLOW));
  // Spare flat on the bed, toolbox and jerry can on the left, ladder along the right rail
  kit.add(prep(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 16).translate(0.12, y + 0.08, -0.18)), dark);
  kit.add(prep(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 10).translate(0.12, y + 0.08, -0.18)), chrome);
  kit.add(box(-0.64, -0.14, y, y + 0.28, -1.58, -1.08), steel);
  kit.add(box(-0.5, -0.28, y + 0.27, y + 0.3, -1.42, -1.22), chrome);
  kit.add(box(-0.58, -0.3, y, y + 0.32, -0.9, -0.58), look(rgb(0.45, 0.05, 0.03), MATTE));
  kit.add(box(-0.48, -0.4, y + 0.3, y + 0.34, -0.78, -0.7), dark);
  kit.add(box(0.32, 0.38, y + 0.02, y + 0.08, -1.55, -0.72), steel);
  kit.add(box(0.5, 0.56, y + 0.02, y + 0.08, -1.55, -0.72), steel);
  for (const z of [-1.45, -1.2, -0.95, -0.78]) kit.add(box(0.32, 0.56, y + 0.045, y + 0.065, z, z + 0.03), steel);
}

/** Load on the bed (0..3), a deterministic hash of the paint color. */
export function keiLoad(color: number): number {
  let h = Math.imul(color ^ 0x90, 0x9e3779b1);
  h ^= h >>> 15;
  return (h >>> 0) % 4;
}

const WOOD = rgb(0.32, 0.2, 0.09);
const KRAFT = rgb(0.4, 0.26, 0.12);
const TAPE = rgb(0.55, 0.42, 0.26);
const TARP = rgb(0.03, 0.12, 0.42);
const ROPE = rgb(0.5, 0.45, 0.3);

/** Load on the bed: wooden crates, cardboard boxes, a roped blue tarp or beer crates. */
function cargo(c: TruckCtx, load: number): void {
  const { kit } = c;
  const y = BED_Y;
  const ink = look(rgb(0.02, 0.02, 0.02), MATTE);
  const crate = (x0: number, x1: number, y0: number, z0: number, z1: number, h: number) => {
    kit.add(box(x0, x1, y0, y0 + h, z0, z1), look(WOOD, MATTE));
    const band = look(rgb(0.2, 0.12, 0.05), MATTE);
    for (const t of [0.12, 0.5, 0.88]) kit.add(box(x0 - 0.008, x1 + 0.008, y0 + h * t - 0.02, y0 + h * t + 0.02, z0 - 0.008, z1 + 0.008), band);
  };
  const carton = (x0: number, x1: number, y0: number, z0: number, z1: number, h: number) => {
    kit.add(box(x0, x1, y0, y0 + h, z0, z1), look(KRAFT, MATTE));
    const xc = (x0 + x1) / 2;
    const tape = look(TAPE, MATTE);
    kit.add(box(xc - 0.03, xc + 0.03, y0 + h, y0 + h + 0.004, z0 - 0.002, z1 + 0.002), tape);
    kit.add(box(xc - 0.03, xc + 0.03, y0 + h - 0.08, y0 + h, z0 - 0.004, z0), tape);
    kit.add(box(xc - 0.03, xc + 0.03, y0 + h - 0.08, y0 + h, z1, z1 + 0.004), tape);
  };
  const beer = (x: number, z: number, y0: number, l: Look) => {
    kit.add(box(x - 0.2, x + 0.2, y0, y0 + 0.28, z - 0.15, z + 0.15), l);
    for (const d of [1, -1] as const) kit.add(onZ(rrect(x, y0 + 0.22, 0.14, 0.04, 0.018), z + d * 0.152, d), ink);
    kit.add(box(x - 0.18, x + 0.18, y0 + 0.276, y0 + 0.282, z - 0.13, z + 0.13), ink);
  };
  switch (load) {
    case 0:
      crate(-0.66, -0.06, y, -0.12, 0.34, 0.46);
      crate(0.0, 0.62, y, -0.06, 0.34, 0.38);
      crate(-0.6, -0.12, y + 0.46, -0.08, 0.3, 0.3);
      carton(-0.3, 0.2, y, -1.2, -0.8, 0.3);
      break;
    case 1:
      carton(-0.64, -0.1, y, -0.2, 0.34, 0.4);
      carton(-0.05, 0.6, y, -0.1, 0.34, 0.34);
      carton(-0.55, -0.15, y + 0.4, -0.1, 0.25, 0.26);
      carton(0.05, 0.5, y + 0.34, 0.0, 0.32, 0.22);
      carton(-0.6, 0.0, y, -1.1, -0.55, 0.3);
      carton(0.15, 0.55, y, -1.5, -1.1, 0.24);
      break;
    case 2: {
      kit.add(rb(-1.45, 0.34, y, y + 0.48, -0.66, 0.66, 0.16, 0.09, 3), look(TARP));
      const rope = look(ROPE, MATTE);
      for (const z of [-1.1, -0.55, 0.0]) {
        kit.add(box(-0.58, 0.58, y + 0.478, y + 0.488, z - 0.012, z + 0.012), rope);
        kit.both(box(0.655, 0.665, y + 0.06, y + 0.4, z - 0.012, z + 0.012), rope);
      }
      break;
    }
    default: {
      const yel = look(rgb(0.75, 0.5, 0.02));
      beer(-0.42, 0.18, y, yel);
      beer(0.0, 0.18, y, yel);
      beer(-0.42, 0.18, y + 0.28, yel);
      beer(0.42, 0.18, y, look(rgb(0.5, 0.04, 0.03)));
      beer(0.0, -0.14, y, yel);
      carton(0.25, 0.65, y, -1.45, -1.0, 0.28);
    }
  }
}
