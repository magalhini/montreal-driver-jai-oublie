import { speedingThreshold } from '../ai/OffenseDetector';
import { CONFIG, KMH } from '../config';
import type { World } from '../core/World';
import type { RoadEdge, RoadNode } from '../types';
import type { Car } from '../vehicles/Car';

/** Stay this far under the speeding threshold: headroom for the controller, and round caps (60 / 80 km/h). */
const HEADROOM = 5 * KMH;
/** Throttle fades out over this last stretch (m/s) below the cap. */
const EASE = 2.5;
/** Brake is fully on this far (m/s) over the cap. */
const BRAKE_SPAN = 1.5;

/**
 * Player assist (L key): keeps the car just under the speed that counts as speeding on the current road,
 * easing off the throttle and braking when needed (downhill, or after turning onto a slower street).
 * Inside a junction the stricter of the road behind and the road the car is heading into applies.
 * Off road it keeps the last road's cap.
 */
export class SpeedLimiter {
  on = false;
  /** Current cap (m/s), tracked every step even while off. */
  cap = speedingThreshold(CONFIG.STREET_LIMIT_KMH * KMH) - HEADROOM;
  private lastEdge: RoadEdge | null = null;
  /** Posted limit (km/h) of the road the car is on or last left, for the HUD sign. */
  postedKmh = CONFIG.STREET_LIMIT_KMH;

  constructor(private world: World) {}

  /** Clamps the car's throttle / brake inputs for this simulation step. */
  apply(car: Car): void {
    this.cap = this.capFor(car) - HEADROOM;
    if (!this.on) return;
    const s = car.phys.state;
    if (s.gear < 1 || s.speed <= 0) return; // reversing never gets near a limit
    const room = this.cap - car.speed; // same speed measure as the offense check
    car.input.throttle = Math.min(car.input.throttle, Math.max(0, room / EASE));
    if (room < 0) car.input.brake = Math.max(car.input.brake, Math.min(1, -room / BRAKE_SPAN));
  }

  /** Speeding threshold (m/s) that applies at the car's position. */
  private capFor(car: Car): number {
    const hit = this.world.city.roadAt(car.pos);
    if (hit?.edge) this.lastEdge = hit.edge;
    if (this.lastEdge) this.postedKmh = Math.round(this.lastEdge.speedLimit / KMH);
    let limit = speedingThreshold(this.lastEdge?.speedLimit ?? CONFIG.STREET_LIMIT_KMH * KMH);
    if (hit?.node) {
      const next = this.exitEdge(hit.node, car);
      if (next) limit = Math.min(limit, speedingThreshold(next.speedLimit));
    }
    return limit;
  }

  /** The junction's road that best matches the car's direction of travel. */
  private exitEdge(node: RoadNode, car: Car): RoadEdge | null {
    const city = this.world.city;
    const sp = car.speed;
    const hx = sp > 1 ? car.vel.x / sp : Math.sin(car.yaw);
    const hz = sp > 1 ? car.vel.z / sp : Math.cos(car.yaw);
    let best: RoadEdge | null = null;
    let bestDot = -Infinity;
    for (const id of node.edges) {
      const e = city.edges[id];
      const other = city.nodes[e.a === node.id ? e.b : e.a];
      const dx = other.pos.x - node.pos.x;
      const dz = other.pos.z - node.pos.z;
      const d = (dx * hx + dz * hz) / (Math.hypot(dx, dz) || 1);
      if (d > bestDot) {
        bestDot = d;
        best = e;
      }
    }
    return best;
  }
}
