export type Vec2 = { x: number; z: number };

export type Axis = 'x' | 'z';
export type DistrictType = 'downtown' | 'shotengai' | 'harbor' | 'residential' | 'depot';
export type TurnType = 'straight' | 'left' | 'right';
export type Facing = 'N' | 'S' | 'E' | 'W'; // N = -Z, S = +Z, E = +X, W = -X (local axes on rotated buildings)

export interface RoadNode {
  id: number;
  gi: number;
  gj: number;
  pos: Vec2;
  /** half extent of the intersection box along X (half width of the road running along Z) */
  hx: number;
  /** half extent of the intersection box along Z (half width of the road running along X) */
  hz: number;
  edges: number[];
  signalized: boolean;
  /** Junction area (T38): a convex polygon; on the grid, the hx / hz box. */
  poly: Vec2[];
  /** How traffic is controlled here (T38; `signalized` is `control === 'signal'`). Give-way logic arrives in T54. */
  control: JunctionControl;
}

export type JunctionControl = 'signal' | 'yield' | 'none';

export interface Lane {
  id: number;
  edgeId: number;
  from: number; // node id
  to: number; // node id
  index: number; // 0 = closest to road center
  start: Vec2;
  end: Vec2; // stop line
  /** Direction at the start (for a straight lane, the whole lane). */
  dir: Vec2;
  /** Direction at the stop line (T37). */
  endDir: Vec2;
  /** The lane's line from `start` to `end` (T37; two points on straight roads) and its cumulative lengths. */
  pts: Vec2[];
  cum: number[];
  length: number;
}

export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  /** Grid maps only (moves behind `city.grid` in T49): generic code must use `pts` / lane geometry. */
  axis: Axis;
  /** Centerline from node a's junction boundary to node b's (T37; two points on straight roads). */
  pts: Vec2[];
  /** Lanes only run a -> b (`lanesBA` is empty). */
  oneWay: boolean;
  lanesPerDir: number;
  width: number;
  speedLimit: number; // m/s
  length: number; // node-to-node
  lanesAB: number[];
  lanesBA: number[];
  avenue: boolean;
}

export interface Block {
  id: number;
  gi: number;
  gj: number;
  /** Bounding box of `poly`. */
  min: Vec2;
  max: Vec2;
  district: DistrictType;
  /** Curb line around the block (the road edge; the sidewalk ring is inside it). On the grid, the min / max rectangle. */
  poly: Vec2[];
  center: Vec2;
  /** Axis-aligned rectangle (`poly` is exactly min / max): sites with AABB layouts only use these (T48). */
  rect: boolean;
}

export interface AABB {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** World height of the obstacle's top: cars above it pass over (railings, ramps). Omitted = infinitely tall. */
  top?: number;
  /** Switched-off collider (an open door): skipped by every spatial query. */
  off?: boolean;
  /**
   * Exact shape when the box is rotated (T39): the min / max fields are then only its broad-phase bound.
   * Collisions and segment tests use this; everything else still sees the bound.
   */
  obb?: OrientedBox;
  /**
   * Breakaway prop: a car moving at least this fast (m/s) snaps it off. The box switches `off` and
   * `propBroken` fires. Without `breakHits` the car's motion is untouched (a sign post).
   */
  breakAt?: number;
  /**
   * The snap still resolves as a hit first (push, impulse, damage), then the prop gives way.
   * Street lamps. Traffic-light poles leave both fields unset.
   */
  breakHits?: boolean;
}

/**
 * A box rotated about Y: center, half extents along its local X / Z, and `yaw` (local +Z = forward
 * `(sin yaw, cos yaw)`, local +X = `(cos yaw, -sin yaw)`, like `THREE.Matrix4.makeRotationY`).
 */
export interface OrientedBox {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
}

/**
 * A semi-indoor area (IMPROVEMENTS #9): a drivable floor at road level under a roof, entered through door
 * openings: drive-through passages under buildings (along alleys) and dead-end covered nooks (#19). Its walls are building colliders and the camera and rain
 * stay out of the roof. Hidden interiors are left off the maps (secret spots for jobs, hiding places).
 */
export interface Interior {
  id: string;
  kind: 'passage' | 'nook';
  /** Floor footprint, inside the walls. */
  box: AABB;
  /** World height of the floor and clear height up to the ceiling. */
  floor: number;
  height: number;
  /** Openings in the walls: the wall side and the span along it (x for N / S walls, z for E / W). */
  doors: { side: Facing; from: number; to: number }[];
  hidden: boolean;
}

/** A building's footprint is its AABB, or `obb` when it is rotated (facings are then in its local frame). */
export interface Building extends AABB {
  height: number;
  district: DistrictType;
  faces: Facing[];
  seed: number;
  /**
   * Shaft above a full-footprint podium. `steps` are further setbacks: each adds `inset` meters
   * (from the shaft edge) starting `at` meters above the ground floor. `notch` splits the shaft
   * into twin slabs with a slot of that width and a bridge at the crown.
   */
  tower?: { inset: number; podium: number; steps?: { inset: number; at: number }[]; notch?: number };
  /** Large square media block: retail plinth, billboard bands, giant screens. */
  scramble?: boolean;
  /** Ground floor level (default: curb height). */
  floorY?: number;
  /** Bottom of the box when the ground under it is lower than the floor (slopes). */
  footY?: number;
  /** Facade that backs onto the canal (signs reflect in the water, no sidewalk props). */
  canalFace?: Facing;
  /** Drivable space carved out of the ground floor (a garage): drawn and collided around, signs kept off. */
  cavity?: Interior;
  /** Part of a landmark that dresses it itself (hotels): no generic signs, balconies or rooftop clutter. */
  landmark?: boolean;
  /** Facade look instead of the district's: shader style (0 office, 1 shops, 2 warehouse, 3 apartments, 4 media), base color, lit share. */
  facade?: { style: number; color: [number, number, number]; lit: number };
}

export interface VehicleInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  /** Pit-garage kit: clutch-dump launch. The driven wheels spin, then this is just throttle once they hook. */
  burnout: boolean;
}

export interface VehicleState {
  pos: Vec2;
  vel: Vec2;
  yaw: number;
  yawRate: number;
  steerAngle: number; // radians, positive = left
  rpm: number;
  gear: number; // -1 reverse, 1..n
  speed: number; // signed forward speed m/s
  slipFront: number;
  slipRear: number;
  accelF: number; // longitudinal accel (for visuals / weight transfer)
  accelL: number; // lateral accel
  damage: number; // 0..1
  /** Height of the car's base (ground contact) and vertical speed. */
  y: number;
  vy: number;
  airborne: boolean;
  /** Seconds in the air (current or last flight). */
  airTime: number;
  /** Body attitude from the terrain / flight path (radians): nose up and left side up are positive. */
  pitch: number;
  roll: number;
  /** Ground grade along the heading (+ uphill). */
  slope: number;
  /** Vertical load factor on the tires: 1 on flat ground, < 1 over crests, 0 airborne. */
  load: number;
  /** Depth below a water surface (0 = dry). */
  water: number;
  /** Seconds since the last landing and the vertical speed it hit the ground with (m/s). */
  landT: number;
  landImpact: number;
  /** Speed lost against a terrain wall this step (ramp backs, quay walls). */
  wallHit: number;
}

export interface SimSystem {
  update(dt: number): void;
}

export interface ViewSystem {
  sync(alpha: number, frameDt: number): void;
}

export type OffenseKind =
  | 'redLight'
  | 'speeding'
  | 'wrongWay'
  | 'carCrash'
  | 'policeCrash'
  | 'pedEndangered'
  | 'sidewalk';

export type Tone = 'info' | 'warn' | 'good' | 'bad';

/** What a high-speed impact was against (IMPROVEMENTS #24). */
export type CrashKind = 'wall' | 'vehicle' | 'prop';

export type GameEvent =
  /** `seconds`: how long it stays up (default: the feed's usual few seconds). */
  | { type: 'message'; text: string; tone: Tone; seconds?: number }
  | { type: 'offense'; kind: OffenseKind; pos: Vec2; witnessed: boolean }
  | { type: 'collision'; a: number; b: number | null; impulse: number; pos: Vec2 }
  /** The player's car touched another car or a static box, however softly (every step they are in contact). */
  | { type: 'contact'; other: number | null; box: AABB | null }
  /** `struck`: this contact already counted as a hit (crash sound, sparks). A sign leaves it unset. */
  | { type: 'propBroken'; car: number; box: AABB; pos: Vec2; carPos: Vec2; vel: Vec2; struck?: boolean }
  | {
      type: 'impact';
      car: number;
      other: number | null;
      /** Pre-impact speed of `car` (m/s). */
      speed: number;
      /** Closing speed along the contact normal (m/s). */
      closing: number;
      /** 1 = nose square to the surface, 0 = sideways. */
      align: number;
      /** Contact offset to the car's left (m). */
      side: number;
      /** Contact offset forward of the center (m). */
      along: number;
      /** Lateral speed, positive to the car's left (m/s), before the impulse. */
      glance: number;
      normal: Vec2;
      pos: Vec2;
      kind: CrashKind;
      /** Mass of the other vehicle (kg); 0 for static hits. */
      otherMass: number;
    }
  | { type: 'wrecked'; speed: number; kind: CrashKind; otherMass: number }
  /** The player's car went past `BREAKDOWN_DAMAGE`: the wheels came off (`gameplay/Breakdown.ts`). */
  | { type: 'brokeDown' }
  | { type: 'busted'; fine: number }
  | { type: 'escaped' }
  | { type: 'pursuitStarted' }
  | { type: 'horn' }
  | { type: 'splash'; car: number; pos: Vec2; y: number };
