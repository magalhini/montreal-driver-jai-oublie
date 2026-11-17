import { disc, ring } from './CarGeometry';
import { look } from './CarKit';
import { AMBER, GLOW, MATTE, rgb } from './CarMaterial';
import { box, flap, plate, rect, rod, sheet, type TruckCtx } from './TruckCab';

/**
 * Half-ton pickup (PRD 11B): hood, separate cab, open bed. Replaces the kei flatbed in traffic.
 * Dimensions match `TRUCK_DIMS.pickup` (length 5.4, the nose at z = +2.7).
 */

const ZF = 2.7;
const ZR = -2.7;
const CAB_BACK = -0.42;
const BED_FLOOR = 0.82;
const RAIL = 1.32;
const STEEL = rgb(0.07, 0.07, 0.075);
const BED = rgb(0.16, 0.16, 0.17);

export function buildPickup(c: TruckCtx): void {
  const { kit, body, dark, trim, chrome, glass, heads, tails, headPos, tailPos, hw, wf, wr, r } = c;
  const steel = look(STEEL, MATTE);
  const bed = look(BED, MATTE);
  const amber = look(AMBER, GLOW);
  const zf = ZF + 0.004;

  // Hood down the middle, clear of the front tires. Fender skins sit above each wheel.
  kit.add(box(-0.62, 0.62, 0.52, 0.78, 1.05, ZF - 0.08), body);
  sheet(kit, [
    [ZF - 0.08, 0.8],
    [2.15, 0.94],
    [1.1, 1.02],
  ], 0.02, hw - 0.05, body);
  const tire = r + 0.04;
  kit.both(box(0.62, hw - 0.02, 0.42, 0.9, wf + tire, ZF - 0.12), body);
  kit.both(box(0.62, hw - 0.02, 0.42, 0.96, 1.02, wf - tire), body);
  kit.both(box(0.66, hw + 0.01, 0.74, 1.0, wf - tire, wf + tire), body);
  sheet(kit, [
    [wf + 0.52, 0.5],
    [wf + 0.22, 0.98],
    [wf - 0.22, 0.98],
    [wf - 0.52, 0.5],
  ], 0.58, hw + 0.012, body);

  // Front face ahead of the wheels, then bumper, grille and lamps
  kit.add(box(-(hw - 0.02), hw - 0.02, 0.46, 0.84, ZF - 0.16, ZF), body);
  kit.add(box(-hw - 0.01, hw + 0.01, 0.28, 0.48, ZF - 0.08, ZF + 0.04), trim);
  rect(kit, 0, 0.66, 0.72, 0.28, 0.02, zf, 1, dark);
  for (const y of [0.58, 0.66, 0.74]) rect(kit, 0, y, 0.64, 0.012, 0.003, zf + 0.004, 1, chrome);
  for (const s of [-1, 1] as const) {
    rect(kit, s * 0.62, 0.64, 0.32, 0.14, 0.02, zf, 1, chrome);
    kit.add(ring(0.055, 0.072, s * 0.62, 0.64, zf + 0.004, 1), chrome);
    heads.push(disc(0.058, s * 0.62, 0.64, zf + 0.008, 1));
    headPos.push([s * 0.62, 0.64, ZF + 0.06]);
    rect(kit, s * 0.78, 0.4, 0.16, 0.06, 0.012, zf, 1, amber);
  }
  plate(kit, 0.36, ZF + 0.05, 1, false, false);

  // Cab
  kit.add(box(-(hw - 0.03), hw - 0.03, 0.7, 1.64, CAB_BACK, 1.02), body);
  kit.add(box(-0.72, 0.72, 1.08, 1.52, 0.96, 1.03), glass);
  kit.both(box(hw - 0.045, hw + 0.008, 1.12, 1.5, -0.22, 0.72), glass);
  kit.both(box(hw - 0.02, hw + 0.012, 0.95, 1.02, 0.15, 0.28), chrome); // door handle
  // Mirrors
  kit.both(rod([hw - 0.04, 1.42, 0.82], [hw + 0.16, 1.38, 0.78], 0.012, 5), dark);
  kit.both(box(hw + 0.1, hw + 0.22, 1.28, 1.46, 0.7, 0.84), dark);

  // Bed: floor, side rails, tailgate, wheel arches
  kit.add(box(-(hw - 0.08), hw - 0.08, BED_FLOOR - 0.06, BED_FLOOR, ZR + 0.08, CAB_BACK - 0.02), bed);
  kit.both(box(hw - 0.1, hw + 0.005, BED_FLOOR, RAIL, ZR + 0.02, CAB_BACK), body);
  kit.add(box(-(hw - 0.12), hw - 0.12, BED_FLOOR, RAIL - 0.04, ZR, ZR + 0.06), body);
  sheet(kit, [
    [wr + 0.5, 0.46],
    [wr + 0.22, 0.9],
    [wr - 0.22, 0.9],
    [wr - 0.5, 0.46],
  ], 0.5, hw + 0.005, steel);
  flap(kit, 0.48, hw - 0.04, 0.12, 0.5, wr - 0.52, steel);

  // Rear lamps and plate on the tailgate
  const zr = ZR - 0.004;
  for (const s of [-1, 1] as const) {
    rect(kit, s * 0.72, 1.05, 0.22, 0.16, 0.02, zr, -1, trim);
    tails.push(disc(0.05, s * 0.72, 1.08, zr - 0.006, -1));
    tailPos.push([s * 0.72, 1.08, ZR - 0.05]);
    rect(kit, s * 0.72, 0.94, 0.16, 0.045, 0.01, zr, -1, amber);
  }
  plate(kit, 0.98, ZR - 0.01, -1, true, false);
  kit.add(box(-hw, hw, 0.32, 0.46, ZR - 0.02, ZR + 0.06), trim);

  // Frame rails under the cab and bed, clear of the axles
  for (const s of [-1, 1] as const) kit.add(box(s * 0.32, s * 0.42, 0.36, 0.52, ZR + 0.2, ZF - 0.3), steel);
  kit.add(rod([-0.7, r, wf], [0.7, r, wf], 0.04, 6), steel);
  kit.add(rod([-0.62, r, wr], [0.62, r, wr], 0.055, 6), steel);
}
