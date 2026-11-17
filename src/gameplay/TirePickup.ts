import { dist, dot, fwd, leftOf, yawOf } from '../core/math';
import type { World } from '../core/World';
import type { SimSystem, Vec2 } from '../types';
import type { StorageStop } from './MissionRoute';

/** The storage stop and its cutscene. Playtest numbers live here. */
export const PICKUP_TUNING = {
  /** Count as stopped below this speed (m/s), for `settle` seconds, with the car's center in the circle. */
  stopSpeed: 1.2,
  settle: 0.8,
  /** The canopy-style line ("stop in the circle") shows once the car is this close (m). */
  hintAt: 45,
  /** Walking pace, empty-handed and with a winter tire in both arms (m/s). */
  walk: 2.3,
  carry: 1.8,
  /** Seconds inside the storage, the lift into the trunk, the push on the lid, and the pause in the seat. */
  inside: 1.1,
  load: 1.5,
  close: 0.6,
  seat: 0.55,
  /** Fade to black and back at either end of the scene (s, each way). */
  fade: 0.3,
  /** Lid travel (share of fully open per second). */
  lidRate: 2.2,
  /** The roll-up door rises when the driver is this close to it (m). */
  doorNear: 2.6,
};

export type DriverPose = 'walk' | 'stand' | 'load' | 'close';

/** The player, out of the car for the tires. Drawn by `TirePickupView`. */
export interface PickupDriver {
  pos: Vec2;
  prev: Vec2;
  yaw: number;
  pose: DriverPose;
  /** Seconds in the current pose. */
  t: number;
  /** Meters walked (leg cycle). */
  walked: number;
  /** A tire in the arms. */
  carrying: boolean;
  visible: boolean;
}

type Beat =
  | { kind: 'walk'; pts: Vec2[]; speed: number; start?: () => void }
  | { kind: 'hold'; dur: number; pose: DriverPose; face?: number; start?: () => void };

/**
 * The winter-tire storage on Ottawa (Phase 11): stop in the circle at the curb and the scene takes the car.
 * The trunk pops, the driver gets out, walks round the back and across the sidewalk to the roll-up door,
 * comes back with a winter tire, drops it in the trunk, shuts the lid and gets back in. Escape skips it.
 * A bust, a wreck or a tow mid-scene calls it off; the circle takes the car again the next time it stops.
 */
export class TirePickup implements SimSystem {
  /** The stop's circle wants the car (the drive is on and the tires are still in storage). */
  armed: () => boolean = () => false;
  /** Other sequences own the car (bust, tow, wreck). */
  blocked: () => boolean = () => false;
  /** The police are on the car: the storage will not open. */
  chased: () => boolean = () => false;
  /** The tire is in the trunk and the driver is back in the seat. */
  onLoaded: (() => void) | null = null;

  /** Share (0..1) of the stop in the circle, for the debug overlay. */
  progress = 0;
  /** The scene has the car. */
  playing = false;
  /** The cutscene camera owns the view (between the two fades). */
  cinematic = false;
  /** Black over the screen (0..1). */
  fade = 0;
  /** Trunk lid open (0..1) and the roll-up door up (0..1). */
  lid = 0;
  door = 0;
  /** Seconds since the scene started (camera drift). */
  sceneT = 0;
  readonly driver: PickupDriver = { pos: { x: 0, z: 0 }, prev: { x: 0, z: 0 }, yaw: 0, pose: 'stand', t: 0, walked: 0, carrying: false, visible: false };
  /** Where the car stood when the scene started, and which way it faced. The scene is laid out from these. */
  readonly car = { pos: { x: 0, z: 0 }, yaw: 0 };
  /** Lateral side of the car the sidewalk is on (+1 = its left). */
  side: 1 | -1 = -1;

  private beats: Beat[] = [];
  private beatT = 0;
  private lidTarget = 0;
  private ending = 0;
  private hinted = false;
  /** The stop counted once: drive out of the circle before it takes the car again. */
  private served = false;
  private inside = false;

  constructor(
    private readonly world: World,
    readonly stop: StorageStop,
  ) {}

  /** Quit, free roam, a fresh session. */
  reset(): void {
    if (this.playing) this.release(false);
    this.playing = false;
    this.cinematic = false;
    this.fade = 0;
    this.lid = 0;
    this.lidTarget = 0;
    this.door = 0;
    this.progress = 0;
    this.hinted = false;
    this.served = false;
    this.driver.visible = false;
    this.beats = [];
  }

  /** Escape during the scene: straight to the end, the tire in the trunk. */
  skip(): void {
    if (!this.playing || this.ending > 0) return;
    this.beats = [];
    this.driver.visible = false;
    this.driver.carrying = false;
    this.lidTarget = 0;
    this.lid = 0;
    this.inside = false;
    this.ending = 1e-6;
  }

  update(dt: number): void {
    if (this.playing) {
      this.play(dt);
      return;
    }
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt / PICKUP_TUNING.fade);
    this.door = Math.max(0, this.door - dt * 1.4);
    this.lid = Math.max(0, this.lid - dt * PICKUP_TUNING.lidRate);
    this.watch(dt);
  }

  private watch(dt: number): void {
    const w = this.world;
    const p = w.player;
    const s = this.stop;
    const d = dist(p.pos, s.pos);
    if (!this.armed() || w.mode !== 'free') {
      this.progress = 0;
      this.hinted = false;
      return;
    }
    if (d > PICKUP_TUNING.hintAt + 10) this.hinted = false;
    if (!this.hinted && d < PICKUP_TUNING.hintAt) {
      this.hinted = true;
      w.events.message('Tire storage: stop in the circle by the curb.', 'info');
    }
    if (d > s.r) this.served = false;
    const st = p.phys.state;
    if (this.served || d > s.r || Math.abs(st.speed) > PICKUP_TUNING.stopSpeed || st.airborne || w.controlLocked || this.blocked()) {
      this.progress = 0;
      return;
    }
    this.progress = Math.min(1, this.progress + dt / PICKUP_TUNING.settle);
    if (this.progress < 1) return;
    this.served = true;
    this.progress = 0;
    if (this.chased()) {
      w.events.message('Tire storage: "Not with the SPVM on your tail!"', 'warn');
      return;
    }
    this.begin();
  }

  private begin(): void {
    const w = this.world;
    const p = w.player;
    this.playing = true;
    this.cinematic = false;
    this.sceneT = 0;
    this.ending = 0;
    this.beatT = 0;
    this.inside = false;
    this.car.pos = { x: p.pos.x, z: p.pos.z };
    this.car.yaw = p.yaw;
    this.side = dot(this.stop.curb, leftOf(p.yaw)) >= 0 ? 1 : -1;
    w.controlLocked = true;
    w.events.message('Loading the winter tires. (Esc to skip)', 'info', 5);

    const hl = p.halfL;
    const hw = p.halfW;
    const at = (along: number, lat: number) => this.carPoint(along, lat);
    const seat = at(-0.25, hw + 0.45);
    const rearDriver = at(-(hl + 0.75), hw + 0.25);
    const rearCurb = at(-(hl + 0.75), this.side * (hw + 0.25));
    const trunk = at(-(hl + 0.5), 0);
    const door = this.stop.door;
    const c = this.stop.curb;
    // In front of the door, then a step back from it on the same line: the walk crosses the sidewalk square on
    const atDoor = { x: door.x - c.x * 0.45, z: door.z - c.z * 0.45 };
    const reach = (door.x - rearCurb.x) * c.x + (door.z - rearCurb.z) * c.z;
    const walkIn = { x: atDoor.x - c.x * Math.max(0, reach - 2.2), z: atDoor.z - c.z * Math.max(0, reach - 2.2) };
    const round = this.side === 1 ? [rearDriver] : [rearDriver, rearCurb];
    const d = this.driver;
    d.pos = { ...seat };
    d.prev = { ...seat };
    d.yaw = yawOf({ x: rearDriver.x - seat.x, z: rearDriver.z - seat.z });
    d.pose = 'stand';
    d.t = 0;
    d.walked = 0;
    d.carrying = false;
    d.visible = false;

    const T = PICKUP_TUNING;
    this.beats = [
      // Fade down, cut to the street, pop the trunk from the seat
      { kind: 'hold', dur: 2 * T.fade + 0.25, pose: 'stand', start: () => (d.visible = false) },
      { kind: 'walk', pts: [...round, walkIn, atDoor], speed: T.walk, start: () => (d.visible = true) },
      {
        kind: 'hold',
        dur: T.inside,
        pose: 'stand',
        start: () => {
          d.visible = false;
          this.inside = true;
        },
      },
      {
        kind: 'walk',
        pts: [walkIn, ...(this.side === 1 ? [] : [rearCurb]), trunk],
        speed: T.carry,
        start: () => {
          this.inside = false;
          d.visible = true;
          d.carrying = true;
        },
      },
      { kind: 'hold', dur: T.load, pose: 'load', face: this.car.yaw },
      {
        kind: 'hold',
        dur: T.close,
        pose: 'close',
        face: this.car.yaw,
        start: () => {
          d.carrying = false;
          this.lidTarget = 0;
        },
      },
      { kind: 'walk', pts: [rearDriver, seat], speed: T.walk },
      { kind: 'hold', dur: T.seat, pose: 'stand', start: () => (d.visible = false) },
    ];
    this.startBeat();
  }

  private play(dt: number): void {
    const T = PICKUP_TUNING;
    if (this.blocked() || this.world.mode !== 'free') {
      this.release(false);
      return;
    }
    this.world.controlLocked = true;
    this.sceneT += dt;
    const d = this.driver;
    d.prev.x = d.pos.x;
    d.prev.z = d.pos.z;
    d.t += dt;
    // Opening: fade down on the chase view, cut, fade up on the street; the lid pops in the dark
    if (this.sceneT < T.fade) this.fade = this.sceneT / T.fade;
    else {
      if (!this.cinematic && this.ending === 0) {
        this.cinematic = true;
        this.lidTarget = 1;
      }
      if (this.ending === 0) this.fade = Math.max(0, 1 - (this.sceneT - T.fade) / T.fade);
    }
    this.lid = this.lid < this.lidTarget ? Math.min(this.lidTarget, this.lid + dt * T.lidRate) : Math.max(this.lidTarget, this.lid - dt * T.lidRate * 1.6);
    const nearDoor = d.visible && dist(d.pos, this.stop.door) < T.doorNear;
    this.door = this.inside || nearDoor ? Math.min(1, this.door + dt * 1.8) : Math.max(0, this.door - dt * 1.4);

    if (this.ending > 0) {
      this.ending += dt;
      this.fade = Math.min(1, this.ending / T.fade);
      if (this.ending >= T.fade) this.release(true);
      return;
    }
    const beat = this.beats[0];
    if (!beat) {
      this.ending = 1e-6;
      return;
    }
    this.beatT += dt;
    if (beat.kind === 'walk') {
      if (this.walk(beat, dt)) this.nextBeat();
    } else if (this.beatT >= beat.dur) this.nextBeat();
    // Fade out over the last moments in the seat
    if (this.beats.length === 1 && this.beats[0].kind === 'hold' && this.beatT >= this.beats[0].dur - T.fade) this.ending = 1e-6;
  }

  private walk(beat: Extract<Beat, { kind: 'walk' }>, dt: number): boolean {
    const d = this.driver;
    let move = beat.speed * dt;
    while (move > 0 && beat.pts.length) {
      const target = beat.pts[0];
      const dx = target.x - d.pos.x;
      const dz = target.z - d.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) d.yaw = Math.atan2(dx, dz);
      if (len > move) {
        d.pos.x += (dx / len) * move;
        d.pos.z += (dz / len) * move;
        d.walked += move;
        return false;
      }
      d.pos.x = target.x;
      d.pos.z = target.z;
      d.walked += len;
      move -= len;
      beat.pts.shift();
    }
    return beat.pts.length === 0;
  }

  private nextBeat(): void {
    this.beats.shift();
    this.startBeat();
  }

  private startBeat(): void {
    this.beatT = 0;
    const b = this.beats[0];
    if (!b) return;
    const d = this.driver;
    d.t = 0;
    b.start?.();
    if (b.kind === 'walk') d.pose = 'walk';
    else {
      d.pose = b.pose;
      if (b.face !== undefined) d.yaw = b.face;
    }
  }

  /** End of the scene. `loaded`: the tire is in; the car goes back to the player. */
  private release(loaded: boolean): void {
    const w = this.world;
    this.playing = false;
    this.cinematic = false;
    this.beats = [];
    this.inside = false;
    this.ending = 0;
    this.lidTarget = 0;
    this.driver.visible = false;
    this.driver.carrying = false;
    if (!loaded) {
      // Whoever took the car owns the lock and the screen now
      this.fade = 0;
      this.lid = 0;
      return;
    }
    this.lid = 0;
    if (w.mode === 'free' && !this.blocked()) w.controlLocked = false;
    this.onLoaded?.();
  }

  private carPoint(along: number, lat: number): Vec2 {
    const f = fwd(this.car.yaw);
    const l = leftOf(this.car.yaw);
    return { x: this.car.pos.x + f.x * along + l.x * lat, z: this.car.pos.z + f.z * along + l.z * lat };
  }
}
