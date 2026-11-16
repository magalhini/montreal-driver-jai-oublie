import { dist, wrapAngle } from '../core/math';
import type { World } from '../core/World';
import type { SimSystem, Vec2 } from '../types';
import { Car, type BodyStyle, type CarLook } from '../vehicles/Car';
import { MAME, POLICE_CRUISER, TRAFFIC_SEDAN, type CarSpec } from '../vehicles/CarSpec';
import { repair } from '../vehicles/Damage';

const specFor = (style: BodyStyle): CarSpec => (style === 'police' ? POLICE_CRUISER : style === 'city' ? MAME : TRAFFIC_SEDAN);

const COLORS = [0xe8e8e8, 0x9aa0a8, 0x18181d, 0xa01818, 0x1c2a5a, 0xc8b48a, 0x2a7a7a, 0x2f5a3a, 0xd8d0c0, 0x5a2a4a, 0xe0b020];
const STYLES: BodyStyle[] = ['sedan', 'sedan', 'kei', 'kei', 'wagon', 'coupe', 'city'];
const WAKE = 150;
const SLEEP = 210;

/** A bay; `look` fixes the car parked in it (a site's own cars), else it is random. */
type Slot = { pos: Vec2; yaw: number; look?: CarLook };

/** One lot's bays: woken and put to sleep together. `share` of the bays is filled (always the same ones). */
interface Group {
  slots: Slot[];
  center: Vec2;
  share: number;
  seed: number;
  cars: Car[];
  /** The bay each of `cars` belongs in. */
  home: Slot[];
  /** Cars knocked out of their bays go back as soon as the player is clear of them. */
  restoring: boolean;
}

/** How far a car can be nudged before it counts as out of its bay (m / rad). */
const MOVED = 0.05;
const TURNED = 0.02;

/**
 * Cars parked in the lots (the parking lot, the coffee shops' bays): real (pushable) cars with the handbrake
 * on, which only exist while the player is near their lot and are put back in their bays when the player
 * comes back.
 */
export class ParkedCars implements SimSystem {
  private groups: Group[] = [];

  constructor(private world: World) {
    const f = world.city.features;
    this.add(f.parking, 0.42, 0);
    // Vans at the yard's docks and staff cars in its bays
    if (f.depot) this.add(f.depot.parked, 1, 51);
    // Cruisers in the precinct lot (the open bays are left empty for a later dispatch)
    if (f.station) this.add(f.station.parked, 1, 31);
  }

  private add(slots: Slot[], share: number, seed: number): Group | null {
    if (!slots.length) return null;
    const center = { x: slots.reduce((s, p) => s + p.pos.x, 0) / slots.length, z: slots.reduce((s, p) => s + p.pos.z, 0) / slots.length };
    const g: Group = { slots, center, share, seed, cars: [], home: [], restoring: false };
    this.groups.push(g);
    return g;
  }

  get count(): number {
    return this.groups.reduce((n, g) => n + g.cars.length, 0);
  }

  update(): void {
    for (const g of this.groups) {
      const d = dist(this.world.player.pos, g.center);
      if (g.cars.length === 0 && d < WAKE) this.wake(g);
      else if (g.cars.length > 0 && d > SLEEP) this.sleep(g);
      if (g.restoring) this.restore(g);
    }
  }

  /** Back to their bays: a car whose bay the player is in waits for them to drive off. */
  private restore(g: Group): void {
    const p = this.world.player;
    let waiting = false;
    g.cars.forEach((car, i) => {
      const slot = g.home[i];
      const out = dist(car.pos, slot.pos) > MOVED || Math.abs(wrapAngle(car.yaw - slot.yaw)) > TURNED;
      if (!out && car.phys.state.damage === 0) return;
      if (dist(p.pos, slot.pos) < car.halfL + p.halfL + 0.8) {
        waiting = true;
        return;
      }
      car.teleport(slot.pos, slot.yaw);
      car.input.handbrake = true;
      repair(car);
    });
    g.restoring = waiting && g.cars.length > 0;
  }

  private wake(g: Group): void {
    const w = this.world;
    g.slots.forEach((slot, i) => {
      const h = Math.sin(i * 127.1 + 31.7 + g.seed * 71.3) * 43758.5453;
      const r = h - Math.floor(h);
      if (r > g.share) return;
      const look: CarLook = slot.look ?? { style: STYLES[Math.floor(r * 97) % STYLES.length], color: COLORS[Math.floor(r * 211) % COLORS.length] };
      const style = look.style;
      const car = new Car('parked', specFor(style), { ...look }, slot.pos, slot.yaw);
      if (style === 'kei') {
        car.phys.spec.halfLength = 1.65;
        car.phys.spec.halfWidth = 0.72;
        car.phys.spec.mass = 750;
      }
      car.input.handbrake = true;
      w.addCar(car);
      g.cars.push(car);
      g.home.push(slot);
    });
    g.restoring = false;
  }

  private sleep(g: Group): void {
    for (const c of g.cars) c.removed = true;
    g.cars = [];
    g.home = [];
    g.restoring = false;
  }
}
