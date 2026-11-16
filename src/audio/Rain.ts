import { clamp } from '../core/math';
import type { Mixer } from './Mixer';
import { LoopLayer, type SampleBank } from './Samples';

/** Thunder rolls in `thunder.m4a`: [start, length] (s), cut by hand from the recordings. */
const ROLLS: [number, number][] = [
  [0, 10],
  [10.5, 8],
  [19, 12.5],
  [32, 6.5],
  [39, 12.5],
  [52, 6],
  [58.5, 9.5],
  [68.5, 16],
  [85, 27],
];

/** Layer levels at full intensity (the loops are normalized to about -24 dBFS RMS). */
const LEVEL = { light: 0.55, heavy: 0.6, roof: 0.55, car: 0.6, thunder: 0.5 };

/**
 * Rain from recordings (CC0, freesound.org): a light city rain and a heavy downpour crossfaded by
 * intensity out in the open, rain drumming on a roof when the listener is covered (arcades, canopies,
 * garages, the café), rain on the car roof heard from the driver's seat, and distant thunder rolls in
 * heavy rain. All on the RAIN & THUNDER slider.
 */
export class Rain {
  private readonly light: LoopLayer;
  private readonly heavy: LoopLayer;
  private readonly roof: LoopLayer;
  private readonly car: LoopLayer;
  private thunderAt = 30;
  private clock = 0;

  constructor(
    private readonly mx: Mixer,
    private readonly bank: SampleBank,
  ) {
    const amb = mx.catGain('weather', mx.ambience);
    const cabin = mx.catGain('weather', mx.cabinTone);
    this.light = new LoopLayer(bank, 'rainLight', amb);
    this.heavy = new LoopLayer(bank, 'rainHeavy', amb);
    this.roof = new LoopLayer(bank, 'rainRoof', amb);
    this.car = new LoopLayer(bank, 'rainCar', cabin);
  }

  /** `rain` 0..1; `covered` under a roof; `cabin` in the driver's seat; `paused` holds the thunder. */
  update(rain: number, covered: boolean, cabin: boolean, paused: boolean, dt: number): void {
    const t = this.mx.now;
    const open = covered ? 0.3 : cabin ? 0.4 : 1;
    const light = clamp(rain / 0.35, 0, 1) * (1 - 0.55 * clamp((rain - 0.45) / 0.45, 0, 1));
    const heavy = clamp((rain - 0.3) / 0.5, 0, 1);
    const drum = clamp(rain * 1.6, 0, 1);
    this.light.set(light * open * LEVEL.light, t);
    this.heavy.set(heavy * open * LEVEL.heavy, t);
    this.roof.set(covered ? drum * LEVEL.roof : 0, t);
    this.car.set(cabin && !covered ? drum * LEVEL.car : 0, t);
    if (paused) return;
    this.clock += dt;
    if (rain > 0.6 && this.clock > this.thunderAt) {
      this.thunderAt = this.clock + 25 + Math.random() * 45;
      this.thunder(0.5 + Math.random() * 0.5);
    } else if (rain <= 0.6) this.thunderAt = Math.max(this.thunderAt, this.clock + 10);
  }

  /** A distant thunder roll, `k` 0..1, slightly re-pitched so repeats don't stand out. */
  thunder(k: number): void {
    const buf = this.bank.get('thunder');
    if (!buf) return;
    const mx = this.mx;
    const [start, len] = ROLLS[Math.floor(Math.random() * ROLLS.length)];
    const rate = 0.88 + Math.random() * 0.17;
    const src = mx.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const sp = mx.ctx.createStereoPanner();
    sp.pan.value = Math.random() * 1.2 - 0.6;
    const g = mx.gain(sp, LEVEL.thunder * k);
    const lv = mx.catGain('weather', mx.ambience);
    sp.connect(lv);
    const send = mx.gain(mx.streetSend, 0.3);
    lv.connect(send);
    src.connect(g);
    src.start(mx.now + 0.05, start, len);
    src.onended = () => {
      [src, g, sp, send].forEach((n) => n.disconnect());
      mx.release(lv, 'weather');
    };
  }
}
