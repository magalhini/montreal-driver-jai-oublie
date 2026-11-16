import { dot, fwd, leftOf } from '../core/math';
import type { World } from '../core/World';
import type { AABB, SimSystem, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import type { Closures } from './Closures';

/**
 * Montreal's orange cones (PRD 5.3): the tall striped drums on a rubber base, as light props. Pure sim: a flat
 * list of positions and velocities. A car that touches one shoves it away from the contact; it slides with a
 * lot of friction and stops, and a hard hit knocks it flat. They never damage a car and never respawn, so a
 * street you have already bullied looks bullied. Drawn by `world/ConeView.ts`.
 */
export const CONE_TUNING = {
  /** Contact radius (m): the rubber base. */
  radius: 0.34,
  /** Sliding friction (m/s^2) and drag (per second) once shoved. */
  friction: 6,
  drag: 0.8,
  /** Cone speed as a share of the car's closing speed (a light thing bounces off a heavy one), and sideways scatter. */
  kick: 1.6,
  scatter: 0.3,
  /** Knocked flat when hit faster than this (m/s). */
  topple: 3.2,
  /** Share of its speed a car loses per cone it hits (a thump, not a wall). */
  carDrag: 0.006,
};

export interface Cone {
  pos: Vec2;
  vel: Vec2;
  /** Spin about the vertical (rad) and its rate. */
  yaw: number;
  spin: number;
  /** Lying on its side, the base pointing along `lieYaw`. */
  down: boolean;
  lieYaw: number;
  /** Cone line id (`Closures.lines`), or -1 for a loose cone. */
  line: number;
  /** World time of the last contact (one knock sound per contact, not per step). */
  touched: number;
}

const CELL = 8;
const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
const cellOf = (p: Vec2): number => key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));

export class Cones implements SimSystem {
  readonly cones: Cone[] = [];
  /** Indices of cones that moved this step (the view re-poses only these). */
  readonly moved = new Set<number>();
  /** Set by `Chantier`: the player's car touched cone i. */
  onPlayerHit: (i: number) => void = () => {};
  private readonly cells = new Map<number, number[]>();
  private readonly cellAt: number[] = [];
  private readonly active = new Set<number>();
  private readonly tmp: AABB[] = [];

  constructor(
    private readonly world: World,
    closures: Closures,
  ) {
    for (const l of closures.lines) for (const p of l.cones) this.add(p, l.id);
    // Loose cones that would stand in a lamp post, a tree or a bench are left out
    for (const p of closures.loose) if (!this.solid(p.x, p.z)) this.add(p, -1);
    // The lane merges' tapers: part of the work, but no line (going through them is not an offense)
    for (const m of closures.merges) for (const p of m.cones) this.add(p, -1);
  }

  private add(p: Vec2, line: number): void {
    const h = Math.sin(this.cones.length * 91.7 + 3.1) * 43758.5453;
    const i = this.cones.length;
    this.cones.push({ pos: { ...p }, vel: { x: 0, z: 0 }, yaw: (h - Math.floor(h)) * Math.PI * 2, spin: 0, down: false, lieYaw: 0, line, touched: -99 });
    this.cellAt.push(cellOf(p));
    this.file(i, this.cellAt[i]);
  }

  private file(i: number, k: number): void {
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = []));
    list.push(i);
  }

  update(dt: number): void {
    this.moved.clear();
    for (const car of this.world.cars) if (!car.removed && !car.ghost && car.kind !== 'parked') this.contacts(car);
    for (const i of this.active) this.slide(i, dt);
  }

  /** Cones under a car get pushed out of its box and sent off with its point velocity. */
  private contacts(car: Car): void {
    const T = CONE_TUNING;
    const s = car.phys.state;
    const reach = car.halfL + T.radius;
    const i0 = Math.floor((s.pos.x - reach) / CELL);
    const i1 = Math.floor((s.pos.x + reach) / CELL);
    const j0 = Math.floor((s.pos.z - reach) / CELL);
    const j1 = Math.floor((s.pos.z + reach) / CELL);
    const f = fwd(s.yaw);
    const l = leftOf(s.yaw);
    for (let j = j0; j <= j1; j++)
      for (let ii = i0; ii <= i1; ii++) {
        const list = this.cells.get(key(ii, j));
        if (!list) continue;
        for (const i of list) {
          const c = this.cones[i];
          const dx = c.pos.x - s.pos.x;
          const dz = c.pos.z - s.pos.z;
          const along = dx * f.x + dz * f.z;
          const side = dx * l.x + dz * l.z;
          const pa = car.halfL + T.radius - Math.abs(along);
          const ps = car.halfW + T.radius - Math.abs(side);
          if (pa <= 0 || ps <= 0) continue;
          // Out through the nearer face
          const n = pa < ps ? { x: f.x * Math.sign(along || 1), z: f.z * Math.sign(along || 1) } : { x: l.x * Math.sign(side || 1), z: l.z * Math.sign(side || 1) };
          const depth = Math.min(pa, ps);
          c.pos.x += n.x * depth;
          c.pos.z += n.z * depth;
          // The car's velocity at the contact point
          const rx = c.pos.x - s.pos.x;
          const rz = c.pos.z - s.pos.z;
          const vp = { x: s.vel.x + s.yawRate * rz, z: s.vel.z - s.yawRate * rx };
          const vn = dot(vp, n);
          const rel = vn - dot(c.vel, n);
          if (rel > 0.05) {
            const tx = vp.x - n.x * vn;
            const tz = vp.z - n.z * vn;
            const r = this.world.rng;
            const sc = T.scatter * vn * r.range(-1, 1);
            c.vel.x = n.x * vn * T.kick + tx * 0.35 + l.x * sc;
            c.vel.z = n.z * vn * T.kick + tz * 0.35 + l.z * sc;
            c.spin = r.range(-1, 1) * Math.min(12, vn * 2);
            if (!c.down && vn > T.topple) {
              c.down = true;
              c.lieYaw = Math.atan2(c.vel.x, c.vel.z) + r.range(-0.6, 0.6);
            }
            if (this.world.time - c.touched > 0.3) {
              s.vel.x *= 1 - T.carDrag;
              s.vel.z *= 1 - T.carDrag;
              if (vn > 1) this.world.events.emit({ type: 'coneHit', car: car.id, pos: { ...c.pos }, speed: vn * T.kick });
            }
          }
          if (car === this.world.player) this.onPlayerHit(i);
          c.touched = this.world.time;
          this.active.add(i);
          this.moved.add(i);
        }
      }
  }

  /** Slide with friction, stop against walls and posts. */
  private slide(i: number, dt: number): void {
    const T = CONE_TUNING;
    const c = this.cones[i];
    const v = Math.hypot(c.vel.x, c.vel.z);
    c.yaw += c.spin * dt;
    c.spin *= Math.max(0, 1 - 3 * dt);
    if (v < 0.05) {
      c.vel.x = c.vel.z = 0;
      if (Math.abs(c.spin) < 0.05) this.active.delete(i);
      this.moved.add(i);
      return;
    }
    const nv = Math.max(0, v - (T.friction + T.drag * v) * dt);
    c.vel.x *= nv / v;
    c.vel.z *= nv / v;
    const nx = c.pos.x + c.vel.x * dt;
    const nz = c.pos.z + c.vel.z * dt;
    if (this.solid(nx, nz)) {
      c.vel.x *= -0.3;
      c.vel.z *= -0.3;
    } else {
      c.pos.x = nx;
      c.pos.z = nz;
    }
    const k = cellOf(c.pos);
    if (k !== this.cellAt[i]) {
      const old = this.cells.get(this.cellAt[i])!;
      old.splice(old.indexOf(i), 1);
      this.cellAt[i] = k;
      this.file(i, k);
    }
    this.moved.add(i);
  }

  /** Is the cone's base inside a static box (a building, a fence, a lamp post)? */
  private solid(x: number, z: number): boolean {
    const r = CONE_TUNING.radius * 0.6;
    for (const b of this.world.statics.query(x - r, z - r, x + r, z + r, this.tmp)) {
      if (b.top !== undefined && b.top < 0.3) continue;
      const o = b.obb;
      if (!o) return true;
      // Rotated box: test in its frame (local +X = (cos, -sin), +Z = (sin, cos))
      const c = Math.cos(o.yaw);
      const sn = Math.sin(o.yaw);
      const lx = (x - o.cx) * c - (z - o.cz) * sn;
      const lz = (x - o.cx) * sn + (z - o.cz) * c;
      if (Math.abs(lx) < o.hx + r && Math.abs(lz) < o.hz + r) return true;
    }
    return false;
  }

  /** Cones knocked out of place (debug). */
  get scattered(): number {
    return this.cones.filter((c) => c.down || c.touched > -99).length;
  }
}
