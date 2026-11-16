import { CONFIG } from '../config';
import { dot, fwd, leftVec } from '../core/math';
import type { Lane, TurnType, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';

// Bicycle / scooter state and geometry helpers shared by Riders (sim), RiderDodge, LaneDriver and RiderView.

export type RiderKind = 'bicycle' | 'scooter';
/** Riders keep this far from the outer lane's center toward the curb (the curb is LANE_WIDTH / 2 from it). */
export const CURB_OFFSET = 1.35;
/** Rider footprint: half the handlebar width and half the bike length. */
export const RIDER_HALF_W = 0.32;
export const RIDER_HALF_L = 0.9;
const CURB_SIDE = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;

export interface Rider {
  id: number;
  active: boolean;
  kind: RiderKind;
  pos: Vec2;
  prev: Vec2;
  heading: number;
  prevHeading: number;
  vel: Vec2;
  speed: number;
  cruise: number;
  lane: Lane;
  next: Lane;
  turn: TurnType;
  /** Curb-side line to follow: this lane, the junction, the next lane. */
  path: Vec2[];
  seg: number;
  /** Meters along the current path segment. */
  along: number;
  /** Sideways offset from the line toward the curb (+, up onto the sidewalk) or into the lane (-), and its goal. */
  swerve: number;
  swerveTarget: number;
  /** Seconds the dodge keeps the swerve before easing back. */
  swerveHold: number;
  /** Dodge side committed to while the danger lasts (+1 toward the curb, -1 into the lane, 0 none). */
  dodgeSide: number;
  /** Sideways speed for an urgent dodge (m/s, 0 = the normal swerve rate). */
  swerveRate: number;
  /** Seconds of hard braking left (a car crossing ahead). */
  brakeT: number;
  waiting: 'none' | 'light' | 'traffic';
  /** Slowing down hard (brake light on scooters). */
  braking: boolean;
  /** Seconds stopped behind a stopped car (see GO_AROUND_AFTER). */
  blockedT: number;
  stuck: number;
  /** Crank / wheel phase (radians), lean into turns (radians, + = left). */
  phase: number;
  lean: number;
  look: number;
}

/** Turn from direction d0 to d1 (same as `LaneDriver.turnType`; kept local to avoid an import cycle). */
export function turnType(d0: Vec2, d1: Vec2): TurnType {
  const s = dot(d1, leftVec(d0));
  return s > 0.5 ? 'left' : s < -0.5 ? 'right' : 'straight';
}

/**
 * Distance from the rider's front to a car's body inside the rider's corridor (half width `w`) straight ahead
 * along `f`, or Infinity if the body is not in the corridor (exact rotated-box test, so the corner of a car
 * turning beside the rider doesn't block it).
 */
export function corridorGap(p: Vec2, f: Vec2, w: number, o: Car): number {
  const l = leftVec(f);
  const of = fwd(o.yaw);
  const ol = leftVec(of);
  let poly: [number, number][] = [];
  for (const [sa, sb] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    const x = o.pos.x + of.x * o.halfL * sa + ol.x * o.halfW * sb - p.x;
    const z = o.pos.z + of.z * o.halfL * sa + ol.z * o.halfW * sb - p.z;
    poly.push([x * f.x + z * f.z, x * l.x + z * l.z]);
  }
  // Clip to the strip -w <= lateral <= w
  for (const [sign, lim] of [
    [1, w],
    [-1, w],
  ]) {
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ina = sign * a[1] <= lim;
      const inb = sign * b[1] <= lim;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (lim - sign * a[1]) / (sign * (b[1] - a[1]));
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    poly = out;
    if (!poly.length) return Infinity;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const [a] of poly) {
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  if (hi <= 0) return Infinity;
  return Math.max(0.05, lo - RIDER_HALF_L);
}

/** Direction of the rider's current path segment. */
export function pathDir(r: Rider): Vec2 {
  const a = r.path[r.seg];
  const b = r.path[r.seg + 1];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
}

/** Unit vector from the lane line toward the curb for a travel direction. */
export const curbVec = (d: Vec2): Vec2 => {
  const l = leftVec(d);
  return { x: l.x * CURB_SIDE, z: l.z * CURB_SIDE };
};
