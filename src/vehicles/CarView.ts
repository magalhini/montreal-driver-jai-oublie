import * as THREE from 'three';
import { clamp } from '../core/math';
import type { ViewSystem } from '../types';
import { GlowQuads } from '../render/GlowQuads';
import { LOOK } from '../render/Look';
import { sharedGlow } from '../world/textures';
import type { Car } from './Car';
import { buildCarParts, carMaterial } from './CarModel';
import { PLATE_H, PLATE_W, PLAYER_PLATE, plateMaterial } from './Plate';
import { wheelPair } from './CarWheel';
import type { WheelId } from './Tuning';

const MAT = {
  // Per-vertex matId picks glass / chrome / trim shading inside the single body draw call
  paint: carMaterial({ roughness: 0.32, metalness: 0.45 }),
  wheel: carMaterial({ roughness: 0.45, metalness: 0.6 }),
  // Lamps skip tone mapping so they stay saturated (ACES pushes bright colors toward white)
  head: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.86), toneMapped: false }),
  tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.04, 0.03), toneMapped: false }),
  brake: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.07, 0.04), toneMapped: false }),
  reverse: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), toneMapped: false }),
  redOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.1), toneMapped: false }),
  blueOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.35, 1), toneMapped: false }),
  barOff: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.05, 0.08) }),
  /** For hire: the warm 空車 lamp. */
  taxiFree: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.62, 0.16), toneMapped: false }),
  /** Fare aboard: the lamp goes red. */
  lampOff: new THREE.MeshStandardMaterial({ color: 0x9a9a90, roughness: 0.15, metalness: 0.6 }),
  tailOff: new THREE.MeshStandardMaterial({ color: 0x3a0806, roughness: 0.2, metalness: 0.4 }),
  beam: new THREE.MeshBasicMaterial({
    map: sharedGlow(),
    color: new THREE.Color(0.55, 0.5, 0.42),
    transparent: true,
    opacity: LOOK.pool,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  // The siren wash on the asphalt still has to read by day: it is how a chase is spotted from a block away
  sirenGlow: new THREE.MeshBasicMaterial({ map: sharedGlow(), transparent: true, opacity: Math.min(1, LOOK.pool * 4), blending: THREE.AdditiveBlending, depthWrite: false }),
};

/** Blob shadows with a per-instance opacity (they fade and spread while the car is in the air). */
const shadowMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: { map: { value: sharedGlow() } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aOpacity;
      varying float vO;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vO = aOpacity;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying float vO;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(map, vUv).a * vO); }`,
  });

/** Player headlight beam (candela-ish, physically based lights). */
const SPOT_INTENSITY = 220 * LOOK.headSpot;

/** Halo color and size (m) per lamp state. Headlight halos stay soft so oncoming traffic is not glaring. */
const GLOW = {
  head: { color: new THREE.Color(0.55, 0.5, 0.4), size: 1.3 },
  tail: { color: new THREE.Color(0.7, 0.03, 0.02), size: 1.1 },
  brake: { color: new THREE.Color(1.5, 0.05, 0.03), size: 1.8 },
  reverse: { color: new THREE.Color(0.7, 0.7, 0.7), size: 1.3 },
  // Turn signals: a hot amber core (reads as the lit lamp) inside a wider halo, plus a side repeater
  blinkCore: { color: new THREE.Color(2.4, 1.0, 0.12), size: 0.32 },
  blinkHalo: { color: new THREE.Color(1.1, 0.42, 0.03), size: 1.5 },
  blinkSide: { color: new THREE.Color(1.3, 0.52, 0.05), size: 0.9 },
  /** Roof lamp, for hire. */
  taxiFree: { color: new THREE.Color(1.15, 0.62, 0.14), size: 1.15 },
  /** Roof lamp with a fare aboard. */
};
/**
 * Capacity of the shared per-car buffers (shadows, headlight beams, stock wheels). Traffic alone reaches 93 at
 * GRIDLOCK, plus police and up to 70 curb-parked cars. A car
 * past it is still drawn, only without the extras that no longer fit.
 */
const MAX_CARS = 200;
/** Halos grow with distance (up to 2x) so lamps stay readable down the street. */
const GLOW_GROW_DIST = 90;
const FACE_FRONT = new THREE.Quaternion();
const FACE_BACK = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
/** Car frame: +x is the car's left. */
const FACE_LEFT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const FACE_RIGHT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const SIREN_RED = new THREE.Color(1, 0.1, 0.1);
const SIREN_BLUE = new THREE.Color(0.1, 0.1, 1);

const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** Turn signal lamp spots per side [left (+x), right]: outboard of the outermost head / tail lamp. */
function blinkerSpots(head: [number, number, number][], tail: [number, number, number][], width: number): Visual['blink'] {
  const hw = width / 2;
  const outer = (lamps: [number, number, number][], sx: number) => lamps.reduce((a, b) => (b[0] * sx > a[0] * sx ? b : a));
  const out: Visual['blink'] = { front: [], rear: [], side: [] };
  for (const sx of [1, -1]) {
    const h = outer(head, sx);
    const t = outer(tail, sx);
    out.front.push(new THREE.Vector3(sx * (hw - 0.09), h[1] - 0.1, h[2] - 0.03));
    out.rear.push(new THREE.Vector3(sx * (hw - 0.07), t[1], t[2]));
    out.side.push(new THREE.Vector3(sx * (hw + 0.02), h[1], h[2] - 0.55));
  }
  return out;
}

/** One rim design's wheels: x > 0 and the mirrored x < 0 side (instances can't flip their winding). */
interface WheelSet {
  pos: THREE.InstancedMesh;
  neg: THREE.InstancedMesh;
  nPos: number;
  nNeg: number;
}

function batch(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, max: number, colors = false): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colors) m.setColorAt(0, new THREE.Color());
  m.frustumCulled = false;
  m.count = 0;
  scene.add(m);
  return m;
}

function lookKey(car: Car): string {
  return `${car.look.style}_${car.look.color}_${car.look.detail ?? ''}`;
}

const PLATE_GEO = new THREE.PlaneGeometry(PLATE_W, PLATE_H);

interface Visual {
  key: string;
  root: THREE.Group;
  body: THREE.Group;
  paint: THREE.Mesh;
  front: THREE.Mesh;
  rear: THREE.Mesh;
  headPos: THREE.Vector3[];
  tailPos: THREE.Vector3[];
  wheelPos: THREE.Vector3[];
  /** Turn signal lamps [left, right]: front corner, rear corner, front fender repeater. */
  blink: { front: THREE.Vector3[]; rear: THREE.Vector3[]; side: THREE.Vector3[] };
  barL?: THREE.Mesh;
  barR?: THREE.Mesh;
  sign?: THREE.Mesh;
  /** Roof-lamp center, for the glow. */
  signAt?: THREE.Vector3;
  wheelAngle: number;
  /** Driven wheels, so a clutch dump can spin them faster than the road speed. */
  rearAngle: number;
  r: number;
  width: number;
  length: number;
  droop: number;
  curb: number;
}

/** Road speed, or engine speed while the driven wheels are spinning (a clutch dump, a power slide). */
function drivenWheelRate(car: Car, radius: number): number {
  const s = car.phys.state;
  const road = s.speed / radius;
  // A high-speed slide keeps the wheels near road speed. A dump spins them until they hook.
  if (!car.phys.wheelspin || (!car.input.burnout && Math.abs(s.speed) > 8)) return road;
  const sp = car.phys.spec;
  const g = s.gear === -1 ? sp.reverseGear : (sp.gears[Math.max(0, s.gear - 1)] ?? sp.gears[0]);
  const ratio = Math.max(0.5, g * sp.finalDrive);
  const signed = (s.gear === -1 ? -1 : 1) * (s.rpm / ratio) * (Math.PI / 30);
  return Math.abs(signed) > Math.abs(road) ? signed : road;
}

/**
 * Syncs car meshes to simulated cars: interpolated position, height and attitude (hills, jumps), body roll,
 * suspension, wheels, lamps. Wheels, ground shadows, headlight pools and siren glows of all cars are drawn
 * as shared instanced batches, so each car costs only its body and lamp draws.
 */
export class CarView implements ViewSystem {
  private visuals = new Map<number, Visual>();
  private spot: THREE.SpotLight;
  private glow: GlowQuads;
  /** Factory rims for everyone (up to 3 wheels a side: trucks have rear duals); pit garage rims on demand. */
  private wheelSets = new Map<WheelId, WheelSet>();
  private shadows: THREE.InstancedMesh;
  private shadowOpacity: THREE.InstancedBufferAttribute;
  private beams: THREE.InstancedMesh;
  private sirens: THREE.InstancedMesh;
  private local = new THREE.Matrix4();
  private world = new THREE.Matrix4();
  private groundM = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private scale = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  /** Body paint with a slab cut out (the cabin around the cockpit camera); see `setCutaway`. */
  private cutPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];
  private cutMat = carMaterial({ roughness: 0.32, metalness: 0.45, clippingPlanes: this.cutPlanes, clipIntersection: true });
  private cutId: number | null = null;
  time = 0;
  /** Drivable ground height and visual surface (with curbs); set to the city terrain. */
  groundAt: (x: number, z: number) => number = () => 0;
  surfaceAt: (x: number, z: number) => number = () => 0;

  constructor(
    private scene: THREE.Scene,
    private getCars: () => Car[],
    private camera: THREE.Camera,
  ) {
    this.spot = new THREE.SpotLight(0xfff1dd, SPOT_INTENSITY, 75, 0.55, 0.6, 1.4);
    scene.add(this.spot, this.spot.target);
    this.glow = new GlowQuads(scene, MAX_CARS * 4 + 100);
    this.wheelSet('stock');
    const sg = planeGeo.clone();
    this.shadowOpacity = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS), 1);
    this.shadowOpacity.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aOpacity', this.shadowOpacity);
    this.shadows = batch(scene, sg, shadowMaterial(), MAX_CARS);
    this.beams = batch(scene, planeGeo, MAT.beam, MAX_CARS);
    this.beams.renderOrder = 1;
    this.sirens = batch(scene, planeGeo, MAT.sirenGlow, 16, true);
    this.sirens.renderOrder = 1;
  }

  private wheelSet(id: WheelId): WheelSet {
    let set = this.wheelSets.get(id);
    if (!set) {
      const geo = wheelPair(id);
      const max = id === 'stock' ? MAX_CARS * 3 : 12;
      set = { pos: batch(this.scene, geo.pos, MAT.wheel, max), neg: batch(this.scene, geo.neg, MAT.wheel, max), nPos: 0, nNeg: 0 };
      this.wheelSets.set(id, set);
    }
    return set;
  }

  /** A car's body group (follows suspension, roll and pitch); undefined until the car's first sync. */
  bodyOf(id: number): THREE.Object3D | undefined {
    return this.visuals.get(id)?.body;
  }

  /**
   * Hides the slice of one car's body between z = rear and z = front (car frame) and within `half` of its
   * centerline, so a camera inside the cabin sees the cockpit instead of the solid body shell, and still sees
   * the door mirrors outside it. Call after `sync` each frame; null restores it.
   */
  setCutaway(id: number | null, front = 0, rear = 0, half = 99): void {
    if (this.cutId !== null && this.cutId !== id) {
      const old = this.visuals.get(this.cutId);
      if (old) old.paint.material = MAT.paint;
    }
    this.cutId = id;
    const v = id === null ? undefined : this.visuals.get(id);
    if (!v) return;
    v.paint.material = this.cutMat;
    const m = v.body.matrixWorld;
    const n = this.v3.setFromMatrixColumn(m, 2).normalize();
    const at = new THREE.Vector3();
    this.cutPlanes[0].setFromNormalAndCoplanarPoint(n, at.set(0, 0, front).applyMatrix4(m));
    this.cutPlanes[1].setFromNormalAndCoplanarPoint(n.negate(), at.set(0, 0, rear).applyMatrix4(m));
    // Clipped only where all four agree (clipIntersection): inside the slab and inside the body's sides
    const side = this.v3.setFromMatrixColumn(m, 0).normalize();
    this.cutPlanes[2].setFromNormalAndCoplanarPoint(side, at.set(half, 0, 0).applyMatrix4(m));
    this.cutPlanes[3].setFromNormalAndCoplanarPoint(side.negate(), at.set(-half, 0, 0).applyMatrix4(m));
  }

  private halo(v: Visual, at: THREE.Vector3, face: THREE.Quaternion, g: { color: THREE.Color; size: number }, grow: number): void {
    this.local.compose(at, face, this.scale.setScalar(g.size * grow));
    this.glow.push(this.world.multiplyMatrices(v.body.matrixWorld, this.local), g.color);
  }

  private create(car: Car): Visual {
    const p = buildCarParts(car.look.style, car.look.color, car.look.detail);
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const paint = new THREE.Mesh(p.body, MAT.paint);
    body.add(paint);
    const parked = car.kind === 'parked';
    const front = new THREE.Mesh(p.front, parked ? MAT.lampOff : MAT.head);
    const rear = new THREE.Mesh(p.rear, parked ? MAT.tailOff : MAT.tail);
    body.add(front, rear);
    const v: Visual = {
      key: lookKey(car),
      root,
      body,
      paint,
      front,
      rear,
      headPos: p.headPos.map((q) => new THREE.Vector3(...q)),
      tailPos: p.tailPos.map((q) => new THREE.Vector3(...q)),
      wheelPos: p.wheelPos.map((q) => new THREE.Vector3(...q)),
      blink: blinkerSpots(p.headPos, p.tailPos, p.width),
      wheelAngle: 0,
      rearAngle: 0,
      r: p.wheelRadius,
      width: p.width,
      length: p.length,
      droop: 0,
      curb: 0,
    };
    if (p.barL && p.barR) {
      v.barL = new THREE.Mesh(p.barL, MAT.barOff);
      v.barR = new THREE.Mesh(p.barR, MAT.barOff);
      body.add(v.barL, v.barR);
    }
    // The player's own plates read POUT1NE (a Quebec plate laid over the body's plain one)
    if (car.kind === 'player') {
      for (const pl of p.platePos ?? []) {
        const m = new THREE.Mesh(PLATE_GEO, plateMaterial(PLAYER_PLATE));
        m.position.set(pl.at[0], pl.at[1], pl.at[2] + pl.dir * 0.006);
        if (pl.dir < 0) m.rotation.y = Math.PI;
        body.add(m);
      }
    }
    if (p.sign) {
      v.sign = new THREE.Mesh(p.sign, MAT.taxiFree);
      body.add(v.sign);
      p.sign.computeBoundingBox();
      v.signAt = p.sign.boundingBox!.getCenter(new THREE.Vector3());
    }
    this.scene.add(root);
    return v;
  }

  sync(alpha: number, dt: number): void {
    this.time += dt;
    const cars = this.getCars();
    const seen = new Set<number>();
    const cam = this.camera.position;
    this.glow.begin();
    for (const set of this.wheelSets.values()) set.nPos = set.nNeg = 0;
    let nS = 0;
    let nB = 0;
    let nSiren = 0;
    for (const car of cars) {
      if (car.removed) continue;
      seen.add(car.id);
      let v = this.visuals.get(car.id);
      if (v && v.key !== lookKey(car)) {
        this.scene.remove(v.root);
        this.visuals.delete(car.id);
        if (this.cutId === car.id) this.cutId = null;
        v = undefined;
      }
      if (!v) {
        v = this.create(car);
        this.visuals.set(car.id, v);
      }
      if (car.concealed) {
        v.root.visible = false;
        if (car.kind === 'player') this.spot.intensity = 0;
        continue;
      }
      v.root.visible = true;
      const p = car.interpPos(alpha);
      const yaw = car.interpYaw(alpha);
      const s = car.phys.state;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);

      // Ground under the car (shadow, beam) and the car itself (which may be flying)
      const gy = this.groundAt(p.x, p.z);
      const half = v.length / 2;
      const gPitch = Math.atan2(this.groundAt(p.x + fx * half, p.z + fz * half) - this.groundAt(p.x - fx * half, p.z - fz * half), v.length);
      const gRoll = Math.atan2(this.groundAt(p.x + fz * 0.8, p.z - fx * 0.8) - this.groundAt(p.x - fz * 0.8, p.z + fx * 0.8), 1.6);
      const carY = car.interpY(alpha);
      const above = Math.max(0, carY - gy);
      // ride up onto raised sidewalks (curbs are visual only)
      const curb = s.airborne ? 0 : this.surfaceAt(p.x, p.z) - gy;
      v.curb += (curb - v.curb) * Math.min(1, dt * 18);
      v.root.position.set(p.x, carY + v.curb - car.bodyDrop, p.z);
      v.root.rotation.set(-s.pitch, yaw, s.roll, 'YXZ');
      const roll = clamp(s.accelL * 0.011, -0.09, 0.09);
      const pitch = clamp(-s.accelF * 0.008, -0.06, 0.06);
      v.body.rotation.set(pitch, 0, roll);
      // suspension: squash on landing (damped bounce), sit lower under load, wheels drop in the air
      const bounce = Math.min(0.16, s.landImpact * 0.022) * Math.exp(-s.landT * 6) * Math.cos(s.landT * 16);
      const sag = clamp((s.load - 1) * 0.05, -0.03, 0.06);
      v.body.position.y = Math.abs(roll) * 0.4 - bounce - (s.airborne ? -0.04 : sag);
      v.droop += ((s.airborne ? 0.13 : 0) - v.droop) * Math.min(1, dt * 10);
      v.wheelAngle += (s.speed / v.r) * dt;
      v.rearAngle += drivenWheelRate(car, v.r) * dt;
      v.root.updateMatrixWorld(true);

      // Wheels
      let set = this.wheelSet(car.look.wheels ?? 'stock');
      if (set.nPos + v.wheelPos.length > set.pos.instanceMatrix.count) set = this.wheelSet('stock');
      const wheelsFit = set.nPos + v.wheelPos.length <= set.pos.instanceMatrix.count && set.nNeg + v.wheelPos.length <= set.neg.instanceMatrix.count;
      if (wheelsFit && !car.wheelsOff) v.wheelPos.forEach((wp, i) => {
        this.e.set(i < 2 ? v.wheelAngle : v.rearAngle, i < 2 ? s.steerAngle : 0, 0, 'YXZ');
        this.local.compose(this.v3.set(wp.x, wp.y - v.droop, wp.z), this.q.setFromEuler(this.e), this.scale.setScalar(v.r));
        this.world.multiplyMatrices(v.root.matrixWorld, this.local);
        if (wp.x < 0) set.neg.setMatrixAt(set.nNeg++, this.world);
        else set.pos.setMatrixAt(set.nPos++, this.world);
      });

      // Ground decals: shadow (spreads and fades with height), headlight pool, siren glow
      this.e.set(-gPitch, yaw, gRoll, 'YXZ');
      this.groundM.compose(this.v3.set(p.x, gy + v.curb, p.z), this.q.setFromEuler(this.e), this.scale.set(1, 1, 1));
      const spread = 1 + above * 0.12;
      this.local.compose(this.v3.set(0, 0.03, 0), FACE_FRONT, this.scale.set(v.width * 1.5 * spread, 1, v.length * 1.25 * spread));
      if (nS < MAX_CARS) {
        this.shadows.setMatrixAt(nS, this.tmp.multiplyMatrices(this.groundM, this.local));
        this.shadowOpacity.setX(nS++, 0.75 / (1 + above * 0.45));
      }
      const grow = Math.min(2, 1 + Math.hypot(p.x - cam.x, p.z - cam.z) / GLOW_GROW_DIST);
      if (v.sign && v.signAt) {
        v.sign.material = MAT.taxiFree;
        const lamp = GLOW.taxiFree;
        // Not from inside this cab: the halos sit just over the driver's head and would wash out the cabin
        if (car.id !== this.cutId) {
          this.halo(v, v.signAt, FACE_FRONT, lamp, grow);
          this.halo(v, v.signAt, FACE_BACK, lamp, grow);
        }
      }
      if (car.blinkLit) {
        // Hazards (a double-parked car): both sides at once
        for (const i of car.hazards ? [0, 1] : [car.blinker === 'left' ? 0 : 1]) {
          for (const g of [GLOW.blinkHalo, GLOW.blinkCore]) {
            this.halo(v, v.blink.front[i], FACE_FRONT, g, grow);
            this.halo(v, v.blink.rear[i], FACE_BACK, g, grow);
          }
          this.halo(v, v.blink.side[i], i === 0 ? FACE_LEFT : FACE_RIGHT, GLOW.blinkSide, grow);
        }
      }
      if (car.kind === 'parked') continue;
      const lights = car.lampsOn;
      if (above < 1.2 && lights && nB < MAX_CARS) {
        this.local.compose(this.v3.set(0, 0.05, v.length / 2 + 4.5), FACE_FRONT, this.scale.set(5, 1, 11));
        this.beams.setMatrixAt(nB++, this.tmp.multiplyMatrices(this.groundM, this.local));
      }

      // Lights off (K): dark head and tail lamps, but the brake and reverse lamps still work
      v.front.material = lights ? MAT.head : MAT.lampOff;
      v.rear.material = car.braking ? MAT.brake : car.reversing ? MAT.reverse : lights ? MAT.tail : MAT.tailOff;
      const tail = car.braking ? GLOW.brake : car.reversing ? GLOW.reverse : lights ? GLOW.tail : null;
      if (lights) for (const at of v.headPos) this.halo(v, at, FACE_FRONT, GLOW.head, grow);
      if (tail) for (const at of v.tailPos) this.halo(v, at, FACE_BACK, tail, grow);
      if (v.barL && v.barR) {
        if (car.siren || car.lightBar) {
          const phase = Math.floor(this.time * 7) % 2 === 0;
          v.barL.material = phase ? MAT.redOn : MAT.barOff;
          v.barR.material = phase ? MAT.barOff : MAT.blueOn;
          if (nSiren < 16) {
            this.local.compose(this.v3.set(0, 0.06, 0), FACE_FRONT, this.scale.set(14, 1, 14));
            this.sirens.setMatrixAt(nSiren, this.tmp.multiplyMatrices(this.groundM, this.local));
            this.sirens.setColorAt(nSiren++, phase ? SIREN_RED : SIREN_BLUE);
          }
        } else {
          v.barL.material = MAT.barOff;
          v.barR.material = MAT.barOff;
        }
      }
      if (car.kind === 'player') {
        // keep the light in the scene (adding / removing lights recompiles every shader), just dim it
        this.spot.intensity = lights ? SPOT_INTENSITY : 0;
        this.spot.position.set(p.x + fx * 1.8, carY + 1.0, p.z + fz * 1.8);
        this.spot.target.position.set(p.x + fx * 25, this.groundAt(p.x + fx * 25, p.z + fz * 25), p.z + fz * 25);
      }
    }
    this.glow.end();
    const done = (m: THREE.InstancedMesh, n: number) => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    for (const set of this.wheelSets.values()) {
      done(set.pos, set.nPos);
      done(set.neg, set.nNeg);
    }
    done(this.shadows, nS);
    this.shadowOpacity.needsUpdate = true;
    done(this.beams, nB);
    done(this.sirens, nSiren);
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.scene.remove(v.root);
        this.visuals.delete(id);
      }
    }
  }
}
