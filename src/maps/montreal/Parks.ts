import { CONFIG } from '../../config';
import { Rng } from '../../core/Rng';
import type { AABB, Block, Building, Facing, Vec2 } from '../../types';
import type { CityPark } from '../../world/Features';
import type { CityModel } from '../../world/RoadGraph';
import { avenueX, avenueZ, isPark } from './layout';

/** Largest garden. The old parks were the whole block, which on this grid is a field. */
const CAP = 56;
const MIN = 22;
const PATH = 5;
const GATE = 10;

/**
 * Turn each full-block lawn into a garden: a smaller road-level square, a gravel path in from the street,
 * trees, lamps, stone lanterns and benches. The street wall stays; buildings that fall in the garden are
 * pulled back to its edge. Own random stream.
 */
export function layParks(city: CityModel, seed: number): void {
  const rng = new Rng(seed + 41);
  const parks: CityPark[] = [];
  for (const block of city.blocks) {
    if (!isPark(block.gi, block.gj)) continue;
    const park = layoutPark(block, rng);
    if (!park) continue;
    parks.push(park);
    city.features.driveways.push(park.gate);
  }
  city.features.parks = parks;
  if (!parks.length) return;
  const holes = parks.flatMap((p) => [p.lawn, p.gate]);
  const kept: Building[] = [];
  for (const b of city.buildings) {
    const next = carveBuilding(b, holes);
    if (next) kept.push(next);
  }
  city.buildings = kept;
}

function layoutPark(block: Block, rng: Rng): CityPark | null {
  const sw = CONFIG.SIDEWALK;
  const ix0 = block.min.x + sw;
  const iz0 = block.min.z + sw;
  const ix1 = block.max.x - sw;
  const iz1 = block.max.z - sw;
  const w = ix1 - ix0;
  const d = iz1 - iz0;
  const room = Math.min(w, d);
  if (room < MIN + 16) return null;
  const span = Math.min(CAP, Math.max(MIN, room - 28), w - 16, d - 16);
  if (span < MIN) return null;
  const cx = (ix0 + ix1) / 2;
  const cz = (iz0 + iz1) / 2;
  const lawn: AABB = { minX: cx - span / 2, maxX: cx + span / 2, minZ: cz - span / 2, maxZ: cz + span / 2 };
  const side = entrance(block);
  const gate = gateBox(block, lawn, side);
  const path = pathBox(lawn, side);
  const trees = plant(lawn, path, rng);
  const lamps = corners(lawn, 3.2).filter((p) => !hits(p, path, 1.5));
  const lanterns = placeLanterns(lawn, side, span).filter((p) => trees.every((t) => Math.hypot(t.pos.x - p.x, t.pos.z - p.z) > 2.6));
  const benches = placeBenches(lawn, side, span);
  const post = (p: Vec2, r: number): AABB => ({ minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r });
  return {
    block: block.id,
    lawn,
    path,
    gate,
    trees,
    lamps,
    lanterns,
    benches,
    colliders: [
      ...trees.map((t) => post(t.pos, 0.35)),
      ...lamps.map((p) => post(p, 0.16)),
      ...lanterns.map((p) => post(p, 0.4)),
      ...benches.map((b) => benchBox(b)),
    ],
  };
}

/** Open onto a boulevard when the block has one. */
function entrance(block: Block): Facing {
  const sides: Facing[] = [];
  if (avenueZ(block.gj)) sides.push('N');
  if (avenueZ(block.gj + 1)) sides.push('S');
  if (avenueX(block.gi)) sides.push('W');
  if (avenueX(block.gi + 1)) sides.push('E');
  if (!sides.length) return 'S';
  return sides[block.id % sides.length];
}

function gateBox(block: Block, lawn: AABB, side: Facing): AABB {
  const hx = GATE / 2;
  const hz = GATE / 2;
  const mx = (lawn.minX + lawn.maxX) / 2;
  const mz = (lawn.minZ + lawn.maxZ) / 2;
  if (side === 'N') return { minX: mx - hx, maxX: mx + hx, minZ: block.min.z, maxZ: lawn.minZ };
  if (side === 'S') return { minX: mx - hx, maxX: mx + hx, minZ: lawn.maxZ, maxZ: block.max.z };
  if (side === 'W') return { minX: block.min.x, maxX: lawn.minX, minZ: mz - hz, maxZ: mz + hz };
  return { minX: lawn.maxX, maxX: block.max.x, minZ: mz - hz, maxZ: mz + hz };
}

function pathBox(lawn: AABB, side: Facing): AABB {
  const mx = (lawn.minX + lawn.maxX) / 2;
  const mz = (lawn.minZ + lawn.maxZ) / 2;
  const h = PATH / 2;
  if (side === 'N' || side === 'S') return { minX: mx - h, maxX: mx + h, minZ: lawn.minZ, maxZ: lawn.maxZ };
  return { minX: lawn.minX, maxX: lawn.maxX, minZ: mz - h, maxZ: mz + h };
}

function plant(lawn: AABB, path: AABB, rng: Rng): CityPark['trees'] {
  const trees: CityPark['trees'] = [];
  for (let x = lawn.minX + 4; x < lawn.maxX - 3; x += 8) {
    for (let z = lawn.minZ + 4; z < lawn.maxZ - 3; z += 8) {
      const p = { x: x + rng.range(-1.5, 1.5), z: z + rng.range(-1.5, 1.5) };
      const pink = rng.chance(0.62);
      const skip = rng.chance(0.14);
      const r = rng.range(2.3, 3.5);
      if (skip) continue;
      if (p.x < lawn.minX + 2.4 || p.x > lawn.maxX - 2.4 || p.z < lawn.minZ + 2.4 || p.z > lawn.maxZ - 2.4) continue;
      if (hits(p, path, 3.1)) continue;
      trees.push({ pos: p, r, pink });
    }
  }
  return trees;
}

function corners(lawn: AABB, inset: number): Vec2[] {
  return [
    { x: lawn.minX + inset, z: lawn.minZ + inset },
    { x: lawn.maxX - inset, z: lawn.minZ + inset },
    { x: lawn.minX + inset, z: lawn.maxZ - inset },
    { x: lawn.maxX - inset, z: lawn.maxZ - inset },
  ];
}

function placeLanterns(lawn: AABB, side: Facing, span: number): Vec2[] {
  const mx = (lawn.minX + lawn.maxX) / 2;
  const mz = (lawn.minZ + lawn.maxZ) / 2;
  const along = span * 0.32;
  const off = 4.4;
  if (side === 'N' || side === 'S') {
    return [
      { x: mx - off, z: mz - along },
      { x: mx + off, z: mz - along },
      { x: mx - off, z: mz + along },
      { x: mx + off, z: mz + along },
    ].filter((p) => p.x > lawn.minX + 1.5 && p.x < lawn.maxX - 1.5 && p.z > lawn.minZ + 1.5 && p.z < lawn.maxZ - 1.5);
  }
  return [
    { x: mx - along, z: mz - off },
    { x: mx - along, z: mz + off },
    { x: mx + along, z: mz - off },
    { x: mx + along, z: mz + off },
  ].filter((p) => p.x > lawn.minX + 1.5 && p.x < lawn.maxX - 1.5 && p.z > lawn.minZ + 1.5 && p.z < lawn.maxZ - 1.5);
}

function placeBenches(lawn: AABB, side: Facing, span: number): CityPark['benches'] {
  const mx = (lawn.minX + lawn.maxX) / 2;
  const mz = (lawn.minZ + lawn.maxZ) / 2;
  const along = span * 0.16;
  const off = PATH / 2 + 1.55;
  if (side === 'N' || side === 'S') {
    return [
      { pos: { x: mx - off, z: mz - along }, yaw: Math.PI / 2 },
      { pos: { x: mx + off, z: mz - along }, yaw: -Math.PI / 2 },
      { pos: { x: mx - off, z: mz + along }, yaw: Math.PI / 2 },
      { pos: { x: mx + off, z: mz + along }, yaw: -Math.PI / 2 },
    ];
  }
  return [
    { pos: { x: mx - along, z: mz - off }, yaw: 0 },
    { pos: { x: mx - along, z: mz + off }, yaw: Math.PI },
    { pos: { x: mx + along, z: mz - off }, yaw: 0 },
    { pos: { x: mx + along, z: mz + off }, yaw: Math.PI },
  ];
}

function benchBox(b: CityPark['benches'][number]): AABB {
  const hx = Math.abs(Math.cos(b.yaw)) * 0.9 + 0.35;
  const hz = Math.abs(Math.sin(b.yaw)) * 0.9 + 0.35;
  return { minX: b.pos.x - hx, maxX: b.pos.x + hx, minZ: b.pos.z - hz, maxZ: b.pos.z + hz };
}

function hits(p: Vec2, box: AABB, m: number): boolean {
  return p.x > box.minX - m && p.x < box.maxX + m && p.z > box.minZ - m && p.z < box.maxZ + m;
}

/** Drop a building whose middle sits in a hole. Otherwise pull the intruding edge back, so the street face stays. */
export function carveBuilding(b: Building, holes: AABB[]): Building | null {
  const gap = 1.2;
  for (const h of holes) {
    if (b.maxX <= h.minX || b.minX >= h.maxX || b.maxZ <= h.minZ || b.minZ >= h.maxZ) continue;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    if (cx > h.minX && cx < h.maxX && cz > h.minZ && cz < h.maxZ) return null;
    if (cx >= h.maxX) b.minX = Math.max(b.minX, h.maxX + gap);
    else if (cx <= h.minX) b.maxX = Math.min(b.maxX, h.minX - gap);
    if (cz >= h.maxZ) b.minZ = Math.max(b.minZ, h.maxZ + gap);
    else if (cz <= h.minZ) b.maxZ = Math.min(b.maxZ, h.minZ - gap);
    if (b.maxX - b.minX < 3 || b.maxZ - b.minZ < 3) return null;
  }
  const t = b.tower;
  if (t && Math.min(b.maxX - b.minX, b.maxZ - b.minZ) < t.inset * 2 + 6) delete b.tower;
  return b;
}
