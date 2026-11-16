import * as THREE from 'three';
import { Rng } from '../core/Rng';
import type { Vec2 } from '../types';
import type { CityModel } from './RoadGraph';
import { SurfaceBuilder } from './SurfaceBuilder';
import { sharedGlow } from './textures';
import { LOOK } from '../render/Look';
import { winterCrown } from './StreetProps';

/**
 * Gardens (`maps/montreal/Parks.ts`): gravel path, cherry trees and pines, lamp posts, stone lanterns and
 * benches. The same pieces as the shrine park and the lookout. The lawn itself is the grass cut in `RoadMesh`.
 */
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Matrix4 =>
  new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);

const UP = new THREE.Vector3(0, 1, 0);

export function buildParks(city: CityModel, scene: THREE.Scene): void {
  const parks = city.features.parks ?? [];
  if (!parks.length) return;
  const H = (x: number, z: number) => city.terrain.heightAt(x, z);

  const gravel = new SurfaceBuilder(H, 1 / 3);
  for (const p of parks) gravel.patch(p.path.minX, p.path.minZ, p.path.maxX, p.path.maxZ, 0.02, 3);
  scene.add(gravel.mesh(new THREE.MeshStandardMaterial({ color: 0xb0aca4, map: gravelTexture(), roughness: 0.95 })));

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

function gravelTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rng = new Rng(33);
  g.fillStyle = '#8e8a84';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1800; i++) {
    const v = Math.round(rng.range(100, 190));
    g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
    g.fillRect(rng.range(0, 128), rng.range(0, 128), rng.range(1, 3), rng.range(1, 3));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function add(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[]): THREE.InstancedMesh | null {
  if (!mats.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors?.length) colors.forEach((c, i) => im.setColorAt(i, c));
  scene.add(im);
  return im;
}
