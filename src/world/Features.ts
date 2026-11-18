import { CONFIG } from '../config';
import type { AABB, Block, Interior, Vec2 } from '../types';
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

/**
 * `bridge`: a landmark block (arena, silos, basilica) held back from the other planners. `square`: a
 * pedestrian square with a fountain (`maps/montreal/Squares.ts`).
 */
export type BlockKind = 'normal' | 'lot' | 'pitStop' | 'bridge' | 'police' | 'park' | 'square';

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
}

export interface CityFeatures {
  canal: Canal | null;
  kinds: BlockKind[];
  /** Driveway gaps in the sidewalk ring (road level, no curb). Where driving is allowed: see `Surfaces.ts`. */
  driveways: AABB[];
  /** Parked car slots in lots: position + heading. */
  parking: { pos: Vec2; yaw: number }[];
  /** Parking bays in the curb lanes of streets and boulevards (`world/CurbParking.ts`). */
  curb: CurbBay[];
  /** Alleys through blocks (shortcuts). */
  alleys: Alley[];
  /** Semi-indoor areas (garages, passages under buildings, covered nooks). */
  interiors: Interior[];
  /** Corner garages: stop under the canopy for repairs (IMPROVEMENTS #20). */
  pitStops: PitStop[];
  /** Precinct with cruiser bays. Planned after the buildings (`planPoliceStation`). */
  station: PoliceStation | null;
  /** Gardens inside a block: a lawn, a path, trees (`maps/montreal/Parks.ts`). */
  parks?: CityPark[];
  /** Pedestrian squares with a fountain (`maps/montreal/Squares.ts`). Raised paving: no cars. */
  squares?: CitySquare[];
  /** The Old Port promenade along the river, its parking lot and the clock tower (`maps/montreal/Harbor.ts`). */
  port?: OldPort;
  /** Landmarks with their own meshes (`world/LandmarkView.ts`). */
  basilica?: Basilica;
  clock?: ClockTower;
}

/** Trees, lamps and benches on a square or the promenade (all also listed in `colliders`). */
export interface PlazaDressing {
  trees: Vec2[];
  lamps: Vec2[];
  benches: { pos: Vec2; yaw: number }[];
  colliders: AABB[];
}

/**
 * A pedestrian square: raised paving across the block (driving onto it is the sidewalk offense), a round
 * fountain basin in the middle (drained and iced for December), rows of trees, globe lamps and benches.
 */
export interface CitySquare extends PlazaDressing {
  block: number;
  name?: string;
  /** Paved area (the block's buildings outside it stay). */
  plaza: AABB;
  /** Snowy lawn quadrants between the walks that cross the square. */
  lawns: AABB[];
  fountain: { pos: Vec2; r: number };
  /** A statue on a plinth in the basin (Place d'Armes), or jets (a plain basin). */
  monument: boolean;
}

/**
 * Vieux-Port: a long pedestrian promenade between the quay road and the St. Lawrence (raised: no cars), lawns
 * along the road, a paved walk by the water, and at the east end a road-level parking lot and the clock tower.
 * La Grande Roue stands on an island in the river, off a footbridge cars cannot take.
 */
export interface OldPort extends PlazaDressing {
  /** Road curb to the water. */
  strip: AABB;
  lawns: AABB[];
  /** Paved walk along the water. */
  walk: AABB;
  /** Road-level lot and its curb cuts from the quay road (the cuts are also in `driveways`). */
  lot: AABB;
  mouths: AABB[];
  /** Where pedestrians stroll: a line along the walk. */
  stroll: { z: number; x0: number; x1: number };
  /** Quays out into the river with a long hangar on each (scenery past the quay wall: not reachable). */
  piers: { deck: AABB; shed: AABB }[];
  /** La Grande Roue, on an island just west of the clock tower. */
  wheel?: PortWheel;
  /**
   * The dead end past the clock tower. The map wall there is solid; these are the stone wall, the water
   * parapet and the kiosks that show it (their boxes are also in `colliders`).
   */
  closure?: PortClosure;
}

/**
 * The wheel's island. The quay wall is open only across `bridge`, and `gate` splits that mouth into two gaps
 * (`gaps`) narrower than any car. People walk those lines; the mesh is `world/FerrisWheel.ts`.
 */
export interface PortWheel {
  deck: AABB;
  /** Slab from the water line out to the island. */
  bridge: AABB;
  /** Center barrier in the bridge mouth. `top` stops a car and stays low enough to read as a gate. */
  gate: AABB;
  pos: Vec2;
  /** Rim radius. */
  radius: number;
  /** x of the two walking lines through the mouth, west then east. */
  gaps: [number, number];
}

/** What closes the promenade east of the clock, so the map edge is something you can see. */
export interface PortClosure {
  /** Along the east edge, from the quay road to the water. */
  wall: AABB;
  /** Along the water, from the clock's east side to that wall. */
  parapet: AABB;
  kiosks: AABB[];
  /** Benches in front of the kiosks. Not part of `OldPort.benches` (that list is the waterfront stroll). */
  benches: { pos: Vec2; yaw: number }[];
  wallH: number;
  parapetH: number;
  kioskH: number;
}

/** Notre-Dame: front on Notre-Dame (facing -Z), two towers at the front corners, the nave behind. */
export interface Basilica {
  minX: number;
  maxX: number;
  /** Front wall (north) and apse end (south). */
  minZ: number;
  maxZ: number;
  /** Tower side (square) and height to the parapet. */
  tower: number;
  towerH: number;
  /** Nave eaves and ridge. */
  eaves: number;
  ridge: number;
  /** Ground floor height. */
  y: number;
}

/** Tour de l'Horloge: stone shaft, clock faces, lantern, dome and spire. */
export interface ClockTower {
  pos: Vec2;
  /** Shaft side. */
  side: number;
  height: number;
  y: number;
}

/**
 * One parking space in a road's curb band: an arc-length span along its edge's centerline, on one side, with
 * the spot a parked car stands on (nose the way traffic on that side drives).
 */
export interface CurbBay {
  edge: number;
  /** Side of the centerline (+1 = left of a -> b, as `leftVec`). */
  side: 1 | -1;
  /** Arc lengths along `edge.pts` where the bay starts and ends. */
  s0: number;
  s1: number;
  pos: Vec2;
  yaw: number;
  /** The one bay where parking is allowed (the spawn, `MissionRoute.homeBay`): no ticket, no parked car, no cone. */
  legal?: boolean;
}

/** A garden cut out of one block. The rest of the block keeps its street wall. */
export interface CityPark {
  block: number;
  /** Road-level lawn. */
  lawn: AABB;
  /** Gravel walk across the lawn, in line with the gate. */
  path: AABB;
  /** More walks (the other arm of a crossing, a link from a gate that is off center). */
  paths?: AABB[];
  /** Curb cut from the street to the lawn. Also listed in `driveways`. */
  gate: AABB;
  /** Further curb cuts, when the garden opens onto more than one street. Also listed in `driveways`. */
  gates?: AABB[];
  /**
   * Inside the street wall, with a gate instead of an open side. The chase camera takes the driver's seat
   * on the lawn and in the gates, until the car leaves (`CameraRig`).
   */
  enclosed?: boolean;
  /** A pavilion or a column standing off the paths. */
  monument?: { kind: 'kiosk' | 'column'; pos: Vec2 };
  trees: { pos: Vec2; r: number }[];
  lamps: Vec2[];
  benches: { pos: Vec2; yaw: number }[];
  colliders: AABB[];
}

export function emptyFeatures(): CityFeatures {
  return { canal: null, kinds: [], driveways: [], parking: [], curb: [], alleys: [], interiors: [], pitStops: [], station: null };
}

/** Within `margin` of a curb cut: a driveway or an alley mouth (no posts, trees or parked cars in front of it). */
export function inDriveway(f: CityFeatures, p: Vec2, margin: number): boolean {
  const near = (d: AABB) => p.x > d.minX - margin && p.x < d.maxX + margin && p.z > d.minZ - margin && p.z < d.maxZ + margin;
  return f.driveways.some(near) || f.alleys.some((a) => near(a.box));
}

/** Block area inside the sidewalk ring. */
export function inner(b: Block): AABB {
  const sw = CONFIG.SIDEWALK;
  return { minX: b.min.x + sw, maxX: b.max.x - sw, minZ: b.min.z + sw, maxZ: b.max.z - sw };
}

export const inBox = (p: Vec2, r: AABB, m = 0): boolean => p.x >= r.minX - m && p.x <= r.maxX + m && p.z >= r.minZ - m && p.z <= r.maxZ + m;
