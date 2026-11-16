import { CONFIG } from '../config';
import { generateMontreal } from './montreal/MontrealGenerator';
import { MAPS, type MapId } from './catalog';
import { MONTREAL_MARKINGS, type MapDef } from './MapDef';

/** Montreal's signals are vertical three-lamp heads hung from mast arms beyond the junction (as in North America). */
export function mapDef(id: MapId): MapDef {
  return { ...MAPS[id], generate: generateMontreal, markings: MONTREAL_MARKINGS, signals: 'mast' };
}

/** The city chosen at load (`CONFIG.MAP`). */
export const currentMap = (): MapDef => mapDef(CONFIG.MAP);
