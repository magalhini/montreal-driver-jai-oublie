import type { Mixer } from './Mixer';

/**
 * Recorded sounds in `public/audio/` (CC0 recordings from freesound.org, credited in `public/audio/CREDITS.md`).
 * Loops are stored with `pad` seconds of wrapped-around audio on both ends (so the AAC encoder's priming
 * and padding never fall inside the loop): play them looping between `pad` and `pad + loop`.
 */
export interface SampleFile {
  file: string;
  /** Loop length (s) and padding on each side; 0 for one-shots. */
  loop: number;
  pad: number;
}

export type SampleId =
  | 'rainLight'
  | 'rainHeavy'
  | 'rainRoof'
  | 'rainCar'
  | 'thunder'
  | 'cityBusy'
  | 'cityQuiet'
  | 'cityHarbor'
  | 'crowd'
  // Pit garage (`GarageSamples.ts` has the cues inside the one-shot files)
  | 'garageRoom'
  | 'impactWrench'
  | 'airRatchet'
  | 'ratchet'
  | 'airHiss'
  | 'sprayPaint'
  | 'tools'
  | 'hood'
  | 'drill'
  | 'hammer'
  | 'welding'
  | 'register'
  | 'typing'
  | 'charm'
  | 'jack'
  | 'door'
  | 'compressor';

export const SAMPLES: Record<SampleId, SampleFile> = {
  rainLight: { file: 'rain-light.m4a', loop: 37, pad: 0.1 },
  rainHeavy: { file: 'rain-heavy.m4a', loop: 45, pad: 0.1 },
  rainRoof: { file: 'rain-roof.m4a', loop: 40, pad: 0.1 },
  rainCar: { file: 'rain-car.m4a', loop: 33, pad: 0.1 },
  thunder: { file: 'thunder.m4a', loop: 0, pad: 0 },
  cityBusy: { file: 'city-busy.m4a', loop: 60, pad: 0.1 },
  cityQuiet: { file: 'city-quiet.m4a', loop: 60, pad: 0.1 },
  cityHarbor: { file: 'city-harbor.m4a', loop: 60, pad: 0.1 },
  crowd: { file: 'crowd.m4a', loop: 45, pad: 0.1 },
  garageRoom: { file: 'garage-room.m4a', loop: 60, pad: 0.1 },
  impactWrench: { file: 'impact-wrench.m4a', loop: 0, pad: 0 },
  airRatchet: { file: 'air-ratchet.m4a', loop: 0, pad: 0 },
  ratchet: { file: 'ratchet.m4a', loop: 0, pad: 0 },
  airHiss: { file: 'air-hiss.m4a', loop: 0, pad: 0 },
  sprayPaint: { file: 'spray-paint.m4a', loop: 0, pad: 0 },
  tools: { file: 'tools.m4a', loop: 0, pad: 0 },
  hood: { file: 'hood.m4a', loop: 0, pad: 0 },
  drill: { file: 'drill.m4a', loop: 0, pad: 0 },
  hammer: { file: 'hammer.m4a', loop: 0, pad: 0 },
  welding: { file: 'welding.m4a', loop: 0, pad: 0 },
  register: { file: 'register.m4a', loop: 0, pad: 0 },
  typing: { file: 'typing.m4a', loop: 0, pad: 0 },
  charm: { file: 'charm.m4a', loop: 0, pad: 0 },
  jack: { file: 'jack.m4a', loop: 0, pad: 0 },
  door: { file: 'door.m4a', loop: 0, pad: 0 },
  compressor: { file: 'compressor.m4a', loop: 0, pad: 0 },
};

/** Loads and decodes the recordings once (in the background; callers check `get` each frame). */
export class SampleBank {
  private readonly bufs = new Map<SampleId, AudioBuffer>();
  private readonly pending = new Set<SampleId>();

  constructor(readonly mx: Mixer) {}

  /** The decoded buffer, or null while it loads (starts loading on first ask). */
  get(id: SampleId): AudioBuffer | null {
    const b = this.bufs.get(id);
    if (b) return b;
    if (!this.pending.has(id)) {
      this.pending.add(id);
      void this.load(id);
    }
    return null;
  }

  private async load(id: SampleId): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}audio/${SAMPLES[id].file}`);
      if (!res.ok) throw new Error(`${res.status}`);
      this.bufs.set(id, await this.mx.ctx.decodeAudioData(await res.arrayBuffer()));
    } catch (err) {
      console.warn(`Audio sample ${SAMPLES[id].file} failed to load`, err);
    }
  }

  /** A looping source over the seamless part of a padded loop, started at a random point. */
  loopSource(id: SampleId, buf: AudioBuffer): AudioBufferSourceNode {
    const f = SAMPLES[id];
    const s = this.mx.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = f.pad;
    s.loopEnd = Math.min(buf.duration, f.pad + f.loop);
    s.start(0, f.pad + Math.random() * f.loop);
    return s;
  }
}

/** A recorded loop behind a fader: starts the first time it is turned up (once loaded), then just fades. */
export class LoopLayer {
  readonly gain: GainNode;
  private started = false;

  constructor(
    private readonly bank: SampleBank,
    readonly id: SampleId,
    to: AudioNode,
  ) {
    this.gain = bank.mx.gain(to, 0);
  }

  set(v: number, t: number, tc = 0.8): void {
    if (v > 0.001 && !this.started) {
      const buf = this.bank.get(this.id);
      if (!buf) return;
      this.bank.loopSource(this.id, buf).connect(this.gain);
      this.started = true;
    }
    this.gain.gain.setTargetAtTime(v, t, tc);
  }
}
