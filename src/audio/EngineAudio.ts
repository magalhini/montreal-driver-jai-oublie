import { clamp } from '../core/math';
import type { World } from '../core/World';
import type { Car } from '../vehicles/Car';
import { CarVoice, type VoiceFrame } from './CarVoice';
import type { Mixer } from './Mixer';
import type { P3, Sfx } from './Sfx';

/** Where the ears are this frame (`AudioSystem`). */
export interface Listener {
  pos: P3;
  vel: P3;
  /** Camera in the driver's seat. */
  cabin: boolean;
}

const POOL = 6;
/** AI cars are heard up to this far (m); a voice keeps its car a bit beyond (no churn at the edge). */
const HEAR = 75;
const KEEP = 90;
const SOUND_SPEED = 343;
/** Cooling ticks after switching off: how many and over how long (s). */
const TICKS = 22;
const TICK_SPAN = 40;

/**
 * Vehicle sounds (T34): the player's car (engine, tires, road, wind, scrapes, horn, turn signal relay,
 * gear clunks, landings, potholes, ignition and the cooling ticks after switching off), and a pool of voices lent
 * to the AI cars nearest the listener (engine with doppler, tires, road noise). Pursuing cops get priority.
 */
export class EngineAudio {
  readonly player: CarVoice;
  private readonly pool: CarVoice[] = [];
  private readonly doppler = new Map<CarVoice, number>();
  private readonly windGain: GainNode;
  private readonly windBp: BiquadFilterNode;
  private readonly scrapeGain: GainNode;
  private readonly hornGain: GainNode;
  private hornOn = false;
  private lastBlink = false;
  private lastGear = 1;
  private lastLandT = 99;
  private wasOn = true;
  private wasCranking = false;
  private ticksLeft = 0;
  private tickAt = 0;
  private offFor = 0;
  /** Slow motion (wreck cinematic) pitch-down, 1 = normal. */
  pitch = 1;
  /** Road wetness 0..1 (weather). */
  wet = 0;

  constructor(
    private readonly mx: Mixer,
    private readonly sfx: Sfx,
    private readonly world: World,
  ) {
    this.player = new CarVoice(mx, mx.cabinTone, { ref: 7, wet: 0.22, engine: 'engine', tires: 'tires' });
    for (let i = 0; i < POOL; i++) {
      const v = new CarVoice(mx, mx.effects, { ref: 5, wet: 0.4, engine: 'traffic', tires: 'traffic' });
      v.level.gain.value = 0;
      this.pool.push(v);
    }
    // Wind over the body: rises with the square of speed
    this.windGain = mx.gain(this.player.out, 0);
    this.windBp = mx.filter('bandpass', 400, 0.5);
    mx.noiseSource('pink').connect(this.windBp);
    this.windBp.connect(this.windGain);
    // Scraping along a wall or another car: gritty metal on concrete
    this.scrapeGain = mx.gain(this.player.out, 0);
    const shaper = mx.ctx.createWaveShaper();
    const c = new Float32Array(256);
    for (let i = 0; i < 256; i++) c[i] = Math.tanh(((i / 255) * 2 - 1) * 5);
    shaper.curve = c;
    const sbp = mx.filter('bandpass', 2600, 1.8);
    const slo = mx.filter('bandpass', 380, 1.2);
    mx.noiseSource('white').connect(sbp);
    mx.noiseSource('brown').connect(slo);
    sbp.connect(shaper);
    shaper.connect(mx.gain(this.scrapeGain, 0.25));
    slo.connect(mx.gain(this.scrapeGain, 1.2));
    // Horn: held, so it's a running voice behind a gate
    this.hornGain = mx.gain(mx.catGain('horns', this.player.level), 0);
    sfx.hornTone(this.hornGain, [410, 512], mx.now, 1e7);
  }

  /** Horn button state (from frame input). */
  set horn(on: boolean) {
    this.hornOn = on;
  }

  update(ls: Listener, dt: number): void {
    const w = this.world;
    const p = w.player;
    const t = this.mx.now;
    if (this.player.carId !== p.id) this.player.assign(p);
    const frame = this.frame(p, 1);
    this.player.update(p, frame, dt, p.concealed ? 0 : 1);
    this.playerExtras(p, ls, dt, t);
    this.updatePool(ls, dt);
  }

  private frame(car: Car, pitch: number): VoiceFrame {
    return { wet: this.wet, pitch: pitch * this.pitch, x: car.pos.x, y: car.y + 0.5, z: car.pos.z };
  }

  private playerExtras(p: Car, ls: Listener, dt: number, t: number): void {
    const s = p.phys.state;
    const speed = p.speed;
    const spot = { pos: { x: p.pos.x, y: p.y + 0.6, z: p.pos.z }, bus: this.mx.cabinTone, cat: 'engine' as const, ref: 7 };
    // Wind
    const v = clamp(speed / 50, 0, 1.4);
    this.windGain.gain.setTargetAtTime(v * v * (s.airborne ? 0.55 : 0.32) * (ls.cabin ? 0.6 : 1), t, 0.1);
    this.windBp.frequency.setTargetAtTime(250 + speed * 22, t, 0.2);
    // Scrape
    const scraping = p.touch < 0.08 && speed > 1.2 && !p.ghost;
    this.scrapeGain.gain.setTargetAtTime(scraping ? clamp(speed / 14, 0.2, 1) * 0.5 : 0, t, scraping ? 0.02 : 0.06);
    // Horn
    this.hornGain.gain.setTargetAtTime(this.hornOn ? 0.4 : 0, t, 0.008);
    // Turn signal relay: tick on, tock off (loud in the cabin, faint outside)
    const lit = p.blinkLit;
    if (lit !== this.lastBlink) this.sfx.click(spot, lit ? 2100 : 1500, ls.cabin ? 0.22 : 0.05);
    this.lastBlink = lit;
    // Gear change
    if (s.gear !== this.lastGear && p.phys.engineOn && speed > 1) this.sfx.clunk(spot, ls.cabin ? 0.12 : 0.05);
    this.lastGear = s.gear;
    // Landing from the air, or a wheel dropping into a pothole (a low rumble, not a car crash)
    if (s.landT < this.lastLandT && s.landImpact > 1.5) {
      const hit = { ...spot, cat: 'crashes' as const, wet: 0.2 };
      if (s.landPit) {
        // A city-speed pit lands near 3 and caps at 8. Keep the quietest one already clear of the road noise.
        const k = clamp(0.55 + (s.landImpact - 1.5) / 6, 0.55, 1);
        this.sfx.pothole(hit, k);
      } else this.sfx.thump(hit, clamp(s.landImpact / 9, 0.15, 1));
    }
    this.lastLandT = s.landT;
    // Ignition: key click on the starter and on switching off, then the exhaust ticks as it cools
    const on = p.phys.engineOn;
    const cranking = p.phys.cranking;
    if (cranking && !this.wasCranking) this.sfx.click(spot, 1800, ls.cabin ? 0.16 : 0.04);
    if (!on && this.wasOn && !cranking) {
      this.sfx.click(spot, 1700, ls.cabin ? 0.14 : 0.04);
      this.ticksLeft = TICKS;
      this.offFor = 0;
      this.tickAt = 2.5;
    }
    this.wasCranking = cranking;
    this.wasOn = on;
    if (on) this.ticksLeft = 0;
    else if (this.ticksLeft > 0) {
      this.offFor += dt;
      if (this.offFor >= this.tickAt) {
        this.ticksLeft--;
        this.tickAt = this.offFor + (TICK_SPAN / TICKS) * (0.3 + Math.random() * 1.4) * (1 + (TICKS - this.ticksLeft) / TICKS);
        this.sfx.click({ ...spot, pos: { ...spot.pos, y: p.y + 0.2 } }, 2600 + Math.random() * 1800, (ls.cabin ? 0.05 : 0.07) * (0.5 + Math.random() * 0.5));
      }
    }
  }

  /** Hand the pool to the nearest AI cars (pursuing cops count as closer). */
  private updatePool(ls: Listener, dt: number): void {
    const w = this.world;
    const lx = ls.pos.x;
    const lz = ls.pos.z;
    const scored: { car: Car; d: number }[] = [];
    for (const c of w.cars) {
      if (c === w.player || c.removed || c.concealed || c.kind === 'parked' || !c.phys.engineOn) continue;
      const d = Math.hypot(c.pos.x - lx, c.pos.z - lz, c.y - ls.pos.y);
      if (d > KEEP) continue;
      scored.push({ car: c, d: d - (c.siren ? 25 : 0) });
    }
    scored.sort((a, b) => a.d - b.d);
    const want = new Map<number, Car>();
    for (const s of scored) {
      if (want.size >= POOL) break;
      if (s.d <= HEAR || this.pool.some((v) => v.carId === s.car.id)) want.set(s.car.id, s.car);
    }
    const t = this.mx.now;
    // Release voices whose car is no longer wanted
    for (const v of this.pool) {
      if (v.carId !== null && !want.has(v.carId)) {
        v.level.gain.setTargetAtTime(0, t, 0.08);
        v.carId = null;
      }
    }
    for (const car of want.values()) {
      let v = this.pool.find((x) => x.carId === car.id);
      if (!v) {
        v = this.pool.find((x) => x.carId === null);
        if (!v) continue;
        v.assign(car);
        v.level.gain.cancelScheduledValues(t);
        v.level.gain.setTargetAtTime(1, t + 0.03, 0.12);
        this.doppler.set(v, 1);
      }
      const f = this.dopplerOf(car, ls);
      const prev = this.doppler.get(v) ?? f;
      const d = prev + (f - prev) * Math.min(1, dt * 8);
      this.doppler.set(v, d);
      v.update(car, this.frame(car, d), dt, car.kind === 'police' ? 0.9 : 0.7);
    }
    for (const v of this.pool) if (v.carId === null) v.mute();
  }

  /** Doppler pitch factor of a car heard by the listener. */
  dopplerOf(car: Car, ls: Listener): number {
    const ux = ls.pos.x - car.pos.x;
    const uy = ls.pos.y - car.y;
    const uz = ls.pos.z - car.pos.z;
    const d = Math.hypot(ux, uy, uz) || 1;
    const vs = (car.vel.x * ux + car.vel.z * uz) / d;
    const vl = (ls.vel.x * ux + ls.vel.y * uy + ls.vel.z * uz) / d;
    return clamp((SOUND_SPEED - vl) / (SOUND_SPEED - vs), 0.7, 1.4);
  }
}
