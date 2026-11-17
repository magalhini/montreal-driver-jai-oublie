import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clamp, damp, lerpAngle } from '../core/math';
import type { CarLook } from '../vehicles/Car';
import { buildCarParts, carMaterial } from '../vehicles/CarModel';
import { wheelPair } from '../vehicles/CarWheel';
import { charmGeometry } from '../vehicles/Charms';
import type { CharmId } from '../vehicles/Tuning';
import { HIP, lerpPose, Person, POSE, type ArmPose, type PersonLook } from './People';
import { concreteTexture, corrugatedTexture, pegboardTexture, posterTexture, screenTexture, signTexture, streetTexture } from './PitGarageTextures';
import { sharedGlow } from './textures';

/** Where the camera sits in the menu, per tab (`ui/PitShop.ts`). */
export type ShopShot = 'overview' | 'front' | 'wheel' | 'side' | 'rear' | 'bench';

/** The arrival cutscene (s): the car rolls in, the crew gets to work, the camera ends on the overview shot. */
export const INTRO = 9.2;
/** The car rolls in through the door over this long, and parks with its lamps off a moment later. */
const ARRIVE = 3.4;
const ROLL_IN = 12;

/** Room (local frame: the car parks at the origin facing -z, the open door is at +z). */
const W = 6.5;
const BACK = -7;
const FRONT = 8;
const H = 4.6;
const DOOR_W = 5.6;
const DOOR_H = 3.7;
/** The charm display stand on the workbench, and where the camera looks at it from. */
const STAND = { x: W - 0.45, z: -4.3 };
const BENCH_CAM = { x: 5.5, z: -2.95 };

const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

type Act = 'stand' | 'wave' | 'lean' | 'rummage' | 'kneel';
/** Choreography key: from `t`, the mechanic is here, facing `rot`, doing `act` (walks between spots). */
interface Key {
  t: number;
  x: number;
  z: number;
  rot: number;
  act: Act;
}

/** Position, facing and action at time t along a track. Walks face where they're going. */
function along(keys: Key[], t: number): { x: number; z: number; rot: number; act: Act; walking: boolean } {
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = clamp((t - a.t) / (b.t - a.t), 0, 1);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const walking = Math.hypot(dx, dz) > 0.05 && u > 0 && u < 1;
  if (Math.hypot(dx, dz) <= 0.05) return { x: a.x, z: a.z, rot: lerpAngle(a.rot, b.rot, smooth(u)), act: a.act, walking: false };
  const dir = Math.atan2(dx, dz);
  const rot = u < 0.15 ? lerpAngle(a.rot, dir, u / 0.15) : u > 0.85 ? lerpAngle(dir, b.rot, (u - 0.85) / 0.15) : dir;
  return { x: a.x + dx * u, z: a.z + dz * u, rot, act: walking ? 'stand' : u >= 1 ? b.act : a.act, walking };
}

/** Arm pose for the hood mechanic's hands on the laptop keys. */
const TYPE_ARM: ArmPose = { raise: 0.72, spread: -0.08, bend: 1.32 };

/**
 * Where `TYPE_ARM` puts a hand for a person standing at the origin, facing +x, leaned forward by `lean`.
 * `z` is the left hand; the right hand mirrors it. Matches `Person.pose` (shoulder XYZ, then the elbow).
 */
function typingHand(lean: number, bend = TYPE_ARM.bend): { x: number; y: number; z: number } {
  const rx = (x: number, y: number, z: number, a: number): [number, number, number] => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x, y * c - z * s, y * s + z * c];
  };
  const rz = (x: number, y: number, z: number, a: number): [number, number, number] => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x * c - y * s, x * s + y * c, z];
  };
  let [x, y, z] = rx(0, -0.27, 0, -bend);
  [x, y, z] = [x, y - 0.29, z];
  [x, y, z] = rx(x, y, z, -TYPE_ARM.raise);
  [x, y, z] = rz(x, y, z, TYPE_ARM.spread);
  [x, y, z] = [x + 0.21, y + 0.5, z];
  [x, y, z] = rx(x, y, z, lean);
  [x, y, z] = [x, y + HIP, z];
  // Facing +x (root yaw π/2): local +z goes to world +x, local +x goes to world -z
  return { x: z, y, z: -x };
}

/** Forward lean that rests the typing hands at `keysY`. More lean lowers the hands. */
function typingLean(keysY: number): number {
  let lo = 0.5;
  let hi = 1.15;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (typingHand(mid).y > keysY) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const OVERALLS = 0x1d2a48;
const NEO_RED = 0xd8301c;
const CREW: PersonLook[] = [
  { skin: 0xd9a77f, hair: 0x15100c, top: OVERALLS, bottom: OVERALLS, shoes: 0x121212, hairStyle: 'cap', accent: NEO_RED },
  { skin: 0xc58c64, hair: 0x2a1a10, top: OVERALLS, bottom: OVERALLS, shoes: 0x121212, hairStyle: 'short', accent: NEO_RED, glasses: true },
  { skin: 0xe0b48e, hair: 0x101014, top: OVERALLS, bottom: OVERALLS, shoes: 0x1a1a1a, hairStyle: 'short', accent: NEO_RED },
];

const unit = new THREE.BoxGeometry(1, 1, 1);
const BLOB = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/**
 * The NEO OIL pit garage: a little workshop with the player's car in the middle, drawn in place of the city
 * while the pit shop is open (`PostFX.setOverlay` with its own camera). The car rolls in through the open
 * roll-up door (the night street behind it), and three mechanics get to work: one kneels at a front wheel
 * with an impact wrench, one types on a diagnostic laptop on the hood and fetches tools, one is on a creeper
 * under the car.
 * Everything is posed from the scene time, so skipping the intro just jumps ahead.
 */
export class PitGarage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 1, 0.05, 90);
  private ready = false;
  private readonly car = new THREE.Group();
  private carKey = '';
  private carShadow!: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  private wheelR = 0.3;
  private head!: THREE.Mesh;
  private tail!: THREE.Mesh;
  /** Car size and its front-right / rear-right wheel spots in the room. */
  private halfW = 0.85;
  private halfL = 2.2;
  private frontWheel = V(0.7, 0.3, -1.2);
  private rearWheel = V(0.7, 0.3, 1.2);
  private readonly mats = {
    paint: carMaterial({ roughness: 0.3, metalness: 0.45 }),
    wheel: carMaterial({ roughness: 0.45, metalness: 0.6 }),
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.86), toneMapped: false }),
    headOff: new THREE.MeshStandardMaterial({ color: 0x9a9a90, roughness: 0.15, metalness: 0.6 }),
    tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.04, 0.03), toneMapped: false }),
    brake: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.07, 0.04), toneMapped: false }),
    tailOff: new THREE.MeshStandardMaterial({ color: 0x3a0806, roughness: 0.2, metalness: 0.4 }),
    charm: carMaterial({ roughness: 0.6, metalness: 0 }),
  };
  private readonly beam = new THREE.SpotLight(0xfff1dd, 0, 22, 0.55, 0.6, 1.6);
  private crew: Person[] = [];
  private wrench = new THREE.Group();
  private creeper = new THREE.Group();
  /** Diagnostic laptop on the hood, and how far the mechanic leans to reach its keys. */
  private laptop = new THREE.Group();
  private lapX = -0.6;
  private lapY = 0.76;
  private lapZ = -1.5;
  private hoodLean = 0.85;
  private workLamp!: THREE.PointLight;
  private lampHead = new THREE.Group();
  private charmPivot = new THREE.Group();
  private charm!: THREE.Mesh;
  private charmId: CharmId | null = null;
  private readonly cam: Pose = { pos: V(0, 2, -6), look: V(0, 0.5, 0), fov: 44 };

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /** Build the room ahead of time (a hitch on the title screen is better than one in the fade). */
  prepare(): void {
    if (this.ready) return;
    this.ready = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();
    this.scene.background = new THREE.Color(0x020106);
    this.shell();
    this.lighting();
    this.props();
    this.bench();
    this.laptopProp();
    this.scene.add(this.car);
    this.car.rotation.y = Math.PI;
    this.carShadow = this.blob(1, 1, 0.8);
    this.car.add(this.carShadow);
    this.car.add(this.beam, this.beam.target);
    this.beam.position.set(0, 0.8, 1.8);
    this.beam.target.position.set(0, 0, 12);
    this.crew = CREW.map((look, i) => {
      const p = new Person(look);
      // Blob shadow at the feet (the one on his back lies on the creeper instead)
      if (i < 2) p.root.add(this.blob(0.9, 0.9, 0.55));
      this.scene.add(p.root);
      return p;
    });
    this.wrenchProp();
    this.creeperProp();
    this.setCar({ style: 'coupe', color: 0xd2381f });
    this.scene.updateMatrixWorld(true);
    this.renderer.compile(this.scene, this.camera);
  }

  /** The car on the floor (rebuilt when the paint or rims change). */
  setCar(look: CarLook): void {
    const key = `${look.style}_${look.color}_${look.detail ?? ''}_${look.wheels ?? 'stock'}`;
    if (key === this.carKey) return;
    this.carKey = key;
    for (const m of [...this.car.children]) if (m instanceof THREE.Mesh && m !== this.carShadow) this.car.remove(m);
    const parts = buildCarParts(look.style, look.color, look.detail);
    const pair = wheelPair(look.wheels);
    this.carShadow.scale.set(parts.width * 1.5, 1, parts.length * 1.2);
    this.car.add(new THREE.Mesh(parts.body, this.mats.paint));
    this.head = new THREE.Mesh(parts.front, this.mats.head);
    this.tail = new THREE.Mesh(parts.rear, this.mats.tail);
    this.car.add(this.head, this.tail);
    if (parts.barL && parts.barR) this.car.add(new THREE.Mesh(parts.barL, this.mats.tailOff), new THREE.Mesh(parts.barR, this.mats.tailOff));
    if (parts.sign) this.car.add(new THREE.Mesh(parts.sign, this.mats.tailOff));
    this.wheels = parts.wheelPos.map((wp) => {
      const w = new THREE.Mesh(wp[0] < 0 ? pair.neg : pair.pos, this.mats.wheel);
      w.position.set(wp[0], wp[1], wp[2]);
      w.scale.setScalar(parts.wheelRadius);
      this.car.add(w);
      return w;
    });
    this.wheelR = parts.wheelRadius;
    this.halfW = parts.width / 2;
    this.halfL = parts.length / 2;
    // The car faces -z: its right side (car x < 0) is the room's +x side
    const fr = parts.wheelPos[1];
    const rr = parts.wheelPos[3] ?? parts.wheelPos[1];
    this.frontWheel.set(-fr[0], fr[1], -fr[2]);
    this.rearWheel.set(-rr[0], rr[1], -rr[2]);
    this.seatLaptop();
    // The cage lamp sits on the floor by the door sill, behind the wheel the wrench is on
    const fw = this.frontWheel;
    this.lampHead.position.set(fw.x + 0.4, 0.1, fw.z + 0.85);
    this.workLamp.position.set(fw.x + 0.5, 0.35, fw.z + 0.5);
  }

  /** The charm on the display stand. */
  setCharm(id: CharmId): void {
    if (id === this.charmId) return;
    this.charmId = id;
    const g = charmGeometry(id);
    this.charm.visible = g !== null;
    if (g) this.charm.geometry = g;
  }

  /**
   * Pose the scene at `t` seconds since the car arrived, and aim the camera: the scripted shots during the
   * intro, then easing toward `shot` (frame `dt` for the easing).
   */
  update(t: number, dt: number, shot: ShopShot, aspect: number): void {
    this.animateCar(t);
    this.animateCrew(t);
    this.charmPivot.rotation.set(Math.sin(t * 1.3) * 0.05, 0, Math.sin(t * 1.7) * 0.14);
    this.workLamp.intensity = t < 4.4 ? 0 : 2 * (1 + 0.04 * Math.sin(t * 17));
    this.lampHead.visible = t >= 4.4;
    if (t < INTRO) this.introCamera(t);
    else {
      const target = this.shotPose(shot);
      const k = damp(2.6, dt);
      this.cam.pos.lerp(target.pos, k);
      this.cam.look.lerp(target.look, k);
      this.cam.fov += (target.fov - this.cam.fov) * k;
    }
    const c = this.camera;
    c.position.copy(this.cam.pos);
    const drift = t < INTRO ? 0 : 1;
    c.position.x += Math.sin(t * 0.23) * 0.05 * drift;
    c.position.y += Math.sin(t * 0.31) * 0.03 * drift;
    c.lookAt(this.cam.look);
    if (c.fov !== this.cam.fov || c.aspect !== aspect) {
      c.fov = this.cam.fov;
      c.aspect = aspect;
      c.updateProjectionMatrix();
    }
  }

  private shotPose(s: ShopShot): Pose {
    const rw = this.rearWheel;
    switch (s) {
      case 'front':
        return { pos: V(1.4, 1.35, -this.halfL - 2.7), look: V(-0.1, 0.55, -this.halfL + 0.6), fov: 42 };
      case 'wheel':
        return { pos: V(rw.x + 2.0, 0.72, rw.z + 1.9), look: V(rw.x - 0.1, 0.36, rw.z - 0.2), fov: 36 };
      case 'side':
        return { pos: V(6.0, 1.3, 0.5), look: V(0, 0.55, 0.1), fov: 48 };
      case 'rear':
        return { pos: V(3.3, 0.9, this.halfL + 3.3), look: V(0, 0.5, 0.6), fov: 44 };
      case 'bench':
        return { pos: V(BENCH_CAM.x, 1.3, BENCH_CAM.z), look: V(STAND.x - 0.15, 1.18, STAND.z), fov: 30 };
      default:
        return { pos: V(4.1, 1.75, -6.0), look: V(-0.85, 0.45, 0.15), fov: 42 };
    }
  }

  /** In through the door, then the camera crosses the room to the overview shot. */
  private introCamera(t: number): void {
    const fw = this.frontWheel;
    const end = this.shotPose('overview');
    const shots: { t0: number; t1: number; from: Pose; to: Pose }[] = [
      { t0: 0, t1: 3.7, from: { pos: V(1.7, 0.72, -4.9), look: V(0, 0.95, 6), fov: 48 }, to: { pos: V(1.45, 0.8, -4.55), look: V(0, 0.75, 3), fov: 46 } },
      {
        t0: 3.7,
        t1: 6.2,
        from: { pos: V(fw.x + 1.5, 0.9, fw.z - 2.9), look: V(fw.x + 0.5, 0.55, fw.z), fov: 40 },
        to: { pos: V(fw.x + 1.25, 0.78, fw.z - 2.45), look: V(fw.x + 0.45, 0.5, fw.z), fov: 38 },
      },
      { t0: 6.2, t1: INTRO, from: { pos: V(-4.6, 3.7, 6.6), look: V(0, 0.3, -0.5), fov: 50 }, to: end },
    ];
    const s = shots.find((q) => t < q.t1) ?? shots[shots.length - 1];
    const u = (t - s.t0) / (s.t1 - s.t0);
    const k = s === shots[2] ? smooth(smooth(u)) : smooth(u) * 0.6 + clamp(u, 0, 1) * 0.4;
    this.cam.pos.lerpVectors(s.from.pos, s.to.pos, k);
    this.cam.look.lerpVectors(s.from.look, s.to.look, k);
    this.cam.fov = s.from.fov + (s.to.fov - s.from.fov) * k;
  }

  private animateCar(t: number): void {
    const u = clamp(t / ARRIVE, 0, 1);
    const z = ROLL_IN * (1 - u) ** 2;
    this.car.position.z = z;
    for (const w of this.wheels) w.rotation.x = (ROLL_IN - z) / this.wheelR;
    const lit = t < ARRIVE + 0.8;
    this.head.material = lit ? this.mats.head : this.mats.headOff;
    this.tail.material = t > 1.6 && t < ARRIVE + 0.4 ? this.mats.brake : lit ? this.mats.tail : this.mats.tailOff;
    this.beam.intensity = lit ? 35 : 0;
    // A little dip at the stop
    this.car.rotation.x = t > ARRIVE ? -0.012 * Math.exp(-(t - ARRIVE) * 4) * Math.sin((t - ARRIVE) * 14) : -0.006 * u;
  }

  private animateCrew(t: number): void {
    const [wrench, walker, creeper] = this.crew;
    const fw = this.frontWheel;
    const knee = { x: fw.x + 0.82, z: fw.z };
    // Beside the laptop: close enough that the leaned hands land on the keys, clear of the fender
    const fender = { x: -this.halfW - 0.42, z: this.lapZ };
    this.laptop.visible = t >= 6.8;
    this.laptop.position.set(this.lapX, this.lapY, this.lapZ + this.car.position.z);
    const chest = { x: -4.55, z: -3.6 };
    const benchSpot = { x: 5.25, z: -4.35 };

    // Wrench: at the bench, walks over and kneels at the front wheel for good
    const w = along(
      [
        { t: 0, ...benchSpot, rot: Math.PI / 2, act: 'rummage' },
        { t: 3.2, ...benchSpot, rot: Math.PI / 2, act: 'rummage' },
        { t: 4.7, ...knee, rot: -Math.PI / 2, act: 'kneel' },
        { t: 1e9, ...knee, rot: -Math.PI / 2, act: 'kneel' },
      ],
      t,
    );
    this.place(wrench, w, t, clamp((t - 4.7) / 0.6, 0, 1));
    this.wrench.visible = t > 4.4;

    // Walker: waves the car in by the door, then types on the laptop and fetches tools now and then
    const intro: Key[] = [
      { t: 0, x: -2.7, z: 3.4, rot: 0, act: 'wave' },
      { t: 3.6, x: -2.7, z: 3.4, rot: 0, act: 'wave' },
      { t: 4.1, x: -2.7, z: 3.4, rot: Math.PI, act: 'stand' },
      { t: 6.8, ...fender, rot: Math.PI / 2, act: 'lean' },
    ];
    const LOOP = 18;
    const loop: Key[] = [
      { t: 0, ...fender, rot: Math.PI / 2, act: 'lean' },
      { t: 8, ...fender, rot: Math.PI / 2, act: 'lean' },
      { t: 10.4, ...chest, rot: -Math.PI / 2, act: 'rummage' },
      { t: 12.6, ...chest, rot: -Math.PI / 2, act: 'rummage' },
      { t: 15, ...fender, rot: Math.PI / 2, act: 'lean' },
      { t: LOOP, ...fender, rot: Math.PI / 2, act: 'lean' },
    ];
    this.place(walker, t < 6.8 ? along(intro, t) : along(loop, (t - 6.8) % LOOP), t, 0);

    // Creeper: on his back under the car, feet out the right side (there by the time the camera cuts back)
    creeper.root.visible = this.creeper.visible = t >= 6.2;
    const slide = Math.sin(t * 0.4) > 0.7 ? 0.08 : 0;
    this.creeper.position.set(this.halfW + slide, 0, 0.1);
    creeper.root.position.set(this.halfW + 0.98 + slide, 0.245, 0.1);
    creeper.breathe(t, 0.6);
    const tap = Math.max(0, Math.sin(t * 5.5)) * 0.18 * (Math.sin(t * 0.7) > 0 ? 1 : 0);
    creeper.legL.hip.rotation.x = -0.15;
    creeper.legL.knee.rotation.x = 0.25 + tap;
    creeper.legR.hip.rotation.x = -0.95;
    creeper.legR.knee.rotation.x = 1.7;
    creeper.pose(creeper.armL, { raise: 2.6, spread: 0.2, bend: 1.1 + Math.sin(t * 3) * 0.2 }, 1);
    creeper.pose(creeper.armR, { raise: 2.5, spread: 0.25, bend: 1.0 }, -1);
  }

  /** Stand, walk or kneel a mechanic where the track says, with the arms for the job. */
  private place(p: Person, s: ReturnType<typeof along>, t: number, kneel: number): void {
    p.root.position.set(s.x, 0, s.z);
    p.root.rotation.y = s.rot;
    p.breathe(t);
    p.stride(t, s.walking ? 1 : 0);
    p.torso.rotation.x = 0;
    p.head.rotation.set(0, 0, 0);
    let l: ArmPose = POSE.down;
    let r: ArmPose = POSE.down;
    if (s.walking) {
      const swing = Math.sin(t * 7) * 0.35;
      l = { ...POSE.down, raise: POSE.down.raise + swing };
      r = { ...POSE.down, raise: POSE.down.raise - swing };
    } else if (s.act === 'wave') {
      // Waving the car in: one arm up, the other beckoning
      r = { raise: 2.7, spread: 0.3 + Math.sin(t * 6) * 0.25, bend: 0.3 };
      l = { raise: 1.15, spread: 0.1, bend: 0.9 + Math.sin(t * 5) * 0.5 };
    } else if (s.act === 'lean') {
      // Hands down on the laptop: a small alternating tap, not a swing through empty air
      p.torso.rotation.x = this.hoodLean;
      p.head.rotation.x = 0.28;
      p.head.rotation.y = Math.sin(t * 0.45) * 0.06;
      const tap = Math.sin(t * 16) * 0.045;
      l = { ...TYPE_ARM, bend: TYPE_ARM.bend + tap };
      r = { ...TYPE_ARM, bend: TYPE_ARM.bend - tap * 0.85 };
    } else if (s.act === 'rummage') {
      p.torso.rotation.x = 0.28;
      p.head.rotation.x = 0.35;
      l = lerpPose(POSE.table, POSE.work, 0.5 + 0.5 * Math.sin(t * 2.1));
      r = lerpPose(POSE.work, POSE.table, 0.5 + 0.5 * Math.sin(t * 1.7 + 1));
    }
    if (kneel > 0) {
      const k = smooth(kneel);
      p.hips.position.y = HIP + (0.5 - HIP) * k;
      p.legL.hip.rotation.x = (-Math.PI / 2) * k;
      p.legL.knee.rotation.x = (Math.PI / 2) * k;
      p.legR.hip.rotation.x = 0.15 * k;
      p.legR.knee.rotation.x = (Math.PI / 2) * k;
      p.torso.rotation.x = 0.32 * k;
      p.head.rotation.x = 0.2 * k;
      // The impact wrench on the wheel nuts: bursts of buzz, a pause to move to the next nut
      const burst = Math.sin(t * 1.6) > 0 ? Math.sin(t * 45) * 0.03 : 0;
      const wrenching: ArmPose = { raise: 0.62, spread: 0.06, bend: 0.55 + burst };
      r = lerpPose(r, wrenching, k);
      l = lerpPose(l, { raise: 0.5, spread: 0.2, bend: 0.7 }, k);
    }
    p.pose(p.armL, l, 1);
    p.pose(p.armR, r, -1);
  }

  /** Soft dark patch on the floor (there are no real shadows in here). */
  private blob(w: number, d: number, opacity: number): THREE.Mesh {
    const m = new THREE.Mesh(BLOB, new THREE.MeshBasicMaterial({ map: sharedGlow(), color: 0x000000, transparent: true, opacity, depthWrite: false }));
    m.scale.set(w, 1, d);
    m.position.y = 0.012;
    m.renderOrder = 1;
    return m;
  }

  private add(geo: THREE.BufferGeometry, mat: THREE.Material, size: [number, number, number], at: [number, number, number], parent: THREE.Object3D = this.scene): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(...size);
    m.position.set(...at);
    parent.add(m);
    return m;
  }

  private shell(): void {
    const s = this.scene;
    // Floor, with the yellow bay lines around the car
    const floorTex = concreteTexture();
    floorTex.repeat.set(2 * W / 4, (FRONT - BACK) / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, FRONT - BACK), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, (FRONT + BACK) / 2);
    s.add(floor);
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8b81c, roughness: 0.6 });
    for (const x of [-1.75, 1.75]) this.add(unit, yellow, [0.1, 0.004, 7.2], [x, 0.002, 0.2]);
    for (const z of [-3.4, 3.8]) this.add(unit, yellow, [3.6, 0.004, 0.1], [0, 0.002, z]);
    // Drain grate between the bays
    this.add(unit, new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.5, metalness: 0.7 }), [0.22, 0.006, 4], [-3.2, 0.003, 0.4]);
    // Walls: corrugated steel over a dark painted dado
    const wallTex = corrugatedTexture();
    wallTex.repeat.set((FRONT - BACK) / 2.2, 1);
    const wall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.55, metalness: 0.35 });
    const dado = new THREE.MeshStandardMaterial({ color: 0x2b3a36, roughness: 0.7 });
    for (const sx of [-1, 1]) {
      this.add(unit, wall, [0.1, H, FRONT - BACK], [sx * (W + 0.05), H / 2, (FRONT + BACK) / 2]);
      this.add(unit, dado, [0.04, 1.1, FRONT - BACK], [sx * (W - 0.02), 0.55, (FRONT + BACK) / 2]);
    }
    const backTex = corrugatedTexture();
    backTex.repeat.set((2 * W) / 2.2, 1);
    this.add(unit, new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.55, metalness: 0.35 }), [2 * W, H, 0.1], [0, H / 2, BACK - 0.05]);
    this.add(unit, dado, [2 * W, 1.1, 0.04], [0, 0.55, BACK + 0.02]);
    // Front wall around the open roll-up door, the rolled-up door drum, the sign over it
    const front = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.7, metalness: 0.2 });
    const side = W - DOOR_W / 2;
    for (const sx of [-1, 1]) this.add(unit, front, [side, H, 0.2], [sx * (DOOR_W / 2 + side / 2), H / 2, FRONT]);
    this.add(unit, front, [DOOR_W, H - DOOR_H, 0.2], [0, (H + DOOR_H) / 2, FRONT]);
    this.add(new THREE.CylinderGeometry(0.3, 0.3, DOOR_W + 0.2, 20).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.7 }), [1, 1, 1], [0, DOOR_H + 0.3, FRONT + 0.4]);
    const hazard = new THREE.MeshStandardMaterial({ color: 0xe8b81c, roughness: 0.6 });
    for (const sx of [-1, 1]) this.add(unit, hazard, [0.14, DOOR_H, 0.24], [sx * (DOOR_W / 2 + 0.07), DOOR_H / 2, FRONT - 0.02]);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6), depthWrite: false }));
    sign.position.set(0, DOOR_H + 0.45, FRONT - 0.12);
    sign.rotation.y = Math.PI;
    s.add(sign);
    // Outside: the wet street and the night across it
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(36, 16), new THREE.MeshBasicMaterial({ map: streetTexture(), color: new THREE.Color(1.25, 1.25, 1.25) }));
    outside.position.set(0, 6.5, FRONT + 15);
    outside.rotation.y = Math.PI;
    s.add(outside);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(36, 15), new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.15, metalness: 0.4 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -0.01, FRONT + 7.5);
    s.add(road);
    // Ceiling and its trusses
    const ceil = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 });
    this.add(unit, ceil, [2 * W, 0.1, FRONT - BACK], [0, H + 0.05, (FRONT + BACK) / 2]);
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.6, metalness: 0.6 });
    for (let z = BACK + 2; z < FRONT - 1; z += 3.2) this.add(unit, steel, [2 * W, 0.24, 0.14], [0, H - 0.12, z]);
    // Posters
    const poster = (kind: 'tires' | 'oil', x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.26), new THREE.MeshStandardMaterial({ map: posterTexture(kind), roughness: 0.7 }));
      m.position.set(x, 2.1, z);
      m.rotation.y = ry;
      s.add(m);
    };
    poster('tires', -W + 0.04, -1.5, Math.PI / 2);
    poster('oil', -W + 0.04, 0.0, Math.PI / 2);
    poster('oil', 2.6, BACK + 0.04, 0);
  }

  private lighting(): void {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xc8d4ea, 0x2a2420, 0.55));
    const key = new THREE.DirectionalLight(0xeaf2ff, 0.6);
    key.position.set(2, 8, -3);
    s.add(key);
    const tube = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.3, 2.4), toneMapped: false });
    const housing = new THREE.MeshStandardMaterial({ color: 0x6a6e74, roughness: 0.5, metalness: 0.5 });
    for (const z of [-3.6, 0.2, 4]) {
      for (const x of [-2.2, 2.2]) {
        this.add(unit, housing, [0.34, 0.08, 2.4], [x, H - 0.3, z]);
        for (const dx of [-0.08, 0.08]) this.add(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 8).rotateX(Math.PI / 2), tube, [1, 1, 1], [x + dx, H - 0.37, z]);
      }
      const l = new THREE.PointLight(0xeaf2ff, 7, 11, 1.8);
      l.position.set(0, H - 0.6, z);
      s.add(l);
    }
    // Neon spill from the street, and the warm cage lamp by the wheel the wrench is on
    const pink = new THREE.PointLight(0xff3ea5, 14, 16, 2);
    pink.position.set(2.4, 2.6, FRONT + 2.2);
    const cyan = new THREE.PointLight(0x3ef2ff, 10, 14, 2);
    cyan.position.set(-2.8, 2.2, FRONT + 2.6);
    s.add(pink, cyan);
    this.workLamp = new THREE.PointLight(0xffc58a, 0, 4.5, 2);
    s.add(this.workLamp);
    this.add(new THREE.CylinderGeometry(0.035, 0.04, 0.12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.8, 0.5), toneMapped: false }), [1, 1, 1], [0, 0, 0], this.lampHead);
    this.add(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8b81c, wireframe: true }), [1, 1, 1], [0, 0, 0], this.lampHead);
    this.lampHead.rotation.z = Math.PI / 2 - 0.4;
    s.add(this.lampHead);
  }

  private props(): void {
    const s = this.scene;
    const red = new THREE.MeshStandardMaterial({ color: 0xc02018, roughness: 0.35, metalness: 0.4 });
    const chromeM = new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.15, metalness: 1 });
    const black = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.8 });
    // Rolling tool chest, drawers toward the room
    const chest = new THREE.Group();
    chest.position.set(-5.65, 0, -3.6);
    s.add(chest);
    this.add(unit, red, [0.62, 1.0, 1.25], [0, 0.6, 0], chest);
    this.add(unit, red, [0.5, 0.45, 1.05], [-0.04, 1.33, 0], chest);
    for (let i = 0; i < 6; i++) {
      this.add(unit, black, [0.01, 0.01, 1.18], [0.315, 0.2 + i * 0.16, 0], chest);
      this.add(unit, chromeM, [0.03, 0.025, 0.6], [0.33, 0.27 + i * 0.16, 0], chest);
    }
    for (const dz of [-0.5, 0.5]) this.add(new THREE.SphereGeometry(0.05, 8, 6), black, [1, 1, 1], [0, 0.05, dz], chest);
    // Tire stack and oil drums by the door
    const tire = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.85 });
    for (let i = 0; i < 4; i++) this.add(new THREE.TorusGeometry(0.27, 0.11, 10, 24).rotateX(Math.PI / 2), tire, [1, 1, 1], [5.4 + (i % 2) * 0.03, 0.11 + i * 0.22, 5.2]);
    const drumM = new THREE.MeshStandardMaterial({ color: 0xc02018, roughness: 0.45, metalness: 0.4 });
    const band = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.5 });
    for (const [x, z] of [[-5.6, 6.3], [-4.9, 6.9], [-5.7, 5.5]]) {
      this.add(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 18), drumM, [1, 1, 1], [x, 0.44, z]);
      this.add(new THREE.CylinderGeometry(0.295, 0.295, 0.14, 18), band, [1, 1, 1], [x, 0.56, z]);
    }
    // Floor jack and a stool on wheels
    const jack = new THREE.Group();
    jack.position.set(-2.4, 0, 2.6);
    jack.rotation.y = 0.5;
    s.add(jack);
    this.add(unit, red, [0.3, 0.14, 0.75], [0, 0.1, 0], jack);
    this.add(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 6).rotateX(-1.1), chromeM, [1, 1, 1], [0, 0.45, 0.62], jack);
    this.add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), black, [1, 1, 1], [-3.9, 0.48, 4.6]);
    this.add(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8), chromeM, [1, 1, 1], [-3.9, 0.24, 4.6]);
  }

  /** Workbench on the right wall with the pegboard over it and the charm display stand. */
  private bench(): void {
    const s = this.scene;
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4524, roughness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.5, metalness: 0.6 });
    const z0 = -5.8;
    const z1 = -2.8;
    const zc = (z0 + z1) / 2;
    this.add(unit, wood, [0.75, 0.06, z1 - z0], [W - 0.4, 0.92, zc]);
    for (const z of [z0 + 0.1, z1 - 0.1]) for (const x of [W - 0.72, W - 0.1]) this.add(unit, steel, [0.06, 0.9, 0.06], [x, 0.45, z]);
    this.add(unit, steel, [0.7, 0.03, z1 - z0 - 0.2], [W - 0.4, 0.25, zc]);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, 1.5), new THREE.MeshStandardMaterial({ map: pegboardTexture(), roughness: 0.8 }));
    board.position.set(W - 0.02, 1.85, zc);
    board.rotation.y = -Math.PI / 2;
    s.add(board);
    // Vise at the end of the bench
    this.add(unit, steel, [0.18, 0.14, 0.32], [W - 0.5, 1.02, z1 - 0.3]);
    // Charm stand: a chrome post with an arm, the charm hanging from it (4x scale so it reads on camera)
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.12, metalness: 1 });
    const { x, z } = STAND;
    this.add(new THREE.CylinderGeometry(0.09, 0.1, 0.02, 20), chrome, [1, 1, 1], [x, 0.96, z]);
    this.add(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 8), chrome, [1, 1, 1], [x, 1.25, z]);
    this.add(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8).rotateZ(Math.PI / 2), chrome, [1, 1, 1], [x - 0.08, 1.54, z]);
    this.charmPivot.position.set(x - 0.15, 1.53, z);
    s.add(this.charmPivot);
    this.charm = new THREE.Mesh(undefined, this.mats.charm);
    this.charm.scale.setScalar(4);
    // Face the toy toward the bench shot's camera
    this.charm.rotation.y = Math.atan2(-(BENCH_CAM.x - (x - 0.15)), -(BENCH_CAM.z - z));
    this.charmPivot.add(this.charm);
    this.setCharm('cone');
    // A little spot on the display
    const spot = new THREE.SpotLight(0xfff0dd, 6, 3, 0.5, 0.6, 1.5);
    spot.position.set(x - 0.6, 2.2, z + 0.5);
    spot.target = this.charmPivot;
    s.add(spot);
  }

  /**
   * Sit the diagnostic laptop on the flattest stretch of hood, on the side the mechanic works from, and lean
   * him onto the keys. Short hoods get a shorter laptop so the screen stays in front of the windshield.
   */
  private seatLaptop(): void {
    const wf = -this.frontWheel.z;
    const localX = this.halfW - 0.22;
    this.car.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, -1, 0);
    const origin = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    const sample = (lz: number): { y: number } | null => {
      origin.set(localX, 2.4, lz);
      this.car.localToWorld(origin);
      ray.set(origin, down);
      // The first hit is the outer skin. A later one can be a flat panel seen through the glass.
      const hit = ray.intersectObject(this.car, true)[0];
      if (!hit) return null;
      const ny = hit.normal?.y ?? 1;
      return hit.point.y > 0.5 && hit.point.y < 1.05 && ny > 0.82 ? { y: hit.point.y } : null;
    };
    // Flat stretches only: a step up is the windshield, a gap is the nose falling away
    const runs: { z0: number; z1: number; y: number }[] = [];
    let cur: { z0: number; z1: number; y: number } | null = null;
    for (let lz = wf - 0.5; lz <= wf + 0.8; lz += 0.04) {
      const hit = sample(lz);
      if (!hit) {
        cur = null;
        continue;
      }
      if (!cur || lz - cur.z1 > 0.06 || Math.abs(hit.y - cur.y) > 0.03) {
        cur = { z0: lz, z1: lz, y: hit.y };
        runs.push(cur);
      } else {
        cur.z1 = lz;
        cur.y = hit.y;
      }
    }
    const want = wf + 0.12;
    const run =
      runs.sort((a, b) => {
        const near = (r: { z0: number; z1: number }) => (want >= r.z0 && want <= r.z1 ? 0 : Math.min(Math.abs(want - r.z0), Math.abs(want - r.z1)));
        return b.z1 - b.z0 - (a.z1 - a.z0) || near(a) - near(b);
      })[0] ?? null;
    const span = run ? run.z1 - run.z0 : 0.4;
    // Stay off the glass: the run starts where the windshield stops, so keep a gap at that end
    const margin = 0.1;
    const length = clamp(span - margin, 0.26, 0.48);
    const half = length / 2;
    const zMin = run ? run.z0 + margin + half : want;
    const zMax = run ? run.z1 - half : want;
    const lz = zMax >= zMin ? clamp(want, zMin, zMax) : run ? (run.z0 + run.z1) / 2 : want;
    const y = sample(lz)?.y ?? run?.y ?? 0.74;
    this.laptop.scale.z = length / 0.48;
    this.lapX = -localX;
    this.lapY = y;
    this.lapZ = -lz;
    // Key deck is the top of the base; the hand sphere rests just on it
    this.hoodLean = typingLean(y + 0.06);
    const step = Math.min(0.12, half);
    const fore = sample(lz + step);
    const aft = sample(lz - step);
    const dy = fore && aft ? aft.y - fore.y : 0;
    this.laptop.rotation.x = Math.abs(dy) < 0.08 ? -Math.atan2(dy, step * 2) : 0;
    this.laptop.position.set(this.lapX, this.lapY, this.lapZ);
  }

  /** Toughbook on the hood: keyboard toward the mechanic (room -x), screen tilted back toward the car. */
  private laptopProp(): void {
    const alum = new THREE.MeshStandardMaterial({ color: 0xb7bcc4, roughness: 0.32, metalness: 0.8 });
    const keys = new THREE.MeshStandardMaterial({ color: 0x12141a, roughness: 0.75 });
    const bezel = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.45, metalness: 0.4 });
    this.add(unit, alum, [0.28, 0.016, 0.48], [0, 0.008, 0], this.laptop);
    this.add(unit, keys, [0.16, 0.004, 0.38], [-0.03, 0.018, 0], this.laptop);
    const screen = new THREE.Group();
    screen.position.set(0.125, 0.016, 0);
    screen.rotation.z = -0.62;
    this.laptop.add(screen);
    this.add(unit, bezel, [0.014, 0.2, 0.46], [0, 0.1, 0], screen);
    this.add(
      unit,
      new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false, color: new THREE.Color(0.45, 1.35, 1.15) }),
      [0.004, 0.158, 0.4],
      [-0.008, 0.102, 0],
      screen,
    );
    this.laptop.visible = false;
    this.scene.add(this.laptop);
  }

  /** The impact wrench in the kneeling mechanic's hand. */
  private wrenchProp(): void {
    const body = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.3 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xd8301c, roughness: 0.5 });
    this.add(unit, body, [0.07, 0.16, 0.08], [0, -0.06, 0.02], this.wrench);
    this.add(unit, accent, [0.09, 0.06, 0.1], [0, -0.16, 0.02], this.wrench);
    this.add(new THREE.CylinderGeometry(0.035, 0.03, 0.16, 12).rotateX(Math.PI / 2), body, [1, 1, 1], [0, 0.0, 0.12], this.wrench);
    this.crew[0].armR.hand.add(this.wrench);
  }

  /** The creeper board under the third mechanic. */
  private creeperProp(): void {
    const board = new THREE.MeshStandardMaterial({ color: 0x8a1a14, roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7 });
    this.add(unit, board, [1.0, 0.04, 0.45], [-0.25, 0.1, 0], this.creeper);
    for (const dx of [-0.65, 0.15]) for (const dz of [-0.17, 0.17]) this.add(new THREE.SphereGeometry(0.04, 8, 6), black, [1, 1, 1], [dx, 0.04, dz], this.creeper);
    this.scene.add(this.creeper);
    // On his back: head under the car (-x), face up, feet out on the floor (+x)
    const p = this.crew[2];
    p.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(-1, 0, 0), V(0, 1, 0)));
  }
}
