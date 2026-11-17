import * as THREE from 'three';
import type { Events } from '../core/Events';
import type { SpatialHash } from '../physics/SpatialHash';
import type { AABB, SimSystem, Vec2, ViewSystem } from '../types';
import type { CityGround } from './Ground';

/** A kind of sign face: its shape (unit size, in the XY plane, facing +Z), look, size and height. */
export interface SignFace {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  /** Width and height (m). */
  w: number;
  h: number;
  /** Height of the face's middle above the foot of the pole (m). */
  y: number;
}

/** One curb sign as placed by `buildRoadSigns`. */
export interface SignPost {
  /** Foot of the pole on the sidewalk. */
  foot: THREE.Vector3;
  /** Yaw only: local +Z points back at the oncoming driver. */
  rot: THREE.Quaternion;
  /** Faces on this pole (indices into the face kinds), top to bottom. */
  faces: number[];
  /** Breakaway collider (`breakAt` set). */
  collider: AABB;
}

/** Radius of the pole (m). The plates are bolted to its front. */
const POLE_R = 0.035;
/** The pole runs a little past the top face. */
const POLE_OVER = 0.12;

// Debris body: a rod of unit mass (contact points at both ends; its half length is the post's)
const RADIUS = 0.06;
const GRAVITY = 9.81;
const BOUNCE = 0.3;
/** Slower landings than this don't bounce (resting contact: otherwise the two ends see-saw forever). */
const BOUNCE_MIN = 1.5;
const FRICTION = 0.9;
/** Spin about the pole's own axis lost per ground contact (it doesn't roll far on its face plate). */
const ROLL_LOSS = 0.25;
const SLEEP_V = 0.15;
const SLEEP_W = 0.4;
const SLEEP_AFTER = 0.4;
/** Knocked-down signs lying around at once; the oldest is cleared past this. */
const MAX_DEBRIS = 32;

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
  /** Half the pole's length, and the rod's inertia about its middle. */
  half: number;
  inertia: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const FLIP = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

/**
 * The curb signs (speed plates, ARRÊT and its plaque), as breakaway posts: a car at `CONFIG.SIGN_BREAK_KMH` or faster snaps one
 * off (the collision system switches its collider off and leaves the car alone), the standing instance is
 * hidden and a loose copy tumbles away from the car and comes to rest on the ground. It never collides with
 * cars again. The standing signs are edited per instance, so they're kept out of `StaticTiles`.
 */
export class RoadSignPosts implements SimSystem, ViewSystem {
  readonly colliders: AABB[];
  readonly group = new THREE.Group();
  private poles: THREE.InstancedMesh;
  private fronts: THREE.InstancedMesh[];
  private backs: THREE.InstancedMesh[];
  /** Index of each post's faces within their kind's meshes. */
  private faceIndex: number[][] = [];
  private byCollider = new Map<AABB, number>();
  private debris: Debris[] = [];
  private poleGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  private poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.7 });
  private backMat = new THREE.MeshStandardMaterial({ color: 0x777a80, roughness: 0.5, metalness: 0.6 });
  private statics: SpatialHash | null = null;
  // scratch
  private r = new THREE.Vector3();
  private vp = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private dq = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  /** Contact points at the two ends of a debris rod (refilled per body). */
  private ends = [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)];

  constructor(
    readonly posts: SignPost[],
    private kinds: SignFace[],
    private ground: CityGround,
  ) {
    this.colliders = posts.map((p) => p.collider);
    posts.forEach((p, i) => this.byCollider.set(p.collider, i));
    const n = posts.length;
    this.poles = new THREE.InstancedMesh(this.poleGeo, this.poleMat, Math.max(1, n));
    const counts = kinds.map(() => 0);
    for (const p of posts) this.faceIndex.push(p.faces.map((k) => counts[k]++));
    this.fronts = kinds.map((k, i) => new THREE.InstancedMesh(k.geo, k.mat, Math.max(1, counts[i])));
    this.backs = kinds.map((k, i) => new THREE.InstancedMesh(k.geo, this.backMat, Math.max(1, counts[i])));
    this.group.add(this.poles, ...this.fronts, ...this.backs);
    this.poles.count = n;
    kinds.forEach((_, i) => (this.fronts[i].count = this.backs[i].count = counts[i]));
    posts.forEach((p, i) => {
      const pose = this.poseOf(p);
      this.poles.setMatrixAt(i, this.m.multiplyMatrices(pose, this.poleLocal(p)));
      p.faces.forEach((k, j) => {
        this.fronts[k].setMatrixAt(this.faceIndex[i][j], this.m.multiplyMatrices(pose, this.faceLocal(p, k, false)));
        this.backs[k].setMatrixAt(this.faceIndex[i][j], this.m.multiplyMatrices(pose, this.faceLocal(p, k, true)));
      });
    });
  }

  /** Pole length: up to just over the highest face. */
  private poleH(p: SignPost): number {
    return Math.max(...p.faces.map((k) => this.kinds[k].y + this.kinds[k].h / 2)) + POLE_OVER;
  }

  /** The post's frame: origin at the middle of the pole. */
  private poseOf(p: SignPost): THREE.Matrix4 {
    const c = p.foot.clone();
    c.y += this.poleH(p) / 2;
    return new THREE.Matrix4().compose(c, p.rot, new THREE.Vector3(1, 1, 1));
  }

  private poleLocal(p: SignPost): THREE.Matrix4 {
    return new THREE.Matrix4().makeScale(2 * POLE_R, this.poleH(p), 2 * POLE_R);
  }

  /** A face (or its bare metal back) in the post's frame. */
  private faceLocal(p: SignPost, k: number, back: boolean): THREE.Matrix4 {
    const f = this.kinds[k];
    const y = f.y - this.poleH(p) / 2;
    // Bolted to the front of the pole (radius POLE_R): the face and, a hair behind it, its bare metal back
    const z = POLE_R + (back ? 0.008 : 0.014);
    return new THREE.Matrix4().compose(new THREE.Vector3(0, y, z), back ? FLIP : new THREE.Quaternion(), new THREE.Vector3(f.w, f.h, 1));
  }

  /** Start listening for knock-downs (the statics stop debris at walls). */
  attach(events: Events, statics: SpatialHash): void {
    this.statics = statics;
    events.on('propBroken', (e) => {
      const i = this.byCollider.get(e.box);
      if (i !== undefined) this.knockDown(i, e.vel, e.carPos);
    });
  }

  private knockDown(i: number, carVel: Vec2, carPos: Vec2): void {
    const p = this.posts[i];
    this.poles.setMatrixAt(i, HIDDEN);
    this.poles.instanceMatrix.needsUpdate = true;
    p.faces.forEach((k, j) => {
      for (const im of [this.fronts[k], this.backs[k]]) {
        im.setMatrixAt(this.faceIndex[i][j], HIDDEN);
        im.instanceMatrix.needsUpdate = true;
      }
    });

    const obj = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, local: THREE.Matrix4) => {
      const mesh = new THREE.Mesh(geo, mat);
      local.decompose(mesh.position, mesh.quaternion, mesh.scale);
      obj.add(mesh);
    };
    add(this.poleGeo, this.poleMat, this.poleLocal(p));
    for (const k of p.faces) {
      add(this.kinds[k].geo, this.kinds[k].mat, this.faceLocal(p, k, false));
      add(this.kinds[k].geo, this.backMat, this.faceLocal(p, k, true));
    }
    const center = new THREE.Vector3().setFromMatrixPosition(this.poseOf(p));
    obj.position.copy(center);
    obj.quaternion.copy(p.rot);
    this.group.add(obj);

    // Flung forward, up and out past the side of the car that hit it; hit low, so the top tips back
    const speed = Math.hypot(carVel.x, carVel.z);
    const dir = new THREE.Vector3(carVel.x, 0, carVel.z).divideScalar(speed || 1);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if ((center.x - carPos.x) * side.x + (center.z - carPos.z) * side.z < 0) side.negate();
    const vel = dir
      .clone()
      .multiplyScalar(speed * (0.6 + Math.random() * 0.2))
      .addScaledVector(side, speed * (0.25 + Math.random() * 0.15))
      .addScaledVector(UP, 3 + speed * 0.08 + Math.random() * 1.5);
    const ang = new THREE.Vector3()
      .crossVectors(dir, UP)
      .multiplyScalar(4 + speed * 0.12 + Math.random() * 2)
      .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3));
    const half = this.poleH(p) / 2;
    this.debris.push({
      obj,
      pos: center.clone(),
      prevPos: center.clone(),
      quat: p.rot.clone(),
      prevQuat: p.rot.clone(),
      vel,
      ang,
      still: 0,
      asleep: false,
      half,
      inertia: (2 * half) ** 2 / 12,
    });
    if (this.debris.length > MAX_DEBRIS) this.group.remove(this.debris.shift()!.obj);
  }

  update(dt: number): void {
    for (const d of this.debris) {
      d.prevPos.copy(d.pos);
      d.prevQuat.copy(d.quat);
      if (d.asleep) continue;
      d.vel.y -= GRAVITY * dt;
      d.ang.multiplyScalar(1 - 0.3 * dt);
      const px = d.pos.x;
      const pz = d.pos.z;
      d.pos.addScaledVector(d.vel, dt);
      this.integrate(d.quat, d.ang, dt);
      this.walls(d, px, pz);
      // A few passes: with both ends down, each end's impulse partly undoes the other's
      for (let k = 0; k < 4; k++) for (const end of this.ends) this.contact(d, end.set(0, Math.sign(end.y || 1) * d.half, 0));
      // Settle: stop once it has been barely moving for a moment
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

  private integrate(q: THREE.Quaternion, w: THREE.Vector3, dt: number): void {
    const a = w.length() * dt;
    if (a < 1e-6) return;
    this.tmp.copy(w).normalize();
    q.premultiply(this.dq.setFromAxisAngle(this.tmp, a)).normalize();
  }

  /** Ground contact at one end of the rod: push out, bounce and rub (impulses on a unit-mass rod). */
  private contact(d: Debris, local: THREE.Vector3): void {
    const r = this.r.copy(local).applyQuaternion(d.quat);
    const x = d.pos.x + r.x;
    const z = d.pos.z + r.z;
    const pen = this.ground.surfaceY(x, z) + RADIUS - (d.pos.y + r.y);
    if (pen <= -0.01) return;
    if (pen > 0) d.pos.y += pen;
    const vp = this.vp.crossVectors(d.ang, r).add(d.vel);
    const vn = vp.y;
    if (vn >= 0) return;
    // Normal impulse along +Y
    const rn = this.tmp.crossVectors(r, UP);
    const j = (-(1 + (vn < -BOUNCE_MIN ? BOUNCE : 0)) * vn) / (1 + rn.lengthSq() / d.inertia);
    d.vel.y += j;
    d.ang.addScaledVector(rn, j / d.inertia);
    // Friction against the sliding direction, capped by Coulomb
    vp.crossVectors(d.ang, r).add(d.vel);
    vp.y = 0;
    const vt = vp.length();
    if (vt < 1e-3) return;
    const t = vp.divideScalar(vt);
    const rt = this.tmp.crossVectors(r, t);
    const jt = Math.min(vt / (1 + rt.lengthSq() / d.inertia), FRICTION * j);
    d.vel.addScaledVector(t, -jt);
    d.ang.addScaledVector(rt, -jt / d.inertia);
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
