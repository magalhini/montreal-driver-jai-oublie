import * as THREE from 'three';
import { clamp } from '../core/math';
import type { World } from '../core/World';
import type { AABB, CrashKind, DistrictType, Interior, ViewSystem } from '../types';
import type { CityModel } from '../world/RoadGraph';
import { Ambience, type Surroundings } from './Ambience';
import { DistantEvents } from './DistantEvents';
import { EngineAudio, type Listener } from './EngineAudio';
import { GarageAudio } from './GarageAudio';
import { Mixer } from './Mixer';
import { Music } from './Music';
import { Rain } from './Rain';
import { SampleBank } from './Samples';
import { Sfx, type P3 } from './Sfx';
import { Sirens } from './Sirens';
import { TrafficHorns } from './TrafficHorns';

/** What the audio reads from the rest of the game each frame (wired in main.ts). */
export interface AudioHooks {
  world: World;
  city: CityModel;
  camera: THREE.Camera;
  /** Camera in the driver's seat. */
  cabin(): boolean;
  rain(): number;
  wetness(): number;
  /** The sim is stopped by a menu, the map or the debug panel (not the title screen). */
  paused(): boolean;
  title(): boolean;
  timeScale(): number;
  /** Seconds into the pit garage scene (the cutscene, then the menu), or null. */
  garage(): number | null;
  /** Screen fade to black 0..1 (busts, tows, wrecks). */
  fade(): number;
  hornHeld(): boolean;
  pursuit(): boolean;
  peds: readonly { pos: { x: number; z: number }; active: boolean }[];
  vents: readonly { pos: { x: number; z: number }; y: number }[];
  /** Roofs over drivable / walkable ground (canopies, interiors): rain drums, the sky is muffled. */
  roofs: AABB[];
}

/** Reverb of the open street by district: tall downtown canyons ring, the harbor is open. */
const STREET: Record<DistrictType, number> = { downtown: 0.6, shotengai: 0.5, harbor: 0.35, residential: 0.35, depot: 0.4 };
const ROOM: Record<Interior['kind'], number> = { passage: 0.8, nook: 0.85 };

const inBox = (b: AABB, x: number, z: number, m = 0) => x >= b.minX - m && x <= b.maxX + m && z >= b.minZ - m && z <= b.maxZ + m;

/**
 * T34 audio: owns the WebAudio graph and drives every layer from the game state once per frame (a
 * ViewSystem, so it runs while the sim is paused too). Ears = the camera; vehicles, sirens and horns in
 * `EngineAudio` / `Sirens` / `TrafficHorns`, the city around in `Ambience` / `DistantEvents`, the title pad
 * in `Music`, one-shots in `Sfx`. Volumes in `mixer.settings` (pause / title menu, AUDIO).
 */
export class AudioSystem implements ViewSystem {
  readonly mixer = new Mixer();
  readonly sfx = new Sfx(this.mixer);
  readonly engines: EngineAudio;
  private readonly sirens: Sirens;
  private readonly horns: TrafficHorns;
  private readonly ambience: Ambience;
  private readonly distant: DistantEvents;
  private readonly music: Music;
  /** The pit garage's crew and room: the shop menu sends it events. */
  readonly garage: GarageAudio;
  readonly samples: SampleBank;
  readonly rain: Rain;
  private readonly ls: Listener = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, cabin: false };
  private readonly fwdV = new THREE.Vector3();
  private readonly upV = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private placeT = 0;
  private place: Omit<Surroundings, 'pos' | 'cabin' | 'rain' | 'wetness'> = { covered: false, district: null, peds: 0, canal: null, vent: null };
  private room = 0;
  private impactKind: CrashKind | null = null;
  private impactAt = -1;
  private lastT = performance.now();

  constructor(private readonly h: AudioHooks) {
    const { mixer: mx, sfx } = this;
    const w = h.world;
    this.engines = new EngineAudio(mx, sfx, w);
    this.sirens = new Sirens(mx, w, this.engines);
    this.horns = new TrafficHorns(mx, sfx, w);
    this.samples = new SampleBank(mx);
    this.ambience = new Ambience(mx, sfx, this.samples);
    this.distant = new DistantEvents(mx, sfx);
    this.music = new Music(mx);
    this.garage = new GarageAudio(mx, this.samples);
    this.rain = new Rain(mx, this.samples);
    this.listen();
  }

  private listen(): void {
    const { world: w } = this.h;
    const ev = w.events;
    const mx = this.mixer;
    const at = (x: number, z: number, carId: number | null): P3 => {
      const c = carId !== null ? w.carById(carId) : undefined;
      return { x, y: (c ? c.y : 0) + 0.6, z };
    };
    ev.on('impact', (e) => {
      this.impactKind = e.kind;
      this.impactAt = mx.now;
    });
    ev.on('collision', (e) => {
      if (Math.hypot(e.pos.x - this.ls.pos.x, e.pos.z - this.ls.pos.z) > 150) return;
      const player = e.a === w.player.id || e.b === w.player.id;
      const k = clamp((e.impulse - 600) / (player ? 16000 : 20000), 0.04, 1);
      const recent = this.impactKind && mx.now - this.impactAt < 0.05;
      const kind = e.b !== null ? 'car' : recent && this.impactKind === 'prop' ? 'prop' : 'wall';
      this.sfx.crash({ pos: at(e.pos.x, e.pos.z, e.a), bus: mx.effects, cat: 'crashes', ref: player ? 6 : 5, wet: 0.5 }, k, kind);
    });
    ev.on('propBroken', (e) => {
      if (e.struck) return; // the collision handler already played the crash
      if (Math.hypot(e.pos.x - this.ls.pos.x, e.pos.z - this.ls.pos.z) > 150) return;
      const player = e.car === w.player.id;
      this.sfx.crash({ pos: at(e.pos.x, e.pos.z, e.car), bus: mx.effects, cat: 'crashes', ref: player ? 6 : 5, wet: 0.5 }, 0.18, 'prop');
    });
    ev.on('wrecked', () => {
      const p = w.player;
      const spot = { pos: { x: p.pos.x, y: p.y + 0.6, z: p.pos.z }, bus: mx.effects, cat: 'crashes' as const, ref: 8, wet: 0.8 };
      this.sfx.crash(spot, 1, 'car');
      this.sfx.thump(spot, 1);
    });
    ev.on('brokeDown', () => {
      const p = w.player;
      const spot = { pos: { x: p.pos.x, y: p.y + 0.4, z: p.pos.z }, bus: mx.effects, cat: 'crashes' as const, ref: 7, wet: 0.6 };
      this.sfx.crash(spot, 0.45, 'prop');
      this.sfx.thump(spot, 0.9);
    });
    ev.on('splash', (e) => this.sfx.splash({ pos: { x: e.pos.x, y: e.y, z: e.pos.z }, bus: mx.effects, cat: 'crashes', ref: 6, wet: 0.5 }, e.car === w.player.id ? 1 : 0.75));
    ev.on('pursuitStarted', () => this.sfx.radio(0.5));
    ev.on('escaped', () => this.sfx.radio(0.35));
    ev.on('busted', () => this.sfx.radio(0.45));
  }

  /** Menu feedback. */
  ui(kind: 'move' | 'ok' | 'back'): void {
    if (kind === 'move') this.sfx.tick(1320, 0.05);
    else if (kind === 'ok') this.sfx.chime([988, 1480], 0.05, 0.05);
    else this.sfx.tick(660, 0.06);
  }

  sync(_alpha: number, frameDt: number): void {
    const h = this.h;
    const mx = this.mixer;
    const now = performance.now();
    const realDt = clamp((now - this.lastT) / 1000, 1 / 240, 0.1);
    this.lastT = now;
    if (mx.ctx.state !== 'running') return;
    const dt = Math.max(frameDt, 1 / 240);
    this.updateListener(realDt);
    const paused = h.paused();
    const title = h.title();
    const garage = h.garage();
    // Inside the pit garage: the city is behind a door
    const indoors = garage !== null;
    const cabin = h.cabin() && !indoors;
    this.ls.cabin = cabin;
    // Where we are (cheap enough at 4 Hz)
    this.placeT -= realDt;
    if (this.placeT <= 0) {
      this.placeT = 0.25;
      this.locate();
    }
    const rain = h.rain();
    const s: Surroundings = { ...this.place, pos: this.ls.pos, cabin, rain, wetness: h.wetness() };
    if (indoors) {
      s.covered = true;
      s.peds = 0;
    }
    // Acoustic space and muffling
    const street = STREET[s.district ?? 'residential'] * (cabin ? 0.35 : 1) * (1 - 0.6 * this.room);
    const room = this.room * (cabin ? 0.3 : 1);
    const p = h.world.player;
    const underwater = p.phys.state.water > 0.9 && !title;
    const slow = h.timeScale();
    let muffle = cabin ? 1500 : 20000;
    let cabinHz = cabin ? 5200 : 20000;
    let duck = 1 - 0.75 * h.fade();
    if (slow < 0.9) muffle = Math.min(muffle, 2600);
    if (underwater) {
      muffle = 420;
      cabinHz = 420;
    }
    if (indoors) {
      muffle = 800;
      duck *= 0.6;
    }
    if (paused && !title) {
      muffle = 650;
      cabinHz = 650;
      duck *= 0.5;
    }
    mx.setSpace(street, room, muffle, duck, cabinHz);
    mx.setPaused(paused && !title);
    // Layers
    if (!paused || title) {
      this.engines.wet = h.wetness();
      this.engines.pitch = clamp(0.35 + 0.65 * slow, 0.35, 1);
      this.engines.horn = h.hornHeld() && !h.world.controlLocked;
      this.engines.update(this.ls, dt);
      this.sirens.update(this.ls, dt, this.engines.pitch);
      this.horns.update(this.ls, dt);
    }
    this.ambience.update(s, realDt);
    this.rain.update(rain, s.covered, cabin, paused && !title, realDt);
    this.distant.pursuit = h.pursuit();
    this.distant.indoors = indoors;
    if (!paused) this.distant.update(s, realDt);
    this.music.update(title);
    this.garage.update(garage);
  }

  private updateListener(dt: number): void {
    const cam = this.h.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.camPos);
    cam.getWorldDirection(this.fwdV);
    this.upV.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const ls = this.ls;
    const vx = (this.camPos.x - ls.pos.x) / dt;
    const vy = (this.camPos.y - ls.pos.y) / dt;
    const vz = (this.camPos.z - ls.pos.z) / dt;
    // Camera cuts and teleports are not motion
    const jump = Math.hypot(vx, vy, vz) > 90;
    const k = 0.25;
    ls.vel.x = jump ? 0 : ls.vel.x + (vx - ls.vel.x) * k;
    ls.vel.y = jump ? 0 : ls.vel.y + (vy - ls.vel.y) * k;
    ls.vel.z = jump ? 0 : ls.vel.z + (vz - ls.vel.z) * k;
    ls.pos.x = this.camPos.x;
    ls.pos.y = this.camPos.y;
    ls.pos.z = this.camPos.z;
    const l = this.mixer.ctx.listener;
    const t = this.mixer.now;
    const f = this.fwdV;
    const u = this.upV;
    if (l.positionX) {
      const tc = jump ? 0.001 : 0.015;
      l.positionX.setTargetAtTime(ls.pos.x, t, tc);
      l.positionY.setTargetAtTime(ls.pos.y, t, tc);
      l.positionZ.setTargetAtTime(ls.pos.z, t, tc);
      l.forwardX.setTargetAtTime(f.x, t, tc);
      l.forwardY.setTargetAtTime(f.y, t, tc);
      l.forwardZ.setTargetAtTime(f.z, t, tc);
      l.upX.setTargetAtTime(u.x, t, tc);
      l.upY.setTargetAtTime(u.y, t, tc);
      l.upZ.setTargetAtTime(u.z, t, tc);
    } else {
      l.setPosition(ls.pos.x, ls.pos.y, ls.pos.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  /** Surroundings of the listener: district, roofs and rooms, busy sidewalks, nearby landmarks. */
  private locate(): void {
    const { city, roofs, peds, vents } = this.h;
    const { x, y, z } = this.ls.pos;
    const f = city.features;
    const pl = this.place;
    pl.district = this.districtNear(x, z);
    let room = 0;
    const indoor = f.interiors.find((i) => inBox(i.box, x, z) && y < i.floor + i.height);
    if (indoor) room = ROOM[indoor.kind];
    else if (f.alleys.some((a) => inBox(a.box, x, z))) room = 0.5;
    pl.covered = !!indoor || (y < 14 && roofs.some((r) => inBox(r, x, z)));
    if (pl.covered && room === 0) room = 0.3;
    this.room = room;
    let n = 0;
    for (const p of peds) if (p.active && Math.abs(p.pos.x - x) < 35 && Math.abs(p.pos.z - z) < 35) n++;
    pl.peds = y < 30 ? n : 0;
    const k = f.canal;
    pl.canal = k && Math.abs(z - k.zc) < 60 && x > k.x0 - 20 && x < k.x1 + 20 ? { x: clamp(x, k.x0, k.x1), y: k.water + 0.3, z: clamp(z, k.z0, k.z1) } : null;
    pl.vent = null;
    let best = 15;
    for (const v of vents) {
      const d = Math.hypot(v.pos.x - x, v.pos.z - z);
      if (d < best) {
        best = d;
        pl.vent = { x: v.pos.x, y: v.y + 0.3, z: v.pos.z };
      }
    }
  }

  private districtNear(x: number, z: number): DistrictType | null {
    const city = this.h.city;
    for (const [dx, dz] of [
      [0, 0],
      [22, 0],
      [-22, 0],
      [0, 22],
      [0, -22],
      [30, 30],
      [-30, -30],
    ]) {
      const b = city.blockAt({ x: x + dx, z: z + dz });
      if (b) return b.district;
    }
    return null;
  }
}
