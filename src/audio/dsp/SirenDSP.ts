/** Control values for one block. */
export interface SirenParams {
  /** Doppler / slow motion pitch factor. */
  pitch: number;
  /** 0 = wail (the slow rise and fall), 1 = yelp. Switches at the bottom of a sweep. */
  mode: number;
}

/**
 * Electronic police siren through a horn speaker (runs in the AudioWorklet, `audio/worklet.ts`). The wail
 * rises over ~1.3 s, holds, and falls over ~1.9 s; the yelp sweeps fast. The tone is a driven sine (squarish,
 * like a siren amplifier) through a horn-speaker band with a little vibrato.
 *
 * Self-contained: the worklet source is built from `SirenDSP.toString()` (no outside references).
 */
export class SirenDSP {
  sr: number;
  t = 0;
  mode = 0;
  phase = 0;
  vib = 0;
  bp = new Float64Array(7);
  hp = new Float64Array(7);
  dcX = 0;
  dcY = 0;

  constructor(sr: number, offset = 0) {
    this.sr = sr;
    this.t = offset;
    this.design(this.bp, 'bp', 1350, 0.7);
    this.design(this.hp, 'hp', 380, 0.7);
  }

  design(f: Float64Array, kind: 'hp' | 'bp', hz: number, q: number): void {
    const w = (2 * Math.PI * hz) / this.sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    if (kind === 'hp') {
      f[0] = (1 + cs) / 2 / a0;
      f[1] = -(1 + cs) / a0;
      f[2] = f[0];
    } else {
      f[0] = al / a0;
      f[1] = 0;
      f[2] = -al / a0;
    }
    f[3] = (-2 * cs) / a0;
    f[4] = (1 - al) / a0;
  }

  bq(f: Float64Array, x: number): number {
    const y = f[0] * x + f[5];
    f[5] = f[1] * x - f[3] * y + f[6];
    f[6] = f[2] * x - f[4] * y;
    return y;
  }

  /** Sweep position 0..1 at cycle time `t` for the current mode. */
  sweep(): number {
    if (this.mode === 1) {
      const u = this.t / 0.34;
      return u < 0.55 ? Math.sin((u / 0.55) * Math.PI * 0.5) : 1 - (u - 0.55) / 0.45;
    }
    const t = this.t;
    if (t < 1.3) return Math.sin((t / 1.3) * Math.PI * 0.5);
    if (t < 1.55) return 1;
    const u = Math.min(1, (t - 1.55) / 1.9);
    return 1 - u * u * (3 - 2 * u);
  }

  process(out: Float32Array, prm: SirenParams): void {
    const sr = this.sr;
    const len = this.mode === 1 ? 0.34 : 3.45;
    for (let i = 0; i < out.length; i++) {
      this.t += 1 / sr;
      if (this.t >= len) {
        this.t -= len;
        this.mode = prm.mode > 0.5 ? 1 : 0;
      }
      const s = this.sweep();
      const lo = this.mode === 1 ? 640 : 560;
      const hi = this.mode === 1 ? 1480 : 1220;
      this.vib += 6.5 / sr;
      if (this.vib > 1) this.vib -= 1;
      const f = (lo + (hi - lo) * s) * (1 + 0.004 * Math.sin(2 * Math.PI * this.vib)) * prm.pitch;
      this.phase += f / sr;
      if (this.phase > 1) this.phase -= 1;
      const ph = 2 * Math.PI * this.phase;
      const tone = Math.tanh(2.6 * Math.sin(ph)) + 0.18 * Math.sin(2 * ph);
      let y = this.bq(this.hp, this.bq(this.bp, tone) * 1.6 + tone * 0.35);
      y = Math.tanh(y * 1.3);
      this.dcY = y - this.dcX + 0.995 * this.dcY;
      this.dcX = y;
      out[i] = this.dcY * 0.5;
    }
  }
}
