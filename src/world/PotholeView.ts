import * as THREE from 'three';
import { hash01, Rng } from '../core/Rng';
import { cumulative, tangentAt } from './Polyline';
import type { Pothole } from './Potholes';
import type { CityModel } from './RoadGraph';

/**
 * Craters stamped on the asphalt (PRD 5.4, Phase 6): a broken rim, a dark pit, grey meltwater in the middle,
 * cracks running out. Snow does not fill them. One merged mesh with a 2 x 2 atlas of crater drawings, laid
 * over the road (and its paint) a few millimetres up, following the ground.
 */
const CELL = 512;
/** Crater radius as a share of an atlas cell: the quad is larger than the pit so the cracks fit. */
const PIT = 0.3;
const LIFT = 0.03;
/** The worn patches sit just under the craters. */
const WORN_LIFT = 0.028;
const GRID = 4;

/**
 * Worn ground around every big pit: a wide, paler stretch of raveled asphalt with alligator cracks and shallow
 * chips, long along the road. It reads from much farther away than the crater does, so a fast driver sees
 * trouble coming. Superficial: it is only drawn, the sim knows nothing about it.
 */
export const POTHOLE_WARNING = {
  /** Half size of the worn area as multiples of the pit's radius: along the road and across it. */
  along: 6.5,
  across: 2.4,
  /** Caps (m), so the biggest pits do not wear out the whole street. */
  maxAlong: 13,
  maxAcross: 4.2,
};

/** Geometry gathered for one decal mesh. */
interface Quads {
  pos: number[];
  uv: number[];
  idx: number[];
}

/** Builds the craters and, under them, the worn warning patches around the big ones. */
export function buildPotholes(city: CityModel, pits: readonly Pothole[], scene: THREE.Scene): THREE.Mesh | null {
  if (!pits.length) return null;
  const W = POTHOLE_WARNING;
  const craters: Quads = { pos: [], uv: [], idx: [] };
  const worn: Quads = { pos: [], uv: [], idx: [] };
  const half = 0.5 / PIT;
  for (const p of pits) {
    // One in five is a patch that failed; the rest are bare craters
    const variant = hash01(p.id, 0x7a) < 0.2 ? 3 : Math.floor(hash01(p.id, 0x7b) * 3);
    // Stretched a little, along a random axis (traffic makes them long)
    const sx = p.r * half * (1 + hash01(p.id, 0x7d) * 0.35);
    stamp(craters, city, p.pos.x, p.pos.z, hash01(p.id, 0x7c) * Math.PI * 2, sx, p.r * half, variant, LIFT);
    if (p.depth !== 'big') continue;
    // The worn patch runs along the road, turned a little off it
    const e = city.edges[p.edge];
    const t = tangentAt(e.pts, cumulative(e.pts), p.s);
    const rot = Math.atan2(t.z, t.x) + (hash01(p.id, 0x7e) - 0.5) * 0.4;
    const along = Math.min(W.maxAlong, p.r * W.along * (0.85 + hash01(p.id, 0x7f) * 0.3));
    const across = Math.min(W.maxAcross, p.r * W.across);
    stamp(worn, city, p.pos.x, p.pos.z, rot, along, across, Math.floor(hash01(p.id, 0x80) * 4), WORN_LIFT);
  }
  const wornAtlas = atlasOf(wornPatch, '#d6d6d6', 0x3b1);
  // Under the craters: drawn first, and pulled toward the camera a little less
  addMesh(scene, worn, wornAtlas, -2, -2, 'pothole warnings');
  return addMesh(scene, craters, atlasOf(crater, '#e6e6e6', 0x9a7), -1, -3, 'potholes');
}

/** A quad of GRID x GRID cells at (x, z), half sizes sx (along `rot`) and sz, following the ground. */
function stamp(q: Quads, city: CityModel, x0: number, z0: number, rot: number, sx: number, sz: number, cell: number, lift: number): void {
  const inset = 2 / (CELL * 2);
  const u0 = (cell % 2) * 0.5 + inset;
  const v0 = Math.floor(cell / 2) * 0.5 + inset;
  const du = 0.5 - 2 * inset;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const base = q.pos.length / 3;
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const a = (i / GRID) * 2 - 1;
      const b = (j / GRID) * 2 - 1;
      const x = x0 + (a * sx * c - b * sz * s);
      const z = z0 + (a * sx * s + b * sz * c);
      q.pos.push(x, city.terrain.heightAt(x, z) + lift, z);
      q.uv.push(u0 + (i / GRID) * du, v0 + (j / GRID) * du);
    }
  }
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = base + j * (GRID + 1) + i;
      // wound to face up
      q.idx.push(k, k + GRID + 1, k + 1, k + 1, k + GRID + 1, k + GRID + 2);
    }
  }
}

function addMesh(scene: THREE.Scene, q: Quads, tex: { map: THREE.Texture; rough: THREE.Texture }, order: number, offset: number, name: string): THREE.Mesh | null {
  if (!q.idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(q.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(q.uv, 2));
  geo.setIndex(q.idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    roughnessMap: tex.rough,
    roughness: 1,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  // Ahead of the other see-through things, so snowflakes and steam draw over the road wear, not under it
  mesh.renderOrder = order;
  scene.add(mesh);
  return mesh;
}

/** Four drawings (colour with alpha, and a roughness map) in a 2 x 2 atlas. */
function atlasOf(
  draw: (g: CanvasRenderingContext2D, rg: CanvasRenderingContext2D, cx: number, cy: number, rng: Rng, v: number) => void,
  roughness: string,
  seed: number,
): { map: THREE.Texture; rough: THREE.Texture } {
  const size = CELL * 2;
  const col = canvas(size);
  const rgh = canvas(size);
  rgh.g.fillStyle = roughness;
  rgh.g.fillRect(0, 0, size, size);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * CELL;
    // The texture's v runs up the canvas
    const oy = (1 - Math.floor(v / 2)) * CELL;
    col.g.save();
    col.g.beginPath();
    col.g.rect(ox, oy, CELL, CELL);
    col.g.clip();
    draw(col.g, rgh.g, ox + CELL / 2, oy + CELL / 2, new Rng(seed + v * 31), v);
    col.g.restore();
  }
  const map = new THREE.CanvasTexture(col.c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const rough = new THREE.CanvasTexture(rgh.c);
  rough.anisotropy = 8;
  return { map, rough };
}

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d')! };
}

/** An irregular closed outline around (cx, cy): `n` points at radius r, wobbling by `wob`. */
function blob(rng: Rng, cx: number, cy: number, r: number, wob: number, n = 26): [number, number][] {
  const out: [number, number][] = [];
  const phase = rng.range(0, 6.28);
  const lobes = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + Math.sin(a * lobes + phase) * wob * 0.6 + rng.range(-wob, wob) * 0.5;
    out.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return out;
}

function trace(g: CanvasRenderingContext2D, pts: [number, number][]): void {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= pts.length; i++) {
    const p = pts[i % pts.length];
    const q = pts[(i + 1) % pts.length];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
}

function crater(g: CanvasRenderingContext2D, rg: CanvasRenderingContext2D, cx: number, cy: number, rng: Rng, v: number): void {
  const R = CELL * PIT;
  const patch = v === 3;
  // A failed patch: a rounded square of newer, darker asphalt with a seam, the crater broken through it
  if (patch) {
    const w = R * rng.range(1.25, 1.45);
    g.save();
    g.translate(cx, cy);
    g.rotate(rng.range(-0.3, 0.3));
    g.fillStyle = 'rgba(38, 38, 42, 0.85)';
    g.strokeStyle = 'rgba(20, 20, 22, 0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(-w, -w * rng.range(0.8, 1), w * 2, w * 2 * rng.range(0.85, 1), w * 0.25);
    g.fill();
    g.stroke();
    g.restore();
  }
  // Cracks running out from the rim, branching
  g.strokeStyle = 'rgba(18, 18, 20, 0.8)';
  g.lineCap = 'round';
  const cracks = rng.int(6, 10);
  for (let k = 0; k < cracks; k++) {
    let a = rng.range(0, Math.PI * 2);
    let x = cx + Math.cos(a) * R * 0.9;
    let y = cy + Math.sin(a) * R * 0.9;
    let w = rng.range(6, 10);
    const steps = rng.int(4, 8);
    for (let i = 0; i < steps; i++) {
      a += rng.range(-0.6, 0.6);
      const l = rng.range(14, 28);
      const nx = x + Math.cos(a) * l;
      const ny = y + Math.sin(a) * l;
      if (Math.hypot(nx - cx, ny - cy) > CELL * 0.47) break;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      if (rng.chance(0.3)) {
        const b = a + rng.sign() * rng.range(0.6, 1.1);
        g.lineWidth = w * 0.6;
        g.beginPath();
        g.moveTo(nx, ny);
        g.lineTo(nx + Math.cos(b) * l * 0.7, ny + Math.sin(b) * l * 0.7);
        g.stroke();
      }
      x = nx;
      y = ny;
      w *= 0.82;
    }
  }
  // Broken rim: chipped, lighter grey asphalt
  const rim = blob(rng, cx, cy, R * 1.12, 0.16);
  trace(g, rim);
  g.fillStyle = 'rgba(86, 85, 88, 0.95)';
  g.fill();
  // Loose bits of aggregate around the rim
  for (let i = 0; i < 60; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = R * rng.range(1.0, 1.35);
    g.fillStyle = rng.chance(0.5) ? 'rgba(110, 108, 106, 0.9)' : 'rgba(30, 30, 32, 0.9)';
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.range(1.5, 4), 0, Math.PI * 2);
    g.fill();
  }
  // The pit: dark, with its far wall lit and the near one in shadow
  const pit = blob(rng, cx, cy, R, 0.14);
  trace(g, pit);
  const lit = rng.range(0, Math.PI * 2);
  const grad = g.createRadialGradient(cx + Math.cos(lit) * R * 0.25, cy + Math.sin(lit) * R * 0.25, R * 0.1, cx, cy, R * 1.1);
  grad.addColorStop(0, '#2a2927');
  grad.addColorStop(0.7, '#1a1a1b');
  grad.addColorStop(1, '#0e0e10');
  g.fillStyle = grad;
  g.fill();
  rg.save();
  trace(rg, pit);
  rg.fillStyle = '#d8d8d8';
  rg.fill();
  rg.restore();
  // Meltwater in the bottom: muddy grey, a pale sky sheen on one side
  const water = blob(rng, cx + rng.range(-0.12, 0.12) * R, cy + rng.range(-0.12, 0.12) * R, R * rng.range(0.45, 0.6), 0.2);
  trace(g, water);
  const wg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  wg.addColorStop(0, '#5e5f5c');
  wg.addColorStop(0.5, '#47463f');
  wg.addColorStop(1, '#38362f');
  g.fillStyle = wg;
  g.fill();
  g.strokeStyle = 'rgba(25, 24, 22, 0.7)';
  g.lineWidth = 4;
  g.stroke();
  trace(rg, water);
  rg.fillStyle = '#5a5a5a';
  rg.fill();
  // A few chunks of asphalt sitting in the water
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = R * rng.range(0.1, 0.5);
    g.fillStyle = 'rgba(40, 40, 42, 0.95)';
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.range(4, 10), rng.range(3, 7), rng.range(0, 3), 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * A worn stretch of road, filling the cell (the quad stretches it along the road): pale raveled asphalt that
 * fades out at the edges, an alligator net of cracks, shallow chips, loose grit. Pale on purpose: from a
 * distance it is a light smear on dark wet asphalt, which is what the eye catches before the crater itself.
 */
function wornPatch(g: CanvasRenderingContext2D, _rg: CanvasRenderingContext2D, cx: number, cy: number, rng: Rng): void {
  const R = CELL * 0.46;
  // Raveled surface: overlapping pale blotches
  for (let k = 0; k < 7; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = k === 0 ? 0 : R * rng.range(0.2, 0.5);
    trace(g, blob(rng, cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (k === 0 ? 0.75 : rng.range(0.3, 0.5)), 0.25));
    g.fillStyle = `rgba(${rng.int(150, 170)}, ${rng.int(148, 166)}, ${rng.int(140, 156)}, 0.72)`;
    g.fill();
  }
  // Alligator cracking: a net of short dark segments, densest toward the middle (where the crater sits)
  g.strokeStyle = 'rgba(16, 16, 18, 0.85)';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let k = 0; k < 34; k++) {
    const a0 = rng.range(0, Math.PI * 2);
    const d0 = R * Math.sqrt(rng.next()) * 0.8;
    let x = cx + Math.cos(a0) * d0;
    let y = cy + Math.sin(a0) * d0;
    let a = rng.range(0, Math.PI * 2);
    g.lineWidth = rng.range(4, 7);
    g.beginPath();
    g.moveTo(x, y);
    for (let i = rng.int(3, 7); i > 0; i--) {
      // Blocky turns: the cells of an alligator net are polygons, not curls
      a += rng.sign() * rng.range(0.9, 1.6);
      const l = rng.range(16, 34);
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Shallow chips where the top layer came away: dark, with a pale broken edge
  for (let k = rng.int(18, 26); k > 0; k--) {
    const a = rng.range(0, Math.PI * 2);
    const d = R * rng.range(0.2, 0.75);
    const r = rng.range(9, 24);
    const chip = blob(rng, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0.3, 10);
    trace(g, chip);
    g.fillStyle = 'rgba(22, 22, 24, 0.95)';
    g.fill();
    g.strokeStyle = 'rgba(190, 186, 176, 0.9)';
    g.lineWidth = 4;
    g.stroke();
  }
  // Loose grit kicked out over the surface
  for (let k = 0; k < 220; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = R * Math.sqrt(rng.next());
    g.fillStyle = rng.chance(0.6) ? 'rgba(170, 166, 158, 0.8)' : 'rgba(28, 28, 30, 0.8)';
    g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.range(2, 5), rng.range(2, 5));
  }
  // Fade the whole thing out toward the cell's edge
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
  fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = fade;
  g.fillRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);
  g.globalCompositeOperation = 'source-over';
}
