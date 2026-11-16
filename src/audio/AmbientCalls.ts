import type { Mixer } from './Mixer';
import type { P3, Sfx } from './Sfx';

/** Scheduled little sounds of the ambience (T34, used by `Ambience`): bell crickets and fish plopping in the canal. */
export class AmbientCalls {
  private cricketAt = 0;

  constructor(
    private readonly mx: Mixer,
    private readonly sfx: Sfx,
    /** The insects' bus. */
    private readonly crickets: AudioNode,
  ) {}

  plop(p: P3): void {
    const mx = this.mx;
    const t = mx.now + 0.01;
    const out = this.sfx.entry({ pos: p, bus: mx.ambience, cat: 'life', ref: 6, wet: 0.5 }, 0.5);
    const o = mx.ctx.createOscillator();
    const f = 300 + Math.random() * 300;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 2.5, t + 0.06);
    const g = mx.gain(out, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.01, 0.02);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** Suzumushi (bell crickets): bright trilled "riiin" calls from around the listener. */
  insects(t: number, level: number): void {
    if (level < 0.03 || t < this.cricketAt) return;
    this.cricketAt = t + 0.4 + Math.random() * 1.6 / level;
    const mx = this.mx;
    const at = t + 0.05;
    const sp = mx.ctx.createStereoPanner();
    sp.pan.value = Math.random() * 1.8 - 0.9;
    sp.connect(this.crickets);
    const o = mx.ctx.createOscillator();
    o.frequency.value = 4300 + Math.random() * 600;
    const am = mx.ctx.createGain();
    am.gain.value = 0;
    const len = 0.25 + Math.random() * 0.45;
    const pulses = Math.floor(len * 34);
    for (let i = 0; i < pulses; i++) {
      const p = at + i / 34;
      am.gain.setValueAtTime(0, p);
      am.gain.linearRampToValueAtTime(0.018 * level, p + 0.006);
      am.gain.linearRampToValueAtTime(0, p + 0.024);
    }
    o.connect(am);
    am.connect(sp);
    o.start(at);
    o.stop(at + len + 0.1);
    setTimeout(() => sp.disconnect(), (len + 0.5) * 1000);
  }
}
