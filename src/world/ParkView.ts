import * as THREE from 'three';
import { Rng } from '../core/Rng';
import type { AABB, Vec2 } from '../types';
import type { CityPark } from './Features';
import type { CityModel } from './RoadGraph';
import { sharedGlow } from './textures';
import { LOOK } from '../render/Look';
import { lawnSnowMaterial } from './SnowCover';
import { winterCrown } from './StreetProps';

/**
 * Gardens: trees, lamps, lanterns, benches, a plowed road's snowbanks and a few drifts on the lawn.
 * The snow and the road themselves are cut in `RoadMesh`.
 */
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Matrix4 =>
  new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);

const UP = new THREE.Vector3(0, 1, 0);

export function buildParks(city: CityModel, scene: THREE.Scene): void {
  const parks = city.features.parks ?? [];
  if (!parks.length) return;
  const H = (x: number, z: number) => city.terrain.heightAt(x, z);

  const trunks: THREE.Matrix4[] = [];
  const blossom: THREE.Matrix4[] = [];
  const blossomCol: THREE.Color[] = [];
  const pines: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const globes: THREE.Matrix4[] = [];
  const pools: THREE.Matrix4[] = [];
  const poolCol: THREE.Color[] = [];
  const stone: THREE.Matrix4[] = [];
  const paper: THREE.Matrix4[] = [];
  const roofs: THREE.Matrix4[] = [];
  const wood: THREE.Matrix4[] = [];
  const drifts: THREE.Matrix4[] = [];
  const ice: THREE.Matrix4[] = [];
  const pinks = [0xf2a6c8, 0xe58cb4, 0xf7c4d8].map((c) => new THREE.Color(c));
  const rng = new Rng(77);
  const lampGlow = new THREE.Color(0.3, 0.24, 0.16);
  const lanternGlow = new THREE.Color(0.55, 0.3, 0.12);
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  const poolAt = (x: number, z: number, size: number, c: THREE.Color) => {
    pools.push(new THREE.Matrix4().compose(new THREE.Vector3(x, H(x, z) + 0.06, z), flat, new THREE.Vector3(size, size, 1)));
    poolCol.push(c);
  };

  for (const park of parks) {
    for (const tr of park.trees) {
      const y = H(tr.pos.x, tr.pos.z);
      trunks.push(box(0.35, tr.pink ? 3.2 : 2.4, 0.35, tr.pos.x, y + (tr.pink ? 1.6 : 1.2), tr.pos.z));
      if (tr.pink) {
        for (let b = 0; b < 3; b++) {
          const r = rng.range(1.4, 2.1) * (tr.r / 3);
          blossom.push(box(r, r * 0.75, r, tr.pos.x + rng.range(-1, 1), y + rng.range(3.1, 4.2), tr.pos.z + rng.range(-1, 1)));
          const pink = rng.pick(pinks);
          blossomCol.push(LOOK.day ? winterCrown(true, pink) : pink);
        }
      } else {
        for (const [oy, s] of [
          [3.2, 1],
          [5.0, 0.72],
          [6.5, 0.45],
        ] as const) {
          pines.push(box(tr.r * s, 2.4, tr.r * s, tr.pos.x, y + oy, tr.pos.z));
        }
      }
    }
    for (const p of park.lamps) {
      const y = H(p.x, p.z);
      posts.push(box(0.14, 4.4, 0.14, p.x, y + 2.2, p.z));
      globes.push(box(0.5, 0.5, 0.5, p.x, y + 4.6, p.z));
      poolAt(p.x, p.z, 14, lampGlow);
    }
    for (const p of park.lanterns) {
      const y = H(p.x, p.z);
      stone.push(box(0.8, 0.3, 0.8, p.x, y + 0.15, p.z), box(0.32, 1.0, 0.32, p.x, y + 0.8, p.z), box(0.75, 0.15, 0.75, p.x, y + 1.37, p.z));
      paper.push(box(0.5, 0.45, 0.5, p.x, y + 1.67, p.z));
      roofs.push(new THREE.Matrix4().makeScale(0.55, 0.4, 0.55).setPosition(p.x, y + 2.05, p.z));
      poolAt(p.x, p.z, 6, lanternGlow);
    }
    for (const b of park.benches) wood.push(...bench(b.pos, b.yaw, H(b.pos.x, b.pos.z)));
    const walks = [park.path, ...(park.paths ?? [])];
    drifts.push(...snowAlong(walks, H), ...snowMounds(park, walks, H, rng));
    const rink = iceRink(park, walks, H);
    if (rink) ice.push(rink);
    const mark = park.monument;
    if (mark) {
      const y = H(mark.pos.x, mark.pos.z);
      const { x, z } = mark.pos;
      if (mark.kind === 'column') {
        stone.push(box(1.7, 0.7, 1.7, x, y + 0.35, z), box(0.55, 4.4, 0.55, x, y + 2.9, z), box(1.15, 0.28, 1.15, x, y + 5.24, z));
      } else {
        stone.push(box(6.6, 0.1, 6.6, x, y + 0.05, z));
        const s = 2.35;
        for (const sx of [-s, s]) {
          for (const sz of [-s, s]) posts.push(box(0.22, 3.15, 0.22, x + sx, y + 1.58, z + sz));
        }
        roofs.push(new THREE.Matrix4().makeScale(7.4, 1.15, 7.4).setPosition(x, y + 3.2, z));
      }
    }
  }

  const unit = new THREE.BoxGeometry(1, 1, 1);
  add(scene, unit, new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.9 }), trunks);
  add(scene, new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, emissive: LOOK.day ? 0x000000 : 0x2a0c18 }), blossom, blossomCol);
  add(scene, new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ color: 0x24402c, roughness: 0.85 }), pines);
  add(scene, unit, new THREE.MeshStandardMaterial({ color: 0x24242c, roughness: 0.5, metalness: 0.6 }), posts);
  add(scene, new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.1, 1.4), toneMapped: false }), globes);
  add(scene, unit, new THREE.MeshStandardMaterial({ color: 0x8a8680, roughness: 0.9 }), stone);
  add(scene, unit, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.62, 0.2) }), paper);
  add(scene, hipRoof(), new THREE.MeshStandardMaterial({ color: 0x3a4248, roughness: 0.55, metalness: 0.3 }), roofs);
  add(scene, unit, new THREE.MeshStandardMaterial({ color: 0x6a4a32, roughness: 0.8 }), wood);
  const glow = add(
    scene,
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: sharedGlow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    pools,
    poolCol,
  );
  if (glow) glow.renderOrder = 1;
  add(scene, unit, lawnSnowMaterial(), drifts);
  if (ice.length) {
    const disc = new THREE.CircleGeometry(1, 20);
    disc.rotateX(-Math.PI / 2);
    add(
      scene,
      disc,
      new THREE.MeshStandardMaterial({ color: 0xc5d6de, roughness: 0.18, metalness: 0.2, emissive: new THREE.Color(0.04, 0.06, 0.08) }),
      ice,
    );
  }
}

function onWalk(p: Vec2, walks: AABB[], m: number): boolean {
  return walks.some((w) => p.x > w.minX - m && p.x < w.maxX + m && p.z > w.minZ - m && p.z < w.maxZ + m);
}

/** Low ridges just off the plowed road. Short enough that a car on the asphalt stays above them. */
function snowAlong(walks: AABB[], H: (x: number, z: number) => number): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  for (const path of walks) {
    const alongX = path.maxX - path.minX >= path.maxZ - path.minZ;
    const len = alongX ? path.maxX - path.minX : path.maxZ - path.minZ;
    const wide = alongX ? path.maxZ - path.minZ : path.maxX - path.minX;
    if (len < 10) continue;
    for (let t = 4; t < len - 4; t += 7) {
      for (const side of [-1, 1] as const) {
        const along = (alongX ? path.minX : path.minZ) + t;
        const mid = alongX ? (path.minZ + path.maxZ) / 2 : (path.minX + path.maxX) / 2;
        const across = mid + side * (wide / 2 + 0.85);
        const x = alongX ? along : across;
        const z = alongX ? across : along;
        if (walks.some((w) => w !== path && onWalk({ x, z }, [w], 0.3))) continue;
        const h = 0.2 + ((Math.floor(along) * 3) % 5) * 0.028;
        out.push(box(alongX ? 4.2 : 1.0, h, alongX ? 1.0 : 4.2, x, H(x, z) + h / 2, z));
      }
    }
  }
  return out;
}

/** Scattered drifts on the snow, kept off the road and away from a pavilion. */
function snowMounds(park: CityPark, walks: AABB[], H: (x: number, z: number) => number, rng: Rng): THREE.Matrix4[] {
  const lawn = park.lawn;
  const out: THREE.Matrix4[] = [];
  for (let x = lawn.minX + 6; x < lawn.maxX - 5; x += 15) {
    for (let z = lawn.minZ + 6; z < lawn.maxZ - 5; z += 15) {
      if (rng.chance(0.42)) continue;
      const p = { x: x + rng.range(-2, 2), z: z + rng.range(-2, 2) };
      if (p.x < lawn.minX + 2 || p.x > lawn.maxX - 2 || p.z < lawn.minZ + 2 || p.z > lawn.maxZ - 2) continue;
      if (onWalk(p, walks, 2.4)) continue;
      if (park.monument && Math.hypot(p.x - park.monument.pos.x, p.z - park.monument.pos.z) < 7) continue;
      const s = rng.range(1.4, 2.5);
      const h = rng.range(0.15, 0.3);
      out.push(box(s, h, s * rng.range(0.65, 1.15), p.x, H(p.x, p.z) + h / 2, p.z));
    }
  }
  return out;
}

/** A cleared outdoor rink in one quadrant, off the road. */
function iceRink(park: CityPark, walks: AABB[], H: (x: number, z: number) => number): THREE.Matrix4 | null {
  const lawn = park.lawn;
  if (lawn.maxX - lawn.minX < 42 || lawn.maxZ - lawn.minZ < 42) return null;
  const mx = (lawn.minX + lawn.maxX) / 2;
  const mz = (lawn.minZ + lawn.maxZ) / 2;
  const sx = park.monument && park.monument.pos.x > mx ? -1 : 1;
  const sz = park.monument && park.monument.pos.z > mz ? -1 : 1;
  const x = mx + sx * Math.min(14, (lawn.maxX - lawn.minX) * 0.22);
  const z = mz + sz * Math.min(14, (lawn.maxZ - lawn.minZ) * 0.22);
  const r = 6.2;
  if (x - r < lawn.minX + 2 || x + r > lawn.maxX - 2 || z - r < lawn.minZ + 2 || z + r > lawn.maxZ - 2) return null;
  if (onWalk({ x, z }, walks, r + 0.8)) return null;
  return new THREE.Matrix4().makeScale(r, 1, r).setPosition(x, H(x, z) + 0.045, z);
}

function bench(pos: Vec2, yaw: number, y: number): THREE.Matrix4[] {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  const at = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
    const o = new THREE.Vector3(lx, ly, lz).applyQuaternion(q);
    return new THREE.Matrix4().compose(new THREE.Vector3(pos.x + o.x, y + o.y, pos.z + o.z), q, new THREE.Vector3(sx, sy, sz));
  };
  return [at(0, 0.45, 0, 1.7, 0.08, 0.46), at(0, 0.72, -0.2, 1.7, 0.42, 0.06), at(-0.72, 0.24, 0, 0.08, 0.48, 0.4), at(0.72, 0.24, 0, 0.08, 0.48, 0.4)];
}

function hipRoof(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.15, Math.SQRT1_2, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  return g;
}

function add(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[]): THREE.InstancedMesh | null {
  if (!mats.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors?.length) colors.forEach((c, i) => im.setColorAt(i, c));
  scene.add(im);
  return im;
}
