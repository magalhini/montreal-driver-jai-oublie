/** Voice of one engine type (`audio/EngineProfiles.ts`). */
export interface EngineProfile {
  cyl: number;
  /** Firing points in the 720 deg cycle as fractions 0..1 (one per cylinder); evenly spaced if omitted. */
  fire?: number[];
  /** Fixed level spread between cylinders (manifold, tune) and cycle-to-cycle randomness, 0..1. */
  spread: number;
  jitter: number;
  /** Exhaust pulse width (ms): narrow = raspy, wide = soft. */
  pulse: number;
  /** Exhaust pipe delay (ms) and feedback (negative = open-ended pipe, odd harmonics). */
  pipe: number;
  fb: number;
  /** Muffler / body resonances: [Hz, Q, gain]. */
  body: [number, number, number][];
  /** Muffler lowpass at idle and at full load / revs (Hz). */
  tone: [number, number];
  /** Intake roar level and its band center at idle / redline (Hz). */
  intake: number;
  intakeHz: [number, number];
  /** Valve train ticks (petrol) or combustion knock (diesel). */
  mech: number;
  diesel?: boolean;
  /** Firing-frequency sine under the pulses (body at idle). */
  rumble: number;
  /** Saturation amount. */
  drive: number;
  /** Output normalization (measured offline so all engines sit at the same loudness). */
  level: number;
}

/** Control values for one 128-sample block (k-rate). */
export interface EngineParams {
  rpm: number;
  /** rpm / redline. */
  rev: number;
  throttle: number;
  /** How hard the engine works (throttle against the drivetrain); low on overrun and in neutral. */
  load: number;
  /** Doppler / slow motion pitch factor. */
  pitch: number;
  /** Overrun pops and crackles 0..1. */
  crackle: number;
  /** Starter motor 0..1. */
  starter: number;
  /** Damage: misfires and rattle 0..1. */
  rough: number;
  /** Rev limiter cutting the ignition (> 0.5). */
  cut: number;
}

/**
 * Synthesized combustion engine, one sample at a time (runs in the AudioWorklet, `audio/worklet.ts`).
 * Each cylinder fires an exhaust pressure pulse at its point in the 720 deg cycle, with per-cylinder level
 * differences and cycle-to-cycle randomness (what keeps it from sounding like an oscillator). The pulses go
 * down a resonant exhaust pipe (feedback delay line), through muffler body resonances and a lowpass that
 * opens with load, then soft saturation. Intake roar and valve-train ticks follow the pulses; overrun can
 * pop, the rev limiter drops pulses, the starter motor whines along with the cranking revs.
 *
 * Self-contained on purpose: the worklet source is built from `EngineDSP.toString()`, so the class must not
 * reference anything outside its own body (no imports, no module-level helpers).
 */
export class EngineDSP {
  sr: number;
  p: EngineProfile;
  phase = 0;
  fireIdx = 0;
  fireAt = new Float64Array(16);
  base = new Float64Array(16);
  gainOf = new Float64Array(16);
  pulseU = 1;
  pulseInc = 0;
  pulseAmp = 0;
  env = 0;
  tick = 0;
  pop = 0;
  popAmp = 0;
  rpmS = 0;
  revS = 0;
  loadS = 0;
  thrS = 0;
  pipeBuf = new Float32Array(2048);
  pipeW = 0;
  pipeD = 100;
  pipeLp = 0;
  body: Float64Array[] = [];
  lp1 = new Float64Array(7);
  lp2 = new Float64Array(7);
  intakeBp = new Float64Array(7);
  mechBp = new Float64Array(7);
  starterBp = new Float64Array(7);
  dcX = 0;
  dcY = 0;
  rumbleP = 0;
  starterP = 0;
  seed = 22222;
  coefT = 0;
  envK: number;
  tickK: number;
  popK: number;
  smoothK: number;

  constructor(sr: number, profile: EngineProfile, seed = 1) {
    this.sr = sr;
    this.p = profile;
    this.seed = (seed * 2654435761) >>> 0 || 1;
    this.envK = Math.exp(-1 / (0.008 * sr));
    this.tickK = Math.exp(-1 / (0.0007 * sr));
    this.popK = Math.exp(-1 / (0.014 * sr));
    this.smoothK = 1 - Math.exp(-1 / (0.012 * sr));
    this.setProfile(profile);
  }

  setProfile(p: EngineProfile): void {
    this.p = p;
    const n = Math.min(16, p.cyl);
    for (let k = 0; k < n; k++) {
      this.base[k] = p.fire ? p.fire[k] : k / n;
      this.gainOf[k] = 1 - p.spread * this.rand();
    }
    this.tickK = Math.exp(-1 / ((p.diesel ? 0.0022 : 0.0007) * this.sr));
    this.pipeD = Math.max(1, Math.min(2000, Math.round((p.pipe / 1000) * this.sr)));
    this.body = p.body.map(() => new Float64Array(7));
    this.newCycle();
    this.coefs(0);
  }

  rand(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  /** Biquad coefficients into `f` (b0 b1 b2 a1 a2, then two state slots). */
  design(f: Float64Array, kind: 'lp' | 'bp', hz: number, q: number): void {
    const w = (2 * Math.PI * Math.min(hz, this.sr * 0.45)) / this.sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    if (kind === 'lp') {
      f[0] = (1 - cs) / 2 / a0;
      f[1] = (1 - cs) / a0;
      f[2] = f[0];
    } else {
      f[0] = al / a0;
      f[1] = 0;
      f[2] = -al / a0;
    }
    f[3] = (-2 * cs) / a0;
    f[4] = (1 - al) / a0;
  }

  /** Transposed direct form II biquad step. */
  bq(f: Float64Array, x: number): number {
    const y = f[0] * x + f[5];
    f[5] = f[1] * x - f[3] * y + f[6];
    f[6] = f[2] * x - f[4] * y;
    return y;
  }

  newCycle(): void {
    const p = this.p;
    const n = Math.min(16, p.cyl);
    const j = (0.06 * p.jitter) / n;
    for (let k = 0; k < n; k++) this.fireAt[k] = Math.min(0.995, Math.max(0, this.base[k] + (this.rand() - 0.5) * j));
  }

  /** Filters that follow the revs and load (every 64 samples). */
  coefs(revs: number): void {
    const p = this.p;
    const open = Math.min(1, this.loadS * 0.75 + revs * 0.45);
    const cut = p.tone[0] + (p.tone[1] - p.tone[0]) * open;
    this.design(this.lp1, 'lp', cut, 0.6);
    this.design(this.lp2, 'lp', cut * 1.4, 0.7);
    for (let i = 0; i < p.body.length; i++) this.design(this.body[i], 'bp', p.body[i][0], p.body[i][1]);
    this.design(this.intakeBp, 'bp', p.intakeHz[0] + (p.intakeHz[1] - p.intakeHz[0]) * revs, 1.8);
    this.design(this.mechBp, 'bp', p.diesel ? 2300 : 5200, p.diesel ? 2.5 : 1.2);
    this.design(this.starterBp, 'bp', 1100, 3);
  }

  fire(k: number, prm: EngineParams, ff: number): void {
    if (prm.cut > 0.5 && this.rand() < 0.65) return;
    if (prm.rough > 0 && this.rand() < prm.rough * 0.16) {
      if (this.rand() < 0.4) {
        this.pop = 1;
        this.popAmp = 0.5 * prm.rough;
      }
      return;
    }
    const p = this.p;
    const amp = this.gainOf[k] * (0.22 + 0.78 * this.loadS) * (1 + (this.rand() - 0.5) * 2 * p.jitter * 0.5);
    this.pulseAmp = amp;
    this.pulseU = 0;
    const w = Math.min(p.pulse / 1000, 0.85 / Math.max(1, ff));
    this.pulseInc = 1 / (w * this.sr);
    if (amp > this.env) this.env = amp;
    this.tick = 1;
    if (prm.crackle > 0 && this.rand() < prm.crackle * 0.22) {
      this.pop = 1;
      this.popAmp = 0.4 + this.rand() * 0.9;
    }
  }

  process(out: Float32Array, prm: EngineParams): void {
    const p = this.p;
    const sr = this.sr;
    const n = Math.min(16, p.cyl);
    const sk = this.smoothK;
    const nb = this.body.length;
    for (let i = 0; i < out.length; i++) {
      this.rpmS += (prm.rpm - this.rpmS) * sk;
      this.revS += (prm.rev - this.revS) * sk;
      this.loadS += (prm.load - this.loadS) * sk;
      this.thrS += (prm.throttle - this.thrS) * sk;
      if (--this.coefT <= 0) {
        this.coefT = 64;
        this.coefs(this.revS);
      }
      const rps = (this.rpmS / 60) * prm.pitch;
      const ff = (rps * n) / 2;
      this.phase += rps / 2 / sr;
      if (this.phase >= 1) {
        this.phase -= 1;
        // a cylinder left over from the last cycle (jitter near the wrap) fires now
        while (this.fireIdx < n) this.fire(this.fireIdx++, prm, ff);
        this.fireIdx = 0;
        this.newCycle();
      }
      while (this.fireIdx < n && this.phase >= this.fireAt[this.fireIdx]) this.fire(this.fireIdx++, prm, ff);

      // Exhaust pulse (fast rise, slower fall) + backfire pops
      let x = 0;
      if (this.pulseU < 1) {
        const u = this.pulseU;
        x = this.pulseAmp * Math.sin(Math.PI * u) * (1 - 0.55 * u);
        this.pulseU += this.pulseInc;
      }
      if (this.pop > 0.001) {
        x += (this.rand() * 2 - 1) * this.popAmp * this.pop;
        this.pop *= this.popK;
      }
      // Resonant pipe
      const rd = (this.pipeW - this.pipeD + 2048) & 2047;
      this.pipeLp += (this.pipeBuf[rd] - this.pipeLp) * 0.55;
      const y = x + p.fb * this.pipeLp;
      this.pipeBuf[this.pipeW] = y;
      this.pipeW = (this.pipeW + 1) & 2047;
      // Muffler body
      let m = y * 0.55;
      for (let b = 0; b < nb; b++) m += this.bq(this.body[b], y) * p.body[b][2];
      m = this.bq(this.lp2, this.bq(this.lp1, m));
      // Firing-frequency body
      this.rumbleP += ff / sr;
      if (this.rumbleP > 1) this.rumbleP -= 1;
      m += p.rumble * Math.sin(2 * Math.PI * this.rumbleP) * (0.35 + 0.65 * this.loadS) * Math.min(1, this.rpmS / 400);
      // Intake roar and mechanical ticks follow the pulses
      const nz = this.rand() * 2 - 1;
      m += this.bq(this.intakeBp, nz) * this.env * (0.12 + this.thrS) * p.intake * (0.25 + this.revS);
      m += this.bq(this.mechBp, this.rand() * 2 - 1) * this.tick * p.mech * (0.35 + 0.65 * this.revS);
      this.env *= this.envK;
      this.tick *= this.tickK;
      // Starter motor: a whine that wobbles with the cranking revs, plus brush noise
      if (prm.starter > 0.001) {
        this.starterP += (this.rpmS * 0.85 + 60) / sr;
        if (this.starterP > 1) this.starterP -= 1;
        const s = Math.tanh(3 * Math.sin(2 * Math.PI * this.starterP));
        m += prm.starter * (0.11 * s + 0.35 * this.bq(this.starterBp, nz));
      }
      // Saturation, DC block
      const d = p.drive * (0.7 + 0.6 * this.loadS);
      const s = Math.tanh(m * d) / Math.tanh(d);
      this.dcY = s - this.dcX + 0.996 * this.dcY;
      this.dcX = s;
      out[i] = this.dcY * p.level;
    }
  }
}
