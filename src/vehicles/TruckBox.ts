import { mirrorX, onX, onZ, rbox, rrect, type V2 } from './CarGeometry';
import { look } from './CarKit';
import { AMBER, CHROME, GLASS, GLOW, MATTE, rgb } from './CarMaterial';
import { box, buildCab, flap, plate, rb, rect, rib, rod, roundCabFront, sheet, xbox, type CabSpec, type TruckCtx } from './TruckCab';

// ---------------------------------------------------------------------------
// 2-ton cab-over box truck: flat-faced cab, ladder frame, aluminium van body.
// ---------------------------------------------------------------------------

const ZF = 2.8; // cab face
const ZC = 1.1; // cab back
const CAB_W = 1.86;

const CAB: CabSpec = {
  W: CAB_W,
  prof: [
    [ZF, 0.52],
    [ZF, 1.22],
    [2.73, 2.0],
    [2.705, 2.075],
    [2.655, 2.13],
    [2.57, 2.165],
    [2.44, 2.183],
    [1.7, 2.192],
    [1.28, 2.183],
    [1.17, 2.155],
    [1.12, 2.1],
    [ZC, 1.95],
    [ZC, 0.52],
  ],
  ws: [
    [ZF, 1.22],
    [2.73, 2.0],
  ],
  bevel: 0.08,
  bevelP: 0.06,
  taper: [1.25, 2.19, 0.965],
  win: [
    [2.57, 1.3],
    [2.505, 1.99],
    [1.27, 1.99],
    [1.27, 1.3],
  ],
  door: [2.61, 1.2, 0.9, 2.085],
  pillar: 0.05,
  arch: [0.06, 0.02],
};

/** Aluminium van body extents. */
const BZ0 = -2.8;
const BZ1 = 1.0;
const BY0 = 0.95;
const BY1 = 2.9;
const BHW = 0.975;

const ALU = rgb(0.66, 0.68, 0.7);
const ALU_LT = rgb(0.8, 0.82, 0.84);
const RAIL = rgb(0.82, 0.84, 0.86);
/** The flat rear faces the following car's headlights square on: matte so its specular peak doesn't bloom out. */
const REAR_ALU = rgb(0.46, 0.47, 0.49);
const REAR_RAIL = rgb(0.56, 0.57, 0.6);
const HARDWARE = rgb(0.5, 0.51, 0.53);
const STEEL = rgb(0.06, 0.06, 0.065);
const GREY = rgb(0.2, 0.2, 0.21);
const SILVER = rgb(0.55, 0.56, 0.58);
const RED_REFL = rgb(0.55, 0.02, 0.01);

export function buildBoxTruck(c: TruckCtx): void {
  const { kit, dark, trim, chrome, glass, heads, tails, headPos, tailPos, wf, wr, r } = c;
  const hwc = CAB_W / 2;
  const alu = look(ALU);
  const aluLt = look(ALU_LT);
  const rail = look(RAIL);
  const rearAlu = look(REAR_ALU, MATTE);
  const rearRail = look(REAR_RAIL, MATTE);
  const hard = look(HARDWARE);
  const hardM = look(HARDWARE, MATTE);
  const steel = look(STEEL, MATTE);
  const grey = look(GREY);
  const silver = look(SILVER);
  const amber = look(AMBER, GLOW);
  const redRefl = look(RED_REFL, GLOW);

  // --- Cab ---
  const decal = buildCab(c, CAB);
  // quarter vent divider in the door glass
  const vent = onX(
    [
      [2.335, 1.3],
      [2.335, 1.99],
      [2.31, 1.99],
      [2.31, 1.3],
    ],
    hwc + 0.008,
  );
  decal(vent, trim);
  decal(mirrorX(vent), trim);
  const zf = ZF + 0.003;
  // Black grille band holding the headlamps (silver slats between), amber corner lamps wrapping round the corners
  rect(kit, 0, 0.845, 1.72, 0.25, 0.02, zf, 1, look(rgb(0.012, 0.012, 0.014), MATTE));
  for (const y of [0.775, 0.822, 0.869, 0.916]) rect(kit, 0, y, 0.68, 0.022, 0.006, zf + 0.004, 1, silver);
  for (const s of [-1, 1]) {
    rect(kit, s * 0.585, 0.85, 0.34, 0.2, 0.02, zf + 0.003, 1, chrome);
    rect(kit, s * 0.585, 0.85, 0.315, 0.175, 0.015, zf + 0.006, 1, dark);
    heads.push(onZ(rrect(s * 0.585, 0.85, 0.29, 0.15, 0.014), zf + 0.01, 1));
    headPos.push([s * 0.585, 0.85, ZF + 0.08]);
  }
  kit.both(rb(ZF - 0.17, ZF + 0.012, 0.69, 0.93, 0.775, hwc + 0.01, 0.03, 0.012, 2), amber);
  kit.both(box(hwc - 0.01, hwc + 0.012, 0.8, 0.86, 2.25, 2.37), amber); // side turn repeater
  // Vent garnish under the windshield, a plain silver bar (no badge)
  rect(kit, 0, 1.1, 1.2, 0.1, 0.02, zf, 1, dark);
  for (const y of [1.08, 1.12]) rect(kit, 0, y, 1.14, 0.012, 0.004, zf + 0.004, 1, trim);
  rect(kit, 0, 1.0, 0.44, 0.035, 0.012, zf, 1, silver);
  // Bumper with a lower black lip, plate on it
  kit.add(rbox(ZF - 0.06, ZF + 0.065, 0.36, 0.62, -0.955, 0.955, 0.05, 0.03), grey);
  kit.add(rb(ZF - 0.04, ZF + 0.04, 0.3, 0.37, -0.9, 0.9, 0.02, 0.015), steel);
  for (const s of [-1, 1]) kit.add(box(s * 0.75 - 0.08, s * 0.75 + 0.08, 0.44, 0.54, ZF + 0.06, ZF + 0.075), steel);
  plate(kit, 0.49, ZF + 0.068, 1, false);
  // Door handles, grab handles, steps behind the front wheels, mudflaps under them
  kit.both(box(hwc - 0.01, hwc + 0.018, 1.17, 1.21, 1.3, 1.42), dark);
  kit.both(rod([hwc + 0.025, 1.0, 1.15], [hwc + 0.025, 1.7, 1.15], 0.012, 5), dark);
  kit.both(box(hwc - 0.25, hwc - 0.01, 0.36, 0.42, 1.08, 1.33), steel);
  kit.both(box(hwc - 0.24, hwc - 0.02, 0.418, 0.424, 1.1, 1.31), look(rgb(0.12, 0.12, 0.13), MATTE));
  flap(kit, hwc - 0.25, hwc - 0.02, 0.12, 0.42, 1.07, steel);

  // Mirrors: big rectangular heads on tubular stays, small convex mirrors below, a front under-mirror on the left
  {
    const mz = 2.6;
    const mx = hwc + 0.2;
    kit.both(rb(mz - 0.035, mz + 0.035, 1.47, 1.87, mx - 0.08, mx + 0.08, 0.03, 0.012), dark);
    kit.both(onZ(rrect(mx, 1.67, 0.14, 0.38, 0.02), mz - 0.037, -1), glass);
    kit.both(rod([hwc - 0.02, 1.98, 2.66], [mx - 0.02, 1.86, mz + 0.01], 0.012), dark);
    kit.both(rod([hwc - 0.02, 1.98, 2.66], [hwc - 0.02, 1.35, 2.66], 0.011), dark);
    kit.both(rod([hwc - 0.02, 1.36, 2.66], [mx - 0.02, 1.36, mz + 0.01], 0.012), dark);
    kit.both(rod([mx - 0.02, 1.36, mz + 0.01], [mx - 0.02, 1.48, mz + 0.01], 0.012), dark);
    kit.both(rb(mz - 0.03, mz + 0.03, 1.27, 1.39, mx - 0.06, mx + 0.06, 0.05, 0.015), dark);
    kit.both(onZ(rrect(mx, 1.33, 0.1, 0.1, 0.045), mz - 0.032, -1), glass);
    kit.add(rod([hwc - 0.06, 2.16, 2.62], [hwc - 0.01, 2.26, 2.82], 0.01), dark);
    kit.add(rb(2.8, 2.86, 2.2, 2.3, hwc - 0.1, hwc + 0.02, 0.04, 0.012), dark);
  }

  // --- Chassis: frame rails, sub-frame and cross bearers under the body, running gear ---
  for (const s of [-1, 1]) {
    kit.add(box(s * 0.38, s * 0.46, 0.5, 0.74, -2.78, 2.5), steel);
    kit.add(box(s * 0.36, s * 0.48, 0.74, 0.84, BZ0 + 0.04, BZ1 - 0.02), steel);
  }
  for (let z = BZ1 - 0.06; z > BZ0 + 0.1; z -= 0.34) {
    if (Math.abs(z - wr) < 0.58) continue;
    kit.add(box(-BHW + 0.01, BHW - 0.01, 0.84, BY0, z - 0.03, z + 0.03), steel);
  }
  kit.add(box(-0.75, 0.75, 0.28, 0.56, 1.4, 2.55), steel); // engine / gearbox under the cab
  kit.add(rod([-0.72, r, wf], [0.72, r, wf], 0.045), steel);
  kit.add(rod([-0.62, r, wr], [0.62, r, wr], 0.07, 8), steel);
  kit.add(xbox(-0.14, 0.14, r - 0.16, r + 0.12, wr - 0.14, wr + 0.18, 0.1), steel); // differential
  // Rear fenders over the duals, mudflaps behind them
  const fender: V2[] = [
    [wr + 0.56, 0.46],
    [wr + 0.44, 0.8],
    [wr + 0.3, 0.84],
    [wr - 0.3, 0.84],
    [wr - 0.44, 0.8],
    [wr - 0.56, 0.46],
  ];
  sheet(kit, fender, 0.44, BHW - 0.01, steel);
  flap(kit, 0.44, BHW - 0.02, 0.1, 0.48, wr - 0.57, steel);
  // Side guards between the axles
  for (const y of [0.44, 0.66]) kit.both(rb(wr + 0.6, 0.98, y - 0.03, y + 0.03, BHW - 0.05, BHW - 0.01, 0.012, 0.006), grey);
  for (const z of [0.85, -0.05]) kit.both(box(BHW - 0.06, BHW - 0.04, 0.41, 0.84, z - 0.02, z + 0.02), steel);
  // Fuel tank (right) with straps and filler cap, battery box (left), exhaust tip
  kit.add(xbox(-0.86, -0.5, 0.36, 0.72, -0.5, 0.55, 0.08, 0.008, 2), silver);
  for (const z of [-0.3, 0.35]) kit.add(xbox(-0.875, -0.49, 0.35, 0.73, z - 0.025, z + 0.025, 0.085, 0.004, 2), steel);
  kit.add(rod([-0.74, 0.72, 0.1], [-0.74, 0.77, 0.1], 0.04, 8), hard);
  kit.add(box(0.52, 0.86, 0.42, 0.72, -0.35, 0.3), steel);
  kit.add(rod([-0.55, 0.42, -0.75], [-0.85, 0.42, -0.75], 0.035), look(rgb(0.3, 0.3, 0.31), CHROME));

  // --- Aluminium van body ---
  const px = BHW - 0.018; // side panel plane
  kit.add(rbox(BZ0 + 0.06, BZ1 - 0.03, BY0 + 0.1, BY1 - 0.1, -px, px, 0.02, 0.008), alu);
  // vertical ribs along the sides and across the front above the cab
  const n = 12;
  for (let i = 0; i < n; i++) {
    const z = BZ1 - 0.2 - ((BZ1 - BZ0 - 0.42) * i) / (n - 1);
    for (const g of rib(z, 0.045, BY0 + 0.12, BY1 - 0.12, px - 0.004, px + 0.012)) kit.both(g, aluLt);
  }
  for (const x of [-0.6, -0.2, 0.2, 0.6]) kit.add(box(x - 0.022, x + 0.022, 2.25, BY1 - 0.12, BZ1 - 0.04, BZ1 - 0.02), aluLt);
  // top and bottom rails, front corner posts
  kit.add(rbox(BZ0 + 0.02, BZ1 + 0.02, BY1 - 0.13, BY1, -BHW, BHW, 0.025, 0.012), rail);
  kit.add(rbox(BZ0 + 0.02, BZ1 + 0.02, BY0, BY0 + 0.13, -BHW, BHW, 0.025, 0.012), rail);
  kit.both(rb(BZ1 - 0.06, BZ1 + 0.025, BY0, BY1, BHW - 0.05, BHW + 0.002, 0.015, 0.008), rail);
  // paint stripe along the sides
  kit.both(box(px - 0.01, px + 0.02, 1.17, 1.23, BZ0 + 0.12, BZ1 - 0.1), look(1));
  // amber side markers on the bottom rail, clearance lamps on the top front corners
  for (const z of [0.55, -0.55, -2.3]) kit.both(box(BHW - 0.01, BHW + 0.015, BY0 + 0.035, BY0 + 0.085, z - 0.05, z + 0.05), amber);
  kit.both(box(0.72, 0.84, BY1 - 0.11, BY1 - 0.04, BZ1 + 0.02, BZ1 + 0.045), amber);

  // Rear: door frame, double doors with lock bars, hinges and reflectors
  const zr = BZ0 - 0.06; // rear face of the frame
  kit.add(rb(zr, BZ0 + 0.08, BY1 - 0.24, BY1, -BHW, BHW, 0.025, 0.012), rearRail);
  kit.add(rb(zr - 0.01, BZ0 + 0.08, BY0 - 0.02, BY0 + 0.12, -BHW, BHW, 0.025, 0.012), rearRail);
  kit.both(rb(zr, BZ0 + 0.08, BY0, BY1, BHW - 0.12, BHW, 0.02, 0.01), rearRail);
  const dz = BZ0 - 0.012;
  const dy0 = BY0 + 0.12;
  const dy1 = BY1 - 0.24;
  kit.add(onZ(rrect(0, (dy0 + dy1) / 2, 2 * (BHW - 0.12), dy1 - dy0, 0.005), dz, -1), rearAlu);
  rect(kit, 0, (dy0 + dy1) / 2, 0.014, dy1 - dy0, 0.002, dz - 0.003, -1, dark);
  for (const s of [-1, 1]) {
    for (const y of [1.45, 2.05]) rect(kit, s * 0.43, y, 0.76, 0.03, 0.006, dz - 0.003, -1, rearRail);
    for (const x of [0.2, 0.64]) {
      const bx = s * x;
      kit.add(rod([bx, dy0 + 0.02, dz - 0.035], [bx, dy1 - 0.02, dz - 0.035], 0.014), hard);
      for (const y of [dy0 + 0.05, dy1 - 0.05, 1.9]) kit.add(box(bx - 0.03, bx + 0.03, y - 0.03, y + 0.03, dz - 0.05, dz - 0.002), hardM);
      // handle lever parked across the door, with its keeper
      const hx = bx + s * (x < 0.5 ? 0.17 : -0.17);
      kit.add(box(Math.min(bx, hx), Math.max(bx, hx), 1.29, 1.33, dz - 0.06, dz - 0.03), hardM);
      kit.add(box(hx - 0.025, hx + 0.025, 1.27, 1.35, dz - 0.04, dz - 0.002), dark);
    }
    for (const y of [1.15, 1.65, 2.15, 2.55]) kit.add(box(s * (BHW - 0.135) - 0.035, s * (BHW - 0.135) + 0.035, y - 0.04, y + 0.04, zr - 0.02, zr + 0.01), hardM);
    rect(kit, s * (BHW - 0.06), 1.16, 0.075, 0.16, 0.01, zr - 0.003, -1, redRefl);
    rect(kit, s * (BHW - 0.06), BY1 - 0.06, 0.07, 0.035, 0.008, zr - 0.003, -1, redRefl);
  }

  // Rear lamp bar under the body: combination lamps (amber / red / clear), plate, underrun bar
  kit.add(box(-BHW + 0.01, BHW - 0.01, 0.8, BY0, BZ0, BZ0 + 0.12), steel);
  kit.add(box(-0.95, 0.95, 0.59, 0.78, -2.82, -2.7), steel);
  const lz = -2.865;
  for (const s of [-1, 1]) {
    kit.add(rb(lz + 0.003, -2.81, 0.6, 0.775, s * 0.5, s * 0.945, 0.02, 0.01), dark);
    tails.push(onZ(rrect(s * 0.71, 0.688, 0.18, 0.12, 0.012), lz - 0.003, -1));
    rect(kit, s * 0.865, 0.688, 0.1, 0.12, 0.012, lz - 0.001, -1, amber);
    rect(kit, s * 0.56, 0.688, 0.08, 0.12, 0.012, lz - 0.001, -1, look(rgb(0.55, 0.55, 0.55), GLASS));
    tailPos.push([s * 0.71, 0.688, lz - 0.07]);
    kit.add(box(s * 0.42 - 0.03, s * 0.42 + 0.03, 0.46, 0.6, -2.84, -2.78), steel);
    rect(kit, s * 0.6, 0.465, 0.16, 0.05, 0.008, -2.853, -1, redRefl);
  }
  kit.add(rb(-2.85, -2.79, 0.42, 0.51, -0.86, 0.86, 0.02, 0.012), grey);
  plate(kit, 0.688, -2.825, -1, true);
  kit.add(box(-0.08, 0.08, 0.775, 0.8, -2.85, -2.79), dark);
  roundCabFront(c, ZF, 2.42, hwc, 0.028, 0.02);
}
