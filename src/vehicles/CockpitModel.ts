import * as THREE from 'three';
import { CONFIG } from '../config';
import type { BodyStyle } from './Car';
import { PROFILES } from './BodyProfiles';
import type { V2 } from './CarGeometry';
import { Kit, bake, look, paintBase } from './CarKit';
import { CHROME, GLOW, LAMP, MATTE, rgb } from './CarMaterial';
import { CLUSTER_W, DIAL_R } from './CockpitGauges';

/**
 * The driver sits on the side away from the curb: left-hand drive for right-hand traffic (Montreal), right-hand
 * drive for left-hand traffic. The car's +x is its left, so a left-hand-drive driver sits at +x.
 */
const SIDE = CONFIG.DRIVE_SIDE === 'right' ? 1 : -1;

const DASH = look(rgb(0.045, 0.045, 0.05), MATTE);
const PANEL = look(rgb(0.085, 0.082, 0.088), MATTE);
const LINER = look(rgb(0.22, 0.21, 0.2), MATTE);
const PILLAR = look(rgb(0.11, 0.105, 0.1), MATTE);
const BLACK = look(rgb(0.018, 0.018, 0.02), MATTE);
const LEATHER = look(rgb(0.13, 0.12, 0.11), MATTE);
const SATIN = look(rgb(0.22, 0.22, 0.23), MATTE);
const ALLOY = look(rgb(0.5, 0.51, 0.53), CHROME);
const MARK = look(rgb(0.36, 0.25, 0.13), MATTE); // dull rim index, only there so the wheel's turn still reads
const HAZARD = look(rgb(0.55, 0.04, 0.03), GLOW);
const NEEDLE = look(rgb(0.46, 0.12, 0.02), LAMP);

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry {
  return flat(new THREE.BoxGeometry(w, h, d)).rotateX(rx).translate(x, y, z);
}

function disc(r: number, depth: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return flat(new THREE.CylinderGeometry(r, r, depth, 14)).rotateX(Math.PI / 2).translate(x, y, z);
}

/** Box with cross-section w x d stretched from a to b; w lies across `up`, d along it. */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, up = UP): THREE.BufferGeometry {
  const z = b.clone().sub(a);
  const len = z.length();
  z.divideScalar(len);
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(a.clone().add(b).multiplyScalar(0.5));
  return flat(new THREE.BoxGeometry(w, d, len)).applyMatrix4(m);
}

/** Closed side profile (z, y) extruded across the car from x0 to x1. */
function prism(zy: [number, number][], x0: number, x1: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(zy.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false });
  // shape x -> car z, extrusion -> car -x
  return flat(g).rotateY(-Math.PI / 2).translate(x1, 0, 0);
}

function geometry(k: Kit): THREE.BufferGeometry {
  return paintBase(bake(k), new THREE.Color());
}

export interface Placement {
  at: THREE.Vector3;
  rot: THREE.Euler;
}

export interface CockpitParts {
  /** Dash, pillars, header, liner, doors, center stack, mirror housing: one draw call. */
  statics: THREE.BufferGeometry;
  /** Steering wheel around its own axis (+z toward the driver, +x to the driver's right). */
  wheel: THREE.BufferGeometry;
  /** Gauge needle pointing +y from its pivot. */
  needle: THREE.BufferGeometry;
  eye: THREE.Vector3;
  wheelAt: Placement;
  cluster: Placement;
  radio: Placement;
  mirror: Placement & { w: number; h: number };
  /** Where the charm (`Charms.ts`) hangs from, under the mirror. */
  charmAt: THREE.Vector3;
  /** Rear-facing camera for the mirror image. */
  mirrorCam: THREE.Vector3;
  /** Slice of the car body around the cabin (z front, z rear) to cut away while inside. */
  cabin: [number, number];
}

const face = (x: number, y: number, z: number, rx = 0, ry = Math.PI): Placement => ({ at: V(x, y, z), rot: new THREE.Euler(rx, ry, 0, 'XYZ') });

/** The handful of body numbers the interior is fitted to. */
interface CabFit {
  W: number;
  gW: number;
  tumble: number;
  belt: number;
  sill: number;
  ws: [V2, V2];
  roof: V2[];
  bl: [V2, V2];
  /** Driver's eye (z, y) when it can't follow from the roof and windshield (the cab-over kei). */
  eye?: V2;
}

const P = (z: number, y: number): V2 => [z, y];

/**
 * Kei-truck cab (see TruckKei's `CAB`): the driver's eye has to sit over the front axle, not in a sedan cabin. The
 * windshield follows the body's glass; the eye is set by hand, low enough that the header stays above the line of
 * sight (the roof-down rule would put it level with the top of the glass) and back from the upright windshield.
 */
const KEI_CAB: CabFit = {
  W: 1.48,
  gW: 1.36,
  tumble: 0.96,
  belt: 1.05,
  sill: 0.42,
  ws: [P(1.64, 0.95), P(1.545, 1.62)],
  roof: [P(1.4, 1.76), P(0.95, 1.78), P(0.62, 1.75)],
  bl: [P(0.55, 1.68), P(0.48, 1.08)],
  eye: P(0.97, 1.46),
};

/** Driver's-eye interior fitted to a body style's greenhouse (car frame: +z forward, y up from the ground). */
export function buildCockpit(style: BodyStyle): CockpitParts {
  const st: CabFit = style === 'keitruck' ? KEI_CAB : PROFILES[style === 'truck' ? 'sedan' : style];
  const [[bz, by], [tz, ty]] = st.ws; // windshield base and top (z, y)
  const wsZ = (y: number) => bz + ((y - by) / (ty - by)) * (tz - bz);
  const roofY = Math.max(...st.roof.map((p) => p[1]));
  const belt = st.belt;
  const hwB = st.gW / 2 - 0.05; // cabin half width at the belt
  const hwR = (st.gW * st.tumble) / 2 - 0.04; // ... under the roof
  const hwD = st.W / 2 - 0.1; // door trim
  const ex = SIDE * st.W * 0.22;
  const eye = st.eye ? V(ex, st.eye[1], st.eye[0]) : V(ex, roofY - 0.18, tz - 0.45);
  const dashZ = eye.z + 0.62; // dash face toward the driver
  const rearZ = st.bl[0][0];
  const k = new Kit();

  // Dash: full width, top runs from the windshield base back to the driver, face drops to the footwell
  k.add(
    prism(
      [
        [bz + 0.04, belt - 0.02],
        [bz - 0.1, belt + 0.025],
        [dashZ + 0.14, belt + 0.045],
        [dashZ + 0.02, belt + 0.04],
        [dashZ, belt + 0.015],
        [dashZ, belt - 0.2],
        [dashZ + 0.08, belt - 0.42],
        [bz + 0.04, belt - 0.42],
      ],
      -hwD,
      hwD,
    ),
    DASH,
  );
  // Instrument binnacle: hooded pod in front of the driver, its face tilted back toward the eye
  const clusterY = belt - 0.03;
  const clusterZ = dashZ - 0.04;
  const faceTilt = (20 * Math.PI) / 180;
  const faceZ = (y: number) => clusterZ + 0.006 + (y - clusterY) * Math.tan(faceTilt);
  const podW = CLUSTER_W / 2 + 0.03;
  k.add(
    prism(
      [
        [dashZ + 0.3, belt + 0.03],
        [dashZ + 0.12, belt + 0.1],
        [dashZ - 0.04, belt + 0.115],
        [dashZ - 0.075, belt + 0.1],
        [dashZ - 0.065, belt + 0.085],
        [faceZ(belt + 0.075), belt + 0.075],
        [faceZ(belt - 0.17), belt - 0.17],
        [dashZ + 0.06, belt - 0.17],
      ],
      ex - podW,
      ex + podW,
    ),
    DASH,
  );

  // Center stack: vents with hazard switch, stereo, cassette slot, buttons, climate knobs
  k.add(box(0.25, 0.37, 0.03, 0, belt - 0.2, dashZ + 0.005), PANEL);
  const sz = dashZ - 0.012;
  for (const vx of [-0.062, 0.062]) {
    k.add(box(0.1, 0.042, 0.01, vx, belt - 0.045, sz), BLACK);
    for (const dy of [-0.012, 0, 0.012]) k.add(box(0.094, 0.004, 0.008, vx, belt - 0.045 + dy, sz - 0.004, 0.3), ALLOY);
  }
  k.add(box(0.016, 0.016, 0.01, 0, belt - 0.045, sz - 0.002), HAZARD);
  k.add(box(0.15, 0.05, 0.006, 0, belt - 0.1, sz), BLACK); // stereo bezel
  k.add(box(0.12, 0.008, 0.006, 0, belt - 0.145, sz - 0.001), BLACK);
  for (let i = -2; i <= 2; i++) k.add(box(0.018, 0.011, 0.01, i * 0.026, belt - 0.172, sz), PANEL);
  for (const kx of [-0.065, 0, 0.065]) k.add(disc(0.015, 0.014, kx, belt - 0.25, sz - 0.004), ALLOY);
  // Driver's outer vent and passenger glovebox handle
  k.add(box(0.07, 0.05, 0.01, SIDE * (hwD - 0.07), belt - 0.03, dashZ - 0.004), BLACK);
  for (const dy of [-0.014, 0, 0.014]) k.add(box(0.064, 0.004, 0.008, SIDE * (hwD - 0.07), belt - 0.03 + dy, dashZ - 0.009, 0.3), ALLOY);
  k.add(box(0.1, 0.012, 0.012, -SIDE * 0.42, belt - 0.12, dashZ - 0.004), ALLOY);

  // Steering column shroud
  const wheelAt = face(ex, eye.y - 0.33, eye.z + 0.4, (24 * Math.PI) / 180);
  const toDriver = V(0, Math.sin(wheelAt.rot.x), -Math.cos(wheelAt.rot.x));
  k.add(beam(wheelAt.at.clone().addScaledVector(toDriver, -0.03), wheelAt.at.clone().addScaledVector(toDriver, -0.34), 0.085, 0.08), BLACK);

  // Footwell floor and console (only seen at the screen corners)
  const floorY = st.sill + 0.06;
  const backZ = eye.z - 0.5;
  k.add(box(2 * hwD, 0.02, dashZ + 0.5 - backZ, 0, floorY, (dashZ + 0.5 + backZ) / 2), BLACK);
  k.add(box(0.22, belt - 0.4 - floorY, dashZ + 0.05 - (eye.z - 0.1), 0, (belt - 0.4 + floorY) / 2, (dashZ + 0.05 + eye.z - 0.1) / 2), DASH);

  // Doors: trim panel, sill cap, armrest and handle
  for (const s of [1, -1]) {
    const x = s * (hwD + 0.03);
    const z0 = bz - 0.05;
    const z1 = eye.z - 0.55;
    k.add(box(0.05, belt - floorY, z0 - z1, x, (belt + floorY) / 2, (z0 + z1) / 2), PANEL);
    k.add(box(0.08, 0.03, z0 - z1, s * (hwD + 0.01), belt + 0.01, (z0 + z1) / 2), BLACK);
    k.add(box(0.07, 0.045, 0.5, s * (hwD - 0.03), belt - 0.18, eye.z), DASH);
    k.add(box(0.016, 0.022, 0.08, s * (hwD - 0.005), belt - 0.08, eye.z + 0.28), ALLOY);
  }

  // A-pillars, header, roof rails, headliner, sun visors
  for (const s of [1, -1]) {
    k.add(beam(V(s * (hwB - 0.01), belt + 0.01, bz - 0.01), V(s * hwR, ty - 0.01, tz - 0.03), 0.07, 0.06), PILLAR);
    k.add(beam(V(s * hwR, roofY - 0.05, tz - 0.06), V(s * hwR, roofY - 0.06, rearZ), 0.07, 0.06), PILLAR);
    k.add(box(0.34, 0.016, 0.15, s * 0.3, roofY - 0.06, tz - 0.17, -0.08), PILLAR);
  }
  k.add(box(2 * hwR + 0.08, 0.05, 0.14, 0, ty, tz - 0.06), PILLAR);
  k.add(box(2 * hwR + 0.08, 0.02, tz - 0.08 - rearZ, 0, roofY - 0.045, (tz - 0.08 + rearZ) / 2), LINER);

  // Rearview mirror: housing and stem (the glass is a separate mesh showing the rear camera)
  const mw = 0.24;
  const mh = 0.066;
  const my = ty - 0.095;
  const mz = wsZ(my + mh / 2 + 0.01) - 0.04; // top edge just behind the glass
  const toEye = eye.clone().sub(V(0, my, mz));
  const yaw = Math.atan2(-toEye.x, -toEye.z) / 2; // halfway between the eye and straight back
  const mirror = { ...face(0, my, mz, -0.03, Math.PI + yaw), w: mw, h: mh };
  const mm = new THREE.Matrix4().compose(mirror.at, new THREE.Quaternion().setFromEuler(mirror.rot), V(1, 1, 1));
  k.add(box(mw + 0.016, mh + 0.016, 0.03, 0, 0, -0.017).applyMatrix4(mm), BLACK);
  const mount = V(0, ty - 0.03, wsZ(ty - 0.03) - 0.015);
  k.add(beam(V(0, my + 0.01, mz + 0.02), mount, 0.018, 0.018, V(0, 0, 1)), BLACK);

  // Steering wheel: leather rim, a dull top index, three spokes into a broad horn pad (flat, not a dished race wheel)
  const w = new Kit();
  const R = 0.18;
  w.add(flat(new THREE.TorusGeometry(R, 0.018, 8, 44)), LEATHER);
  w.add(box(0.011, 0.009, 0.006, 0, R + 0.013, 0.015), MARK);
  for (const a of [-0.42, Math.PI + 0.42, -Math.PI / 2]) {
    const d = V(Math.cos(a), Math.sin(a), 0);
    w.add(beam(d.clone().multiplyScalar(0.066).setZ(-0.004), d.clone().multiplyScalar(R - 0.016).setZ(-0.001), 0.038, 0.011, V(0, 0, 1)), SATIN);
  }
  w.add(flat(new THREE.CylinderGeometry(0.072, 0.075, 0.016, 22)).rotateX(Math.PI / 2).translate(0, 0, 0.001), LEATHER);
  w.add(flat(new THREE.TorusGeometry(0.052, 0.0032, 6, 28)).translate(0, 0, 0.01), ALLOY);
  w.add(flat(new THREE.CylinderGeometry(0.044, 0.044, 0.007, 20)).rotateX(Math.PI / 2).translate(0, 0, 0.008), BLACK);

  // Needle with a dark center cap
  const n = new Kit();
  n.add(box(0.0032, DIAL_R * 0.95, 0.0015, 0, DIAL_R * 0.4, 0.002), NEEDLE);
  n.add(disc(0.008, 0.004, 0, 0, 0.004), BLACK);

  return {
    statics: geometry(k),
    wheel: geometry(w),
    needle: geometry(n),
    eye,
    wheelAt,
    cluster: face(ex, clusterY, clusterZ, faceTilt),
    radio: face(0, belt - 0.1, sz - 0.0035),
    mirror,
    charmAt: V(0, my - mh / 2 - 0.004, mz + 0.012),
    mirrorCam: V(0, eye.y + 0.04, rearZ + 0.15),
    cabin: [bz, st.bl[1][0]],
  };
}
