import type { Vec2 } from '../types';
import type { CityModel } from '../world/RoadGraph';

/**
 * The winter-tire GPS (a confident, slow one). Two stops, and the streets between them are pinned so the
 * search cannot slip onto the fast boulevards the whole way:
 *
 * 1. South on Lucien-L'Allier, a small street, to a storage corner in Griffintown (de la Montagne & Ottawa).
 * 2. North on de la Montagne into downtown, east on Notre-Dame, north on University through the centre,
 *    east on René-Lévesque across it, then south on De Bullion — small streets and the long avenues — to
 *    Jacques Pneu, on the other side of town.
 *
 * Grid indexes are `layout.ts` (columns west to east, rows mountain to river).
 */
export const STORAGE_AT = { i: 2, j: 11 };

/** Corners before the storage stop, in drive order. */
const TO_STORAGE: { i: number; j: number }[] = [
  { i: 1, j: 2 },
  { i: 1, j: 5 },
  { i: 1, j: 8 },
  { i: 1, j: 10 },
];

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

/** De la Montagne & Ottawa: the winter tires, in storage, until the car stops there. */
export function storagePoint(city: CityModel): Vec2 {
  return at(city, STORAGE_AT.i, STORAGE_AT.j);
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
