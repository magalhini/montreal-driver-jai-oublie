import { CONFIG } from '../../config';
import type { AABB, Building, Vec2 } from '../../types';
import type { OldPort, PlazaDressing, PortClosure, PortWheel } from '../../world/Features';
import type { CityModel } from '../../world/RoadGraph';

/**
 * Vieux-Port (PRD Phase 5). The quay road is the last road before the river; south of it, all the way along
 * the water, runs the Old Port's promenade: a sidewalk band on the road, a lawn strip of bare trees, then a
 * paved walk by the railing. It is raised pavement, so driving on it is the sidewalk offense. At the east end
 * the promenade gives way to a road-level parking lot (two curb cuts off the quay road), then the clock tower
 * stands at the end of the walk. La Grande Roue is on a little island just offshore of the tower: the quay wall
 * opens only for its footbridge, and the mouth of that bridge is too narrow for a car. Meters, from the quay
 * road's south curb.
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
  /**
   * La Grande Roue. The island sits just west of the clock, far enough into the river that a footbridge
   * crosses open water. The rim is 52 m across and the axle is raised so the top lands near the real
   * wheel's 60 m. The bridge mouth is split by a pier (`gateW`) so each leftover gap is under the
   * narrowest car (1.4 m).
   */
  wheel: { radius: 26, west: 68, south: 40, halfX: 28, halfZ: 17, bridgeW: 3.6, gateW: 1.05 },
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
 * Plan the promenade, the lot, the clock tower and the wheel's island. Needs `city.waterZ` and `city.bounds`.
 * Pushes the lot's curb cuts into `driveways`, its bays into `parking`, and the clock tower's collider into
 * `buildings`. Opens the quay wall for the footbridge.
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
  const wheel = planWheel(clock, z1);
  // Globe lamps along the walk's landward edge and by the railing; benches facing the water.
  // The pocket east of the clock is the closure (wall, parapet, kiosks), so nothing is planted in it.
  // The footbridge mouth stays clear of posts too.
  const clockEast = clock.x + P.clock.plinth / 2;
  const bridgeHere = (x: number) => Math.abs(x - wheel.pos.x) < P.wheel.bridgeW / 2 + 0.8;
  for (let lx = b.minX + 12; lx < b.maxX - 8; lx += P.lampStep) {
    if (Math.abs(lx - clock.x) < P.clock.plinth || bridgeHere(lx)) continue;
    if (lx < clockEast) dress.lamps.push({ x: lx, z: walk.minZ - 1 });
    const waterLamp = lx + P.lampStep / 2;
    if (waterLamp < clockEast && !bridgeHere(waterLamp)) dress.lamps.push({ x: waterLamp, z: z1 - 1.2 });
  }
  for (let bx = b.minX + 20; bx < clock.x - P.clock.plinth; bx += P.benchStep) {
    if (bridgeHere(bx)) continue;
    dress.benches.push({ pos: { x: bx, z: z1 - 4.2 }, yaw: 0 });
  }
  const closure = portClosure(b.maxX, z0, z1, clockEast);
  dress.colliders.push(
    ...dress.trees.map((p) => post(p, 0.35)),
    ...dress.lamps.map((p) => post(p, 0.16)),
    ...dress.benches.map((q) => post(q.pos, 0.9)),
    wheel.gate,
    ...wheelRails(wheel),
    closure.wall,
    closure.parapet,
    ...closure.kiosks,
    ...closure.benches.map((q) => post(q.pos, 0.9)),
  );

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
    wheel,
    closure,
  };
  f.port = port;
  openQuayWall(city, wheel.bridge.minX, wheel.bridge.maxX);

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

/**
 * Island, footbridge and the mouth that keeps cars off it. The two walking lines sit in the gaps between the
 * center pier and the side rails; each gap is under 1.4 m, the narrowest car.
 */
function planWheel(clock: Vec2, waterZ: number): PortWheel {
  const W = PORT.wheel;
  const cx = clock.x - W.west;
  const cz = waterZ + W.south;
  const deck: AABB = { minX: cx - W.halfX, maxX: cx + W.halfX, minZ: cz - W.halfZ, maxZ: cz + W.halfZ };
  const bridge: AABB = { minX: cx - W.bridgeW / 2, maxX: cx + W.bridgeW / 2, minZ: waterZ, maxZ: deck.minZ };
  const rail = 0.18;
  const inner = W.bridgeW / 2 - rail;
  const halfGate = W.gateW / 2;
  const pass = (inner + halfGate) / 2;
  const gate: AABB = {
    minX: cx - halfGate,
    maxX: cx + halfGate,
    minZ: waterZ - 2.6,
    maxZ: waterZ + 1.4,
    top: CONFIG.CURB_HEIGHT + 1.3,
  };
  return { deck, bridge, gate, pos: { x: cx, z: cz }, radius: W.radius, gaps: [cx - pass, cx + pass] };
}

/** Side rails of the footbridge, from the promenade approach out to the island. */
function wheelRails(w: PortWheel): AABB[] {
  const rail = 0.18;
  const z0 = w.gate.minZ - 0.2;
  const top = CONFIG.CURB_HEIGHT + 1.15;
  const side = (x0: number): AABB => ({ minX: x0, maxX: x0 + rail, minZ: z0, maxZ: w.bridge.maxZ, top });
  return [side(w.bridge.minX), side(w.bridge.maxX - rail)];
}

/** The south boundary wall is one slab. Leave a slot the width of the footbridge. */
function openQuayWall(city: CityModel, x0: number, x1: number): void {
  const i = city.walls.findIndex((w) => w.minZ === city.waterZ && w.maxX - w.minX > 80);
  if (i < 0) return;
  const w = city.walls[i];
  city.walls.splice(
    i,
    1,
    { minX: w.minX, maxX: x0, minZ: w.minZ, maxZ: w.maxZ },
    { minX: x1, maxX: w.maxX, minZ: w.minZ, maxZ: w.maxZ },
  );
}

/**
 * The promenade's east end, past the clock. The map already collides here; this is the stone that shows it:
 * a wall on the east edge, a parapet along the water, three kiosks and a bench at each.
 */
function portClosure(edge: number, z0: number, zWater: number, clockEast: number): PortClosure {
  const wallH = 1.7;
  const parapetH = 1.15;
  const kioskH = 3.05;
  const y = CONFIG.CURB_HEIGHT;
  const wall: AABB = { minX: edge - 0.5, maxX: edge, minZ: z0, maxZ: zWater, top: y + wallH };
  const parapet: AABB = { minX: clockEast + 0.3, maxX: wall.minX + 0.02, minZ: zWater - 0.5, maxZ: zWater, top: y + parapetH };
  const kioskAt = (z: number): AABB => ({
    minX: wall.minX - 2.7,
    maxX: wall.minX + 0.02,
    minZ: z - 1.45,
    maxZ: z + 1.45,
    top: y + kioskH,
  });
  // One behind the tower toward the water, one beside it, one up by the quay road
  const kiosks = [zWater - 4.4, (z0 + zWater) / 2, z0 + 8].map(kioskAt);
  const benches = kiosks.map((k) => ({ pos: { x: k.minX - 1.55, z: (k.minZ + k.maxZ) / 2 }, yaw: 0 }));
  return { wall, parapet, kiosks, benches, wallH, parapetH, kioskH };
}
