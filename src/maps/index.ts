import { CONFIG } from '../config';
import { generateMontreal } from './montreal/MontrealGenerator';
import { MAPS, type MapId } from './catalog';
import { MONTREAL_MARKINGS, type MapDef } from './MapDef';

/** Montreal's signals are vertical three-lamp heads on a pole by the stop line (`inspo/`, PRD Phase 4). */
export function mapDef(id: MapId): MapDef {
  return { ...MAPS[id], generate: generateMontreal, markings: MONTREAL_MARKINGS, signals: 'pole' };
}

/** The city chosen at load (`CONFIG.MAP`). */
export const currentMap = (): MapDef => mapDef(CONFIG.MAP);
