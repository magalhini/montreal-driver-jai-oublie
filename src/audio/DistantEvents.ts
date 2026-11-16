import type { EngineProfile } from './dsp/EngineDSP';
import type { Surroundings } from './Ambience';
import type { Mixer } from './Mixer';
import type { Sfx } from './Sfx';

/** A street-racing two-stroke (the bōsōzoku "call" heard across the city at night). */
const BIKE: EngineProfile = {
  cyl: 2,
  spread: 0.1,
  jitter: 0.35,
  pulse: 0.8,
  pipe: 2.2,
  fb: -0.6,
  body: [
    [200, 1.5, 0.5],
    [700, 2.5, 0.4],
    [2200, 3, 0.3],
  ],
  tone: [1500, 7000],
  intake: 0.8,
  intakeHz: [1500, 4000],
  mech: 0.1,
  rumble: 0.1,
  drive: 2.5,
  level: 0.4,
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The far-off city (T34): sounds that happen somewhere out of sight now and then. Sirens across town,
 * horns a few blocks away, a train passing on an elevated line, ships' horns and container clanks by the
 * harbor, a bike gang revving. (Thunder and after-rain drips were removed with the rain sounds, to come
 * back as recordings.)
 */
export class DistantEvents {
  private next = { siren: 40, honk: 6, train: 90, foghorn: 20, clank: 8, bike: 70 };
  private siren: { node: AudioWorkletNode; gain: GainNode; pan: StereoPannerNode } | null = null;
  private bike: { node: AudioWorkletNode; gain: GainNode; pan: StereoPannerNode } | null = null;
  private clock = 0;
  /** No far sirens while the police are actually after the player. */
  pursuit = false;
  /** Inside the café cutscene: only the weather gets through. */
  indoors = false;

  constructor(
    private readonly mx: Mixer,
    private readonly sfx: Sfx,
  ) {}

  update(s: Surroundings, dt: number): void {
    this.clock += dt;
    const c = this.clock;
    const n = this.next;
    const d = s.district ?? 'residential';
    const busy = d === 'downtown' || d === 'shotengai' || d === 'depot';
    if (c > n.siren) {
      n.siren = c + rnd(80, 200);
      if (!this.pursuit && !this.indoors) this.farSiren();
    }
    if (c > n.honk) {
      n.honk = c + (busy ? rnd(12, 30) : rnd(25, 60));
      if (!this.indoors) this.farHonk(s);
    }
    if (c > n.train) {
      n.train = c + rnd(150, 320);
      this.train();
    }
    if (d === 'harbor' && c > n.foghorn) {
      n.foghorn = c + rnd(45, 100);
      this.foghorn();
    }
    if (d === 'harbor' && c > n.clank) {
      n.clank = c + rnd(9, 25);
      if (!this.indoors) this.clank();
    }
    if (busy && c > n.bike) {
      n.bike = c + rnd(120, 260);
      if (!this.indoors) this.bikeCall();
    }
  }

  /** A panned, filtered path for a far sound: mostly reverb. */
  private far(pan: number, cutoff: number, wet: number, life: number): GainNode {
    const mx = this.mx;
    const sp = mx.ctx.createStereoPanner();
    sp.pan.value = pan;
    const lp = mx.filter('lowpass', cutoff, 0.6);
    lp.connect(sp);
    sp.connect(mx.ambience);
    const send = mx.gain(mx.streetSend, wet);
    lp.connect(send);
    const lv = mx.catGain('distant', lp);
    const g = mx.gain(lv, 1);
    setTimeout(() => {
      [sp, lp, send, g].forEach((x) => x.disconnect());
      mx.release(lv, 'distant');
    }, (life + 3) * 1000);
    return g;
  }

  private farSiren(): void {
    const mx = this.mx;
    if (!mx.ready) return;
    if (!this.siren) {
      const sp = mx.ctx.createStereoPanner();
      const lp = mx.filter('lowpass', 1300, 0.6);
      const gain = mx.gain(mx.catGain('distant', lp), 0);
      lp.connect(sp);
      sp.connect(mx.ambience);
      lp.connect(mx.gain(mx.streetSend, 1.4));
      const node = new AudioWorkletNode(mx.ctx, 'neon-siren', { numberOfInputs: 0, outputChannelCount: [1] });
      node.connect(gain);
      this.siren = { node, gain, pan: sp };
    }
    const t = mx.now;
    const { gain, pan, node } = this.siren;
    const from = rnd(-1, 1);
    pan.pan.cancelScheduledValues(t);
    pan.pan.setValueAtTime(from, t);
    pan.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, from + rnd(-0.6, 0.6))), t + 24);
    node.parameters.get('pitch')!.setValueAtTime(rnd(0.97, 1.03), t);
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 7);
    gain.gain.setValueAtTime(0.05, t + 13);
    gain.gain.linearRampToValueAtTime(0, t + 24);
  }

  private farHonk(s: Surroundings): void {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(60, 140);
    const pos = { x: s.pos.x + Math.cos(a) * r, y: 2, z: s.pos.z + Math.sin(a) * r };
    const pairs = [
      [392, 494],
      [350, 440],
      [620],
      [262, 330],
    ];
    const pattern: [number, number][] = Math.random() < 0.6 ? [[0, rnd(0.15, 0.5)]] : [[0, 0.15], [0.25, 0.2]];
    this.sfx.horn({ pos, bus: this.mx.ambience, cat: 'distant', ref: 8, wet: 1 }, pairs[Math.floor(Math.random() * pairs.length)], pattern, 0.3);
  }

  /** An elevated train crossing the edge of town: rumble swelling and fading with the rhythm of the bogies. */
  private train(): void {
    const mx = this.mx;
    const t = mx.now + 0.05;
    const len = rnd(14, 20);
    const out = this.far(0, 900, 0.8, len);
    out.gain.value = 0;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.5, t + len * 0.45);
    out.gain.linearRampToValueAtTime(0, t + len);
    const lp = mx.filter('lowpass', 260, 0.7);
    lp.connect(mx.gain(out, 0.9));
    const src = mx.ctx.createBufferSource();
    src.buffer = mx.noiseBuffer('brown');
    src.loop = true;
    src.connect(lp);
    src.start(t);
    src.stop(t + len);
    // Ta-tan ta-tan: wheel pairs over the rail joints
    const clack = mx.filter('bandpass', 900, 2);
    clack.connect(mx.gain(out, 1));
    const cn = mx.ctx.createBufferSource();
    cn.buffer = mx.noiseBuffer('white');
    cn.loop = true;
    const gate = mx.ctx.createGain();
    gate.gain.value = 0;
    cn.connect(gate);
    gate.connect(clack);
    cn.start(t);
    cn.stop(t + len);
    const car = 1.05;
    for (let at = 0.4; at < len - 0.4; at += car) {
      for (const off of [0, 0.13, car * 0.62, car * 0.62 + 0.13]) {
        gate.gain.setValueAtTime(0.5, t + at + off);
        gate.gain.setTargetAtTime(0, t + at + off + 0.004, 0.012);
      }
    }
  }

  /** A ship's horn out in the bay. */
  private foghorn(): void {
    const mx = this.mx;
    const t = mx.now + 0.05;
    const out = this.far(rnd(-0.8, 0.8), 500, 1.6, 6);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.18, t + 0.5);
    out.gain.setValueAtTime(0.18, t + 3);
    out.gain.linearRampToValueAtTime(0, t + 3.8);
    for (const hz of [73, 110, 146.5]) {
      const o = mx.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz * rnd(0.995, 1.005);
      o.connect(mx.gain(out, hz < 100 ? 1 : 0.5));
      o.start(t);
      o.stop(t + 4);
    }
  }

  /** A container being set down somewhere on the quay. */
  private clank(): void {
    const mx = this.mx;
    const t = mx.now + 0.05;
    const out = this.far(rnd(-0.9, 0.9), 1800, 1.2, 3);
    for (let i = 0; i < 5; i++) {
      const o = mx.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = rnd(110, 900);
      const g = mx.gain(out, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 / (1 + i * 0.4), t + 0.003);
      g.gain.setTargetAtTime(0, t + 0.004, rnd(0.2, 0.6));
      o.connect(g);
      o.start(t);
      o.stop(t + 2.5);
    }
  }

  /** Bike gang revving out a rhythm a few blocks away: "pa-pa-pa-paaan". */
  private bikeCall(): void {
    const mx = this.mx;
    if (!mx.ready) return;
    if (!this.bike) {
      const sp = mx.ctx.createStereoPanner();
      const lp = mx.filter('lowpass', 2200, 0.6);
      const gain = mx.gain(mx.catGain('distant', lp), 0);
      lp.connect(sp);
      sp.connect(mx.ambience);
      lp.connect(mx.gain(mx.streetSend, 1.1));
      const node = new AudioWorkletNode(mx.ctx, 'neon-engine', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { profile: BIKE, seed: 7 } });
      node.connect(gain);
      this.bike = { node, gain, pan: sp };
    }
    const t = mx.now + 0.1;
    const { node, gain, pan } = this.bike;
    const rpm = node.parameters.get('rpm')!;
    const load = node.parameters.get('load')!;
    const rev = node.parameters.get('rev')!;
    const thr = node.parameters.get('throttle')!;
    pan.pan.setValueAtTime(rnd(-0.9, 0.9), t);
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 1);
    const IDLE = 1600;
    rpm.cancelScheduledValues(t);
    rpm.setValueAtTime(IDLE, t);
    load.setValueAtTime(0.15, t);
    rev.setValueAtTime(0.15, t);
    // Blips: [start, length] (s) of the throttle; the last one long
    const rhythm = Math.random() < 0.5 ? [1.2, 1.55, 1.9, 2.25, 3.2, 3.55, 3.9] : [1.2, 1.5, 2.2, 2.5, 3.2, 3.5, 4.2];
    let end = 0;
    rhythm.forEach((at, i) => {
      const long = i === rhythm.length - 1;
      const hold = long ? 1.1 : 0.12;
      for (const p of [rpm, load, rev, thr]) p.setTargetAtTime(p === rpm ? 9500 : p === rev ? 0.95 : 1, t + at, 0.03);
      for (const p of [rpm, load, rev, thr]) p.setTargetAtTime(p === rpm ? IDLE : p === rev ? 0.15 : p === load ? 0.1 : 0, t + at + hold, p === rpm ? 0.08 : 0.02);
      end = at + hold;
    });
    gain.gain.setValueAtTime(0.1, t + end + 1);
    gain.gain.linearRampToValueAtTime(0, t + end + 3);
  }
}
