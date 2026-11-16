import { dot, fwd, leftOf } from '../core/math';
import type { World } from '../core/World';
import type { Car } from '../vehicles/Car';
import type { Listener } from './EngineAudio';
import type { Mixer } from './Mixer';
import type { Sfx } from './Sfx';

/** Horn notes by vehicle (pairs are the usual low / high dual horn). */
const SEDAN_HORNS = [
  [392, 494],
  [350, 440],
  [415, 523],
  [370, 466],
];
const KEI_HORN = [620];
const CITY_HORN = [523, 659];
const TRUCK_HORN = [262, 330];

interface Grudge {
  /** Seconds stuck behind the stopped player. */
  blocked: number;
  /** Seconds until this car may honk again. */
  cool: number;
}

/**
 * AI drivers honk at the player (T34, from the Phase 3 notes): when the player sits in front of them
 * blocking the lane, when the player comes at them head-on in their lane, and right after the player hits
 * them. Pure audio: it reads the world, nothing in the sim reacts.
 */
export class TrafficHorns {
  private readonly grudges = new Map<number, Grudge>();
  private scan = 0;

  constructor(
    private readonly mx: Mixer,
    private readonly sfx: Sfx,
    private readonly world: World,
  ) {
    world.events.on('collision', (e) => {
      const p = world.player.id;
      const other = e.a === p ? e.b : e.b === p ? e.a : null;
      if (other === null || world.controlLocked) return;
      const car = world.carById(other);
      if (!car || car.kind !== 'traffic') return;
      const g = this.grudge(car.id);
      if (g.cool > 0) return;
      g.cool = 6;
      setTimeout(() => !car.removed && this.honk(car, [[0, 0.9]]), 350 + Math.random() * 400);
    });
  }

  private grudge(id: number): Grudge {
    let g = this.grudges.get(id);
    if (!g) this.grudges.set(id, (g = { blocked: 0, cool: 0 }));
    return g;
  }

  update(ls: Listener, dt: number): void {
    for (const g of this.grudges.values()) g.cool -= dt;
    this.scan -= dt;
    if (this.scan > 0) return;
    const step = 0.2;
    this.scan = step;
    const w = this.world;
    const p = w.player;
    if (w.mode === 'menu' || w.controlLocked) return;
    const pSpeed = p.speed;
    for (const c of w.cars) {
      if (c.kind !== 'traffic' || c.removed) continue;
      const rx = p.pos.x - c.pos.x;
      const rz = p.pos.z - c.pos.z;
      if (Math.abs(rx) > 40 || Math.abs(rz) > 40) continue;
      if (Math.hypot(c.pos.x - ls.pos.x, c.pos.z - ls.pos.z) > 80) continue;
      const f = fwd(c.yaw);
      const ahead = dot({ x: rx, z: rz }, f);
      const side = Math.abs(dot({ x: rx, z: rz }, leftOf(c.yaw)));
      const g = this.grudge(c.id);
      // Blocked: stopped right behind a stopped player
      if (c.speed < 0.6 && pSpeed < 1 && ahead > 2 && ahead < c.halfL + p.halfL + 5 && side < 1.8) {
        g.blocked += step;
        if (g.blocked > 3 && g.cool <= 0) {
          const angry = g.blocked > 9;
          this.honk(c, angry ? [[0, 1.4]] : Math.random() < 0.5 ? [[0, 0.18], [0.28, 0.25]] : [[0, 0.4]]);
          g.cool = angry ? 5 : 4 + Math.random() * 3;
        }
      } else g.blocked = Math.max(0, g.blocked - step * 2);
      // Head-on in its lane
      if (ahead > 6 && ahead < 32 && side < 1.6 && g.cool <= 0) {
        const closing = c.speed - dot(p.vel, f);
        if (closing > 11) {
          this.honk(c, [[0, 1.2]]);
          g.cool = 4;
        }
      }
    }
    if (this.grudges.size > 200) for (const [id] of this.grudges) if (!w.carById(id)) this.grudges.delete(id);
  }

  private honk(car: Car, pattern: [number, number][]): void {
    const style = car.look.style;
    const freqs = style === 'kei' || style === 'keitruck' ? KEI_HORN : style === 'city' ? CITY_HORN : style === 'truck' ? TRUCK_HORN : SEDAN_HORNS[car.id % SEDAN_HORNS.length];
    this.sfx.horn({ pos: { x: car.pos.x, y: car.y + 0.7, z: car.pos.z }, bus: this.mx.effects, cat: 'horns', ref: 9, wet: 0.5 }, freqs, pattern, 0.32);
  }
}
