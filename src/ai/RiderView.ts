import * as THREE from 'three';
import { clamp, lerpAngle } from '../core/math';
import { hash01 } from '../core/Rng';
import type { World } from '../core/World';
import { GlowQuads } from '../render/GlowQuads';
import type { ViewSystem } from '../types';
import type { CityGround } from '../world/Ground';
import {
  BIKE_AXLE,
  BIKE_WHEEL_R,
  bicycleGeometry,
  CRANK,
  deliveryBoxGeometry,
  limbGeometry,
  paintMaterial,
  riderGeometry,
  SCOOTER_AXLE,
  SCOOTER_WHEEL_R,
  scooterGeometry,
  umbrellaGeometry,
  wheelGeometry,
} from './RiderGeometry';
import type { Rider } from './Rider';

const MAX = 48;
const FRAMES = [0xb8bcc0, 0xe8e8e4, 0x1e1e22, 0xa02020, 0x8ab0d0, 0x9ad0b0, 0xe0a0b0, 0xe0c040, 0xb8bcc0, 0xe8e8e4];
const SCOOTERS = [0xa01818, 0x1c2a5a, 0x3a6a4a, 0xd8d0b8, 0x3a6aa0, 0x18181c];
const BOXES = [0xb0b4b8, 0xb0b4b8, 0xa01c18];
const CLOTHES = [0x1c2340, 0x15151a, 0x5a5f6a, 0xc8b48a, 0x8a1e2a, 0x2a4a6a, 0xd8d0c8, 0x6a3a7a, 0xe07aa8, 0x2f6a5a, 0xd89a3a];
const PANTS = [0x15151a, 0x1c2340, 0x3a3a46, 0x4a3a2a, 0x2a2a30];
const UMBRELLAS = [0xffffff, 0xff7ab8, 0x7af2ff, 0xffd27a, 0xb48cff];
/** Lamp halos: bicycle dynamo lamp and rear reflector, scooter head / tail / brake lamps. */
const GLOW = {
  bikeLamp: { color: new THREE.Color(1.3, 1.05, 0.55), size: 0.55, at: new THREE.Vector3(0, 0.66, 0.8) },
  reflector: { color: new THREE.Color(0.8, 0.04, 0.03), size: 0.32, at: new THREE.Vector3(0, 0.36, -0.89) },
  scooterHead: { color: new THREE.Color(1.5, 1.35, 1.0), size: 1.0, at: new THREE.Vector3(0, 1.0, 0.61) },
  scooterTail: { color: new THREE.Color(0.8, 0.03, 0.02), size: 0.55, at: new THREE.Vector3(0, 0.66, -0.92) },
  scooterBrake: { color: new THREE.Color(1.6, 0.06, 0.04), size: 0.9, at: new THREE.Vector3(0, 0.66, -0.92) },
};
const FACE_FRONT = new THREE.Quaternion();
const FACE_BACK = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const THIGH = 0.46;
const SHIN = 0.48;
const UP = new THREE.Vector3(0, 1, 0);
/** Glow quads grow with distance (like car lamps) so riders read down the street. */
const GLOW_GROW_DIST = 70;

function instanced(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color());
  m.frustumCulled = false;
  m.count = 0;
  scene.add(m);
  return m;
}

const pick = <T,>(arr: T[], seed: number, salt: number): T => arr[Math.floor(hash01(seed, salt) * arr.length)];

/** Instanced bicycles (mamachari) and 50 cc scooters with seated riders: pedaling legs, lean, lamps, umbrellas. */
export class RiderView implements ViewSystem {
  /** Rain intensity 0..1 (set by main): cyclists open umbrellas. */
  rain = 0;
  private bikes: THREE.InstancedMesh;
  private scooters: THREE.InstancedMesh;
  private boxes: THREE.InstancedMesh;
  private bikeWheels: THREE.InstancedMesh;
  private scooterWheels: THREE.InstancedMesh;
  private bikeRiders: THREE.InstancedMesh;
  private scooterRiders: THREE.InstancedMesh;
  private limbs: THREE.InstancedMesh;
  private umbrellas: THREE.InstancedMesh;
  private glow: GlowQuads;
  private ys = new Map<number, number>();
  private n = { bike: 0, scooter: 0, box: 0, bw: 0, sw: 0, limb: 0, umb: 0 };
  private m = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private out = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private color = new THREE.Color();
  private hip = new THREE.Vector3();
  private knee = new THREE.Vector3();
  private foot = new THREE.Vector3();
  private shoulder = new THREE.Vector3();
  private hand = new THREE.Vector3();

  constructor(
    private world: World,
    scene: THREE.Scene,
    private terrain: CityGround,
    private camera: THREE.Camera,
  ) {
    const paint = paintMaterial();
    const cloth = paintMaterial({ roughness: 0.85, metalness: 0, emissive: 0x1a1428 });
    this.bikes = instanced(scene, bicycleGeometry(), paint, MAX);
    this.scooters = instanced(scene, scooterGeometry(), paint, MAX);
    this.boxes = instanced(scene, deliveryBoxGeometry(), paint, MAX);
    this.bikeWheels = instanced(scene, wheelGeometry(false), paint, MAX * 2);
    this.scooterWheels = instanced(scene, wheelGeometry(true), paint, MAX * 2);
    this.bikeRiders = instanced(scene, riderGeometry(false), cloth, MAX);
    this.scooterRiders = instanced(scene, riderGeometry(true), cloth, MAX);
    this.limbs = instanced(scene, limbGeometry(), cloth, MAX * 4 + 8);
    this.umbrellas = instanced(
      scene,
      umbrellaGeometry(),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      MAX,
    );
    this.glow = new GlowQuads(scene, MAX * 2);
  }

  private put(mesh: THREE.InstancedMesh, i: number, mat: THREE.Matrix4, hex: number): void {
    mesh.setMatrixAt(i, mat);
    mesh.setColorAt(i, this.color.setHex(hex));
  }

  /** Box limb from a to b (bike frame), thickness w. */
  private limb(a: THREE.Vector3, b: THREE.Vector3, w: number, hex: number): void {
    if (this.n.limb >= this.limbs.instanceMatrix.count) return;
    this.dir.subVectors(b, a);
    const len = this.dir.length();
    this.q.setFromUnitVectors(UP, this.dir.divideScalar(len || 1));
    this.local.compose(a, this.q, this.s.set(w, len, w));
    this.put(this.limbs, this.n.limb++, this.out.multiplyMatrices(this.m, this.local), hex);
  }

  /** Two-bone leg from the hip to the foot, the knee bending forward (in the bike's side plane). */
  private leg(hip: THREE.Vector3, foot: THREE.Vector3, hex: number): void {
    const dz = foot.z - hip.z;
    const dy = foot.y - hip.y;
    const dRaw = Math.hypot(dz, dy) || 1;
    const d = Math.min(dRaw, THIGH + SHIN - 0.005);
    const uz = dz / dRaw;
    const uy = dy / dRaw;
    const a = Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
    this.knee.set(
      (hip.x + foot.x) / 2,
      hip.y + THIGH * (Math.cos(a) * uy + Math.sin(a) * uz),
      hip.z + THIGH * (Math.cos(a) * uz - Math.sin(a) * uy),
    );
    this.limb(hip, this.knee, 0.13, hex);
    this.limb(this.knee, foot, 0.11, hex);
  }

  private halo(at: THREE.Vector3, face: THREE.Quaternion, g: { color: THREE.Color; size: number }, grow: number): void {
    this.local.compose(at, face, this.s.setScalar(g.size * grow));
    this.glow.push(this.out.multiplyMatrices(this.m, this.local), g.color);
  }

  private drawRider(r: Rider, alpha: number, frameDt: number): void {
    const scooter = r.kind === 'scooter';
    const x = r.prev.x + (r.pos.x - r.prev.x) * alpha;
    const z = r.prev.z + (r.pos.z - r.prev.z) * alpha;
    const heading = lerpAngle(r.prevHeading, r.heading, alpha);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const axle = scooter ? SCOOTER_AXLE : BIKE_AXLE;
    const yT = this.terrain.surfaceY(x, z);
    let y = this.ys.get(r.id) ?? yT;
    if (Math.abs(yT - y) > 0.6) y = yT;
    y += (yT - y) * Math.min(1, frameDt * 12);
    this.ys.set(r.id, y);
    const pitch = Math.atan2(this.terrain.surfaceY(x + fx * axle, z + fz * axle) - this.terrain.surfaceY(x - fx * axle, z - fz * axle), axle * 2);
    // Stopped cyclists put a foot down and lean onto it
    const footDown = !scooter && r.speed < 0.25;
    const lean = footDown ? 0.13 : r.lean;
    this.e.set(-pitch, heading, -lean, 'YXZ');
    this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(1, 1, 1));

    const paint = scooter ? pick(SCOOTERS, r.look, 1) : pick(FRAMES, r.look, 1);
    const clothes = pick(CLOTHES, r.look, 2);
    const pants = pick(PANTS, r.look, 3);
    if (scooter) {
      this.put(this.scooters, this.n.scooter++, this.m, paint);
      this.put(this.scooterRiders, this.n.scooter - 1, this.m, clothes);
      if (hash01(r.look, 7) < 0.45) this.put(this.boxes, this.n.box++, this.m, pick(BOXES, r.look, 8));
    } else {
      this.put(this.bikes, this.n.bike++, this.m, paint);
      this.put(this.bikeRiders, this.n.bike - 1, this.m, clothes);
    }

    // Wheels roll with the distance ridden
    const wr = scooter ? SCOOTER_WHEEL_R : BIKE_WHEEL_R;
    const roll = (r.phase * (scooter ? 0.3 : 0.55)) / wr;
    for (const az of [axle, -axle]) {
      this.local.makeRotationX(roll).setPosition(0, wr, az);
      this.out.multiplyMatrices(this.m, this.local);
      if (scooter) this.put(this.scooterWheels, this.n.sw++, this.out, 0xffffff);
      else this.put(this.bikeWheels, this.n.bw++, this.out, 0xffffff);
    }

    // Limbs: arms to the grips; legs pedaling (bicycle) or resting on the floorboard (scooter)
    for (const sx of [1, -1]) {
      if (scooter) {
        this.shoulder.set(sx * 0.21, 1.42, -0.15);
        this.hand.set(sx * 0.31, 1.0, 0.42);
        this.hip.set(sx * 0.12, 0.88, -0.22);
        this.foot.set(sx * 0.13, 0.42, 0.16);
      } else {
        this.shoulder.set(sx * 0.21, 1.44, -0.13);
        this.hand.set(sx * 0.28, 0.99, 0.2);
        this.hip.set(sx * 0.1, 0.98, -0.25);
        const c = r.phase + (sx > 0 ? 0 : Math.PI);
        this.foot.set(sx * 0.14, CRANK.y - CRANK.r * Math.sin(c), CRANK.z + CRANK.r * Math.cos(c));
        if (footDown && sx > 0) this.foot.set(0.36, 0.06, -0.12);
      }
      this.limb(this.shoulder, this.hand, 0.1, clothes);
      this.leg(this.hip, this.foot, pants);
    }

    if (!scooter && hash01(r.look, 9) < this.rain * 0.6) {
      this.put(this.umbrellas, this.n.umb++, this.m, pick(UMBRELLAS, r.look, 4));
    }

    const cam = this.camera.position;
    const grow = Math.min(2, 1 + Math.hypot(x - cam.x, z - cam.z) / GLOW_GROW_DIST);
    if (scooter) {
      this.halo(GLOW.scooterHead.at, FACE_FRONT, GLOW.scooterHead, grow);
      const tail = r.braking ? GLOW.scooterBrake : GLOW.scooterTail;
      this.halo(tail.at, FACE_BACK, tail, grow);
    } else {
      this.halo(GLOW.bikeLamp.at, FACE_FRONT, GLOW.bikeLamp, grow);
      this.halo(GLOW.reflector.at, FACE_BACK, GLOW.reflector, grow);
    }
  }

  sync(alpha: number, frameDt: number): void {
    const n = this.n;
    n.bike = n.scooter = n.box = n.bw = n.sw = n.limb = n.umb = 0;
    this.glow.begin();
    const live = new Set<number>();
    for (const r of this.world.riders) {
      if (n.bike + n.scooter >= MAX) break;
      live.add(r.id);
      this.drawRider(r, alpha, frameDt);
    }
    for (const id of this.ys.keys()) if (!live.has(id)) this.ys.delete(id);
    this.glow.end();
    const done = (mesh: THREE.InstancedMesh, count: number) => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    };
    done(this.bikes, n.bike);
    done(this.bikeRiders, n.bike);
    done(this.scooters, n.scooter);
    done(this.scooterRiders, n.scooter);
    done(this.boxes, n.box);
    done(this.bikeWheels, n.bw);
    done(this.scooterWheels, n.sw);
    done(this.limbs, n.limb);
    done(this.umbrellas, n.umb);
  }
}
