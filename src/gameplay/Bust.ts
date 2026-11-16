import { dist, dot, fwd, leftOf, yawOf } from '../core/math';
import type { World } from '../core/World';
import type { AABB, SimSystem, Vec2 } from '../types';
import type { Heat } from '../ai/Heat';
import type { PoliceSystem } from '../ai/PoliceAI';
import type { Car } from '../vehicles/Car';
import { repair } from '../vehicles/Damage';
import { tangentAt } from '../world/Polyline';
import { bustFine, formatCash, type Economy } from './Economy';

/** Bust rule knobs (live-tunable from the debug panel). */
export const BUST_TUNING = {
  /** The player counts as stopped below this speed (m/s)... */
  speed: 2.5,
  /** ...with a pursuing cop this close (center to center, m, not through a building)... */
  radius: 10,
  /** ...for this many seconds. */
  time: 3,
};
/** Once the player gets away, the ring empties this much faster than it fills. */
const RECOVER = 1.5;

const WALK_SPEED = 1.7;
/** The officer never walks farther than this (a cop parked at the edge of the radius: appear closer). */
const MAX_WALK = 6;
/** Gap between the officer and a car's body. */
const DOOR_GAP = 0.55;
/** Driver's window, along the car from its center. */
const DOOR_ALONG = -0.2;
const WRITE_TIME = 3;
const HAND_TIME = 1;
const FADE_TIME = 0.6;
/** Walk cost (m) per half meter inside a car or obstacle, when choosing the officer's route. */
const BLOCKED_COST = 3;
/** Respawn points must be at least this far from any other car. */
const RESPAWN_CLEAR = 9;
const blocksSight = (b: AABB) => 'height' in b;

/** free -> approach (officer walks to the door) -> ticket (writes, hands it over: fine charged) -> fadeOut -> fadeIn -> free */
export type BustPhase = 'free' | 'approach' | 'ticket' | 'fadeOut' | 'fadeIn';
export type OfficerPose = 'walk' | 'write' | 'hand';

/** The officer who walks up to the player's car and writes the ticket (drawn by `OfficerView`). */
export interface Officer {
  pos: Vec2;
  prev: Vec2;
  yaw: number;
  pose: OfficerPose;
  /** Seconds in the current pose (animation clock). */
  t: number;
  /** Meters walked (leg cycle). */
  walked: number;
  onRoad: boolean;
}

/** A point in the player car's frame. */
type WalkPoint = { along: number; lat: number };

const insideCar = (c: Car, p: Vec2, margin: number): boolean => {
  const r = { x: p.x - c.pos.x, z: p.z - c.pos.z };
  return Math.abs(dot(r, fwd(c.yaw))) < c.halfL + margin && Math.abs(dot(r, leftOf(c.yaw))) < c.halfW + margin;
};

/** Point in a car's frame: `along` its heading, `lat` to its left. */
const carPoint = (c: Car, along: number, lat: number): Vec2 => {
  const f = fwd(c.yaw);
  const l = leftOf(c.yaw);
  return { x: c.pos.x + f.x * along + l.x * lat, z: c.pos.z + f.z * along + l.z * lat };
};

/** Point beside a car's door (side +1 = left, -1 = right). */
const doorPoint = (c: Car, side: number, along = DOOR_ALONG): Vec2 => carPoint(c, along, side * (c.halfW + DOOR_GAP));

/**
 * Bust rule and busted sequence. The player is busted after `BUST_TUNING.time` seconds below
 * `BUST_TUNING.speed` with a pursuing cop within `BUST_TUNING.radius` (`progress` fills the HUD ring).
 * Then the controls lock, an officer walks from the cop car to the player's door and writes a ticket,
 * the fine (by heat) is charged, the screen fades and the player respawns on a clear lane nearby with
 * heat reset, the pursuers gone and the car repaired.
 */
export class BustSystem implements SimSystem {
  /** 0..1 fill of the HUD "BUSTED" ring. */
  progress = 0;
  phase: BustPhase = 'free';
  /** Fine assessed at the moment of the bust (from heat). */
  fine = 0;
  /** Amount actually taken when the ticket is handed over (null before). */
  paid: number | null = null;
  /** Screen fade to black 0..1 (HUD). */
  fade = 0;
  officer: Officer | null = null;
  /** Called right after the player was moved (camera snap). */
  onRespawn: (() => void) | null = null;
  /** Debug counter. */
  busts = 0;
  /** Seconds in the current phase. */
  private t = 0;
  /** Remaining walk as points in the player car's frame; the last one is the door. */
  private path: WalkPoint[] = [];
  private tmp: AABB[] = [];

  constructor(
    private world: World,
    private heat: Heat,
    private police: PoliceSystem,
    private economy: Economy,
  ) {}

  /** The busted screen is up (from the bust until the respawn). */
  get busted(): boolean {
    return this.phase === 'approach' || this.phase === 'ticket' || this.phase === 'fadeOut';
  }

  update(dt: number): void {
    const w = this.world;
    if (this.phase === 'free') {
      const cop = w.controlLocked ? null : this.closeCop();
      const rate = dt / BUST_TUNING.time;
      this.progress = cop ? this.progress + rate : Math.max(0, this.progress - rate * RECOVER);
      if (cop && this.progress >= 1) this.bust(cop);
      return;
    }

    w.controlLocked = true; // re-assert (debug free cam toggles it)
    this.t += dt;
    const o = this.officer; // null after the respawn (fade in)
    if (o) {
      o.prev.x = o.pos.x;
      o.prev.z = o.pos.z;
      o.t += dt;
    }
    switch (this.phase) {
      case 'approach':
        if (o) this.walkToDoor(o, dt);
        break;
      case 'ticket':
        if (o) this.writeTicket(o);
        break;
      case 'fadeOut':
        this.fade = Math.min(1, this.t / FADE_TIME);
        if (this.t >= FADE_TIME) {
          this.respawn();
          this.setPhase('fadeIn');
        }
        break;
      case 'fadeIn':
        this.fade = Math.max(0, 1 - this.t / FADE_TIME);
        if (this.t >= FADE_TIME) {
          this.setPhase('free');
          this.fade = 0;
          w.controlLocked = false;
        }
        break;
    }
  }

  /** Abort any bust in progress (quit to title); leaves the controls to the caller. */
  cancel(): void {
    this.setPhase('free');
    this.progress = 0;
    this.fade = 0;
    this.officer = null;
  }

  private walkToDoor(o: Officer, dt: number): void {
    const w = this.world;
    const wp = this.path[0];
    const target = carPoint(w.player, wp.along, wp.lat);
    const dx = target.x - o.pos.x;
    const dz = target.z - o.pos.z;
    const d = Math.hypot(dx, dz);
    const step = WALK_SPEED * dt;
    if (d > step) {
      o.pos.x += (dx / d) * step;
      o.pos.z += (dz / d) * step;
      o.walked += step;
      o.yaw = Math.atan2(dx, dz);
    } else {
      o.pos = target;
      o.walked += d;
      this.path.shift();
      if (this.path.length === 0) {
        this.setPhase('ticket');
        this.pose('write');
      }
    }
    o.onRoad = w.city.roadAt(o.pos) !== null;
  }

  /** Walk to the door on `side`, around the player's front or rear corners when coming from the far side. */
  private planWalk(start: Vec2, side: number): WalkPoint[] {
    const p = this.world.player;
    const r = { x: start.x - p.pos.x, z: start.z - p.pos.z };
    const a0 = dot(r, fwd(p.yaw));
    const l0 = dot(r, leftOf(p.yaw));
    const w = p.halfW + DOOR_GAP;
    const end = (a0 >= 0 ? 1 : -1) * (p.halfL + DOOR_GAP);
    const path: WalkPoint[] = [];
    if (side * l0 < w) {
      // Along the far side to the corner first, unless already past the bumper.
      if (Math.abs(a0) < Math.abs(end)) path.push({ along: end, lat: Math.sign(l0 || -side) * Math.max(Math.abs(l0), w) });
      path.push({ along: end, lat: side * w });
    }
    path.push({ along: DOOR_ALONG, lat: side * w });
    return path;
  }

  /** Walk length plus a penalty for every half meter spent inside a car or obstacle. */
  private walkCost(start: Vec2, path: WalkPoint[]): number {
    const p = this.world.player;
    let cost = 0;
    let a = start;
    for (const q of path) {
      const b = carPoint(p, q.along, q.lat);
      const d = dist(a, b);
      cost += d;
      for (let s = 0.5; s < d; s += 0.5) {
        const u = s / d;
        if (!this.free({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }, 0.1)) cost += BLOCKED_COST;
      }
      a = b;
    }
    return cost;
  }

  /** Face the driver and write; when done, hand the ticket over (fine charged), then fade out. */
  private writeTicket(o: Officer): void {
    const w = this.world;
    o.yaw = yawOf({ x: w.player.pos.x - o.pos.x, z: w.player.pos.z - o.pos.z });
    if (o.pose === 'write' && this.t >= WRITE_TIME) {
      this.pose('hand');
      this.paid = this.economy.charge(this.fine);
      const short = this.paid < this.fine ? ` (all you had: ${formatCash(this.paid)})` : '';
      w.events.message(`Fined ${formatCash(this.fine)}${short}`, 'bad');
    } else if (this.t >= WRITE_TIME + HAND_TIME) this.setPhase('fadeOut');
  }

  /** Nearest pursuing cop in bust range of a (nearly) stopped player, or null. */
  private closeCop(): Car | null {
    const w = this.world;
    const p = w.player;
    if (w.immune || p.speed >= BUST_TUNING.speed || p.phys.state.water > 0.2) return null;
    let best: Car | null = null;
    let bestD = BUST_TUNING.radius;
    for (const cop of this.police.cops.values()) {
      if (cop.state !== 'pursuit' || cop.car.removed) continue;
      const d = dist(cop.car.pos, p.pos);
      if (d < bestD && !w.statics.segmentBlocked(p.pos, cop.car.pos, blocksSight)) {
        best = cop.car;
        bestD = d;
      }
    }
    return best;
  }

  private bust(cop: Car): void {
    const w = this.world;
    this.busts++;
    this.progress = 1;
    this.fine = bustFine(this.heat.value);
    this.paid = null;
    w.controlLocked = true;
    this.officer = this.spawnOfficer(cop);
    this.setPhase('approach');
    w.events.emit({ type: 'busted', fine: this.fine });
  }

  private setPhase(phase: BustPhase): void {
    this.phase = phase;
    this.t = 0;
  }

  private pose(pose: OfficerPose): void {
    this.officer!.pose = pose;
    this.officer!.t = 0;
  }

  /** Free spot for a standing person: no static box, no car. */
  private free(p: Vec2, r = 0.3): boolean {
    if (this.world.statics.query(p.x - r, p.z - r, p.x + r, p.z + r, this.tmp).length > 0) return false;
    return !this.world.cars.some((c) => !c.removed && insideCar(c, p, r));
  }

  /**
   * The officer gets out of one of the cop cars around the player (either door or behind it) and walks
   * to a free door of the player's car: the shortest candidate walk that crosses the fewest cars.
   */
  private spawnOfficer(nearest: Car): Officer {
    const p = this.world.player;
    const cops = [nearest];
    for (const c of this.police.cops.values()) {
      if (c.state === 'pursuit' && c.car !== nearest && dist(c.car.pos, p.pos) < BUST_TUNING.radius + 5) cops.push(c.car);
    }
    let best = { start: doorPoint(nearest, 1, 0.3), side: 1, path: [] as WalkPoint[], cost: Infinity };
    for (const side of [1, -1]) {
      const door = doorPoint(p, side);
      const doorCost = this.free(door) ? 0 : BLOCKED_COST * 4;
      for (const cop of cops) {
        const starts = [doorPoint(cop, 1, 0.3), doorPoint(cop, -1, 0.3), carPoint(cop, -(cop.halfL + DOOR_GAP), 0)];
        for (let start of starts) {
          if (!this.free(start)) continue;
          const d = dist(start, door);
          if (d > MAX_WALK) {
            const k = MAX_WALK / d;
            const closer = { x: door.x + (start.x - door.x) * k, z: door.z + (start.z - door.z) * k };
            if (this.free(closer)) start = closer;
          }
          const path = this.planWalk(start, side);
          const cost = doorCost + this.walkCost(start, path);
          if (cost < best.cost) best = { start, side, path, cost };
        }
      }
    }
    if (best.path.length === 0) best.path = this.planWalk(best.start, best.side);
    this.path = best.path;
    const start = best.start;
    const first = carPoint(p, best.path[0].along, best.path[0].lat);
    return {
      pos: { ...start },
      prev: { ...start },
      yaw: yawOf({ x: first.x - start.x, z: first.z - start.z }),
      pose: 'walk',
      t: 0,
      walked: 0,
      onRoad: this.world.city.roadAt(start) !== null,
    };
  }

  /** Screen is black: pursuers leave, heat resets, the car is repaired (IMPROVEMENTS #10) and moved to a clear lane nearby. */
  private respawn(): void {
    const w = this.world;
    this.police.standDown();
    this.heat.reset();
    this.officer = null;
    this.progress = 0;
    const p = w.player;
    const spot = this.respawnSpot(p.pos);
    // Facing along the lane where it is (curved lanes turn)
    p.teleport(spot.pos, yawOf(tangentAt(spot.lane.pts, spot.lane.cum, spot.t * spot.lane.length)));
    if (p.phys.state.damage > 0.01) w.events.message('Your car was repaired', 'info');
    repair(p);
    this.onRespawn?.();
  }

  /** Nearest lane point clear of other cars, searching outward in rings. */
  private respawnSpot(near: Vec2): ReturnType<World['city']['nearestLanePoint']> {
    const city = this.world.city;
    const clear = (q: Vec2) => this.world.cars.every((c) => c.removed || c === this.world.player || dist(c.pos, q) > RESPAWN_CLEAR);
    const first = city.nearestLanePoint(near);
    if (clear(first.pos)) return first;
    for (let r = 8; r <= 64; r += 8) {
      for (let a = 0; a < 8; a++) {
        const hit = city.nearestLanePoint({ x: near.x + Math.cos((a * Math.PI) / 4) * r, z: near.z + Math.sin((a * Math.PI) / 4) * r });
        if (clear(hit.pos)) return hit;
      }
    }
    return first;
  }
}
