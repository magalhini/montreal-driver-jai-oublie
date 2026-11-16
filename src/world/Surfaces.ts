import type { Block, Vec2 } from '../types';
import { inBox, inner, type CityFeatures } from './Features';
import type { CityModel } from './RoadGraph';

/**
 * What the ground is at a point (IMPROVEMENTS #11), the one classification behind curb heights, the block
 * surface meshes and the sidewalk offense. Only `sidewalk` (raised pavement: the ring around each block and
 * the slab between its buildings) is off limits for cars; everything else off the road is fair game.
 */
export type SurfaceKind =
  | 'road'
  | 'sidewalk'
  /** Curb cuts from the road into lots, yards and garages. */
  | 'driveway'
  /** Parking lots, garage forecourts and the yard. */
  | 'lot'
  /** Lawns and gravel of the parks. */
  | 'park'
  /** Lanes through blocks between the buildings (IMPROVEMENTS #19). */
  | 'alley'
  /** Semi-indoor areas: garages, passages under buildings, covered nooks (see `Interior`). */
  | 'interior'
  | 'water'
  /** Beyond the city edge (harbor water, outside the boundary walls). */
  | 'outside';

/** Raised by the curb above road level (visual only: cars drive on `Terrain.heightAt`). */
export const RAISED: Record<SurfaceKind, boolean> = {
  road: false,
  sidewalk: true,
  driveway: false,
  lot: false,
  park: false,
  alley: false,
  interior: false,
  // canal water inside the blocks keeps the slab's curb line along the quays (its mesh is the water)
  water: true,
  outside: false,
};

/** Road-level surface of a block's interior (inside the sidewalk ring), or null for a raised slab with buildings. */
export function blockFloor(f: CityFeatures, b: Block): 'lot' | null {
  return f.kinds[b.id] === 'lot' || b.district === 'depot' ? 'lot' : null;
}

export function surfaceAt(city: CityModel, p: Vec2): SurfaceKind {
  if (city.roadAt(p)) return 'road';
  const f = city.features;
  for (const r of f.interiors) if (inBox(p, r.box)) return 'interior';
  const b = city.blockAt(p);
  if (!b) {
    const o = city.bounds;
    return p.x > o.minX && p.x < o.maxX && p.z < city.waterZ ? 'sidewalk' : 'outside';
  }
  const floor = blockFloor(f, b);
  if (floor && inBox(p, inner(b))) return floor;
  // Pit stop forecourts (IMPROVEMENTS #20) are road-level paving cut out of the block's corner
  for (const s of f.pitStops) if (inBox(p, s.box)) return 'lot';
  if (f.station && inBox(p, f.station.lot)) return 'lot';
  for (const r of f.driveways) if (inBox(p, r)) return 'driveway';
  for (const park of f.parks ?? []) if (inBox(p, park.lawn)) return 'park';
  for (const a of f.alleys) if (inBox(p, a.box)) return 'alley';
  if (city.terrain.isWater(p.x, p.z)) return 'water';
  return 'sidewalk';
}
