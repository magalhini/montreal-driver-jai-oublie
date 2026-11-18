import * as THREE from 'three';
import { damp, fwd, lerpAngle } from '../core/math';
import type { ViewSystem } from '../types';
import type { CityGround } from '../world/Ground';
import { HIP, lerpPose, Person, POSE, type ArmPose } from '../world/People';
import { PICNIC_TUNING, type PortPicnic } from './PortPicnic';

const LAP: ArmPose = { raise: 0.42, spread: 0.16, bend: 1.2 };
/** Bench seat (the promenade benches are 0.45 m). `Person` adds a little so the hips land on it. */
const SEAT = 0.45;
/** How far he slides back onto the seat as he sits (m), from the stand point in front of it. */
const SIT_BACK = 0.78;

const smooth = (u: number) => {
  const k = Math.min(1, Math.max(0, u));
  return k * k * (3 - 2 * k);
};

/**
 * Two bites: up to the mouth, a nod, a rest, then again, then the bagel back in the lap while he watches
 * the water.
 */
function eatLift(t: number): number {
  if (t < 0.45) return smooth(t / 0.45);
  if (t < 2.15) return 1;
  if (t < 2.85) return 1 - smooth((t - 2.15) / 0.7) * 0.55;
  if (t < 3.35) return 0.45 + smooth((t - 2.85) / 0.5) * 0.55;
  if (t < 5.05) return 1;
  if (t < 6.05) return 1 - smooth((t - 5.05) / 1);
  return 0;
}

function eatNod(t: number): number {
  const bump = (c: number, w: number) => {
    const d = Math.abs(t - c);
    return d < w ? Math.cos((d / w) * Math.PI * 0.5) : 0;
  };
  return Math.max(bump(1.15, 0.42), bump(4.15, 0.42));
}

/**
 * The Vieux-Port scene on screen (`PortPicnic`): the driver in a parka and a tuque, a lox bagel in his hand,
 * and a shot from his side as he sits down on the bench and eats, the water in front of him.
 */
export class PortPicnicView implements ViewSystem {
  private readonly hero: Person;
  private readonly bagel: THREE.Group;
  private readonly cine: HTMLElement;
  private readonly caption: HTMLElement;
  private y = 0;
  private yaw = 0;
  private yawReady = false;
  private captioned = false;
  private barsUp = false;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shotReady = false;
  private readonly at = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(
    private readonly picnic: PortPicnic,
    ui: HTMLElement,
    scene: THREE.Scene,
    private readonly terrain: CityGround,
  ) {
    this.hero = new Person({
      skin: 0xe3c2a6,
      hair: 0x2a211c,
      top: 0x3f4d36,
      bottom: 0x2b3a56,
      shoes: 0x3a2717,
      hairStyle: 'short',
    });
    this.dress();
    this.bagel = loxBagel();
    this.hero.armR.hand.add(this.bagel);
    this.hero.root.visible = false;
    this.hero.root.traverse((o) => (o.frustumCulled = false));
    scene.add(this.hero.root);

    this.cine = document.createElement('div');
    this.cine.className = 'cine picnic-cine';
    this.cine.innerHTML =
      '<div class="cine-bar top"></div><div class="cine-bar bottom"></div><div class="cine-caption"></div><div class="cine-skip"><kbd>ESC</kbd> skip</div>';
    this.caption = this.cine.querySelector('.cine-caption')!;
    ui.appendChild(this.cine);
  }

  sync(alpha: number, frameDt: number): void {
    const pk = this.picnic;
    const d = pk.driver;
    this.bars(pk.cinematic);
    this.hero.root.visible = pk.playing && d.visible;
    if (!this.hero.root.visible) {
      if (!pk.cinematic) this.shotReady = false;
      this.yawReady = false;
      return;
    }
    const x = d.prev.x + (d.pos.x - d.prev.x) * alpha;
    const z = d.prev.z + (d.pos.z - d.prev.z) * alpha;
    const yTarget = this.terrain.surfaceY(x, z);
    this.y += (yTarget - this.y) * Math.min(1, frameDt * 12);
    if (Math.abs(yTarget - this.y) > 0.6) this.y = yTarget;

    if (!this.yawReady) {
      this.yaw = d.yaw;
      this.y = yTarget;
      this.yawReady = true;
    } else this.yaw = lerpAngle(this.yaw, d.yaw, damp(6, frameDt));

    const sitting = d.pose === 'sit' || d.pose === 'eat';
    if (sitting && pk.cinematic && !this.captioned) this.captionOn();
    const sitK = d.pose === 'walk' ? 0 : d.pose === 'sit' ? smooth(Math.min(1, d.t / 0.72)) : 1;
    const benchYaw = pk.bench?.yaw ?? d.yaw;
    const back = fwd(benchYaw);
    this.hero.root.position.set(x - back.x * SIT_BACK * sitK, this.y, z - back.z * SIT_BACK * sitK);
    this.hero.root.rotation.set(0, this.yaw, 0);
    this.pose(sitK, sitting, d.pose === 'eat' ? d.t : 0, d.walked, pk.sceneT);
  }

  /**
   * From his right, a little inland: he walks up and turns toward the water, then the lens eases in as he eats.
   * The river stays in frame in front of him.
   */
  aim(camera: THREE.PerspectiveCamera, dt: number): void {
    const bench = this.picnic.bench;
    if (!bench) return;
    const ground = this.terrain.surfaceY(bench.pos.x, bench.pos.z);
    const u = smooth(Math.min(1, Math.max(0, (this.picnic.sceneT - PICNIC_TUNING.fade) / 8.5)));
    // His right, about level with the bench, so the bagel hand and the water in front of him both read
    const side = -4.35 + u * 0.7;
    const forward = 0.2 + u * 0.2;
    const up = 1.72 - u * 0.1;
    this.frame(bench.pos, bench.yaw, ground, side, forward, up, this.at);
    this.frame(bench.pos, bench.yaw, ground, 0.05, 0.28, 0.92, this.look);
    if (!this.shotReady) {
      this.camPos.copy(this.at);
      this.camLook.copy(this.look);
      this.shotReady = true;
    }
    const k = 1 - Math.exp(-dt * 2.2);
    this.camPos.lerp(this.at, k);
    this.camLook.lerp(this.look, k);
    const floor = this.terrain.surfaceY(this.camPos.x, this.camPos.z) + 0.35;
    if (this.camPos.y < floor) this.camPos.y = floor;
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    if (Math.abs(camera.fov - 36) > 0.05) {
      camera.fov = 36;
      camera.updateProjectionMatrix();
    }
  }

  /** `side` is his left (positive) and `forward` faces the water, both in the bench frame. */
  private frame(
    pos: { x: number; z: number },
    yaw: number,
    ground: number,
    side: number,
    forward: number,
    up: number,
    out: THREE.Vector3,
  ): void {
    const f = fwd(yaw);
    const l = left(yaw);
    out.set(pos.x + f.x * forward + l.x * side, ground + up, pos.z + f.z * forward + l.z * side);
  }

  private pose(sitK: number, sitting: boolean, eatT: number, walked: number, sceneT: number): void {
    const p = this.hero;
    p.torso.rotation.x = 0;
    p.breathe(sceneT, sitting ? 0.7 : 0.35);
    if (!sitting) {
      p.stride(walked * 0.67, 1);
      const swing = Math.sin(walked * 4.7) * 0.32;
      p.pose(p.armL, { ...POSE.down, raise: POSE.down.raise + swing }, 1);
      p.pose(p.armR, { ...POSE.down, raise: POSE.down.raise - swing }, -1);
      p.head.rotation.set(0, 0, 0);
      return;
    }
    const hip = HIP + (SEAT + 0.04 - HIP) * sitK;
    p.hips.position.y = hip;
    const hx = (-Math.PI / 2 + 0.08) * sitK;
    const kx = (Math.PI / 2 - 0.08) * sitK;
    p.legL.hip.rotation.set(hx, 0, -0.05 * sitK);
    p.legR.hip.rotation.set(hx, 0, 0.05 * sitK);
    p.legL.knee.rotation.set(kx, 0, 0);
    p.legR.knee.rotation.set(kx, 0, 0);
    const lift = eatLift(eatT);
    p.pose(p.armL, LAP, 1);
    p.pose(p.armR, lerpPose(LAP, POSE.sip, lift), -1);
    p.head.rotation.set(0.28 * eatNod(eatT) * sitK, 0, 0);
  }

  private dress(): void {
    const h = this.hero.head;
    const wool = new THREE.MeshStandardMaterial({ color: 0xc23328, roughness: 0.9 });
    const tuque = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.124, 0.11, 14), wool);
    tuque.position.y = 0.085;
    h.add(tuque);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.132, 0.028, 14), new THREE.MeshStandardMaterial({ color: 0x8e241c, roughness: 0.95 }));
    brim.position.y = 0.04;
    h.add(brim);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.9 }));
    pom.position.y = 0.128;
    h.add(pom);
    const ruff = new THREE.Mesh(
      new THREE.TorusGeometry(0.105, 0.026, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0xcdbb98, roughness: 0.95 }),
    );
    ruff.rotation.x = Math.PI / 2;
    ruff.position.y = 0.62;
    this.hero.torso.add(ruff);
  }

  private bars(up: boolean): void {
    if (up === this.barsUp) return;
    this.barsUp = up;
    this.cine.classList.toggle('show', up);
    this.cine.parentElement?.classList.toggle('cinematic', up);
    if (!up) {
      this.captioned = false;
      this.caption.classList.remove('show');
    }
  }

  private captionOn(): void {
    this.captioned = true;
    this.caption.innerHTML = '<div class="name">Lox bagel</div><div class="jp">Tour de l\'Horloge</div>';
    this.caption.style.animationDuration = '9s';
    this.caption.classList.remove('show');
    void this.caption.offsetWidth;
    this.caption.classList.add('show');
  }
}

/** His left, when facing `yaw` (the water is forward). */
function left(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/** A sesame bagel with cream cheese and lox, sized for a hand. Pivot at the palm. */
function loxBagel(): THREE.Group {
  const g = new THREE.Group();
  const crust = new THREE.MeshStandardMaterial({ color: 0xc4893c, roughness: 0.82 });
  const seed = new THREE.MeshStandardMaterial({ color: 0xf0e2c0, roughness: 0.7 });
  const cheese = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.65 });
  const lox = new THREE.MeshStandardMaterial({ color: 0xe07058, roughness: 0.5 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.022, 8, 16), crust);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const smear = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.012, 12), cheese);
  smear.position.y = 0.014;
  g.add(smear);
  // Lox over the top and around the rim, so the salmon reads from the side shot as well as from above
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const slice = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.01, 0.022), lox);
    slice.position.set(Math.cos(a) * 0.028, 0.022, Math.sin(a) * 0.028);
    slice.rotation.y = -a;
    g.add(slice);
  }
  const seedGeo = new THREE.SphereGeometry(0.005, 5, 4);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4;
    const m = new THREE.Mesh(seedGeo, seed);
    m.position.set(Math.cos(a) * 0.046, 0.026, Math.sin(a) * 0.046);
    m.scale.set(1.5, 0.55, 0.9);
    g.add(m);
  }
  // In the palm, tilted so the salmon faces out toward the lens
  g.position.set(0, -0.02, 0.08);
  g.rotation.set(-0.9, 0.6, 0.4);
  return g;
}
