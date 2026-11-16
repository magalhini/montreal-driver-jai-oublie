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

/** Curb-lane parking (PRD 4.2): how full the bays are and how many of those cars are real at once. */
export const CURB_PARKED_TUNING = {
  /** Share of bays with a car in them (always the same bays). */
  street: 0.5,
  boulevard: 0.35,
  /** Bays per wake / sleep chunk (a block side is cut into runs of about 50 m). */
  chunk: 8,
  /** A chunk wakes within `wake` of the player and sleeps beyond `sleep` (m), nearest first. */
  wake: 130,
  sleep: 165,
  /** Most curb cars alive at once (with traffic and police under `CarView`'s 160-car batches). */
  cap: 70,
  /** With the cap reached, a nearer chunk replaces the farthest live one only if that one is this much farther (m). */
  evictMargin: 25,
};

/** A bay; `look` fixes the car parked in it (a site's own cars), else it is random. */
type Slot = { pos: Vec2; yaw: number; look?: CarLook };

/** One lot's bays: woken and put to sleep together. `share` of the bays is filled (always the same ones). */
interface Group {
  slots: Slot[];
  center: Vec2;
  /** Indices of the slots with a car, and that car's random draw (0..share). */
  filled: { i: number; r: number }[];
  cars: Car[];
  /** The bay each of `cars` belongs in. */
  home: Slot[];
  /** Cars knocked out of their bays go back as soon as the player is clear of them. */
  restoring: boolean;
  /** A run of curb bays (woken nearest first, under `CURB_PARKED_TUNING.cap`). */
  curb: boolean;
  /** Distance to the player at the last update. */
  d: number;
}

/** How far a car can be nudged before it counts as out of its bay (m / rad). */
const MOVED = 0.05;
const TURNED = 0.02;

/**
 * Cars parked in the lots, the yard, the precinct and the curb bays of streets and boulevards: real (pushable)
 * cars with the handbrake on, which only exist while the player is near their lot or run of curb, and are put
 * back in their bays when the player comes back. Curb cars stand in the parking band, outside the travel lanes.
 */
export class ParkedCars implements SimSystem {
  private groups: Group[] = [];
  private curbAwake: Group[] = [];
  private curbCars = 0;
  private wanted: Group[] = [];

  constructor(private world: World) {
    const f = world.city.features;
    this.add(f.parking, 0.42, 0, false);
    // Vans at the yard's docks and staff cars in its bays
    if (f.depot) this.add(f.depot.parked, 1, 51, false);
    // Cruisers in the precinct lot (the open bays are left empty for a later dispatch)
    if (f.station) this.add(f.station.parked, 1, 31, false);
    // Curb bays: each side of each block in runs of `chunk` bays (the planner lists them in order along the curb)
    const T = CURB_PARKED_TUNING;
    let run: Slot[] = [];
    let key = '';
    let seed = 1000;
    const flush = () => {
      if (!run.length) return;
      const e = world.city.edges[Number(key.split(':')[0])];
      this.add(run, e.cls === 'boulevard' ? T.boulevard : T.street, seed++, true);
      run = [];
    };
    for (const b of f.curb) {
      const k = `${b.edge}:${b.side}`;
      if (k !== key || run.length >= T.chunk) {
        flush();
        key = k;
      }
      run.push({ pos: b.pos, yaw: b.yaw });
    }
    flush();
  }

  private add(slots: Slot[], share: number, seed: number, curb: boolean): Group | null {
    if (!slots.length) return null;
    const center = { x: slots.reduce((s, p) => s + p.pos.x, 0) / slots.length, z: slots.reduce((s, p) => s + p.pos.z, 0) / slots.length };
    const filled: Group['filled'] = [];
    slots.forEach((_, i) => {
      const h = Math.sin(i * 127.1 + 31.7 + seed * 71.3) * 43758.5453;
      const r = h - Math.floor(h);
      if (r <= share) filled.push({ i, r });
    });
    const g: Group = { slots, center, filled, cars: [], home: [], restoring: false, curb, d: Infinity };
    this.groups.push(g);
    return g;
  }

  get count(): number {
    return this.groups.reduce((n, g) => n + g.cars.length, 0);
  }

  update(): void {
    const T = CURB_PARKED_TUNING;
    const p = this.world.player.pos;
    this.wanted.length = 0;
    for (const g of this.groups) {
      g.d = dist(p, g.center);
      if (g.curb) {
        if (g.cars.length > 0 && g.d > T.sleep) this.sleep(g);
        else if (g.cars.length === 0 && g.d < T.wake && g.filled.length) this.wanted.push(g);
      } else if (g.cars.length === 0 && g.d < WAKE) this.wake(g);
      else if (g.cars.length > 0 && g.d > SLEEP) this.sleep(g);
      if (g.restoring) this.restore(g);
    }
    // Nearest runs first; past the cap a nearer run takes the place of the farthest live one
    this.wanted.sort((a, b) => a.d - b.d);
    for (const g of this.wanted) {
      if (this.curbCars + g.filled.length > T.cap) {
        let far: Group | null = null;
        for (const o of this.curbAwake) if (!far || o.d > far.d) far = o;
        if (!far || far.d < g.d + T.evictMargin) break;
        this.sleep(far);
        if (this.curbCars + g.filled.length > T.cap) break;
      }
      this.wake(g);
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
    for (const { i, r } of g.filled) {
      const slot = g.slots[i];
      // A curb bay someone is standing in (the player parked there, a car pulled over) stays empty this time
      if (g.curb && w.cars.some((c) => !c.removed && dist(c.pos, slot.pos) < c.halfL + 2.6)) continue;
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
    }
    g.restoring = false;
    if (g.curb && g.cars.length) {
      this.curbAwake.push(g);
      this.curbCars += g.cars.length;
    }
  }

  private sleep(g: Group): void {
    if (g.curb && g.cars.length) {
      this.curbAwake.splice(this.curbAwake.indexOf(g), 1);
      this.curbCars -= g.cars.length;
    }
    for (const c of g.cars) c.removed = true;
    g.cars = [];
    g.home = [];
    g.restoring = false;
  }
}
