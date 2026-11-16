import type { Vec2 } from '../types';

export const v2 = (x = 0, z = 0): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
/** 2D cross consistent with yaw convention: torque = cross(r, F). */
export const cross = (a: Vec2, b: Vec2): number => a.z * b.x - a.x * b.z;
export const len = (a: Vec2): number => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const norm = (a: Vec2): Vec2 => {
  const l = Math.hypot(a.x, a.z) || 1;
  return { x: a.x / l, z: a.z / l };
};
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Forward unit vector for a yaw. */
export const fwd = (yaw: number): Vec2 => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
/** Left unit vector for a yaw (direction yaw increases toward). */
export const leftOf = (yaw: number): Vec2 => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });
/** Left of a direction vector. */
export const leftVec = (d: Vec2): Vec2 => ({ x: d.z, z: -d.x });
export const yawOf = (d: Vec2): number => Math.atan2(d.x, d.z);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;
export const damp = (k: number, dt: number): number => 1 - Math.exp(-k * dt);
export const approach = (v: number, target: number, maxDelta: number): number =>
  v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);

/** Closest point parameter on segment ab to p (0..1). */
export function segT(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  return clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1);
}
