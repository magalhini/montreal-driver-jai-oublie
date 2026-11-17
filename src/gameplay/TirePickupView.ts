import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fwd, leftOf } from '../core/math';
import type { ViewSystem } from '../types';
import type { Car } from '../vehicles/Car';
import { PROFILES } from '../vehicles/BodyProfiles';
import type { CityGround } from '../world/Ground';
import { tireMesh, type TireStorage } from '../world/TireStorage';
import type { TirePickup } from './TirePickup';

const PARKA = 0x3f4d36;
const FUR = 0xcdbb98;
const JEANS = 0x2b3a56;
const BOOT = 0x3a2717;
const SKIN = 0xe3c2a6;
const TUQUE = 0xc23328;
const HIP_Y = 0.86;
const SHOULDER_Y = 1.42;
/** Meters per full leg cycle. */
const STRIDE = 1.35;
/** Lid swing when fully open (rad). */
const LID_OPEN = 1.2;

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function limb(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number): THREE.Group {
  const joint = new THREE.Group();
  joint.position.set(x, y, 0);
  joint.add(new THREE.Mesh(geo, mat));
  parent.add(joint);
  return joint;
}

const smooth = (u: number) => {
  const k = Math.min(1, Math.max(0, u));
  return k * k * (3 - 2 * k);
};

/**
 * The storage scene on screen (`TirePickup`): the driver in a parka and a tuque, the winter tire in their
 * arms, the car's trunk lid swinging up (a lid drawn over the body, with the dark opening under it), the
 * storefront's roll-up door, and the camera shot from the street behind the car.
 */
export class TirePickupView implements ViewSystem {
  private root = new THREE.Group();
  private head = new THREE.Group();
  private legs: THREE.Group[];
  private armL: THREE.Group;
  private armR: THREE.Group;
  private tire: THREE.Group;
  private y = 0;
  /** Forward lean over the sill while loading (rad). */
  private lean = 0;
  /** The lid pivots at its hinge in the car body's frame; `hole` is the dark opening under it. */
  private lid = new THREE.Group();
  private hole = new THREE.Group();
  private lidPaint: THREE.MeshStandardMaterial;
  private lidOn: THREE.Object3D | null = null;
  private lidStyle = '';
  /** Where the tire goes in, along the car from its center (m), and how high. */
  private trunkAlong = -1.5;
  private trunkY = 0.8;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shotReady = false;

  constructor(
    private readonly pickup: TirePickup,
    private readonly player: Car,
    private readonly storage: TireStorage,
    scene: THREE.Scene,
    private readonly terrain: CityGround,
    /** The player's body group, once the car view has one. */
    private readonly body: () => THREE.Object3D | undefined,
  ) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: 0x161220 });
    const torso = mergeGeometries([
      box(0.5, 0.62, 0.34, 0, 1.16, 0, PARKA), // parka, puffed
      box(0.52, 0.12, 0.36, 0, 0.82, 0, PARKA), // hem
      box(0.3, 0.1, 0.3, 0, 1.47, -0.03, FUR), // hood ruff behind the neck
      box(0.04, 0.5, 0.02, 0, 1.15, 0.175, 0x23281f), // zip
    ])!;
    this.root.add(new THREE.Mesh(torso, mat));

    const headGeo = mergeGeometries([
      box(0.22, 0.24, 0.22, 0, 0.12, 0, SKIN),
      box(0.25, 0.14, 0.25, 0, 0.26, 0, TUQUE),
      box(0.26, 0.05, 0.26, 0, 0.2, 0, 0xe8e2d6), // folded brim
      box(0.09, 0.08, 0.09, 0, 0.36, 0, 0xf2eee6), // pompom
      box(0.24, 0.07, 0.02, 0, 0.0, 0.11, 0x8a1e1e), // scarf
    ])!;
    this.head.position.y = 1.5;
    this.head.add(new THREE.Mesh(headGeo, mat));
    this.root.add(this.head);

    const legGeo = mergeGeometries([box(0.16, HIP_Y - 0.1, 0.17, 0, -(HIP_Y - 0.1) / 2, 0, JEANS), box(0.17, 0.16, 0.27, 0, -HIP_Y + 0.08, 0.03, BOOT)])!;
    this.legs = [limb(this.root, legGeo, mat, 0.12, HIP_Y), limb(this.root, legGeo, mat, -0.12, HIP_Y)];
    const armGeo = mergeGeometries([box(0.15, 0.5, 0.16, 0, -0.25, 0, PARKA), box(0.11, 0.1, 0.12, 0, -0.55, 0, 0x2a2420)])!;
    this.armL = limb(this.root, armGeo, mat, 0.31, SHOULDER_Y);
    this.armR = limb(this.root, armGeo, mat, -0.31, SHOULDER_Y);

    this.tire = tireMesh();
    this.root.add(this.tire);

    this.root.visible = false;
    this.root.traverse((o) => (o.frustumCulled = false));
    scene.add(this.root);

    this.lidPaint = new THREE.MeshStandardMaterial({ color: 0xd2381f, roughness: 0.38, metalness: 0.35 });
  }

  sync(alpha: number, frameDt: number): void {
    const pk = this.pickup;
    this.storage.update(pk.door, pk.armed() || pk.playing, performance.now() / 1000);
    this.syncLid();
    const d = pk.driver;
    this.root.visible = pk.playing && d.visible;
    if (!this.root.visible) {
      if (!pk.cinematic) this.shotReady = false;
      return;
    }
    const yTarget = this.terrain.surfaceY(d.pos.x, d.pos.z);
    this.y += (yTarget - this.y) * Math.min(1, frameDt * 12);
    if (Math.abs(yTarget - this.y) > 0.6) this.y = yTarget;

    const [legL, legR] = this.legs;
    let bob = 0;
    this.tire.visible = d.carrying || d.pose === 'load';
    this.head.rotation.set(0, 0, 0);
    this.lean = 0;
    if (d.pose === 'walk') {
      const ph = (d.walked / STRIDE) * Math.PI * 2;
      const swing = Math.sin(ph);
      bob = Math.abs(Math.cos(ph)) * 0.04;
      legL.rotation.set(swing * 0.5, 0, 0);
      legR.rotation.set(-swing * 0.5, 0, 0);
      if (d.carrying) {
        // Both arms round the tire, held against the chest
        this.armL.rotation.set(-0.95, 0, 0.25);
        this.armR.rotation.set(-0.95, 0, -0.25);
        this.tire.position.set(0, 1.05 + bob * 0.5, 0.42);
        this.tire.rotation.set(0, 0, 0);
      } else {
        this.armL.rotation.set(-swing * 0.35, 0, 0.08);
        this.armR.rotation.set(swing * 0.35, 0, -0.08);
      }
    } else {
      legL.rotation.set(0, 0, 0);
      legR.rotation.set(0, 0, 0);
      if (d.pose === 'load') this.poseLoad(d.t);
      else if (d.pose === 'close') {
        // Reach up for the lid and pull it down
        const u = smooth(d.t / 0.6);
        const a = -2.5 + u * 1.3;
        this.armL.rotation.set(a, 0, 0.12);
        this.armR.rotation.set(a, 0, -0.12);
        this.head.rotation.set(-0.2 + u * 0.4, 0, 0);
      } else {
        this.armL.rotation.set(0, 0, 0.08);
        this.armR.rotation.set(0, 0, -0.08);
      }
    }
    this.root.position.set(d.prev.x + (d.pos.x - d.prev.x) * alpha, this.y + bob, d.prev.z + (d.pos.z - d.prev.z) * alpha);
    this.root.rotation.set(this.lean, d.yaw, 0, 'YXZ');
  }

  /** Lift the tire to chest height, swing it over the sill and lay it in the trunk. */
  private poseLoad(t: number): void {
    const p = this.player;
    // The driver stands behind the car facing it: in their frame the trunk is straight ahead
    const reach = p.halfL + 0.5 + this.trunkAlong;
    const lift = smooth(t / 0.45);
    const over = smooth((t - 0.45) / 0.6);
    const sink = smooth((t - 1.05) / 0.35);
    const arms = -0.95 - lift * 0.6 + over * 0.35 + sink * 0.5;
    this.armL.rotation.set(arms, 0, 0.25 * (1 - over));
    this.armR.rotation.set(arms, 0, -0.25 * (1 - over));
    this.head.rotation.set(0.25 * over, 0, 0);
    this.lean = 0.32 * over * (1 - sink * 0.6);
    const y = 1.05 + lift * 0.4 - over * (1.45 - this.trunkY - 0.1) - sink * 0.25;
    const z = 0.42 + over * (reach - 0.42);
    this.tire.position.set(0, y, z);
    this.tire.rotation.set(over * (Math.PI / 2), 0, 0);
    this.tire.visible = sink < 0.98;
  }

  /** Put the lid on the player's body while it is open; take it off once it is shut. */
  private syncLid(): void {
    const open = this.pickup.lid;
    const body = this.body();
    if (open <= 0.001 || !body) {
      if (this.lidOn) {
        this.lidOn.remove(this.lid, this.hole);
        this.lidOn = null;
      }
      return;
    }
    if (this.lidOn !== body) {
      this.lidOn?.remove(this.lid, this.hole);
      this.buildLid();
      body.add(this.lid, this.hole);
      this.lidOn = body;
    }
    this.lid.rotation.x = smooth(open) * LID_OPEN;
  }

  /**
   * Lid panels from the profile: a hatch (glass and the short deck behind it) on cars whose deck is short,
   * a trunk lid on the deck otherwise. The opening under it is the same outline in near-black.
   */
  private buildLid(): void {
    const look = this.player.look;
    if (this.lidStyle === `${look.style}:${look.color}`) return;
    this.lidStyle = `${look.style}:${look.color}`;
    this.lidPaint.color.setHex(look.color);
    for (const g of [this.lid, this.hole]) {
      for (const c of [...g.children]) {
        g.remove(c);
        if (c instanceof THREE.Mesh) c.geometry.dispose();
      }
    }
    // Trucks have no profile: they keep the tire out of sight in the bed, no lid
    const st = look.style in PROFILES ? PROFILES[look.style as keyof typeof PROFILES] : null;
    if (!st) return;
    const deckEnd = st.deck[st.deck.length - 1];
    const tailTop = st.tail[0];
    const hatch = st.bl[1][0] - deckEnd[0] < 0.5;
    const hinge = hatch ? st.bl[0] : st.bl[1];
    const pts: [number, number][] = hatch ? [st.bl[0], st.bl[1], ...st.deck, tailTop] : [st.bl[1], ...st.deck, tailTop];
    this.lid.position.set(0, hinge[1], hinge[0]);
    this.hole.position.copy(this.lid.position);
    const glass = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.15, metalness: 0.6 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x0a0a0c, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const bodyW = st.W - 0.12;
    const glassW = st.gW * (0.5 + 0.5 * st.tumble) - 0.06;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [z0, y0] = pts[i];
      const [z1, y1] = pts[i + 1];
      const len = Math.hypot(z1 - z0, y1 - y0);
      if (len < 0.01) continue;
      const isGlass = hatch && i === 0;
      const w = isGlass ? glassW : bodyW;
      const midZ = (z0 + z1) / 2 - hinge[0];
      const midY = (y0 + y1) / 2 - hinge[1];
      const tilt = Math.atan2(y1 - y0, z0 - z1);
      // Panel along its own z, rotated to the slope (positive tilt raises the far end)
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, len + 0.02), isGlass ? glass : this.lidPaint);
      panel.position.set(0, midY + 0.02, midZ);
      panel.rotation.x = tilt;
      this.lid.add(panel);
      const gap = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, len).rotateX(-Math.PI / 2), dark);
      gap.position.set(0, midY + 0.012, midZ);
      gap.rotation.x = tilt;
      this.hole.add(gap);
      if (isGlass) {
        // The glass's frame, in the body color, so the open hatch reads as a panel and not a sheet of glass
        for (const s of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, len + 0.02), this.lidPaint);
          rail.position.set((s * (glassW + 0.05)) / 2, midY + 0.02, midZ);
          rail.rotation.x = tilt;
          this.lid.add(rail);
        }
      }
    }
    this.trunkAlong = (pts[0][0] + pts[pts.length - 1][0]) / 2;
    this.trunkY = (pts[0][1] + pts[pts.length - 1][1]) / 2 - 0.1;
    this.lid.traverse((o) => (o.frustumCulled = false));
    this.hole.traverse((o) => (o.frustumCulled = false));
  }

  /**
   * The cutscene shot: from the street behind the car, up over the roofs of passing traffic, pushing in
   * slowly and leaning toward wherever the driver is.
   */
  aim(camera: THREE.PerspectiveCamera, dt: number): void {
    const pk = this.pickup;
    const car = pk.car;
    const f = fwd(car.yaw);
    const l = leftOf(car.yaw);
    const hl = this.player.halfL;
    const street = -pk.side;
    const push = Math.min(1.8, pk.sceneT * 0.12);
    const along = -(hl + 6.2) + push;
    const lat = street * 4.4;
    const cx = car.pos.x + f.x * along + l.x * lat;
    const cz = car.pos.z + f.z * along + l.z * lat;
    const groundY = this.terrain.heightAt(car.pos.x, car.pos.z);
    const pos = new THREE.Vector3(cx, groundY + 3.1, cz);
    // Between the trunk and the door, leaning toward the driver
    const door = pk.stop.door;
    const trunk = { x: car.pos.x - f.x * hl, z: car.pos.z - f.z * hl };
    let tx = (door.x + trunk.x) / 2;
    let tz = (door.z + trunk.z) / 2;
    const d = pk.driver;
    if (d.visible) {
      tx += (d.pos.x - tx) * 0.4;
      tz += (d.pos.z - tz) * 0.4;
    }
    const look = new THREE.Vector3(tx, groundY + 1.0, tz);
    if (!this.shotReady) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.shotReady = true;
    }
    const k = 1 - Math.exp(-dt * 2.5);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
  }
}
