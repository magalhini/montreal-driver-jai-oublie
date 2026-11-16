import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import type { Block, Building, DistrictType, Facing } from '../types';
import { depotBuildings } from './Depot';
import type { CityFeatures } from './Features';
import { clearForecourt } from './PitStops';

interface Rule {
  maxLot: number;
  gap: [number, number];
  height: (r: Rng, centerFactor: number) => number;
}

const RULES: Record<Exclude<DistrictType, 'depot'>, Rule> = {
  downtown: { maxLot: 30, gap: [1.5, 3], height: (r, c) => r.range(28, 70) + c * r.range(20, 70) },
  shotengai: { maxLot: 9, gap: [0.15, 0.5], height: (r) => (r.chance(0.15) ? r.range(16, 26) : r.range(5, 13)) },
  residential: { maxLot: 20, gap: [1.2, 3], height: (r) => (r.chance(0.3) ? r.range(18, 34) : r.range(8, 16)) },
  harbor: { maxLot: 48, gap: [4, 8], height: (r) => r.range(8, 15) },
};

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function split(r: Rect, maxLot: number, rng: Rng, out: Rect[], depth = 0): void {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  if ((w <= maxLot && d <= maxLot) || depth > 8) {
    out.push(r);
    return;
  }
  const t = rng.range(0.38, 0.62);
  if (w >= d) {
    const x = r.x0 + w * t;
    split({ ...r, x1: x }, maxLot, rng, out, depth + 1);
    split({ ...r, x0: x }, maxLot, rng, out, depth + 1);
  } else {
    const z = r.z0 + d * t;
    split({ ...r, z1: z }, maxLot, rng, out, depth + 1);
    split({ ...r, z0: z }, maxLot, rng, out, depth + 1);
  }
}

/** Generate buildings for a block (inside its sidewalk ring), around its landmark if any. centerFactor 0..1 = closeness to city center. */
export function generateBuildings(block: Block, rng: Rng, centerFactor: number, features: CityFeatures): Building[] {
  const sw = CONFIG.SIDEWALK;
  const inner: Rect = { x0: block.min.x + sw, z0: block.min.z + sw, x1: block.max.x - sw, z1: block.max.z - sw };
  const kind = features.kinds[block.id];
  // Own stream: these blocks used to be empty, and drawing on the shared one would move every block after them
  if (kind === 'park') return generateIn(block, inner, new Rng((CONFIG.SEED + 97 * (block.id + 1)) >>> 0), centerFactor);
  if (kind === 'lot') return [];
  const canal = features.canal;
  if (canal && block.gj === canal.row) {
    // Two rows of buildings backing onto the water, with a narrow quay between
    const north = generateIn(block, { ...inner, z1: canal.z0 - 1.5 }, rng, centerFactor);
    const south = generateIn(block, { ...inner, z0: canal.z1 + 1.5 }, rng, centerFactor);
    for (const b of north) if (b.faces.includes('S')) b.canalFace = 'S';
    for (const b of south) if (b.faces.includes('N')) b.canalFace = 'N';
    return [...north, ...south];
  }
  const stop = kind === 'pitStop' ? features.pitStops.find((p) => p.block === block.id) : undefined;
  const out = generateIn(block, inner, rng, centerFactor);
  return stop ? clearForecourt(out, stop) : out;
}

function generateIn(block: Block, inner: Rect, rng: Rng, centerFactor: number): Building[] {
  const out: Building[] = [];

  // The Dispatch Office HQ: tower and loading-dock wings (`Depot.ts`); one draw, so the stream stays the same
  if (block.district === 'depot') return depotBuildings({ minX: inner.x0, minZ: inner.z0, maxX: inner.x1, maxZ: inner.z1 }, rng.int(0, 1e6));

  const rule = RULES[block.district];
  const lots: Rect[] = [];
  split(inner, rule.maxLot, rng, lots);
  const eps = 0.01;
  for (const lot of lots) {
    const faces: Facing[] = [];
    if (lot.x0 <= inner.x0 + eps) faces.push('W');
    if (lot.x1 >= inner.x1 - eps) faces.push('E');
    if (lot.z0 <= inner.z0 + eps) faces.push('N');
    if (lot.z1 >= inner.z1 - eps) faces.push('S');
    const interior = faces.length === 0;
    if (interior && block.district === 'harbor') continue;
    if (block.district === 'harbor' && rng.chance(0.3)) continue; // container yards
    const g = rng.range(rule.gap[0], rule.gap[1]) * 0.5;
    const b: Building = {
      minX: lot.x0 + g,
      maxX: lot.x1 - g,
      minZ: lot.z0 + g,
      maxZ: lot.z1 - g,
      height: rule.height(rng, centerFactor) * (interior ? 0.8 : 1),
      district: block.district,
      faces,
      seed: rng.int(0, 1e6),
    };
    if (b.maxX - b.minX < 3 || b.maxZ - b.minZ < 3) continue;
    const minDim = Math.min(b.maxX - b.minX, b.maxZ - b.minZ);
    if (block.district === 'downtown' && b.height > 42 && minDim > 15 && rng.chance(0.7)) {
      b.tower = { inset: Math.min(5, Math.max(2, minDim * rng.range(0.1, 0.18))), podium: rng.range(9, 18) };
    }
    out.push(b);
  }
  return out;
}
