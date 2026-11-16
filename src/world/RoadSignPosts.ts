import * as THREE from 'three';
import type { Events } from '../core/Events';
import type { SpatialHash } from '../physics/SpatialHash';
import type { AABB, SimSystem, Vec2, ViewSystem } from '../types';
import type { CityGround } from './Ground';

/** One curb sign as placed by `buildRoadSigns`. */
export interface SignPost {
  /** Middle of the pole (the debris body's origin). */
  center: THREE.Vector3;
  /** Yaw only: local +Z points back at the oncoming driver. */
  rot: THREE.Quaternion;
  /** Which speed limit face (index into the face materials). */
  kind: number;
  /** Breakaway collider (`breakAt` set). */
  collider: AABB;
}

/** Pole and face layout in the post's frame (origin = pole middle). */
const POLE_H = 2.75;
const FACE_Y = 2.45 - POLE_H / 2;
const FACE_SIZE = 0.66;

// Debris body: a rod of unit mass, contact points at both ends (the face sits just inside the top one)
const HALF = 1.42;
const RADIUS = 0.06;
const INERTIA = (2 * HALF) ** 2 / 12;
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
}

const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const ENDS = [new THREE.Vector3(0, -HALF, 0), new THREE.Vector3(0, HALF, 0)];

/**
 * The speed-limit signs at the curb, as breakaway posts: a car at `CONFIG.SIGN_BREAK_KMH` or faster snaps one
 * off (the collision system switches its collider off and leaves the car alone), the standing instance is
 * hidden and a loose copy tumbles away from the car and comes to rest on the ground. It never collides with
 * cars again. The standing signs are edited per instance, so they're kept out of `StaticTiles`.
 */
export class RoadSignPosts implements SimSystem, ViewSystem {
  readonly colliders: AABB[];
  readonly group = new THREE.Group();
  private poles: THREE.InstancedMesh;
  private backs: THREE.InstancedMesh;
  private faces: THREE.InstancedMesh[];
  /** Index of each post's face within its kind's mesh. */
  private faceIndex: number[] = [];
  private byCollider = new Map<AABB, number>();
  private debris: Debris[] = [];
  private poleGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  private discGeo = new THREE.CircleGeometry(0.5, 28);
  private poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.7 });
  private backMat = new THREE.MeshStandardMaterial({ color: 0x777a80, roughness: 0.5, metalness: 0.6 });
  private statics: SpatialHash | null = null;
  // scratch
  private r = new THREE.Vector3();
  private vp = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private dq = new THREE.Quaternion();
  private m = new THREE.Matrix4();

  constructor(
    private posts: SignPost[],
    private faceMats: THREE.Material[],
    private ground: CityGround,
  ) {
    this.colliders = posts.map((p) => p.collider);
    posts.forEach((p, i) => this.byCollider.set(p.collider, i));
    const n = posts.length;
    this.poles = new THREE.InstancedMesh(this.poleGeo, this.poleMat, Math.max(1, n));
    this.backs = new THREE.InstancedMesh(this.discGeo, this.backMat, Math.max(1, n));
    const counts = faceMats.map(() => 0);
    for (const p of posts) this.faceIndex.push(counts[p.kind]++);
    this.faces = faceMats.map((mat, k) => new THREE.InstancedMesh(this.discGeo, mat, Math.max(1, counts[k])));
    this.group.add(this.poles, this.backs, ...this.faces);
    this.poles.count = this.backs.count = n;
    this.faces.forEach((im, k) => (im.count = counts[k]));
    const pose = new THREE.Matrix4();
    posts.forEach((p, i) => {
      pose.compose(p.center, p.rot, new THREE.Vector3(1, 1, 1));
      this.poles.setMatrixAt(i, this.m.multiplyMatrices(pose, POLE_LOCAL));
      this.backs.setMatrixAt(i, this.m.multiplyMatrices(pose, BACK_LOCAL));
      this.faces[p.kind].setMatrixAt(this.faceIndex[i], this.m.multiplyMatrices(pose, FACE_LOCAL));
    });
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
    this.backs.setMatrixAt(i, HIDDEN);
    this.faces[p.kind].setMatrixAt(this.faceIndex[i], HIDDEN);
    this.poles.instanceMatrix.needsUpdate = true;
    this.backs.instanceMatrix.needsUpdate = true;
    this.faces[p.kind].instanceMatrix.needsUpdate = true;

    const obj = new THREE.Group();
    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    POLE_LOCAL.decompose(pole.position, pole.quaternion, pole.scale);
    const back = new THREE.Mesh(this.discGeo, this.backMat);
    BACK_LOCAL.decompose(back.position, back.quaternion, back.scale);
    const face = new THREE.Mesh(this.discGeo, this.faceMats[p.kind]);
    FACE_LOCAL.decompose(face.position, face.quaternion, face.scale);
    obj.add(pole, back, face);
    obj.position.copy(p.center);
    obj.quaternion.copy(p.rot);
    this.group.add(obj);

    // Flung forward, up and out past the side of the car that hit it; hit low, so the top tips back
    const speed = Math.hypot(carVel.x, carVel.z);
    const dir = new THREE.Vector3(carVel.x, 0, carVel.z).divideScalar(speed || 1);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if ((p.center.x - carPos.x) * side.x + (p.center.z - carPos.z) * side.z < 0) side.negate();
    const vel = dir
      .clone()
      .multiplyScalar(speed * (0.6 + Math.random() * 0.2))
      .addScaledVector(side, speed * (0.25 + Math.random() * 0.15))
      .addScaledVector(UP, 3 + speed * 0.08 + Math.random() * 1.5);
    const ang = new THREE.Vector3()
      .crossVectors(dir, UP)
      .multiplyScalar(4 + speed * 0.12 + Math.random() * 2)
      .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3));
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
      for (let k = 0; k < 4; k++) for (const end of ENDS) this.contact(d, end);
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
    const j = (-(1 + (vn < -BOUNCE_MIN ? BOUNCE : 0)) * vn) / (1 + rn.lengthSq() / INERTIA);
    d.vel.y += j;
    d.ang.addScaledVector(rn, j / INERTIA);
    // Friction against the sliding direction, capped by Coulomb
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
    const y = d.pos.y - HALF;
    const blocks = (b: AABB) => b.top === undefined || b.top > y;
    if (!this.statics.segmentBlocked({ x: px, z: pz }, { x: d.pos.x, z: d.pos.z }, blocks)) return;
    d.pos.x = px;
    d.pos.z = pz;
    d.vel.x *= -0.3;
    d.vel.z *= -0.3;
    d.ang.multiplyScalar(0.5);
  }
}

const POLE_LOCAL = new THREE.Matrix4().makeScale(0.07, POLE_H, 0.07);
const FACE_LOCAL = new THREE.Matrix4().compose(new THREE.Vector3(0, FACE_Y, 0.03), new THREE.Quaternion(), new THREE.Vector3(FACE_SIZE, FACE_SIZE, 1));
const BACK_LOCAL = new THREE.Matrix4().compose(
  new THREE.Vector3(0, FACE_Y, 0),
  new THREE.Quaternion().setFromAxisAngle(UP, Math.PI),
  new THREE.Vector3(FACE_SIZE, FACE_SIZE, 1),
);
