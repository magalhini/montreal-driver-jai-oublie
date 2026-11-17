import { CONFIG } from '../config';
import { dist, dot, fwd } from '../core/math';
import type { World } from '../core/World';
import type { Lane, SimSystem, Vec2 } from '../types';
import { Car, type BodyStyle } from '../vehicles/Car';
import { TAXI_COLOR } from '../vehicles/CarModel';
import { BOX_TRUCK, PICKUP, TRAFFIC_SEDAN } from '../vehicles/CarSpec';
import { LaneDriver } from './LaneDriver';

const COLORS = [0xe8e8e8, 0x9aa0a8, 0x18181d, 0xa01818, 0x1c2a5a, 0xc8b48a, 0x2a7a7a, 0x2f5a3a, 0xd8d0c0, 0x5a2a4a];
/** Full-size cars only (PRD 11B): no kei, no bubble car. Sedans are the majority, and the modern shape. */
const STYLES: BodyStyle[] = ['sedan', 'sedan', 'sedan', 'sedan', 'wagon', 'wagon', 'coupe'];
/** Mostly white cabs, a few pale blue / green / navy ones. */
const TRUCK_COLORS = [0xe4e4e0, 0xe4e4e0, 0xe4e4e0, 0xe4e4e0, 0x8fb0c8, 0x5f8a6a, 0x26406e];
/** Pickup paints: white, silver, black, red, blue, dark green. */
const PICKUP_COLORS = [0xf2f2f0, 0xb7bcc2, 0x1a1a1c, 0x8e1c1c, 0x1c355c, 0x1e3d28];
/** Share of spawns that are trucks, and at most this many box trucks around. Pickups take the old kei-truck share. */
export const TRUCK_TUNING = { boxTruck: 0.06, pickup: 0.1, maxBoxTrucks: 3 };

/** Spawns, drives and despawns civilian traffic in a ring around the player. */
export class TrafficSystem implements SimSystem {
  readonly drivers = new Map<number, LaneDriver>();
  private spawnTimer = 0;
  /** Seconds of quick spawning left after the target went up (the traffic level changed). */
  private boost = 0;
  target = CONFIG.MAX_TRAFFIC;

  constructor(private world: World) {}

  /** New traffic level: extra cars come in quickly out of view, surplus ones leave out of view. */
  setTarget(n: number): void {
    if (n > this.target) this.boost = 8;
    this.target = n;
  }

  /** Is this point (at distance `d` from the player) likely on screen? */
  private inView(p: Vec2, d: number): boolean {
    const w = this.world;
    const pp = w.player.pos;
    const ahead = dot({ x: p.x - pp.x, z: p.z - pp.z }, fwd(w.player.yaw));
    return d < 140 && ahead > -0.3 * d;
  }

  /** Is a lane point clear of other cars? */
  clearAt(p: Vec2, r: number): boolean {
    for (const c of this.world.cars) if (!c.removed && dist(c.pos, p) < r) return false;
    return true;
  }

  /** Box trucks currently driving. */
  get boxTrucks(): number {
    let n = 0;
    for (const d of this.drivers.values()) if (d.car.look.style === 'truck') n++;
    return n;
  }

  private pickStyle(): BodyStyle {
    const rng = this.world.rng;
    const r = rng.next();
    if (r < TRUCK_TUNING.boxTruck && this.boxTrucks < TRUCK_TUNING.maxBoxTrucks) return 'truck';
    if (r > 1 - TRUCK_TUNING.pickup) return 'pickup';
    return rng.pick(STYLES);
  }

  spawnCar(lane: Lane, pos: Vec2, opts?: { style?: BodyStyle; color?: number }): Car {
    const rng = this.world.rng;
    const style = opts?.style ?? this.pickStyle();
    const palette = style === 'truck' ? TRUCK_COLORS : style === 'pickup' ? PICKUP_COLORS : COLORS;
    const taxi = style === 'sedan' && rng.chance(0.14);
    const color = opts?.color ?? (taxi ? TAXI_COLOR : rng.pick(palette));
    const yaw = Math.atan2(lane.dir.x, lane.dir.z);
    const spec = style === 'truck' ? BOX_TRUCK : style === 'pickup' ? PICKUP : TRAFFIC_SEDAN;
    const car = new Car('traffic', spec, { style, color }, pos, yaw);
    const sp = car.phys.state;
    const v0 = this.world.city.edges[lane.edgeId].speedLimit * 0.7;
    sp.vel.x = lane.dir.x * v0;
    sp.vel.z = lane.dir.z * v0;
    this.world.addCar(car);
    const drv = new LaneDriver(this.world, car, lane);
    if (style === 'truck') {
      // Trucks keep below the limit, take corners slowly and pull away gently
      drv.speedMul = rng.range(0.75, 0.9);
      drv.turnSpeed = 4.8;
      drv.aMax = 1.3;
    }
    this.drivers.set(car.id, drv);
    return car;
  }

  /** Fill the ring right away (on game start). */
  populate(): void {
    for (let k = 0; k < this.target * 6 && this.drivers.size < this.target; k++) this.trySpawn(25, true);
  }

  /** One spawn attempt at a random lane point in the ring; most land somewhere unusable. True if a car came in. */
  private trySpawn(rMin: number, ignoreView = false): boolean {
    const w = this.world;
    const pp = w.player.pos;
    const hit = w.city.randomLanePointNear(w.rng, pp, rMin, CONFIG.SPAWN_RADIUS);
    if (!hit) return false;
    // Nothing spawns on a fenced street or in a coned lane (it would only drive into the fence / the cones)
    if (w.roadworks && (w.roadworks.closedEdge(hit.lane.edgeId) || w.roadworks.conedLane(hit.lane.id))) return false;
    // ...nor in a lane that ends, too late to merge out of it
    if (w.roadworks?.mergeLane(hit.lane.id) && (w.roadworks.mergeAhead(hit.lane, hit.pos)?.dist ?? 0) < 40) return false;
    // ...nor just before a light that isn't green: a car born at speed 15 m from an amber can't stop for it
    if (w.lights.state(hit.lane.to, hit.lane.edgeId) !== 'green' && dist(hit.pos, hit.lane.end) < 45) return false;
    const d = dist(hit.pos, pp);
    if (!ignoreView && this.inView(hit.pos, d)) return false;
    if (!this.clearAt(hit.pos, 14)) return false;
    this.spawnCar(hit.lane, hit.pos);
    return true;
  }

  /** Over target (the level went down): take away one car the player can't see. */
  private dropOne(): void {
    const pp = this.world.player.pos;
    for (const [id, drv] of this.drivers) {
      const d = dist(drv.car.pos, pp);
      if (d < 50 || this.inView(drv.car.pos, d)) continue;
      drv.car.removed = true;
      this.drivers.delete(id);
      return;
    }
  }

  update(): void {
    const w = this.world;
    const pp = w.player.pos;
    for (const [id, drv] of this.drivers) {
      const car = drv.car;
      if (car.removed) {
        this.drivers.delete(id);
        continue;
      }
      const d = dist(car.pos, pp);
      if (d > CONFIG.DESPAWN_RADIUS || (drv.stuckTime > 12 && d > 45)) {
        car.removed = true;
        this.drivers.delete(id);
        continue;
      }
      drv.drive();
    }
    this.spawnTimer -= 1 / 60;
    if (this.boost > 0) this.boost -= 1 / 60;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.boost > 0 ? 0.05 : 0.25;
      if (this.drivers.size < this.target) {
        // Montreal density (Phase 8): most attempts miss (in view, too close to a car), so a ring well short of
        // its target tries a few points per tick
        const tries = this.target - this.drivers.size > 6 ? 4 : 1;
        for (let k = 0; k < tries && !this.trySpawn(this.boost > 0 ? 45 : CONFIG.SPAWN_MIN); k++);
      }
      else if (this.drivers.size > this.target) this.dropOne();
    }
  }
}
