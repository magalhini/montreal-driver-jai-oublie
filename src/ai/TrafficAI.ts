import { CONFIG } from '../config';
import { dist, dot, fwd } from '../core/math';
import type { World } from '../core/World';
import type { Lane, SimSystem, Vec2 } from '../types';
import { Car, type BodyStyle } from '../vehicles/Car';
import { BOX_TRUCK, KEI_TRUCK, MAME, TRAFFIC_SEDAN } from '../vehicles/CarSpec';
import { LaneDriver } from './LaneDriver';

const COLORS = [0xe8e8e8, 0x9aa0a8, 0x18181d, 0xa01818, 0x1c2a5a, 0xc8b48a, 0x2a7a7a, 0x2f5a3a, 0xd8d0c0, 0x5a2a4a];
const STYLES: BodyStyle[] = ['sedan', 'sedan', 'sedan', 'kei', 'kei', 'wagon', 'wagon', 'coupe', 'city'];
/** Cream, red, sky, yellow, green, black: the small cars stand out from the sedan palette. */
const CITY_COLORS = [0xf4f1e8, 0xc4382a, 0x7dbae0, 0xf0d24a, 0x3d8f62, 0x1a1a1c];
/** Mostly white cabs, a few pale blue / green / navy ones. */
const TRUCK_COLORS = [0xe4e4e0, 0xe4e4e0, 0xe4e4e0, 0xe4e4e0, 0x8fb0c8, 0x5f8a6a, 0x26406e];
const KEI_TRUCK_COLORS = [0xe4e4e0, 0xe4e4e0, 0xe4e4e0, 0x9aa0a8, 0x26406e, 0x5f8a6a];
/** Share of spawns that are trucks ("the occasional truck"), and at most this many box trucks around. */
export const TRUCK_TUNING = { boxTruck: 0.06, keiTruck: 0.08, maxBoxTrucks: 3 };

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
    if (r > 1 - TRUCK_TUNING.keiTruck) return 'keitruck';
    return rng.pick(STYLES);
  }

  spawnCar(lane: Lane, pos: Vec2, opts?: { style?: BodyStyle; color?: number }): Car {
    const rng = this.world.rng;
    const style = opts?.style ?? this.pickStyle();
    const palette = style === 'truck' ? TRUCK_COLORS : style === 'keitruck' ? KEI_TRUCK_COLORS : style === 'city' ? CITY_COLORS : COLORS;
    const color = opts?.color ?? (style === 'sedan' && rng.chance(0.15) ? 0xe0b020 : rng.pick(palette));
    const yaw = Math.atan2(lane.dir.x, lane.dir.z);
    const spec = style === 'truck' ? BOX_TRUCK : style === 'keitruck' ? KEI_TRUCK : style === 'city' ? MAME : TRAFFIC_SEDAN;
    const car = new Car('traffic', spec, { style, color }, pos, yaw);
    if (style === 'kei') {
      car.phys.spec.halfLength = 1.65;
      car.phys.spec.halfWidth = 0.72;
      car.phys.spec.mass = 750;
    }
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
    for (let k = 0; k < this.target * 3 && this.drivers.size < this.target; k++) this.trySpawn(25, true);
  }

  private trySpawn(rMin: number, ignoreView = false): void {
    const w = this.world;
    const pp = w.player.pos;
    const hit = w.city.randomLanePointNear(w.rng, pp, rMin, CONFIG.SPAWN_RADIUS);
    if (!hit) return;
    // Nothing spawns on a fenced street or in a coned lane (it would only drive into the fence / the cones)
    if (w.roadworks && (w.roadworks.closedEdge(hit.lane.edgeId) || w.roadworks.conedLane(hit.lane.id))) return;
    // ...nor in a lane that ends, too late to merge out of it
    if (w.roadworks?.mergeLane(hit.lane.id) && (w.roadworks.mergeAhead(hit.lane, hit.pos)?.dist ?? 0) < 40) return;
    const d = dist(hit.pos, pp);
    if (!ignoreView && this.inView(hit.pos, d)) return;
    if (!this.clearAt(hit.pos, 14)) return;
    this.spawnCar(hit.lane, hit.pos);
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
      if (this.drivers.size < this.target) this.trySpawn(this.boost > 0 ? 45 : CONFIG.SPAWN_MIN);
      else if (this.drivers.size > this.target) this.dropOne();
    }
  }
}
