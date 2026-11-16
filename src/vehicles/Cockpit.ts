import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { Car } from './Car';
import { carMaterial } from './CarMaterial';
import { charmGeometry } from './Charms';
import type { CharmId } from './Tuning';
import { CLUSTER_H, CLUSTER_W, DIAL_R, DIAL_X, RadioDisplay, SPEEDO_MAX, SWEEP, SWEEP_START, TACH_MAX, clusterTexture } from './CockpitGauges';
import { buildCockpit, type Placement } from './CockpitModel';

/** Turn signal tell-tales on the cluster face (green arrows outboard of the dials). */
const ARROW_OFF = new THREE.MeshBasicMaterial({ color: 0x06200e });
const ARROW_ON = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 2.4, 0.55), toneMapped: false });

/** Headlight tell-tale: the green warning lamp between the dials, lit while the headlights are on. */
const HEAD_OFF = new THREE.MeshBasicMaterial({ color: 0x0c2a12 });
const HEAD_ON = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 0.5), toneMapped: false });

/** Arrow pointing to the viewer's left (-x), 1 unit long. */
function arrowGeometry(w: number, h: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const pts: [number, number][] = [[-0.5, 0], [-0.02, 0.5], [-0.02, 0.2], [0.5, 0.2], [0.5, -0.2], [-0.02, -0.2], [-0.02, -0.5]];
  pts.forEach(([x, y], i) => (i ? s.lineTo(x * w, y * h) : s.moveTo(x * w, y * h)));
  return new THREE.ShapeGeometry(s);
}

/** Steering wheel rotation (rad) at full lock: quicker than a real rack so it reads on screen. */
const WHEEL_TURN = 2.4;
/** Mirror image resolution (matches the glass aspect). */
const MIRROR_PX = 384;
const CHARM_LEN = 0.09;

function place(o: THREE.Object3D, p: Placement): THREE.Object3D {
  o.position.copy(p.at);
  o.rotation.copy(p.rot);
  return o;
}

/**
 * Driver's-seat interior for the player's car, parented to its body so it follows suspension, roll and pitch.
 * Animates the steering wheel, gauge needles and a hanging charm, and renders the rearview mirror from a
 * rear-facing camera. Only shown (and only costs anything) while the camera is in cockpit mode.
 */
export class Cockpit {
  readonly group = new THREE.Group();
  /** Driver's eye in the car body's frame. */
  readonly eye = new THREE.Vector3();
  /** Cabin slice of the body shell (front z, rear z) to cut away while inside. */
  cabin: [number, number, number] = [0, 0, 0];
  mirrorEnabled = true;
  /** Style and redline the interior was built for. The tach marks depend on the redline. */
  private builtKey = '';
  private wheel!: THREE.Object3D;
  private needles: THREE.Object3D[] = [];
  private arrowL!: THREE.Mesh;
  private arrowR!: THREE.Mesh;
  private headLamp!: THREE.Mesh;
  private charm!: THREE.Mesh;
  private charmId: CharmId | null = null;
  private swing = { x: 0, z: 0, vx: 0, vz: 0 };
  private speedT = 0;
  private tachT = 0;
  private radio = new RadioDisplay();
  private radioT = 0;
  private mirrorCam!: THREE.PerspectiveCamera;
  private mirrorRT!: THREE.WebGLRenderTarget;
  private frame = 0;

  constructor(car: Car) {
    this.group.visible = false;
    this.fit(car);
  }

  /** Rebuild the interior when the body style or the tach's redline changes; swap the charm when it does. */
  fit(car: Car): void {
    const key = `${car.look.style}_${car.phys.spec.redline}`;
    if (this.builtKey !== key) {
      this.clear();
      this.mount(car);
      this.builtKey = key;
    }
    const charm = car.look.charm ?? 'omamori';
    if (charm !== this.charmId) {
      this.charmId = charm;
      const g = charmGeometry(charm);
      this.charm.visible = g !== null;
      if (g) this.charm.geometry = g;
    }
  }

  private mount(car: Car): void {
    const p = buildCockpit(car.look.style);
    this.eye.copy(p.eye);
    this.cabin = p.cabin;
    const mat = carMaterial({ roughness: 0.7, metalness: 0 });
    this.group.add(new THREE.Mesh(p.statics, mat));
    this.wheel = place(new THREE.Mesh(p.wheel, mat), p.wheelAt);
    this.group.add(this.wheel);

    const cluster = place(new THREE.Group(), p.cluster);
    cluster.add(new THREE.Mesh(new THREE.PlaneGeometry(CLUSTER_W, CLUSTER_H), new THREE.MeshBasicMaterial({ map: clusterTexture(car.phys.spec.redline) })));
    for (const x of [-DIAL_X, DIAL_X]) {
      const n = new THREE.Mesh(p.needle, mat);
      n.position.set(x, 0, 0);
      cluster.add(n);
      this.needles.push(n);
    }
    const arrow = arrowGeometry(0.026, 0.019);
    this.arrowL = new THREE.Mesh(arrow, ARROW_OFF);
    this.arrowR = new THREE.Mesh(arrow, ARROW_OFF);
    const ax = DIAL_X + DIAL_R * 1.06 + 0.021; // just outboard of each dial, visible through the wheel
    this.arrowL.position.set(-ax, 0.022, 0.0015);
    this.arrowR.position.set(ax, 0.022, 0.0015);
    this.arrowR.rotation.z = Math.PI;
    cluster.add(this.arrowL, this.arrowR);
    // third of the four lamps in the column between the dials (see clusterTexture)
    this.headLamp = new THREE.Mesh(new THREE.CircleGeometry(DIAL_R * 0.08, 16), HEAD_OFF);
    this.headLamp.position.set(0, -DIAL_R * 0.2, 0.0015);
    cluster.add(this.headLamp);
    this.group.add(cluster);

    const radio = place(new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.032), new THREE.MeshBasicMaterial({ map: this.radio.texture })), p.radio);
    this.group.add(radio);

    this.charm = new THREE.Mesh(undefined, mat);
    this.charm.position.copy(p.charmAt);
    this.group.add(this.charm);
    this.charmId = null;

    // Mirror: rear camera into a small HDR target, tone mapped while rendering (see PostFX) so the glass
    // material shows it as is. The image is flipped left-right like a real mirror.
    const aspect = p.mirror.w / p.mirror.h;
    this.mirrorRT = new THREE.WebGLRenderTarget(MIRROR_PX, Math.round(MIRROR_PX / aspect), { type: THREE.HalfFloatType, samples: 4 });
    this.mirrorRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    (this.mirrorRT as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    const glass = new THREE.PlaneGeometry(p.mirror.w, p.mirror.h);
    const uv = glass.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    const mirror = place(new THREE.Mesh(glass, new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture, color: 0xdddddd, toneMapped: false })), p.mirror);
    this.group.add(mirror);
    this.mirrorCam = new THREE.PerspectiveCamera(13, aspect, 0.5, 260);
    this.mirrorCam.position.copy(p.mirrorCam);
    this.mirrorCam.rotation.x = -0.035; // camera looks along -z: straight back out of the car
    this.group.add(this.mirrorCam);
  }

  /** Drop the previous interior. Shared tell-tale materials and the radio texture stay. */
  private clear(): void {
    if (!this.builtKey) return;
    const shared = new Set<THREE.Material>([ARROW_OFF, ARROW_ON, HEAD_OFF, HEAD_ON]);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    for (const child of [...this.group.children]) {
      child.traverse((n) => {
        const mesh = n as THREE.Mesh;
        // charm geometries are cached and shared (Charms.ts)
        if (mesh.geometry && mesh !== this.charm) geos.add(mesh.geometry);
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) if (!shared.has(m)) mats.add(m);
      });
      this.group.remove(child);
    }
    for (const g of geos) g.dispose();
    for (const m of mats) {
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map && map !== this.radio.texture && map !== this.mirrorRT.texture) map.dispose();
      m.dispose();
    }
    this.mirrorRT.dispose();
    this.needles = [];
  }

  /** Follows the car's body group (CarView may create it after the cockpit). */
  attach(body: THREE.Object3D | undefined): void {
    if (body && this.group.parent !== body) body.add(this.group);
  }

  update(car: Car, dt: number, active: boolean): void {
    this.group.visible = active && this.group.parent !== null;
    if (!this.group.visible) return;
    const s = car.phys.state;
    this.wheel.rotation.z = (s.steerAngle / car.phys.spec.maxSteer) * WHEEL_TURN;
    const k = damp(12, dt);
    this.speedT += (clamp((Math.abs(s.speed) * 3.6) / SPEEDO_MAX, 0, 1) - this.speedT) * k;
    this.tachT += (clamp(s.rpm / TACH_MAX, 0, 1) - this.tachT) * k;
    this.needles[0].rotation.z = SWEEP_START - this.tachT * SWEEP;
    this.needles[1].rotation.z = SWEEP_START - this.speedT * SWEEP;
    this.swingCharm(s.accelF, s.accelL, dt);
    const lit = car.blinkLit;
    this.arrowL.material = lit && car.blinker === 'left' ? ARROW_ON : ARROW_OFF;
    this.arrowR.material = lit && car.blinker === 'right' ? ARROW_ON : ARROW_OFF;
    this.headLamp.material = car.lampsOn ? HEAD_ON : HEAD_OFF;
    if ((this.radioT -= dt) <= 0) {
      this.radioT = 1;
      this.radio.update();
    }
  }

  /** Pendulum driven by the car's acceleration: swings back when accelerating, outward in turns. */
  private swingCharm(accelF: number, accelL: number, dt: number): void {
    const w = this.swing;
    const w2 = 9.81 / CHARM_LEN;
    const tx = Math.atan(accelF / 9.81);
    const tz = Math.atan(-accelL / 9.81);
    const n = Math.ceil(dt * 120);
    const h = dt / Math.max(1, n);
    for (let i = 0; i < n; i++) {
      w.vx += (w2 * (tx - w.x) - 1.8 * w.vx) * h;
      w.vz += (w2 * (tz - w.z) - 1.8 * w.vz) * h;
      w.x += w.vx * h;
      w.z += w.vz * h;
    }
    this.charm.rotation.set(w.x, 0, w.z);
  }

  /** Renders the mirror image; call right before the main render. 30 Hz is plenty for a mirror. */
  renderMirror(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.group.visible || !this.mirrorEnabled) return;
    if (this.frame++ % 2 === 1) return;
    this.group.visible = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.mirrorRT);
    renderer.render(scene, this.mirrorCam);
    renderer.setRenderTarget(prev);
    this.group.visible = true;
  }
}
