import * as THREE from 'three';
import type { CityGround } from '../world/Ground';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ViewSystem } from '../types';
import type { BustSystem } from './Bust';

const NAVY = 0x1c2744;
const SKIN = 0xe8c8b0;
const GLOVE = 0xf2f2f2;
const HIP_Y = 0.86;
const SHOULDER_Y = 1.44;
/** Meters per full leg cycle. */
const STRIDE = 1.4;

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** A limb mesh hanging from a joint group at (x, y, 0). */
function limb(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number): THREE.Group {
  const joint = new THREE.Group();
  joint.position.set(x, y, 0);
  joint.add(new THREE.Mesh(geo, mat));
  parent.add(joint);
  return joint;
}

/**
 * The officer of the busted sequence: navy uniform, peaked cap, white gloves, a pale vest stripe,
 * red light baton on the belt. Walks to the player's door, writes on a notepad, then hands the
 * ticket over. A dozen draw calls, only while a bust is running.
 */
export class OfficerView implements ViewSystem {
  private root = new THREE.Group();
  private head = new THREE.Group();
  private legs: THREE.Group[];
  private armL: THREE.Group;
  private armR: THREE.Group;
  private pad: THREE.Mesh;
  private ticket: THREE.Mesh;
  private y = 0;

  constructor(
    private bust: BustSystem,
    scene: THREE.Scene,
    private terrain: CityGround,
  ) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, emissive: 0x161226 });
    const glow = (hex: number) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false });
    const paper = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.9, emissive: 0x2a2a2a });

    const torso = mergeGeometries([
      box(0.42, 0.6, 0.26, 0, 1.18, 0, NAVY),
      box(0.44, 0.07, 0.28, 0, 0.91, 0, 0x0c0c10), // belt
      box(0.08, 0.06, 0.02, 0, 0.91, 0.145, 0xb8a060), // buckle
      box(0.16, 0.06, 0.27, 0, 1.47, 0, 0x8fb4d8), // shirt collar
    ])!;
    this.root.add(new THREE.Mesh(torso, mat));
    // Reflective vest bands and the red light baton hanging from the belt.
    const bands = mergeGeometries([new THREE.BoxGeometry(0.44, 0.045, 0.28).translate(0, 1.06, 0), new THREE.BoxGeometry(0.44, 0.045, 0.28).translate(0, 1.3, 0)])!;
    this.root.add(new THREE.Mesh(bands, glow(0xb9d4ff)));
    const baton = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 6), glow(0xff2a2a));
    baton.position.set(-0.25, 0.74, 0.04);
    baton.rotation.z = 0.25;
    this.root.add(baton);

    const headGeo = mergeGeometries([
      box(0.22, 0.24, 0.22, 0, 0.12, 0, SKIN),
      box(0.27, 0.1, 0.27, 0, 0.29, 0, NAVY), // cap crown
      box(0.24, 0.035, 0.11, 0, 0.235, 0.16, 0x0c0c10), // brim
      box(0.24, 0.025, 0.272, 0, 0.255, 0, 0x1a4a9c), // cap band
    ])!;
    this.head.position.y = 1.5;
    this.head.add(new THREE.Mesh(headGeo, mat));
    this.head.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.01).translate(0, 0.3, 0.14), glow(0x3e7bff))); // badge
    this.root.add(this.head);

    const legGeo = mergeGeometries([box(0.15, HIP_Y - 0.06, 0.17, 0, -(HIP_Y - 0.06) / 2, 0, NAVY), box(0.15, 0.08, 0.24, 0, -HIP_Y + 0.04, 0.03, 0x0a0a0c)])!;
    this.legs = [limb(this.root, legGeo, mat, 0.11, HIP_Y), limb(this.root, legGeo, mat, -0.11, HIP_Y)];
    const armGeo = mergeGeometries([box(0.11, 0.48, 0.13, 0, -0.24, 0, NAVY), box(0.1, 0.1, 0.12, 0, -0.53, 0, GLOVE)])!;
    this.armL = limb(this.root, armGeo, mat, 0.27, SHOULDER_Y);
    this.armR = limb(this.root, armGeo, mat, -0.27, SHOULDER_Y);
    const pen = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.13).translate(0, -0.56, 0.06), glow(0x202020));
    this.armR.add(pen);
    this.ticket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.006, 0.16).translate(0, -0.6, 0.06), paper);
    this.armR.add(this.ticket);

    // Notepad held in front of the chest, face tilted up toward the eyes.
    this.pad = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.015, 0.21), paper);
    this.pad.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.22).translate(0, -0.012, 0), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 })));
    this.root.add(this.pad);

    this.root.visible = false;
    this.root.traverse((o) => (o.frustumCulled = false));
    scene.add(this.root);
  }

  sync(alpha: number, frameDt: number): void {
    const o = this.bust.officer;
    this.root.visible = o !== null;
    if (!o) return;
    const yTarget = this.terrain.surfaceY(o.pos.x, o.pos.z);
    this.y += (yTarget - this.y) * Math.min(1, frameDt * 12);
    if (o.pose === 'walk' && o.walked === 0) this.y = yTarget;

    const [legL, legR] = this.legs;
    let bob = 0;
    if (o.pose === 'walk') {
      const ph = (o.walked / STRIDE) * Math.PI * 2;
      const swing = Math.sin(ph);
      bob = Math.abs(Math.cos(ph)) * 0.04;
      legL.rotation.set(swing * 0.5, 0, 0);
      legR.rotation.set(-swing * 0.5, 0, 0);
      this.armL.rotation.set(-swing * 0.35, 0, 0);
      this.armR.rotation.set(swing * 0.35, 0, 0);
      this.head.rotation.set(0, 0, 0);
      this.pad.visible = false;
      this.ticket.visible = false;
    } else {
      legL.rotation.set(0, 0, 0);
      legR.rotation.set(0, 0, 0);
      this.pad.visible = true;
      if (o.pose === 'write') {
        // Scribble: small fast wobble of the writing hand over the pad.
        this.armL.rotation.set(-1.1, 0, -0.3);
        this.armR.rotation.set(-1.22 + Math.sin(o.t * 9) * 0.05, 0, 0.36 + Math.sin(o.t * 15) * 0.06);
        this.head.rotation.set(0.38, 0, 0);
        this.pad.position.set(0.07, 1.19, 0.44);
        this.ticket.visible = false;
      } else {
        // Hand the ticket through the window.
        const u = Math.min(1, o.t / 0.35);
        this.armL.rotation.set(-0.7, 0, -0.2);
        this.armR.rotation.set(-1.22 - 0.3 * u, 0, 0.36 * (1 - u));
        this.head.rotation.set(0.1, 0, 0);
        this.pad.position.set(0.12, 1.05, 0.36);
        this.ticket.visible = true;
      }
      this.pad.rotation.set(-0.6, 0, 0);
    }

    this.root.position.set(o.prev.x + (o.pos.x - o.prev.x) * alpha, this.y + bob, o.prev.z + (o.pos.z - o.prev.z) * alpha);
    this.root.rotation.set(0, o.yaw, 0);
  }
}
