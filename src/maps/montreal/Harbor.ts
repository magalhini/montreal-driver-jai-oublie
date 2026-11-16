import { CONFIG } from '../../config';
import type { AABB, Building, Vec2 } from '../../types';
import type { OldPort, PlazaDressing } from '../../world/Features';
import type { CityModel } from '../../world/RoadGraph';

/**
 * Vieux-Port (PRD Phase 5). The quay road is the last road before the river; south of it, all the way along
 * the water, runs the Old Port's promenade: a sidewalk band on the road, a lawn strip of bare trees, then a
 * paved walk by the railing. It is raised pavement, so driving on it is the sidewalk offense. At the east end
 * the promenade gives way to a road-level parking lot (two curb cuts off the quay road), then the clock tower
 * stands at the end of the walk. Meters, from the quay road's south curb.
 */
export const PORT = {
  /** Curb to water. */
  depth: 46,
  /** Lawn band: starts this far from the curb, this deep. */
  lawnFrom: 6,
  lawnDepth: 18,
  /** Paved walk: ends this far short of the water, this wide. */
  walkGap: 3,
  walkWidth: 12,
  /** Gap in the lawns in line with each cross street (where the crosswalks would land). */
  path: 7,
  /** The lot runs from Saint-Denis toward the clock, short of it by `lotClear`. */
  lotFromCol: 16,
  lotClear: 34,
  /** Lot depth from the sidewalk band (two rows of bays nose to nose, an aisle either side). */
  lotDepth: 26,
  mouthW: 9,
  bayW: 2.7,
  bayD: 5.4,
  /** Clock tower: shaft side, height, and how far in from the east end and from the water. */
  clock: { side: 9, plinth: 12, height: 45, fromEast: 18, fromWater: 14 },
  /** Quai King-Edward and Quai Jacques-Cartier: off these cross streets, this wide and long, a hangar on each. */
  piers: [12, 15],
  pierW: 36,
  pierL: 150,
  treeStep: 13,
  lampStep: 24,
  benchStep: 31,
};

/** Water line for a grid whose last road's south curb is at `curbZ`. */
export const portWaterZ = (curbZ: number): number => curbZ + PORT.depth;

/**
 * Plan the promenade, the lot and the clock tower. Needs `city.waterZ` and `city.bounds`. Pushes the lot's
 * curb cuts into `driveways`, its bays into `parking`, and the clock tower's collider into `buildings`.
 */
export function layPort(city: CityModel): void {
  const f = city.features;
  const P = PORT;
  const b = city.bounds;
  const z0 = city.waterZ - P.depth;
  const z1 = city.waterZ;
  const strip: AABB = { minX: b.minX, maxX: b.maxX, minZ: z0, maxZ: z1 };
  const walk: AABB = { minX: b.minX, maxX: b.maxX, minZ: z1 - P.walkGap - P.walkWidth, maxZ: z1 - P.walkGap };

  const clock: Vec2 = { x: b.maxX - P.clock.fromEast, z: z1 - P.clock.fromWater };
  const sw = CONFIG.SIDEWALK;
  const lot: AABB = { minX: city.xs[P.lotFromCol] + 22, maxX: clock.x - P.lotClear, minZ: z0 + sw, maxZ: z0 + sw + P.lotDepth };
  const mouths: AABB[] = [lot.minX + 5, lot.maxX - 5 - P.mouthW].map((x) => ({ minX: x, maxX: x + P.mouthW, minZ: z0, maxZ: lot.minZ }));
  f.driveways.push(...mouths);

  // Bays: two rows nose to nose across the middle of the lot, clear of the aisles behind the curb cuts
  const rowA = lot.minZ + 7.5 + P.bayD / 2;
  const rowB = rowA + P.bayD;
  for (let x = lot.minX + 18; x + P.bayW / 2 < lot.maxX - 18; x += P.bayW) {
    f.parking.push({ pos: { x, z: rowA }, yaw: 0 }, { pos: { x, z: rowB }, yaw: Math.PI });
  }

  // Lawns along the road, broken in line with each cross street, ending short of the lot
  const lawnZ0 = z0 + P.lawnFrom;
  const lawnZ1 = lawnZ0 + P.lawnDepth;
  const cuts = city.xs.map((x) => [x - P.path / 2, x + P.path / 2] as const);
  const lawns: AABB[] = [];
  let x = b.minX + 6;
  for (const [c0, c1] of [...cuts, [lot.minX - 6, Infinity] as const]) {
    if (c0 > x + 8) lawns.push({ minX: x, maxX: Math.min(c0, lot.minX - 6), minZ: lawnZ0, maxZ: lawnZ1 });
    x = Math.max(x, c1);
    if (x >= lot.minX - 6) break;
  }

  const dress: PlazaDressing = { trees: [], lamps: [], benches: [], colliders: [] };
  const post = (p: Vec2, r: number): AABB => ({ minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r });
  for (const l of lawns) {
    let k = 0;
    for (let tx = l.minX + 5; tx < l.maxX - 4; tx += P.treeStep) {
      const tz = k++ % 2 ? l.minZ + 5 : l.maxZ - 5;
      dress.trees.push({ x: tx, z: tz });
    }
  }
  // Globe lamps along the walk's landward edge and by the railing; benches facing the water
  for (let lx = b.minX + 12; lx < b.maxX - 8; lx += P.lampStep) {
    if (Math.abs(lx - clock.x) < P.clock.plinth) continue;
    dress.lamps.push({ x: lx, z: walk.minZ - 1 });
    dress.lamps.push({ x: lx + P.lampStep / 2, z: z1 - 1.2 });
  }
  for (let bx = b.minX + 20; bx < clock.x - P.clock.plinth; bx += P.benchStep) dress.benches.push({ pos: { x: bx, z: z1 - 4.2 }, yaw: 0 });
  dress.colliders.push(...dress.trees.map((p) => post(p, 0.35)), ...dress.lamps.map((p) => post(p, 0.16)), ...dress.benches.map((q) => post(q.pos, 0.9)));

  const piers = P.piers.map((i) => {
    const cx = city.xs[i];
    const deck: AABB = { minX: cx - P.pierW / 2, maxX: cx + P.pierW / 2, minZ: z1, maxZ: z1 + P.pierL };
    const shed: AABB = { minX: cx - P.pierW / 2 + 6, maxX: cx + P.pierW / 2 - 6, minZ: z1 + 22, maxZ: z1 + P.pierL - 12 };
    return { deck, shed };
  });

  const port: OldPort = {
    ...dress,
    strip,
    lawns,
    walk,
    lot,
    mouths,
    stroll: { z: (walk.minZ + walk.maxZ) / 2, x0: b.minX + 16, x1: clock.x - P.clock.plinth },
    piers,
  };
  f.port = port;

  // The clock tower: its mesh is `LandmarkView`; this box is the collider and the map footprint
  const h = P.clock.plinth / 2;
  const tower: Building = {
    minX: clock.x - h,
    maxX: clock.x + h,
    minZ: clock.z - h,
    maxZ: clock.z + h,
    height: P.clock.height,
    district: 'harbor',
    faces: [],
    seed: 1922,
    landmark: true,
    custom: 'clock',
  };
  city.buildings.push(tower);
  f.clock = { pos: clock, side: P.clock.side, height: P.clock.height, y: CONFIG.CURB_HEIGHT };
}
