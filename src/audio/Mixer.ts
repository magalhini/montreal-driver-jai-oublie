import { loadWorklet } from './worklet';

/**
 * Sound categories, each with its own volume slider (AUDIO page). The level scales the category's sources
 * before they are panned and sent to the reverbs, so the echoes follow the slider too.
 */
export const CATEGORIES = {
  engine: { label: 'YOUR ENGINE', hint: "Your car's engine, starter, turn signal and gear clicks", def: 0.7 },
  tires: { label: 'TIRES & ROAD', hint: 'Your tires squealing, road and wind noise, scraping walls', def: 0.65 },
  traffic: { label: 'TRAFFIC', hint: 'Other cars driving by: engines and tires', def: 0.65 },
  sirens: { label: 'SIRENS', hint: 'SPVM sirens', def: 0.7 },
  horns: { label: 'HORNS', hint: 'Your horn and other drivers honking', def: 0.65 },
  crashes: { label: 'CRASHES', hint: 'Crashes, landings and splashes', def: 0.75 },
  weather: { label: 'RAIN & THUNDER', hint: 'Rain on the street, on roofs and on the car, distant thunder', def: 0.6 },
  city: { label: 'CITY AMBIENCE', hint: 'The city at night: distant traffic, neon hum, wind', def: 0.5 },
  life: { label: 'STREET LIFE', hint: 'Crowds, canal water, steam vents, crickets and the garage', def: 0.5 },
  distant: { label: 'DISTANT SOUNDS', hint: 'Far-off sirens and horns, trains, ships, bikes', def: 0.5 },
  music: { label: 'MUSIC', hint: 'Title screen pad', def: 0.55 },
  alerts: { label: 'ALERTS & MENU', hint: 'Reward chimes, SPVM radio, menu clicks', def: 0.7 },
} as const;

export type Category = keyof typeof CATEGORIES;
export type AudioKey = Category | 'master';
/** Volume sliders (0..1), saved to `localStorage`. */
export type AudioSettings = Record<AudioKey, number>;

/** Per-category mix, saved apart from older three-slider layouts. */
export const AUDIO_KEY = 'montrealDriver.audioMix';
const MASTER_DEFAULT = 0.8;

function loadSettings(): AudioSettings {
  const out = { master: MASTER_DEFAULT } as AudioSettings;
  for (const k of Object.keys(CATEGORIES) as Category[]) out[k] = CATEGORIES[k].def;
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<AudioSettings>) : {};
    for (const k of Object.keys(out) as AudioKey[]) {
      const x = v[k];
      if (typeof x === 'number' && x >= 0 && x <= 1) out[k] = x;
    }
  } catch {
    // unreadable save: defaults
  }
  return out;
}

export type NoiseKind = 'white' | 'pink' | 'brown';

/**
 * The audio graph (every source first goes through its category level, `catGain`):
 *
 *   car / effect voices ──> effects ─┐
 *   ambience layers ──────> ambience ┼─> world (cabin / pause muffle: lowpass + gain) ─┐
 *   reverb returns (street, room) ───┘                                                   ├─> master ─> limiter ─> out
 *   player car ──────────> cabin (its own muffle) ───────────────────────────────────────┤
 *   music ──────────────────────────────────────────────────────────────────────────────┤
 *   ui ─────────────────────────────────────────────────────────────────────────────────┘
 *
 * Spatial voices send to the two convolution reverbs: an open-street one (long, dark, with discrete
 * slapback echoes off the buildings) and an enclosed one (garages, arcades, alleys: short and dense).
 */
export class Mixer {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly world: GainNode;
  readonly worldTone: BiquadFilterNode;
  readonly effects: GainNode;
  readonly ambience: GainNode;
  readonly cabin: GainNode;
  readonly cabinTone: BiquadFilterNode;
  readonly music: GainNode;
  readonly ui: GainNode;
  /** Vehicle and effect sounds stop while the game is paused (ambience carries on, muffled). */
  private readonly fxGate: GainNode;
  private readonly cabinGate: GainNode;
  readonly streetSend: GainNode;
  readonly roomSend: GainNode;
  private readonly streetRet: GainNode;
  private readonly roomRet: GainNode;
  readonly settings = loadSettings();
  /** One control signal per category: drives the gain of every `catGain` node of that category. */
  private readonly levels = {} as Record<Category, ConstantSourceNode>;
  /** Worklet processors registered (engines and sirens can be created). */
  ready = false;
  private noise = new Map<NoiseKind, AudioBuffer>();

  constructor() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    this.master = this.gain(limiter, 0);
    this.world = this.gain(this.master, 1);
    this.worldTone = ctx.createBiquadFilter();
    this.worldTone.type = 'lowpass';
    this.worldTone.frequency.value = 20000;
    this.worldTone.Q.value = 0.5;
    this.worldTone.connect(this.world);
    this.fxGate = this.gain(this.worldTone, 1);
    this.effects = this.gain(this.fxGate, 1);
    this.ambience = this.gain(this.worldTone, 1);
    this.cabinTone = ctx.createBiquadFilter();
    this.cabinTone.type = 'lowpass';
    this.cabinTone.frequency.value = 20000;
    this.cabinTone.Q.value = 0.5;
    this.cabin = this.gain(this.master, 1);
    this.cabinGate = this.gain(this.cabin, 1);
    this.cabinTone.connect(this.cabinGate);
    this.music = this.gain(this.master, 1);
    this.ui = this.gain(this.master, 1);
    // Reverbs (returns go through the world muffle too)
    const street = ctx.createConvolver();
    street.buffer = this.impulse(2.6, 3.2, 0.012, 2600, [0.07, 0.13, 0.21, 0.34]);
    const room = ctx.createConvolver();
    room.buffer = this.impulse(1.1, 5, 0.004, 5200, [0.018, 0.031, 0.047]);
    this.streetRet = this.gain(this.worldTone, 0.5);
    this.roomRet = this.gain(this.worldTone, 0);
    street.connect(this.streetRet);
    room.connect(this.roomRet);
    this.streetSend = this.gain(street, 1);
    this.roomSend = this.gain(room, 1);
    for (const k of Object.keys(CATEGORIES) as Category[]) {
      const c = ctx.createConstantSource();
      c.offset.value = 0;
      c.start();
      this.levels[k] = c;
    }
    this.applySettings();
    // The context can only start after a user gesture; the game loop stops in a background tab
    const unlock = () => {
      if (ctx.state !== 'running' && !document.hidden) void ctx.resume();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? void ctx.suspend() : unlock()));
    loadWorklet(ctx).then(
      () => (this.ready = true),
      (err) => console.warn('Audio worklet failed to load: engines and sirens are silent', err),
    );
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  set(key: AudioKey, v: number): void {
    this.settings[key] = Math.round(Math.min(1, Math.max(0, v)) * 20) / 20;
    this.applySettings();
    try {
      localStorage.setItem(AUDIO_KEY, JSON.stringify(this.settings));
    } catch {
      // storage full or blocked: keep the setting for this session
    }
  }

  private applySettings(): void {
    const s = this.settings;
    // Sliders are perceptual: square law
    const t = this.now;
    this.master.gain.setTargetAtTime(s.master * s.master, t, 0.05);
    for (const k of Object.keys(CATEGORIES) as Category[]) this.levels[k].offset.setTargetAtTime(s[k] * s[k], t, 0.05);
  }

  /**
   * A gain node at the category's level, to put at the head of a source chain (before panners and reverb
   * sends). Its gain is driven by the category's control signal: don't automate it, chain another gain for
   * envelopes. Throwaway nodes must be `release`d.
   */
  catGain(cat: Category, to?: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.levels[cat].connect(g.gain);
    if (to) g.connect(to);
    return g;
  }

  /** Detach a `catGain` node from its control signal (so it can be collected). */
  release(g: GainNode, cat: Category): void {
    this.levels[cat].disconnect(g.gain);
    g.disconnect();
  }

  /**
   * Acoustic surroundings of the listener: `room` 0..1 (enclosed), `street` reverb amount, and the
   * muffle of everything outside the car (`muffle` lowpass Hz, `duck` gain) for the cabin view and pauses.
   */
  setSpace(street: number, room: number, muffleHz: number, duck: number, cabinHz: number): void {
    const t = this.now;
    this.streetRet.gain.setTargetAtTime(street, t, 0.4);
    this.roomRet.gain.setTargetAtTime(room, t, 0.25);
    this.worldTone.frequency.setTargetAtTime(muffleHz, t, 0.08);
    this.world.gain.setTargetAtTime(duck, t, 0.12);
    this.cabinTone.frequency.setTargetAtTime(cabinHz, t, 0.08);
  }

  /** Silence the vehicles and effects (paused: a frozen engine or tire squeal would drone on). */
  setPaused(on: boolean): void {
    const t = this.now;
    this.fxGate.gain.setTargetAtTime(on ? 0 : 1, t, on ? 0.05 : 0.15);
    this.cabinGate.gain.setTargetAtTime(on ? 0 : 1, t, on ? 0.05 : 0.15);
  }

  /** A gain node feeding `to` (a node, or an AudioParam for modulation). */
  gain(to: AudioNode | AudioParam, value: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (to instanceof AudioParam) g.connect(to);
    else g.connect(to);
    return g;
  }

  filter(type: BiquadFilterType, hz: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  }

  /** A looping noise source (started, random offset so layers don't line up). */
  noiseSource(kind: NoiseKind): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(kind);
    src.loop = true;
    src.start(0, Math.random() * src.buffer.duration);
    return src;
  }

  noiseBuffer(kind: NoiseKind): AudioBuffer {
    let b = this.noise.get(kind);
    if (b) return b;
    const sr = this.ctx.sampleRate;
    b = this.ctx.createBuffer(1, sr * 6, sr);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, br = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        // Paul Kellet's economy pink filter
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
      } else {
        br = (br + 0.02 * w) / 1.02;
        d[i] = br * 3.2;
      }
    }
    // Crossfade the loop seam
    const fade = 2048;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[d.length - fade + i] * (1 - k);
    }
    this.noise.set(kind, b);
    return b;
  }

  /**
   * Stereo reverb impulse: exponentially decaying noise (`decay` = e-folds over `len`), darker toward the
   * tail, after `pre` s, plus discrete early echoes at `taps` (s).
   */
  private impulse(len: number, decay: number, pre: number, brightness: number, taps: number[]): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(len * sr);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = Math.floor(pre * sr); i < n; i++) {
        const t = i / n;
        // lowpass closing over the tail
        const k = Math.min(1, (brightness * (1 - 0.8 * t)) / sr * 6.28);
        lp += ((Math.random() * 2 - 1) - lp) * k;
        d[i] = lp * Math.exp(-decay * t) * 0.6;
      }
      for (const tap of taps) {
        const at = Math.floor((tap + (c ? 0.004 : 0)) * sr);
        const amp = 0.5 * Math.exp(-tap * 4);
        for (let j = 0; j < 90 && at + j < n; j++) d[at + j] += amp * Math.exp(-j / 18) * (Math.random() * 2 - 1);
      }
    }
    return buf;
  }
}
