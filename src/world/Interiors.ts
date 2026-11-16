import type { AABB, Building, Facing, Interior, Vec2 } from '../types';

/**
 * Geometry helpers for semi-indoor areas (IMPROVEMENTS #9): buildings with a drivable cavity on the ground
 * floor collide and draw as the boxes around it. Pure data.
 */

const EPS = 1e-3;

/** `r` minus `hole`: up to four boxes (the bands before / after along z, then both sides). */
export function subtractRect<T extends AABB>(r: T, hole: AABB): T[] {
  if (hole.minX >= r.maxX || hole.maxX <= r.minX || hole.minZ >= r.maxZ || hole.maxZ <= r.minZ) return [r];
  const out: T[] = [];
  const part = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    if (maxX - minX > EPS && maxZ - minZ > EPS) out.push({ ...r, minX, minZ, maxX, maxZ });
  };
  const z0 = Math.max(r.minZ, hole.minZ);
  const z1 = Math.min(r.maxZ, hole.maxZ);
  part(r.minX, r.minZ, r.maxX, z0);
  part(r.minX, z1, r.maxX, r.maxZ);
  part(r.minX, z0, Math.min(r.maxX, hole.minX), z1);
  part(Math.max(r.minX, hole.maxX), z0, r.maxX, z1);
  return out;
}

/** Collision boxes of a building: its footprint, or the ground floor around its cavity (keeps `height`, so they block sight). */
export function solidParts(b: Building): Building[] {
  return b.cavity ? subtractRect(b, b.cavity.box) : [b];
}

/** Street faces of a part of `b`: the building's faces that the part's edge lies on (and is long enough to dress). */
export function partFaces(b: Building, p: AABB, minLength = 0): Facing[] {
  return b.faces.filter((f) => {
    const len = f === 'N' || f === 'S' ? p.maxX - p.minX : p.maxZ - p.minZ;
    if (len < minLength) return false;
    if (f === 'N') return Math.abs(p.minZ - b.minZ) < EPS;
    if (f === 'S') return Math.abs(p.maxZ - b.maxZ) < EPS;
    if (f === 'W') return Math.abs(p.minX - b.minX) < EPS;
    return Math.abs(p.maxX - b.maxX) < EPS;
  });
}

/**
 * Ceiling height of a cavity opening in facade `face` of `b` overlapping the span [s0, s1] along it (x for
 * N / S facades, z for E / W), or null: signs and awnings hung there are lifted above the opening.
 */
export function openingTop(b: Building, face: Facing, s0: number, s1: number): number | null {
  const c = b.cavity;
  if (!c) return null;
  for (const d of c.doors) if (d.side === face && d.from < s1 && d.to > s0) return c.floor + c.height;
  return null;
}

export const interiorAt = (list: Interior[], p: Vec2): Interior | null =>
  list.find((r) => p.x >= r.box.minX && p.x <= r.box.maxX && p.z >= r.box.minZ && p.z <= r.box.maxZ) ?? null;

/** Outward unit normal of a wall side. */
export const SIDE_OUT: Record<Facing, Vec2> = { N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } };
