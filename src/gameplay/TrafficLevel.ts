import { CONFIG } from '../config';

/**
 * How busy the streets are: the game's difficulty, picked on the title (or pause) menu and saved. Scales the
 * civilian traffic target (`CONFIG.MAX_TRAFFIC` x `mul`). Montreal (PRD 5.5, Phase 8): the middle level is
 * already a full boulevard and the default; QUIET stays for testing.
 */
export const TRAFFIC_LEVELS = [
  { name: 'QUIET', mul: 0.25, hint: 'Empty streets: for testing' },
  { name: 'LIGHT', mul: 0.55, hint: 'A Sunday morning' },
  { name: 'BUSY', mul: 1, hint: 'A normal Montreal day: full boulevards' },
  { name: 'RUSH HOUR', mul: 1.25, hint: 'Rush hour: worse' },
  { name: 'GRIDLOCK', mul: 1.45, hint: 'Everybody is out, and in your lane: the hardest' },
] as const;

export const DEFAULT_TRAFFIC_LEVEL = 2;
/** New key: a level saved under the old scale (`neonDriver.traffic`) meant a different number of cars. */
const KEY = 'montrealDriver.traffic';

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
