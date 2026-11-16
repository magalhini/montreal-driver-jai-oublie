import { CONFIG } from '../config';
import { generateMontreal } from './montreal/MontrealGenerator';
import { MAPS, type MapId } from './catalog';
import { MONTREAL_MARKINGS, type MapDef } from './MapDef';

/**
 * Signals stay on Tokyo's overhead arms until Phase 4 paints vertical pole heads (`'pole'`); switching the
 * flag here is that phase's job, not this one's.
 */
export function mapDef(id: MapId): MapDef {
  return { ...MAPS[id], generate: generateMontreal, markings: MONTREAL_MARKINGS, signals: 'overhead' };
}

/** The city chosen at load (`CONFIG.MAP`). */
export const currentMap = (): MapDef => mapDef(CONFIG.MAP);
