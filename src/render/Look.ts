import { CONFIG } from '../config';

/**
 * How bright the night kit's light tricks are under the map's sky. The base game was tuned for night: additive
 * halos round every lamp, light pools on the asphalt, lit windows as the main read of a facade. Under a
 * December afternoon those are weak (a halo against a white sky reads as a smear), so the views scale them by
 * these instead of each one branching on the map.
 */
export interface Look {
  /** Daylight, snow and the winter palette (`CONFIG.SKY === 'winterDay'`). */
  day: boolean;
  /** Additive halos round lamps, signals and car lights (opacity scale). */
  glow: number;
  /** Light pools on the ground: street lamps, headlight beams, siren wash. */
  pool: number;
  /** Lit windows, shopfronts and signs on the building facades (emissive scale). */
  windows: number;
  /** The player's headlight spot (intensity scale). */
  headSpot: number;
}

const WINTER_DAY: Look = { day: true, glow: 0.15, pool: 0.12, windows: 0.3, headSpot: 0.15 };
const NIGHT: Look = { day: false, glow: 1, pool: 1, windows: 1, headSpot: 1 };

export const LOOK: Look = CONFIG.SKY === 'winterDay' ? WINTER_DAY : NIGHT;
