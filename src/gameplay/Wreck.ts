import type { Heat } from '../ai/Heat';
import type { PoliceSystem } from '../ai/PoliceAI';
import { KMH } from '../config';
import { clamp, dist, dot, fwd, leftOf, yawOf } from '../core/math';
import type { World } from '../core/World';
import type { BodyStyle, CarDetail } from '../vehicles/Car';
import { repair } from '../vehicles/Damage';
import type { CrashKind, GameEvent, SimSystem, Vec2 } from '../types';
import { formatCash, type Economy } from './Economy';

type Impact = Extract<GameEvent, { type: 'impact' }>;

/** Above this, a head-on impact totals the car (IMPROVEMENTS #24). */
export const WRECK_SPEED = 130 * KMH;
/** Dollars to put a fresh car down nearby after the blast. */
export const WRECK_FEE = 400;
/** Sim runs at this scale during the shot, so the world and the debris crawl. */
const WRECK_SLOW = 0.34;
/** Sim seconds of the breakup. At `WRECK_SLOW` that is about five and a half real seconds. */
const BURST = 1.9;
const FADE = 0.3;
const FADE_IN = 0.55;
/** Nose within 42° of the contact normal still counts as head-on. */
const HEAD_ON = Math.cos((42 * Math.PI) / 180);

export interface HeadOnSample {
  speed: number;
  closing: number;
  /** 1 = nose square to the surface. */
  align: number;
  /** Contact forward of the center (m). */
  along: number;
  halfL: number;
}

/** Player speed above 130 km/h, nose into the hit, and a real closing speed — not a brush at speed. */
export function isHeadOnWreck(s: HeadOnSample): boolean {
  return s.speed > WRECK_SPEED && s.align >= HEAD_ON && s.along >= s.halfL * 0.15 && s.closing >= WRECK_SPEED * 0.7;
}

/** Frozen at the moment of the hit. The view breaks the car from this. */
export interface WreckShot {
  seq: number;
  pos: Vec2;
  y: number;
  yaw: number;
  pitch: number;
  roll: number;
  color: number;
  style: BodyStyle;
  detail?: CarDetail;
  speed: number;
  align: number;
  side: number;
  glance: number;
  kind: CrashKind;
  otherMass: number;
  /** 0 at 130 km/h, up to ~1.7 well past 200. */
  violence: number;
  at: Vec2;
  normal: Vec2;
}

/** Center-screen line: "148 km/h into a wall". */
export function wreckDetail(speed: number, kind: CrashKind, otherMass: number): string {
  const into = kind === 'wall' ? 'into a wall' : kind === 'prop' ? 'into a pole' : otherMass >= 2000 ? 'into a truck' : 'into a car';
  return `${Math.round(speed * 3.6)} km/h ${into}`;
}

type Phase = 'free' | 'burst' | 'fadeOut' | 'fadeIn';

/**
 * Where to set the player's car down again near `near`: the nearest lane point with no other car within 9 m
 * and no water, looking further out in rings of 8 m (up to 64 m); else the nearest lane point. Facing the lane.
 */
export function clearLaneSpot(w: World, near: Vec2): { pos: Vec2; yaw: number } {
  const p = w.player;
  const clear = (q: Vec2) => !w.city.terrain.waterAt(q.x, q.z) && w.cars.every((c) => c.removed || c === p || dist(c.pos, q) > 9);
  let spot = w.city.nearestLanePoint(near);
  for (let ring = 8; ring <= 64 && !clear(spot.pos); ring += 8) {
    for (let a = 0; a < 8; a++) {
      const hit = w.city.nearestLanePoint({
        x: near.x + Math.cos((a * Math.PI) / 4) * ring,
        z: near.z + Math.sin((a * Math.PI) / 4) * ring,
      });
      if (clear(hit.pos)) {
        spot = hit;
        break;
      }
    }
  }
  return { pos: spot.pos, yaw: yawOf(spot.lane.dir) };
}

/**
 * Head-on wreck (IMPROVEMENTS #24). Above 130 km/h into a wall, a car or a pole, the player locks, time
 * slows, and the view plays a breakup that depends on the angle, the speed and what was hit. The active
 * delivery ends. After the shot the car is repaired and set down on a clear lane nearby, for `WRECK_FEE`,
 * the felony meter goes back to zero and any pursuers go back to patrolling.
 */
export class Wreck implements SimSystem {
  phase: Phase = 'free';
  /** Sim seconds into the breakup (burst and the fade that follows). */
  animT = 0;
  /** Screen fade 0..1. */
  fade = 0;
  shot: WreckShot | null = null;
  /** Called after the car is moved (chase camera snap). */
  onRespawn: (() => void) | null = null;
  private fadeT = 0;
  private seq = 0;
  private pending: Impact | null = null;
  /** Debug button: play a shot even below the speed. */
  private forced = false;
  private demo = 0;
  private savedScale = 1;
  private anchor: Vec2 | null = null;
  private anchorY = 0;
  private anchorYaw = 0;

  constructor(
    private world: World,
    private economy: Economy,
    private heat: Heat,
    private police: PoliceSystem,
    private clock: { timeScale: number },
  ) {
    world.events.on('impact', (e) => {
      if (e.car !== world.player.id) return;
      if (!this.pending || e.closing > this.pending.closing) this.pending = e;
    });
  }

  /** Burst or the fade-out: the cinematic camera should be up. */
  get playing(): boolean {
    return this.phase === 'burst' || this.phase === 'fadeOut';
  }

  /** Another system owns the player (don't tow the explosion). */
  get active(): boolean {
    return this.phase !== 'free';
  }

  /** 1 at the hit, falling off — post bloom / aberration punch. */
  get fx(): number {
    return this.playing ? Math.exp(-this.animT * 0.85) : 0;
  }

  update(dt: number): void {
    const hit = this.pending;
    this.pending = null;
    if (this.phase === 'free') {
      if (hit) this.tryImpact(hit);
      if (this.phase === 'free') this.checkWall();
      this.forced = false;
      if (this.phase === 'free') return;
      dt = 0;
    }
    this.forced = false;
    const w = this.world;
    w.controlLocked = true;
    if (this.phase === 'fadeIn') {
      this.clock.timeScale = this.savedScale;
      this.fadeT += dt;
      this.fade = Math.max(0, 1 - this.fadeT / FADE_IN);
      if (this.fadeT >= FADE_IN) {
        this.phase = 'free';
        this.fade = 0;
        this.fadeT = 0;
        this.animT = 0;
        w.controlLocked = false;
      }
      return;
    }
    this.clock.timeScale = WRECK_SLOW;
    this.hold();
    this.animT += dt;
    if (this.phase === 'burst') {
      if (this.animT >= BURST) {
        this.phase = 'fadeOut';
        this.fadeT = 0;
      }
      return;
    }
    this.fadeT += dt;
    this.fade = Math.min(1, this.fadeT / FADE);
    if (this.fadeT >= FADE) this.finish();
  }

  /** Abort a shot (quit to title). Leaves the control lock to the caller. */
  cancel(): void {
    this.pending = null;
    this.forced = false;
    if (this.phase === 'free') return;
    this.phase = 'free';
    this.fade = 0;
    this.fadeT = 0;
    this.animT = 0;
    this.shot = null;
    this.release();
    this.clock.timeScale = this.savedScale;
  }

  /** Play one of a few staged hits from the car's current pose. Cycles wall / car / truck / pole. */
  debugBoom(): void {
    const w = this.world;
    if (this.phase !== 'free' || w.mode === 'menu' || w.controlLocked) return;
    const p = w.player;
    const f = fwd(p.yaw);
    const demos: { kind: CrashKind; side: number; align: number; kmh: number; mass: number; glance: number }[] = [
      { kind: 'wall', side: 0.12, align: 0.98, kmh: 148, mass: 0, glance: 1 },
      { kind: 'wall', side: -0.72, align: 0.8, kmh: 196, mass: 0, glance: -9 },
      { kind: 'vehicle', side: 0.4, align: 0.9, kmh: 162, mass: 1250, glance: 3 },
      { kind: 'vehicle', side: -0.25, align: 0.86, kmh: 178, mass: 3600, glance: -5 },
      { kind: 'prop', side: 0.58, align: 0.83, kmh: 154, mass: 0, glance: 7 },
    ];
    const d = demos[this.demo++ % demos.length]!;
    const speed = d.kmh * KMH;
    this.forced = true;
    this.pending = {
      type: 'impact',
      car: p.id,
      other: null,
      speed,
      closing: speed,
      align: d.align,
      side: d.side,
      along: p.halfL,
      glance: d.glance,
      normal: { x: -f.x, z: -f.z },
      pos: { x: p.pos.x + f.x * p.halfL, z: p.pos.z + f.z * p.halfL },
      kind: d.kind,
      otherMass: d.mass,
    };
  }

  private tryImpact(hit: Impact): void {
    const w = this.world;
    const p = w.player;
    if (!this.forced) {
      if (p.invulnerable || w.controlLocked || w.mode === 'menu') return;
      if (!isHeadOnWreck({ speed: hit.speed, closing: hit.closing, align: hit.align, along: hit.along, halfL: p.halfL })) return;
    }
    this.start(hit);
  }

  /** Quay walls and ramp backs never reach the collision hash; the physics already recorded the hit. */
  private checkWall(): void {
    const w = this.world;
    const p = w.player;
    if (p.invulnerable || w.controlLocked || w.mode === 'menu') return;
    const s = p.phys.state;
    if (s.wallHit <= WRECK_SPEED) return;
    const n = p.phys.wallNormal;
    const f = fwd(p.yaw);
    const align = -dot(f, n);
    const closing = s.wallHit * Math.max(0, align);
    if (!isHeadOnWreck({ speed: s.wallHit, closing, align, along: p.halfL, halfL: p.halfL })) return;
    const left = leftOf(p.yaw);
    const glance = (-n.x * left.x + -n.z * left.z) * s.wallHit;
    this.start({
      type: 'impact',
      car: p.id,
      other: null,
      speed: s.wallHit,
      closing,
      align,
      side: glance * 0.015,
      along: p.halfL,
      glance,
      normal: { x: n.x, z: n.z },
      pos: { x: p.pos.x + f.x * p.halfL, z: p.pos.z + f.z * p.halfL },
      kind: 'wall',
      otherMass: 0,
    });
  }

  private start(hit: Impact): void {
    const w = this.world;
    const p = w.player;
    if (this.phase !== 'free' || w.mode === 'menu') return;
    if (!this.forced && (w.controlLocked || p.invulnerable)) return;
    const s = p.phys.state;
    this.savedScale = this.clock.timeScale >= 0.2 ? this.clock.timeScale : 1;
    this.clock.timeScale = WRECK_SLOW;
    this.phase = 'burst';
    this.animT = 0;
    this.fade = 0;
    this.fadeT = 0;
    this.anchor = { x: p.pos.x, z: p.pos.z };
    this.anchorY = s.y;
    this.anchorYaw = s.yaw;
    p.concealed = true;
    p.ghost = true;
    p.blinker = null;
    s.damage = 1;
    w.controlLocked = true;
    const violence = clamp((hit.speed - WRECK_SPEED) / (50 * KMH), 0, 1.75);
    this.shot = {
      seq: ++this.seq,
      pos: { x: p.pos.x, z: p.pos.z },
      y: s.y,
      yaw: s.yaw,
      pitch: s.pitch,
      roll: s.roll,
      color: p.look.color,
      style: p.look.style,
      detail: p.look.detail,
      speed: hit.speed,
      align: hit.align,
      side: hit.side,
      glance: hit.glance,
      kind: hit.kind,
      otherMass: hit.otherMass,
      violence,
      at: { x: hit.pos.x, z: hit.pos.z },
      normal: { x: hit.normal.x, z: hit.normal.z },
    };
    this.forced = false;
    w.events.emit({ type: 'wrecked', speed: hit.speed, kind: hit.kind, otherMass: hit.otherMass });
  }

  private hold(): void {
    const p = this.world.player;
    const s = p.phys.state;
    const a = this.anchor;
    if (!a) return;
    s.vel.x = 0;
    s.vel.z = 0;
    s.yawRate = 0;
    s.vy = 0;
    s.speed = 0;
    s.rpm = p.phys.spec.idleRpm;
    s.pos.x = a.x;
    s.pos.z = a.z;
    s.y = this.anchorY;
    s.yaw = this.anchorYaw;
  }

  private finish(): void {
    this.respawn();
    this.phase = 'fadeIn';
    this.fadeT = 0;
    this.fade = 1;
    this.shot = null;
    this.clock.timeScale = this.savedScale;
  }

  private respawn(): void {
    const w = this.world;
    const p = w.player;
    this.release();
    repair(p);
    const spot = clearLaneSpot(w, this.anchor ?? p.pos);
    p.teleport(spot.pos, spot.yaw);
    this.heat.reset();
    this.police.callOff();
    const fee = this.economy.charge(WRECK_FEE);
    w.events.message(fee > 0 ? `Car rebuilt nearby: -${formatCash(fee)}` : 'Car rebuilt nearby', 'bad');
    this.onRespawn?.();
  }

  private release(): void {
    const p = this.world.player;
    p.concealed = false;
    p.ghost = false;
  }
}
