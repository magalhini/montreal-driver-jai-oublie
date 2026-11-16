import type { CityModel } from '../world/RoadGraph';
import type { MapInfo } from './catalog';

/** A playable city: its catalog entry plus the generator that builds it and how its streets look. */
export interface MapDef extends MapInfo {
  generate(seed: number): CityModel;
  markings: MarkingStyle;
  signals: SignalStyle;
}

/** Signal heads (T43): horizontal heads on far-side arms, or vertical heads on stop-line poles. */
export type SignalStyle = 'overhead' | 'pole';

type Rgb = [number, number, number];

/** Road paint (T42). Lengths in meters; dashes are [paint, gap] by arc length. */
export interface MarkingStyle {
  /** Edge lines, lane dividers, stop lines, crosswalks. */
  white: Rgb;
  /** The double center line of avenues. */
  center: Rgb;
  /** Center line of two-way streets with one lane each way. */
  streetDash: [number, number];
  /** Dividers between lanes going the same way. */
  laneDash: [number, number];
  /** Crosswalk bars along the road at each junction: bar width, bar spacing, depth (from 0.6 m off the junction). */
  crosswalk: { bar: number; pitch: number; depth: number; centered: boolean };
}

/** Montreal: yellow center line, white dashes, zebra crossings centered on the road. */
export const MONTREAL_MARKINGS: MarkingStyle = {
  white: [0.9, 0.9, 0.9],
  center: [0.95, 0.78, 0.15],
  streetDash: [3, 4.5],
  laneDash: [3, 6],
  crosswalk: { bar: 0.5, pitch: 1, depth: 3.4, centered: true },
};

