import type { SimSystem, ViewSystem } from '../types';
import { CONFIG } from '../config';

/** Fixed-timestep loop with interpolated rendering. */
export class Game {
  private sims: SimSystem[] = [];
  private views: ViewSystem[] = [];
  private frameHooks: ((dt: number) => void)[] = [];
  private acc = 0;
  private last = 0;
  /** Why the simulation is stopped ('menu', 'map', 'debug'...): it runs only while this is empty. */
  private pauses = new Set<string>();
  timeScale = 1;
  simTimeMs = 0;
  time = 0;

  constructor(private render: () => void) {}

  get paused(): boolean {
    return this.pauses.size > 0;
  }
  /** Debug panel checkbox: the 'debug' reason only. */
  set paused(on: boolean) {
    this.setPaused('debug', on);
  }

  /** Add or remove one pause reason; closing a menu never unpauses what something else paused. */
  setPaused(reason: string, on: boolean): void {
    if (on) this.pauses.add(reason);
    else this.pauses.delete(reason);
  }

  pausedBy(reason: string): boolean {
    return this.pauses.has(reason);
  }

  addSim(s: SimSystem): void {
    this.sims.push(s);
  }

  addView(v: ViewSystem): void {
    this.views.push(v);
  }

  /** Runs every render frame before simulation (input handling, UI). */
  onFrame(fn: (dt: number) => void): void {
    this.frameHooks.push(fn);
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      for (const f of this.frameHooks) f(dt);

      const step = CONFIG.STEP;
      if (!this.paused) {
        this.acc += dt * this.timeScale;
        const t0 = performance.now();
        let steps = 0;
        while (this.acc >= step && steps < 8) {
          for (const s of this.sims) s.update(step);
          this.acc -= step;
          this.time += step;
          steps++;
        }
        if (steps === 8) this.acc = 0;
        this.simTimeMs = performance.now() - t0;
      }
      const alpha = this.paused ? 1 : this.acc / step;
      for (const v of this.views) v.sync(alpha, this.paused ? 0 : dt);
      this.render();
    };
    requestAnimationFrame(loop);
  }
}
