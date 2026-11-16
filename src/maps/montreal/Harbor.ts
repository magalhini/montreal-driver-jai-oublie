import { CONFIG } from '../../config';
import type { AABB, Block, Building } from '../../types';
import type { CityModel } from '../../world/RoadGraph';
import { CLOCK } from './layout';

/** Last block row: the quay along the river. */
const QUAY = 14;
/** Paved lane along the water, inside each quay block's south sidewalk. */
const STRIP = 18;

/**
 * The harbour is two long rows of sheds. A paved lane runs the length of the quay, along the water, with a
 * curb cut at each end of every block so it can be driven end to end. The clock tower's block keeps its
 * frontage. Set before buildings; `openHarbor` clears the lane after.
 */
export function layHarbor(city: CityModel): void {
  const f = city.features;
  for (const bl of city.blocks) {
    if (bl.gj !== QUAY || bl.gi === CLOCK.i) continue;
    const strip = quayStrip(bl);
    if (f.kinds[bl.id] === 'normal') f.driveways.push(strip);
    f.driveways.push(mouth(bl, strip, 'W'), mouth(bl, strip, 'E'));
  }
}

/** Pull sheds off the quay lane. */
export function openHarbor(city: CityModel): void {
  const holes: AABB[] = [];
  for (const bl of city.blocks) {
    if (bl.gj !== QUAY || bl.gi === CLOCK.i) continue;
    if (city.features.kinds[bl.id] !== 'normal') continue;
    holes.push(quayStrip(bl));
  }
  if (!holes.length) return;
  const kept: Building[] = [];
  for (const b of city.buildings) {
    const next = carve(b, holes);
    if (next) kept.push(next);
  }
  city.buildings = kept;
}

/** South edge of a quay block, inside the sidewalk: the jump lane. */
function quayStrip(bl: Block): AABB {
  const sw = CONFIG.SIDEWALK;
  const south = bl.max.z - sw;
  return { minX: bl.min.x + sw, maxX: bl.max.x - sw, minZ: south - STRIP, maxZ: south };
}

function mouth(bl: Block, strip: AABB, side: 'W' | 'E'): AABB {
  const sw = CONFIG.SIDEWALK;
  const x0 = side === 'W' ? bl.min.x : bl.max.x - sw;
  return { minX: x0, maxX: x0 + sw, minZ: strip.minZ, maxZ: strip.maxZ };
}

/** Drop a shed whose middle is in the lane. Otherwise pull its edge back so the street face stays. */
function carve(b: Building, holes: AABB[]): Building | null {
  const gap = 1.2;
  for (const h of holes) {
    if (b.maxX <= h.minX || b.minX >= h.maxX || b.maxZ <= h.minZ || b.minZ >= h.maxZ) continue;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    if (cx > h.minX && cx < h.maxX && cz > h.minZ && cz < h.maxZ) return null;
    if (cx >= h.maxX) b.minX = Math.max(b.minX, h.maxX + gap);
    else if (cx <= h.minX) b.maxX = Math.min(b.maxX, h.minX - gap);
    if (cz >= h.maxZ) b.minZ = Math.max(b.minZ, h.maxZ + gap);
    else if (cz <= h.minZ) b.maxZ = Math.min(b.maxZ, h.minZ - gap);
    if (b.maxX - b.minX < 3 || b.maxZ - b.minZ < 3) return null;
  }
  return b;
}
