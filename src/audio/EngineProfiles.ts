import type { EngineProfile } from "./dsp/EngineDSP";

/**
 * Engine voices. `level` normalizes them to the same loudness at full load (measured offline with
 * `EngineDSP`: about -12 dBFS RMS at 90% of the redline, wide open). Character comes from the cylinder
 * count and firing spacing, pulse width (rasp), pipe length, muffler resonances and how far the tone opens.
 */
export const ENGINES = {
  /** 1972 Toyoda Karola: twin-carb straight six, warm at idle, a hard metallic rasp near the redline. */
  straightSix: {
    cyl: 6,
    spread: 0.12,
    jitter: 0.25,
    pulse: 1.5,
    pipe: 3.4,
    fb: -0.45,
    body: [
      [95, 1.2, 0.7],
      [310, 2, 0.5],
      [1150, 3, 0.25],
    ],
    tone: [700, 4600],
    intake: 0.9,
    intakeHz: [700, 2400],
    mech: 0.12,
    rumble: 0.25,
    drive: 1.6,
    level: 0.41,
  },
  /** Police cruisers: a lumpy V8 (uneven pulses into one pipe) with a deep burble. */
  vEight: {
    cyl: 8,
    fire: [0, 0.135, 0.25, 0.37, 0.5, 0.63, 0.75, 0.885],
    spread: 0.28,
    jitter: 0.3,
    pulse: 2,
    pipe: 4.5,
    fb: -0.5,
    body: [
      [70, 1, 0.9],
      [220, 1.5, 0.6],
      [650, 2, 0.3],
    ],
    tone: [480, 3000],
    intake: 0.6,
    intakeHz: [500, 1800],
    mech: 0.1,
    rumble: 0.45,
    drive: 2,
    level: 0.42,
  },
  /** Traffic sedans: an anonymous four. */
  four: {
    cyl: 4,
    spread: 0.1,
    jitter: 0.22,
    pulse: 1.9,
    pipe: 4,
    fb: -0.35,
    body: [
      [110, 1.2, 0.6],
      [380, 2, 0.4],
    ],
    tone: [500, 2600],
    intake: 0.5,
    intakeHz: [700, 2200],
    mech: 0.1,
    rumble: 0.3,
    drive: 1.3,
    level: 0.46,
  },
  /** Kei cars and trucks: a buzzy 660 cc triple. */
  triple: {
    cyl: 3,
    spread: 0.15,
    jitter: 0.3,
    pulse: 1.3,
    pipe: 2.6,
    fb: -0.35,
    body: [
      [140, 1.4, 0.5],
      [450, 2, 0.45],
      [1300, 3, 0.25],
    ],
    tone: [800, 4200],
    intake: 0.6,
    intakeHz: [900, 2800],
    mech: 0.18,
    rumble: 0.2,
    drive: 1.5,
    level: 0.51,
  },
  /** 1973 Mame: a short-stroke four, busy and bright, never strained. */
  cityFour: {
    cyl: 4,
    spread: 0.08,
    jitter: 0.2,
    pulse: 1.4,
    pipe: 2.4,
    fb: -0.42,
    body: [
      [160, 1.4, 0.55],
      [480, 2.2, 0.4],
      [1400, 2.8, 0.28],
    ],
    tone: [750, 4800],
    intake: 0.85,
    intakeHz: [900, 3000],
    mech: 0.16,
    rumble: 0.18,
    drive: 1.7,
    level: 0.43,
  },
  /** Box trucks: a clattering four-cylinder diesel. */
  diesel: {
    cyl: 4,
    diesel: true,
    spread: 0.12,
    jitter: 0.2,
    pulse: 2.6,
    pipe: 6,
    fb: -0.4,
    body: [
      [60, 1, 0.8],
      [180, 1.5, 0.6],
      [480, 2, 0.3],
    ],
    tone: [400, 1800],
    intake: 0.5,
    intakeHz: [400, 1200],
    mech: 0.9,
    rumble: 0.4,
    drive: 1.4,
    level: 0.39,
  },
} satisfies Record<string, EngineProfile>;

export type EngineId = keyof typeof ENGINES;

const BY_SPEC: Record<string, EngineId> = {
  "2013 Toyoda Karola": "straightSix",
  "1973 Mame": "cityFour",
  "SPVM Cruiser": "vEight",
  "Box Truck": "diesel",
  "Kei Truck": "triple",
  Pickup: "four",
  "Traffic Sedan": "four",
};

/** Engine for a car spec name and body style (kei-sized traffic cars share the sedan spec). */
export function engineFor(specName: string, style: string): EngineId {
  if (style === "kei" || style === "keitruck") return "triple";
  return BY_SPEC[specName] ?? "four";
}
