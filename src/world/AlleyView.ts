import * as THREE from 'three';
import { Rng } from '../core/Rng';
import type { AABB, Building, Facing } from '../types';
import { ALLEY } from './Alleys';
import type { Alley } from './Features';
import { SIDE_OUT, solidParts } from './Interiors';
import type { CityModel } from './RoadGraph';
import { sharedGlow } from './textures';

/**
 * Alleys, passages and nooks (IMPROVEMENTS #19). Underpasses get a ceiling slab, tiled wall linings with a
 * colored stripe, fluorescent tubes with light pools on the floor and hazard-striped lintels over the
 * openings; nooks the same with one dim, greenish tube. Open alleys get wall lamps, plus
 * air-conditioner units on the walls. All
 * instanced: ~10 draw calls for the whole city.
 */

type M = THREE.Matrix4;
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number): M => new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/** Underpass stripe colors (tile band at waist height). */
const STRIPES = [0x2a7fc4, 0xc43a2a, 0x2a9c6a, 0xd9a21e, 0x8a4ac4].map((c) => new THREE.Color(c));
const TUBE = new THREE.Color(1.7, 1.8, 1.9);
const NOOK_TUBE = new THREE.Color(0.8, 1.25, 0.95);
const LAMP = new THREE.Color(2.0, 1.35, 0.7);

export function buildAlleys(city: CityModel, scene: THREE.Scene): void {
  const rng = new Rng(1919);
  const t = city.terrain;
  const f = city.features;
  const slabs: M[] = [];
  const linings: M[] = [];
  const liningCol: THREE.Color[] = [];
  const stripes: M[] = [];
  const stripeCol: THREE.Color[] = [];
  const tubes: M[] = [];
  const tubeCol: THREE.Color[] = [];
  const pools: M[] = [];
  const poolCol: THREE.Color[] = [];
  const lintels: M[] = [];
  const brackets: M[] = [];

  const pool = (x: number, z: number, size: number, c: THREE.Color) => {
    pools.push(new THREE.Matrix4().compose(new THREE.Vector3(x, t.heightAt(x, z) + 0.05, z), FLAT, new THREE.Vector3(size, size, 1)));
    poolCol.push(c);
  };

  // Covered floors: passages and nooks
  for (const r of f.interiors) {
    const b = r.box;
    const top = r.floor + r.height;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const nook = r.kind === 'nook';
    slabs.push(box(w, 0.22, d, cx, top - 0.22, cz));
    const tone = new THREE.Color().setScalar(rng.range(0.75, 1.0));
    const stripe = rng.pick(STRIPES);
    const hiFloor = top - ALLEY.clear;
    for (const side of ['N', 'S', 'E', 'W'] as Facing[]) {
      if (r.doors.some((q) => q.side === side)) continue;
      const wall = liningBox(b, side, 0.06);
      const ww = wall.maxX - wall.minX;
      const wd = wall.maxZ - wall.minZ;
      const wx = (wall.minX + wall.maxX) / 2;
      const wz = (wall.minZ + wall.maxZ) / 2;
      linings.push(box(ww, top - r.floor, wd, wx, r.floor - 0.2, wz));
      liningCol.push(tone);
      const sb = liningBox(b, side, 0.09);
      stripes.push(box(sb.maxX - sb.minX, 0.32, sb.maxZ - sb.minZ, wx, hiFloor + 0.95, wz));
      stripeCol.push(nook ? new THREE.Color(0x3a3a3a) : stripe);
    }
    // Tubes across the ceiling (along the drive for passages), one dim one in a nook
    const alongZ = r.doors[0].side === 'N' || r.doors[0].side === 'S';
    const len = alongZ ? d : w;
    const n = nook ? 1 : Math.max(1, Math.round(len / 4));
    for (let k = 0; k < n; k++) {
      const s = nook ? 0.6 : (k + 0.5) / n;
      // nooks: toward the back, away from the opening
      const door = r.doors[0].side;
      const u = nook && (door === 'S' || door === 'E') ? 1 - s : s;
      const x = alongZ ? cx : b.minX + w * u;
      const z = alongZ ? b.minZ + d * u : cz;
      const c = nook ? NOOK_TUBE : TUBE;
      tubes.push(alongZ ? box(Math.min(2.4, w * 0.45), 0.07, 0.14, x, top - 0.3, z) : box(0.14, 0.07, Math.min(2.4, d * 0.45), x, top - 0.3, z));
      tubeCol.push(c);
      pool(x, z, nook ? 4.5 : 5.5, nook ? new THREE.Color(0.08, 0.13, 0.1) : new THREE.Color(0.2, 0.21, 0.23));
    }
    // Hazard lintel over each opening, standing a little proud of the facade
    for (const q of r.doors) {
      const o = SIDE_OUT[q.side];
      const span = q.to - q.from;
      const mid = (q.from + q.to) / 2;
      const edge = q.side === 'N' ? b.minZ : q.side === 'S' ? b.maxZ : q.side === 'W' ? b.minX : b.maxX;
      const n0 = edge + (o.x + o.z) * 0.12;
      lintels.push(q.side === 'N' || q.side === 'S' ? box(span + 0.3, 0.38, 0.26, mid, top - 0.38, n0) : box(0.26, 0.38, span + 0.3, n0, top - 0.38, mid));
    }
  }

  // Open alleys: wall lamps where there are walls to hang them from, AC units on the walls
  for (const a of f.alleys) {
    const solids = blockSolids(city, a);
    const z = a.axis === 'z';
    const [l0, l1] = z ? [a.box.minZ, a.box.maxZ] : [a.box.minX, a.box.maxX];
    const [c0, c1] = z ? [a.box.minX, a.box.maxX] : [a.box.minZ, a.box.maxZ];
    const P = (along: number, acr: number) => (z ? { x: acr, z: along } : { x: along, z: acr });
    const inside = (along: number, acr: number) => {
      const p = P(along, acr);
      return solids.some((q) => p.x > q.minX && p.x < q.maxX && p.z > q.minZ && p.z < q.maxZ);
    };
    /** Across coordinate of the facade beside the lane on one side (-1 = before it, +1 = after), or null if none within 3 m. */
    const wall = (along: number, side: number): number | null => {
      const edge = side < 0 ? c0 : c1;
      for (let d = 0.25; d <= 3; d += 0.25) if (inside(along, edge + side * d)) return edge + side * (d - 0.25);
      return null;
    };
    const covered = (along: number) => {
      const p = P(along, (c0 + c1) / 2);
      return f.interiors.some((r) => p.x >= r.box.minX - 1 && p.x <= r.box.maxX + 1 && p.z >= r.box.minZ - 1 && p.z <= r.box.maxZ + 1);
    };
    const start = l0 + 9;
    const end = l1 - 9;
    let side = rng.sign();
    for (let s = start + rng.range(0, 4); s <= end; s += rng.range(10, 14)) {
      const sd = side;
      side = -side;
      const w = wall(s, sd);
      if (covered(s) || w === null) continue;
      const out = -sd;
      const p = P(s, w + out * 0.22);
      const y = t.heightAt(p.x, p.z) + 3.4;
      brackets.push(z ? box(0.44, 0.1, 0.14, p.x, y + 0.2, p.z) : box(0.14, 0.1, 0.44, p.x, y + 0.2, p.z));
      tubes.push(box(0.2, 0.2, 0.2, p.x + (z ? out * 0.12 : 0), y, p.z + (z ? 0 : out * 0.12)));
      tubeCol.push(LAMP);
      const g = P(s, w + out * 1.8);
      pool(g.x, g.z, 6, new THREE.Color(0.32, 0.2, 0.09));
    }
    // Air-conditioner units and their pipes up on the walls (above the car: no colliders)
    for (let s = start; s <= end; s += rng.range(4, 9)) {
      if (!rng.chance(0.55) || covered(s)) continue;
      const sd = rng.sign();
      const w = wall(s, sd);
      if (w === null) continue;
      const p = P(s, w - sd * 0.2);
      const y = t.heightAt(p.x, p.z) + rng.range(2.4, 5.5);
      brackets.push(z ? box(0.4, 0.6, 0.85, p.x, y, p.z) : box(0.85, 0.6, 0.4, p.x, y, p.z));
    }
  }

  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);
  const center = new THREE.BoxGeometry(1, 1, 1);
  add(scene, unit, new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.9 }), slabs);
  // No real lights under the roofs: the tubes' light on the walls is faked with emissive tiles
  const tileMap = tiles();
  add(scene, unit, new THREE.MeshStandardMaterial({ color: 0xb8b8bc, map: tileMap, emissive: 0x3c3e44, emissiveMap: tileMap, roughness: 0.35, metalness: 0.05 }), linings, liningCol);
  add(scene, unit, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222, roughness: 0.3, metalness: 0.05 }), stripes, stripeCol);
  add(scene, unit, new THREE.MeshStandardMaterial({ color: 0xffffff, map: hazard(), roughness: 0.6 }), lintels);
  add(scene, center, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), tubes, tubeCol);
  add(scene, center, new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.6, metalness: 0.5 }), brackets);
  const poolMesh = add(
    scene,
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: sharedGlow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    pools,
    poolCol,
  );
  poolMesh.renderOrder = 1;
}

function add(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, mats: M[], colors?: THREE.Color[]): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  im.count = mats.length;
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  colors?.forEach((c, i) => im.setColorAt(i, c));
  scene.add(im);
  return im;
}

/** Thin box lining the inside of a room wall (`t` thick). */
function liningBox(b: AABB, side: Facing, t: number): AABB {
  if (side === 'N') return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.minZ + t };
  if (side === 'S') return { minX: b.minX, maxX: b.maxX, minZ: b.maxZ - t, maxZ: b.maxZ };
  if (side === 'W') return { minX: b.minX, maxX: b.minX + t, minZ: b.minZ, maxZ: b.maxZ };
  return { minX: b.maxX - t, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
}

/** Solid building boxes on an alley's block. */
function blockSolids(city: CityModel, a: Alley): Building[] {
  const bl = city.blocks[a.block];
  return city.buildings
    .filter((b) => {
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      return cx > bl.min.x && cx < bl.max.x && cz > bl.min.z && cz < bl.max.z;
    })
    .flatMap(solidParts);
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Small glazed wall tiles (stretched per lining, so kept fine and even). */
function tiles(): THREE.CanvasTexture {
  const tex = canvasTexture(512, 256, (g) => {
    g.fillStyle = '#8e8e94';
    g.fillRect(0, 0, 512, 256);
    const rng = new Rng(77);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const v = Math.floor(rng.range(196, 226));
        g.fillStyle = `rgb(${v},${v},${v + 4})`;
        g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
      }
    }
    // grime toward the floor
    const grad = g.createLinearGradient(0, 256, 0, 150);
    grad.addColorStop(0, 'rgba(40,36,30,0.55)');
    grad.addColorStop(1, 'rgba(40,36,30,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
  });
  tex.repeat.set(4, 1);
  return tex;
}

/** Yellow and black chevrons for the clearance beams. */
function hazard(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 32, (g) => {
    g.fillStyle = '#e0b21c';
    g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#151515';
    for (let x = -32; x < 256 + 32; x += 32) {
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x + 16, 32);
      g.lineTo(x + 32, 0);
      g.lineTo(x + 16, 0);
      g.fill();
    }
  });
  tex.repeat.set(3, 1);
  return tex;
}
