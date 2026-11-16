import { clamp } from '../core/math';
import { Rng } from '../core/Rng';
import type { SimSystem } from '../types';

export const WEATHER_TUNING = {
  /** Dry spell length (s). */
  dryMin: 240,
  dryMax: 540,
  /** A rain spell is 2-4 segments of light or heavy rain, each this long (s); the last one is always light. */
  segMin: 40,
  segMax: 110,
  heavy: [0.8, 1] as [number, number],
  light: [0.22, 0.45] as [number, number],
  /** Rain intensity change per second (a downpour builds up / eases off over ~20 s). */
  fade: 0.05,
  /** Road wetness: soaks in ~15 s of heavy rain, dries in ~3 min once it stops. */
  soak: 0.07,
  dry: 0.0055,
  /** Tire grip multiplier on a fully wet road (1 = rain does not affect handling). */
  wetGrip: 0.88,
};

/**
 * Weather (pure sim): alternates dry spells with rain spells that move between heavy and light rain and
 * always taper off through light rain before stopping. Dry most of the time (about 60%). `rain` is the
 * current intensity 0..1 (eases toward the segment's target), `wetness` lags it (roads stay wet for a while
 * after the rain stops) and sets `grip`. Uses its own RNG so it doesn't shift other random sequences.
 */
export class Weather implements SimSystem {
  rain = 0;
  target = 0;
  wetness = 0;
  /** When off the current state holds (no new spells). */
  auto = true;
  private rng: Rng;
  private timer: number;
  private segmentsLeft = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.timer = this.rng.range(WEATHER_TUNING.dryMin, WEATHER_TUNING.dryMax) * 0.5;
  }

  /** Tire grip multiplier from road wetness. */
  get grip(): number {
    return 1 - (1 - WEATHER_TUNING.wetGrip) * this.wetness;
  }

  /** A rain spell is in progress (it may still be building up). */
  get raining(): boolean {
    return this.target > 0;
  }

  /** Debug toggle: starts a rain spell (heavy first) or ends the current one, without the slow fade. */
  set raining(on: boolean) {
    if (on === this.raining) return;
    if (on) this.startRain(true);
    else this.stopRain();
    this.rain = this.target;
  }

  /** Seconds until the next change of spell / segment. */
  get nextChange(): number {
    return Math.max(0, this.timer);
  }

  update(dt: number): void {
    const t = WEATHER_TUNING;
    if (this.auto && (this.timer -= dt) <= 0) {
      if (this.segmentsLeft > 0) this.nextSegment();
      else if (this.raining) this.stopRain();
      else this.startRain(false);
    }
    const step = t.fade * dt;
    this.rain = this.rain < this.target ? Math.min(this.target, this.rain + step) : Math.max(this.target, this.rain - step);
    const wetTarget = this.rain > 0.05 ? 1 : 0;
    this.wetness = clamp(this.wetness + (wetTarget ? t.soak * this.rain : -t.dry) * dt, 0, 1);
  }

  private startRain(heavyFirst: boolean): void {
    this.segmentsLeft = this.rng.int(2, 4);
    this.nextSegment(heavyFirst);
  }

  private nextSegment(heavy = this.rng.chance(0.5)): void {
    const t = WEATHER_TUNING;
    this.segmentsLeft--;
    const range = heavy && this.segmentsLeft > 0 ? t.heavy : t.light;
    this.target = this.rng.range(range[0], range[1]);
    this.timer = this.rng.range(t.segMin, t.segMax);
  }

  private stopRain(): void {
    this.segmentsLeft = 0;
    this.target = 0;
    this.timer = this.rng.range(WEATHER_TUNING.dryMin, WEATHER_TUNING.dryMax);
  }
}
