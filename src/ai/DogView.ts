import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import type { ViewSystem } from '../types';
import type { CityGround } from '../world/Ground';
import type { Dog, DogWalkers } from './DogWalkers';
import type { Pedestrians } from './Pedestrians';

/** Coat / markings colors, overall size, leg length, body length and tail curl per breed (see BREEDS). */
const BREED = [
  { coat: 0xc8742a, mark: 0xf2e4c8, size: 1, leg: 1, long: 1, tail: 2.3 }, // shiba
  { coat: 0x1e1a18, mark: 0xc89a60, size: 1, leg: 1, long: 1, tail: 2.3 }, // black-and-tan shiba
  { coat: 0xece6da, mark: 0xece6da, size: 1.22, leg: 1.05, long: 1.05, tail: 2.4 }, // big white
  { coat: 0x8a5634, mark: 0x8a5634, size: 0.62, leg: 1, long: 0.9, tail: 1.4 }, // toy poodle
  { coat: 0xd08638, mark: 0xf6f0e6, size: 0.85, leg: 0.55, long: 1.25, tail: 0.6 }, // corgi
  { coat: 0x2a1a12, mark: 0xa86a3a, size: 0.75, leg: 0.5, long: 1.45, tail: 0.5 }, // dachshund
];
const HIP_Y = 0.27;
const HIPS: [number, number][] = [
  [0.08, 0.19],
  [-0.08, 0.19],
  [0.08, -0.19],
  [-0.08, -0.19],
];
/** Owner's hand (ped frame: +x left, +z forward) and the dog's collar (dog frame, before breed scale). */
const HAND = new THREE.Vector3(0.27, 0.9, 0.06);
const COLLAR = new THREE.Vector3(0, 0.5, 0.27);
/** Leash length in 3D; slack sags in the middle. */
const LEASH_LEN = 2.1;
const LEASH_SEGS = 4;

function boxAt(sx: number, sy: number, sz: number, x: number, y: number, z: number, hex = 0xffffff): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z).toNonIndexed();
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function ear(x: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.045, 0.1, 4).rotateY(Math.PI / 4).translate(x, 0.685, 0.31).toNonIndexed();
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color());
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

/** Instanced low-poly dogs (body, markings, legs, tail) and their leashes (one line batch). */
export class DogView implements ViewSystem {
  private coat: THREE.InstancedMesh;
  private marks: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private tails: THREE.InstancedMesh;
  private leash: THREE.LineSegments;
  private leashPos: Float32Array;
  private ys: Float32Array;
  private m = new THREE.Matrix4();
  private body = new THREE.Matrix4();
  private part = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private color = new THREE.Color();
  private hand = new THREE.Vector3();
  private collar = new THREE.Vector3();

  constructor(
    private dogs: DogWalkers,
    private peds: Pedestrians,
    scene: THREE.Scene,
    private terrain: CityGround,
  ) {
    const n = dogs.dogs.length;
    const coatGeo = mergeGeometries([
      boxAt(0.24, 0.22, 0.5, 0, 0.37, 0),
      boxAt(0.16, 0.2, 0.14, 0, 0.48, 0.24),
      boxAt(0.2, 0.18, 0.19, 0, 0.56, 0.33),
      boxAt(0.035, 0.035, 0.02, 0.055, 0.59, 0.43, 0x050505),
      boxAt(0.035, 0.035, 0.02, -0.055, 0.59, 0.43, 0x050505),
      ear(0.06),
      ear(-0.06),
    ])!;
    const markGeo = mergeGeometries([
      boxAt(0.11, 0.08, 0.13, 0, 0.52, 0.47),
      boxAt(0.045, 0.04, 0.03, 0, 0.55, 0.535, 0x050505),
      boxAt(0.18, 0.14, 0.06, 0, 0.39, 0.29),
      boxAt(0.17, 0.03, 0.4, 0, 0.255, 0),
    ])!;
    const legGeo = boxAt(0.065, HIP_Y, 0.07, 0, -HIP_Y / 2, 0);
    const tailGeo = boxAt(0.06, 0.06, 0.2, 0, 0, -0.1);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: 0x18120e });
    this.coat = instanced(coatGeo, mat, n);
    this.marks = instanced(markGeo, mat, n);
    this.legs = instanced(legGeo, mat, n * 4);
    this.tails = instanced(tailGeo, mat, n);
    this.leashPos = new Float32Array(n * LEASH_SEGS * 2 * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.leashPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.leash = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xc8303a }));
    this.leash.frustumCulled = false;
    scene.add(this.coat, this.marks, this.legs, this.tails, this.leash);
    this.ys = new Float32Array(n).fill(CONFIG.CURB_HEIGHT);
  }

  /** Body pitch (+ = nose down) about a hip, and how the legs fold, for the dog's current activity. */
  private pose(d: Dog): { pitch: number; pivotZ: number; front: number; rear: number } {
    if (d.sniffT > 0 && d.speed < 0.3) return { pitch: 0.32, pivotZ: 0.19, front: -0.32, rear: -0.32 };
    if (d.still > 1 && d.speed < 0.1) return { pitch: -0.5, pivotZ: -0.19, front: 0.5, rear: 1.5 };
    return { pitch: 0, pivotZ: 0, front: 0, rear: 0 };
  }

  sync(alpha: number, frameDt: number): void {
    let n = 0;
    let li = 0;
    for (const p of this.peds.peds) {
      const d = this.dogs.dogs[p.id];
      if (!d.active || !p.active) continue;
      const b = BREED[d.breed % BREED.length];
      const x = d.prev.x + (d.pos.x - d.prev.x) * alpha;
      const z = d.prev.z + (d.pos.z - d.prev.z) * alpha;
      const yT = this.terrain.surfaceY(x, z);
      if (Math.abs(yT - this.ys[p.id]) > 0.6) this.ys[p.id] = yT;
      this.ys[p.id] += (yT - this.ys[p.id]) * Math.min(1, frameDt * 12);
      const trot = Math.min(1, d.speed / 1.4);
      const bob = Math.abs(Math.sin(d.phase)) * 0.025 * trot * b.size;
      const leap = d.leapT > 0 ? Math.sin(Math.PI * (1 - d.leapT / 0.32)) * 0.25 : 0;
      const pose = this.pose(d);

      // Dog frame: position, heading, breed scale; legs shortened by dropping the body
      this.e.set(0, d.heading, 0, 'YXZ');
      this.m.compose(this.v.set(x, this.ys[p.id] + bob + leap, z), this.q.setFromEuler(this.e), this.s.set(b.size, b.size, b.size * b.long));
      this.m.multiply(this.tmp.makeTranslation(0, -HIP_Y * (1 - b.leg), 0));
      this.body.copy(this.m);
      if (pose.pitch !== 0) {
        this.body.multiply(this.tmp.makeTranslation(0, HIP_Y, pose.pivotZ));
        this.body.multiply(this.part.makeRotationX(pose.pitch));
        this.body.multiply(this.tmp.makeTranslation(0, -HIP_Y, -pose.pivotZ));
      }
      this.coat.setMatrixAt(n, this.body);
      this.marks.setMatrixAt(n, this.body);
      this.coat.setColorAt(n, this.color.setHex(b.coat));
      this.marks.setColorAt(n, this.color.setHex(b.mark));

      // Legs: diagonal pairs swing together at a trot; folded when sitting / sniffing
      const sw = Math.sin(d.phase) * 0.6 * trot;
      HIPS.forEach(([hx, hz], k) => {
        const front = k < 2;
        const swing = (k === 0 || k === 3 ? sw : -sw) + (front ? pose.front : pose.rear);
        this.part.makeRotationX(swing).setPosition(hx, HIP_Y, hz);
        this.tmp.multiplyMatrices(this.body, this.part);
        this.tmp.multiply(this.part.makeScale(1, b.leg, 1));
        this.legs.setMatrixAt(n * 4 + k, this.tmp);
        this.legs.setColorAt(n * 4 + k, this.color.setHex(b.coat));
      });

      // Tail: curled up over the back (shiba) or out behind, wagging
      this.e.set(-b.tail, Math.sin(d.wag) * 0.55, 0, 'YXZ');
      this.part.makeRotationFromEuler(this.e).setPosition(0, 0.44, -0.24);
      this.tails.setMatrixAt(n, this.tmp.multiplyMatrices(this.body, this.part));
      this.tails.setColorAt(n, this.color.setHex(b.coat));

      // Leash from the owner's hand (on the dog's side) to the collar, sagging with slack
      const ox = p.prev.x + (p.pos.x - p.prev.x) * alpha;
      const oz = p.prev.z + (p.pos.z - p.prev.z) * alpha;
      const ch = Math.cos(p.heading);
      const sh = Math.sin(p.heading);
      const side = (x - ox) * ch - (z - oz) * sh >= 0 ? 1 : -1;
      const hx = HAND.x * side;
      const handY = p.dodge === 'dive' ? 0.35 : HAND.y;
      this.hand.set(ox + hx * ch + HAND.z * sh, this.terrain.surfaceY(ox, oz) + handY, oz - hx * sh + HAND.z * ch);
      this.collar.copy(COLLAR).applyMatrix4(this.body);
      const slack = Math.max(0, LEASH_LEN - this.hand.distanceTo(this.collar));
      const sag = Math.min(0.9, slack * 0.55);
      let px = this.hand.x;
      let py = this.hand.y;
      let pz = this.hand.z;
      for (let k = 1; k <= LEASH_SEGS; k++) {
        const t = k / LEASH_SEGS;
        const qx = this.hand.x + (this.collar.x - this.hand.x) * t;
        const qy = this.hand.y + (this.collar.y - this.hand.y) * t - sag * 4 * t * (1 - t);
        const qz = this.hand.z + (this.collar.z - this.hand.z) * t;
        this.leashPos.set([px, py, pz, qx, qy, qz], li);
        li += 6;
        px = qx;
        py = qy;
        pz = qz;
      }
      n++;
    }
    for (const mesh of [this.coat, this.marks, this.tails]) mesh.count = n;
    this.legs.count = n * 4;
    for (const mesh of [this.coat, this.marks, this.legs, this.tails]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
    this.leash.geometry.setDrawRange(0, n * LEASH_SEGS * 2);
    (this.leash.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
