import { CONFIG } from '../config';
import type { Vec2 } from '../types';
import { inDriveway, type CurbBay } from './Features';
import { cumulative, pointAt, tangentAt } from './Polyline';
import { travelHalf, type CityModel } from './RoadGraph';

/** Curb-lane parking layout (m). Playtests may move these. */
export const CURB_PARKING_TUNING = {
  /** Length of one bay: a sedan with room to get out of it. */
  bay: 6.5,
  /** No parking this far past the stop line, toward the middle of the block (the corner stays visible). */
  cornerClear: 5,
  /** Keep this far (m) beyond a curb cut, along the curb, from the bay's ends. */
  cutClear: 1.2,
  /** No parking on the canal bridges, nor this far off the ends of their humps. */
  bridgeClear: 6,
};

/**
 * Parking bays along the curb bands of streets and boulevards (PRD 4.2, pure data). Each side of an edge gets a
 * row of equal bays centered between the corners, minus any bay in front of a curb cut (driveway, alley, pit
 * stop, the precinct lot) or on a bridge. `RoadMarkings` paints their ticks, `ParkedCars` fills some of them.
 * Cobble edges have no band, so no bays.
 */
export function planCurbParking(city: CityModel): CurbBay[] {
  const T = CURB_PARKING_TUNING;
  const f = city.features;
  const sw = CONFIG.SIDEWALK;
  const canal = f.canal;
  const abSide = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;
  const out: CurbBay[] = [];
  const c: Vec2 = { x: 0, z: 0 };
  const d: Vec2 = { x: 0, z: 0 };
  /** Point at arc length s, lateral offset lat (+ = left of a -> b). */
  const at = (pts: Vec2[], cum: number[], s: number, lat: number): Vec2 => {
    pointAt(pts, cum, s, c);
    tangentAt(pts, cum, s, d);
    return { x: c.x + d.z * lat, z: c.z - d.x * lat };
  };
  const cut = (p: Vec2) => {
    if (inDriveway(f, p, T.cutClear)) return true;
    const lot = f.station?.lot;
    return !!lot && p.x > lot.minX - T.cutClear && p.x < lot.maxX + T.cutClear && p.z > lot.minZ - sw - 1 && p.z < lot.maxZ + sw + 1;
  };
  const onBridge = (p: Vec2) => !!canal && Math.abs(p.z - canal.zc) < canal.humpHalf + T.bridgeClear && p.x > canal.x0 && p.x < canal.x1;

  for (const e of city.edges) {
    if (e.parking <= 0 || e.oneWay) continue;
    const pts = e.pts;
    const cum = cumulative(pts);
    const L = cum[cum.length - 1];
    const margin = CONFIG.STOP_OFFSET + T.cornerClear;
    const n = Math.floor((L - 2 * margin) / T.bay);
    if (n <= 0) continue;
    const first = (L - n * T.bay) / 2;
    const mid = travelHalf(e) + e.parking / 2;
    const curb = e.width / 2 + 0.5; // just onto the sidewalk, where a curb cut shows
    for (const side of [1, -1] as const) {
      const forward = side === abSide;
      for (let k = 0; k < n; k++) {
        const s0 = first + k * T.bay;
        const s1 = s0 + T.bay;
        const sm = (s0 + s1) / 2;
        const pos = at(pts, cum, sm, side * mid);
        if (onBridge(pos)) continue;
        if (cut(at(pts, cum, s0, side * curb)) || cut(at(pts, cum, sm, side * curb)) || cut(at(pts, cum, s1, side * curb))) continue;
        tangentAt(pts, cum, sm, d);
        const yaw = forward ? Math.atan2(d.x, d.z) : Math.atan2(-d.x, -d.z);
        out.push({ edge: e.id, side, s0, s1, pos, yaw });
      }
    }
  }
  return out;
}
