import { CONFIG } from '../config';
import type { Rng } from '../core/Rng';
import type { AABB, Block, Building, Facing } from '../types';
import { inner } from './Features';
import type { CityModel } from './RoadGraph';

/**
 * Pit stops (IMPROVEMENTS #20), pure data: corner gas stations with a lit canopy over two pump islands. Stop
 * in the service circle under the canopy and the car goes into the pit garage for repairs and upgrades
 * (`gameplay/PitStop.ts`, `ui/PitShop.ts`). The forecourt is road-level
 * ground cut out of the block's slab, open to both streets through long curb cuts; a small kiosk stands at
 * its back corner and the rest of the block keeps its buildings.
 */
export interface PitStop {
  block: number;
  name: string;
  /** Forecourt: the block corner inside the sidewalk ring, at road level. */
  box: AABB;
  /** Canopy footprint (the service zone) and the height of its underside above the forecourt. */
  canopy: AABB;
  canopyHeight: number;
  /**
   * Service circle in the lane beside the pumps: stop in it for the pit garage (`ui/PitShop.ts`). `yaw`
   * points the car back out, toward the street on the `sides[0]` side.
   */
  bay: { x: number; z: number; r: number; yaw: number };
  /** Pump islands (one canopy column rises from the middle of each). */
  islands: AABB[];
  /** Price sign pole at the street corner. */
  sign: { x: number; z: number };
  /** The two streets it opens onto (the block corner it occupies). */
  sides: [Facing, Facing];
  kiosk: Building;
  /** Curb cuts through the sidewalk ring (also in `features.driveways`). */
  driveways: AABB[];
  /** Static colliders: islands, sign pole. The kiosk collides as a building. */
  colliders: AABB[];
}

export const PIT_STOP = {
  /** Forecourt size along x and z. */
  sizeX: 32,
  sizeZ: 26,
  canopyX: 17,
  canopyZ: 12,
  canopyHeight: 5.4,
  /** Service circle: radius, and how far it sits from the pumps (toward the street). */
  bayRadius: 2.6,
  bayOffset: 3.3,
  /** Gas stations in the city, placed near these spots (fractions of the grid). */
  spots: [
    [0.78, 0.74],
    [0.22, 0.42],
    [0.62, 0.18],
  ] as [number, number][],
};

const NAMES = ['NEO OIL 新宿', 'NEO OIL 港', 'NEO OIL 北'];

/**
 * Pick the pit stop blocks among the plain residential / shotengai blocks on level ground (`level(bl)`), and
 * lay each one out at the block corner on the widest streets. Marks the blocks `pitStop`; their buildings
 * are generated as usual and then cleared off the forecourt (`clearForecourt`).
 */
export function planPitStops(city: CityModel, kinds: string[], level: (bl: Block) => boolean, rng: Rng, avoidRow: number): PitStop[] {
  const gx = city.nx - 1;
  const gz = city.nz - 1;
  const out: PitStop[] = [];
  for (const [fx, fz] of PIT_STOP.spots) {
    const ti = fx * (gx - 1);
    const tj = fz * (gz - 1);
    const bl = city.blocks
      .filter((b) => kinds[b.id] === 'normal' && (b.district === 'residential' || b.district === 'shotengai') && b.gj !== avoidRow && level(b))
      .filter((b) => out.every((p) => Math.abs(city.blocks[p.block].gi - b.gi) + Math.abs(city.blocks[p.block].gj - b.gj) > 2))
      .sort((a, b) => Math.hypot(a.gi - ti, a.gj - tj) - Math.hypot(b.gi - ti, b.gj - tj))[0];
    if (!bl) continue;
    kinds[bl.id] = 'pitStop';
    out.push(layout(city, bl, NAMES[out.length % NAMES.length], rng));
  }
  return out;
}

function layout(city: CityModel, bl: Block, name: string, rng: Rng): PitStop {
  const sw = CONFIG.SIDEWALK;
  const r = inner(bl);
  // Corner on the widest pair of streets (avenues first)
  const hwN = city.hwZ[bl.gj];
  const hwS = city.hwZ[bl.gj + 1];
  const hwW = city.hwX[bl.gi];
  const hwE = city.hwX[bl.gi + 1];
  const sx = hwE > hwW || (hwE === hwW && rng.chance(0.5)) ? 1 : -1;
  const sz = hwS > hwN || (hwS === hwN && rng.chance(0.5)) ? 1 : -1;
  const { sizeX: X, sizeZ: Z } = PIT_STOP;
  const box: AABB = {
    minX: sx < 0 ? r.minX : r.maxX - X,
    maxX: sx < 0 ? r.minX + X : r.maxX,
    minZ: sz < 0 ? r.minZ : r.maxZ - Z,
    maxZ: sz < 0 ? r.minZ + Z : r.maxZ,
  };
  const cx = (box.minX + box.maxX) / 2 + sx * 2;
  const cz = (box.minZ + box.maxZ) / 2 + sz * 2;
  const canopy: AABB = { minX: cx - PIT_STOP.canopyX / 2, maxX: cx + PIT_STOP.canopyX / 2, minZ: cz - PIT_STOP.canopyZ / 2, maxZ: cz + PIT_STOP.canopyZ / 2 };
  const islands = [-1, 1].map((k) => ({ minX: cx + k * 4.2 - 2.6, maxX: cx + k * 4.2 + 2.6, minZ: cz - 0.6, maxZ: cz + 0.6 }));
  // Kiosk at the back corner, shop window onto the forecourt
  const kx0 = sx < 0 ? box.maxX - 10 : box.minX + 1;
  const kz0 = sz < 0 ? box.maxZ - 8 : box.minZ + 1;
  const kiosk: Building = {
    minX: kx0,
    maxX: kx0 + 9,
    minZ: kz0,
    maxZ: kz0 + 7,
    height: 4.6,
    district: 'shotengai',
    faces: [sx < 0 ? 'W' : 'E', sz < 0 ? 'N' : 'S'],
    seed: rng.int(0, 1e6),
  };
  // Curb cuts along both frontages, leaving the corner of the ring for the crosswalks
  const ringZ = sz < 0 ? [bl.min.z, bl.min.z + sw] : [bl.max.z - sw, bl.max.z];
  const ringX = sx < 0 ? [bl.min.x, bl.min.x + sw] : [bl.max.x - sw, bl.max.x];
  const driveways: AABB[] = [
    { minX: sx < 0 ? box.minX + 3 : box.minX + 1, maxX: sx < 0 ? box.maxX - 1 : box.maxX - 3, minZ: ringZ[0], maxZ: ringZ[1] },
    { minX: ringX[0], maxX: ringX[1], minZ: sz < 0 ? box.minZ + 3 : box.minZ + 1, maxZ: sz < 0 ? box.maxZ - 1 : box.maxZ - 3 },
  ];
  const sign = { x: sx < 0 ? box.minX + 1.2 : box.maxX - 1.2, z: sz < 0 ? box.minZ + 1.2 : box.maxZ - 1.2 };
  const pole = 0.25;
  return {
    block: bl.id,
    name,
    box,
    canopy,
    canopyHeight: PIT_STOP.canopyHeight,
    bay: { x: cx, z: cz + sz * PIT_STOP.bayOffset, r: PIT_STOP.bayRadius, yaw: (sx * Math.PI) / 2 },
    islands,
    sign,
    sides: [sx < 0 ? 'W' : 'E', sz < 0 ? 'N' : 'S'],
    kiosk,
    driveways,
    colliders: [...islands, { minX: sign.x - pole, maxX: sign.x + pole, minZ: sign.z - pole, maxZ: sign.z + pole }],
  };
}

const overlaps = (a: AABB, b: AABB, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;

/** Drop the buildings generated on a pit stop's forecourt and add its kiosk. */
export function clearForecourt(buildings: Building[], stop: PitStop): Building[] {
  return [...buildings.filter((b) => !overlaps(b, stop.box, 1.5)), stop.kiosk];
}
