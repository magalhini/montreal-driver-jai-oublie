import type { Rider } from '../ai/Rider';
import type { SpatialHash } from '../physics/SpatialHash';
import type { Lane, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import type { CityModel } from '../world/RoadGraph';
import type { TrafficLights } from '../world/TrafficLights';
import type { Events } from './Events';
import type { Rng } from './Rng';

/** `menu`: the title screen (the city runs behind it). `free`: driving. */
export type GameMode = 'menu' | 'free';

/** What drivers need to know about a pedestrian. */
export interface Walker {
  pos: Vec2;
  vel: Vec2;
  active: boolean;
  /** Out on the carriageway (crossing, or picking themselves up after diving away from the player). */
  onRoad: boolean;
}

/** What the AI needs to know about the session's road works (`gameplay/Closures.ts`). */
export interface Roadworks {
  /** Hard-closed edge: traffic never turns into it, nothing spawns on it. */
  closedEdge(id: number): boolean;
  /** A lane closed by a cone taper: traffic never drives into it (the other lanes of the road stay open). */
  conedLane(id: number): boolean;
  /** Meters along the lane from p to a fence across it / to a cone taper in it (Infinity: none ahead). */
  barrierAhead(lane: Lane, p: Vec2): number;
  conesAhead(lane: Lane, p: Vec2): number;
  /** Inside (or within `margin` of) a fenced work zone. */
  inWorkZone(p: Vec2, margin?: number): boolean;
  /**
   * The lane ends ahead (a merge before an obstacle): how far to the taper and the lane to move into; null once
   * at the taper or in any other lane.
   */
  mergeAhead(lane: Lane, p: Vec2): { dist: number; into: number } | null;
  mergeLane(id: number): boolean;
  /** A curb parking bay with cones standing in it. */
  reservedBay(p: Vec2): boolean;
}

/** Shared simulation context passed to systems. */
export class World {
  cars: Car[] = [];
  player!: Car;
  /** Active bicycles and scooters (`ai/Riders.ts`): not physical; cars pass or follow them. */
  riders: Rider[] = [];
  /** Pedestrian pool (`ai/Pedestrians.ts`, set by main): AI drivers stop for the ones out on the road. */
  pedestrians: readonly Walker[] = [];
  time = 0;
  mode: GameMode = 'menu';
  /** True while the player is not in control (menus, busted sequence). */
  controlLocked = true;
  /** Debug full immunity (IMPROVEMENTS #15): offenses are ignored and the player can't be busted (damage: `Car.invulnerable`). */
  immune = false;
  /**
   * On the gymkhana (countdown or run): a closed course, so the police don't charge offenses (hitting the
   * parked cars, speed, the lot's sidewalk) or start a chase. Set by `gameplay/Gymkhana.ts`.
   */
  onCourse = false;
  /** Rue barrée and cone lines (PRD Phase 7); null: an open city (headless tools). */
  roadworks: Roadworks | null = null;

  constructor(
    readonly city: CityModel,
    readonly events: Events,
    readonly rng: Rng,
    readonly statics: SpatialHash,
    readonly lights: TrafficLights,
  ) {}

  addCar(car: Car): void {
    this.cars.push(car);
  }

  /** Drop removed cars from the list (call once per step). */
  compact(): void {
    if (this.cars.some((c) => c.removed)) this.cars = this.cars.filter((c) => !c.removed);
  }

  carById(id: number): Car | undefined {
    return this.cars.find((c) => c.id === id);
  }
}
