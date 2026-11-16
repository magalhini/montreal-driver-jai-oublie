import * as THREE from 'three';
import type { CityGround } from '../world/Ground';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { clamp } from '../core/math';
import { hash01 } from '../core/Rng';
import type { ViewSystem } from '../types';
import { DIVE_AIR, DIVE_DOWN, DIVE_GETUP, STEP_T } from './PedestrianDodge';
import type { Ped, Pedestrians } from './Pedestrians';

const CLOTHES = [0x1c2340, 0x15151a, 0x5a5f6a, 0xc8b48a, 0x8a1e2a, 0x2a4a6a, 0xd8d0c8, 0x6a3a7a, 0xe07aa8, 0x2f6a5a, 0xd89a3a, 0x3a3a46];
const PANTS = [0x15151a, 0x1c2340, 0x3a3a46, 0x4a3a2a, 0x2a2a30];
const UMBRELLAS = [0xffffff, 0xff7ab8, 0x7af2ff, 0xffd27a, 0xb48cff];
const SKIN = [0xffffff, 0xf2e2d8, 0xe6cfbf, 0xd2b8a2];
/** Bare calves under a skirt: the head's skin tone with the head vertex color already multiplied in. */
const LEG_SKIN = [0xe8c8b0, 0xdcb195, 0xd1a284, 0xbf9070];
const HAIR = [0x14110f, 0x14110f, 0x1c1612, 0x2a1c14, 0x3d2b1c, 0x5c4030, 0x8a6848];
const TIGHTS = 0x2a2630;
/** Half the crowd uses the narrower build and long hair (`hash01` salt). */
const FEMME_SALT = 5;
/** Of those, the share who wear a skirt instead of trousers. */
const SKIRT_SALT = 6;
const SKIRT_SHARE = 0.62;
const HIP_Y = 0.86;
/** Top of the visible calf, kept inside the skirt hem. */
const CALF_TOP = 0.36;
/** Forward pitch of a ped lying face down after a dive (pivoting at the hips). */
const PRONE = 1.45;
/** How far the hips drop when lying down (leaves the body resting on the ground). */
const LIE_DROP = HIP_Y - 0.15;

const smooth = (u: number) => u * u * (3 - 2 * u);

function boxAt(sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
}

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

/** Broad shoulders and straight torso, or a narrower chest with wider hips. */
function torsoGeometry(femme: boolean): THREE.BufferGeometry {
  if (!femme) {
    return mergeGeometries([
      boxAt(0.42, 0.6, 0.26, 0, 1.18, 0),
      boxAt(0.11, 0.56, 0.13, -0.27, 1.16, 0),
      boxAt(0.11, 0.56, 0.13, 0.27, 1.16, 0),
    ])!;
  }
  return mergeGeometries([
    boxAt(0.3, 0.4, 0.22, 0, 1.26, 0),
    boxAt(0.34, 0.22, 0.24, 0, 0.96, 0),
    boxAt(0.09, 0.5, 0.11, -0.19, 1.2, 0),
    boxAt(0.09, 0.5, 0.11, 0.19, 1.2, 0),
  ])!;
}

/** Short crop, loose hair past the shoulders, or a ponytail. They walk toward +z, so the face is +z. */
function hairGeometry(style: 'short' | 'loose' | 'tie'): THREE.BufferGeometry {
  const long = style !== 'short';
  const cap = boxAt(long ? 0.28 : 0.25, long ? 0.12 : 0.1, long ? 0.28 : 0.25, 0, 1.76, long ? -0.03 : -0.01);
  const bangs = boxAt(long ? 0.28 : 0.25, 0.16, long ? 0.07 : 0.06, 0, 1.66, long ? 0.12 : -0.11);
  if (!long) return mergeGeometries([cap, bangs])!;
  const sides = [boxAt(0.09, 0.48, 0.11, -0.16, 1.44, -0.05), boxAt(0.09, 0.48, 0.11, 0.16, 1.44, -0.05)];
  const tail = style === 'tie' ? boxAt(0.1, 0.58, 0.1, 0, 1.38, -0.16) : boxAt(0.26, 0.66, 0.12, 0, 1.38, -0.14);
  return mergeGeometries([cap, bangs, ...sides, tail])!;
}

function skirtGeometry(): THREE.BufferGeometry {
  const hem = 0.4;
  const waist = 0.9;
  return new THREE.CylinderGeometry(0.22, 0.32, waist - hem, 6).translate(0, (hem + waist) / 2, 0);
}

/** Instanced low-poly pedestrians with a bobbing walk and swinging legs. */
export class PedestrianView implements ViewSystem {
  /** Rain intensity 0..1 (set by main): up to 85% of pedestrians open an umbrella. */
  rain = 0;
  private torsoM: THREE.InstancedMesh;
  private torsoF: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private hairM: THREE.InstancedMesh;
  private hairLoose: THREE.InstancedMesh;
  private hairTie: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private skirts: THREE.InstancedMesh;
  private umbrellas: THREE.InstancedMesh;
  private ys: Float32Array;
  private seenM: Int32Array;
  private seenF: Int32Array;
  private seenHead: Int32Array;
  private seenLoose: Int32Array;
  private seenTie: Int32Array;
  private seenLegs: Int32Array;
  private seenSkirt: Int32Array;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private body = new THREE.Matrix4();
  private part = new THREE.Matrix4();
  private pivot = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  /** Shortens a leg about the foot so only the calf shows under a skirt. */
  private calf = new THREE.Matrix4()
    .makeTranslation(0, -HIP_Y, 0)
    .multiply(new THREE.Matrix4().makeScale(0.85, CALF_TOP / HIP_Y, 0.85))
    .multiply(new THREE.Matrix4().makeTranslation(0, HIP_Y, 0));
  private pose = { pitch: 0, lift: 0, swing: 0.5 };

  constructor(
    private peds: Pedestrians,
    scene: THREE.Scene,
    private terrain: CityGround,
  ) {
    const n = peds.peds.length;
    const headGeo = colored(boxAt(0.22, 0.24, 0.22, 0, 1.62, 0), 0xe8c8b0);
    const legGeo = boxAt(0.15, HIP_Y, 0.17, 0, -HIP_Y / 2, 0);
    const umbrellaGeo = mergeGeometries([
      new THREE.ConeGeometry(0.62, 0.28, 8, 1, true).translate(0, 2.1, 0),
      new THREE.CylinderGeometry(0.015, 0.015, 0.9, 4).translate(0, 1.7, 0),
    ])!;

    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.85, emissive: 0x1a1428 });
    const hair = new THREE.MeshStandardMaterial({ roughness: 0.72, emissive: 0x0c0a10 });
    this.torsoM = instanced(torsoGeometry(false), cloth, n);
    this.torsoF = instanced(torsoGeometry(true), cloth, n);
    this.legs = instanced(legGeo, cloth, n * 2);
    this.skirts = instanced(skirtGeometry(), cloth, n);
    this.head = instanced(headGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0x140e14 }), n);
    this.hairM = instanced(hairGeometry('short'), hair, n);
    this.hairLoose = instanced(hairGeometry('loose'), hair, n);
    this.hairTie = instanced(hairGeometry('tie'), hair, n);
    this.umbrellas = instanced(
      umbrellaGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      n,
    );
    scene.add(this.torsoM, this.torsoF, this.legs, this.skirts, this.head, this.hairM, this.hairLoose, this.hairTie, this.umbrellas);
    this.ys = new Float32Array(n).fill(CONFIG.CURB_HEIGHT);
    this.seenM = new Int32Array(n).fill(-1);
    this.seenF = new Int32Array(n).fill(-1);
    this.seenHead = new Int32Array(n).fill(-1);
    this.seenLoose = new Int32Array(n).fill(-1);
    this.seenTie = new Int32Array(n).fill(-1);
    this.seenLegs = new Int32Array(n).fill(-1);
    this.seenSkirt = new Int32Array(n).fill(-1);
  }

  private pick<T>(arr: T[], seed: number, salt: number): T {
    return arr[Math.abs(Math.imul(seed ^ salt, 2654435761)) % arr.length];
  }

  private paint(mesh: THREE.InstancedMesh, index: number, hex: number): void {
    mesh.setColorAt(index, this.color.setHex(hex));
    mesh.instanceColor!.needsUpdate = true;
  }

  /** Body pitch, extra height and leg swing amount for the ped's current reaction. */
  private poseOf(p: Ped): { pitch: number; lift: number; swing: number } {
    const o = this.pose;
    o.pitch = 0;
    o.lift = 0;
    o.swing = 0.5;
    if (p.dodge === 'dive') {
      const t = p.dodgeT;
      if (t < DIVE_AIR) {
        const u = t / DIVE_AIR;
        o.pitch = PRONE * smooth(Math.min(1, u * 1.4));
        o.lift = 3 * u * (1 - u);
      } else {
        o.pitch = PRONE * (1 - smooth(clamp((t - DIVE_AIR - DIVE_DOWN) / DIVE_GETUP, 0, 1)));
      }
      o.lift -= LIE_DROP * Math.sin(o.pitch);
      o.swing = 0;
    } else if (p.dodge === 'step') {
      o.lift = 0.14 * Math.sin(Math.PI * Math.min(1, p.dodgeT / STEP_T));
      o.swing = 0.35;
    } else if (p.panic > 0) {
      o.pitch = 0.2;
      o.swing = 0.85;
    }
    return o;
  }

  sync(alpha: number, frameDt: number): void {
    const d = this.dummy;
    let mi = 0;
    let fi = 0;
    let hi = 0;
    let loose = 0;
    let tie = 0;
    let li = 0;
    let si = 0;
    let ui = 0;
    for (const p of this.peds.peds) {
      if (!p.active) continue;
      const x = p.prev.x + (p.pos.x - p.prev.x) * alpha;
      const z = p.prev.z + (p.pos.z - p.prev.z) * alpha;
      const yTarget = this.terrain.surfaceY(x, z);
      if (Math.abs(yTarget - this.ys[p.id]) > 0.6) this.ys[p.id] = yTarget;
      this.ys[p.id] += (yTarget - this.ys[p.id]) * Math.min(1, frameDt * 12);
      const pose = this.poseOf(p);
      const moving = Math.hypot(p.vel.x, p.vel.z) > 0.05 && pose.swing > 0;
      const swing = moving ? Math.sin(p.phase) : 0;
      const bob = moving ? Math.abs(Math.cos(p.phase)) * 0.05 : 0;
      const y = this.ys[p.id] + bob + pose.lift;
      const yaw = p.heading;

      d.position.set(x, y, z);
      d.rotation.set(0, yaw, swing * 0.04, 'YXZ');
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      const body = this.body.copy(d.matrix);
      if (pose.pitch !== 0) {
        body.multiply(this.part.makeTranslation(0, HIP_Y, 0));
        body.multiply(this.part.makeRotationX(pose.pitch));
        body.multiply(this.part.makeTranslation(0, -HIP_Y, 0));
      }
      const femme = hash01(p.look, FEMME_SALT) < 0.5;
      const skirt = femme && hash01(p.look, SKIRT_SALT) < SKIRT_SHARE;
      (femme ? this.torsoF : this.torsoM).setMatrixAt(femme ? fi : mi, body);
      this.head.setMatrixAt(hi, body);

      if (femme) {
        const pony = hash01(p.look, 13) < 0.45;
        const hairMesh = pony ? this.hairTie : this.hairLoose;
        const hairSeen = pony ? this.seenTie : this.seenLoose;
        const hairI = pony ? tie : loose;
        hairMesh.setMatrixAt(hairI, body);
        if (hairSeen[hairI] !== p.look) {
          hairSeen[hairI] = p.look;
          this.paint(hairMesh, hairI, this.pick(HAIR, p.look, 7));
        }
        if (pony) tie++;
        else loose++;
      } else {
        this.hairM.setMatrixAt(mi, body);
        if (this.seenM[mi] !== p.look) {
          this.seenM[mi] = p.look;
          this.paint(this.torsoM, mi, this.pick(CLOTHES, p.look, 1));
          this.paint(this.hairM, mi, this.pick(HAIR, p.look, 7));
        }
      }

      if (femme && this.seenF[fi] !== p.look) {
        this.seenF[fi] = p.look;
        this.paint(this.torsoF, fi, this.pick(CLOTHES, p.look, 1));
      }
      if (skirt && this.seenSkirt[si] !== p.look) {
        this.seenSkirt[si] = p.look;
        const top = this.pick(CLOTHES, p.look, 1);
        this.paint(this.skirts, si, hash01(p.look, 8) < 0.55 ? top : this.pick(CLOTHES, p.look, 8));
      }

      if (this.seenHead[hi] !== p.look) {
        this.seenHead[hi] = p.look;
        this.paint(this.head, hi, this.pick(SKIN, p.look, 2));
      }

      for (const s of [-1, 1]) {
        this.pivot.makeRotationX(swing * s * pose.swing).setPosition(s * (skirt ? 0.07 : 0.11), HIP_Y, 0);
        const leg = skirt ? this.tmp.multiplyMatrices(this.pivot, this.calf) : this.pivot;
        this.part.multiplyMatrices(body, leg);
        this.legs.setMatrixAt(li * 2 + (s < 0 ? 0 : 1), this.part);
      }
      if (this.seenLegs[li] !== p.look) {
        this.seenLegs[li] = p.look;
        const pants = this.color.setHex(
          skirt ? (hash01(p.look, 14) < 0.4 ? TIGHTS : this.pick(LEG_SKIN, p.look, 2)) : this.pick(PANTS, p.look, 3),
        );
        this.legs.setColorAt(li * 2, pants);
        this.legs.setColorAt(li * 2 + 1, pants);
        this.legs.instanceColor!.needsUpdate = true;
      }

      if (skirt) {
        this.pivot.makeRotationX(swing * 0.06);
        this.skirts.setMatrixAt(si, this.part.multiplyMatrices(body, this.pivot));
        si++;
      }
      if (femme) fi++;
      else mi++;
      hi++;
      li++;

      if (p.umbrella || hash01(p.look, 9) < this.rain * 0.85) {
        this.umbrellas.setMatrixAt(ui, this.part.multiplyMatrices(body, this.pivot.makeRotationX(0.12)));
        this.umbrellas.setColorAt(ui, this.color.setHex(this.pick(UMBRELLAS, p.look, 4)));
        ui++;
      }
    }
    this.torsoM.count = this.hairM.count = mi;
    this.torsoF.count = fi;
    this.hairLoose.count = loose;
    this.hairTie.count = tie;
    this.head.count = hi;
    this.legs.count = li * 2;
    this.skirts.count = si;
    this.umbrellas.count = ui;
    for (const m of [this.torsoM, this.torsoF, this.head, this.hairM, this.hairLoose, this.hairTie, this.legs, this.skirts, this.umbrellas]) {
      m.instanceMatrix.needsUpdate = true;
    }
    if (ui > 0) this.umbrellas.instanceColor!.needsUpdate = true;
  }
}
