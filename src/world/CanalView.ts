import * as THREE from 'three';
import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import type { CityModel } from './RoadGraph';
import type { Terrain } from './Terrain';
import { SurfaceBuilder } from './SurfaceBuilder';
import { sharedGlow, stoneTexture, waterNormalTexture } from './textures';

export interface CanalSet {
  update(time: number, dt: number): void;
}

const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);

/**
 * The canal: rippling water that mirrors the neon, stone quay walls with railings, arched stone bridges with
 * lamp posts, and lantern-lit yakatabune boats drifting under them.
 */
export function buildCanal(city: CityModel, scene: THREE.Scene): CanalSet | null {
  const k = city.features.canal;
  if (!k) return null;
  // The canal is a Tokyo (grid) feature: its terrain is the grid `Terrain`
  const t = city.terrain as Terrain;
  const sw = CONFIG.SIDEWALK;
  const curb = CONFIG.CURB_HEIGHT;
  const rng = new Rng(808);
  const nx = city.nx;

  // Water. Split the same way as the harbor: one long quad flashes black when the near plane cuts it.
  const normals = waterNormalTexture();
  const waterW = k.x1 - k.x0;
  const waterH = k.z1 - k.z0 + 1;
  const waterCell = 40;
  normals.repeat.set(waterW / 14, (k.z1 - k.z0) / 14);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(waterW, waterH, Math.max(1, Math.ceil(Math.abs(waterW) / waterCell)), Math.max(1, Math.ceil(Math.abs(waterH) / waterCell))),
    new THREE.MeshStandardMaterial({ color: 0x03060c, roughness: 0.06, metalness: 0.9, normalMap: normals, normalScale: new THREE.Vector2(0.35, 0.35) }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((k.x0 + k.x1) / 2, k.water, k.zc);
  scene.add(water);

  // Quay walls (whole length; bridges rest on them) with a coping stone on top
  const walls = new SurfaceBuilder((x, z) => t.heightAt(x, z), 0.5);
  const topAt = (x: number, z: number) => t.base(x, z) + t.hump(x, z) + curb;
  const bed = () => k.bed;
  walls.wall(k.x0, k.z0, k.x1, k.z0, { x: 0, z: 1 }, bed, (x) => topAt(x, k.z0 - 0.01), 3);
  walls.wall(k.x1, k.z1, k.x0, k.z1, { x: 0, z: -1 }, bed, (x) => topAt(x, k.z1 + 0.01), 3);
  const stone = stoneTexture();
  stone.repeat.set(0.5, 0.5);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a96a4, map: stone, roughness: 0.85, metalness: 0.05 });
  scene.add(walls.mesh(stoneMat));

  // Bridges: arched underside, fascia + parapets, lamp posts at the four corners
  const bridge = new SurfaceBuilder((x, z) => t.heightAt(x, z), 0.5);
  const half = (k.z1 - k.z0) / 2;
  const deck = (x: number, z: number) => t.base(x, z) + t.hump(x, z);
  const arch = (x: number, z: number) => {
    const u = Math.min(1, Math.abs(z - k.zc) / half);
    return k.water + (deck(x, z) - 0.9 - k.water) * Math.sqrt(Math.max(0, 1 - u * u));
  };
  const lampPosts: THREE.Matrix4[] = [];
  const lampHeads: THREE.Matrix4[] = [];
  const parapetTop = (x: number, z: number) => deck(x, z) + curb + 0.95;
  for (let i = 0; i < nx; i++) {
    const e = city.hwX[i] + sw;
    const xa = city.xs[i] - e;
    const xb = city.xs[i] + e;
    const archAt = (z: number) => arch(city.xs[i], z);
    // underside, under the whole deck width (including the parapets)
    const under = new SurfaceBuilder((_x, z) => archAt(z), 0.5);
    under.patch(xa - 0.35, k.z0, xb + 0.35, k.z1, 0, 1.5, undefined, true);
    scene.add(under.mesh(stoneMat));
    // Parapets along the hump: outer faces down to the arch over the water / the lot ground beyond
    const z0 = k.zc - k.humpHalf;
    const z1 = k.zc + k.humpHalf;
    const outerBottom = (side: number) => (x: number, z: number) => (z > k.z0 && z < k.z1 ? archAt(z) : t.base(x + side * 0.6, z));
    bridge.wall(xa - 0.35, z1, xa - 0.35, z0, { x: -1, z: 0 }, outerBottom(-1), parapetTop, 1.5);
    bridge.wall(xb + 0.35, z0, xb + 0.35, z1, { x: 1, z: 0 }, outerBottom(1), parapetTop, 1.5);
    bridge.wall(xa, z0, xa, z1, { x: 1, z: 0 }, (x, z) => deck(x, z) + curb, parapetTop, 1.5);
    bridge.wall(xb, z1, xb, z0, { x: -1, z: 0 }, (x, z) => deck(x, z) + curb, parapetTop, 1.5);
    const cap = new SurfaceBuilder((x, z) => parapetTop(x, z), 0.5);
    cap.patch(xa - 0.4, z0, xa + 0.05, z1, 0, 1.5);
    cap.patch(xb - 0.05, z0, xb + 0.4, z1, 0, 1.5);
    scene.add(cap.mesh(stoneMat));
    // Ends of the arch over the water (vertical faces at the quays are the quay walls)
    for (const [x, z] of [
      [xa - 0.2, k.z0 - 1.2],
      [xa - 0.2, k.z1 + 1.2],
      [xb + 0.2, k.z0 - 1.2],
      [xb + 0.2, k.z1 + 1.2],
    ]) {
      const y = parapetTop(x, z);
      lampPosts.push(box(0.28, 2.6, 0.28, x, y - 0.1, z));
      lampHeads.push(box(0.5, 0.65, 0.5, x, y + 2.75, z));
    }
  }
  scene.add(bridge.mesh(stoneMat));

  // Quay railings (gap at the canal jump)
  const posts: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  for (const w of city.walls) {
    if (w.top === undefined || w.maxX - w.minX < 1 || w.maxZ - w.minZ > 1) continue;
    const z = (w.minZ + w.maxZ) / 2;
    const y0 = t.base((w.minX + w.maxX) / 2, z) + curb;
    const len = w.maxX - w.minX;
    for (let x = w.minX + 0.5; x < w.maxX; x += 2.2) posts.push(box(0.08, 1.05, 0.08, x, y0, z));
    rails.push(box(len, 0.06, 0.06, (w.minX + w.maxX) / 2, y0 + 1.02, z), box(len, 0.05, 0.05, (w.minX + w.maxX) / 2, y0 + 0.55, z));
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2c34, roughness: 0.45, metalness: 0.7 });
  const im = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
    m.count = mats.length;
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    scene.add(m);
    return m;
  };
  im(unit, iron, [...posts, ...rails, ...lampPosts]);
  im(unit, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.45, 0.95) }), lampHeads);
  // lamp light on the water
  const glowMat = new THREE.MeshBasicMaterial({ map: sharedGlow(), color: new THREE.Color(0.5, 0.36, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  im(
    glowGeo,
    glowMat,
    lampHeads.map((m) => {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      return box(7, 1, 7, p.x, Math.max(k.water + 0.03, p.y - 30), p.z + (p.z < k.zc ? 2 : -2));
    }),
  ).renderOrder = 1;

  // Yakatabune: lantern-lit house boats drifting along the canal
  const boats = Array.from({ length: 4 }, (_, i) => ({ x: k.x0 + 400 + rng.range(0, k.x1 - k.x0 - 800), dir: i % 2 ? 1 : -1, speed: rng.range(1.2, 2.2), group: makeBoat(rng) }));
  for (const b of boats) {
    b.group.position.set(b.x, k.water, k.zc + b.dir * 2.4);
    b.group.rotation.y = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(b.group);
  }
  const span = k.x1 - k.x0 - 600;
  return {
    update(time: number, dt: number) {
      normals.offset.set(time * 0.006, time * 0.011);
      for (const b of boats) {
        b.x += b.dir * b.speed * dt;
        if (b.x > k.x1 - 300) b.x -= span;
        if (b.x < k.x0 + 300) b.x += span;
        b.group.position.x = b.x;
        b.group.position.y = k.water + Math.sin(time * 1.3 + b.x) * 0.04;
      }
    },
  };
}

function makeBoat(rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.7 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 11), wood);
  hull.position.y = 0.1;
  g.add(hull);
  const bow = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.7, 3, 1, false, 0, Math.PI), wood);
  bow.rotation.y = Math.PI / 2;
  bow.position.set(0, 0.1, 5.5);
  g.add(bow);
  // cabin with warm paper windows and a dark roof
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 1.3, 7.5),
    new THREE.MeshStandardMaterial({ color: 0x221510, emissive: new THREE.Color(1.0, 0.55, 0.22), emissiveIntensity: 0.55, roughness: 0.8 }),
  );
  cabin.position.y = 1.1;
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.18, 8.4), new THREE.MeshStandardMaterial({ color: 0x141018, roughness: 0.6 }));
  roof.position.y = 1.85;
  g.add(roof);
  // red lanterns along the eaves
  const lanternMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.25, 0.12) });
  const lg = new THREE.SphereGeometry(0.22, 8, 6);
  const n = 6;
  const lanterns = new THREE.InstancedMesh(lg, lanternMat, n * 2);
  let i = 0;
  for (const side of [-1, 1]) {
    for (let k = 0; k < n; k++) {
      lanterns.setMatrixAt(i++, new THREE.Matrix4().makeScale(1, 1.3, 1).setPosition(side * 1.42, 1.6, -3.6 + (7.2 * k) / (n - 1)));
    }
  }
  g.add(lanterns);
  g.scale.setScalar(rng.range(0.9, 1.1));
  return g;
}
