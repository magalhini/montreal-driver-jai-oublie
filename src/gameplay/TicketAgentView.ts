import * as THREE from 'three';
import type { CityGround } from '../world/Ground';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ViewSystem } from '../types';
import type { TicketAgent } from './ParkingTicket';

const NAVY = 0x1a2433;
const SKIN = 0xe8c8b0;
const LIME = 0xd6f531;
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
 * Parking agent: fluorescent jacket, dark trousers, cap, and the ticket block. Walks up to the car and
 * scribbles. Only in the scene while its source has an agent out (the curb-stall gag, the Vieux-Port coda).
 */
export class TicketAgentView implements ViewSystem {
  private root = new THREE.Group();
  private head = new THREE.Group();
  private legs: THREE.Group[];
  private armL: THREE.Group;
  private armR: THREE.Group;
  /** The block, up in the hands while they write. */
  private pad: THREE.Group;
  /** Same block on the belt while they walk. */
  private holster: THREE.Mesh;
  private y = 0;

  constructor(
    private tickets: { readonly agent: TicketAgent | null },
    scene: THREE.Scene,
    private terrain: CityGround,
  ) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, emissive: 0x1a1428 });
    const hiVis = new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false });
    const paper = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.9, emissive: 0x2a2a2a });
    const board = new THREE.MeshStandardMaterial({ color: 0x24180f, roughness: 0.8, emissive: 0x120e0c });
    const penMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, toneMapped: false });

    const torso = mergeGeometries([
      box(0.4, 0.16, 0.24, 0, 0.86, 0, NAVY), // belt
      box(0.16, 0.05, 0.26, 0, 1.46, 0, 0xc8d0d4), // collar
    ])!;
    this.root.add(new THREE.Mesh(torso, mat));
    const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.56, 0.3), hiVis);
    jacket.position.y = 1.2;
    this.root.add(jacket);
    // Dark band so the jacket reads as a uniform, not a vest thrown on.
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.07, 0.31), new THREE.MeshBasicMaterial({ color: 0x12315c, toneMapped: false }));
    band.position.y = 1.16;
    this.root.add(band);

    const headGeo = mergeGeometries([
      box(0.22, 0.24, 0.22, 0, 0.12, 0, SKIN),
      box(0.26, 0.09, 0.26, 0, 0.28, 0, 0x14181e), // cap
      box(0.24, 0.03, 0.12, 0, 0.23, 0.16, 0x0c0e12), // brim
    ])!;
    this.head.position.y = 1.5;
    this.head.add(new THREE.Mesh(headGeo, mat));
    const capBand = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.27), hiVis);
    capBand.position.y = 0.25;
    this.head.add(capBand);
    this.root.add(this.head);

    const legGeo = mergeGeometries([
      box(0.15, HIP_Y - 0.06, 0.16, 0, -(HIP_Y - 0.06) / 2, 0, NAVY),
      box(0.15, 0.08, 0.24, 0, -HIP_Y + 0.04, 0.03, 0x0c0c0e),
    ])!;
    this.legs = [limb(this.root, legGeo, mat, 0.11, HIP_Y), limb(this.root, legGeo, mat, -0.11, HIP_Y)];

    const sleeve = new THREE.BoxGeometry(0.13, 0.42, 0.15).translate(0, -0.22, 0);
    const skinMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7, emissive: 0x1a1428 });
    const hand = new THREE.BoxGeometry(0.1, 0.1, 0.12).translate(0, -0.48, 0);
    this.armL = limb(this.root, sleeve, hiVis, 0.28, SHOULDER_Y);
    this.armR = limb(this.root, sleeve, hiVis, -0.28, SHOULDER_Y);
    this.armL.add(new THREE.Mesh(hand, skinMat));
    this.armR.add(new THREE.Mesh(hand, skinMat));
    const pen = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.14).translate(0, -0.56, 0.07), penMat);
    this.armR.add(pen);

    this.holster = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.15), board);
    this.holster.position.set(-0.22, 0.98, 0.1);
    this.holster.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.12).translate(0.03, 0, 0), paper));
    this.root.add(this.holster);

    // Ticket block: a thick book with a sheet on the face they write on.
    this.pad = new THREE.Group();
    this.pad.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.26), board));
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.2), paper);
    sheet.position.set(0, 0.026, 0.01);
    this.pad.add(sheet);
    this.root.add(this.pad);

    this.root.visible = false;
    this.root.traverse((o) => (o.frustumCulled = false));
    scene.add(this.root);
  }

  sync(alpha: number, frameDt: number): void {
    const o = this.tickets.agent;
    const appeared = !this.root.visible;
    this.root.visible = o !== null;
    if (!o) return;
    const yTarget = this.terrain.surfaceY(o.pos.x, o.pos.z);
    // Smooth over the curb while walking, but start on the ground (not rising out of it)
    this.y = appeared ? yTarget : this.y + (yTarget - this.y) * Math.min(1, frameDt * 12);
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
      this.holster.visible = true;
    } else {
      legL.rotation.set(0, 0, 0);
      legR.rotation.set(0, 0, 0);
      // Scribble: the writing hand wobbles over the block.
      this.armL.rotation.set(-1.05, 0, -0.35);
      this.armR.rotation.set(-1.2 + Math.sin(o.t * 9) * 0.05, 0, 0.4 + Math.sin(o.t * 15) * 0.07);
      this.head.rotation.set(0.4, 0, 0);
      this.pad.visible = true;
      this.pad.position.set(0.06, 1.16, 0.4);
      this.pad.rotation.set(-0.65, 0.15, 0);
      this.holster.visible = false;
    }

    this.root.position.set(o.prev.x + (o.pos.x - o.prev.x) * alpha, this.y + bob, o.prev.z + (o.pos.z - o.prev.z) * alpha);
    this.root.rotation.set(0, o.yaw, 0);
  }
}
