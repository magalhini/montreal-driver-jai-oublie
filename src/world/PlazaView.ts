import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import { LOOK } from '../render/Look';
import type { AABB, Vec2 } from '../types';
import type { PlazaDressing, PortClosure } from './Features';
import type { CityModel } from './RoadGraph';
import { lawnSnowMaterial, snowMaterial } from './SnowCover';
import { SurfaceBuilder } from './SurfaceBuilder';
import { pavingTextures } from './textures';

/**
 * Pedestrian squares and the Old Port promenade (PRD Phase 5): stone paving on the raised slab, snowy lawns,
 * fountains drained and iced over for December (Place d'Armes keeps its monument), bare trees in grates,
 * black globe lamps, benches, and the bay lines of the port's lot. The lot's asphalt is `RoadMesh`.
 */
export function buildPlazas(city: CityModel, scene: THREE.Scene): void {
  const f = city.features;
  const squares = f.squares ?? [];
  const port = f.port;
  if (!squares.length && !port) return;
  const t = city.terrain;
  const curb = CONFIG.CURB_HEIGHT;
  const H = (x: number, z: number) => t.heightAt(x, z);

  // Paving over the slab: the squares and the walk along the water
  const paving = new SurfaceBuilder(H);
  for (const s of squares) paving.patch(s.plaza.minX, s.plaza.minZ, s.plaza.maxX, s.plaza.maxZ, curb + 0.012, 4);
  if (port) paving.patch(port.walk.minX, port.walk.minZ, port.walk.maxX, port.walk.maxZ, curb + 0.012, 4);
  const pave = pavingTextures();
  pave.map.repeat.set(1 / 2.4, 1 / 2.4);
  pave.normalMap.repeat.set(1 / 2.4, 1 / 2.4);
  scene.add(paving.mesh(new THREE.MeshStandardMaterial({ color: 0xb4ada2, map: pave.map, normalMap: pave.normalMap, roughness: 0.75, metalness: 0.02 })));

  // Snow on the lawns of the squares and the port
  const lawnRects = [...squares.flatMap((s) => s.lawns), ...(port?.lawns ?? [])];
  if (lawnRects.length) {
    const lawns = new SurfaceBuilder(H);
    for (const l of lawnRects) lawns.patch(l.minX, l.minZ, l.maxX, l.maxZ, curb + 0.03, 4);
    const snow = LOOK.day ? lawnSnowMaterial().clone() : new THREE.MeshStandardMaterial({ color: 0x5e6e58, roughness: 0.95 });
    if (LOOK.day) {
      snow.polygonOffset = true;
      snow.polygonOffsetFactor = 1;
      snow.polygonOffsetUnits = 1;
    }
    scene.add(lawns.mesh(snow));
  }

  const dressing: PlazaDressing[] = [...squares, ...(port ? [port] : [])];
  const props = new Props(t.surfaceY.bind(t));
  for (const d of dressing) {
    for (const p of d.trees) props.tree(p);
    for (const p of d.lamps) props.lamp(p);
    for (const b of d.benches) props.bench(b.pos, b.yaw);
  }
  for (const s of squares) props.fountain(s.fountain.pos, s.fountain.r, s.monument);
  for (const p of port?.piers ?? []) props.pier(p.deck, p.shed, curb);
  if (port?.closure) {
    props.closure(port.closure);
    for (const bench of port.closure.benches) props.bench(bench.pos, bench.yaw);
  }
  if (port) props.bayLines(port.lot, f.parking, (x, z) => t.heightAt(x, z));
  props.build(scene);
}

const M = (sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);

class Props {
  private trunks: THREE.Matrix4[] = [];
  private crowns: THREE.Matrix4[] = [];
  private crownCol: THREE.Color[] = [];
  private grates: THREE.Matrix4[] = [];
  private poles: THREE.Matrix4[] = [];
  private globes: THREE.Matrix4[] = [];
  private wood: THREE.Matrix4[] = [];
  private iron: THREE.Matrix4[] = [];
  private paint: THREE.Matrix4[] = [];
  private stone: THREE.BufferGeometry[] = [];
  private ice: THREE.BufferGeometry[] = [];
  private bronze: THREE.BufferGeometry[] = [];
  private snow: THREE.BufferGeometry[] = [];
  private shed: THREE.BufferGeometry[] = [];
  private glass: THREE.BufferGeometry[] = [];
  private rng = new Rng(1642);

  constructor(private Y: (x: number, z: number) => number) {}

  /** A bare winter tree in a grate: twiggy clumps, a little snow caught on top. */
  tree(p: Vec2): void {
    const y = this.Y(p.x, p.z);
    const s = this.rng.range(0.8, 1.05);
    this.grates.push(M(1.4, 0.03, 1.4, p.x, y + 0.015, p.z));
    this.trunks.push(M(0.32, 3.4 * s, 0.32, p.x, y + 1.7 * s, p.z));
    const n = this.rng.int(4, 6);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + this.rng.range(-0.4, 0.4);
      const rr = k === 0 ? 0 : this.rng.range(0.8, 1.4) * s;
      const cs = (k === 0 ? 1.25 : this.rng.range(0.75, 1.0)) * s;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rng.range(0, 3), this.rng.range(0, 3), 0));
      this.crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + Math.cos(a) * rr, y + (k === 0 ? 4.4 : this.rng.range(3.6, 4.6)) * s, p.z + Math.sin(a) * rr), q, new THREE.Vector3(cs * 1.2, cs * 0.9, cs * 1.2)));
      const frost = this.rng.chance(0.35);
      this.crownCol.push(frost ? new THREE.Color().setHSL(0.6, 0.06, this.rng.range(0.42, 0.55)) : new THREE.Color().setHSL(0.07, 0.14, this.rng.range(0.07, 0.12)));
    }
  }

  /** Black post, glass globe on top. */
  lamp(p: Vec2): void {
    const y = this.Y(p.x, p.z);
    this.poles.push(M(0.16, 4.3, 0.16, p.x, y + 2.15, p.z), M(0.3, 0.22, 0.3, p.x, y + 4.25, p.z), M(0.34, 0.6, 0.34, p.x, y + 0.3, p.z));
    this.globes.push(M(0.34, 0.37, 0.34, p.x, y + 4.64, p.z));
  }

  /** Slatted bench on black iron legs; the seat faces local +Z (`yaw` like the parks). */
  bench(pos: Vec2, yaw: number): void {
    const y = this.Y(pos.x, pos.z);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const at = (list: THREE.Matrix4[], lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
      const o = new THREE.Vector3(lx, ly, lz).applyQuaternion(q);
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(pos.x + o.x, y + o.y, pos.z + o.z), q, new THREE.Vector3(sx, sy, sz)));
    };
    at(this.wood, 0, 0.45, 0, 1.8, 0.07, 0.48);
    at(this.wood, 0, 0.75, -0.22, 1.8, 0.36, 0.05);
    at(this.iron, -0.8, 0.24, 0, 0.07, 0.48, 0.46);
    at(this.iron, 0.8, 0.24, 0, 0.07, 0.48, 0.46);
  }

  /** Round basin (rim, iced water, snow on the rim) with a monument or a dry centre bowl. */
  fountain(c: Vec2, r: number, monument: boolean): void {
    const y = this.Y(c.x, c.z);
    const rim = 0.55;
    const wall = 0.65;
    const ring = (geo: THREE.BufferGeometry, list: THREE.BufferGeometry[], dy: number) => list.push(geo.translate(c.x, y + dy, c.z));
    ring(new THREE.CylinderGeometry(r, r + 0.1, wall, 40, 1, true).translate(0, wall / 2, 0), this.stone, 0);
    ring(new THREE.CylinderGeometry(r - rim, r - rim, wall, 40, 1, true).translate(0, wall / 2, 0), this.stone, 0);
    ring(new THREE.RingGeometry(r - rim, r + 0.05, 40).rotateX(-Math.PI / 2), this.stone, wall);
    ring(new THREE.RingGeometry(r - rim + 0.08, r - 0.08, 40).rotateX(-Math.PI / 2), this.snow, wall + 0.03);
    ring(new THREE.CircleGeometry(r - rim, 40).rotateX(-Math.PI / 2), this.ice, wall * 0.55);
    if (monument) {
      // Maisonneuve on his column, his companions at the corners of the plinth (bronze, gone green)
      ring(new THREE.BoxGeometry(4.2, 1.2, 4.2).translate(0, 0.6, 0), this.stone, 0);
      ring(new THREE.BoxGeometry(3, 3.2, 3).translate(0, 2.8, 0), this.stone, 0);
      ring(new THREE.BoxGeometry(2.4, 0.5, 2.4).translate(0, 4.65, 0), this.stone, 0);
      ring(new THREE.CylinderGeometry(0.8, 0.95, 3.4, 12).translate(0, 6.6, 0), this.stone, 0);
      ring(new THREE.BoxGeometry(1.9, 0.4, 1.9).translate(0, 8.5, 0), this.stone, 0);
      ring(new THREE.CylinderGeometry(0.3, 0.45, 2.0, 8).translate(0, 9.7, 0), this.bronze, 0);
      ring(new THREE.SphereGeometry(0.28, 10, 8).translate(0, 10.95, 0), this.bronze, 0);
      ring(new THREE.BoxGeometry(0.16, 1.4, 0.16).rotateZ(-0.5).translate(0.55, 10.5, 0), this.bronze, 0);
      ring(new THREE.BoxGeometry(0.1, 1.8, 0.1).rotateZ(0.15).translate(-0.5, 10.2, 0.2), this.bronze, 0);
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        ring(new THREE.CylinderGeometry(0.22, 0.32, 1.3, 8).translate(sx * 1.75, 1.85, sz * 1.75), this.bronze, 0);
        ring(new THREE.SphereGeometry(0.2, 8, 6).translate(sx * 1.75, 2.65, sz * 1.75), this.bronze, 0);
      }
      ring(new THREE.BoxGeometry(2.45, 0.12, 2.45).translate(0, 4.9, 0), this.snow, 0);
    } else {
      // A tiered bowl in the middle, the jets off until spring
      ring(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 12).translate(0, 0.8, 0), this.stone, 0);
      ring(new THREE.CylinderGeometry(2.2, 0.6, 0.6, 20).translate(0, 1.9, 0), this.stone, 0);
      ring(new THREE.CircleGeometry(2.05, 20).rotateX(-Math.PI / 2).translate(0, 2.21, 0), this.snow, 0);
      ring(new THREE.CylinderGeometry(0.25, 0.35, 1.1, 10).translate(0, 2.75, 0), this.stone, 0);
      ring(new THREE.CylinderGeometry(1.0, 0.3, 0.35, 16).translate(0, 3.4, 0), this.stone, 0);
    }
  }

  /**
   * The end of the promenade past the clock: a stone wall on the map edge, a low parapet along the water,
   * and a kiosk against the wall. Their boxes are the colliders.
   */
  closure(c: PortClosure): void {
    const block = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, h: number, list: THREE.BufferGeometry[], lift = 0) => {
      const x = (r.minX + r.maxX) / 2;
      const z = (r.minZ + r.maxZ) / 2;
      const y = this.Y(x, z) + lift;
      list.push(new THREE.BoxGeometry(r.maxX - r.minX, h, r.maxZ - r.minZ).translate(x, y + h / 2, z));
    };
    block(c.wall, c.wallH, this.stone);
    block(c.wall, 0.1, this.snow, c.wallH + 0.01);
    block(c.parapet, c.parapetH, this.stone);
    block(c.parapet, 0.08, this.snow, c.parapetH + 0.01);
    for (const k of c.kiosks) {
      const x = (k.minX + k.maxX) / 2;
      const z = (k.minZ + k.maxZ) / 2;
      const y = this.Y(x, z);
      const w = k.maxX - k.minX;
      const d = k.maxZ - k.minZ;
      this.stone.push(new THREE.BoxGeometry(w + 0.12, 0.16, d + 0.12).translate(x, y + 0.08, z));
      const bodyH = c.kioskH - 0.28;
      this.shed.push(new THREE.BoxGeometry(w, bodyH, d).translate(x, y + 0.16 + bodyH / 2, z));
      // Counter window toward the promenade (west)
      this.glass.push(new THREE.BoxGeometry(0.06, 1.15, d - 0.7).translate(k.minX - 0.02, y + 1.55, z));
      this.snow.push(new THREE.BoxGeometry(w + 0.35, 0.16, d + 0.35).translate(x, y + c.kioskH - 0.08, z));
    }
  }

  /** A quay deck standing out of the river and a long pale hangar with a snowy pitched roof. */
  pier(deck: AABB, shed: AABB, top: number): void {
    const b = (r: AABB, y0: number, y1: number) =>
      new THREE.BoxGeometry(r.maxX - r.minX, y1 - y0, r.maxZ - r.minZ).translate((r.minX + r.maxX) / 2, (y0 + y1) / 2, (r.minZ + r.maxZ) / 2);
    this.stone.push(b(deck, -3, top));
    const h = 8;
    this.shed.push(b(shed, top, top + h));
    const w = shed.maxX - shed.minX;
    const rise = 3;
    const half = w / 2 + 0.6;
    const ang = Math.atan2(rise, half);
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(Math.hypot(half, rise), 0.3, shed.maxZ - shed.minZ + 1);
      g.rotateZ(-s * ang);
      this.snow.push(g.translate((shed.minX + shed.maxX) / 2 + (s * half) / 2, top + h + rise / 2, (shed.minZ + shed.maxZ) / 2));
    }
    // Gable ends and a band of dark windows down each long side
    for (const z of [shed.minZ - 0.01, shed.maxZ + 0.01]) {
      const tri = new THREE.Shape();
      tri.moveTo(-w / 2, 0);
      tri.lineTo(w / 2, 0);
      tri.lineTo(0, rise);
      tri.closePath();
      this.shed.push(new THREE.ShapeGeometry(tri).translate((shed.minX + shed.maxX) / 2, top + h, z));
    }
    for (const x of [shed.minX - 0.05, shed.maxX + 0.05]) {
      this.glass.push(new THREE.BoxGeometry(0.05, 1.6, shed.maxZ - shed.minZ - 6).translate(x, top + 4.6, (shed.minZ + shed.maxZ) / 2));
    }
  }

  /** White lines between the lot's bays, and the aisle ends. */
  bayLines(lot: AABB, bays: { pos: Vec2; yaw: number }[], H: (x: number, z: number) => number): void {
    for (const b of bays) {
      if (b.pos.x < lot.minX || b.pos.x > lot.maxX || b.pos.z < lot.minZ || b.pos.z > lot.maxZ) continue;
      const y = H(b.pos.x, b.pos.z) + 0.025;
      this.paint.push(M(0.12, 0.01, 5.2, b.pos.x - 1.35, y, b.pos.z));
    }
  }

  build(scene: THREE.Scene): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const black = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.55, metalness: 0.5 });
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.9 }), this.trunks);
    add(scene, new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), this.crowns, this.crownCol);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.7, metalness: 0.4 }), this.grates);
    add(scene, box, black, this.poles);
    add(scene, new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: LOOK.day ? new THREE.Color(1.18, 1.0, 0.8) : new THREE.Color(2.6, 2.0, 1.3) }), this.globes);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0x5a3e2c, roughness: 0.8 }), this.wood);
    add(scene, box, black, this.iron);
    add(scene, box, new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.8 }), this.paint);
    merged(scene, this.stone, new THREE.MeshStandardMaterial({ color: 0xbab2a4, roughness: 0.88, side: THREE.DoubleSide }));
    merged(scene, this.ice, new THREE.MeshStandardMaterial({ color: 0xb8c8d4, roughness: 0.15, metalness: 0.1 }));
    merged(scene, this.bronze, new THREE.MeshStandardMaterial({ color: 0x4a6a58, roughness: 0.55, metalness: 0.5 }));
    merged(scene, this.snow, snowMaterial());
    merged(scene, this.shed, new THREE.MeshStandardMaterial({ color: 0xd4cfc4, roughness: 0.85, side: THREE.DoubleSide }));
    merged(scene, this.glass, new THREE.MeshStandardMaterial({ color: 0x232a34, roughness: 0.25, metalness: 0.4 }));
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

function merged(scene: THREE.Scene, list: THREE.BufferGeometry[], mat: THREE.Material): void {
  if (!list.length) return;
  const g = mergeGeometries(list)!;
  g.computeBoundingSphere();
  scene.add(new THREE.Mesh(g, mat));
}
