import { CONFIG } from '../config';
import type { AABB, Block, Interior, Vec2 } from '../types';
import type { DepotPlan } from './Depot';
import type { PitStop } from './PitStops';
import type { PoliceStation } from './PoliceStation';

/**
 * Landmarks that break up the grid (pure data, no three.js): the canal with humped bridges, parks, garages,
 * the precinct and alleys. Chosen once by the city generator; terrain, buildings,
 * props and views all read this.
 */

/** The Lachine Canal: runs east-west through the middle of one row of blocks. */
export interface Canal {
  /** Block row it runs through. */
  row: number;
  /** Water band between the quay walls (z). */
  z0: number;
  z1: number;
  zc: number;
  /** Water surface and bed heights. */
  water: number;
  bed: number;
  /** Humped bridges: half length of the hump along the road and its height. */
  humpHalf: number;
  humpHeight: number;
  /** x range where the canal is open (beyond it disappears under the outer skyline). */
  x0: number;
  x1: number;
  /** Map label. */
  label?: string;
  labelSub?: string;
}

/** `bridge`: a landmark block (arena, silos, clock tower) held back from the other planners. */
export type BlockKind = 'normal' | 'lot' | 'pitStop' | 'bridge' | 'police' | 'park';

/**
 * Alley (IMPROVEMENTS #19): a narrow road-level lane straight through a block, street to street, cut between
 * the buildings. Stretches of it may run under a building (a `passage` interior).
 */
export interface Alley {
  block: number;
  /** Direction it runs: 'z' = north-south, 'x' = east-west. */
  axis: 'x' | 'z';
  /** Lane footprint, from road edge to road edge (it crosses the sidewalk ring at both mouths). */
  box: AABB;
  /** Hanging lanterns or wall lamps. */
  lit: 'lanterns' | 'lamps';
}

export interface CityFeatures {
  canal: Canal | null;
  kinds: BlockKind[];
  /** Driveway gaps in the sidewalk ring (road level, no curb). Where driving is allowed: see `Surfaces.ts`. */
  driveways: AABB[];
  /** Parked car slots: position + heading. */
  parking: { pos: Vec2; yaw: number }[];
  /** Alleys through blocks (shortcuts). */
  alleys: Alley[];
  /** Semi-indoor areas (garages, passages under buildings, covered nooks). */
  interiors: Interior[];
  /** Corner garages: stop under the canopy for repairs (IMPROVEMENTS #20). */
  pitStops: PitStop[];
  /** Precinct with cruiser bays. Planned after the buildings (`planPoliceStation`). */
  station: PoliceStation | null;
  /** The yard (`world/Depot.ts`): HQ, gates, planter wall, docks. */
  depot: DepotPlan | null;
  /** Gardens inside a block: a lawn, a path, trees (`maps/montreal/Parks.ts`). */
  parks?: CityPark[];
}

/** A garden cut out of one block. The rest of the block keeps its street wall. */
export interface CityPark {
  block: number;
  /** Road-level lawn. */
  lawn: AABB;
  /** Gravel walk across the lawn, in line with the gate. */
  path: AABB;
  /** Curb cut from the street to the lawn. Also listed in `driveways`. */
  gate: AABB;
  trees: { pos: Vec2; r: number; pink: boolean }[];
  lamps: Vec2[];
  lanterns: Vec2[];
  benches: { pos: Vec2; yaw: number }[];
  colliders: AABB[];
}

export function emptyFeatures(): CityFeatures {
  return { canal: null, kinds: [], driveways: [], parking: [], alleys: [], interiors: [], pitStops: [], station: null, depot: null };
}

/** Block area inside the sidewalk ring. */
export function inner(b: Block): AABB {
  const sw = CONFIG.SIDEWALK;
  return { minX: b.min.x + sw, maxX: b.max.x - sw, minZ: b.min.z + sw, maxZ: b.max.z - sw };
}

export const inBox = (p: Vec2, r: AABB, m = 0): boolean => p.x >= r.minX - m && p.x <= r.maxX + m && p.z >= r.minZ - m && p.z <= r.maxZ + m;
