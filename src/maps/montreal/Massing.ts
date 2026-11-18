import type { Block, Building, Facing } from '../../types';
import type { CityModel } from '../../world/RoadGraph';
import { CONFIG } from '../../config';
import { carveBuilding } from './Parks';
import { ARENA, BASILICA, SILOS, heightOf } from './layout';

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
 * Parks, squares, the canal and the landmark blocks keep only their street wall: those planners open the
 * middle themselves. Every other block keeps the buildings behind the frontage. A hollow court with an
 * alley through it is not a Montreal lane; `layCourtyards` turns some of the large ones into gardens, and
 * the rest stay built so a through-alley runs between buildings.
 */
export function openCourtyards(city: CityModel): void {
  const f = city.features;
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
    const bl = city.blocks[id];
    const opened = bl.gj === f.canal?.row || f.kinds[id] === 'park' || f.kinds[id] === 'square' || f.kinds[id] === 'bridge' || f.kinds[id] === 'lot';
    if (!opened) {
      keep.push(...list);
      continue;
    }
    keep.push(...list.filter((b) => b.faces.length > 0 || b.landmark));
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

/** Notre-Dame Basilica, in meters (PRD 4.4: twin towers, rose window, stone; low poly). */
export const BASILICA_SIZE = {
  width: 40,
  depth: 74,
  /** Parvis between the sidewalk and the front steps. */
  parvis: 8,
  tower: 12.5,
  /** Top of the towers' parapet; the corner pinnacles rise above it (the real towers are 69 m). */
  towerH: 61,
  eaves: 22,
  ridge: 33,
};

/**
 * The basilica replaces the middle of its block's Notre-Dame frontage: the buildings on its footprint and the
 * parvis go, the rest of the block keeps its street wall. Its colliders are plain footprint boxes (two towers,
 * the front between them, the nave) with `custom` set: `LandmarkView` draws it.
 */
export function placeBasilica(city: CityModel): void {
  const bl = city.blocks.find((b) => b.gi === BASILICA.i && b.gj === BASILICA.j);
  if (!bl) return;
  const S = BASILICA_SIZE;
  const sw = CONFIG.SIDEWALK;
  const cx = (bl.min.x + bl.max.x) / 2;
  const minX = cx - S.width / 2;
  const maxX = cx + S.width / 2;
  const minZ = bl.min.z + sw + S.parvis;
  const maxZ = Math.min(bl.max.z - sw - 6, minZ + S.depth);
  const hole = { minX: minX - 3, maxX: maxX + 3, minZ: bl.min.z, maxZ: maxZ + 3 };
  const kept: Building[] = [];
  for (const b of city.buildings) {
    const next = carveBuilding(b, [hole]);
    if (next) kept.push(next);
  }
  city.buildings = kept;
  const t = S.tower;
  const part = (x0: number, x1: number, z0: number, z1: number, height: number, seed: number): Building => ({
    minX: x0,
    maxX: x1,
    minZ: z0,
    maxZ: z1,
    height,
    district: 'oldtown',
    faces: [],
    seed,
    landmark: true,
    custom: 'basilica',
  });
  city.buildings.push(
    part(minX, minX + t, minZ, minZ + t, S.towerH, 1824),
    part(maxX - t, maxX, minZ, minZ + t, S.towerH, 1825),
    part(minX + t, maxX - t, minZ, minZ + t, S.ridge + 4, 1826),
    part(minX + 1.5, maxX - 1.5, minZ + t, maxZ, S.ridge, 1827),
  );
  // On the ground at its front steps (Vieux-Montréal is level, but the hill starts a block north)
  const y = city.terrain.base(cx, minZ - 1) + CONFIG.CURB_HEIGHT;
  city.features.basilica = { minX, maxX, minZ, maxZ, tower: t, towerH: S.towerH, eaves: S.eaves, ridge: S.ridge, y };
}
