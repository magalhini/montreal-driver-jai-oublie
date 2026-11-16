import type { Mixer } from './Mixer';

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Music bus content (T34): a synth pad under the title screen (MUSIC). */
export class Music {
  private readonly pad: GainNode;
  private readonly padLp: BiquadFilterNode;

  constructor(private readonly mx: Mixer) {
    const ctx = mx.ctx;
    // Title pad: detuned saws on A minor 9, under a slowly breathing lowpass, through the street reverb
    const padCat = mx.catGain('music', mx.music);
    padCat.connect(mx.gain(mx.streetSend, 0.6));
    this.pad = mx.gain(padCat, 0);
    this.padLp = mx.filter('lowpass', 700, 1.2);
    this.padLp.connect(this.pad);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const depth = mx.gain(this.padLp.frequency, 450);
    lfo.connect(depth);
    lfo.start();
    for (const m of [45, 52, 55, 59, 60, 64]) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(mx.gain(this.padLp, m < 50 ? 0.07 : 0.045));
        o.start();
      }
    }
  }

  /** `title`: the title screen is up. */
  update(title: boolean): void {
    this.pad.gain.setTargetAtTime(title ? 1 : 0, this.mx.now, title ? 1.5 : 0.6);
  }
}
