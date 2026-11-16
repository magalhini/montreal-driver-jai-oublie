import * as THREE from 'three';
import { clamp } from '../core/math';
import type { ViewSystem } from '../types';
import type { Effects } from '../vehicles/Effects';
import { buildCarParts, carMaterial, wheelGeometry } from '../vehicles/CarModel';
import { sharedGlow } from '../world/textures';
import type { Wreck, WreckShot } from './Wreck';

/**
 * Slow-motion breakup of the player's car (IMPROVEMENTS #24). The body is cut into the real panels and
 * each one is thrown from the hit: a wall throws them back, a pole lets the nose spear through, a truck
 * stops harder than a kei. Panels tumble, then burn out.
 *
 * Velocities are in sim-seconds. `Wreck` runs the sim at ~1/3 speed, which is what makes this slow motion.
 */

interface Shard {
  group: THREE.Group;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  detonate: number;
  popped: boolean;
  bounced: boolean;
  mats: THREE.Material[];
}

interface Flame {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  phase: number;
}

interface Blast {
  t: number;
  power: number;
  done: boolean;
}

function hash(part: string, seq: number): number {
  let n = seq * 13 + 7;
  for (let i = 0; i < part.length; i++) n = n * 33 + part.charCodeAt(i);
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

function sideOf(part: string): number {
  if (part === 'FL' || part === 'RL' || part.endsWith('L')) return 1;
  if (part === 'FR' || part === 'RR' || part.endsWith('R')) return -1;
  return 0;
}

type Role = 'nose' | 'hood' | 'side' | 'door' | 'roof' | 'trunk' | 'cabin' | 'wheel';

function roleOf(part: string): Role {
  if (part === 'lampsF' || part === 'nose') return 'nose';
  if (part === 'lampsR') return 'trunk';
  if (part === 'FL' || part === 'FR' || part === 'RL' || part === 'RR') return 'wheel';
  if (part === 'fenderL' || part === 'fenderR') return 'side';
  if (part === 'doorL' || part === 'doorR') return 'door';
  if (part === 'hood' || part === 'roof' || part === 'trunk' || part === 'cabin') return part;
  return 'cabin';
}

function struckOf(part: string, shot: WreckShot): boolean {
  const side = sideOf(part);
  const strike = Math.sign(shot.side || shot.glance || 1) || 1;
  return side !== 0 && side === strike;
}

function heavy(shot: WreckShot): boolean {
  return shot.kind === 'wall' || shot.otherMass >= 2000;
}

function spear(shot: WreckShot): boolean {
  return shot.kind === 'prop' || (shot.kind === 'vehicle' && shot.otherMass > 0 && shot.otherMass < 1100);
}

/** Sim-seconds until this panel burns out. Faster hits shred sooner; the struck side goes first. */
function detonateAt(part: string, shot: WreckShot): number {
  const role = roleOf(part);
  let t =
    role === 'nose' ? 0.14
    : role === 'hood' ? 0.32
    : role === 'side' ? 0.4
    : role === 'wheel' ? (part[0] === 'F' ? 0.24 : 0.9)
    : role === 'door' ? 0.58
    : role === 'roof' ? 0.75
    : role === 'trunk' ? 1.05
    : 1.32;
  t *= 1 - shot.violence * 0.3;
  if (struckOf(part, shot)) t *= 0.62;
  if (heavy(shot) && role === 'nose') t *= 0.7;
  if (spear(shot) && role === 'cabin') t += 0.28;
  if (!heavy(shot) && role === 'trunk') t += 0.15;
  return Math.max(0.08, t * (0.9 + hash(part, shot.seq) * 0.2));
}

/** Launch in car space (+x left, +y up, +z forward), then into the world. */
function kick(part: string, shot: WreckShot, q: THREE.Quaternion, out: THREE.Vector3): void {
  const v = shot.violence;
  const j = hash(part, shot.seq);
  const role = roleOf(part);
  const side = sideOf(part);
  const strike = Math.sign(shot.side || shot.glance || 1) || 1;
  const struck = struckOf(part, shot);
  const rebound = heavy(shot) ? 1 : spear(shot) ? -0.55 : clamp(shot.otherMass / 4000, 0.15, 0.75);
  const along = -(6 + v * 8) * Math.max(0, rebound) + (spear(shot) ? 9 + v * 8 : 0) + (j - 0.5) * 2;
  const lateral = (side || strike * 0.25) * ((struck ? 6.5 : 2.4) + v * 3) + shot.glance * 0.12 * (1.15 - shot.align);
  const up = (role === 'roof' || role === 'hood' || role === 'nose' ? 8 : role === 'wheel' ? 5 : 4.5) + v * 3.5 + (heavy(shot) ? 1.5 : 0) + j * 1.5;
  const nosePush = role === 'nose' || role === 'hood' || role === 'side' ? -3.5 * Math.max(0, rebound) : 0;
  out.set(lateral, up, along + nosePush);
  if (shot.align < 0.95 && struck) out.z += (1 - shot.align) * (6 + v * 4);
  out.applyQuaternion(q);
}

function spinFor(part: string, shot: WreckShot, out: THREE.Vector3): void {
  const v = shot.violence;
  const j = hash(part + 's', shot.seq) - 0.5;
  const role = roleOf(part);
  const strike = Math.sign(shot.side || shot.glance || 1) || 1;
  const side = sideOf(part) || strike;
  const rate = role === 'hood' || role === 'trunk' ? 14 : role === 'wheel' ? 26 : role === 'door' ? 11 : role === 'nose' ? 9 : 4.5;
  out.set(rate * (0.55 + v * 0.45) * (0.75 + j), strike * (1.2 + (1 - shot.align) * 8) * (0.6 + v * 0.35) + j * 2, side * (role === 'door' ? 8 : 2.8) * (0.6 + v));
}

function fadeMat(mat: THREE.Material, u: number): void {
  const m = mat as THREE.MeshStandardMaterial;
  if (u > 0 && !m.transparent) {
    m.transparent = true;
    m.depthWrite = false;
    m.needsUpdate = true;
  }
  m.opacity = 1 - u;
  if (m.emissive) {
    m.emissive.setHex(0xff4a12);
    m.emissiveIntensity = (1 - u) * 2.8;
  }
}

function sliceBody(src: THREE.BufferGeometry, idOf: (x: number, y: number, z: number) => string): Map<string, THREE.BufferGeometry> {
  const pos = src.getAttribute('position');
  if (!pos) return new Map();
  const index = src.index;
  const vert = (n: number) => (index ? index.getX(n) : n);
  const triCount = index ? index.count : pos.count;
  const names = Object.keys(src.attributes);
  const buckets = new Map<string, number[]>();
  for (let i = 0; i + 2 < triCount; i += 3) {
    const ia = vert(i);
    const ib = vert(i + 1);
    const ic = vert(i + 2);
    const x = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3;
    const y = (pos.getY(ia) + pos.getY(ib) + pos.getY(ic)) / 3;
    const z = (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3;
    const id = idOf(x, y, z);
    let list = buckets.get(id);
    if (!list) buckets.set(id, (list = []));
    list.push(ia, ib, ic);
  }
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [id, idxs] of buckets) {
    const g = new THREE.BufferGeometry();
    for (const name of names) {
      const a = src.getAttribute(name);
      const arr = new Float32Array(idxs.length * a.itemSize);
      for (let k = 0; k < idxs.length; k++) {
        for (let c = 0; c < a.itemSize; c++) arr[k * a.itemSize + c] = a.getComponent(idxs[k]!, c);
      }
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    out.set(id, g);
  }
  return out;
}

function partId(bb: THREE.Box3): (x: number, y: number, z: number) => string {
  const z0 = bb.min.z;
  const z1 = bb.max.z;
  const y0 = bb.min.y;
  const y1 = bb.max.y;
  const hx = Math.max(Math.abs(bb.min.x), bb.max.x, 0.001);
  return (x, y, z) => {
    const u = (z - z0) / (z1 - z0 || 1);
    const v = (y - y0) / (y1 - y0 || 1);
    const s = x / hx;
    if (u > 0.82) return 'nose';
    if (u < 0.16) return 'trunk';
    if (v > 0.72 && u > 0.28 && u < 0.78) return 'roof';
    if (u > 0.58 && v > 0.32 && Math.abs(s) < 0.62) return 'hood';
    if (s > 0.22 && u > 0.42) return 'fenderL';
    if (s < -0.22 && u > 0.42) return 'fenderR';
    if (s > 0.18 && u > 0.2) return 'doorL';
    if (s < -0.18 && u > 0.2) return 'doorR';
    return 'cabin';
  };
}

const FLAME = [0xfff1d0, 0xff7a18, 0xff3a10, 0xffc14a, 0xff5508, 0xffe08a];

export class WreckView implements ViewSystem {
  private holder: THREE.Group | null = null;
  private shards: Shard[] = [];
  private flames: Flame[] = [];
  private blasts: Blast[] = [];
  private ownGeos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private light: THREE.PointLight | null = null;
  private ring: THREE.Mesh | null = null;
  private built = -1;
  private lastT = 0;
  private dir = { x: 0, z: 1 };
  private readonly q = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly spinE = new THREE.Euler(0, 0, 0, 'XYZ');
  private readonly spinQ = new THREE.Quaternion();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private wreck: Wreck,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private effects: Effects,
    private groundAt: (x: number, z: number) => number,
  ) {}

  sync(_alpha: number, _dt: number): void {
    const shot = this.wreck.shot;
    if (!shot || !this.wreck.playing) {
      if (this.holder) this.clear();
      return;
    }
    if (this.built !== shot.seq) this.build(shot);
    const dt = Math.min(0.05, Math.max(0, this.wreck.animT - this.lastT));
    this.lastT = this.wreck.animT;
    if (dt > 0) this.step(shot, dt);
    else this.present(shot);
  }

  /** Orbit the breakup. Call after `sync` so the pieces have moved. */
  aim(cam: THREE.PerspectiveCamera): void {
    const shot = this.wreck.shot;
    if (!shot || this.shards.length === 0) return;
    const t = this.wreck.animT;
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (const s of this.shards) {
      if (!s.group.visible) continue;
      x += s.group.position.x;
      y += s.group.position.y;
      z += s.group.position.z;
      n++;
    }
    if (n === 0) {
      x = shot.pos.x;
      y = shot.y + 0.6;
      z = shot.pos.z;
    } else {
      x /= n;
      y /= n;
      z /= n;
    }
    const lead = spear(shot) ? Math.min(2.4, t * 1.6) : 0;
    x += Math.sin(shot.yaw) * lead;
    z += Math.cos(shot.yaw) * lead;
    // Stay on the open side of the hit. The normal points from the obstacle toward the car, which on a
    // head-on into a building is back down the lane — orbiting the other way puts the lens inside the block.
    const side = Math.sign(shot.side || shot.glance || 1) || 1;
    const nx = shot.normal.x;
    const nz = shot.normal.z;
    const dist = 8.2 + t * (1.15 + shot.violence * 0.7);
    const lateral = (2.4 + (1 - shot.align) * 2.2) * side;
    const height = (shot.kind === 'prop' ? 4.2 : 3.1) + t * 0.9;
    const shake = Math.exp(-t * 1.3) * (0.22 + shot.violence * 0.35);
    cam.up.set(0, 1, 0);
    cam.position.set(
      x + nx * dist + -nz * lateral + (Math.random() - 0.5) * shake,
      this.groundAt(x, z) + height + (Math.random() - 0.5) * shake * 0.4,
      z + nz * dist + nx * lateral + (Math.random() - 0.5) * shake,
    );
    const floor = this.groundAt(cam.position.x, cam.position.z) + 0.7;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(x, y + 0.45, z);
    cam.fov = (shot.kind === 'wall' ? 46 : 51) + Math.exp(-t * 2.2) * (5 + shot.violence * 7);
    cam.near = 0.25;
    cam.updateProjectionMatrix();
  }

  private build(shot: WreckShot): void {
    this.clear();
    const parts = buildCarParts(shot.style, shot.color, shot.detail);
    const holder = new THREE.Group();
    this.holder = holder;
    this.scene.add(holder);
    this.euler.set(-shot.pitch, shot.yaw, shot.roll, 'YXZ');
    this.q.setFromEuler(this.euler);
    const n = shot.normal;
    this.dir = shot.kind === 'prop' ? { x: -n.x, z: -n.z } : { x: n.x, z: n.z };

    parts.body.computeBoundingBox();
    const idOf = partId(parts.body.boundingBox ?? new THREE.Box3());
    for (const [name, geo] of sliceBody(parts.body, idOf)) {
      this.addShard(name, geo, carMaterial({ roughness: 0.32, metalness: 0.45 }), true, shot, true, null);
    }
    const head = new THREE.MeshBasicMaterial({ color: 0xfff6e4, toneMapped: false });
    const tail = new THREE.MeshBasicMaterial({ color: 0xbf1208, toneMapped: false });
    this.addShard('lampsF', parts.front.clone(), head, true, shot, true, null);
    this.addShard('lampsR', parts.rear.clone(), tail, true, shot, true, null);
    const r = parts.wheelRadius;
    const wheels = ['FL', 'FR', 'RL', 'RR'] as const;
    parts.wheelPos.forEach((wp, i) => {
      const left = wp[0] < 0;
      const scale = new THREE.Vector3(left ? -r : r, r, r);
      const mat = carMaterial({ roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
      this.addShard(wheels[i] ?? 'FL', wheelGeometry(), mat, false, shot, false, scale, new THREE.Vector3(wp[0], wp[1], wp[2]));
    });

    const power = (shot.kind === 'prop' ? 0.55 : shot.kind === 'wall' ? 1.2 : 0.95) * (0.8 + shot.violence * 0.6);
    this.blasts = [];
    if (shot.kind !== 'prop') this.blasts.push({ t: 0.22, power: power * 0.7, done: false });
    if (shot.kind === 'vehicle') this.blasts.push({ t: 0.48, power: power * (shot.otherMass >= 2000 ? 1 : 0.55), done: false });
    this.effects.explosion(shot.at, shot.y + 0.6, power, this.dir);

    const plane = new THREE.PlaneGeometry(1, 1);
    this.ownGeos.push(plane);
    const count = shot.kind === 'prop' ? 3 : 6;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: sharedGlow(),
        color: FLAME[i % FLAME.length],
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      this.mats.push(mat);
      const mesh = new THREE.Mesh(plane, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      holder.add(mesh);
      this.flames.push({ mesh, mat, phase: i * 0.55 });
    }
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff7722,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.mats.push(ringMat);
    const ringGeo = new THREE.RingGeometry(0.55, 0.85, 40);
    this.ownGeos.push(ringGeo);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.frustumCulled = false;
    holder.add(ring);
    this.ring = ring;
    const light = new THREE.PointLight(0xff6a22, 0, 26, 2);
    holder.add(light);
    this.light = light;
    this.built = shot.seq;
    this.lastT = this.wreck.animT;
    this.present(shot);
  }

  private addShard(
    name: string,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    ownGeo: boolean,
    shot: WreckShot,
    recenter: boolean,
    scale: THREE.Vector3 | null,
    at?: THREE.Vector3,
  ): void {
    const holder = this.holder;
    if (!holder) return;
    if (ownGeo) this.ownGeos.push(geo);
    this.mats.push(mat);
    const local = at ? at.clone() : new THREE.Vector3();
    if (recenter) {
      geo.computeBoundingBox();
      geo.boundingBox?.getCenter(local);
      geo.translate(-local.x, -local.y, -local.z);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    if (scale) mesh.scale.copy(scale);
    const group = new THREE.Group();
    group.add(mesh);
    const world = local.clone().applyQuaternion(this.q);
    group.position.set(shot.pos.x + world.x, shot.y + world.y, shot.pos.z + world.z);
    group.quaternion.copy(this.q);
    if (world.lengthSq() > 0.04) group.position.add(world.normalize().multiplyScalar(0.07 + shot.violence * 0.04));
    holder.add(group);
    const vel = new THREE.Vector3();
    const spin = new THREE.Vector3();
    kick(name, shot, this.q, vel);
    spinFor(name, shot, spin);
    this.shards.push({ group, vel, spin, detonate: detonateAt(name, shot), popped: false, bounced: false, mats: [mat] });
  }

  private step(shot: WreckShot, dt: number): void {
    const t = this.wreck.animT;
    for (const b of this.blasts) {
      if (!b.done && t >= b.t) {
        b.done = true;
        this.effects.explosion(shot.at, shot.y + 0.55, b.power, this.dir);
      }
    }
    for (const s of this.shards) {
      if (!s.group.visible) continue;
      s.vel.y -= 5.5 * dt;
      s.vel.x *= Math.exp(-0.12 * dt);
      s.vel.z *= Math.exp(-0.12 * dt);
      s.group.position.addScaledVector(s.vel, dt);
      this.spinE.set(s.spin.x * dt, s.spin.y * dt, s.spin.z * dt);
      this.spinQ.setFromEuler(this.spinE);
      s.group.quaternion.multiply(this.spinQ);
      s.spin.multiplyScalar(Math.exp(-0.25 * dt));
      const gy = this.groundAt(s.group.position.x, s.group.position.z);
      if (s.group.position.y < gy) {
        s.group.position.y = gy;
        if (s.vel.y < 0) {
          if (!s.bounced) {
            s.bounced = true;
            this.effects.sparksAt({ x: s.group.position.x, z: s.group.position.z }, 0.35, gy + 0.4);
          }
          s.vel.y *= -0.3;
          s.vel.x *= 0.72;
          s.vel.z *= 0.72;
          s.spin.multiplyScalar(0.55);
        }
      }
      if (!s.popped && t >= s.detonate) {
        s.popped = true;
        s.vel.y += 4 + shot.violence * 5;
        this.tmp.set(s.group.position.x - shot.pos.x, 0.4, s.group.position.z - shot.pos.z);
        if (this.tmp.lengthSq() > 0.01) s.vel.add(this.tmp.normalize().multiplyScalar(3 + shot.violence * 3));
        this.effects.explosion({ x: s.group.position.x, z: s.group.position.z }, s.group.position.y + 0.3, 0.4 + shot.violence * 0.3, this.dir);
      }
      if (s.popped) {
        const u = Math.min(1, (t - s.detonate) / 0.36);
        s.group.scale.setScalar(Math.max(0.001, 1 - u * u));
        for (const m of s.mats) fadeMat(m, u);
        if (u >= 1) s.group.visible = false;
      }
    }
    this.present(shot);
  }

  private present(shot: WreckShot): void {
    const t = this.wreck.animT;
    const spread = shot.kind === 'prop' ? 0.55 : 1;
    for (const f of this.flames) {
      const life = Math.max(0, 1 - t / (1.25 + shot.violence * 0.35));
      const grow = (1.1 + f.phase * 0.28) * (0.45 + t * (1.8 + shot.violence)) * spread;
      f.mesh.scale.setScalar(Math.max(0.01, grow));
      f.mesh.position.set(
        shot.at.x + this.dir.x * t * 2.2,
        shot.y + 0.7 + t * 1.3 + Math.sin(t * 18 + f.phase) * 0.15,
        shot.at.z + this.dir.z * t * 2.2,
      );
      f.mesh.lookAt(this.camera.position);
      f.mat.opacity = life * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 28 + f.phase)));
      f.mesh.visible = life > 0.03;
    }
    if (this.ring) {
      const rs = (0.4 + t * (7 + shot.violence * 5)) * (shot.kind === 'prop' ? 0.65 : 1);
      this.ring.position.set(shot.at.x, this.groundAt(shot.at.x, shot.at.z) + 0.16, shot.at.z);
      this.ring.scale.set(rs, rs, rs);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.75 * (1 - t / 0.5));
      this.ring.visible = t < 0.5;
    }
    if (this.light) {
      let flash = Math.exp(-t * 0.9);
      for (const s of this.shards) if (s.popped && t - s.detonate < 0.15) flash += 0.4;
      this.light.intensity = (shot.kind === 'prop' ? 160 : 420) * (0.65 + shot.violence * 0.5) * flash * (0.75 + 0.25 * Math.sin(t * 45));
      this.light.position.set(shot.at.x + this.dir.x * t, shot.y + 1.1 + t * 0.35, shot.at.z + this.dir.z * t);
    }
  }

  private clear(): void {
    if (this.holder) this.scene.remove(this.holder);
    for (const g of this.ownGeos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.holder = null;
    this.shards = [];
    this.flames = [];
    this.blasts = [];
    this.ownGeos = [];
    this.mats = [];
    this.light = null;
    this.ring = null;
    this.built = -1;
  }
}
