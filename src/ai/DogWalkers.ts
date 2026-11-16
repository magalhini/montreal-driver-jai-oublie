import { dot, fwd, leftOf, wrapAngle } from '../core/math';
import { hash01 } from '../core/Rng';
import type { World } from '../core/World';
import type { DistrictType, SimSystem, Vec2 } from '../types';
import type { Pedestrians } from './Pedestrians';

/** Share of pedestrians spawned with a dog, per district (residential streets have the most). */
export const DOG_SHARE: Record<DistrictType, number> = { residential: 0.14, harbor: 0.08, shotengai: 0.06, downtown: 0.04, depot: 0.03 };
/** Live-tunable multiplier on DOG_SHARE (debug panel). */
export const DOG_TUNING = { share: 1 };
/** Leash reach from the owner's hand, measured on the ground (m). */
export const LEASH = 1.7;
/** Breed count (looks live in DogView). */
export const BREEDS = 6;

/** Player's car must be within this far ahead / to the side (plus its size) for a dog to leap away. */
const LEAP_LOOKAHEAD = 0.55;
const LEAP_SPEED = 5.5;
const LEAP_TIME = 0.32;
const DOG_RADIUS = 0.3;

export interface Dog {
  active: boolean;
  pos: Vec2;
  prev: Vec2;
  heading: number;
  speed: number;
  /** Trot phase (radians) and tail wag phase. */
  phase: number;
  wag: number;
  /** Sideways offset from the owner's line the dog drifts toward. */
  wander: number;
  wanderT: number;
  /** Seconds left sniffing a spot (the owner waits), and the countdown to the next sniff. */
  sniffT: number;
  sniffAt: Vec2;
  nextSniff: number;
  /** Seconds the dog has been standing (it sits after a moment). */
  still: number;
  /** Startled leap away from the player's car. */
  leapT: number;
  leap: Vec2;
  breed: number;
  /** Owner's look seed when the dog was set up (a reused ped slot gets a new dog). */
  look: number;
}

/** Dogs on leashes for pedestrians with `dog` set: trot beside the owner, stop to sniff, leap clear of the car. */
export class DogWalkers implements SimSystem {
  readonly dogs: Dog[];
  readonly stats = { leaps: 0, sniffs: 0 };

  constructor(
    private world: World,
    private peds: Pedestrians,
  ) {
    this.dogs = peds.peds.map(() => ({
      active: false,
      pos: { x: 0, z: 0 },
      prev: { x: 0, z: 0 },
      heading: 0,
      speed: 0,
      phase: 0,
      wag: 0,
      wander: 0,
      wanderT: 0,
      sniffT: 0,
      sniffAt: { x: 0, z: 0 },
      nextSniff: 0,
      still: 0,
      leapT: 0,
      leap: { x: 0, z: 0 },
      breed: 0,
      look: -1,
    }));
  }

  get count(): number {
    let n = 0;
    for (const d of this.dogs) if (d.active) n++;
    return n;
  }

  update(dt: number): void {
    const rng = this.world.rng;
    for (const p of this.peds.peds) {
      const d = this.dogs[p.id];
      if (!p.active || !p.dog) {
        d.active = false;
        continue;
      }
      const of = fwd(p.heading);
      const ol = leftOf(p.heading);
      if (!d.active || d.look !== p.look) {
        d.active = true;
        d.look = p.look;
        d.wander = rng.range(-0.6, 0.6);
        d.pos.x = p.pos.x + of.x * 0.9 + ol.x * d.wander;
        d.pos.z = p.pos.z + of.z * 0.9 + ol.z * d.wander;
        d.heading = p.heading;
        d.speed = 0;
        d.phase = rng.range(0, Math.PI * 2);
        d.sniffT = 0;
        d.nextSniff = rng.range(4, 14);
        d.wanderT = rng.range(2, 5);
        d.still = 0;
        d.leapT = 0;
        d.breed = Math.floor(hash01(p.look, 31) * BREEDS);
      }
      d.prev.x = d.pos.x;
      d.prev.z = d.pos.z;

      const alarmed = p.dodge !== 'none' || p.panic > 0;
      const strolling = !alarmed && !p.waiting && !p.onRoad;
      let goal: Vec2;
      let maxV = Math.max(1.6, Math.hypot(p.vel.x, p.vel.z) * 1.8);
      if (alarmed && d.sniffT > 0) {
        d.sniffT = 0;
        p.pause = 0;
      }
      if (d.sniffT > 0) {
        d.sniffT -= dt;
        if (d.sniffT <= 0) p.pause = 0;
        goal = d.sniffAt;
      } else if (p.dodge !== 'none') {
        goal = { x: p.dodgeTo.x + of.x * 0.6, z: p.dodgeTo.z + of.z * 0.6 };
        maxV = 6;
      } else if (p.waiting) {
        goal = { x: p.pos.x + ol.x * 0.55 + of.x * 0.25, z: p.pos.z + ol.z * 0.55 + of.z * 0.25 };
      } else {
        goal = { x: p.pos.x + of.x * 0.9 + ol.x * d.wander, z: p.pos.z + of.z * 0.9 + ol.z * d.wander };
        if (alarmed) maxV = 6;
        if ((d.wanderT -= dt) <= 0) {
          d.wanderT = rng.range(2, 5);
          d.wander = rng.range(-0.6, 0.6);
        }
        if (strolling && (d.nextSniff -= dt) <= 0) {
          // Stop to sniff a spot a little ahead; the owner waits
          d.nextSniff = rng.range(9, 22);
          d.sniffT = rng.range(1.5, 4);
          d.sniffAt = { x: goal.x + of.x * 0.4, z: goal.z + of.z * 0.4 };
          p.pause = d.sniffT;
          this.stats.sniffs++;
        }
      }

      // Move: startled leap, else trot toward the goal (proportional, capped)
      let vx: number;
      let vz: number;
      if (d.leapT > 0) {
        d.leapT -= dt;
        vx = d.leap.x;
        vz = d.leap.z;
      } else {
        const gx = goal.x - d.pos.x;
        const gz = goal.z - d.pos.z;
        const gd = Math.hypot(gx, gz);
        const v = Math.min(maxV, gd * 3);
        vx = gd > 0.02 ? (gx / gd) * v : 0;
        vz = gd > 0.02 ? (gz / gd) * v : 0;
      }
      d.pos.x += vx * dt;
      d.pos.z += vz * dt;
      // Leash: never farther than LEASH from the owner (except mid-leap, the owner is diving too)
      const lx = d.pos.x - p.pos.x;
      const lz = d.pos.z - p.pos.z;
      const ld = Math.hypot(lx, lz);
      const reach = d.leapT > 0 ? LEASH * 1.6 : LEASH;
      if (ld > reach) {
        d.pos.x = p.pos.x + (lx / ld) * reach;
        d.pos.z = p.pos.z + (lz / ld) * reach;
      }
      this.avoidPlayer(d);

      const mx = (d.pos.x - d.prev.x) / dt;
      const mz = (d.pos.z - d.prev.z) / dt;
      d.speed = Math.hypot(mx, mz);
      if (d.speed > 0.15) {
        d.heading += wrapAngle(Math.atan2(mx, mz) - d.heading) * Math.min(1, dt * 10);
        d.still = 0;
      } else {
        d.still += dt;
        // Face the owner's way while waiting, the spot while sniffing
        const face = d.sniffT > 0 ? Math.atan2(d.sniffAt.x - d.pos.x, d.sniffAt.z - d.pos.z) : p.heading;
        d.heading += wrapAngle(face - d.heading) * Math.min(1, dt * 3);
      }
      d.phase += d.speed * dt * 7;
      d.wag += dt * (alarmed ? 4 : d.sniffT > 0 ? 18 : 10);
    }
  }

  /** Leap sideways out of the player's predicted path; hard push out of the car body as a last resort. */
  private avoidPlayer(d: Dog): void {
    const car = this.world.player;
    const s = car.phys.state;
    const rx = d.pos.x - car.pos.x;
    const rz = d.pos.z - car.pos.z;
    const reach = car.speed * LEAP_LOOKAHEAD + car.halfL + 2;
    if (Math.abs(rx) > reach || Math.abs(rz) > reach) return;
    const f = fwd(car.yaw);
    const l = leftOf(car.yaw);
    const rel = { x: rx, z: rz };
    let a = dot(rel, f);
    let b = dot(rel, l);
    if (d.leapT <= 0 && car.speed > 1.5) {
      const vf = dot(s.vel, f);
      const ahead = vf >= 0 ? a : -a;
      if (ahead > -car.halfL && ahead < Math.abs(vf) * LEAP_LOOKAHEAD + car.halfL + 0.4 && Math.abs(b) < car.halfW + 0.7) {
        const side = b >= 0 ? 1 : -1;
        d.leapT = LEAP_TIME;
        d.leap.x = l.x * side * LEAP_SPEED;
        d.leap.z = l.z * side * LEAP_SPEED;
        d.sniffT = 0;
        this.stats.leaps++;
      }
    }
    const ex = car.halfL + DOG_RADIUS;
    const ey = car.halfW + DOG_RADIUS;
    if (Math.abs(a) >= ex || Math.abs(b) >= ey) return;
    if (ey - Math.abs(b) <= ex - Math.abs(a)) b = (b < 0 ? -1 : 1) * ey;
    else a = (a < 0 ? -1 : 1) * ex;
    d.pos.x = car.pos.x + f.x * a + l.x * b;
    d.pos.z = car.pos.z + f.z * a + l.z * b;
  }
}
