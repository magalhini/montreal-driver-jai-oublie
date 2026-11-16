import * as THREE from 'three';
import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import type { AABB, Building, Vec2 } from '../types';
import type { CityModel } from './RoadGraph';
import { snowMaterial } from './SnowCover';
import { inDriveway } from './StreetProps';

/** Cobble sidewalk dressing (PRD Phase 5), meters from the curb unless noted. */
export const OLD_CITY_TUNING = {
  /** Trees in grates near the curb, about this far apart. */
  treeStep: 15,
  treeLat: 1.1,
  /** Keep this clear of lamp posts and street corners. */
  lampClear: 2.6,
  /** Share of the gaps between trees that get a bike rack, and bikes per rack. */
  rackShare: 0.45,
  bikes: [1, 3] as [number, number],
  /** Share of the shop fronts that put a winter terrace out (tables against the facade, a low fence). */
  terraceShare: 0.3,
  terraceDepth: 1.2,
};

/**
 * Vieux-Montréal and the Quartier latin's cobbles get the life of the old city on their sidewalks: bare trees,
 * bikes locked to racks, and a few terraces out against the shop fronts (December: snow on the tables, nobody
 * sitting). Lamps are the globe lamps (`StreetLamps`); their posts are passed in so nothing stands on them.
 * Returns the colliders.
 */
export function buildOldCity(city: CityModel, scene: THREE.Scene, lamps: Vec2[]): AABB[] {
  const T = OLD_CITY_TUNING;
  const rng = new Rng(CONFIG.SEED ^ 0x0c0b);
  const sw = CONFIG.SIDEWALK;
  const Y = (p: Vec2) => city.terrain.surfaceY(p.x, p.z);
  const colliders: AABB[] = [];
  const kit = new Kit();
  const nearLamp = (p: Vec2) => lamps.some((q) => Math.abs(q.x - p.x) < T.lampClear && Math.abs(q.z - p.z) < T.lampClear);
  const blocked = (p: Vec2, m: number) => inDriveway(city, p, m) || nearLamp(p);
  // Buildings along the cobbles, for the terraces (a facade must be there)
  const cobbles = city.edges.filter((e) => e.cls === 'cobble');
  const near = city.buildings.filter((b) => !b.custom && b.faces.length > 0);
  const facadeAt = (p: Vec2): Building | undefined => near.find((b) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ);

  for (const e of cobbles) {
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    const alongX = e.axis === 'x';
    const t0 = (alongX ? a.pos.x : a.pos.z) + (alongX ? a.hx : a.hz) + 8;
    const t1 = (alongX ? b.pos.x : b.pos.z) - (alongX ? b.hx : b.hz) - 8;
    const fixed = alongX ? a.pos.z : a.pos.x;
    const hw = e.width / 2;
    const P = (t: number, lat: number): Vec2 => (alongX ? { x: t, z: fixed + lat } : { x: fixed + lat, z: t });
    const yawAlong = alongX ? Math.PI / 2 : 0;

    for (const s of [1, -1]) {
      // Trees, with racks in some of the gaps
      for (let t = t0 + rng.range(2, 6); t < t1; t += T.treeStep + rng.range(-2, 2)) {
        const p = P(t, s * (hw + T.treeLat));
        if (!blocked(p, 1.2)) {
          kit.tree(p, Y(p), rng);
          colliders.push(post(p, 0.3));
        }
        const rt = t + T.treeStep / 2;
        if (rt < t1 && rng.chance(T.rackShare)) {
          const q = P(rt, s * (hw + 1.0));
          if (!blocked(q, 2)) {
            const n = rng.int(T.bikes[0], T.bikes[1]);
            kit.rack(q, Y(q), yawAlong, n, rng);
            colliders.push(alongX ? { minX: q.x - 1.6, maxX: q.x + 1.6, minZ: q.z - 0.5, maxZ: q.z + 0.5 } : { minX: q.x - 0.5, maxX: q.x + 0.5, minZ: q.z - 1.6, maxZ: q.z + 1.6 });
          }
        }
      }
      // Terraces against the shop fronts
      for (let t = t0 + 6; t < t1 - 8; t += rng.range(18, 30)) {
        const len = rng.range(5, 8);
        const mid = t + len / 2;
        const back = P(mid, s * (hw + sw + 2));
        const p = P(mid, s * (hw + sw - T.terraceDepth / 2));
        const ends = [P(t, s * (hw + sw - 0.6)), P(t + len, s * (hw + sw - 0.6))];
        if (!rng.chance(T.terraceShare) || !facadeAt(back) || ends.some((q) => inDriveway(city, q, 1.5))) continue;
        kit.terrace(p, Y(p), alongX, s, len, T.terraceDepth, rng);
        const hx = alongX ? len / 2 : T.terraceDepth / 2;
        const hz = alongX ? T.terraceDepth / 2 : len / 2;
        colliders.push({ minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz });
      }
    }
  }
  kit.build(scene);
  return colliders;
}

const post = (p: Vec2, r: number): AABB => ({ minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r });
const UP = new THREE.Vector3(0, 1, 0);
const BIKE_COLORS = [0x1c3a6a, 0x8a1e22, 0x1a1a1e, 0x2a5a3a, 0xc8c4bc, 0x6a6e74, 0xd07a1e].map((c) => new THREE.Color(c));

class Kit {
  private trunks: THREE.Matrix4[] = [];
  private crowns: THREE.Matrix4[] = [];
  private crownCol: THREE.Color[] = [];
  private grates: THREE.Matrix4[] = [];
  private iron: THREE.Matrix4[] = [];
  private wheels: THREE.Matrix4[] = [];
  private frames: THREE.Matrix4[] = [];
  private frameCol: THREE.Color[] = [];
  private tops: THREE.Matrix4[] = [];
  private snow: THREE.Matrix4[] = [];
  private canvas: THREE.Matrix4[] = [];

  /** Part of something turned `yaw` about its own (x, y, z), local offsets (lx, ly, lz), scale (sx, sy, sz). */
  private part(list: THREE.Matrix4[], x: number, y: number, z: number, yaw: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, roll = 0): void {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
    const o = new THREE.Vector3(lx, ly, lz).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x + o.x, y + o.y, z + o.z), q, new THREE.Vector3(sx, sy, sz)));
  }

  tree(p: Vec2, y: number, rng: Rng): void {
    const s = rng.range(0.8, 1.1);
    this.grates.push(new THREE.Matrix4().makeScale(1.2, 0.03, 1.2).setPosition(p.x, y + 0.015, p.z));
    this.trunks.push(new THREE.Matrix4().makeScale(0.26, 3.2 * s, 0.26).setPosition(p.x, y + 1.6 * s, p.z));
    const n = rng.int(3, 5);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const rr = k === 0 ? 0 : rng.range(0.6, 1.0) * s;
      const cs = (k === 0 ? 1.2 : rng.range(0.7, 0.95)) * s;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), 0));
      this.crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + Math.cos(a) * rr, y + (k === 0 ? 4.0 : rng.range(3.4, 4.2)) * s, p.z + Math.sin(a) * rr), q, new THREE.Vector3(cs * 1.15, cs * 0.85, cs * 1.15)));
      this.crownCol.push(rng.chance(0.3) ? new THREE.Color().setHSL(0.6, 0.06, rng.range(0.42, 0.55)) : new THREE.Color().setHSL(0.07, 0.14, rng.range(0.07, 0.12)));
    }
  }

  /** An inverted-U hoop rack along the curb, `n` bikes locked to it side by side (local +Z along the curb). */
  rack(p: Vec2, y: number, yaw: number, n: number, rng: Rng): void {
    for (const lz of [-1.3, 1.3]) {
      this.part(this.iron, p.x, y, p.z, yaw, 0, 0.45, lz, 0.06, 0.9, 0.06);
    }
    this.part(this.iron, p.x, y, p.z, yaw, 0, 0.9, 0, 0.06, 0.06, 2.66);
    for (let k = 0; k < n; k++) {
      // Bikes stand across the rack, nose to the road or the shops, leaning on it
      const lz = (k - (n - 1) / 2) * 0.75;
      const dir = rng.chance(0.5) ? 1 : -1;
      const lean = rng.range(-0.06, 0.06);
      const bx = (lx: number) => lx * dir;
      const color = rng.pick(BIKE_COLORS);
      // The bike's long axis is the rack frame's local X
      const by = yaw;
      for (const wx of [-0.52, 0.52]) this.part(this.wheels, p.x, y, p.z, yaw, bx(wx), 0.34, lz, 1, 1, 1, lean);
      // Frame: top tube, down tube, seat stay, fork, seat post; then the saddle and the bars
      const frame = (lx: number, ly: number, len: number, tilt: number) => {
        const q = new THREE.Quaternion().setFromAxisAngle(UP, by).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt * dir));
        const o = new THREE.Vector3(bx(lx), ly, lz).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
        this.frames.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + o.x, y + o.y, p.z + o.z), q, new THREE.Vector3(len, 0.045, 0.045)));
        this.frameCol.push(color);
      };
      frame(0, 0.72, 0.72, 0);
      frame(-0.02, 0.52, 0.78, 0.62);
      frame(-0.36, 0.52, 0.5, -0.9);
      frame(0.46, 0.55, 0.5, 1.15);
      frame(-0.24, 0.62, 0.42, 1.4);
      this.part(this.iron, p.x, y, p.z, yaw, bx(-0.3), 0.86, lz, 0.24, 0.05, 0.1);
      this.part(this.iron, p.x, y, p.z, yaw, bx(0.42), 0.92, lz, 0.05, 0.05, 0.5);
    }
  }

  /** Tables against the facade, two chairs each, a low black fence on the walk side, one furled umbrella. */
  terrace(p: Vec2, y: number, alongX: boolean, side: number, len: number, depth: number, rng: Rng): void {
    const yaw = alongX ? 0 : Math.PI / 2;
    const fenceOff = side * (depth / 2 - 0.05);
    const at = (along: number, lat: number): Vec2 => (alongX ? { x: p.x + along, z: p.z + lat } : { x: p.x + lat, z: p.z + along });
    // Fence: posts and a rail on the walk side, short returns at the ends
    for (let k = -len / 2; k <= len / 2 + 0.01; k += len / Math.max(2, Math.round(len / 1.4))) {
      const q = at(k, -fenceOff);
      this.iron.push(new THREE.Matrix4().makeScale(0.05, 0.85, 0.05).setPosition(q.x, y + 0.42, q.z));
    }
    const rail = at(0, -fenceOff);
    this.iron.push(new THREE.Matrix4().makeScale(alongX ? len : 0.05, 0.05, alongX ? 0.05 : len).setPosition(rail.x, y + 0.85, rail.z));
    this.iron.push(new THREE.Matrix4().makeScale(alongX ? len : 0.04, 0.04, alongX ? 0.04 : len).setPosition(rail.x, y + 0.4, rail.z));
    // Canvas skirt on the fence (the café's colour)
    const cloth = new THREE.Matrix4().makeScale(alongX ? len - 0.1 : 0.03, 0.42, alongX ? 0.03 : len - 0.1).setPosition(rail.x, y + 0.62, rail.z);
    this.canvas.push(cloth);
    const tables = Math.max(1, Math.floor(len / 2.2));
    for (let i = 0; i < tables; i++) {
      const along = -len / 2 + (i + 0.5) * (len / tables);
      const c = at(along, side * 0.1);
      this.iron.push(new THREE.Matrix4().makeScale(0.06, 0.72, 0.06).setPosition(c.x, y + 0.36, c.z));
      this.tops.push(new THREE.Matrix4().makeScale(0.32, 0.03, 0.32).setPosition(c.x, y + 0.73, c.z));
      this.snow.push(new THREE.Matrix4().makeScale(0.3, 0.05, 0.3).setPosition(c.x, y + 0.76, c.z));
      for (const s of [-1, 1]) {
        const ch = at(along + s * 0.55, side * 0.1);
        this.part(this.iron, ch.x, y, ch.z, yaw, 0, 0.45, 0, 0.4, 0.04, 0.4);
        this.part(this.iron, ch.x, y, ch.z, yaw + (s > 0 ? 0 : Math.PI), 0.2, 0.68, 0, 0.04, 0.46, 0.38);
        this.part(this.iron, ch.x, y, ch.z, yaw, 0, 0.22, 0, 0.36, 0.44, 0.04);
        this.snow.push(new THREE.Matrix4().makeScale(0.36, 0.04, 0.36).setPosition(ch.x, y + 0.49, ch.z));
      }
    }
    if (rng.chance(0.6)) {
      const u = at(0, side * 0.1);
      this.iron.push(new THREE.Matrix4().makeScale(0.05, 2.4, 0.05).setPosition(u.x, y + 1.2, u.z));
      this.canvas.push(new THREE.Matrix4().makeScale(0.22, 1.3, 0.22).setPosition(u.x, y + 1.9, u.z));
    }
  }

  build(scene: THREE.Scene): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.9 }), this.trunks);
    add(scene, new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), this.crowns, this.crownCol);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.7, metalness: 0.4 }), this.grates);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.5, metalness: 0.55 }), this.iron);
    // In its XY plane: the bike's long axis and up
    const wheel = new THREE.TorusGeometry(0.33, 0.025, 6, 18);
    add(scene, wheel, new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6 }), this.wheels);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5 }), this.frames, this.frameCol);
    add(scene, new THREE.CylinderGeometry(1, 1, 1, 14), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.6 }), this.tops);
    add(scene, new THREE.CylinderGeometry(1, 1, 1, 12), snowMaterial(), this.snow);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0x7a1e26, roughness: 0.85 }), this.canvas);
  }
}

function add(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[]): void {
  if (!mats.length) return;
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  colors?.forEach((c, i) => im.setColorAt(i, c));
  im.computeBoundingSphere();
  scene.add(im);
}
