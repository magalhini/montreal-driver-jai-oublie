import { clamp } from '../core/math';
import type { Car } from '../vehicles/Car';
import { ENGINES, engineFor, type EngineId } from './EngineProfiles';
import type { Category, Mixer } from './Mixer';

/** What a car voice needs about the moment (from `EngineAudio`). */
export interface VoiceFrame {
  /** Road wetness 0..1. */
  wet: number;
  /** Doppler x slow-motion pitch. */
  pitch: number;
  /** Interpolated position of the car (sound origin). */
  x: number;
  y: number;
  z: number;
}

const param = (n: AudioWorkletNode, k: string) => n.parameters.get(k)!;

/**
 * Everything one car sounds like: the synthesized engine (worklet), tire squeal and scrub and rolling road
 * noise, all through one panner. The engine and the tire / road submix (`out`) follow their own volume
 * categories (the player's engine and tires have separate sliders; AI cars are all TRAFFIC). The player keeps one; AI cars near the listener borrow
 * one of a small pool (`EngineAudio`).
 */
export class CarVoice {
  readonly panner: PannerNode;
  /** Tire and road submix (at the tires category level); extra player layers (wind, scrape) join here. */
  readonly out: GainNode;
  /** Level of the whole voice (fades when a pooled voice changes cars). */
  readonly level: GainNode;
  carId: number | null = null;
  engineId: EngineId | null = null;
  private engine: AudioWorkletNode | null = null;
  private readonly engineGain: GainNode;
  private readonly squealGain: GainNode;
  private readonly squealBands: BiquadFilterNode[] = [];
  private readonly scrubGain: GainNode;
  private readonly roadGain: GainNode;
  private readonly roadLp: BiquadFilterNode;
  private readonly roarGain: GainNode;
  private prevThrottle = 0;
  private crackle = 0;
  private prevGear = 1;
  private squeal = 0;

  constructor(
    private readonly mx: Mixer,
    bus: AudioNode,
    opts: { ref: number; wet: number; hrtf?: boolean; engine: Category; tires: Category },
  ) {
    const ctx = mx.ctx;
    this.panner = ctx.createPanner();
    this.panner.panningModel = opts.hrtf ? 'HRTF' : 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = opts.ref;
    this.panner.rolloffFactor = 1.1;
    this.panner.connect(bus);
    if (opts.wet > 0) {
      this.panner.connect(mx.gain(mx.streetSend, opts.wet));
      this.panner.connect(mx.gain(mx.roomSend, opts.wet));
    }
    this.level = mx.gain(this.panner, 1);
    this.out = mx.gain(mx.catGain(opts.tires, this.level), 1);
    this.engineGain = mx.gain(mx.catGain(opts.engine, this.level), 0);
    // Tire squeal: noise through three narrow, wobbling bands (tonal but unstable, like rubber)
    this.squealGain = mx.gain(this.out, 0);
    const sqSrc = mx.noiseSource('white');
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 4 + Math.random() * 3;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 55; // cents
    wobble.connect(wobbleDepth);
    wobble.start();
    for (const [hz, q, g] of [
      [980, 14, 1],
      [1480, 18, 0.7],
      [2230, 12, 0.45],
    ]) {
      const f = mx.filter('bandpass', hz, q);
      wobbleDepth.connect(f.detune);
      sqSrc.connect(f);
      f.connect(mx.gain(this.squealGain, g * 9));
      this.squealBands.push(f);
    }
    // Scrub: broadband rubber roar of a locked or spinning wheel
    this.scrubGain = mx.gain(this.out, 0);
    const scrub = mx.filter('bandpass', 650, 0.6);
    mx.noiseSource('pink').connect(scrub);
    scrub.connect(this.scrubGain);
    // Rolling noise: low rumble that brightens with speed and a tire roar band
    this.roadGain = mx.gain(this.out, 0);
    this.roadLp = mx.filter('lowpass', 200, 0.6);
    mx.noiseSource('brown').connect(this.roadLp);
    this.roadLp.connect(this.roadGain);
    this.roarGain = mx.gain(this.out, 0);
    const roar = mx.filter('bandpass', 850, 1.1);
    mx.noiseSource('pink').connect(roar);
    roar.connect(this.roarGain);
  }

  /** Bind to a car (pooled voices switch cars; the engine voice is swapped if needed). */
  assign(car: Car | null): void {
    this.carId = car ? car.id : null;
    if (!car) {
      this.engineGain.gain.setTargetAtTime(0, this.mx.now, 0.05);
      return;
    }
    const id = engineFor(car.phys.spec.name, car.look.style);
    if (id !== this.engineId) this.setEngine(id, car.id);
    this.prevGear = car.phys.state.gear;
  }

  private setEngine(id: EngineId, seed: number): void {
    this.engineId = id;
    if (!this.mx.ready) return;
    if (this.engine) {
      this.engine.port.postMessage({ profile: ENGINES[id] });
      return;
    }
    this.engine = new AudioWorkletNode(this.mx.ctx, 'neon-engine', {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: { profile: ENGINES[id], seed },
    });
    this.engine.connect(this.engineGain);
  }

  setPosition(x: number, y: number, z: number): void {
    const t = this.mx.now;
    this.panner.positionX.setTargetAtTime(x, t, 0.02);
    this.panner.positionY.setTargetAtTime(y, t, 0.02);
    this.panner.positionZ.setTargetAtTime(z, t, 0.02);
  }

  /** Per-frame update from the car's state. Returns the squeal amount (0..1) for callers that want it. */
  update(car: Car, f: VoiceFrame, dt: number, engineLevel: number): number {
    const mx = this.mx;
    const t = mx.now;
    // The worklet may load after the voice was assigned; the player's car can be swapped (debug fleet)
    const id = engineFor(car.phys.spec.name, car.look.style);
    if (id !== this.engineId || (!this.engine && mx.ready)) this.setEngine(id, car.id);
    this.setPosition(f.x, f.y, f.z);
    const phys = car.phys;
    const s = phys.state;
    const sp = phys.spec;
    const speed = car.speed;
    const on = phys.engineOn;
    const thr = on ? car.input.throttle : 0;
    // Engine
    if (this.engine) {
      const e = this.engine;
      const rev = s.rpm / sp.redline;
      const free = s.airborne || s.gear === 0;
      let load = on ? Math.max(0.12 * clamp(1 - rev * 1.5, 0, 1), thr * (free ? 0.55 : 1)) : 0;
      if (phys.wheelspin) load = Math.max(load, thr);
      if (car.input.burnout && phys.wheelspin) load = Math.max(load, 0.9);
      // Lift-off at high revs (or a quick upshift under power): pops and crackles for a moment
      if (this.prevThrottle > 0.6 && thr < 0.15 && rev > 0.5) this.crackle = 1;
      if (s.gear > this.prevGear && this.prevThrottle > 0.7 && rev > 0.6) this.crackle = Math.max(this.crackle, 0.45);
      this.prevGear = s.gear;
      this.prevThrottle = thr;
      this.crackle = Math.max(0, this.crackle - dt * 0.9);
      param(e, 'rpm').setValueAtTime(s.rpm, t);
      param(e, 'rev').setValueAtTime(rev, t);
      param(e, 'throttle').setValueAtTime(thr, t);
      param(e, 'load').setValueAtTime(load, t);
      param(e, 'pitch').setValueAtTime(f.pitch, t);
      param(e, 'crackle').setValueAtTime(this.crackle * (thr < 0.15 ? 1 : 0), t);
      param(e, 'starter').setValueAtTime(phys.cranking ? 1 : 0, t);
      param(e, 'rough').setValueAtTime(clamp((s.damage - 0.4) / 0.6, 0, 1), t);
      param(e, 'cut').setValueAtTime(on && thr > 0.5 && s.rpm >= sp.redline * 0.985 ? 1 : 0, t);
      const alive = clamp(s.rpm / 250, 0, 1);
      this.engineGain.gain.setTargetAtTime(engineLevel * alive, t, 0.03);
    }
    // Tires
    const onGround = !s.airborne && s.water < 0.3;
    const sf = clamp((speed - 2) / 8, 0, 1);
    let sq = 0;
    let scrub = 0;
    if (onGround) {
      sq += clamp((s.slipRear - 0.16) * 2.4, 0, 1) * sf;
      sq += clamp((s.slipFront - 0.26) * 2.2, 0, 1) * 0.75 * sf;
      if (phys.wheelspin) sq += 0.55 * clamp(speed / 6 + 0.4, 0, 1);
      if (car.input.burnout && phys.wheelspin) sq += 0.75;
      if (phys.rearLocked) scrub += 0.8 * sf;
      if (car.input.brake > 0.85 && s.gear >= 1 && speed > 14) sq += 0.3 * clamp((speed - 14) / 12, 0, 1);
      scrub += clamp((s.slipRear - 0.35) * 1.5, 0, 0.6) * sf;
    }
    const dryness = 1 - 0.75 * f.wet;
    sq = clamp(sq, 0, 1);
    // Squeal fades in a little slower than it starts (no clicks on tiny slips)
    this.squeal += (sq - this.squeal) * Math.min(1, dt * (sq > this.squeal ? 25 : 10));
    this.squealGain.gain.setTargetAtTime(this.squeal * this.squeal * 0.5 * dryness, t, 0.03);
    const shift = 0.92 + 0.22 * this.squeal + 0.04 * Math.sin(t * 2.3);
    this.squealBands.forEach((b, i) => b.frequency.setTargetAtTime([980, 1480, 2230][i] * shift, t, 0.05));
    this.scrubGain.gain.setTargetAtTime(clamp(scrub + sq * f.wet * 0.8, 0, 1) * 0.35, t, 0.04);
    // Rolling noise
    const roll = onGround ? clamp(speed / 30, 0, 1.5) : 0;
    this.roadGain.gain.setTargetAtTime(Math.pow(roll, 1.2) * 0.5, t, 0.06);
    this.roadLp.frequency.setTargetAtTime(140 + speed * 30, t, 0.1);
    this.roarGain.gain.setTargetAtTime(Math.pow(roll, 1.5) * 0.16, t, 0.06);
    return this.squeal;
  }

  /** Silence everything (voice parked, or the car is gone). */
  mute(): void {
    const t = this.mx.now;
    for (const g of [this.engineGain, this.squealGain, this.scrubGain, this.roadGain, this.roarGain]) g.gain.setTargetAtTime(0, t, 0.05);
  }
}
