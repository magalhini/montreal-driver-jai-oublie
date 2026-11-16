import type { SampleId } from './Samples';

/** A burst inside a one-shot file: [start, length] in seconds. */
export type Cue = [number, number];

export interface GarageSound {
  id: SampleId;
  cues: Record<string, Cue>;
}

/**
 * Recorded sounds for the NEO OIL pit garage (`ui/PitShop.ts`, `world/PitGarage.ts`; CC0 recordings from
 * freesound.org, credited in `public/audio/CREDITS.md`). `garageRoom` (a quiet workshop with a motor humming
 * in the back, 60 s loop) is the room bed; the files here hold one-shots cut from the recordings, each burst
 * peak-normalized to -3 dBFS (set the level per use), 0.2 s apart: play a cue with `SampleBank.get(id)` and
 * `source.start(t, start, length)`.
 */
export const GARAGE_SOUNDS = {
  /** Air impact wrench on wheel nuts: `short` / `short2` one nut, `medium`, `long` / `long2` a run of nuts, `loosen` one big 1-inch gun breaking a nut loose. Cutscene wheel mechanic (t > 4.4 s, bursts with pauses), WHEELS fits, BRAKES. */
  impactWrench: {
    id: 'impactWrench',
    cues: {
      short: [0.10, 1.57],
      medium: [1.87, 1.83],
      long: [3.90, 2.93],
      short2: [7.03, 1.21],
      long2: [8.44, 2.47],
      loosen: [11.11, 2.20],
    },
  },
  /** Pneumatic ratchet gun, four bursts. Alternative to the impact wrench for smaller bolts (BRAKES, HANDLING). */
  airRatchet: {
    id: 'airRatchet',
    cues: {
      a: [0.10, 2.60],
      b: [2.90, 1.15],
      c: [4.25, 1.15],
      d: [5.60, 1.40],
    },
  },
  /** Hand socket ratchet in a small garage: `one` / `one2` / `one3` a single pull, `quick4` four quick pulls, `run` / `run2` a longer ratcheting run; `torque` a torque wrench clicking round until it trips (quiet source, normalized: play it low). ENGINE / HANDLING / BRAKES confirms, the crew between jobs. */
  ratchet: {
    id: 'ratchet',
    cues: {
      one: [0.10, 0.80],
      one2: [1.10, 0.72],
      quick4: [2.02, 2.17],
      run: [4.39, 2.30],
      one3: [6.89, 1.13],
      run2: [8.22, 1.30],
      torque: [9.72, 5.00],
    },
  },
  /** Compressed air: `pffft` a hose disconnected, `release` / `release2` a tank bleeding down with a valve clack, `valve` a short compressor valve snap. Pneumatic flourish before an air tool, the compressor topping off. */
  airHiss: {
    id: 'airHiss',
    cues: {
      pffft: [0.10, 1.50],
      release: [1.80, 2.35],
      release2: [4.35, 2.45],
      valve: [7.00, 0.50],
    },
  },
  /** Aerosol can: `shake` (rattle), `cap` popped, `spray` / `spray2` passes; `shakeSpray` a short shake-and-spray in one. PAINT previews and confirm. */
  sprayPaint: {
    id: 'sprayPaint',
    cues: {
      shake: [0.10, 1.90],
      cap: [2.20, 0.57],
      spray: [2.97, 0.70],
      spray2: [3.87, 1.07],
      shakeSpray: [5.14, 1.90],
    },
  },
  /** Tools: `drop`..`drop4` a wrench dropped on concrete (different hits), `dig` digging in a toolbox, `rummage` / `rummage2` picking through tools, `clank` / `clank2` single metal clanks, `drawer`..`drawer3` roller-cabinet drawers. The walker fetching tools, parts coming off (WEIGHT), refunds. */
  tools: {
    id: 'tools',
    cues: {
      drop: [0.10, 1.13],
      drop2: [1.43, 1.29],
      drop3: [2.92, 1.03],
      drop4: [4.15, 0.91],
      dig: [5.26, 1.96],
      rummage: [7.42, 1.33],
      rummage2: [8.95, 0.83],
      clank: [9.98, 0.75],
      clank2: [10.93, 0.51],
      drawer: [11.64, 0.97],
      drawer2: [12.81, 1.27],
      drawer3: [14.28, 1.27],
    },
  },
  /** Car hood: `open` (latch, springy hinges), `close` (one clean shut, dry), `slam` (a big resonant slam in a car park: for the race build). ENTER on the ENGINE tab, confirms. */
  hood: {
    id: 'hood',
    cues: {
      open: [0.10, 2.00],
      close: [2.30, 1.55],
      slam: [4.05, 2.90],
    },
  },
  /** Three short bursts of a cordless drill. WEIGHT (panels out), trim work. */
  drill: {
    id: 'drill',
    cues: {
      drill: [0.10, 1.34],
    },
  },
  /** Slide hammer / hammer on sheet metal: `hits` / `hits2` / `hits3` two-second runs of blows, `hit` one blow. REPAIR (panel beating). */
  hammer: {
    id: 'hammer',
    cues: {
      hits: [0.10, 2.00],
      hits2: [2.30, 2.00],
      hits3: [4.50, 2.00],
      hit: [6.70, 1.33],
    },
  },
  /** Arc welder: `tack` a short tack, `run` a three-second bead (binaural dummy-head recording). ENGINE top stage (full race build), WEIGHT cage work. */
  welding: {
    id: 'welding',
    cues: {
      tack: [0.10, 1.33],
      run: [1.63, 3.00],
    },
  },
  /** Old manual cash register: `open` the drawer with the bell and coin rattle, `close`. Purchases and refunds. */
  register: {
    id: 'register',
    cues: {
      open: [0.10, 3.20],
      close: [3.50, 1.60],
    },
  },
  /** Keyboard typing, 3.8 s: the diagnostic laptop on the hood (t >= 6.8 s in the cutscene; loop or retrigger). */
  typing: {
    id: 'typing',
    cues: {
      typing: [0.10, 3.80],
    },
  },
  /** Mirror charms: `suzu` one shake of Japanese suzu bells (omamori, teru teru bozu, daruma: hang it), `suzuShake`..`suzuShake3` softer swings, `squeak` a squeaky toy (panda, shiba, lucky cat), `duck` the rubber duck, `dice` / `dice2` dice rattled in a cup (fuzzy dice). CHARMS previews and confirm. */
  charm: {
    id: 'charm',
    cues: {
      suzu: [0.10, 2.80],
      suzuShake: [3.10, 0.90],
      suzuShake2: [4.20, 1.70],
      suzuShake3: [6.10, 2.00],
      squeak: [8.30, 0.40],
      duck: [8.90, 0.73],
      dice: [9.83, 2.65],
      dice2: [12.68, 0.45],
    },
  },
  /** Manual hydraulic jack pumped: `pump4` four strokes, `pump2` two. HANDLING (suspension work), the car going up. */
  jack: {
    id: 'jack',
    cues: {
      pump4: [0.10, 3.80],
      pump2: [4.10, 1.70],
    },
  },
  /** Roll-up door: `open` (latch and the door rolling up), `close` (rolling down), `latch`. Leaving the garage. */
  door: {
    id: 'door',
    cues: {
      open: [0.10, 5.60],
      close: [5.90, 2.90],
      latch: [9.00, 1.70],
    },
  },
  /** An air compressor kicking on, running ten seconds and shutting off (with the pressure bleed). Random shop life every minute or two, under the room loop. */
  compressor: {
    id: 'compressor',
    cues: {
      onOff: [0.10, 10.90],
    },
  },
} satisfies Record<string, GarageSound>;
