import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import type { AABB, Axis, Block, Building, Facing, Interior } from '../types';
import { inBox, inner, type Alley } from './Features';
import type { CityModel } from './RoadGraph';

/**
 * Shortcuts through the blocks (IMPROVEMENTS #19), pure data: straight alleys cut between the buildings
 * from street to street, drive-through passages where an alley runs under a street-front building, and a
 * few hidden dead-end nooks under buildings to hide in. Passages and nooks are `Interior`s carved out of the
 * building's ground floor (`Building.cavity`), so collisions, sight lines, the camera and rain already know
 * about them. A long block always gets a through-lane, and one that is long both ways gets a crossing, so
 * the middle is a junction between buildings. Enclosed gardens are left alone (their gates are the way in).
 * Runs after the home is planned (its block is left alone) and before buildings are re-settled.
 */

export const ALLEY = {
  /** Lane width (a car is ~1.8 m wide). */
  width: 6,
  /** Buildings beside an open alley stand back this far from its edge. */
  setback: 0.3,
  /** Smallest building piece kept beside an alley (narrower slivers are dropped). */
  minPiece: 3,
  /** Clear height under a passage / nook ceiling, above the highest point of its floor. */
  clear: 4.2,
  /** Building kept on each side of a passage (its side walls). */
  passageWall: 2.5,
  /** Passages and nooks only where the floor under them is close to level (m of rise). */
  maxRise: 1.0,
  /** Share of eligible blocks with an alley, and of large alley blocks with a second, crossing one. */
  chance: 0.55,
  crossChance: 0.35,
  /** Chance that a building spanning an alley keeps standing over it (a passage) instead of being split. */
  passageChance: 0.75,
  /** Hidden covered nooks off the streets: how many, their width and depth range. */
  nooks: 10,
  nookWidth: 6.4,
  nookDepth: [7, 10] as [number, number],
  /** Nook entrances at least this far from the block corners. */
  nookCorner: 14,
};

/** Floors of flats left above a passage or nook (m above its ceiling). */
const ABOVE = 6;

const across = (axis: Axis, b: AABB): [number, number] => (axis === 'z' ? [b.minX, b.maxX] : [b.minZ, b.maxZ]);
const alongLen = (axis: Axis, b: AABB): number => (axis === 'z' ? b.maxZ - b.minZ : b.maxX - b.minX);
const overlaps = (a: AABB, b: AABB, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;

/** Plan alleys, passages and nooks into `city.features` and reshape `city.buildings` around them. */
export function planAlleys(city: CityModel, seed: number): void {
  const rng = new Rng(seed);
  const f = city.features;
  const eligible = (bl: Block) =>
    f.kinds[bl.id] === 'normal' &&
    bl.gj !== f.canal?.row &&
    (bl.district === 'residential' || bl.district === 'oldtown' || bl.district === 'downtown');
  for (const bl of city.blocks) {
    if (!eligible(bl) || isCourt(city, bl)) continue;
    const r = inner(bl);
    const axes = alleyAxes(r.maxX - r.minX, r.maxZ - r.minZ, rng);
    if (!axes) continue;
    for (const axis of axes) cutAlley(city, bl, axis, rng);
  }
  planNooks(city, rng, eligible);
}

/** A garden that fills the court (`maps/montreal/Courtyards.ts`): no alley through the lawn. */
function isCourt(city: CityModel, bl: Block): boolean {
  return (city.features.parks ?? []).some((p) => p.enclosed && p.block === bl.id);
}

/**
 * Lanes for one block. A long block always opens onto the streets at its ends. A block that is long both
 * ways gets a second lane across the first, so you are not committed to one corridor the length of the block.
 */
function alleyAxes(w: number, d: number, rng: Rng): Axis[] | null {
  const longX = w >= 78;
  const longZ = d >= 78;
  if (longX || longZ) {
    const first: Axis = w >= d ? 'x' : 'z';
    const axes: Axis[] = [first];
    if ((longX && longZ) || (Math.min(w, d) > 52 && rng.chance(0.65))) axes.push(first === 'x' ? 'z' : 'x');
    return axes;
  }
  if (!rng.chance(ALLEY.chance)) return null;
  const first: Axis = rng.chance(0.5) ? 'x' : 'z';
  const axes: Axis[] = [first];
  if (w > 60 && d > 60 && rng.chance(ALLEY.crossChance)) axes.push(first === 'x' ? 'z' : 'x');
  return axes;
}

/** Buildings standing on a block (by their center). */
function buildingsIn(city: CityModel, bl: Block): Building[] {
  return city.buildings.filter((b) => {
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    return cx > bl.min.x && cx < bl.max.x && cz > bl.min.z && cz < bl.max.z;
  });
}

/** Lowest and highest ground under a box (sampled on a grid). */
function riseUnder(city: CityModel, r: AABB): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let k = 0; k <= 4; k++) {
      const h = city.terrain.heightAt(r.minX + ((r.maxX - r.minX) * i) / 4, r.minZ + ((r.maxZ - r.minZ) * k) / 4);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return { lo, hi };
}

function cutAlley(city: CityModel, bl: Block, axis: Axis, rng: Rng): void {
  const f = city.features;
  const r = inner(bl);
  const W = ALLEY.width;
  const [a0, a1] = across(axis, r);
  const c = a0 + (a1 - a0) * rng.range(0.32, 0.68);
  const lo = c - W / 2;
  const hi = c + W / 2;
  const cut0 = lo - ALLEY.setback;
  const cut1 = hi + ALLEY.setback;
  const hits = buildingsIn(city, bl).filter((b) => {
    const [b0, b1] = across(axis, b);
    return b1 > cut0 && b0 < cut1;
  });
  // Never through a passage of the crossing alley
  if (hits.some((b) => b.cavity)) return;
  const box: AABB = axis === 'z' ? { minX: lo, maxX: hi, minZ: bl.min.z, maxZ: bl.max.z } : { minX: bl.min.x, maxX: bl.max.x, minZ: lo, maxZ: hi };
  // Facades looking onto the alley: the piece before it (smaller coordinate) and the one after
  const nearFace: Facing = axis === 'z' ? 'E' : 'S';
  const farFace: Facing = axis === 'z' ? 'W' : 'N';
  const removed = new Set<Building>();
  const added: Building[] = [];
  for (const b of hits) {
    const [b0, b1] = across(axis, b);
    // A passage only under the street frontage. Inner buildings are split, so the lane stays open between them
    // instead of becoming a tunnel the length of the block.
    const sw = CONFIG.SIDEWALK + 3;
    const atStreet = axis === 'z' ? b.minZ <= bl.min.z + sw || b.maxZ >= bl.max.z - sw : b.minX <= bl.min.x + sw || b.maxX >= bl.max.x - sw;
    if (atStreet && b0 <= lo - ALLEY.passageWall && b1 >= hi + ALLEY.passageWall && rng.chance(ALLEY.passageChance) && carvePassage(city, b, axis, lo, hi)) continue;
    removed.add(b);
    if (cut0 - b0 >= ALLEY.minPiece) added.push(piece(b, axis, b0, cut0, nearFace, b.seed, b.height));
    if (b1 - cut1 >= ALLEY.minPiece) added.push(piece(b, axis, cut1, b1, farFace, rng.int(0, 1e6), Math.max(5, b.height * rng.range(0.8, 1.2))));
  }
  city.buildings = city.buildings.filter((b) => !removed.has(b)).concat(added);
  f.alleys.push({ block: bl.id, axis, box });
}

/** Part of `b` between p0 and p1 across the alley, with a facade onto the alley (if it had street faces). */
function piece(b: Building, axis: Axis, p0: number, p1: number, face: Facing, seed: number, height: number): Building {
  const q: Building = { ...b, seed, height, faces: [...b.faces.filter((x) => x !== face), face] };
  if (axis === 'z') {
    q.minX = p0;
    q.maxX = p1;
  } else {
    q.minZ = p0;
    q.maxZ = p1;
  }
  if (q.tower && Math.min(q.maxX - q.minX, q.maxZ - q.minZ) < 2 * q.tower.inset + 6) delete q.tower;
  return q;
}

/** Keep `b` over the alley with a drive-through passage under it, if it suits (tall enough, level floor). */
function carvePassage(city: CityModel, b: Building, axis: Axis, lo: number, hi: number): boolean {
  if (b.cavity || b.tower || b.district === 'harbor' || b.height < 9 || alongLen(axis, b) < 5) return false;
  const box: AABB = axis === 'z' ? { minX: lo, maxX: hi, minZ: b.minZ, maxZ: b.maxZ } : { minX: b.minX, maxX: b.maxX, minZ: lo, maxZ: hi };
  const g = riseUnder(city, box);
  if (g.hi - g.lo > ALLEY.maxRise) return false;
  const f = city.features;
  const doors: Interior['doors'] =
    axis === 'z'
      ? [
          { side: 'N', from: lo, to: hi },
          { side: 'S', from: lo, to: hi },
        ]
      : [
          { side: 'W', from: lo, to: hi },
          { side: 'E', from: lo, to: hi },
        ];
  const top = g.hi + ALLEY.clear;
  const room: Interior = { id: `passage-${f.interiors.length}`, kind: 'passage', box, floor: g.lo, height: top - g.lo, doors, hidden: false };
  b.cavity = room;
  b.height = Math.max(b.height, top - (b.floorY ?? CONFIG.CURB_HEIGHT) + ABOVE);
  f.interiors.push(room);
  return true;
}

interface NookSpot {
  bl: Block;
  b: Building;
  side: Facing;
  box: AABB;
  drive: AABB;
}

/** Hidden covered nooks: a car-wide bay under a building, open to the street, a few meters deep. */
function planNooks(city: CityModel, rng: Rng, eligible: (bl: Block) => boolean): void {
  const f = city.features;
  const spots: NookSpot[] = [];
  for (const bl of city.blocks) {
    if (!eligible(bl) || isCourt(city, bl)) continue;
    const r = inner(bl);
    for (const b of buildingsIn(city, bl)) {
      if (b.cavity || b.tower || b.height < 9) continue;
      for (const side of b.faces) {
        // Street facades only (not the ones onto an alley): the facade stands near the sidewalk ring
        const edge = side === 'N' ? b.minZ - r.minZ : side === 'S' ? r.maxZ - b.maxZ : side === 'W' ? b.minX - r.minX : r.maxX - b.maxX;
        if (edge > 2) continue;
        const s = nookSpot(city, rng, bl, b, side);
        if (s) spots.push(s);
      }
    }
  }
  // Shuffle, then one nook per block
  for (let i = spots.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const used = new Set<Block>();
  for (const s of spots) {
    if (used.size >= ALLEY.nooks) break;
    if (used.has(s.bl) || s.b.cavity) continue;
    used.add(s.bl);
    const g = riseUnder(city, s.box);
    const top = g.hi + ALLEY.clear - 0.4;
    const room: Interior = {
      id: `nook-${f.interiors.length}`,
      kind: 'nook',
      box: s.box,
      floor: g.lo,
      height: top - g.lo,
      doors: [{ side: s.side, ...(s.side === 'N' || s.side === 'S' ? { from: s.box.minX, to: s.box.maxX } : { from: s.box.minZ, to: s.box.maxZ }) }],
      hidden: true,
    };
    s.b.cavity = room;
    s.b.height = Math.max(s.b.height, top - (s.b.floorY ?? CONFIG.CURB_HEIGHT) + ABOVE);
    f.interiors.push(room);
    f.driveways.push(s.drive);
  }
}

function nookSpot(city: CityModel, rng: Rng, bl: Block, b: Building, side: Facing): NookSpot | null {
  const ns = side === 'N' || side === 'S';
  const f0 = ns ? b.minX : b.minZ;
  const f1 = ns ? b.maxX : b.maxZ;
  const depth = ns ? b.maxZ - b.minZ : b.maxX - b.minX;
  const k0 = ns ? bl.min.x : bl.min.z;
  const k1 = ns ? bl.max.x : bl.max.z;
  const W = ALLEY.nookWidth;
  const D = Math.min(rng.range(ALLEY.nookDepth[0], ALLEY.nookDepth[1]), depth - ALLEY.passageWall);
  if (D < ALLEY.nookDepth[0] - 0.01 || f1 - f0 < W + 2 * ALLEY.passageWall) return null;
  const lo = Math.max(f0 + ALLEY.passageWall, k0 + ALLEY.nookCorner);
  const hi = Math.min(f1 - ALLEY.passageWall - W, k1 - ALLEY.nookCorner - W);
  if (hi < lo) return null;
  const a0 = rng.range(lo, hi);
  const a1 = a0 + W;
  const fl = 0.4;
  let box: AABB;
  let drive: AABB;
  if (side === 'N') {
    box = { minX: a0, maxX: a1, minZ: b.minZ, maxZ: b.minZ + D };
    drive = { minX: a0 - fl, maxX: a1 + fl, minZ: bl.min.z, maxZ: b.minZ };
  } else if (side === 'S') {
    box = { minX: a0, maxX: a1, minZ: b.maxZ - D, maxZ: b.maxZ };
    drive = { minX: a0 - fl, maxX: a1 + fl, minZ: b.maxZ, maxZ: bl.max.z };
  } else if (side === 'W') {
    box = { minX: b.minX, maxX: b.minX + D, minZ: a0, maxZ: a1 };
    drive = { minX: bl.min.x, maxX: b.minX, minZ: a0 - fl, maxZ: a1 + fl };
  } else {
    box = { minX: b.maxX - D, maxX: b.maxX, minZ: a0, maxZ: a1 };
    drive = { minX: b.maxX, maxX: bl.max.x, minZ: a0 - fl, maxZ: a1 + fl };
  }
  const f = city.features;
  if (f.alleys.some((a) => overlaps(a.box, drive, 3)) || f.driveways.some((d) => overlaps(d, drive, 3))) return null;
  // The drive across the sidewalk must not clip another building standing in front (setback lots)
  if (city.buildings.some((o) => o !== b && overlaps(o, drive))) return null;
  const g = riseUnder(city, { minX: Math.min(box.minX, drive.minX), maxX: Math.max(box.maxX, drive.maxX), minZ: Math.min(box.minZ, drive.minZ), maxZ: Math.max(box.maxZ, drive.maxZ) });
  if (g.hi - g.lo > ALLEY.maxRise * 0.6) return null;
  return { bl, b, side, box, drive };
}

/** The alley a point is in (null if none). */
export const alleyAt = (list: Alley[], p: { x: number; z: number }): Alley | null => list.find((a) => inBox(p, a.box)) ?? null;
