import { CONFIG } from '../config';

/**
 * How busy the streets are: the game's difficulty, picked on the title (or pause) menu and saved. Scales the
 * civilian traffic target (`CONFIG.MAX_TRAFFIC` x `mul`); RUSH HOUR is twice NORMAL.
 */
export const TRAFFIC_LEVELS = [
  { name: 'QUIET', mul: 0.4, hint: 'Empty streets: the easiest' },
  { name: 'LIGHT', mul: 0.7, hint: 'Light traffic' },
  { name: 'NORMAL', mul: 1.2, hint: 'Normal traffic' },
  { name: 'BUSY', mul: 1.75, hint: 'Busy streets' },
  { name: 'RUSH HOUR', mul: 2.4, hint: 'Rush hour, twice the normal traffic: the hardest' },
] as const;

export const DEFAULT_TRAFFIC_LEVEL = 2;
const KEY = 'neonDriver.traffic';

/** Civilian cars kept around the player at this level. */
export function trafficTarget(level: number): number {
  return Math.round(CONFIG.MAX_TRAFFIC * TRAFFIC_LEVELS[level].mul);
}

export function loadTrafficLevel(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return localStorage.getItem(KEY) !== null && Number.isInteger(v) && v >= 0 && v < TRAFFIC_LEVELS.length ? v : DEFAULT_TRAFFIC_LEVEL;
  } catch {
    return DEFAULT_TRAFFIC_LEVEL;
  }
}

export function saveTrafficLevel(level: number): void {
  try {
    localStorage.setItem(KEY, String(level));
  } catch {
    // private mode / storage full: the level just isn't remembered
  }
}
