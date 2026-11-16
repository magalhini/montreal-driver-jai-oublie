import type { Block, Building, Facing } from '../../types';
import type { CityModel } from '../../world/RoadGraph';
import { ARENA, CLOCK, SILOS, heightOf } from './layout';

const faces = (list: Facing[]): Facing[] => list;

function blockBuildings(city: CityModel, bl: Block): Building[] {
  return city.buildings.filter((b) => {
    const x = (b.minX + b.maxX) / 2;
    const z = (b.minZ + b.maxZ) / 2;
    return x > bl.min.x && x < bl.max.x && z > bl.min.z && z < bl.max.z;
  });
}

function dropBlock(city: CityModel, bl: Block): void {
  const keep = new Set(blockBuildings(city, bl));
  city.buildings = city.buildings.filter((b) => !keep.has(b));
}

/**
 * Montreal blocks are larger than Tokyo's, and the lot splitter would fill them solid.
 * Keep the street wall. Downtown also keeps its two tallest courtyard buildings, so the tower cluster
 * is not only the frontage.
 */
export function openCourtyards(city: CityModel): void {
  const groups = new Map<number, Building[]>();
  const outside: Building[] = [];
  for (const b of city.buildings) {
    const bl = city.blockAt({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
    if (!bl) {
      outside.push(b);
      continue;
    }
    const list = groups.get(bl.id);
    if (list) list.push(b);
    else groups.set(bl.id, [b]);
  }
  const keep = [...outside];
  for (const [id, list] of groups) {
    const edge = list.filter((b) => b.faces.length > 0 || b.landmark);
    keep.push(...edge);
    if (city.blocks[id].district !== 'downtown') continue;
    const inner = list.filter((b) => b.faces.length === 0 && !b.landmark).sort((a, b) => b.height - a.height);
    keep.push(...inner.slice(0, 2));
  }
  city.buildings = keep;
}

/** Pull each block's roofs into that block's measured height range, keeping which building was tallest. */
export function fitHeights(city: CityModel): void {
  const groups = new Map<number, Building[]>();
  for (const b of city.buildings) {
    if (b.landmark) continue;
    const bl = city.blockAt({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
    if (!bl) continue;
    const list = groups.get(bl.id);
    if (list) list.push(b);
    else groups.set(bl.id, [b]);
  }
  for (const [id, list] of groups) {
    const bl = city.blocks[id];
    const [lo, hi] = heightOf(bl.gi, bl.gj);
    let h0 = Infinity;
    let h1 = -Infinity;
    for (const b of list) {
      h0 = Math.min(h0, b.height);
      h1 = Math.max(h1, b.height);
    }
    for (const b of list) {
      const t = h1 === h0 ? 0.65 : (b.height - h0) / (h1 - h0);
      b.height = Math.round((lo + (hi - lo) * (0.22 + 0.78 * t)) * 10) / 10;
      const tW = b.tower;
      const span = Math.min(b.maxX - b.minX, b.maxZ - b.minZ);
      if (!tW) continue;
      if (b.height < 38 || span < tW.inset * 2 + 6) {
        delete b.tower;
        continue;
      }
      if (tW.podium > b.height - 8) tW.podium = Math.max(6, b.height * 0.42);
      if (tW.steps) {
        tW.steps = tW.steps.filter((s) => s.at > tW.podium + 4 && s.at < b.height - 6);
        if (!tW.steps.length) delete tW.steps;
      }
    }
  }
}

/** The arena is one low hall, not a stack of towers. */
export function placeArena(city: CityModel): void {
  const bl = city.blocks.find((b) => b.gi === ARENA.i && b.gj === ARENA.j);
  if (!bl) return;
  dropBlock(city, bl);
  const depth = Math.min(bl.max.z - 10, bl.min.z + 128) - (bl.min.z + 10);
  if (depth < 24) return;
  city.buildings.push({
    minX: bl.min.x + 8,
    maxX: bl.max.x - 8,
    minZ: bl.min.z + 10,
    maxZ: bl.min.z + 10 + depth,
    height: 32,
    district: 'harbor',
    faces: faces(['N', 'S', 'E', 'W']),
    seed: 1976,
  });
}

/** Narrow elevator towers on the basin, with a low shed behind them. */
export function placeSilos(city: CityModel): void {
  const bl = city.blocks.find((b) => b.gi === SILOS.i && b.gj === SILOS.j);
  if (!bl) return;
  dropBlock(city, bl);
  const z1 = bl.max.z - 8;
  const z0 = z1 - 22;
  let x = bl.min.x + 12;
  for (const [w, h] of [
    [16, 44],
    [14, 36],
    [18, 48],
    [12, 30],
  ] as const) {
    if (x + w > bl.max.x - 8) break;
    city.buildings.push({
      minX: x,
      maxX: x + w,
      minZ: z0,
      maxZ: z1,
      height: h,
      district: 'harbor',
      faces: faces(['S', 'E', 'W']),
      seed: 1900 + Math.round(x),
    });
    x += w + 5;
  }
  if (z0 - 8 > bl.min.z + 16) {
    city.buildings.push({
      minX: bl.min.x + 8,
      maxX: bl.max.x - 8,
      minZ: bl.min.z + 8,
      maxZ: z0 - 6,
      height: 11,
      district: 'harbor',
      faces: faces(['N', 'E', 'W']),
      seed: 1901,
    });
  }
}

/** A slim shaft at the southeast corner, standing in for the clock tower. */
export function placeClock(city: CityModel): void {
  const bl = city.blocks.find((b) => b.gi === CLOCK.i && b.gj === CLOCK.j);
  if (!bl) return;
  const s = 11;
  const box = { minX: bl.max.x - 8 - s, maxX: bl.max.x - 8, minZ: bl.max.z - 8 - s, maxZ: bl.max.z - 8 };
  city.buildings = city.buildings.filter(
    (b) => b.maxX < box.minX - 1 || b.minX > box.maxX + 1 || b.maxZ < box.minZ - 1 || b.minZ > box.maxZ + 1,
  );
  city.buildings.push({
    ...box,
    height: 46,
    district: 'residential',
    faces: faces(['N', 'S', 'E', 'W']),
    seed: 1922,
    tower: { inset: 1.3, podium: 14 },
  });
}
