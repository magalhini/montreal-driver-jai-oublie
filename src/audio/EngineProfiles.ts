import type { EngineProfile } from "./dsp/EngineDSP";

/**
 * Engine voices. `level` normalizes them to the same loudness at full load (measured offline with
 * `EngineDSP`: about -12 dBFS RMS at 90% of the redline, wide open). Character comes from the cylinder
 * count and firing spacing, pulse width (rasp), pipe length, muffler resonances and how far the tone opens.
 */
export const ENGINES = {
  /** The player's coupe: twin-carb straight six, warm at idle, a hard metallic rasp near the redline. */
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
  "2013 Toyoda": "straightSix",
  "SPVM Cruiser": "vEight",
  "Box Truck": "diesel",
  Pickup: "four",
  "Traffic Sedan": "four",
};

/** Engine for a car spec name. Unknown names get the traffic four. */
export function engineFor(specName: string): EngineId {
  return BY_SPEC[specName] ?? "four";
}
