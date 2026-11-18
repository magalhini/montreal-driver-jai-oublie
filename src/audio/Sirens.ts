import { clamp } from '../core/math';
import type { World } from '../core/World';
import type { Car } from '../vehicles/Car';
import type { EngineAudio, Listener } from './EngineAudio';
import type { Mixer } from './Mixer';

const VOICES = 3;
/** Sirens carry: heard this far (m). */
const HEAR = 260;

interface SirenVoice {
  node: AudioWorkletNode | null;
  gain: GainNode;
  panner: PannerNode;
  carId: number | null;
  pitch: number;
  /** Seconds until the next wail / yelp decision. */
  modeT: number;
}

/**
 * Police sirens (T34): the cruisers with their light bar on borrow one of a few siren voices (HRTF panned,
 * so a cop behind you sounds behind you), with doppler. They wail; close in on the player they sometimes
 * switch to the yelp for a few seconds.
 */
export class Sirens {
  private readonly voices: SirenVoice[] = [];

  constructor(
    private readonly mx: Mixer,
    private readonly world: World,
    private readonly engines: EngineAudio,
  ) {
    for (let i = 0; i < VOICES; i++) {
      const panner = mx.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 14;
      panner.rolloffFactor = 1;
      panner.connect(mx.effects);
      panner.connect(mx.gain(mx.streetSend, 0.6));
      panner.connect(mx.gain(mx.roomSend, 0.3));
      const gain = mx.gain(mx.catGain('sirens', panner), 0);
      this.voices.push({ node: null, gain, panner, carId: null, pitch: 1, modeT: 0 });
    }
  }

  update(ls: Listener, dt: number, slow: number): void {
    const mx = this.mx;
    const t = mx.now;
    const w = this.world;
    const cops: { car: Car; d: number }[] = [];
    for (const c of w.cars) {
      if (!c.siren || c.removed || c.concealed) continue;
      const d = Math.hypot(c.pos.x - ls.pos.x, c.pos.z - ls.pos.z);
      if (d < HEAR) cops.push({ car: c, d });
    }
    cops.sort((a, b) => a.d - b.d);
    const want = new Set(cops.slice(0, VOICES).map((c) => c.car.id));
    for (const v of this.voices) {
      if (v.carId !== null && !want.has(v.carId)) {
        v.gain.gain.setTargetAtTime(0, t, 0.25);
        v.carId = null;
      }
    }
    for (const { car, d } of cops.slice(0, VOICES)) {
      let v = this.voices.find((x) => x.carId === car.id);
      if (!v) {
        v = this.voices.find((x) => x.carId === null);
        if (!v) continue;
        if (!v.node) v.node = this.makeNode(v);
        if (!v.node) continue;
        v.carId = car.id;
        v.pitch = 1;
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0.55, t, 0.15);
      }
      if (!v.node) continue;
      v.panner.positionX.setTargetAtTime(car.pos.x, t, 0.02);
      v.panner.positionY.setTargetAtTime(car.y + 1.5, t, 0.02);
      v.panner.positionZ.setTargetAtTime(car.pos.z, t, 0.02);
      const f = this.engines.dopplerOf(car, ls);
      v.pitch += (f - v.pitch) * Math.min(1, dt * 8);
      v.node.parameters.get('pitch')!.setValueAtTime(v.pitch * slow, t);
      // Close behind the player: now and then the yelp
      v.modeT -= dt;
      if (v.modeT <= 0) {
        const close = d < 40;
        const yelp = close && Math.random() < 0.4;
        v.node.parameters.get('mode')!.setValueAtTime(yelp ? 1 : 0, t);
        v.modeT = yelp ? 3 + Math.random() * 3 : 6 + Math.random() * 8;
      }
      // Far sirens get a touch darker (air absorption) through the gain only
      v.gain.gain.setTargetAtTime(0.55 * clamp(1.15 - d / 400, 0.5, 1), t, 0.2);
    }
  }

  private makeNode(v: SirenVoice): AudioWorkletNode | null {
    if (!this.mx.ready) return null;
    const n = new AudioWorkletNode(this.mx.ctx, 'car-siren', {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: { offset: Math.random() * 3 },
    });
    n.connect(v.gain);
    return n;
  }
}
