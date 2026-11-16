import { EngineDSP } from './dsp/EngineDSP';
import { SirenDSP } from './dsp/SirenDSP';

/**
 * The AudioWorklet module, built at runtime from the DSP classes' source (`toString()`), so it works the
 * same in dev and in the bundled build and the DSP stays plain TypeScript that can be run offline. The
 * processors read k-rate params and hand each block to the DSP; `port` messages swap the engine profile.
 */
const SOURCE = `
const EngineDSP = ${EngineDSP.toString()};
const SirenDSP = ${SirenDSP.toString()};

class NeonEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
    return [k('rpm', 0, 0, 14000), k('rev', 0, 0, 1.2), k('throttle', 0, 0, 1), k('load', 0, 0, 1), k('pitch', 1, 0.1, 4),
      k('crackle', 0, 0, 1), k('starter', 0, 0, 1), k('rough', 0, 0, 1), k('cut', 0, 0, 1)];
  }
  constructor(opts) {
    super();
    const o = opts.processorOptions;
    this.dsp = new EngineDSP(sampleRate, o.profile, o.seed || 1);
    this.prm = { rpm: 0, rev: 0, throttle: 0, load: 0, pitch: 1, crackle: 0, starter: 0, rough: 0, cut: 0 };
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data.profile) this.dsp.setProfile(e.data.profile);
      if (e.data.stop) this.alive = false;
    };
  }
  process(_in, outs, params) {
    const out = outs[0][0];
    if (!out) return this.alive;
    const p = this.prm;
    for (const key in p) p[key] = params[key][0];
    this.dsp.process(out, p);
    for (let c = 1; c < outs[0].length; c++) outs[0][c].set(out);
    return this.alive;
  }
}

class NeonSiren extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 1, minValue: 0.1, maxValue: 4, automationRate: 'k-rate' },
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor(opts) {
    super();
    this.dsp = new SirenDSP(sampleRate, (opts.processorOptions && opts.processorOptions.offset) || 0);
    this.prm = { pitch: 1, mode: 0 };
    this.alive = true;
    this.port.onmessage = (e) => { if (e.data.stop) this.alive = false; };
  }
  process(_in, outs, params) {
    const out = outs[0][0];
    if (!out) return this.alive;
    this.prm.pitch = params.pitch[0];
    this.prm.mode = params.mode[0];
    this.dsp.process(out, this.prm);
    for (let c = 1; c < outs[0].length; c++) outs[0][c].set(out);
    return this.alive;
  }
}

registerProcessor('neon-engine', NeonEngine);
registerProcessor('neon-siren', NeonSiren);
`;

/** Register the processors on `ctx` (resolves once they can be instantiated). */
export function loadWorklet(ctx: AudioContext): Promise<void> {
  // Browsers only expose audio worklets on secure pages (https, localhost): elsewhere, fail the promise
  // (the mixer goes on without engines and sirens) rather than throw and stop the game from starting
  if (!ctx.audioWorklet) return Promise.reject(new Error('AudioWorklet needs a secure context (https)'));
  const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }));
  return ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
}
