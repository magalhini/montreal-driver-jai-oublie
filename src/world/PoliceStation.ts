import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import type { AABB, Block, Building, Facing, Vec2 } from '../types';
import type { CarLook } from '../vehicles/Car';
import { inner } from './Features';
import { blockRoads, type CityModel } from './RoadGraph';

/**
 * The police station (pure data): a precinct building at the back of a lot cut out of a block's street
 * frontage, with a row of cruiser bays and a curb cut. `open` bays are left empty. `dispatch` is the
 * pull-out pose — on the apron of the first open bay, nose toward the street — a patrol can spawn into
 * later. The parked cruisers are real cars (`ai/ParkedCars.ts`) while the player is nearby.
 */
export interface PoliceStation {
  block: number;
  name: string;
  mark: string;
  glyph: string;
  color: string;
  lot: AABB;
  building: Building;
  face: Facing;
  out: Vec2;
  along: Vec2;
  /** Middle of the facade at the ground. */
  facade: Vec2;
  /** Nose-in bay centers. */
  bays: Vec2[];
  /** Indexes into `bays` left empty for a future dispatch. */
  open: number[];
  /** Pull-out pose: the first open bay, rolled onto the apron, facing the street. */
  dispatch: Vec2;
  yaw: number;
  parked: { pos: Vec2; yaw: number; look: CarLook }[];
  driveways: AABB[];
  /** Light masts at the street corners of the lot. */
  colliders: AABB[];
}

export const STATION = {
  lotW: 34,
  lotD: 27,
  buildingW: 24,
  buildingD: 11,
  height: 18,
  bayWidth: 3.2,
  bayDepth: 6.2,
  apron: 2.2,
  /** Half of the clear lane between the two bay rows. */
  ringGap: 4.2,
  perSide: 3,
};

const OUT: Record<Facing, Vec2> = { N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } };
const overlaps = (a: AABB, b: AABB, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;

const CRUISER: CarLook = { style: 'police', color: 0xf4f4f2, detail: 'patrol' };

/**
 * Pick a downtown or oldtown block near the station's spot, clear of alleys and other curb cuts, and swap
 * the buildings on the lot for the precinct. Own random stream, after the other lot landmarks, so nothing
 * else in the city moves. Mutates `city.features` and `city.buildings`.
 */
export function planPoliceStation(city: CityModel): void {
  const f = city.features;
  const D = STATION;
  const roomy = (b: Block) => {
    const r = inner(b);
    return r.maxX - r.minX >= D.lotW + 12 && r.maxZ - r.minZ >= D.lotD + 8;
  };
  const clear = (lot: AABB) =>
    !f.alleys.some((a) => overlaps(a.box, lot, 3)) && !f.interiors.some((r) => overlaps(r.box, lot, 3)) && !f.driveways.some((d) => overlaps(d, lot, 3));
  const taken = (): Block[] => [
    ...city.blocks.filter((b) => f.kinds[b.id] === 'square'),
    ...f.pitStops.map((p) => city.blocks[p.block]),
  ];
  const gx = city.nx - 1;
  const gz = city.nz - 1;
  // West of downtown, near the middle of the grid
  const ti = 0.3 * (gx - 1);
  const tj = 0.36 * (gz - 1);
  const blocks = city.blocks
    .filter((b) => f.kinds[b.id] === 'normal' && (b.district === 'downtown' || b.district === 'oldtown') && b.gj !== f.canal?.row && roomy(b))
    .filter((b) => taken().every((o) => Math.abs(o.gi - b.gi) + Math.abs(o.gj - b.gj) > 2))
    .sort((a, b) => Math.hypot(a.gi - ti, a.gj - tj) - Math.hypot(b.gi - ti, b.gj - tj));
  for (const bl of blocks) {
    const site = layout(city, bl, new Rng(CONFIG.SEED + 77 + bl.id * 5));
    if (!clear(site.lot)) continue;
    f.kinds[bl.id] = 'police';
    f.station = site;
    f.driveways.push(...site.driveways);
    city.buildings = city.buildings.filter((b) => !overlaps(b, site.lot, 1.5));
    city.buildings.push(site.building);
    return;
  }
}

function layout(city: CityModel, bl: Block, rng: Rng): PoliceStation {
  const sw = CONFIG.SIDEWALK;
  const D = STATION;
  const r = inner(bl);
  const side = blockRoads(city, bl);
  const south = side.S > side.N || (side.S === side.N && rng.chance(0.5));
  const face: Facing = south ? 'S' : 'N';
  const out = OUT[face];
  const along: Vec2 = { x: -out.z, z: out.x };
  const cx = (r.minX + r.maxX) / 2 + rng.range(-4, 4);
  const edgeZ = south ? r.maxZ : r.minZ;
  const lot: AABB = { minX: cx - D.lotW / 2, maxX: cx + D.lotW / 2, minZ: south ? edgeZ - D.lotD : edgeZ, maxZ: south ? edgeZ : edgeZ + D.lotD };
  const back = south ? lot.minZ + 1.2 : lot.maxZ - 1.2;
  const front = back + out.z * D.buildingD;
  const building: Building = {
    minX: cx - D.buildingW / 2,
    maxX: cx + D.buildingW / 2,
    minZ: Math.min(back, front),
    maxZ: Math.max(back, front),
    height: D.height,
    district: bl.district,
    faces: [face],
    seed: rng.int(0, 1e6),
    landmark: true,
    facade: { style: 0, color: [0.05, 0.07, 0.12], lit: 0.55 },
  };
  const facade = { x: cx, z: front };
  const rowZ = front + out.z * (D.apron + D.bayDepth / 2);
  const bays: Vec2[] = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < D.perSide; k++) bays.push({ x: cx + side * (D.ringGap + D.bayWidth * (k + 0.5)), z: rowZ });
  }
  // Innermost bay on each side stays empty: a cruiser there pulls straight out into the lane
  const open = [0, D.perSide];
  const nose = Math.atan2(-out.x, -out.z);
  const parked = bays
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => !open.includes(i))
    .map(({ p }) => ({ pos: { x: p.x, z: p.z + out.z * 0.35 }, yaw: nose, look: CRUISER }));
  const pull = bays[open[0]];
  const dispatch = { x: pull.x, z: pull.z + out.z * (D.bayDepth / 2 + 1.2) };
  const yaw = Math.atan2(out.x, out.z);
  const ring = south ? [bl.max.z - sw, bl.max.z] : [bl.min.z, bl.min.z + sw];
  const driveways: AABB[] = [{ minX: lot.minX + 1.5, maxX: lot.maxX - 1.5, minZ: ring[0], maxZ: ring[1] }];
  const mast = (x: number): AABB => ({ minX: x - 0.2, maxX: x + 0.2, minZ: rowZ + out.z * (D.bayDepth / 2 + 0.6) - 0.2, maxZ: rowZ + out.z * (D.bayDepth / 2 + 0.6) + 0.2 });
  return {
    block: bl.id,
    name: 'Montréal',
    mark: 'SPVM',
    glyph: '+',
    color: '#6aa6ff',
    lot,
    building,
    face,
    out,
    along,
    facade,
    bays,
    open,
    dispatch,
    yaw,
    parked,
    driveways,
    colliders: [mast(lot.minX + 1.6), mast(lot.maxX - 1.6)],
  };
}
