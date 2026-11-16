import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/Rng';
import { LOOK } from '../render/Look';
import type { Basilica, ClockTower } from './Features';
import type { CityModel } from './RoadGraph';
import { snowMaterial } from './SnowCover';

/**
 * The two landmarks that are their own meshes (PRD Phase 5): Notre-Dame Basilica on Notre-Dame and the Old
 * Port's clock tower. Low poly, stone with coursing, dark pointed-arch openings, snow on the roofs. Their
 * colliders are the plain boxes the generator put in `city.buildings` (`custom`), which the building mesh skips.
 */
export function buildLandmarks(city: CityModel, scene: THREE.Scene): void {
  const f = city.features;
  const kit = new Kit();
  if (f.basilica) basilica(kit, f.basilica);
  if (f.clock) clockTower(kit, f.clock);
  kit.build(scene);
}

// ---------------------------------------------------------------------------------------------------------------
// Materials and the merge kit

const STONE = 'stone';
const PALE = 'pale';
const DARK = 'dark';
const SNOW = 'snow';
const ROSE = 'rose';
const FACE = 'face';
const METAL = 'metal';
const COPPER = 'copper';
type Mat = typeof STONE | typeof PALE | typeof DARK | typeof SNOW | typeof ROSE | typeof FACE | typeof METAL | typeof COPPER;

function materials(): Record<Mat, THREE.Material> {
  const stone = stoneTexture();
  const rose = roseTexture();
  const dial = clockTexture();
  return {
    // Grey limestone gone warm with age (the basilica), and the clock tower's paler stone
    [STONE]: new THREE.MeshStandardMaterial({ color: 0xb4aa98, map: stone, roughness: 0.92, metalness: 0 }),
    [PALE]: new THREE.MeshStandardMaterial({ color: 0xd8d2c6, map: stone, roughness: 0.9, metalness: 0 }),
    [DARK]: new THREE.MeshStandardMaterial({ color: 0x1c1e26, roughness: 0.6, metalness: 0.2 }),
    [SNOW]: snowMaterial(),
    [ROSE]: new THREE.MeshStandardMaterial({ map: rose, roughness: 0.35, metalness: 0.1, emissive: 0xffffff, emissiveMap: rose, emissiveIntensity: LOOK.day ? 0.12 : 0.6 }),
    [FACE]: new THREE.MeshStandardMaterial({ map: dial, roughness: 0.6, emissive: 0xffffff, emissiveMap: dial, emissiveIntensity: LOOK.day ? 0.08 : 0.5 }),
    [METAL]: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 }),
    [COPPER]: new THREE.MeshStandardMaterial({ color: 0x5e8c7a, roughness: 0.7, metalness: 0.2 }),
  };
}

/** Collects geometry per material in world space, then merges each list into one mesh. */
class Kit {
  private lists = new Map<Mat, THREE.BufferGeometry[]>();

  add(mat: Mat, g: THREE.BufferGeometry): void {
    const geo = g.index ? g.toNonIndexed() : g;
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(geo);
  }

  /** Box `sx` x `sy` x `sz` standing on `y0`, centered on (x, z), turned `yaw` about Y. */
  box(mat: Mat, x: number, y0: number, z: number, sx: number, sy: number, sz: number, yaw = 0): void {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(0, sy / 2, 0);
    if (yaw) g.rotateY(yaw);
    g.translate(x, y0, z);
    this.add(mat, g);
  }

  /** A flat shape (in its XY plane, facing +Z) stood up at (x, y, z), facing `out` (a unit vector in XZ). */
  flat(mat: Mat, shape: THREE.Shape | THREE.BufferGeometry, x: number, y: number, z: number, out: { x: number; z: number }): void {
    const g = shape instanceof THREE.Shape ? new THREE.ShapeGeometry(shape, 6) : shape;
    g.rotateY(Math.atan2(out.x, out.z));
    g.translate(x, y, z);
    this.add(mat, g);
  }

  /** Any geometry, moved to (x, y, z). */
  put(mat: Mat, g: THREE.BufferGeometry, x: number, y: number, z: number): void {
    g.translate(x, y, z);
    this.add(mat, g);
  }

  build(scene: THREE.Scene): void {
    if (!this.lists.size) return;
    const mats = materials();
    for (const [mat, list] of this.lists) {
      const geo = mergeGeometries(list)!;
      if (mat === STONE || mat === PALE) worldUv(geo, 1 / 3.2);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mats[mat]);
      scene.add(mesh);
    }
  }
}

/** UVs from world position (walls: along and up; tops: x and z), so the coursing keeps one scale everywhere. */
function worldUv(g: THREE.BufferGeometry, k: number): void {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const nz = Math.abs(n.getZ(i));
    if (ny > 0.7) uv.setXY(i, p.getX(i) * k, p.getZ(i) * k);
    else if (nx > nz) uv.setXY(i, p.getZ(i) * k, p.getY(i) * k);
    else uv.setXY(i, p.getX(i) * k, p.getY(i) * k);
  }
  uv.needsUpdate = true;
}

/** Pointed (Gothic) arch, `w` wide, `h` to the apex, standing on y = 0. */
function lancet(w: number, h: number): THREE.Shape {
  const r = w / 2;
  const spring = Math.max(0, h - r * 1.6);
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, spring);
  s.quadraticCurveTo(r, spring + r * 1.05, 0, h);
  s.quadraticCurveTo(-r, spring + r * 1.05, -r, spring);
  s.closePath();
  return s;
}

const N = { x: 0, z: -1 };
const S = { x: 0, z: 1 };
const E = { x: 1, z: 0 };
const W = { x: -1, z: 0 };

// ---------------------------------------------------------------------------------------------------------------
// Notre-Dame

function basilica(kit: Kit, b: Basilica): void {
  const y0 = b.y;
  const t = b.tower;
  const H = b.towerH;
  const front = b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const proud = 0.06;

  // Steps up to the portals, across the whole front
  for (let k = 0; k < 3; k++) kit.box(STONE, cx, y0 - 0.1, front - 0.6 - (2 - k) * 0.7, b.maxX - b.minX + 1, 0.1 + (k + 1) * 0.16, 0.7 + 0.01);

  // The towers
  for (const tx of [b.minX + t / 2, b.maxX - t / 2]) {
    const tz = front + t / 2;
    kit.box(STONE, tx, y0, tz, t, H, t);
    // Stepped corner buttresses
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const bx = tx + sx * (t / 2 - 0.5);
      const bz = tz + sz * (t / 2 - 0.5);
      kit.box(STONE, bx, y0, bz, 2.2, H * 0.42, 2.2);
      kit.box(STONE, bx, y0, bz, 1.7, H * 0.86, 1.7);
      // Pinnacles over the parapet at each corner
      const cone = new THREE.ConeGeometry(0.75, 7.5, 4);
      cone.rotateY(Math.PI / 4);
      kit.put(STONE, cone, bx, y0 + H + 3.75, bz);
      kit.box(SNOW, bx, y0 + H * 0.86, bz, 1.75, 0.18, 1.75);
    }
    // String courses: the stages of the tower
    for (const at of [0.3, 0.56, 0.8]) kit.box(STONE, tx, y0 + H * at, tz, t + 0.7, 0.7, t + 0.7);
    for (const at of [0.3, 0.56, 0.8]) kit.box(SNOW, tx, y0 + H * at + 0.7, tz, t + 0.72, 0.12, t + 0.72);
    // Parapet with crenels, snow on the roof
    kit.box(STONE, tx, y0 + H, tz, t + 0.5, 1.0, t + 0.5);
    for (let k = -2; k <= 2; k++) {
      const o = k * (t / 5);
      for (const [px, pz] of [
        [o, -t / 2],
        [o, t / 2],
        [-t / 2, o],
        [t / 2, o],
      ]) {
        kit.box(STONE, tx + px, y0 + H + 1.0, tz + pz, 0.9, 1.1, 0.9);
      }
    }
    kit.box(SNOW, tx, y0 + H + 0.98, tz, t - 0.4, 0.2, t - 0.4);
    // Openings: lancets on every face, paired belfry louvres at the top stage, one tall window lower down
    for (const out of [N, S, E, W]) {
      const fx = tx + out.x * (t / 2 + proud);
      const fz = tz + out.z * (t / 2 + proud);
      const across = { x: -out.z, z: out.x };
      for (const s of [-1, 1]) kit.flat(DARK, lancet(1.5, 10), fx + across.x * s * 1.6, y0 + H * 0.6, fz + across.z * s * 1.6, out);
      kit.flat(DARK, lancet(1.8, 8.5), fx, y0 + H * 0.36, fz, out);
      if (out !== S) kit.flat(DARK, lancet(1.2, 4), fx, y0 + H * 0.84, fz, out);
    }
    // The tower's own portal on the front
    kit.flat(DARK, lancet(3.2, 7.5), tx, y0 + 0.4, front - proud, N);
  }

  // The front between the towers: three portals, a niche gallery, the rose window, the gable
  const fw = b.maxX - b.minX - 2 * t;
  const fz = front + 1.2;
  const wallTop = b.eaves + 5;
  kit.box(STONE, cx, y0, front + t / 2 + 0.6, fw + 0.2, wallTop, t - 1.2);
  // Gable up to the cross
  const gable = new THREE.Shape();
  gable.moveTo(-fw / 2, 0);
  gable.lineTo(fw / 2, 0);
  gable.lineTo(0, b.ridge + 5 - wallTop);
  gable.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: 2, bevelEnabled: false });
  kit.put(STONE, gableGeo, cx, y0 + wallTop, fz);
  kit.box(METAL, cx, y0 + b.ridge + 5 - 0.3, fz + 0.6, 0.35, 3.4, 0.35);
  kit.box(METAL, cx, y0 + b.ridge + 5 + 1.6, fz + 0.6, 1.8, 0.32, 0.35);
  // Portico: three tall arches over the steps
  const pw = Math.min(4.2, (fw - 2) / 3 - 0.6);
  for (const k of [-1, 0, 1]) kit.flat(DARK, lancet(pw, 9.5), cx + k * (fw / 3), y0 + 0.4, fz - proud, N);
  kit.box(STONE, cx, y0 + 10.6, fz - 0.4, fw + 0.4, 0.8, 1.0);
  kit.box(SNOW, cx, y0 + 11.4, fz - 0.4, fw + 0.42, 0.12, 1.02);
  // Niche gallery
  for (let k = -2; k <= 2; k++) kit.flat(DARK, lancet(1.2, 3.4), cx + k * (fw / 5.5), y0 + 12.2, fz - proud, N);
  // Rose window and its stone ring
  const roseY = y0 + b.eaves - 3.5;
  const roseR = Math.min(3.8, fw / 2 - 2);
  const ring = new THREE.TorusGeometry(roseR, 0.45, 6, 24);
  kit.put(STONE, ring, cx, roseY, fz - 0.2);
  kit.flat(ROSE, new THREE.CircleGeometry(roseR, 32), cx, roseY, fz - proud, N);
  // A pointed hood over the rose
  kit.flat(STONE, archRing(roseR + 1.4, roseR + 0.6), cx, roseY, fz - proud, N);

  // The nave: walls with buttresses and tall windows, a snowy pitched roof, a gable at the back
  const nx0 = b.minX + 1.5;
  const nx1 = b.maxX - 1.5;
  const nz0 = front + t;
  const nz1 = b.maxZ;
  const nw = nx1 - nx0;
  kit.box(STONE, cx, y0, (nz0 + nz1) / 2, nw, b.eaves, nz1 - nz0);
  for (let z = nz0 + 6; z < nz1 - 2; z += 8) {
    for (const s of [-1, 1]) {
      const x = s < 0 ? nx0 : nx1;
      kit.box(STONE, x + s * 0.6, y0, z, 1.4, b.eaves - 1.5, 1.8);
      kit.box(STONE, x + s * 1.1, y0, z, 1.0, b.eaves * 0.55, 1.8);
      const out = s < 0 ? W : E;
      kit.flat(DARK, lancet(2.2, 9), x + s * proud, y0 + 7, z + 4, out);
    }
  }
  // Roof: two snow slopes over a copper ridge, overhanging a little
  const rise = b.ridge - b.eaves;
  const half = nw / 2 + 0.8;
  const slope = Math.hypot(half, rise);
  const ang = Math.atan2(rise, half);
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(slope, 0.35, nz1 - nz0 + 0.6);
    g.rotateZ(-s * ang);
    kit.put(SNOW, g, cx + (s * half) / 2, y0 + b.eaves + rise / 2, (nz0 + nz1) / 2);
  }
  kit.box(COPPER, cx, y0 + b.ridge - 0.1, (nz0 + nz1) / 2, 0.6, 0.6, nz1 - nz0 + 0.6);
  // Gable wall at the apse end
  const back = new THREE.Shape();
  back.moveTo(-nw / 2, 0);
  back.lineTo(nw / 2, 0);
  back.lineTo(0, rise);
  back.closePath();
  kit.put(STONE, new THREE.ExtrudeGeometry(back, { depth: 0.6, bevelEnabled: false }), cx, y0 + b.eaves, nz1 - 0.6);
  // Copper flèche over the crossing
  const fl = new THREE.ConeGeometry(1.2, 11, 8);
  kit.put(COPPER, fl, cx, y0 + b.ridge + 5.5, nz0 + (nz1 - nz0) * 0.62);
  kit.box(COPPER, cx, y0 + b.ridge - 0.5, nz0 + (nz1 - nz0) * 0.62, 2.6, 1.6, 2.6);
}

/** A pointed hood moulding: the outline of a lancet `outer` wide minus one `inner` wide, upper half only. */
function archRing(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-outer, 0);
  s.quadraticCurveTo(-outer, outer * 1.1, 0, outer * 1.45);
  s.quadraticCurveTo(outer, outer * 1.1, outer, 0);
  s.lineTo(inner, 0);
  s.quadraticCurveTo(inner, inner * 1.1, 0, inner * 1.45);
  s.quadraticCurveTo(-inner, inner * 1.1, -inner, 0);
  s.closePath();
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tour de l'Horloge

function clockTower(kit: Kit, c: ClockTower): void {
  const k = c.height / 45;
  const { x, z } = c.pos;
  const y0 = c.y;
  const s = c.side;
  const proud = 0.05;
  // Stepped plinth
  kit.box(PALE, x, y0 - 0.1, z, s + 3, 0.5, s + 3);
  kit.box(PALE, x, y0 + 0.4, z, s + 1.6, 0.8, s + 1.6);
  // Shaft with corner pilasters and recessed slit windows
  const shaftTop = y0 + 29 * k;
  kit.box(PALE, x, y0 + 1.2, z, s, shaftTop - y0 - 1.2, s);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    kit.box(PALE, x + sx * (s / 2 - 0.3), y0 + 1.2, z + sz * (s / 2 - 0.3), 1.5, shaftTop - y0 - 1.2, 1.5);
  }
  for (const at of [0.38, 0.7]) kit.box(PALE, x, y0 + 29 * k * at, z, s + 0.8, 0.5, s + 0.8);
  // Clock stage: wider, a face on each side
  const stage0 = shaftTop;
  const stage1 = stage0 + 7 * k;
  kit.box(PALE, x, stage0, z, s + 1, stage1 - stage0, s + 1);
  const faceR = Math.min(2.7, (s + 1) / 2 - 1);
  for (const out of [N, S, E, W]) {
    const fx = x + out.x * ((s + 1) / 2 + proud);
    const fz = z + out.z * ((s + 1) / 2 + proud);
    kit.flat(FACE, new THREE.CircleGeometry(faceR, 32), fx, (stage0 + stage1) / 2, fz, out);
    const ring = new THREE.TorusGeometry(faceR + 0.15, 0.22, 6, 24);
    ring.rotateY(Math.atan2(out.x, out.z));
    kit.put(METAL, ring, fx, (stage0 + stage1) / 2, fz);
    for (let i = 0; i < 3; i++) {
      const across = { x: -out.z, z: out.x };
      kit.flat(DARK, lancet(0.9, 4.2), x + out.x * (s / 2 + proud) + across.x * (i - 1) * 2.2, y0 + 29 * k * 0.45, z + out.z * (s / 2 + proud) + across.z * (i - 1) * 2.2, out);
    }
  }
  // Cornice, then the octagonal lantern on columns, a dome and the spire
  kit.box(PALE, x, stage1, z, s + 2, 0.9, s + 2);
  kit.box(SNOW, x, stage1 + 0.9, z, s + 2.05, 0.16, s + 2.05);
  const lr = (s + 1) / 2 - 1.4;
  const l0 = stage1 + 0.9;
  const l1 = l0 + 4.4 * k;
  kit.put(DARK, new THREE.CylinderGeometry(lr - 0.5, lr - 0.5, l1 - l0, 8).translate(0, (l1 - l0) / 2, 0), x, l0, z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    kit.box(PALE, x + Math.cos(a) * lr, l0, z + Math.sin(a) * lr, 0.6, l1 - l0, 0.6);
  }
  kit.put(PALE, new THREE.CylinderGeometry(lr + 0.5, lr + 0.5, 0.6, 8).translate(0, 0.3, 0), x, l1, z);
  const dome = new THREE.SphereGeometry(lr + 0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  kit.put(SNOW, dome, x, l1 + 0.6, z);
  kit.put(PALE, new THREE.CylinderGeometry(0.7, 0.9, 1.6, 8).translate(0, 0.8, 0), x, l1 + 0.6 + lr, z);
  kit.put(METAL, new THREE.ConeGeometry(0.55, 7 * k, 8).translate(0, 3.5 * k, 0), x, l1 + 2.2 + lr, z);
  kit.put(METAL, new THREE.SphereGeometry(0.32, 8, 6), x, l1 + 2.2 + lr + 7 * k, z);
}

// ---------------------------------------------------------------------------------------------------------------
// Textures

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Ashlar: courses of dressed stone, light mortar, a little variation block to block (multiplies the color). */
function stoneTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rng = new Rng(1824);
  g.fillStyle = '#e4e0d8';
  g.fillRect(0, 0, 256, 256);
  const rows = 8;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -rng.range(10, 40) : 0;
    while (x < 256) {
      const w = rng.range(36, 70);
      const v = Math.round(rng.range(196, 240));
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(x + 1.5, r * rh + 1.5, w - 3, rh - 3);
      x += w;
    }
  }
  // Weathering streaks
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(90, 84, 76, ${rng.range(0.03, 0.08)})`;
    g.fillRect(rng.range(0, 256), 0, rng.range(2, 8), 256);
  }
  return tex(c, true);
}

/** Stained glass behind stone tracery. */
function roseTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rng = new Rng(7);
  const cx = 128;
  const R = 126;
  g.fillStyle = '#1a1830';
  g.fillRect(0, 0, 256, 256);
  const glass = ['#2a3f8a', '#7a1e2e', '#c08a2a', '#2a5a7a', '#5a2a6a'];
  for (let ring = 0; ring < 4; ring++) {
    const r0 = (ring / 4) * R;
    const r1 = ((ring + 1) / 4) * R;
    const n = 6 + ring * 6;
    for (let i = 0; i < n; i++) {
      g.fillStyle = glass[Math.floor(rng.next() * glass.length)];
      g.beginPath();
      g.arc(cx, cx, r1, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
      g.arc(cx, cx, r0, ((i + 1) / n) * Math.PI * 2, (i / n) * Math.PI * 2, true);
      g.closePath();
      g.fill();
    }
  }
  g.strokeStyle = '#b8ae9c';
  g.lineWidth = 5;
  for (let ring = 1; ring <= 4; ring++) {
    g.beginPath();
    g.arc(cx, cx, (ring / 4) * R - 2, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R * 0.25, cx + Math.sin(a) * R * 0.25);
    g.lineTo(cx + Math.cos(a) * R, cx + Math.sin(a) * R);
    g.stroke();
  }
  return tex(c, false);
}

/** Cream dial, black ring, hour marks, hands at ten past two. */
function clockTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const cx = 128;
  g.fillStyle = '#1a1a1e';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#efe8d6';
  g.beginPath();
  g.arc(cx, cx, 118, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#1a1a1e';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    g.lineWidth = big ? 9 : 3;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (big ? 88 : 100), cx + Math.sin(a) * (big ? 88 : 100));
    g.lineTo(cx + Math.cos(a) * 112, cx + Math.sin(a) * 112);
    g.stroke();
  }
  const hand = (turn: number, len: number, w: number) => {
    const a = turn * Math.PI * 2 - Math.PI / 2;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, cx);
    g.lineTo(cx + Math.cos(a) * len, cx + Math.sin(a) * len);
    g.stroke();
  };
  hand((2 + 10 / 60) / 12, 56, 11);
  hand(10 / 60, 86, 7);
  return tex(c, false);
}
