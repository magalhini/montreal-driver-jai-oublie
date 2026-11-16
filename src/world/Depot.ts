import { CONFIG } from '../config';
import type { AABB, Block, Building, Facing, Vec2 } from '../types';
import type { CarLook } from '../vehicles/Car';

/**
 * The Dispatch Office yard (the depot block), planned as pure data. Along the north edge: the HQ tower and a
 * loading-dock warehouse wing either side of it. In front of the tower: the dispatch ring. Three gated
 * entrances (south, west, east) cut through the sidewalk ring, each with a drive lane to the ring. A planter
 * wall closes the rest of the lot, so the only way in is through a gate (no hopping the curb, which the
 * police don't like). `DepotView` dresses it; `Districts` puts its buildings up.
 */
export interface DepotGate {
  side: Facing;
  /** The curb cut through the sidewalk ring (a road-level driveway). */
  mouth: AABB;
  /** Middle of the cut on the lot's edge, and the unit vector from there into the lot. */
  edge: Vec2;
  inward: Vec2;
  /** Where the gate's drive lane ends, beside the ring. */
  lane: Vec2;
}

export interface DepotPlan {
  /** The lot inside the sidewalk ring. */
  yard: AABB;
  tower: AABB;
  wings: AABB[];
  /** Center of the dispatch ring. */
  ring: Vec2;
  gates: DepotGate[];
  /** The planter wall along the lot's edge, gaps at the gates (also colliders). */
  planters: AABB[];
  /** Gate pillars, the guard booth, container stacks, pallets, light masts. */
  colliders: AABB[];
  booth: AABB;
  containers: { box: AABB; color: number }[];
  pallets: AABB[];
  masts: Vec2[];
  /** Loading dock doors on the wings' yard faces: x of the door center (they all sit on `dockZ`). */
  docks: number[];
  dockZ: number;
  /** Parking bays along the south wall (nose to the wall), and the staff cars and vans in them. */
  bays: Vec2[];
  parked: { pos: Vec2; yaw: number; look?: CarLook }[];
}

export const DEPOT = {
  towerW: 24,
  towerH: 20,
  wingH: 8,
  /** Every HQ building is this deep, flush with the north edge of the yard. */
  depth: 14,
  /** The ring sits this far in front of the tower; the side gates are on its row. */
  ringOut: 12,
  gateW: 12,
  planter: { thick: 0.9 },
  pillar: 1.2,
  archY: 5.4,
  bayW: 2.9,
  bayD: 5.4,
  amber: '#ffb43e',
};

const box = (minX: number, minZ: number, maxX: number, maxZ: number): AABB => ({ minX, minZ, maxX, maxZ });

/** The lot inside the depot block's sidewalk ring. */
export function depotYard(b: Block): AABB {
  const sw = CONFIG.SIDEWALK;
  return box(b.min.x + sw, b.min.z + sw, b.max.x - sw, b.max.z - sw);
}

/**
 * The HQ's three boxes (tower first: it is the Dispatch Office). They dress themselves (`landmark`): no
 * generic signs or rooftop clutter. `seed` comes from the block's random stream.
 */
export function depotBuildings(yard: AABB, seed: number): Building[] {
  const D = DEPOT;
  const cx = (yard.minX + yard.maxX) / 2;
  const z0 = yard.minZ;
  const z1 = z0 + D.depth;
  const tw = D.towerW / 2;
  const common = { minZ: z0, maxZ: z1, district: 'depot' as const, landmark: true };
  return [
    { ...common, minX: cx - tw, maxX: cx + tw, height: D.towerH, faces: ['S', 'N', 'W', 'E'], seed, facade: { style: 0, color: [0.16, 0.14, 0.2], lit: 0.75 } },
    { ...common, minX: yard.minX, maxX: cx - tw - 0.4, height: D.wingH, faces: ['S', 'N', 'W'], seed: seed + 1, facade: { style: 2, color: [0.2, 0.17, 0.15], lit: 0.35 } },
    { ...common, minX: cx + tw + 0.4, maxX: yard.maxX, height: D.wingH, faces: ['S', 'N', 'E'], seed: seed + 2, facade: { style: 2, color: [0.2, 0.17, 0.15], lit: 0.35 } },
  ];
}

const KEI: CarLook = { style: 'kei', color: 0xe8e4da };
const VAN_COLORS = [0xe8e4da, 0xd4651a, 0xf0f0ea];

export function planDepot(b: Block): DepotPlan {
  const D = DEPOT;
  const sw = CONFIG.SIDEWALK;
  const yard = depotYard(b);
  const cx = (yard.minX + yard.maxX) / 2;
  const front = yard.minZ + D.depth;
  const ring = { x: cx, z: front + D.ringOut };
  const hw = D.gateW / 2;
  const t = D.planter.thick;

  // Gates: the curb cuts and their lanes to the ring
  const gates: DepotGate[] = [
    { side: 'S', mouth: box(cx - hw, b.max.z - sw, cx + hw, b.max.z), edge: { x: cx, z: yard.maxZ }, inward: { x: 0, z: -1 }, lane: { x: cx, z: ring.z + 7 } },
    { side: 'W', mouth: box(b.min.x, ring.z - hw, b.min.x + sw, ring.z + hw), edge: { x: yard.minX, z: ring.z }, inward: { x: 1, z: 0 }, lane: { x: cx - 7, z: ring.z } },
    { side: 'E', mouth: box(b.max.x - sw, ring.z - hw, b.max.x, ring.z + hw), edge: { x: yard.maxX, z: ring.z }, inward: { x: -1, z: 0 }, lane: { x: cx + 7, z: ring.z } },
  ];

  // The planter wall, inside the lot along the sidewalk ring, open at the gates (the north edge is the HQ)
  const p = D.pillar;
  const planters = [
    box(yard.minX, yard.maxZ - t, cx - hw - p, yard.maxZ),
    box(cx + hw + p, yard.maxZ - t, yard.maxX, yard.maxZ),
    box(yard.minX, front, yard.minX + t, ring.z - hw - p),
    box(yard.minX, ring.z + hw + p, yard.minX + t, yard.maxZ - t),
    box(yard.maxX - t, front, yard.maxX, ring.z - hw - p),
    box(yard.maxX - t, ring.z + hw + p, yard.maxX, yard.maxZ - t),
  ];

  const colliders: AABB[] = [];
  // Gate pillars either side of each cut, on the planter line
  for (const g of gates) {
    const along = { x: -g.inward.z, z: g.inward.x };
    for (const s of [-1, 1]) {
      const c = { x: g.edge.x + along.x * s * (hw + p / 2) + g.inward.x * (t / 2), z: g.edge.z + along.z * s * (hw + p / 2) + g.inward.z * (t / 2) };
      colliders.push(box(c.x - p / 2, c.z - p / 2, c.x + p / 2, c.z + p / 2));
    }
  }
  // Guard booth just inside the south gate, east of the lane
  const booth = box(cx + hw + 2, yard.maxZ - t - 6.5, cx + hw + 5, yard.maxZ - t - 2.5);
  colliders.push(booth);

  // Bays along the south wall, either side of the south lane, nose to the wall
  const bays: Vec2[] = [];
  const bz = yard.maxZ - t - D.bayD / 2 - 0.3;
  for (let x = yard.minX + t + 2 + D.bayW / 2; x + D.bayW / 2 < cx - hw - 6; x += D.bayW) bays.push({ x, z: bz });
  for (let x = cx + hw + 7 + D.bayW / 2; x + D.bayW / 2 < yard.maxX - t - 2; x += D.bayW) bays.push({ x, z: bz });

  // Container stacks and pallets in the open corners between the side lanes and the bays
  const midZ = (ring.z + hw + 4 + bz - D.bayD) / 2;
  const containers: { box: AABB; color: number }[] = [];
  const pallets: AABB[] = [];
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? yard.minX + t + 4 : yard.maxX - t - 4 - 12.2;
    containers.push({ box: box(x0, midZ - 5.5, x0 + 12.2, midZ - 3.1), color: s < 0 ? 0xc0461e : 0x1f5f8a });
    containers.push({ box: box(x0, midZ - 2.6, x0 + 12.2, midZ - 0.2), color: s < 0 ? 0x2c6e4a : 0xb8892a });
    const px = s < 0 ? x0 + 14 : x0 - 4;
    for (let k = 0; k < 3; k++) pallets.push(box(px, midZ + 2 + k * 1.6, px + 1.2, midZ + 3.2 + k * 1.6));
  }
  for (const c of containers) colliders.push(c.box);
  for (const q of pallets) colliders.push(q);

  // Light masts at the four quarters of the open yard
  const masts = [
    { x: cx - 11, z: midZ - 3 },
    { x: cx + 11, z: midZ - 3 },
    { x: yard.minX + t + 2, z: front + 2 },
    { x: yard.maxX - t - 2, z: front + 2 },
  ];
  for (const m of masts) colliders.push(box(m.x - 0.3, m.z - 0.3, m.x + 0.3, m.z + 0.3));

  // Loading docks: three doors on each wing's yard face
  const wings = [box(yard.minX, yard.minZ, cx - D.towerW / 2 - 0.4, front), box(cx + D.towerW / 2 + 0.4, yard.minZ, yard.maxX, front)];
  const docks = [-7, 0, 7].flatMap((o) => wings.map((w) => (w.minX + w.maxX) / 2 + o));

  // Kei trucks backed up to some docks, staff cars in some bays (always the same ones)
  const parked: DepotPlan['parked'] = [];
  docks.forEach((x, i) => {
    if (i % 3 !== 1) parked.push({ pos: { x, z: front + 2.2 }, yaw: 0, look: { ...KEI, color: VAN_COLORS[i % VAN_COLORS.length] } });
  });
  bays.forEach((q, i) => {
    if (i % 3 !== 2) parked.push({ pos: { x: q.x, z: q.z }, yaw: 0 });
  });

  return { yard, tower: box(cx - D.towerW / 2, yard.minZ, cx + D.towerW / 2, front), wings, ring, gates, planters, colliders, booth, containers, pallets, masts, docks, dockZ: front, bays, parked };
}
