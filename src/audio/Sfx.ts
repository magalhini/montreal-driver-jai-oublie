import type { Category, Mixer } from './Mixer';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Where a sound plays: a world position (panned, distance-attenuated, reverb sends) or straight into a bus. */
export interface Spot {
  pos?: P3 | null;
  bus: AudioNode;
  /** Volume slider it follows. */
  cat: Category;
  /** Distance where attenuation starts (m). */
  ref?: number;
  /** Reverb send. */
  wet?: number;
}

let curve: Float32Array<ArrayBuffer> | null = null;
/** Soft-clip curve for crunchy sounds. */
function crunchCurve(): Float32Array<ArrayBuffer> {
  if (curve) return curve;
  curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(x * 4) * 0.8;
  }
  return curve;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Procedural one-shots: crashes, landings, splashes, horn beeps, clicks, chimes, the police radio. Each call
 * builds a small throwaway graph that is disconnected once it has rung out.
 */
export class Sfx {
  constructor(private readonly mx: Mixer) {}

  /** Entry node for a one-shot at `spot`; everything is disconnected after `life` seconds. */
  entry(spot: Spot, life: number): GainNode {
    const mx = this.mx;
    const ctx = mx.ctx;
    // entry -> category level -> panner / bus (+ sends)
    const g = ctx.createGain();
    const lv = mx.catGain(spot.cat);
    g.connect(lv);
    const nodes: AudioNode[] = [g];
    if (spot.pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = spot.ref ?? 6;
      p.rolloffFactor = 1;
      p.positionX.value = spot.pos.x;
      p.positionY.value = spot.pos.y;
      p.positionZ.value = spot.pos.z;
      lv.connect(p);
      p.connect(spot.bus);
      nodes.push(p);
      if (spot.wet) {
        const s = mx.gain(mx.streetSend, spot.wet);
        const r = mx.gain(mx.roomSend, spot.wet);
        p.connect(s);
        p.connect(r);
        nodes.push(s, r);
      }
    } else {
      lv.connect(spot.bus);
      if (spot.wet) {
        const s = mx.gain(mx.streetSend, spot.wet);
        const r = mx.gain(mx.roomSend, spot.wet);
        lv.connect(s);
        lv.connect(r);
        nodes.push(s, r);
      }
    }
    setTimeout(() => {
      nodes.forEach((n) => n.disconnect());
      mx.release(lv, spot.cat);
    }, (life + 0.5) * 1000);
    return g;
  }

  private osc(type: OscillatorType, hz: number, to: AudioNode, t: number, dur: number): OscillatorNode {
    const o = this.mx.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    o.connect(to);
    o.start(t);
    o.stop(t + dur);
    return o;
  }

  private noise(kind: 'white' | 'pink' | 'brown', to: AudioNode, t: number, dur: number): AudioBufferSourceNode {
    const s = this.mx.ctx.createBufferSource();
    s.buffer = this.mx.noiseBuffer(kind);
    s.connect(to);
    s.start(t, Math.random() * 4);
    s.stop(t + dur);
    return s;
  }

  /** A gain with an attack-decay envelope. */
  private env(to: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.mx.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 4);
    g.connect(to);
    return g;
  }

  /**
   * Crash: a low thump, a crunch of crumpling metal (bursts of distorted noise), ringing panel partials and,
   * for hard hits, breaking glass. `k` 0..1 is the strength; `kind` colors it.
   */
  crash(spot: Spot, k: number, kind: 'car' | 'wall' | 'prop'): void {
    const mx = this.mx;
    const t = mx.now + 0.005;
    const out = this.entry(spot, 2.5);
    const kk = Math.min(1, Math.max(0.05, k));
    // Thump
    const th = this.env(out, t, 0.9 * kk + 0.1, 0.004, kind === 'wall' ? 0.45 : 0.3);
    const o = this.osc('sine', kind === 'wall' ? 95 : 120, th, t, 0.6);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.25);
    const thn = mx.filter('lowpass', 420, 0.7);
    thn.connect(this.env(out, t, 0.7 * kk, 0.002, 0.18));
    this.noise('brown', thn, t, 0.4);
    // Crunch: distorted noise in a band, gated into crumple bursts
    const shaper = mx.ctx.createWaveShaper();
    shaper.curve = crunchCurve();
    const bp = mx.filter('bandpass', kind === 'prop' ? 1100 : 1900, 0.8);
    const gate = mx.ctx.createGain();
    gate.gain.setValueAtTime(0, t);
    const bursts = Math.round(5 + kk * 16);
    const span = 0.08 + kk * 0.32;
    for (let i = 0; i < bursts; i++) {
      const at = t + (i === 0 ? 0 : Math.pow(Math.random(), 1.6) * span);
      gate.gain.setValueAtTime(rnd(0.4, 1) * (1 - (at - t) / (span + 0.1)), at);
      gate.gain.setTargetAtTime(0, at + 0.003, rnd(0.008, 0.03));
    }
    this.noise('white', bp, t, span + 0.4);
    bp.connect(shaper);
    shaper.connect(gate);
    const crunch = mx.gain(out, 0.55 * kk);
    gate.connect(crunch);
    // Ringing panels (inharmonic partials)
    if (kind !== 'prop') {
      const parts = kind === 'car' ? 6 : 3;
      for (let i = 0; i < parts; i++) {
        const hz = rnd(260, 3400);
        const g = this.env(out, t + rnd(0, 0.04), (0.07 * kk) / (1 + i * 0.25), 0.002, rnd(0.25, 0.9));
        this.osc(Math.random() < 0.3 ? 'triangle' : 'sine', hz, g, t, 1.2);
      }
    } else {
      // Plastic / wood / sign clatter: hollow knocks bouncing away
      for (let i = 0; i < 7; i++) {
        const at = t + 0.05 + i * rnd(0.05, 0.12) + i * i * 0.01;
        const f = mx.filter('bandpass', rnd(500, 1600), 6);
        f.connect(this.env(out, at, 0.5 * kk * (1 - i / 8), 0.001, 0.05));
        this.noise('white', f, at, 0.1);
      }
    }
    // Glass
    if (kk > 0.5 && kind !== 'prop') {
      const n = Math.round(10 + kk * 16);
      for (let i = 0; i < n; i++) {
        const at = t + 0.01 + Math.pow(Math.random(), 1.4) * 0.55;
        const g = this.env(out, at, rnd(0.015, 0.05) * kk, 0.001, rnd(0.03, 0.14));
        this.osc('sine', rnd(2800, 9000), g, at, 0.2);
      }
      const hp = mx.filter('highpass', 3800, 0.7);
      hp.connect(this.env(out, t + 0.01, 0.35 * kk, 0.002, 0.16));
      this.noise('white', hp, t, 0.3);
    }
  }

  /**
   * A wheel dropping into a pothole: a low boom, a rumble, and a short dull crash.
   * The crash sits above the road noise and below a car hit (that crunch is up around 2 kHz, with ringing panels
   * and glass). Nothing here rings above the burst.
   */
  pothole(spot: Spot, k: number): void {
    const mx = this.mx;
    const t = mx.now + 0.005;
    const out = this.entry(spot, 1.4);
    const kk = Math.min(1, Math.max(0.35, k));
    // Boom, then it falls into a rumble. A car hit starts higher, near 120 Hz.
    const body = this.osc('sine', rnd(78, 96), this.env(out, t, 0.62 + 0.3 * kk, 0.002, 0.28), t, 0.5);
    body.frequency.exponentialRampToValueAtTime(36, t + 0.2);
    const sub = this.osc('sine', rnd(42, 50), this.env(out, t, 0.22 + 0.16 * kk, 0.004, 0.5), t, 0.65);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.28);
    const rumble = mx.filter('lowpass', 260, 0.6);
    rumble.connect(this.env(out, t, 0.32 + 0.22 * kk, 0.003, 0.4));
    this.noise('brown', rumble, t, 0.45);
    // Short crash held above the road rumble, which reaches about 700 Hz at speed.
    // A car hit is a crunch around 2 kHz plus ringing panels and glass; this stays a blunt band.
    const bp = mx.filter('bandpass', 1050, 0.9);
    bp.connect(this.env(out, t, 2.2 + 0.5 * kk, 0.001, 0.09));
    this.noise('white', bp, t, 0.16);
    const body2 = mx.filter('bandpass', 460, 0.8);
    body2.connect(this.env(out, t, 0.4 + 0.15 * kk, 0.002, 0.12));
    this.noise('pink', body2, t, 0.2);
  }

  /** Landing or bottoming out: low thud and a suspension clank for big ones. */
  thump(spot: Spot, k: number): void {
    const mx = this.mx;
    const t = mx.now + 0.005;
    const out = this.entry(spot, 1.2);
    const o = this.osc('sine', 85, this.env(out, t, 0.25 + 0.6 * k, 0.003, 0.3), t, 0.5);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.2);
    const lp = mx.filter('lowpass', 600, 0.7);
    lp.connect(this.env(out, t, 0.4 * k, 0.002, 0.12));
    this.noise('brown', lp, t, 0.3);
    if (k > 0.45) {
      for (let i = 0; i < 3; i++) {
        const g = this.env(out, t + 0.02, 0.05 * k, 0.001, rnd(0.08, 0.2));
        this.osc('triangle', rnd(700, 2400), g, t, 0.4);
      }
    }
  }

  /** Something big hitting water, then bubbles. */
  splash(spot: Spot, k: number): void {
    const mx = this.mx;
    const t = mx.now + 0.005;
    const out = this.entry(spot, 2.5);
    const lp = mx.filter('lowpass', 4000, 0.8);
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(350, t + 0.9);
    lp.connect(this.env(out, t, 0.9 * k, 0.01, 0.9));
    this.noise('white', lp, t, 1.4);
    const lo = this.osc('sine', 70, this.env(out, t, 0.6 * k, 0.005, 0.35), t, 0.6);
    lo.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    for (let i = 0; i < 16; i++) {
      const at = t + rnd(0.15, 1.6);
      const g = this.env(out, at, rnd(0.02, 0.07) * k, 0.002, 0.04);
      const b = this.osc('sine', rnd(250, 600), g, at, 0.08);
      b.frequency.exponentialRampToValueAtTime(rnd(700, 1400), at + 0.05);
    }
  }

  /** Car horn: two detuned reed tones through a horn trumpet; `pattern` is [start, length] pairs (s). */
  horn(spot: Spot, freqs: number[], pattern: [number, number][], level: number): void {
    const mx = this.mx;
    const t = mx.now + 0.01;
    const end = Math.max(...pattern.map(([a, d]) => a + d));
    const out = this.entry(spot, end + 0.5);
    const g = mx.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (const [a, d] of pattern) {
      g.gain.setValueAtTime(0, t + a);
      g.gain.linearRampToValueAtTime(level, t + a + 0.012);
      g.gain.setValueAtTime(level, t + a + d);
      g.gain.linearRampToValueAtTime(0, t + a + d + 0.05);
    }
    this.hornTone(g, freqs, t, end + 0.2);
    g.connect(out);
  }

  /** Horn reeds (square + saw per note) through the trumpet band, feeding `into`; runs for `dur` s from `t`. */
  hornTone(into: AudioNode, freqs: number[], t: number, dur: number): BiquadFilterNode {
    const mx = this.mx;
    const bp = mx.filter('bandpass', 1500, 0.9);
    const lp = mx.filter('lowpass', 3200, 0.7);
    bp.connect(lp);
    lp.connect(into);
    for (const f of freqs) {
      this.osc('square', f, bp, t, dur);
      this.osc('sawtooth', f * 1.004, bp, t, dur);
    }
    return lp;
  }

  /** Relay click (turn signal tick / tock), key turn. */
  click(spot: Spot, hz: number, level: number): void {
    const mx = this.mx;
    const t = mx.now + 0.003;
    const out = this.entry(spot, 0.2);
    const bp = mx.filter('bandpass', hz * 1.6, 2);
    bp.connect(this.env(out, t, level, 0.0005, 0.012));
    this.noise('white', bp, t, 0.05);
    this.osc('sine', hz, this.env(out, t, level * 0.5, 0.0005, 0.02), t, 0.06);
  }

  /** Gear change: a dull clunk through the floor. */
  clunk(spot: Spot, level: number): void {
    const mx = this.mx;
    const t = mx.now + 0.003;
    const out = this.entry(spot, 0.3);
    const bp = mx.filter('bandpass', 420, 3);
    bp.connect(this.env(out, t, level, 0.001, 0.05));
    this.noise('white', bp, t, 0.1);
    this.osc('sine', 160, this.env(out, t, level * 0.6, 0.001, 0.05), t, 0.1);
  }

  /** Bell-like chime notes (rewards, deliveries): `notes` in Hz, `gap` s apart. */
  chime(notes: number[], gap: number, level: number): void {
    const t = this.mx.now + 0.01;
    const out = this.entry({ bus: this.mx.ui, cat: 'alerts', wet: 0.25 }, notes.length * gap + 2);
    notes.forEach((hz, i) => {
      const at = t + i * gap;
      for (const [mul, a, d] of [
        [1, 1, 1.2],
        [2.76, 0.35, 0.5],
        [5.4, 0.12, 0.25],
      ] as const) {
        this.osc('sine', hz * mul, this.env(out, at, level * a, 0.002, d), at, d * 1.5 + 0.1);
      }
    });
  }

  /** Low two-note buzz (failed job). */
  buzz(level: number): void {
    const mx = this.mx;
    const t = mx.now + 0.01;
    const out = this.entry({ bus: mx.ui, cat: 'alerts' }, 1);
    const lp = mx.filter('lowpass', 900, 0.7);
    lp.connect(out);
    this.osc('sawtooth', 196, this.env(lp, t, level, 0.01, 0.25), t, 0.3);
    this.osc('sawtooth', 147, this.env(lp, t + 0.22, level, 0.01, 0.4), t + 0.22, 0.5);
  }

  /** Police radio: a burst of squelch and the roger beep. */
  radio(level: number): void {
    const mx = this.mx;
    const t = mx.now + 0.01;
    const out = this.entry({ bus: mx.ui, cat: 'alerts' }, 1.2);
    const bp = mx.filter('bandpass', 1700, 1.4);
    const g = mx.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * 0.6, t + 0.01);
    g.gain.setValueAtTime(level * 0.6, t + 0.16);
    g.gain.linearRampToValueAtTime(0, t + 0.2);
    bp.connect(g);
    g.connect(out);
    this.noise('white', bp, t, 0.3);
    const beep = this.env(out, t + 0.24, level * 0.35, 0.004, 0.08);
    this.osc('sine', 1250, beep, t + 0.24, 0.1);
  }

  /** Menu tick. */
  tick(hz: number, level: number): void {
    const t = this.mx.now + 0.002;
    const out = this.entry({ bus: this.mx.ui, cat: 'alerts' }, 0.2);
    this.osc('triangle', hz, this.env(out, t, level, 0.002, 0.05), t, 0.1);
  }
}
