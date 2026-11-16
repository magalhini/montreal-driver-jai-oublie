import { dist, yawOf } from '../core/math';
import type { World } from '../core/World';
import type { SimSystem, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import { addDamage } from '../vehicles/Damage';
import { type Economy, formatCash } from './Economy';

/** Fee for fishing the player's car out of the water. */
export const TOW_FEE = 3000;
const SINK_TIME = 1.6;
const CLEAR = 9;

type Phase = 'free' | 'sinking' | 'fadeOut' | 'fadeIn';

/**
 * Water: cars that land in the canal or harbor sink. AI cars are gone after a few seconds; the player's screen
 * fades out and the car is put back on the nearest clear lane to where it was last on the road, for a fee.
 */
export class Recovery implements SimSystem {
  phase: Phase = 'free';
  fade = 0;
  splashes = 0;
  /** Set while another system owns the player (busted sequence). */
  blocked: () => boolean = () => false;
  onRespawn?: () => void;
  private t = 0;
  private wet = new Map<number, number>();
  private lastDry: Vec2 | null = null;

  constructor(
    private world: World,
    private economy: Economy,
  ) {}

  get active(): boolean {
    return this.phase !== 'free';
  }

  update(dt: number): void {
    const w = this.world;
    for (const c of w.cars) {
      if (c.removed || c === w.player) continue;
      this.watchAi(c, dt);
    }
    const p = w.player;
    const s = p.phys.state;
    switch (this.phase) {
      case 'free':
        if (!s.airborne && s.water === 0) this.lastDry = { ...p.pos };
        if (s.water > 0.4 && !w.controlLocked && !this.blocked()) {
          this.phase = 'sinking';
          this.t = 0;
          w.controlLocked = true;
          this.splash(p);
          w.events.message('Splash! Calling a tow truck...', 'warn');
        }
        break;
      case 'sinking':
        this.t += dt;
        if (this.t > SINK_TIME) this.phase = 'fadeOut';
        break;
      case 'fadeOut':
        this.fade = Math.min(1, this.fade + dt * 2);
        if (this.fade >= 1) {
          this.respawn(p);
          this.phase = 'fadeIn';
        }
        break;
      case 'fadeIn':
        this.fade = Math.max(0, this.fade - dt * 1.5);
        if (this.fade <= 0) {
          this.phase = 'free';
          w.controlLocked = false;
        }
        break;
    }
  }

  /** Abort a tow in progress (quit to title); leaves the controls to the caller. */
  cancel(): void {
    this.phase = 'free';
    this.fade = 0;
  }

  private watchAi(c: Car, dt: number): void {
    const water = c.phys.state.water;
    if (water < 0.4) {
      this.wet.delete(c.id);
      return;
    }
    const t = this.wet.get(c.id);
    if (t === undefined) {
      this.splash(c);
      if (c.kind === 'police' && c.siren) this.world.events.message('A cop car went into the water!', 'good');
    }
    const nt = (t ?? 0) + dt;
    this.wet.set(c.id, nt);
    if (nt > 4) {
      c.removed = true;
      this.wet.delete(c.id);
    }
  }

  private splash(c: Car): void {
    this.splashes++;
    const water = this.world.city.terrain.waterAt(c.pos.x, c.pos.z) ?? c.y;
    this.world.events.emit({ type: 'splash', car: c.id, pos: { ...c.pos }, y: water });
  }

  private respawn(p: Car): void {
    const w = this.world;
    const near = this.lastDry ?? p.pos;
    const clear = (q: Vec2) => w.cars.every((c) => c.removed || c === p || dist(c.pos, q) > CLEAR);
    let spot = w.city.nearestLanePoint(near);
    for (let r = 8; r <= 64 && !clear(spot.pos); r += 8) {
      for (let a = 0; a < 8; a++) {
        const hit = w.city.nearestLanePoint({ x: near.x + Math.cos((a * Math.PI) / 4) * r, z: near.z + Math.sin((a * Math.PI) / 4) * r });
        if (clear(hit.pos) && !w.city.terrain.waterAt(hit.pos.x, hit.pos.z)) {
          spot = hit;
          break;
        }
      }
    }
    p.teleport(spot.pos, yawOf(spot.lane.dir));
    addDamage(p, 0.1);
    const fee = this.economy.charge(TOW_FEE);
    if (fee > 0) w.events.message(`Towed out of the water: -${formatCash(fee)}`, 'bad');
    this.onRespawn?.();
  }
}
