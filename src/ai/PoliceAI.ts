import { CONFIG } from '../config';
import { clamp, dist, dot, fwd } from '../core/math';
import type { World } from '../core/World';
import type { AABB, Lane, SimSystem, Vec2 } from '../types';
import { Car } from '../vehicles/Car';
import { POLICE_CRUISER } from '../vehicles/CarSpec';
import type { Heat, OffenseEvent } from './Heat';
import { LaneDriver } from './LaneDriver';
import type { Pathfinder } from './Pathfinding';
import { PURSUIT_TUNING, PursuitDriver, type ChaseTarget } from './PursuitDriver';
import { interiorAt } from '../world/Interiors';

/** A patrolling cop sees offenses up to this far away inside its vision cone. */
export const SIGHT_RANGE = 75;
/** cos of the vision cone half-angle (60 degrees). */
const SIGHT_COS = 0.5;
/** Anything this close is noticed regardless of facing. */
export const AWARE_RADIUS = 15;
/** Pursuing cops watch the player all around, a bit farther. */
const PURSUIT_SIGHT = 90;
/** Sight knobs (live-tunable from the debug panel). */
export const SIGHT_TUNING = {
  /** Spotting range multiplier while the player's headlights are off. */
  lightsOff: 0.8,
  /** Spotting range multiplier for a point under a roof (passages, nooks, garages: IMPROVEMENTS #19). */
  covered: 0.45,
};
/** The cop you hit always notices. */
const CRASH_RADIUS = 8;
/** Eye height is irrelevant in 2D; building footprints block sight, small props do not. */
const blocksSight = (b: AABB) => 'height' in b;
/** A patrol cop that spots the player at or above this heat gives chase. */
export const WANTED_HEAT = 0.25;
const SPOT_INTERVAL = 0.25;
/** Pursuers drive at the player's live position while someone saw them this recently (radio). */
const LIVE_TRACK = 1;
/** How far the last known velocity is extrapolated when hunting a remembered position. */
const EXTRAPOLATE = 2;
const SPAWN_INTERVAL = 0.5;
const DISPATCH_INTERVAL = 3;
const DISPATCH_MIN_DIST = 110;
/** Pursuers wedged this long where the player can't see them are moved to the nearest lane. */
const STUCK_RELOCATE = 6;
/**
 * A call-in (PRD 5.3, the second cone line): the nearest patrol drives at the reported spot with its lights on,
 * for at most `time` seconds, at this share of pursuit speed; the report follows the player every `ping`
 * seconds. Seeing the player on the way starts the usual pursuit, whatever the meter says.
 */
export const CALL_TUNING = { time: 45, skill: 0.78, ping: 4, arrive: 14 };

export type CopState = 'patrol' | 'pursuit';

/** Brake to a stop and hold (brake input at a standstill would select reverse). */
function holdStill(car: Car): void {
  const v = car.phys.state.speed;
  car.input.throttle = v < -1 ? 0.6 : 0;
  car.input.brake = v > 1 ? 0.8 : 0;
  car.input.steer = 0;
  car.input.handbrake = Math.abs(v) <= 1;
}

export interface Cop {
  car: Car;
  driver: LaneDriver;
  chase: PursuitDriver | null;
  state: CopState;
  spotTimer: number;
  /** Answering a call-in: drives at the reported position until `until` (world time). */
  call: { driver: PursuitDriver; until: number } | null;
}

/**
 * Police: spawns patrolling cruisers around the player that drive like traffic, decides whether an
 * offense was witnessed (range + vision cone + building line of sight), and runs pursuits. Cops share
 * sightings by radio; pursuers chase the live position while the player is being seen and the last
 * known position otherwise. Backup is dispatched by heat; nobody seeing the player for `PURSUIT_TUNING.loseTime`
 * ends the pursuit. A player driving the cruiser is on the job: patrols do not witness them and do not pull them over.
 */
export class PoliceSystem implements SimSystem {
  readonly cops = new Map<number, Cop>();
  target = CONFIG.PATROL_COPS;
  /** Debug: count every offense as witnessed (T24 behavior). */
  witnessAll = false;
  /** world.time any cop last saw the player. */
  lastSeen = -99;
  /** Where the player was last seen or reported, and when. */
  readonly lastKnown: Vec2 = { x: 0, z: 0 };
  private lastKnownVel: Vec2 = { x: 0, z: 0 };
  private lastKnownAt = -99;
  private pingTimer = 0;
  /** Pursuers moved off an obstacle (debug). */
  relocations = 0;
  private spawnTimer = 0;
  private dispatchTimer = 0;
  /** Where the call-in sent the responding patrol, and when the report was last refreshed. */
  private readonly callPos: Vec2 = { x: 0, z: 0 };
  private callPing = 0;

  constructor(
    private world: World,
    private heat: Heat,
    private finder: Pathfinder,
  ) {
    heat.witness = (o) => this.witness(o);
  }

  get pursuers(): number {
    let n = 0;
    for (const c of this.cops.values()) if (c.state === 'pursuit') n++;
    return n;
  }

  /** Pursuing units wanted for the current heat. */
  get wantedUnits(): number {
    return clamp(1 + Math.floor(this.heat.value * 4), 1, CONFIG.MAX_PURSUERS);
  }

  populate(): void {
    for (let k = 0; k < this.target * 6 && this.cops.size < this.target; k++) this.trySpawn(40, true);
  }

  /** Spawn a patrolling cop on a lane point. */
  spawn(lane: Lane, pos: Vec2): Cop {
    const car = new Car('police', POLICE_CRUISER, { style: 'police', color: 0x111111 }, pos, Math.atan2(lane.dir.x, lane.dir.z));
    const v0 = this.world.city.edges[lane.edgeId].speedLimit * 0.7;
    car.phys.state.vel.x = lane.dir.x * v0;
    car.phys.state.vel.z = lane.dir.z * v0;
    this.world.addCar(car);
    const cop: Cop = { car, driver: new LaneDriver(this.world, car, lane), chase: null, state: 'patrol', spotTimer: this.world.rng.range(0, SPOT_INTERVAL), call: null };
    this.cops.set(car.id, cop);
    return cop;
  }

  update(dt: number): void {
    const w = this.world;
    const pp = w.player.pos;
    for (const [id, cop] of this.cops) {
      const car = cop.car;
      const d = dist(car.pos, pp);
      const far = cop.state === 'pursuit' ? CONFIG.DESPAWN_RADIUS * 1.5 : CONFIG.DESPAWN_RADIUS;
      if (car.removed || d > far || (cop.state === 'patrol' && cop.driver.stuckTime > 12 && d > 45)) {
        car.removed = true;
        this.cops.delete(id);
        continue;
      }
      if (cop.chase && cop.chase.stuckFor > STUCK_RELOCATE && (d > 45 || w.statics.segmentBlocked(pp, car.pos, blocksSight))) {
        const hit = w.city.nearestLanePoint(car.pos);
        car.teleport(hit.pos, Math.atan2(hit.lane.dir.x, hit.lane.dir.z));
        cop.chase.resetStuck();
        this.relocations++;
      }
      cop.spotTimer -= dt;
      if (cop.spotTimer <= 0 && !w.controlLocked) {
        cop.spotTimer = SPOT_INTERVAL;
        if (this.canSee(car, pp, cop.state === 'pursuit')) {
          this.sawPlayer();
          const wanted = this.heat.value >= WANTED_HEAT || cop.call !== null;
          if (cop.state === 'patrol' && wanted && this.pursuers < CONFIG.MAX_PURSUERS && !w.onCourse) this.startPursuit(cop);
        }
      }
    }

    if (this.pursuers > 0) {
      // (Never lost while the player is locked: busted sequence, menus.)
      if (w.time - this.lastSeen > PURSUIT_TUNING.loseTime && !w.controlLocked) {
        for (const cop of this.cops.values()) if (cop.state === 'pursuit') this.endPursuit(cop);
        w.events.emit({ type: 'escaped' });
        w.events.message('You lost the police!', 'good');
      } else {
        this.pingTimer -= dt;
        if (this.pingTimer <= 0) {
          this.pingTimer = PURSUIT_TUNING.pingInterval;
          this.report();
        }
      }
    }
    const target = this.chaseTarget();
    this.callPing -= dt;
    if (this.callPing <= 0) {
      this.callPing = CALL_TUNING.ping;
      this.callPos.x = pp.x;
      this.callPos.z = pp.z;
    }
    for (const cop of this.cops.values()) {
      if (cop.state === 'patrol' && cop.call) this.answer(cop, dt);
      else if (cop.state === 'patrol') cop.driver.drive();
      else if (w.controlLocked) holdStill(cop.car); // busted sequence: no more bumping the player
      else cop.chase!.drive(target, dt);
    }
    this.heat.inPursuit = this.pursuers > 0;
    this.heat.unseen = w.time - this.lastSeen;

    this.dispatchTimer -= dt;
    if (this.heat.inPursuit && this.dispatchTimer <= 0 && !w.controlLocked) {
      this.dispatchTimer = DISPATCH_INTERVAL;
      if (this.pursuers < this.wantedUnits) {
        const cop = this.trySpawn(DISPATCH_MIN_DIST);
        if (cop) this.startPursuit(cop);
      }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      if (this.cops.size - this.pursuers < this.target) this.trySpawn(CONFIG.SPAWN_MIN);
    }
  }

  /**
   * Someone phoned the player in (PRD 5.3): the nearest patrol, or a new one out of sight, heads for them with
   * its lights on. Returns false if no car could be sent.
   */
  respond(pos: Vec2): boolean {
    if (this.pursuers > 0 || this.world.immune) return false;
    this.callPos.x = pos.x;
    this.callPos.z = pos.z;
    this.callPing = CALL_TUNING.ping;
    let best: Cop | null = null;
    for (const c of this.cops.values()) if (c.state === 'patrol' && (!best || dist(c.car.pos, pos) < dist(best.car.pos, pos))) best = c;
    best ??= this.trySpawn(DISPATCH_MIN_DIST);
    if (!best) return false;
    best.call = { driver: new PursuitDriver(this.world, best.car, this.finder, CALL_TUNING.skill, true, 0), until: this.world.time + CALL_TUNING.time };
    best.car.siren = true;
    return true;
  }

  /** Patrol cars answering a call (debug). */
  get responding(): number {
    let n = 0;
    for (const c of this.cops.values()) if (c.call) n++;
    return n;
  }

  /** Drive at the reported spot; give up there (or when the call times out) and go back to patrolling. */
  private answer(cop: Cop, dt: number): void {
    const call = cop.call!;
    const there = dist(cop.car.pos, this.callPos) < CALL_TUNING.arrive;
    if (this.world.time > call.until || (there && this.world.time - this.lastSeen > 2)) {
      this.dropCall(cop);
      cop.driver.drive();
      return;
    }
    call.driver.drive({ pos: this.callPos, vel: { x: 0, z: 0 }, car: null }, dt);
  }

  private dropCall(cop: Cop): void {
    cop.call = null;
    cop.car.siren = false;
    cop.driver = new LaneDriver(this.world, cop.car, this.alignedLane(cop.car));
  }

  /** Wreck respawn or debug immunity: pursuers go back to patrol where they are and sightings are forgotten. */
  callOff(): void {
    for (const cop of this.cops.values()) if (cop.call) this.dropCall(cop);
    for (const cop of this.cops.values()) if (cop.state === 'pursuit') this.endPursuit(cop);
    this.lastSeen = this.lastKnownAt = -99;
    this.heat.inPursuit = false;
    this.heat.unseen = Infinity;
  }

  /** After a bust: pursuing cars leave (despawn, call while the screen is black) and sightings are forgotten. */
  standDown(): void {
    for (const cop of this.cops.values()) if (cop.call) this.dropCall(cop);
    for (const [id, cop] of this.cops) {
      if (cop.state !== 'pursuit') continue;
      cop.car.removed = true;
      this.cops.delete(id);
    }
    this.lastSeen = this.lastKnownAt = -99;
    this.heat.inPursuit = false;
    this.heat.unseen = Infinity;
    this.dispatchTimer = 0;
  }

  /**
   * Can this cop see point p? Patrols: within range inside the vision cone or within the awareness
   * radius. Pursuers: all around, a bit farther. Building footprints block sight; under a roof you are
   * only spotted from closer.
   */
  canSee(car: Car, p: Vec2, pursuing = false): boolean {
    const dx = p.x - car.pos.x;
    const dz = p.z - car.pos.z;
    const d = Math.hypot(dx, dz);
    // Driving dark (IMPROVEMENTS #18) shortens how far away they spot you, not the awareness radius
    let dark = this.world.player.lampsOn ? 1 : SIGHT_TUNING.lightsOff;
    // In the shadow under a building (only the opening is in view; the walls already block the rest)
    if (interiorAt(this.world.city.features.interiors, p)) dark *= SIGHT_TUNING.covered;
    if (d > Math.max(AWARE_RADIUS, (pursuing ? PURSUIT_SIGHT : SIGHT_RANGE) * dark)) return false;
    if (!pursuing && d > AWARE_RADIUS && dot(fwd(car.yaw), { x: dx / d, z: dz / d }) < SIGHT_COS) return false;
    return !this.world.statics.segmentBlocked(car.pos, p, blocksSight);
  }

  private chaseTarget(): ChaseTarget {
    const p = this.world.player;
    if (this.world.time - this.lastSeen < LIVE_TRACK) return { pos: p.pos, vel: p.vel, car: p };
    const t = Math.min(this.world.time - this.lastKnownAt, EXTRAPOLATE);
    return {
      pos: { x: this.lastKnown.x + this.lastKnownVel.x * t, z: this.lastKnown.z + this.lastKnownVel.z * t },
      vel: { x: 0, z: 0 },
      car: null,
    };
  }

  private sawPlayer(): void {
    this.lastSeen = this.world.time;
    this.report();
  }

  /** Update the shared last known position (a sighting or a dispatch report). */
  private report(): void {
    const p = this.world.player;
    this.lastKnownAt = this.world.time;
    this.lastKnown.x = p.pos.x;
    this.lastKnown.z = p.pos.z;
    this.lastKnownVel.x = p.vel.x;
    this.lastKnownVel.z = p.vel.z;
  }

  private witness(o: OffenseEvent): boolean {
    if (this.witnessAll) return true;
    let seen = false;
    for (const cop of this.cops.values()) {
      const hitThisCop = o.kind === 'policeCrash' && dist(cop.car.pos, o.pos) < CRASH_RADIUS;
      if (!hitThisCop && !this.canSee(cop.car, o.pos, cop.state === 'pursuit')) continue;
      seen = true;
      if (cop.state === 'patrol' && this.pursuers < CONFIG.MAX_PURSUERS) this.startPursuit(cop);
    }
    if (seen) this.sawPlayer();
    return seen;
  }

  private startPursuit(cop: Cop): void {
    const first = this.pursuers === 0;
    cop.call = null;
    cop.state = 'pursuit';
    cop.car.siren = true;
    // Every second unit flanks: it routes to where the player is heading and cuts in from a side street
    const flank = this.pursuers % 2 === 0 ? this.world.rng.range(0.8, 1.2) : 0;
    cop.chase = new PursuitDriver(this.world, cop.car, this.finder, this.world.rng.range(0.88, 1), true, flank);
    if (first) {
      if (this.lastSeen < this.world.time) this.sawPlayer();
      this.world.events.emit({ type: 'pursuitStarted' });
      this.world.events.message('Police pursuit!', 'warn');
    }
  }

  private endPursuit(cop: Cop): void {
    cop.state = 'patrol';
    cop.car.siren = false;
    cop.chase = null;
    cop.driver = new LaneDriver(this.world, cop.car, this.alignedLane(cop.car));
  }

  /** Lane under (or nearest to) the car, flipped to the car's direction of travel. */
  private alignedLane(car: Car): Lane {
    const city = this.world.city;
    let lane = city.laneAt(car.pos)?.lane ?? city.nearestLanePoint(car.pos).lane;
    if (dot(lane.dir, fwd(car.yaw)) < 0) {
      const e = city.edges[lane.edgeId];
      lane = city.lanes[(lane.from === e.a ? e.lanesBA : e.lanesAB)[0]];
    }
    return lane;
  }

  private trySpawn(rMin: number, ignoreView = false): Cop | null {
    const w = this.world;
    const pp = w.player.pos;
    const hit = w.city.randomLanePointNear(w.rng, pp, rMin, CONFIG.SPAWN_RADIUS);
    if (!hit) return null;
    // Nothing spawns on a fenced street or in a coned lane (it would only drive into the fence / the cones)
    if (w.roadworks && (w.roadworks.closedEdge(hit.lane.edgeId) || w.roadworks.conedLane(hit.lane.id))) return null;
    const d = dist(hit.pos, pp);
    if (!ignoreView) {
      const ahead = dot({ x: hit.pos.x - pp.x, z: hit.pos.z - pp.z }, fwd(w.player.yaw));
      if (d < 140 && ahead > -0.3 * d) return null; // likely on screen
    }
    for (const c of w.cars) if (!c.removed && dist(c.pos, hit.pos) < 14) return null;
    return this.spawn(hit.lane, hit.pos);
  }
}
