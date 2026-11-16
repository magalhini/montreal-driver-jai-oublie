import type { AABB, Building, Vec2 } from '../../types';
import { inner, type CitySquare } from '../../world/Features';
import { subtractRect } from '../../world/Interiors';
import type { CityModel } from '../../world/RoadGraph';
import { carveBuilding } from './Parks';
import { SQUARES } from './layout';

/** Square dressing (PRD Phase 5): meters. */
const SQ = {
  /** Fountain basin radius, with and without a monument in it. */
  basin: 7.5,
  jets: 9,
  /** Paving between the lawns and the plaza's edge, the walks crossing at the fountain, and round the basin. */
  edge: 5,
  walk: 9,
  around: 8,
  /** Trees on the lawns, about this far apart (every other point of the grid). */
  treeStep: 8,
  lampIn: 3.5,
};

/**
 * Pedestrian squares surrounded by streets: the block's buildings give way to raised paving (no cars: it is the
 * sidewalk to the offense check), except a street wall `keep` meters deep along the north. A fountain sits in the
 * middle, snowy lawns with trees between the walks, globe lamps, benches round the basin and along the walks.
 * Block kinds are set by the generator before the other planners; this runs after the buildings are up.
 */
export function laySquares(city: CityModel): void {
  const out: CitySquare[] = [];
  for (const s of SQUARES) {
    const bl = city.blocks.find((b) => b.gi === s.i && b.gj === s.j);
    if (!bl) continue;
    const r = inner(bl);
    const cx = (r.minX + r.maxX) / 2;
    const half = Math.min((r.maxX - r.minX) / 2, (s.width ?? Infinity) / 2);
    const plaza: AABB = { minX: cx - half, maxX: cx + half, minZ: Math.min(r.maxZ - 30, r.minZ + s.keep), maxZ: r.maxZ };
    out.push(layout(bl.id, plaza, s.monument, s.name));
  }
  city.features.squares = out;
  if (!out.length) return;
  const holes = out.map((q) => q.plaza);
  const kept: Building[] = [];
  for (const b of city.buildings) {
    const next = carveBuilding(b, holes);
    if (next) kept.push(next);
  }
  city.buildings = kept;
}

function layout(block: number, plaza: AABB, monument: boolean, name?: string): CitySquare {
  const cx = (plaza.minX + plaza.maxX) / 2;
  const cz = (plaza.minZ + plaza.maxZ) / 2;
  const r = monument ? SQ.basin : SQ.jets;
  // Four lawns between two walks crossing at the fountain, kept clear of the paving round the basin
  const e = SQ.edge;
  const w = SQ.walk / 2;
  const clear = r + SQ.around;
  const hole: AABB = { minX: cx - clear, maxX: cx + clear, minZ: cz - clear, maxZ: cz + clear };
  const quads: AABB[] = [
    { minX: plaza.minX + e, maxX: cx - w, minZ: plaza.minZ + e, maxZ: cz - w },
    { minX: cx + w, maxX: plaza.maxX - e, minZ: plaza.minZ + e, maxZ: cz - w },
    { minX: plaza.minX + e, maxX: cx - w, minZ: cz + w, maxZ: plaza.maxZ - e },
    { minX: cx + w, maxX: plaza.maxX - e, minZ: cz + w, maxZ: plaza.maxZ - e },
  ];
  const lawns = quads.flatMap((q) => subtractRect(q, hole)).filter((q) => q.maxX - q.minX > 4 && q.maxZ - q.minZ > 4);
  const trees: Vec2[] = [];
  for (const l of lawns) {
    const nx = Math.max(1, Math.floor((l.maxX - l.minX - 4) / SQ.treeStep));
    const nz = Math.max(1, Math.floor((l.maxZ - l.minZ - 4) / SQ.treeStep));
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const x = l.minX + 2 + ((i + 0.5) * (l.maxX - l.minX - 4)) / nx;
        const z = l.minZ + 2 + ((k + 0.5) * (l.maxZ - l.minZ - 4)) / nz;
        if ((i + k) % 2 === 0 || nx * nz <= 2) trees.push({ x, z });
      }
    }
  }
  // Globe lamps at the plaza's corners, where the walks meet its edges, and round the basin
  const li = SQ.lampIn;
  const lamps: Vec2[] = [
    { x: plaza.minX + li, z: plaza.minZ + li },
    { x: plaza.maxX - li, z: plaza.minZ + li },
    { x: plaza.minX + li, z: plaza.maxZ - li },
    { x: plaza.maxX - li, z: plaza.maxZ - li },
    { x: cx - w - 1, z: plaza.minZ + li },
    { x: cx + w + 1, z: plaza.maxZ - li },
    { x: plaza.minX + li, z: cz + w + 1 },
    { x: plaza.maxX - li, z: cz - w - 1 },
  ];
  const benches: CitySquare['benches'] = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const d = { x: Math.cos(a), z: Math.sin(a) };
    lamps.push({ x: cx + d.x * (r + SQ.around + 1), z: cz + d.z * (r + SQ.around + 1) });
    // On the diagonals (the walkers circle on the axes), facing the basin
    benches.push({ pos: { x: cx + d.x * (r + 3), z: cz + d.z * (r + 3) }, yaw: Math.atan2(-d.x, -d.z) });
  }
  // Benches along the walks, backs to the lawns
  for (const l of lawns) {
    const midX = (l.minX + l.maxX) / 2;
    const midZ = (l.minZ + l.maxZ) / 2;
    if (l.maxZ <= cz - w + 0.01 && l.maxZ - l.minZ > 10) benches.push({ pos: { x: midX, z: l.maxZ + 1 }, yaw: 0 });
    if (l.minZ >= cz + w - 0.01 && l.maxZ - l.minZ > 10) benches.push({ pos: { x: midX, z: l.minZ - 1 }, yaw: Math.PI });
    if (l.maxX <= cx - w + 0.01 && l.maxX - l.minX > 10) benches.push({ pos: { x: l.maxX + 1, z: midZ }, yaw: Math.PI / 2 });
    if (l.minX >= cx + w - 0.01 && l.maxX - l.minX > 10) benches.push({ pos: { x: l.minX - 1, z: midZ }, yaw: -Math.PI / 2 });
  }
  const post = (p: Vec2, s: number): AABB => ({ minX: p.x - s, maxX: p.x + s, minZ: p.z - s, maxZ: p.z + s });
  return {
    block,
    name,
    plaza,
    lawns,
    fountain: { pos: { x: cx, z: cz }, r },
    monument,
    trees,
    lamps,
    benches,
    colliders: [post({ x: cx, z: cz }, r * 0.92), ...trees.map((p) => post(p, 0.35)), ...lamps.map((p) => post(p, 0.16)), ...benches.map((q) => post(q.pos, 0.9))],
  };
}
