import * as THREE from 'three';
import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import type { AABB, Facing, Vec2 } from '../types';
import { AVIATION, buildingBase } from './BuildingDetails';
import type { CityModel } from './RoadGraph';

type M = THREE.Matrix4;
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number): M =>
  new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: M[], colors?: THREE.Color[]): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  im.count = mats.length;
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
  return im;
}

const NORMALS: Record<Facing, Vec2> = { N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } };

export function buildStreetProps(city: CityModel, scene: THREE.Scene): AABB[] {
  const rng = new Rng(CONFIG.SEED ^ 0xabc);
  const colliders: AABB[] = [];
  const t = city.terrain;
  const Y = (q: Vec2) => t.surfaceY(q.x, q.z);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.translate(0, 0.5, 0);
  const centerBox = new THREE.BoxGeometry(1, 1, 1);

  const upoles: M[] = [];
  const wirePts: number[] = [];
  const trunks: M[] = [];
  const leaves: M[] = [];
  const leafCol: THREE.Color[] = [];
  const addCol = (x: number, z: number, r: number) => colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });

  const sideDistrict = (p: Vec2) => city.blockAt(p)?.district;
  const blocked = (p: Vec2) => inDriveway(city, p, 0.6);

  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    const alongX = e.axis === 'x';
    const aExt = alongX ? a.hx : a.hz;
    const bExt = alongX ? b.hx : b.hz;
    const t0 = (alongX ? a.pos.x : a.pos.z) + aExt + 9;
    const t1 = (alongX ? b.pos.x : b.pos.z) - bExt - 9;
    const fixed = alongX ? a.pos.z : a.pos.x;
    const hw = e.width / 2;
    const P = (t: number, lat: number): Vec2 => (alongX ? { x: t, z: fixed + lat } : { x: fixed + lat, z: t });
    const midT = (t0 + t1) / 2;
    const dPlus = sideDistrict(P(midT, hw + 2));
    const dMinus = sideDistrict(P(midT, -hw - 2));

    // Utility poles + wires + sakura trees on residential / shotengai sides (street lamps: StreetLamps)
    for (const s of [1, -1]) {
      const dist = s === 1 ? dPlus : dMinus;
      if (!e.avenue && (dist === 'residential' || dist === 'shotengai')) {
        let prev: Vec2 | null = null;
        let prevY = 0;
        for (let t = t0 + 13; t <= t1; t += 34) {
          const p = P(t, s * (hw + 1.1));
          if (blocked(p)) continue; // the wires span the gap
          const py = Y(p);
          upoles.push(box(0.3, 9, 0.3, p.x, py, p.z));
          addCol(p.x, p.z, 0.3);
          if (prev) {
            for (const hgt of [8.6, 8.1, 7.6]) {
              const segs = 6;
              for (let k = 0; k < segs; k++) {
                const u0 = k / segs;
                const u1 = (k + 1) / segs;
                const sag = (u: number) => -1.1 * 4 * u * (1 - u);
                const yy = (u: number) => prevY + (py - prevY) * u + hgt + sag(u);
                wirePts.push(
                  prev.x + (p.x - prev.x) * u0, yy(u0), prev.z + (p.z - prev.z) * u0,
                  prev.x + (p.x - prev.x) * u1, yy(u1), prev.z + (p.z - prev.z) * u1,
                );
              }
            }
          }
          prev = p;
          prevY = py;
        }
      }
      if (dist === 'residential' && rng.chance(0.6)) {
        for (let t = t0 + 6; t <= t1; t += rng.range(14, 22)) {
          const p = P(t, s * (hw + 1.0));
          // a tree in a driveway is still rolled (same random sequence for the rest), then dropped
          const mark = [trunks.length, leaves.length, leafCol.length];
          const drop = blocked(p);
          const sc = rng.range(0.85, 1.3);
          const H = Y(p);
          trunks.push(box(0.3, 2.6 * sc, 0.3, p.x, H, p.z));
          // A crown of overlapping clumps: sakura (pink) or zelkova (dark green)
          const sakura = rng.chance(0.55);
          const nClumps = rng.int(4, 6);
          for (let k = 0; k < nClumps; k++) {
            const a = (k / nClumps) * Math.PI * 2 + rng.range(-0.4, 0.4);
            const rr = k === 0 ? 0 : rng.range(0.7, 1.2) * sc;
            const cs = (k === 0 ? 1.3 : rng.range(0.75, 1.05)) * sc;
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), 0));
            leaves.push(
              new THREE.Matrix4().compose(
                new THREE.Vector3(p.x + Math.cos(a) * rr, H + (k === 0 ? 3.6 : rng.range(2.9, 3.6)) * sc, p.z + Math.sin(a) * rr),
                q,
                new THREE.Vector3(cs * 1.15, cs * 0.85, cs * 1.15),
              ),
            );
            leafCol.push(
              sakura
                ? new THREE.Color().setHSL(rng.range(0.9, 0.97), rng.range(0.45, 0.7), rng.range(0.55, 0.75))
                : new THREE.Color().setHSL(rng.range(0.25, 0.36), rng.range(0.35, 0.5), rng.range(0.12, 0.2)),
            );
          }
          if (drop) {
            trunks.length = mark[0];
            leaves.length = mark[1];
            leafCol.length = mark[2];
          } else addCol(p.x, p.z, 0.3);
        }
      }
    }
  }

  scene.add(instanced(unitBox, new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 0.9 }), upoles));
  const wires = new THREE.BufferGeometry();
  wires.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  scene.add(new THREE.LineSegments(wires, new THREE.LineBasicMaterial({ color: 0x050508 })));
  scene.add(instanced(unitBox, new THREE.MeshStandardMaterial({ color: 0x3b2a22, roughness: 0.9 }), trunks));
  scene.add(
    instanced(
      new THREE.IcosahedronGeometry(1, 1),
      leafMaterial(),
      leaves,
      leafCol,
    ),
  );

  buildShopfrontProps(city, scene, rng, colliders, unitBox, centerBox);
  buildHarbor(city, scene, rng, colliders, unitBox);
  return colliders;
}

/** Foliage glows faintly in its own (instance) color, like trees lit from below by the street. */
function leafMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance += vColor.rgb * vColor.rgb * 0.22;\n#endif',
    );
  };
  return m;
}

function buildShopfrontProps(city: CityModel, scene: THREE.Scene, rng: Rng, colliders: AABB[], unitBox: THREE.BufferGeometry, centerBox: THREE.BufferGeometry): void {
  const vend: M[] = [];
  const vendFront: M[] = [];
  const vendCol: THREE.Color[] = [];
  const lanterns: M[] = [];
  const lanternCol: THREE.Color[] = [];
  const VEND = [new THREE.Color(1.5, 1.6, 1.9), new THREE.Color(1.9, 0.4, 0.4), new THREE.Color(0.4, 1.0, 1.9), new THREE.Color(1.8, 1.5, 0.5)];
  for (const b of city.buildings) {
    if (b.district !== 'shotengai' && b.district !== 'residential') continue;
    for (const f of b.faces) {
      const n = NORMALS[f];
      const along = f === 'N' || f === 'S';
      const len = along ? b.maxX - b.minX : b.maxZ - b.minZ;
      const at = (s: number, out: number): Vec2 => {
        if (f === 'N') return { x: b.minX + len * s, z: b.minZ - out };
        if (f === 'S') return { x: b.minX + len * s, z: b.maxZ + out };
        if (f === 'E') return { x: b.maxX + out, z: b.minZ + len * s };
        return { x: b.minX - out, z: b.minZ + len * s };
      };
      if (rng.chance(b.district === 'shotengai' ? 0.35 : 0.2) && len > 3) {
        const p = at(rng.range(0.2, 0.8), 0.42);
        const color = rng.pick(VEND);
        const sx = along ? 1.0 : 0.75;
        const sz = along ? 0.75 : 1.0;
        if (!inDriveway(city, p, 0.8)) {
          const H = city.terrain.surfaceY(p.x, p.z);
          vend.push(box(sx, 1.85, sz, p.x, H, p.z));
          const fp = { x: p.x + n.x * 0.39, z: p.z + n.z * 0.39 };
          vendFront.push(box(along ? 0.85 : 0.04, 1.3, along ? 0.04 : 0.85, fp.x, H + 1.05, fp.z));
          vendCol.push(color);
          colliders.push({ minX: p.x - sx / 2, maxX: p.x + sx / 2, minZ: p.z - sz / 2, maxZ: p.z + sz / 2 });
        }
      }
      if (b.district === 'shotengai') {
        const nL = Math.max(1, Math.floor(len / 3.5));
        const red = rng.chance(0.7);
        for (let k = 0; k < nL; k++) {
          const p = at((k + 0.5) / nL, 0.7);
          lanterns.push(new THREE.Matrix4().makeScale(0.42, 0.62, 0.42).setPosition(p.x, buildingBase(b).floor + 2.75, p.z));
          lanternCol.push(red ? new THREE.Color(2.1, 0.22, 0.12) : new THREE.Color(1.9, 1.6, 1.1));
        }
      }
    }
  }
  scene.add(instanced(unitBox, new THREE.MeshStandardMaterial({ color: 0x30303a, roughness: 0.5 }), vend));
  scene.add(instanced(centerBox, new THREE.MeshBasicMaterial({ color: 0xffffff }), vendFront, vendCol));
  scene.add(instanced(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), lanterns, lanternCol));
}

function buildHarbor(city: CityModel, scene: THREE.Scene, rng: Rng, colliders: AABB[], unitBox: THREE.BufferGeometry): void {
  const H = CONFIG.CURB_HEIGHT;
  const sw = CONFIG.SIDEWALK;
  const cont: M[] = [];
  const contCol: THREE.Color[] = [];
  const COLORS = [0x8a2b1e, 0x1e4f8a, 0x2a6b3a, 0xc4651d, 0x55585f, 0x7a1e5c].map((c) => new THREE.Color(c));
  const hit = (r: AABB, b: AABB, m: number) => r.minX < b.maxX + m && r.maxX > b.minX - m && r.minZ < b.maxZ + m && r.maxZ > b.minZ - m;
  const overlaps = (r: AABB) => city.buildings.some((b) => hit(r, b, 1)) || city.features.driveways.some((q) => hit(r, q, 6));
  for (const bl of city.blocks) {
    if (bl.district !== 'harbor') continue;
    for (let x = bl.min.x + sw + 2; x < bl.max.x - sw - 7; x += 7.5) {
      for (let z = bl.min.z + sw + 2; z < bl.max.z - sw - 3; z += 3.4) {
        const r = { minX: x, maxX: x + 6.1, minZ: z, maxZ: z + 2.5 };
        if (overlaps(r) || rng.chance(0.25)) continue;
        const stack = rng.int(1, 3);
        for (let s = 0; s < stack; s++) {
          cont.push(box(6.1, 2.6, 2.5, x + 3.05, H + s * 2.6, z + 1.25));
          contCol.push(rng.pick(COLORS));
        }
        colliders.push({ ...r, top: H + stack * 2.6 });
      }
    }
  }
  scene.add(instanced(unitBox, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.3 }), cont, contCol));

  // Gantry cranes on the quay
  const legs: M[] = [];
  const reds: M[] = [];
  const x0 = city.xs[0];
  const x1 = city.xs[city.nx - 1];
  const wz = city.waterZ;
  const cranes = Math.max(4, Math.round((x1 - x0) / 220));
  for (let k = 0; k < cranes; k++) {
    const x = x0 + ((k + 0.5) / cranes) * (x1 - x0) + rng.range(-20, 20);
    legs.push(box(1.4, 34, 1.4, x - 6, H, wz - 2), box(1.4, 34, 1.4, x + 6, H, wz - 2));
    legs.push(box(1.4, 34, 1.4, x - 6, -1, wz + 14), box(1.4, 34, 1.4, x + 6, -1, wz + 14));
    legs.push(box(14, 2.4, 2, x, H + 30, wz - 2), box(14, 2.4, 2, x, H + 30, wz + 14));
    legs.push(box(3, 2.6, 60, x, H + 33, wz + 10));
    reds.push(new THREE.Matrix4().makeScale(0.6, 0.6, 0.6).setPosition(x, H + 36.5, wz + 38));
    colliders.push({ minX: x - 6.7, maxX: x - 5.3, minZ: wz - 2.7, maxZ: wz - 1.3 }, { minX: x + 5.3, maxX: x + 6.7, minZ: wz - 2.7, maxZ: wz - 1.3 });
  }
  const crane = new THREE.MeshStandardMaterial({ color: 0xc28a1e, roughness: 0.6, metalness: 0.4 });
  scene.add(instanced(unitBox, crane, legs));
  scene.add(instanced(new THREE.SphereGeometry(1, 8, 6), AVIATION, reds));

  // Quay railing
  const posts: M[] = [];
  for (let x = city.bounds.minX; x < city.bounds.maxX; x += 2.5) posts.push(box(0.12, 1.0, 0.12, x, H, wz - 0.3));
  posts.push(box(city.bounds.maxX - city.bounds.minX, 0.1, 0.12, (city.bounds.minX + city.bounds.maxX) / 2, H + 1.0, wz - 0.3));
  scene.add(instanced(unitBox, new THREE.MeshStandardMaterial({ color: 0x8a8a95, metalness: 0.7, roughness: 0.3 }), posts));
}

/** Within `margin` of a driveway or an alley (keep lamps, poles, trees and vending machines out of them). */
export function inDriveway(city: CityModel, p: Vec2, margin: number): boolean {
  const near = (d: AABB) => p.x > d.minX - margin && p.x < d.maxX + margin && p.z > d.minZ - margin && p.z < d.maxZ + margin;
  return city.features.driveways.some(near) || city.features.alleys.some((a) => near(a.box));
}
