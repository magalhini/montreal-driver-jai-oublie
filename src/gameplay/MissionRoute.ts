import type { Vec2 } from '../types';
import { CONFIG } from '../config';
import { travelHalf, type CityModel } from '../world/RoadGraph';
import type { CurbBay } from '../world/Features';

/**
 * The winter-tire GPS (a confident, slow one). Two stops, and the streets between them are pinned so the
 * search cannot slip onto the fast boulevards the whole way:
 *
 * 1. South on Lucien-L'Allier, a small street, then east on Ottawa to the tire storage in Griffintown: a
 *    storefront on the south side, one block short of de la Montagne, with a circle in the curb lane.
 * 2. North on de la Montagne into downtown, east on Notre-Dame, north on University through the centre,
 *    east on René-Lévesque across it, then south on De Bullion — small streets and the long avenues — to
 *    Jacques Pneu, on the other side of town.
 *
 * Grid indexes are `layout.ts` (columns west to east, rows mountain to river).
 */
/** Ottawa, from Lucien-L'Allier to de la Montagne: the block the storage stands on (the stop faces east). */
const STORAGE_FROM = { i: 1, j: 11 };
const STORAGE_TO = { i: 2, j: 11 };

/** Where the stop sits on that block, and how big its circle is. */
export const STORAGE_STOP = {
  /** Circle center, back from de la Montagne's junction box (m). */
  back: 34,
  /** Circle radius (m): the car's center must stop inside it. */
  r: 2.2,
  /** Circle center pulled from the middle of the parking band toward the lane (m), so the curb clips less of it. */
  pull: 0.45,
  /** Curb bays this close (m, along the street) to the circle center are not painted: nobody parks on it. */
  clearBays: 7,
};

/**
 * The winter-tire storage: the circle in the eastbound curb lane, and the roll-up door on the building face
 * across the sidewalk from it.
 */
export interface StorageStop {
  /** Circle center (on the road). */
  pos: Vec2;
  r: number;
  /** Heading of traffic in that lane (yaw), the way the car is meant to stop. */
  yaw: number;
  /** Ottawa's edge between the two junctions. */
  edge: number;
  /** Unit vector from the road toward the sidewalk and the storefront. */
  curb: Vec2;
  /** Middle of the roll-up door, on the building face. */
  door: Vec2;
}

/** Corners before the storage stop, in drive order. The last one turns the drive onto Ottawa, eastbound. */
const TO_STORAGE: { i: number; j: number }[] = [
  { i: 1, j: 2 },
  { i: 1, j: 5 },
  { i: 1, j: 8 },
  { i: 1, j: 10 },
  { i: 1, j: 11 },
];

/** René-Lévesque, the downtown boulevard the garage leg runs along: the first choice for its fence. */
export const MAIN_BOULEVARD_ROW = 4;

/** Corners after the tires are in the car, before the garage bay. */
const TO_GARAGE: { i: number; j: number }[] = [
  { i: 2, j: 8 },
  { i: 5, j: 8 },
  { i: 8, j: 8 },
  { i: 8, j: 6 },
  { i: 8, j: 4 },
  { i: 11, j: 4 },
  { i: 13, j: 4 },
  { i: 14, j: 4 },
  { i: 14, j: 8 },
  { i: 14, j: 10 },
];

const at = (city: CityModel, i: number, j: number): Vec2 => {
  const p = city.nodeAt(i, j).pos;
  return { x: p.x, z: p.z };
};

const stops = new WeakMap<CityModel, StorageStop>();

/** The storage stop on Ottawa (cached per city). Grid streets only: the block is axis aligned. */
export function storageStop(city: CityModel): StorageStop {
  const hit = stops.get(city);
  if (hit) return hit;
  const a = city.nodeAt(STORAGE_FROM.i, STORAGE_FROM.j);
  const b = city.nodeAt(STORAGE_TO.i, STORAGE_TO.j);
  const e = city.edgeBetween(a.id, b.id);
  if (!e) throw new Error('storage street missing');
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const len = Math.hypot(dx, dz);
  const dir = { x: dx / len, z: dz / len };
  // Traffic keeps right: the curb lane of a car driving from a to b is on its right
  const curb = { x: -dir.z, z: dir.x };
  const lat = e.parking > 0 ? travelHalf(e) + e.parking / 2 - STORAGE_STOP.pull : travelHalf(e) - e.laneWidth / 2;
  const back = Math.max(b.hx, b.hz) + STORAGE_STOP.back;
  const pos = { x: b.pos.x - dir.x * back + curb.x * lat, z: b.pos.z - dir.z * back + curb.z * lat };
  // The door: straight across the sidewalk, on the face of whichever building is there (or the back of the walk)
  const curbLat = e.width / 2;
  let depth = curbLat + CONFIG.SIDEWALK;
  for (const bd of city.buildings) {
    const near = Math.abs(dir.x) > 0.5 ? pos.x > bd.minX + 1.6 && pos.x < bd.maxX - 1.6 : pos.z > bd.minZ + 1.6 && pos.z < bd.maxZ - 1.6;
    if (!near) continue;
    // Distance of the building's street face from the centerline, on the curb side
    const faceLat = curb.z > 0.5 ? bd.minZ - b.pos.z : curb.z < -0.5 ? b.pos.z - bd.maxZ : curb.x > 0.5 ? bd.minX - b.pos.x : b.pos.x - bd.maxX;
    if (faceLat >= curbLat && faceLat < curbLat + CONFIG.SIDEWALK + 6) depth = faceLat;
  }
  const mid = { x: b.pos.x - dir.x * back, z: b.pos.z - dir.z * back };
  const door = { x: mid.x + curb.x * depth, z: mid.z + curb.z * depth };
  const stop: StorageStop = { pos, r: STORAGE_STOP.r, yaw: Math.atan2(dir.x, dir.z), edge: e.id, curb, door };
  stops.set(city, stop);
  return stop;
}

/** The GPS pin for the first stop: the storage circle. */
export function storagePoint(city: CityModel): Vec2 {
  const p = storageStop(city).pos;
  return { x: p.x, z: p.z };
}

/** The long way down to storage. */
export function storageVias(city: CityModel): Vec2[] {
  return TO_STORAGE.map((p) => at(city, p.i, p.j));
}

/** Through the centre, then down to the garage side of town. */
export function garageVias(city: CityModel): Vec2[] {
  return TO_GARAGE.map((p) => at(city, p.i, p.j));
}

/**
 * Every pin after the spawn, storage and the garage included. The closure roll uses this as the GPS path,
 * so a fence still lands on the drive the player is told to follow.
 */
export function missionPins(city: CityModel, goal: Vec2): Vec2[] {
  return [...storageVias(city), storagePoint(city), ...garageVias(city), { x: goal.x, z: goal.z }];
}

/**
 * Eastbound lane in the northwest of the grid (Guy / Sherbrooke), mid-block so the car is not sitting in
 * a junction. Falls back to the northwestern-most eastbound lane if that corner has none.
 */
export function westSpawn(city: CityModel): { pos: Vec2; heading: Vec2 } {
  const b = city.bounds;
  const xMax = b.minX + (b.maxX - b.minX) * 0.22;
  const zMax = b.minZ + (b.maxZ - b.minZ) * 0.32;
  const along = (l: { start: Vec2; end: Vec2 }): Vec2 => ({
    x: l.start.x + (l.end.x - l.start.x) * 0.45,
    z: l.start.z + (l.end.z - l.start.z) * 0.45,
  });
  const eastbound = city.lanes.filter((l) => l.dir.x > 0.75 && l.length > 40);
  const pool = eastbound.filter((l) => {
    const p = along(l);
    return p.x <= xMax && p.z <= zMax;
  });
  const lanes = pool.length ? pool : eastbound;
  let best = lanes[0] ?? city.lanes[0];
  let bestKey = Infinity;
  for (const l of lanes) {
    const p = along(l);
    const key = p.x + p.z + l.index * 30;
    if (key < bestKey) {
      bestKey = key;
      best = l;
    }
  }
  const guess = along(best);
  const hit = city.nearestLanePoint(guess);
  const lane = hit.lane.id === best.id ? hit.lane : best;
  const pos = hit.lane.id === best.id ? hit.pos : guess;
  return { pos, heading: { x: lane.dir.x, z: lane.dir.z } };
}

/** The legal bay and the clear curb ahead of it (m). */
export const HOME_BAY = {
  /** Bays whose near end is within this far ahead of the home bay's front are not painted: room to pull out. */
  clearAhead: 14,
  /** No loose cones within this far of the home bay, or of the curb lane ahead of it. */
  coneClear: 6,
};

/**
 * The one curb bay in Montreal where parking is legal: on the west spawn's street, on the curb side of its
 * lane, nearest the spawn with room left before the next junction. The bays just ahead of it are dropped so
 * there is clear curb lane to pull out into. Returns the bays with that one marked `legal`.
 */
export function homeBay(city: CityModel, bays: CurbBay[]): CurbBay[] {
  const spawn = westSpawn(city);
  const lane = city.nearestLanePoint(spawn.pos).lane;
  const e = city.edges[lane.edgeId];
  const heading = Math.atan2(spawn.heading.x, spawn.heading.z);
  const f = { x: spawn.heading.x, z: spawn.heading.z };
  const ahead = (b: CurbBay) => (b.pos.x - spawn.pos.x) * f.x + (b.pos.z - spawn.pos.z) * f.z;
  const half = (b: CurbBay) => (b.s1 - b.s0) / 2;
  // Same street, nose the way the lane drives (so: the curb side of it)
  const row = bays.filter((b) => b.edge === e.id && Math.cos(b.yaw - heading) > 0.9);
  if (!row.length) return bays;
  const end = Math.max(...row.map((b) => ahead(b) + half(b)));
  const fits = row.filter((b) => end - (ahead(b) + half(b)) >= HOME_BAY.clearAhead);
  const pick = (fits.length ? fits : row).reduce((a, b) => (Math.abs(ahead(b)) < Math.abs(ahead(a)) ? b : a));
  const front = ahead(pick) + half(pick);
  const out: CurbBay[] = [];
  for (const b of bays) {
    if (b === pick) out.push({ ...b, legal: true });
    else if (row.includes(b) && ahead(b) - half(b) >= front - 0.1 && ahead(b) - half(b) < front + HOME_BAY.clearAhead) continue;
    else out.push(b);
  }
  return out;
}
