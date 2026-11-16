import { cross, dot, fwd, leftOf } from '../core/math';
import type { Events } from '../core/Events';
import type { AABB, CrashKind, OrientedBox, SimSystem, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import { applyImpactDamage } from '../vehicles/Damage';
import type { SpatialHash } from './SpatialHash';

interface Obb {
  c: Vec2;
  f: Vec2;
  l: Vec2;
  hl: number;
  hw: number;
}

const obbOf = (car: Car): Obb => ({ c: car.pos, f: fwd(car.yaw), l: leftOf(car.yaw), hl: car.halfL, hw: car.halfW });

/** A rotated static box (T39) in the car-box form: local +Z is `f` (half length `hz`), local +X is `l`. */
const staticObb = (o: OrientedBox): Obb => ({ c: { x: o.cx, z: o.cz }, f: fwd(o.yaw), l: leftOf(o.yaw), hl: o.hz, hw: o.hx });

function corners(o: Obb): Vec2[] {
  const out: Vec2[] = [];
  for (const sf of [1, -1]) {
    for (const sl of [1, -1]) {
      out.push({ x: o.c.x + o.f.x * o.hl * sf + o.l.x * o.hw * sl, z: o.c.z + o.f.z * o.hl * sf + o.l.z * o.hw * sl });
    }
  }
  return out;
}

const projObb = (o: Obb, a: Vec2) => o.hl * Math.abs(dot(o.f, a)) + o.hw * Math.abs(dot(o.l, a));

interface Contact {
  n: Vec2; // points toward body A (the car)
  depth: number;
  point: Vec2;
}

function obbVsAabb(o: Obb, b: AABB): Contact | null {
  const bc = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const hx = (b.maxX - b.minX) / 2;
  const hz = (b.maxZ - b.minZ) / 2;
  const axes: [Vec2, boolean][] = [
    [{ x: 1, z: 0 }, true],
    [{ x: 0, z: 1 }, true],
    [o.f, false],
    [o.l, false],
  ];
  let best: Contact | null = null;
  let fromBox = true;
  const d = { x: o.c.x - bc.x, z: o.c.z - bc.z };
  for (const [a, boxAxis] of axes) {
    const ra = projObb(o, a);
    const rb = hx * Math.abs(a.x) + hz * Math.abs(a.z);
    const dist = dot(d, a);
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const s = dist >= 0 ? 1 : -1;
      best = { n: { x: a.x * s, z: a.z * s }, depth: overlap, point: { x: 0, z: 0 } };
      fromBox = boxAxis;
    }
  }
  if (!best) return null;
  if (fromBox) {
    let m = Infinity;
    for (const c of corners(o)) {
      const v = dot(c, best.n);
      if (v < m) {
        m = v;
        best.point = c;
      }
    }
  } else {
    let m = -Infinity;
    for (const c of [
      { x: b.minX, z: b.minZ },
      { x: b.maxX, z: b.minZ },
      { x: b.minX, z: b.maxZ },
      { x: b.maxX, z: b.maxZ },
    ]) {
      const v = dot(c, best.n);
      if (v > m) {
        m = v;
        best.point = c;
      }
    }
  }
  return best;
}

function obbVsObb(A: Obb, B: Obb): Contact | null {
  const axes: [Vec2, boolean][] = [
    [B.f, true],
    [B.l, true],
    [A.f, false],
    [A.l, false],
  ];
  const d = { x: A.c.x - B.c.x, z: A.c.z - B.c.z };
  let best: Contact | null = null;
  let fromB = true;
  for (const [a, bAxis] of axes) {
    const overlap = projObb(A, a) + projObb(B, a) - Math.abs(dot(d, a));
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const s = dot(d, a) >= 0 ? 1 : -1;
      best = { n: { x: a.x * s, z: a.z * s }, depth: overlap, point: { x: 0, z: 0 } };
      fromB = bAxis;
    }
  }
  if (!best) return null;
  const src = fromB ? corners(A) : corners(B);
  let m = fromB ? Infinity : -Infinity;
  for (const c of src) {
    const v = dot(c, best.n);
    if (fromB ? v < m : v > m) {
      m = v;
      best.point = c;
    }
  }
  return best;
}

/** A pole, bollard or crate crumples; a building face stops the car dead. */
function classify(b: AABB): CrashKind {
  const foot = b.obb ? 2 * Math.max(b.obb.hx, b.obb.hz) : Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  if (foot < 2.4) return 'prop';
  if (b.top !== undefined && b.top < 1.7 && foot < 8) return 'prop';
  return 'wall';
}

const pointVel = (car: Car, r: Vec2): Vec2 => {
  const s = car.phys.state;
  return { x: s.vel.x + s.yawRate * r.z, z: s.vel.z - s.yawRate * r.x };
};

function applyImpulse(car: Car, r: Vec2, j: Vec2): void {
  const s = car.phys.state;
  const m = car.phys.mass;
  s.vel.x += j.x / m;
  s.vel.z += j.z / m;
  s.yawRate += cross(r, j) / car.phys.inertia;
}

/** Resolves car-vs-static and car-vs-car collisions, emits events and applies damage. */
export class CollisionSystem implements SimSystem {
  private tmp: AABB[] = [];

  constructor(
    private statics: SpatialHash,
    private getCars: () => Car[],
    private events: Events,
  ) {}

  update(): void {
    const cars = this.getCars().filter((c) => !c.removed && !c.ghost);
    for (const car of cars) this.staticPass(car);
    for (let i = 0; i < cars.length; i++) {
      for (let k = i + 1; k < cars.length; k++) {
        const A = cars[i];
        const B = cars[k];
        const dx = A.pos.x - B.pos.x;
        const dz = A.pos.z - B.pos.z;
        if (dx * dx + dz * dz > 49) continue;
        if (Math.abs(A.y - B.y) > 1.3) continue; // one is jumping over the other
        this.pair(A, B);
      }
    }
  }

  private staticPass(car: Car): void {
    const r = car.halfL + 0.5;
    const boxes = this.statics.query(car.pos.x - r, car.pos.z - r, car.pos.x + r, car.pos.z + r, this.tmp);
    for (const b of boxes) {
      if (b.top !== undefined && car.y >= b.top - 0.05) continue; // flying / driving over it
      const o = obbOf(car);
      const c = b.obb ? obbVsObb(o, staticObb(b.obb)) : obbVsAabb(o, b);
      if (!c) continue;
      const s = car.phys.state;
      const snap = b.breakAt !== undefined && Math.hypot(s.vel.x, s.vel.z) >= b.breakAt;
      // A sign post gives way without a hit. A lamp post strikes, then gives way.
      if (snap && !b.breakHits) {
        this.breakProp(car, b, c, false);
        continue;
      }
      s.pos.x += c.n.x * c.depth;
      s.pos.z += c.n.z * c.depth;
      const rr = { x: c.point.x - s.pos.x, z: c.point.z - s.pos.z };
      const vp = pointVel(car, rr);
      const vn = dot(vp, c.n);
      if (vn >= 0) {
        if (snap) this.breakProp(car, b, c, false);
        continue;
      }
      this.note(car, null, c.n, c.point, -vn, b);
      const m = car.phys.mass;
      const I = car.phys.inertia;
      const rn = cross(rr, c.n);
      const j = (-(1 + 0.2) * vn) / (1 / m + (rn * rn) / I);
      applyImpulse(car, rr, { x: c.n.x * j, z: c.n.z * j });
      // friction
      const vp2 = pointVel(car, rr);
      const vt = { x: vp2.x - c.n.x * dot(vp2, c.n), z: vp2.z - c.n.z * dot(vp2, c.n) };
      const vtl = Math.hypot(vt.x, vt.z);
      if (vtl > 0.01) {
        const t = { x: vt.x / vtl, z: vt.z / vtl };
        const rt = cross(rr, t);
        let jt = vtl / (1 / m + (rt * rt) / I);
        jt = Math.min(jt, j * 0.35);
        applyImpulse(car, rr, { x: -t.x * jt, z: -t.z * jt });
      }
      const loud = j > 900 && car.lastHit > 0.25;
      this.report(car, null, j, c.point);
      if (snap) this.breakProp(car, b, c, loud);
      if (car.kind === 'player') this.events.emit({ type: 'contact', other: null, box: b });
    }
  }

  /** Switch a breakaway box off. `struck` means this contact already played as a crash. */
  private breakProp(car: Car, b: AABB, c: Contact, struck: boolean): void {
    const s = car.phys.state;
    b.off = true;
    this.events.emit({
      type: 'propBroken',
      car: car.id,
      box: b,
      pos: { x: c.point.x, z: c.point.z },
      carPos: { x: s.pos.x, z: s.pos.z },
      vel: { x: s.vel.x, z: s.vel.z },
      struck,
    });
  }

  private pair(A: Car, B: Car): void {
    const c = obbVsObb(obbOf(A), obbOf(B));
    if (!c) return;
    const sa = A.phys.state;
    const sb = B.phys.state;
    const mA = A.phys.mass;
    const mB = B.phys.mass;
    const wA = 1 / mA / (1 / mA + 1 / mB);
    sa.pos.x += c.n.x * c.depth * wA;
    sa.pos.z += c.n.z * c.depth * wA;
    sb.pos.x -= c.n.x * c.depth * (1 - wA);
    sb.pos.z -= c.n.z * c.depth * (1 - wA);
    const rA = { x: c.point.x - sa.pos.x, z: c.point.z - sa.pos.z };
    const rB = { x: c.point.x - sb.pos.x, z: c.point.z - sb.pos.z };
    const va = pointVel(A, rA);
    const vb = pointVel(B, rB);
    const vrel = { x: va.x - vb.x, z: va.z - vb.z };
    const vn = dot(vrel, c.n);
    if (vn >= 0) return;
    const closing = -vn;
    this.note(A, B, c.n, c.point, closing, null);
    this.note(B, A, { x: -c.n.x, z: -c.n.z }, c.point, closing, null);
    const rnA = cross(rA, c.n);
    const rnB = cross(rB, c.n);
    const IA = A.phys.inertia;
    const IB = B.phys.inertia;
    const j = (-(1 + 0.3) * vn) / (1 / mA + 1 / mB + (rnA * rnA) / IA + (rnB * rnB) / IB);
    applyImpulse(A, rA, { x: c.n.x * j, z: c.n.z * j });
    applyImpulse(B, rB, { x: -c.n.x * j, z: -c.n.z * j });
    // friction
    const vt = { x: vrel.x - c.n.x * vn, z: vrel.z - c.n.z * vn };
    const vtl = Math.hypot(vt.x, vt.z);
    if (vtl > 0.01) {
      const t = { x: vt.x / vtl, z: vt.z / vtl };
      const jt = Math.min(vtl / (1 / mA + 1 / mB) * 0.5, j * 0.3);
      applyImpulse(A, rA, { x: -t.x * jt, z: -t.z * jt });
      applyImpulse(B, rB, { x: t.x * jt, z: t.z * jt });
    }
    this.report(A, B, j, c.point);
    if (A.kind === 'player') this.events.emit({ type: 'contact', other: B.id, box: null });
    else if (B.kind === 'player') this.events.emit({ type: 'contact', other: A.id, box: null });
  }

  /** Pre-impact sample for the player. The wreck cinematic decides if it was a head-on. */
  private note(car: Car, other: Car | null, n: Vec2, point: Vec2, closing: number, box: AABB | null): void {
    if (car.kind !== 'player' || car.ghost) return;
    const vel = car.phys.state.vel;
    const speed = Math.hypot(vel.x, vel.z);
    if (speed < 25 || closing < 8) return;
    const f = fwd(car.yaw);
    const l = leftOf(car.yaw);
    const rel = { x: point.x - car.pos.x, z: point.z - car.pos.z };
    this.events.emit({
      type: 'impact',
      car: car.id,
      other: other ? other.id : null,
      speed,
      closing,
      align: -dot(f, n),
      side: dot(rel, l),
      along: dot(rel, f),
      glance: dot(vel, l),
      normal: { x: n.x, z: n.z },
      pos: { x: point.x, z: point.z },
      kind: other ? 'vehicle' : box ? classify(box) : 'wall',
      otherMass: other ? other.phys.mass : 0,
    });
  }

  private report(a: Car, b: Car | null, impulse: number, pos: Vec2): void {
    a.touch = 0;
    if (b) b.touch = 0;
    applyImpactDamage(a, impulse);
    if (b) applyImpactDamage(b, impulse);
    if (impulse > 900) {
      if (a.lastHit > 0.25 || (b && b.lastHit > 0.25)) {
        this.events.emit({ type: 'collision', a: a.id, b: b ? b.id : null, impulse, pos: { ...pos } });
      }
      a.lastHit = 0;
      if (b) b.lastHit = 0;
    }
  }
}
