import { CONFIG } from '../config';
import { Rng, hash01 } from '../core/Rng';
import type { AABB, Block, Building, Facing } from '../types';
import { inner } from './Features';
import { partFaces, subtractRect } from './Interiors';
import { blockRoads, type CityModel } from './RoadGraph';

/**
 * Skyline dressing after the city is planned (own decisions, so alleys and lot landmarks stay put):
 * stepped crowns and twin-tower notches on the offices, a little height where the skyline was flat,
 * and a handful of large square media blocks on downtown corners — Shibuya scramble buildings,
 * retail plinth under a glass shaft you can see down the avenues.
 */

const SCRAMBLE_COUNT = 4;
const SCRAMBLE_COLORS: [number, number, number][] = [
  [0.04, 0.046, 0.068],
  [0.05, 0.038, 0.052],
  [0.034, 0.048, 0.058],
  [0.052, 0.046, 0.04],
];

const overlaps = (a: AABB, b: AABB, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
const grow = (b: AABB, m: number): AABB => ({ minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m });

export function dressSkyline(city: CityModel): void {
  varySilhouettes(city);
  placeScrambles(city);
  addPlainTowers(city);
  raisePeaks(city);
}

function minDim(b: AABB): number {
  return Math.min(b.maxX - b.minX, b.maxZ - b.minZ);
}

/** Keep a tower's setbacks inside its footprint and below the roof. */
function clampTower(b: Building): void {
  const t = b.tower;
  if (!t) return;
  const span = minDim(b);
  if (t.podium > b.height - 8) t.podium = Math.max(6, b.height * 0.45);
  if (span < t.inset * 2 + 6) {
    delete b.tower;
    return;
  }
  let inset = t.inset;
  const steps = [];
  for (const s of [...(t.steps ?? [])].sort((a, c) => a.at - c.at)) {
    if (s.at < t.podium + 5 || s.at > b.height - 6) continue;
    if (span < (inset + s.inset) * 2 + 6) continue;
    steps.push(s);
    inset += s.inset;
  }
  if (steps.length) t.steps = steps;
  else delete t.steps;
  if (t.notch && span < t.inset * 2 + 15) delete t.notch;
}

/** `n` extra setbacks, evenly up the shaft. Replaces any steps already stored. */
function pushSteps(b: Building, n: number): void {
  const t = b.tower;
  if (!t) return;
  const span = b.height - t.podium;
  const wide = minDim(b);
  if (span < 18) return;
  const steps = [];
  let inset = t.inset;
  for (let i = 1; i <= n; i++) {
    const at = t.podium + (span * i) / (n + 1);
    const add = 1.5 + hash01(b.seed, 40 + i) * 1.8;
    if (wide < (inset + add) * 2 + 6) break;
    steps.push({ inset: add, at });
    inset += add;
  }
  if (steps.length) t.steps = steps;
}

function varySilhouettes(city: CityModel): void {
  for (const b of city.buildings) {
    if (b.landmark || b.obb) continue;
    const wide = minDim(b);

    // The outer band is only a horizon. Vary its height; street buildings are handled below.
    if (b.district === 'residential' && b.faces.length === 0) {
      const h = hash01(b.seed, 2);
      b.height *= 0.62 + h * 1.2;
      if (h > 0.58 && wide > 16 && b.height > 36) {
        b.tower = { inset: 2 + h * 3, podium: b.height * (0.34 + (h - 0.58) * 0.25) };
        if (h > 0.86) b.tower.steps = [{ inset: 2, at: b.height * 0.74 }];
        clampTower(b);
      }
      continue;
    }

    if (b.district === 'shotengai') {
      // Taller shop houses, still under the mast threshold. The pit-stop kiosk is 4.6 m and lives in the
      // features, so leave anything shorter than a generated shop alone.
      if (b.height >= 5) b.height *= 1 + hash01(b.seed, 4) * 0.28;
      continue;
    }

    if (b.district === 'residential') {
      const h = hash01(b.seed, 5);
      if (!b.cavity && b.height > 28 && wide > 12 && h > 0.6) {
        const podium = 8 + h * 7;
        const inset = Math.min((wide - 8) / 2, 1.3 + h * 1.4);
        if (b.height > podium + 8 && inset >= 1.2) {
          b.tower = { inset, podium };
          if (h > 0.88) b.tower.steps = [{ inset: 1.3, at: podium + (b.height - podium) * 0.6 }];
          clampTower(b);
        }
      }
      continue;
    }

    if (b.district !== 'downtown' || !b.tower || b.cavity) continue;
    const h = hash01(b.seed, 6);
    // Already tall enough for a penthouse in the detail pass; growing them doesn't add a new draw
    if (b.height > 62 && wide > 14 && h > 0.3) b.height = Math.min(176, b.height + 12 + h * 42);
    const kind = hash01(b.seed, 7);
    if (kind >= 0.7 && wide - 2 * b.tower.inset > 12) b.tower.notch = 2.8 + (kind - 0.7) * 5;
    else if (kind >= 0.22) pushSteps(b, kind < 0.48 ? 1 : 2);
    clampTower(b);
  }
}

/** Towers on downtown blocks that were plain slabs, with a shaft still wide enough for the old roof clutter. */
function addPlainTowers(city: CityModel): void {
  for (const b of city.buildings) {
    if (b.district !== 'downtown' || b.tower || b.cavity || b.landmark || b.scramble || b.obb) continue;
    const wide = minDim(b);
    const h = hash01(b.seed, 11);
    if (b.height < 46 || wide < 15 || h < 0.4) continue;
    const inset = Math.min((wide - 12) / 2, 2 + h * 2.5);
    const podium = 10 + h * 8;
    if (inset < 1.8 || podium > b.height - 8) continue;
    b.tower = { inset, podium };
    if (h > 0.72) pushSteps(b, 1);
    if (b.height > 62) b.height = Math.min(168, b.height + 8 + h * 20);
    clampTower(b);
  }
}

/** A few spaced needles, so the skyline has peaks instead of a flat lid. */
function raisePeaks(city: CityModel): void {
  const peaks = city.buildings
    .filter((b) => b.district === 'downtown' && b.tower && !b.scramble && !b.landmark && !b.cavity && b.height > 70)
    .sort((a, b) => b.height - a.height)
    .filter((b, i, arr) => arr.slice(0, i).every((o) => Math.hypot((o.minX + o.maxX) / 2 - (b.minX + b.maxX) / 2, (o.minZ + o.maxZ) / 2 - (b.minZ + b.maxZ) / 2) > 80))
    .slice(0, 5);
  for (const b of peaks) {
    b.height = Math.min(200, b.height + 18);
    const t = b.tower!;
    const at = b.height - 20;
    if (at > t.podium + 16) t.steps = [...(t.steps ?? []), { inset: 1.6, at }];
    clampTower(b);
  }
}

function centerIn(bl: Block, b: AABB): boolean {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return cx > bl.min.x && cx < bl.max.x && cz > bl.min.z && cz < bl.max.z;
}

/** Something the square must not swallow: an alley, a garage / nook, a landmark. */
function blocked(city: CityModel, bl: Block, box: AABB): boolean {
  const zone = grow(box, 1.6);
  const f = city.features;
  if (f.alleys.some((a) => a.block === bl.id && overlaps(a.box, zone))) return true;
  if (f.interiors.some((r) => overlaps(r.box, zone))) return true;
  return city.buildings.some((b) => (b.cavity || b.landmark || b.obb) && centerIn(bl, b) && overlaps(b, zone));
}

function cornerBox(r: AABB, sx: -1 | 1, sz: -1 | 1, side: number): AABB {
  const m = 0.65;
  return {
    minX: sx < 0 ? r.minX + m : r.maxX - m - side,
    maxX: sx < 0 ? r.minX + m + side : r.maxX - m,
    minZ: sz < 0 ? r.minZ + m : r.maxZ - m - side,
    maxZ: sz < 0 ? r.minZ + m + side : r.maxZ - m,
  };
}

function streetFaces(box: AABB, r: AABB): Facing[] {
  const e = 1.35;
  const faces: Facing[] = [];
  if (box.minZ <= r.minZ + e) faces.push('N');
  if (box.maxZ >= r.maxZ - e) faces.push('S');
  if (box.minX <= r.minX + e) faces.push('W');
  if (box.maxX >= r.maxX - e) faces.push('E');
  return faces;
}

/** Largest square that fits in `corner` without crossing an alley or a carved interior. */
function fitCorner(city: CityModel, bl: Block, r: AABB, sx: -1 | 1, sz: -1 | 1): { box: AABB; faces: Facing[]; side: number } | null {
  const room = Math.min(r.maxX - r.minX, r.maxZ - r.minZ);
  let best: { box: AABB; faces: Facing[]; side: number } | null = null;
  for (let side = Math.min(62, room - 8); side >= 42; side -= 2) {
    const box = cornerBox(r, sx, sz, side);
    if (box.minX < r.minX - 0.01 || box.maxX > r.maxX + 0.01 || box.minZ < r.minZ - 0.01 || box.maxZ > r.maxZ + 0.01) continue;
    if (blocked(city, bl, box)) continue;
    const faces = streetFaces(box, r);
    if (faces.length === 0) continue;
    best = { box, faces, side };
    break;
  }
  return best;
}

function keepPiece(src: Building, p: Building): Building | null {
  const w = p.maxX - p.minX;
  const d = p.maxZ - p.minZ;
  if (w < 3.4 || d < 3.4) return null;
  const q: Building = { ...p, faces: partFaces(src, p, 2) };
  if (q.tower) {
    let need = q.tower.inset;
    for (const s of q.tower.steps ?? []) need += s.inset;
    if (Math.min(w, d) < need * 2 + 6) delete q.tower;
    else if (q.tower.notch && Math.min(w, d) < 16) delete q.tower.notch;
  }
  return q;
}

function cutForSquare(city: CityModel, bl: Block, square: AABB): void {
  const zone = grow(square, 1.35);
  const next: Building[] = [];
  for (const b of city.buildings) {
    if (!centerIn(bl, b) || b.cavity || b.landmark || b.obb || !overlaps(b, zone)) {
      next.push(b);
      continue;
    }
    for (const p of subtractRect(b, zone)) {
      const piece = keepPiece(b, p);
      if (piece) next.push(piece);
    }
  }
  city.buildings = next;
}

function placeScrambles(city: CityModel): void {
  const rng = new Rng(CONFIG.SEED + 44);
  /** A boulevard is at least this wide each side of its centerline; a street or cobble lane is less. */
  const WIDE = 9;
  const ranked = city.blocks
    .filter((bl) => city.features.kinds[bl.id] === 'normal' && bl.district === 'downtown' && bl.gj !== city.features.canal?.row)
    .filter((bl) => !(city.features.parks ?? []).some((p) => p.enclosed && p.block === bl.id))
    .map((bl) => {
      const r = inner(bl);
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const side = blockRoads(city, bl);
      const ave = [side.N, side.S, side.W, side.E].filter((hw) => hw > WIDE).length;
      return { bl, r, w, d, ave, score: ave * 80 - Math.hypot(bl.center.x, bl.center.z) * 0.12 + Math.min(w, d) };
    })
    .filter((c) => c.w >= 58 && c.d >= 58)
    .sort((a, b) => b.score - a.score);

  const placed: Block[] = [];
  const sepOk = (bl: Block, sep: number) => placed.every((p) => Math.abs(p.gi - bl.gi) + Math.abs(p.gj - bl.gj) >= sep);

  const consider = (sep: number) => {
    for (const c of ranked) {
      if (placed.length >= SCRAMBLE_COUNT) return;
      if (!sepOk(c.bl, sep)) continue;
      const side = blockRoads(city, c.bl);
      const hw = (sx: -1 | 1, sz: -1 | 1) => (sx < 0 ? side.W : side.E) + (sz < 0 ? side.N : side.S);
      let pick: { box: AABB; faces: Facing[]; side: number; score: number } | null = null;
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          const fit = fitCorner(city, c.bl, c.r, sx, sz);
          if (!fit) continue;
          // a corner on at least one boulevard
          const score = fit.side + (hw(sx, sz) > WIDE + 4 ? 10 : 0);
          if (!pick || score > pick.score) pick = { ...fit, score };
        }
      }
      if (!pick) continue;
      cutForSquare(city, c.bl, pick.box);
      const height = 158 + rng.range(0, 32);
      const podium = rng.range(13, 18);
      const crownAt = Math.min(height - 16, Math.max(podium + 28, height * 0.84));
      const steps = [{ inset: rng.range(1.3, 2.2), at: crownAt }];
      if (rng.chance(0.5)) steps.push({ inset: rng.range(1.2, 2), at: podium + (crownAt - podium) * 0.55 });
      city.buildings.push({
        ...pick.box,
        height,
        district: 'downtown',
        faces: pick.faces,
        seed: rng.int(0, 1e6),
        scramble: true,
        tower: { inset: rng.range(2.2, 3.6), podium, steps },
        facade: { style: 4, color: SCRAMBLE_COLORS[placed.length % SCRAMBLE_COLORS.length], lit: 0.86 },
      });
      placed.push(c.bl);
    }
  };
  consider(3);
  consider(2);
}
