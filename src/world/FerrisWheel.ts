import * as THREE from 'three';
import { CONFIG } from '../config';
import { LOOK } from '../render/Look';
import type { AABB } from '../types';
import type { PortWheel } from './Features';
import type { CityModel } from './RoadGraph';
import { snowMaterial } from './SnowCover';

/**
 * La Grande Roue de Montréal, on the island `Harbor.ts` planned beside the clock tower. The wheel faces the
 * promenade and turns once every `TURN` seconds; the gondolas counter-rotate so they stay upright. The
 * footbridge, its rails and the center gate are the same boxes the cars collide with.
 */
export interface FerrisSet {
  update(time: number): void;
}

/** A full turn. Slow, so a 60 m wheel reads as heavy. */
const TURN = 96;
const GONDOLAS = 12;
/** Clearance under the rim, so a walker on the island passes under the lowest cabin. */
const LIFT = 7;

const TOP = CONFIG.CURB_HEIGHT;

export function buildFerris(city: CityModel, scene: THREE.Scene): FerrisSet | null {
  const w = city.features.port?.wheel;
  if (!w) return null;
  const root = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.38, metalness: 0.62 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xe7e2d6, roughness: 0.45, metalness: 0.35 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xbab2a4, roughness: 0.88 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.45, metalness: 0.65 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x1a2836,
    roughness: 0.12,
    metalness: 0.55,
    emissive: 0x9bb4c8,
    emissiveIntensity: LOOK.day ? 0.08 : 0.35,
  });
  const lamp = new THREE.MeshBasicMaterial({ color: LOOK.day ? new THREE.Color(1.15, 1.02, 0.82) : new THREE.Color(2.4, 1.85, 1.15) });

  root.add(slab(stone, w.deck, -2.6, TOP));
  root.add(slab(stone, w.bridge, -0.9, TOP + 0.02));
  piles(root, stone, w);
  rails(root, iron, w);
  root.add(slab(stone, w.gate, TOP, w.gate.top ?? TOP + 1.2));
  kiosk(root, stone, pale, w);
  lamps(root, iron, lamp, w);

  const hubY = TOP + w.radius + LIFT;
  const frameZ = 2.35;
  for (const s of [-1, 1]) {
    const z = w.pos.z + s * frameZ;
    strut(root, steel, new THREE.Vector3(w.pos.x - 16, TOP, z), new THREE.Vector3(w.pos.x, hubY, z), 0.55, 0.55);
    strut(root, steel, new THREE.Vector3(w.pos.x + 16, TOP, z), new THREE.Vector3(w.pos.x, hubY, z), 0.55, 0.55);
    const foot = (x: number) => box(root, stone, x, TOP, z, 1.8, 0.35, 1.8);
    foot(w.pos.x - 16);
    foot(w.pos.x + 16);
  }

  const wheel = new THREE.Group();
  wheel.position.set(w.pos.x, hubY, w.pos.z);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(w.radius, 0.38, 8, 56), steel);
  wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, frameZ * 2 + 0.8, 16), steel);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  for (let i = 0; i < GONDOLAS; i++) {
    const a = (i / GONDOLAS) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, w.radius, 0.16), steel);
    spoke.position.set(Math.cos(a) * w.radius * 0.5, Math.sin(a) * w.radius * 0.5, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lamp);
    bulb.position.set(Math.cos(a) * w.radius, Math.sin(a) * w.radius, 0);
    wheel.add(bulb);
  }
  const gondolas: THREE.Group[] = [];
  for (let i = 0; i < GONDOLAS; i++) {
    const a = (i / GONDOLAS) * Math.PI * 2 + Math.PI / GONDOLAS;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * w.radius, Math.sin(a) * w.radius, 0);
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), iron);
    hanger.position.y = -0.35;
    g.add(hanger);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.35, 2.05, 1.55), pale);
    cab.position.y = -1.75;
    g.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 1.6), glass);
    win.position.y = -1.55;
    g.add(win);
    wheel.add(g);
    gondolas.push(g);
  }
  root.add(wheel);
  scene.add(root);

  return {
    update(time: number) {
      const ang = (time / TURN) * Math.PI * 2;
      wheel.rotation.z = ang;
      for (const g of gondolas) g.rotation.z = -ang;
    },
  };
}

/** Piles in the water between the quay wall and the island. */
function piles(root: THREE.Group, mat: THREE.Material, w: PortWheel): void {
  const z0 = w.bridge.minZ + 4;
  const z1 = w.bridge.maxZ - 2;
  for (const t of [0.15, 0.5, 0.85]) {
    const z = z0 + (z1 - z0) * t;
    for (const x of [w.bridge.minX + 0.45, w.bridge.maxX - 0.45]) {
      box(root, mat, x, -2.5, z, 0.55, 1.8, 0.55);
    }
  }
}

/** Approach fences on the promenade and the rails along the bridge and the island edge. */
function rails(root: THREE.Group, mat: THREE.Material, w: PortWheel): void {
  const y = TOP;
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.4) return;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const postN = Math.max(2, Math.round(len / 2.4));
    for (let i = 0; i <= postN; i++) {
      const t = i / postN;
      box(root, mat, x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, 0.1, 1.05, 0.1);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, len), mat);
    rail.position.set(mx, y + 1.02, mz);
    rail.rotation.y = yaw;
    root.add(rail);
  };
  const zApproach = w.gate.minZ;
  run(w.bridge.minX + 0.09, zApproach, w.bridge.minX + 0.09, w.bridge.maxZ);
  run(w.bridge.maxX - 0.09, zApproach, w.bridge.maxX - 0.09, w.bridge.maxZ);
  const d = w.deck;
  const mouth0 = w.bridge.minX;
  const mouth1 = w.bridge.maxX;
  run(d.minX, d.minZ, mouth0, d.minZ);
  run(mouth1, d.minZ, d.maxX, d.minZ);
  run(d.maxX, d.minZ, d.maxX, d.maxZ);
  run(d.maxX, d.maxZ, d.minX, d.maxZ);
  run(d.minX, d.maxZ, d.minX, d.minZ);
}

/** A ticket kiosk on the west side of the deck, off the walking loop. */
function kiosk(root: THREE.Group, stone: THREE.Material, pale: THREE.Material, w: PortWheel): void {
  const x = w.pos.x - 18;
  const z = w.pos.z + 2;
  box(root, stone, x, TOP, z, 5.2, 2.6, 3.4);
  box(root, pale, x, TOP + 2.6, z, 5.5, 0.35, 3.7);
  const snow = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.12, 3.8), snowMaterial());
  snow.position.set(x, TOP + 3.02, z);
  root.add(snow);
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.9, 1.5),
    new THREE.MeshStandardMaterial({ color: 0xc4554a, roughness: 0.4, metalness: 0.2, emissive: 0xffe1c4, emissiveIntensity: LOOK.day ? 0.15 : 0.6 }),
  );
  win.position.set(x + 2.64, TOP + 1.45, z);
  root.add(win);
}

function lamps(root: THREE.Group, iron: THREE.Material, glow: THREE.Material, w: PortWheel): void {
  const d = w.deck;
  const spots = [
    { x: d.minX + 3, z: d.minZ + 3 },
    { x: d.maxX - 3, z: d.minZ + 3 },
    { x: d.minX + 3, z: d.maxZ - 3 },
    { x: d.maxX - 3, z: d.maxZ - 3 },
  ];
  for (const p of spots) {
    box(root, iron, p.x, TOP, p.z, 0.16, 3.4, 0.16);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), glow);
    globe.position.set(p.x, TOP + 3.55, p.z);
    root.add(globe);
  }
}

function slab(mat: THREE.Material, r: AABB, y0: number, y1: number): THREE.Mesh {
  const h = Math.max(0.05, y1 - y0);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(r.maxX - r.minX, h, r.maxZ - r.minZ), mat);
  mesh.position.set((r.minX + r.maxX) / 2, y0 + h / 2, (r.minZ + r.maxZ) / 2);
  return mesh;
}

/** A box standing on `y`, centered on (x, z). */
function box(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.position.set(x, y + sy / 2, z);
  parent.add(mesh);
}

function strut(parent: THREE.Object3D, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, sx: number, sz: number): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, len, sz), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len));
  parent.add(mesh);
}
