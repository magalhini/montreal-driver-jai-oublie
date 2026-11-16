import * as THREE from 'three';
import { CONFIG, KMH } from '../config';
import type { Events } from '../core/Events';
import type { SpatialHash } from '../physics/SpatialHash';
import type { AABB, SimSystem, Vec2, ViewSystem } from '../types';
import type { CityGround } from './Ground';
import type { CityModel } from './RoadGraph';
import { inDriveway } from './StreetProps';
import { sharedGlow } from './textures';
import { LOOK } from '../render/Look';

/** One street lamp: pole on the curb, arm over the lane, glowing head and a pool on the asphalt. */
interface LampPost {
  /** Middle of the pole (the debris body's origin). */
  center: THREE.Vector3;
  /** Yaw only: local +Z runs along the arm, toward the road. */
  rot: THREE.Quaternion;
  collider: AABB;
  pole: THREE.Matrix4;
  arm: THREE.Matrix4;
  head: THREE.Matrix4;
  pool: THREE.Matrix4;
  /** Vieux-Montréal globe lamp: a short black post with a glass globe on top, no arm (`globe` is its matrix). */
  globe: THREE.Matrix4 | null;
  x: number;
  z: number;
}

const TILE = 250;
/** Hide a tile whose bounds sit entirely farther than this from the camera (m). Lamps used to cull with the static props. */
const CULL = 520;
const POLE_H = 7.2;
const HALF = POLE_H / 2;
const ARM_LEN = 2.1;
const ARM_Y = 7;
const HEAD_Y = 6.85;
const HEAD_OUT = 1.9;

// Debris: a rod of unit mass. The head sits near the top, out along the arm.
const GRAVITY = 9.81;
const BOUNCE = 0.22;
const BOUNCE_MIN = 1.2;
const FRICTION = 0.85;
const ROLL_LOSS = 0.35;
const SLEEP_V = 0.2;
const SLEEP_W = 0.35;
const SLEEP_AFTER = 0.45;
const INERTIA = (POLE_H * POLE_H) / 12;
/** Knocked-down lamps lying around at once; the oldest is cleared past this. */
const MAX_DEBRIS = 24;

/** Globe lamps on the cobbles (PRD Phase 5): post height, globe radius, spacing along the curb. */
export const GLOBE_LAMP = { height: 4.3, radius: 0.34, step: 19 };
const G_HALF = GLOBE_LAMP.height / 2;

const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const G_POLE_LOCAL = new THREE.Matrix4().makeScale(0.15, GLOBE_LAMP.height, 0.15);
/** The collar and cap under and over the globe (one box, the pole mesh's material). */
const G_COLLAR_LOCAL = new THREE.Matrix4().compose(new THREE.Vector3(0, GLOBE_LAMP.height - 0.05, 0), new THREE.Quaternion(), new THREE.Vector3(0.3, 0.22, 0.3));
const G_GLOBE_LOCAL = new THREE.Matrix4().makeScale(GLOBE_LAMP.radius, GLOBE_LAMP.radius * 1.1, GLOBE_LAMP.radius).setPosition(0, GLOBE_LAMP.height + GLOBE_LAMP.radius, 0);
const POLE_LOCAL = new THREE.Matrix4().makeScale(0.22, POLE_H, 0.22);
const ARM_LOCAL = new THREE.Matrix4().compose(new THREE.Vector3(0, ARM_Y, ARM_LEN / 2), new THREE.Quaternion(), new THREE.Vector3(0.12, 0.12, ARM_LEN));
const HEAD_LOCAL = new THREE.Matrix4().compose(new THREE.Vector3(0, HEAD_Y, HEAD_OUT), new THREE.Quaternion(), new THREE.Vector3(0.5, 0.16, 0.9));

interface End {
  at: THREE.Vector3;
  r: number;
}
const ENDS: End[] = [
  { at: new THREE.Vector3(0, -HALF, 0), r: 0.12 },
  { at: new THREE.Vector3(0, HALF, 0), r: 0.12 },
  { at: new THREE.Vector3(0, HEAD_Y - HALF, HEAD_OUT), r: 0.4 },
];
const GLOBE_ENDS: End[] = [
  { at: new THREE.Vector3(0, -G_HALF, 0), r: 0.1 },
  { at: new THREE.Vector3(0, G_HALF + GLOBE_LAMP.radius, 0), r: GLOBE_LAMP.radius },
];

interface Debris {
  obj: THREE.Group;
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  quat: THREE.Quaternion;
  prevQuat: THREE.Quaternion;
  vel: THREE.Vector3;
  ang: THREE.Vector3;
  still: number;
  asleep: boolean;
  ends: End[];
  half: number;
}

interface Slot {
  poles: THREE.InstancedMesh;
  arms: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  pools: THREE.InstancedMesh;
  index: number;
  /** The tile's globe mesh and this post's instance in it (globe lamps only). */
  globes: THREE.InstancedMesh | null;
  gIndex: number;
}

interface Tile {
  group: THREE.Group;
  cx: number;
  cz: number;
  radius: number;
}

/**
 * Street lamps along the curb. A car at `CONFIG.LAMP_BREAK_KMH` or faster knocks one down: the hit is a real
 * collision (the car is shoved and damaged), then the collider switches off and the post topples. Slower than
 * that, the post stays a solid pole. Traffic-light poles are not lamps and are left alone.
 * Instances are hidden when one breaks, so the meshes stay out of `StaticTiles` and are culled here instead.
 */
export class StreetLamps implements SimSystem, ViewSystem {
  readonly colliders: AABB[];
  readonly group = new THREE.Group();
  private posts: LampPost[];
  private slots: Slot[] = [];
  private tiles: Tile[] = [];
  private byCollider = new Map<AABB, number>();
  private gone = new Set<number>();
  private debris: Debris[] = [];
  private poleGeo = new THREE.BoxGeometry(1, 1, 1);
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private poolGeo = new THREE.PlaneGeometry(13, 13);
  private globeGeo = new THREE.SphereGeometry(1, 14, 10);
  /** Black (PRD 4.4). */
  private poleMat = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.55, metalness: 0.5 });
  /** Frosted glass, a warm bulb inside at low intensity by day. */
  private globeMat = new THREE.MeshBasicMaterial({ color: LOOK.day ? new THREE.Color(1.18, 1.0, 0.8) : new THREE.Color(2.6, 2.0, 1.3) });
  /** On in the grey afternoon at a low warm glow (PRD 4.4), full strength at night. */
  private headMat = new THREE.MeshBasicMaterial({ color: LOOK.day ? new THREE.Color(1.3, 1.05, 0.75) : new THREE.Color(3.2, 2.2, 1.2) });
  private poolMat = new THREE.MeshBasicMaterial({
    map: sharedGlow(),
    color: new THREE.Color(0.55, 0.38, 0.22),
    transparent: true,
    opacity: LOOK.pool,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private statics: SpatialHash | null = null;
  private cam = new THREE.Vector3();
  // scratch
  private r = new THREE.Vector3();
  private vp = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private dq = new THREE.Quaternion();

  constructor(posts: LampPost[], private ground: CityGround) {
    this.posts = posts;
    this.colliders = posts.map((p) => p.collider);
    posts.forEach((p, i) => this.byCollider.set(p.collider, i));
    this.poleGeo.translate(0, 0.5, 0);
    this.buildTiles();
  }

  /** Where the posts stand (props keep clear of them). */
  get positions(): Vec2[] {
    return this.posts.map((p) => ({ x: p.x, z: p.z }));
  }

  /** Start listening for knock-downs (the statics stop debris at walls). */
  attach(events: Events, statics: SpatialHash): void {
    this.statics = statics;
    events.on('propBroken', (e) => {
      const i = this.byCollider.get(e.box);
      if (i !== undefined) this.knockDown(i, e.vel, e.carPos);
    });
  }

  /** Distance cull. Frustum culling is three.js's job, per tile mesh. */
  cull(camera: THREE.Camera): void {
    const c = camera.getWorldPosition(this.cam);
    for (const t of this.tiles) {
      t.group.visible = Math.hypot(t.cx - c.x, t.cz - c.z) - t.radius < CULL;
    }
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - 0.6 * dt);
    for (const d of this.debris) {
      d.prevPos.copy(d.pos);
      d.prevQuat.copy(d.quat);
      if (d.asleep) continue;
      d.vel.y -= GRAVITY * dt;
      d.vel.x *= drag;
      d.vel.z *= drag;
      d.ang.multiplyScalar(1 - 0.35 * dt);
      const px = d.pos.x;
      const pz = d.pos.z;
      d.pos.addScaledVector(d.vel, dt);
      this.integrate(d.quat, d.ang, dt);
      this.walls(d, px, pz);
      for (let k = 0; k < 4; k++) for (const end of d.ends) this.contact(d, end);
      if (d.vel.length() < SLEEP_V && d.ang.length() < SLEEP_W) {
        d.still += dt;
        if (d.still > SLEEP_AFTER) {
          d.asleep = true;
          d.vel.set(0, 0, 0);
          d.ang.set(0, 0, 0);
        }
      } else d.still = 0;
    }
  }

  sync(alpha: number): void {
    for (const d of this.debris) {
      d.obj.position.lerpVectors(d.prevPos, d.pos, alpha);
      d.obj.quaternion.slerpQuaternions(d.prevQuat, d.quat, alpha);
    }
  }

  private buildTiles(): void {
    const buckets = new Map<string, number[]>();
    this.posts.forEach((p, i) => {
      const k = `${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(i);
    });
    this.slots = new Array(this.posts.length);
    const poleM: THREE.Matrix4[] = [];
    const armM: THREE.Matrix4[] = [];
    const headM: THREE.Matrix4[] = [];
    const poolM: THREE.Matrix4[] = [];
    const globeM: THREE.Matrix4[] = [];
    for (const ids of buckets.values()) {
      poleM.length = armM.length = headM.length = poolM.length = globeM.length = 0;
      const gIndex = new Map<number, number>();
      let sx = 0;
      let sz = 0;
      for (const i of ids) {
        const p = this.posts[i];
        poleM.push(p.pole);
        armM.push(p.arm);
        headM.push(p.head);
        poolM.push(p.pool);
        if (p.globe) {
          gIndex.set(i, globeM.length);
          globeM.push(p.globe);
        }
        sx += p.x;
        sz += p.z;
      }
      const cx = sx / ids.length;
      const cz = sz / ids.length;
      let radius = 0;
      for (const i of ids) radius = Math.max(radius, Math.hypot(this.posts[i].x - cx, this.posts[i].z - cz));
      const poles = fill(this.poleGeo, this.poleMat, poleM);
      const arms = fill(this.boxGeo, this.poleMat, armM);
      const heads = fill(this.boxGeo, this.headMat, headM);
      const pools = fill(this.poolGeo, this.poolMat, poolM);
      pools.renderOrder = 1;
      const g = new THREE.Group();
      g.add(poles, arms, heads, pools);
      const globes = globeM.length ? fill(this.globeGeo, this.globeMat, globeM) : null;
      if (globes) g.add(globes);
      this.group.add(g);
      this.tiles.push({ group: g, cx, cz, radius: radius + 8 });
      ids.forEach((i, k) => (this.slots[i] = { poles, arms, heads, pools, index: k, globes: gIndex.has(i) ? globes : null, gIndex: gIndex.get(i) ?? -1 }));
    }
  }

  private knockDown(i: number, carVel: Vec2, carPos: Vec2): void {
    if (this.gone.has(i)) return;
    this.gone.add(i);
    const slot = this.slots[i];
    slot.poles.setMatrixAt(slot.index, HIDDEN);
    slot.arms.setMatrixAt(slot.index, HIDDEN);
    slot.heads.setMatrixAt(slot.index, HIDDEN);
    slot.pools.setMatrixAt(slot.index, HIDDEN);
    slot.poles.instanceMatrix.needsUpdate = true;
    slot.arms.instanceMatrix.needsUpdate = true;
    slot.heads.instanceMatrix.needsUpdate = true;
    slot.pools.instanceMatrix.needsUpdate = true;
    if (slot.globes) {
      slot.globes.setMatrixAt(slot.gIndex, HIDDEN);
      slot.globes.instanceMatrix.needsUpdate = true;
    }

    const p = this.posts[i];
    const obj = new THREE.Group();
    const half = p.globe ? G_HALF : HALF;
    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.set(0, -half, 0);
    if (p.globe) {
      pole.scale.set(0.15, GLOBE_LAMP.height, 0.15);
      const collar = new THREE.Mesh(this.boxGeo, this.poleMat);
      collar.position.set(0, G_HALF - 0.05, 0);
      collar.scale.set(0.3, 0.22, 0.3);
      const globe = new THREE.Mesh(this.globeGeo, this.globeMat);
      globe.position.set(0, G_HALF + GLOBE_LAMP.radius, 0);
      globe.scale.set(GLOBE_LAMP.radius, GLOBE_LAMP.radius * 1.1, GLOBE_LAMP.radius);
      obj.add(pole, collar, globe);
    } else {
      pole.scale.set(0.22, POLE_H, 0.22);
      const arm = new THREE.Mesh(this.boxGeo, this.poleMat);
      arm.position.set(0, ARM_Y - HALF, ARM_LEN / 2);
      arm.scale.set(0.12, 0.12, ARM_LEN);
      const head = new THREE.Mesh(this.boxGeo, this.headMat);
      head.position.set(0, HEAD_Y - HALF, HEAD_OUT);
      head.scale.set(0.5, 0.16, 0.9);
      obj.add(pole, arm, head);
    }
    obj.position.copy(p.center);
    obj.quaternion.copy(p.rot);
    this.group.add(obj);

    // Shove it along the car and topple that way: ω = up × dir sends the head forward, and the linear
    // kick keeps the base from swinging back into the car.
    const speed = Math.hypot(carVel.x, carVel.z);
    const dir = new THREE.Vector3(carVel.x, 0, carVel.z).multiplyScalar(1 / (speed || 1));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if ((p.center.x - carPos.x) * side.x + (p.center.z - carPos.z) * side.z < 0) side.negate();
    const kick = Math.min(speed, 36);
    const spin = 1.5 + kick * 0.03;
    const vel = dir
      .clone()
      .multiplyScalar(half * spin * 0.72 + kick * 0.05)
      .addScaledVector(side, kick * 0.1);
    vel.y = 1.1 + Math.random() * 0.8;
    const ang = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(spin);
    ang.y = (Math.random() - 0.5) * 0.8;
    this.debris.push({
      obj,
      pos: p.center.clone(),
      prevPos: p.center.clone(),
      quat: p.rot.clone(),
      prevQuat: p.rot.clone(),
      vel,
      ang,
      still: 0,
      asleep: false,
      ends: p.globe ? GLOBE_ENDS : ENDS,
      half,
    });
    if (this.debris.length > MAX_DEBRIS) this.group.remove(this.debris.shift()!.obj);
  }

  private integrate(q: THREE.Quaternion, w: THREE.Vector3, dt: number): void {
    const a = w.length() * dt;
    if (a < 1e-6) return;
    this.tmp.copy(w).normalize();
    q.premultiply(this.dq.setFromAxisAngle(this.tmp, a)).normalize();
  }

  /** Ground contact at one point: push out, bounce and rub (impulses on a unit-mass rod). */
  private contact(d: Debris, end: End): void {
    const r = this.r.copy(end.at).applyQuaternion(d.quat);
    const x = d.pos.x + r.x;
    const z = d.pos.z + r.z;
    const pen = this.ground.surfaceY(x, z) + end.r - (d.pos.y + r.y);
    if (pen <= -0.01) return;
    if (pen > 0) d.pos.y += pen;
    const vp = this.vp.crossVectors(d.ang, r).add(d.vel);
    const vn = vp.y;
    if (vn >= 0) return;
    const rn = this.tmp.crossVectors(r, UP);
    const j = (-(1 + (vn < -BOUNCE_MIN ? BOUNCE : 0)) * vn) / (1 + rn.lengthSq() / INERTIA);
    d.vel.y += j;
    d.ang.addScaledVector(rn, j / INERTIA);
    vp.crossVectors(d.ang, r).add(d.vel);
    vp.y = 0;
    const vt = vp.length();
    if (vt < 1e-3) return;
    const t = vp.divideScalar(vt);
    const rt = this.tmp.crossVectors(r, t);
    const jt = Math.min(vt / (1 + rt.lengthSq() / INERTIA), FRICTION * j);
    d.vel.addScaledVector(t, -jt);
    d.ang.addScaledVector(rt, -jt / INERTIA);
    const axis = this.tmp.set(0, 1, 0).applyQuaternion(d.quat);
    d.ang.addScaledVector(axis, -d.ang.dot(axis) * ROLL_LOSS);
  }

  /** Buildings and standing props stop the flight. A post that already snapped is `off`, so the query skips it. */
  private walls(d: Debris, px: number, pz: number): void {
    if (!this.statics) return;
    const y = d.pos.y - d.half;
    const blocks = (b: AABB) => b.top === undefined || b.top > y;
    if (!this.statics.segmentBlocked({ x: px, z: pz }, { x: d.pos.x, z: d.pos.z }, blocks)) return;
    d.pos.x = px;
    d.pos.z = pz;
    d.vel.x *= -0.3;
    d.vel.z *= -0.3;
    d.ang.multiplyScalar(0.5);
  }
}

function fill(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  im.count = mats.length;
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  return im;
}

/** Same curb spacing the static props used to build, now as breakaway posts. */
export function buildStreetLamps(city: CityModel): StreetLamps {
  const posts: LampPost[] = [];
  const t = city.terrain;
  const breakAt = CONFIG.LAMP_BREAK_KMH * KMH;
  const g: Vec2 = { x: 0, z: 0 };
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3();
  const pose = new THREE.Matrix4();

  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    const alongX = e.axis === 'x';
    const aExt = alongX ? a.hx : a.hz;
    const bExt = alongX ? b.hx : b.hz;
    const t0 = (alongX ? a.pos.x : a.pos.z) + aExt + 9;
    const t1 = (alongX ? b.pos.x : b.pos.z) - bExt - 9;
    const fixed = alongX ? a.pos.z : a.pos.x;
    const hw = e.width / 2;
    const P = (s: number, lat: number): Vec2 => (alongX ? { x: s, z: fixed + lat } : { x: fixed + lat, z: s });
    const globe = e.cls === 'cobble';
    let side = 1;
    for (let s = t0; s <= t1; s += globe ? GLOBE_LAMP.step : 26) {
      const lat = side * (hw + (globe ? 0.6 : 0.7));
      const p = P(s, lat);
      if (inDriveway(city, p, 0.6)) {
        side = -side;
        continue;
      }
      // Arm lamps light the lane; a globe lights the sidewalk around its post
      const head = globe ? p : P(s, side * (hw - 1.2));
      const py = t.surfaceY(p.x, p.z);
      // Local +Z points from the pole toward the road.
      const yaw = Math.atan2(alongX ? 0 : -side, alongX ? -side : 0);
      const rot = new THREE.Quaternion().setFromAxisAngle(up, yaw);
      pose.compose(new THREE.Vector3(p.x, py, p.z), rot, new THREE.Vector3(1, 1, 1));
      t.gradient(head.x, head.z, g);
      nrm.set(-g.x, 1, -g.z).normalize();
      const tilt = new THREE.Quaternion().setFromUnitVectors(up, nrm).multiply(flat);
      const poolScale = globe ? 0.62 : 1;
      posts.push({
        center: new THREE.Vector3(p.x, py + (globe ? G_HALF : HALF), p.z),
        rot,
        collider: { minX: p.x - 0.25, maxX: p.x + 0.25, minZ: p.z - 0.25, maxZ: p.z + 0.25, breakAt, breakHits: true },
        pole: pose.clone().multiply(globe ? G_POLE_LOCAL : POLE_LOCAL),
        arm: pose.clone().multiply(globe ? G_COLLAR_LOCAL : ARM_LOCAL),
        head: globe ? HIDDEN.clone() : pose.clone().multiply(HEAD_LOCAL),
        pool: new THREE.Matrix4().compose(
          new THREE.Vector3(head.x, (globe ? t.surfaceY(head.x, head.z) : t.heightAt(head.x, head.z)) + 0.06, head.z),
          tilt,
          new THREE.Vector3(poolScale, poolScale, 1),
        ),
        globe: globe ? pose.clone().multiply(G_GLOBE_LOCAL) : null,
        x: p.x,
        z: p.z,
      });
      side = -side;
    }
  }
  return new StreetLamps(posts, t);
}
