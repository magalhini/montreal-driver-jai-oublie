import { lerpAngle } from '../core/math';
import type { Vec2, VehicleInput } from '../types';
import { cloneSpec, type CarSpec } from './CarSpec';
import type { CharmId, WheelId } from './Tuning';
import { VehiclePhysics } from './VehiclePhysics';

export type CarKind = 'player' | 'traffic' | 'police' | 'parked';
export type Blinker = 'left' | 'right' | null;

/** Turn signal flash cycle (s) and lit part of it (about 80 flashes a minute). */
const BLINK_PERIOD = 0.75;
const BLINK_ON = 0.42;
/** Cars built from side profiles. Trucks are separate (`TruckStyle`). */
export type CarStyle = 'coupe' | 'sedan' | 'wagon' | 'police';
/** Trucks built by `TruckModel`, not from side profiles: a box van, a conventional pickup and a Canada Post step van. */
export type TruckStyle = 'truck' | 'pickup' | 'postvan';
export type BodyStyle = CarStyle | TruckStyle;
/**
 * Extra bodywork for a car the player drives. Traffic leaves this off, so a shared silhouette stays cheaper.
 * `taxi`, `patrol` and `work` are the liveries. `driver` is the small extra on the plain cars (a vent, a badge).
 */
export type CarDetail = 'taxi' | 'patrol' | 'work' | 'driver';

export const isTruck = (s: BodyStyle): s is TruckStyle => s === 'truck' || s === 'pickup' || s === 'postvan';

export interface CarLook {
  style: BodyStyle;
  color: number;
  detail?: CarDetail;
  /** Rims fitted at the pit garage (traffic keeps the factory ones). */
  wheels?: WheelId;
  /** What hangs from the rearview mirror (the player's car). */
  charm?: CharmId;
}

let nextId = 1;

/** A simulated car: physics + input + interpolation state. */
export class Car {
  readonly id = nextId++;
  readonly phys: VehiclePhysics;
  input: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, burnout: false };
  /** Pit-garage clutch dump for this car. Z does nothing until it is fitted. */
  burnout = false;
  prevPos: Vec2;
  prevYaw: number;
  prevY: number;
  removed = false;
  /** Light bar and siren. Traffic pulls over for it, and it is heard (`audio/Sirens.ts`). */
  siren = false;
  /** Roof bar flashing with no siren: the player's patrol call. Traffic does not yield to it. */
  lightBar = false;
  /** Turn signal. Not an offense; a taxi fare may tip for a proper one. `blinkT` restarts on each switch-on. */
  blinker: Blinker = null;
  blinkT = 0;
  /** Both signals flashing (a double-parked car, PRD 5.5). */
  hazards = false;
  /**
   * Parked in the street, a metre into the travel lane (`ParkedCars`, PRD 5.5): traffic squeezes past it
   * (`LaneDriver`) instead of queueing behind it.
   */
  doubleParked = false;
  /** Seconds since last collision (for crash offense cooldowns etc.). */
  lastHit = 99;
  /** Seconds since the body last touched anything, however lightly (scraping along a wall, T34 audio). */
  touch = 99;
  /** Headlights and tail (position) lamps; brake and reverse lamps work either way. The player toggles them with K. */
  headlights = true;
  /** Takes no damage (debug immunity). */
  invulnerable = false;
  /** Not drawn: a wreck cinematic is showing the pieces instead. */
  concealed = false;
  /** Left out of collision while the shell is gone. */
  ghost = false;

  constructor(
    public kind: CarKind,
    spec: CarSpec,
    public look: CarLook,
    pos: Vec2,
    yaw: number,
  ) {
    this.phys = new VehiclePhysics(cloneSpec(spec), pos, yaw);
    this.prevPos = { ...pos };
    this.prevYaw = yaw;
    this.prevY = this.phys.state.y;
  }

  get pos(): Vec2 {
    return this.phys.state.pos;
  }
  get yaw(): number {
    return this.phys.state.yaw;
  }
  /** Height of the car's base. */
  get y(): number {
    return this.phys.state.y;
  }
  get vel(): Vec2 {
    return this.phys.state.vel;
  }
  get speed(): number {
    const v = this.phys.state.vel;
    return Math.hypot(v.x, v.z);
  }
  get halfW(): number {
    return this.phys.spec.halfWidth;
  }
  get halfL(): number {
    return this.phys.spec.halfLength;
  }
  /** Parked with nobody in it (the coffee break, IMPROVEMENTS #25): brake lamps dark. */
  parked = false;
  /** Broken down (`gameplay/Breakdown.ts`): the view draws no wheels and lowers the body by `bodyDrop` (m). */
  wheelsOff = false;
  bodyDrop = 0;

  /** Head and tail lamps lit: switched on (K) and the ignition on (IMPROVEMENTS #21). */
  get lampsOn(): boolean {
    return this.headlights && this.phys.engineOn;
  }

  get braking(): boolean {
    const s = this.phys.state;
    if (this.parked || !this.phys.engineOn) return false;
    return (s.gear >= 1 && this.input.brake > 0.05 && s.speed > 0.3) || this.input.handbrake;
  }
  /** Turn signal lamp lit at this instant. */
  get blinkLit(): boolean {
    return (this.blinker !== null || this.hazards) && this.blinkT % BLINK_PERIOD < BLINK_ON;
  }
  get reversing(): boolean {
    return this.phys.state.gear === -1 && this.phys.state.speed < -0.1;
  }

  savePrev(): void {
    this.prevPos.x = this.pos.x;
    this.prevPos.z = this.pos.z;
    this.prevYaw = this.yaw;
    this.prevY = this.y;
  }

  step(dt: number): void {
    this.lastHit += dt;
    this.touch += dt;
    if (this.blinker || this.hazards) this.blinkT += dt;
    this.phys.step(this.input, dt);
  }

  teleport(pos: Vec2, yaw: number): void {
    this.phys.teleport(pos, yaw);
    this.savePrev();
  }

  interpPos(alpha: number): Vec2 {
    return {
      x: this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha,
      z: this.prevPos.z + (this.pos.z - this.prevPos.z) * alpha,
    };
  }

  interpY(alpha: number): number {
    return this.prevY + (this.y - this.prevY) * alpha;
  }

  interpYaw(alpha: number): number {
    return lerpAngle(this.prevYaw, this.yaw, alpha);
  }
}
