import { clamp } from '../core/math';
import type { DistrictType } from '../types';
import { AmbientCalls } from './AmbientCalls';
import type { Mixer } from './Mixer';
import { LoopLayer, type SampleBank } from './Samples';
import type { P3, Sfx } from './Sfx';

/** What the ambience needs to know about the listener's surroundings (`AudioSystem`). */
export interface Surroundings {
  pos: P3;
  cabin: boolean;
  /** Under a roof (garage, canopy, passage). */
  covered: boolean;
  district: DistrictType | null;
  rain: number;
  wetness: number;
  /** Pedestrians out within ~35 m. */
  peds: number;
  /** Nearest points of interest (null when far). */
  canal: P3 | null;
  vent: P3 | null;
}

/**
 * Recorded city beds per district (`public/audio/`): a distant downtown rumble from a rooftop, a quieter
 * street at night (far road, a closed station, insects), a quiet city hum by a river.
 */
const BEDS: Record<DistrictType, { busy: number; quiet: number; harbor: number }> = {
  downtown: { busy: 1, quiet: 0.25, harbor: 0 },
  oldtown: { busy: 0.6, quiet: 0.55, harbor: 0 },
  harbor: { busy: 0.2, quiet: 0, harbor: 1 },
  residential: { busy: 0, quiet: 1, harbor: 0 },
  depot: { busy: 0.55, quiet: 0, harbor: 0.45 },
};
/** Bed loops are normalized to about -24 dBFS RMS. */
const BED_LEVEL = 0.42;
/** Mains hum. */
const HUM: Record<DistrictType, number> = { downtown: 0.8, oldtown: 1, harbor: 0.3, residential: 0.15, depot: 0.4 };
/** Insects in the grass and gardens. */
const CRICKETS: Record<DistrictType, number> = { downtown: 0, oldtown: 0.1, harbor: 0.15, residential: 0.8, depot: 0.2 };

const smooth = (g: GainNode, v: number, t: number, tc = 0.6) => g.gain.setTargetAtTime(v, t, tc);

/** A positional loop (canal, vent): gain node behind a panner. */
interface Spot {
  gain: GainNode;
  panner: PannerNode;
}

/**
 * The continuous layers of the night city (T34): recorded beds of the city at night by district, the mains hum of the
 * neon and wind that grows by the harbor and on the hills (CITY AMBIENCE); crowd murmur when the sidewalks
 * are busy, water lapping on the canal quays, steam vents hissing, bell crickets in the gardens (STREET LIFE). No rain
 * sound for now: the synthesized one was removed, to be replaced by recordings.
 */
export class Ambience {
  private readonly beds: { busy: LoopLayer; quiet: LoopLayer; harbor: LoopLayer };
  private readonly hum: GainNode;
  private readonly wind: GainNode;
  private readonly windBp: BiquadFilterNode;
  private readonly crowd: LoopLayer;
  private readonly canal: Spot;
  private readonly vent: Spot;
  private readonly crickets: GainNode;
  private plopAt = 0;
  private level = { busy: 0, quiet: 0, harbor: 0, hum: 0, crickets: 0 };
  private readonly calls: AmbientCalls;

  constructor(
    private readonly mx: Mixer,
    sfx: Sfx,
    bank: SampleBank,
  ) {
    const amb = mx.ambience;
    const city = mx.catGain('city', amb);
    this.beds = {
      busy: new LoopLayer(bank, 'cityBusy', city),
      quiet: new LoopLayer(bank, 'cityQuiet', city),
      harbor: new LoopLayer(bank, 'cityHarbor', city),
    };
    // Mains hum: 50 Hz saw, its 100 / 150 / 200 Hz partials through a narrow band
    this.hum = mx.gain(city, 0);
    const humOsc = mx.ctx.createOscillator();
    humOsc.type = 'sawtooth';
    humOsc.frequency.value = 50;
    const humBp = mx.filter('bandpass', 150, 1.5);
    humOsc.connect(humBp);
    humBp.connect(this.hum);
    humOsc.start();
    // Wind
    this.wind = mx.gain(city, 0);
    this.windBp = mx.filter('bandpass', 500, 0.7);
    this.lfo(this.windBp.frequency, 0.07, 220);
    const gust = mx.gain(this.wind, 0.8);
    this.lfo(gust.gain, 0.05, 0.45);
    mx.noiseSource('pink').connect(this.windBp);
    this.windBp.connect(gust);
    // Crowd murmur: a recorded street walla, a little wet
    const crowdCat = mx.catGain('life', amb);
    crowdCat.connect(mx.gain(mx.streetSend, 0.5));
    this.crowd = new LoopLayer(bank, 'crowd', crowdCat);
    // Positional loops
    this.canal = this.spot(10, 0.5);
    const water = mx.filter('lowpass', 520, 0.7);
    mx.noiseSource('brown').connect(water);
    const lap = mx.gain(this.canal.gain, 0.8);
    this.lfo(lap.gain, 0.33, 0.6);
    water.connect(lap);
    this.vent = this.spot(4, 0.3);
    const steam = mx.filter('bandpass', 3200, 0.5);
    mx.noiseSource('white').connect(steam);
    const flutter = mx.gain(this.vent.gain, 0.8);
    this.lfo(flutter.gain, 1.7, 0.25);
    steam.connect(flutter);
    this.crickets = mx.catGain('life', amb);
    this.calls = new AmbientCalls(mx, sfx, this.crickets);
  }

  /** A slow sine wobble added to a param. */
  private lfo(p: AudioParam, hz: number, depth: number): void {
    const o = this.mx.ctx.createOscillator();
    o.frequency.value = hz;
    const g = this.mx.ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(p);
    o.start(0);
  }

  private spot(ref: number, wet: number): Spot {
    const mx = this.mx;
    const panner = mx.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = ref;
    panner.rolloffFactor = 1.3;
    panner.connect(mx.ambience);
    panner.connect(mx.gain(mx.streetSend, wet * 0.5));
    panner.connect(mx.gain(mx.roomSend, wet * 0.5));
    return { gain: mx.gain(mx.catGain('life', panner), 0), panner };
  }

  private place(s: Spot, p: P3 | null, level: number, t: number): void {
    if (p) {
      s.panner.positionX.setTargetAtTime(p.x, t, 0.1);
      s.panner.positionY.setTargetAtTime(p.y, t, 0.1);
      s.panner.positionZ.setTargetAtTime(p.z, t, 0.1);
    }
    smooth(s.gain, p ? level : 0, t, 0.4);
  }

  update(s: Surroundings, dt: number): void {
    const t = this.mx.now;
    const d = s.district ?? 'residential';
    // Districts crossfade slowly
    const k = Math.min(1, dt * 0.5);
    const lv = this.level;
    const bed = BEDS[d];
    lv.busy += (bed.busy - lv.busy) * k;
    lv.quiet += (bed.quiet - lv.quiet) * k;
    lv.harbor += (bed.harbor - lv.harbor) * k;
    lv.hum += (HUM[d] - lv.hum) * k;
    lv.crickets += (CRICKETS[d] * (1 - clamp(s.rain * 3, 0, 1)) - lv.crickets) * k;
    const shelter = s.cabin ? 0.55 : 1;
    // Indoors (garages, passages) the city outside drops a little; the title camera floats high above it
    const bedLevel = BED_LEVEL * shelter * (s.covered ? 0.7 : 1);
    this.beds.busy.set(lv.busy * bedLevel, t);
    this.beds.quiet.set(lv.quiet * bedLevel, t);
    this.beds.harbor.set(lv.harbor * bedLevel, t);
    smooth(this.hum, 0.012 * lv.hum * (s.covered ? 1.4 : 1), t);
    const high = clamp(s.pos.y / 25, 0, 1);
    const harbor = d === 'harbor' ? 1 : 0;
    smooth(this.wind, (0.05 + 0.08 * harbor + 0.08 * high) * (s.covered ? 0.4 : 1) * shelter, t, 1.2);
    // Rain quiets the street life
    const r = s.rain;
    // Crowd
    const busy = clamp((s.peds - 4) / 25, 0, 1) * (1 - 0.5 * r) * shelter;
    this.crowd.set(busy * 0.45, t, 1);
    // Places
    this.place(this.canal, s.canal, 0.35, t);
    this.place(this.vent, s.vent, 0.12, t);
    this.calls.insects(t, lv.crickets * shelter);
    // Plops in the canal
    if (s.canal && t > this.plopAt) {
      this.plopAt = t + 2 + Math.random() * 6;
      const p = { x: s.canal.x + (Math.random() - 0.5) * 20, y: s.canal.y, z: s.canal.z + (Math.random() - 0.5) * 3 };
      this.calls.plop(p);
    }
  }
}
