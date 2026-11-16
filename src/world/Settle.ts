import { CONFIG } from '../config';
import { frameOf } from './BuildingFrame';
import type { Building } from '../types';
import type { CityModel } from './RoadGraph';

/** Set each building's ground floor and foundation from the terrain (stepped buildings on hills). */
export function settleBuildings(city: CityModel): void {
  const t = city.terrain;
  for (const b of city.buildings) {
    if (b.obb) {
      settleOriented(city, b);
      continue;
    }
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const pts = [
      [b.minX, b.minZ],
      [b.maxX, b.minZ],
      [b.minX, b.maxZ],
      [b.maxX, b.maxZ],
      [cx, cz],
    ];
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, z] of pts) {
      const h = t.base(x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    // Ground floor at the lowest street frontage (just outside the facade, on the sidewalk)
    let floor = Infinity;
    for (const f of b.faces) {
      const p = f === 'N' ? [cx, b.minZ - 1] : f === 'S' ? [cx, b.maxZ + 1] : f === 'E' ? [b.maxX + 1, cz] : [b.minX - 1, cz];
      floor = Math.min(floor, t.base(p[0], p[1]));
    }
    if (floor === Infinity) floor = lo;
    b.floorY = floor + CONFIG.CURB_HEIGHT;
    b.footY = lo - 0.6;
  }
}

/** `settleBuildings` for a rotated building (T39): corners and street-face probes in its local frame. */
function settleOriented(city: CityModel, b: Building): void {
  const t = city.terrain;
  const f = frameOf(b);
  let lo = Infinity;
  for (const p of [f.at(-f.hx, -f.hz), f.at(f.hx, -f.hz), f.at(-f.hx, f.hz), f.at(f.hx, f.hz), f.center]) lo = Math.min(lo, t.base(p.x, p.z));
  let floor = Infinity;
  for (const facing of b.faces) {
    const face = f.faceOf(facing);
    floor = Math.min(floor, t.base(face.center.x + face.normal.x, face.center.z + face.normal.z));
  }
  if (floor === Infinity) floor = lo;
  b.floorY = floor + CONFIG.CURB_HEIGHT;
  b.footY = lo - 0.6;
}
