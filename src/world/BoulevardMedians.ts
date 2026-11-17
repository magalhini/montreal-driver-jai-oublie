import * as THREE from 'three';
import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import type { AABB, RoadEdge } from '../types';
import type { Pothole } from './Potholes';
import type { CityModel } from './RoadGraph';
import { snowMaterial } from './SnowCover';
import { inDriveway } from './StreetProps';

/**
 * Planted islands down the middle of the long east-west boulevards (René-Lévesque most of all): a low
 * concrete curb with snow on it, a row of tall bare trees, and a yellow-and-black marker at each nose. They sit
 * on the painted double line mid-block, well clear of the junctions, so the lanes and every turn stay as they
 * are. Static colliders, like any curb you drive into.
 */
export const MEDIAN_TUNING = {
  /** Chance that a block of René-Lévesque, or of another east-west boulevard, gets an island. */
  boulevardShare: 0.7,
  otherShare: 0.35,
  /** The same for the north-south boulevards: Saint-Laurent, and the others (Peel, Robert-Bourassa, Berri...). */
  mainShare: 0.7,
  northSouthShare: 0.3,
  /** Island width (the double line's gap is 0.5 m: this eats a little into each inner lane) and curb height. */
  width: 1.1,
  height: 0.22,
  /** Island length range (m) and the gap kept to the junction boxes at each end. */
  length: [24, 46] as [number, number],
  endGap: 20,
  /** Trees along the island, about this far apart. */
  treeStep: 8,
};

/** Builds the islands and returns their colliders. Pits in the middle of the road push an island elsewhere. */
export function buildMedians(city: CityModel, scene: THREE.Scene, pits: readonly Pothole[], busy: ReadonlySet<number> = new Set()): AABB[] {
  const T = MEDIAN_TUNING;
  const colliders: AABB[] = [];
  const kit = new Kit();
  const half = T.width / 2;
  // East-west first, then north-south (Saint-Laurent and the like) from a stream of their own, so adding those
  // moved none of René-Lévesque's islands
  for (const axis of ['x', 'z'] as const) {
    const rng = new Rng(CONFIG.SEED ^ (axis === 'x' ? 0x3ed1a : 0x3ed1b));
    for (const e of city.edges) {
      if (e.cls !== 'boulevard' || e.axis !== axis || e.oneWay || e.name?.name === 'Sainte-Catherine') continue;
      const share = axis === 'x' ? (e.name?.generic === 'Boulevard' ? T.boulevardShare : T.otherShare) : e.name?.name === 'Saint-Laurent' ? T.mainShare : T.northSouthShare;
      // Rolled for every edge, so one edge's outcome does not reshuffle the rest
      const take = rng.chance(share);
      const len = rng.range(T.length[0], T.length[1]);
      const where = rng.next();
      const second = rng.chance(0.4);
      // Road works take the middle of the block (PRD Phase 7)
      if (!take || busy.has(e.id)) continue;
      const a = city.nodes[e.a];
      const b = city.nodes[e.b];
      // Along the road (u) and across it (the road's fixed coordinate)
      const ua = axis === 'x' ? a.pos.x : a.pos.z;
      const ub = axis === 'x' ? b.pos.x : b.pos.z;
      const ea = axis === 'x' ? a.hx : a.hz;
      const eb = axis === 'x' ? b.hx : b.hz;
      const u0 = Math.min(ua, ub) + (ua < ub ? ea : eb) + T.endGap;
      const u1 = Math.max(ua, ub) - (ua < ub ? eb : ea) - T.endGap;
      const fixed = axis === 'x' ? a.pos.z : a.pos.x;
      const room = u1 - u0;
      if (room < T.length[0]) continue;
      // One island on a normal block, two on a long one (with a gap for the left turns into the middle of it)
      const spans: [number, number][] = [];
      if (second && room > 2 * T.length[0] + 30) {
        const l = Math.min(len, (room - 30) / 2);
        spans.push([u0, u0 + l], [u1 - l, u1]);
      } else {
        const l = Math.min(len, room);
        const st = u0 + where * (room - l);
        spans.push([st, st + l]);
      }
      for (const [s0, s1] of spans) {
        if (!clear(city, e, pits, s0, s1, fixed, half, axis)) continue;
        kit.island(city, s0, s1, fixed, half, T.height, rng, axis);
        colliders.push(axis === 'x' ? { minX: s0, maxX: s1, minZ: fixed - half, maxZ: fixed + half } : { minX: fixed - half, maxX: fixed + half, minZ: s0, maxZ: s1 });
      }
    }
  }
  kit.build(scene);
  return colliders;
}

/** World point at `u` along a road on `axis` whose fixed coordinate is `fixed`, `c` across it. */
const P = (axis: 'x' | 'z', u: number, fixed: number, c = 0) => (axis === 'x' ? { x: u, z: fixed + c } : { x: fixed + c, z: u });

/** No driveway opening across from the island on either curb (left turns in) and no pothole under it. */
function clear(city: CityModel, e: RoadEdge, pits: readonly Pothole[], s0: number, s1: number, fixed: number, half: number, axis: 'x' | 'z'): boolean {
  const curb = e.width / 2 + 1;
  for (let u = s0 - 6; u <= s1 + 6; u += 2) {
    if (inDriveway(city, P(axis, u, fixed, -curb), 1) || inDriveway(city, P(axis, u, fixed, curb), 1)) return false;
  }
  for (const p of pits) {
    if (p.edge !== e.id) continue;
    const pu = axis === 'x' ? p.pos.x : p.pos.z;
    const pc = axis === 'x' ? p.pos.z : p.pos.x;
    if (Math.abs(pc - fixed) - p.r < half + 0.2 && pu + p.r > s0 - 1 && pu - p.r < s1 + 1) return false;
  }
  return true;
}

class Kit {
  private concrete: THREE.Matrix4[] = [];
  private noses: THREE.Matrix4[] = [];
  private snow: THREE.Matrix4[] = [];
  private snowNoses: THREE.Matrix4[] = [];
  private trunks: THREE.Matrix4[] = [];
  private limbs: THREE.Matrix4[] = [];
  private crowns: THREE.Matrix4[] = [];
  private crownCol: THREE.Color[] = [];
  private markers: THREE.Matrix4[] = [];
  private stripes: THREE.Matrix4[] = [];

  private lists(): THREE.Matrix4[][] {
    return [this.concrete, this.noses, this.snow, this.snowNoses, this.trunks, this.limbs, this.crowns, this.markers, this.stripes];
  }

  /**
   * One island from s0 to s1 along a road (x = s on east-west roads, z = s on north-south ones) whose fixed
   * coordinate is `z`: curb, rounded noses, snow, trees, markers. Built in the east-west frame; a north-south
   * island is then turned a quarter round onto its road.
   */
  island(city: CityModel, s0: number, s1: number, z: number, half: number, h: number, rng: Rng, axis: 'x' | 'z' = 'x'): void {
    if (axis === 'z') {
      // Local (u, y, -fixed) -> world (fixed, y, u): a quarter turn about Y (local +x to world +z)
      const marks = this.lists().map((l) => l.length);
      this.islandX(s0, s1, -z, half, h, rng, (u) => city.terrain.heightAt(z, u));
      const R = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
      this.lists().forEach((l, k) => {
        for (let i = marks[k]; i < l.length; i++) l[i].premultiply(R);
      });
      return;
    }
    this.islandX(s0, s1, z, half, h, rng, (u) => city.terrain.heightAt(u, z));
  }

  /** `ground(u)`: the road's height `u` along the island (the islands follow the hills, PRD Phase 7 relief). */
  private islandX(s0: number, s1: number, z: number, half: number, h: number, rng: Rng, ground: (u: number) => number): void {
    const len = s1 - s0;
    // The straight body stops a half width short of each end, where the rounded nose takes over. On a slope it is
    // a run of short pieces, each tilted to the grade under it (the curb sinks a little at their joints, not more).
    const b0 = s0 + half;
    const b1 = s1 - half;
    const pieces = Math.max(1, Math.ceil((b1 - b0) / 4));
    const step = (b1 - b0) / pieces;
    for (let k = 0; k < pieces; k++) {
      const a = b0 + k * step;
      const ya = ground(a);
      const yb = ground(a + step);
      const pitch = Math.atan2(yb - ya, step);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch);
      const c = a + step / 2;
      const yc = (ya + yb) / 2;
      const L = step / Math.cos(pitch) + 0.05;
      this.concrete.push(new THREE.Matrix4().compose(new THREE.Vector3(c, yc + h / 2, z), q, new THREE.Vector3(L, h, 2 * half)));
      this.snow.push(new THREE.Matrix4().compose(new THREE.Vector3(c, yc + h + 0.03, z), q, new THREE.Vector3(L - 0.05, 0.08, 2 * half - 0.22)));
    }
    for (const [x, dir] of [[s0 + half, -1], [s1 - half, 1]] as const) {
      const y = ground(x);
      this.noses.push(new THREE.Matrix4().makeScale(half, h, half).setPosition(x, y + h / 2, z));
      this.snowNoses.push(new THREE.Matrix4().makeScale(half - 0.11, 0.08, half - 0.11).setPosition(x, y + h + 0.03, z));
      // Yellow-and-black marker on the nose, facing the oncoming lanes
      const mx = x + dir * 0.05;
      this.markers.push(new THREE.Matrix4().makeScale(0.08, 0.7, 0.08).setPosition(mx, y + h + 0.35, z));
      this.markers.push(new THREE.Matrix4().makeScale(0.06, 0.62, 0.42).setPosition(mx, y + h + 1.0, z));
      for (let k = 0; k < 3; k++) {
        this.stripes.push(new THREE.Matrix4().makeScale(0.08, 0.09, 0.43).setPosition(mx, y + h + 0.79 + k * 0.2, z));
      }
    }
    // Trees down the middle, the ends left to the markers
    const n = Math.max(2, Math.round((len - 6) / MEDIAN_TUNING.treeStep));
    for (let i = 0; i < n; i++) {
      const x = s0 + 3 + ((i + 0.5) / n) * (len - 6) + rng.range(-0.8, 0.8);
      this.tree(x, ground(x) + h, z, rng);
    }
  }

  /** A tall bare tree: its crown starts well above a truck's roof and spreads over the inner lanes. */
  private tree(x: number, y: number, z: number, rng: Rng): void {
    const s = rng.range(0.9, 1.15);
    const trunk = 4.6 * s;
    this.trunks.push(new THREE.Matrix4().makeScale(0.28, trunk, 0.28).setPosition(x, y + trunk / 2, z));
    // A few limbs angled up and out from the top of the trunk
    const limbs = rng.int(3, 4);
    const turn = rng.range(0, Math.PI * 2);
    for (let k = 0; k < limbs; k++) {
      const a = turn + (k / limbs) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const tilt = rng.range(0.5, 0.8);
      const l = rng.range(1.6, 2.2) * s;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
      const o = new THREE.Vector3(0, l / 2, 0).applyQuaternion(q);
      this.limbs.push(new THREE.Matrix4().compose(new THREE.Vector3(x + o.x, y + trunk - 0.3 + o.y, z + o.z), q, new THREE.Vector3(0.13, l, 0.13)));
    }
    // Twig clumps, some with snow caught in them
    const n = rng.int(4, 6);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const rr = k === 0 ? 0 : rng.range(0.9, 1.5) * s;
      const cs = (k === 0 ? 1.4 : rng.range(0.85, 1.15)) * s;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), 0));
      const cy = y + trunk + (k === 0 ? 1.4 : rng.range(0.6, 1.4)) * s;
      this.crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(a) * rr, cy, z + Math.sin(a) * rr), q, new THREE.Vector3(cs * 1.15, cs * 0.8, cs * 1.15)));
      this.crownCol.push(rng.chance(0.55) ? new THREE.Color().setHSL(0.6, 0.06, rng.range(0.55, 0.7)) : new THREE.Color().setHSL(0.07, 0.14, rng.range(0.07, 0.12)));
    }
  }

  build(scene: THREE.Scene): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const disc = new THREE.CylinderGeometry(1, 1, 1, 16);
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9d9b95, roughness: 0.85 });
    add(scene, box, concrete, this.concrete);
    add(scene, disc, concrete, this.noses);
    const snow = snowMaterial();
    add(scene, box, snow, this.snow);
    add(scene, disc, snow, this.snowNoses);
    const bark = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.9 });
    add(scene, box, bark, this.trunks);
    add(scene, box, bark, this.limbs);
    add(scene, new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), this.crowns, this.crownCol);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0xf2c418, roughness: 0.5, emissive: 0x2a2000 }), this.markers);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }), this.stripes);
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

