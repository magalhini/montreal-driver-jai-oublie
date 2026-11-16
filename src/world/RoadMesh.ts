import * as THREE from 'three';
import { CONFIG } from '../config';
import type { AABB, Block, RoadEdge, Vec2 } from '../types';
import { outerCurb } from './BlockFaces';
import { type CityFeatures } from './Features';
import { subtractRect } from './Interiors';
import type { MarkingStyle } from '../maps/MapDef';
import { buildMarkings } from './RoadMarkings';
import type { CityModel } from './RoadGraph';
import { offset } from './Polyline';
import { polygonArea } from './RoadIndex';
import { SurfaceBuilder } from './SurfaceBuilder';
import { blockFloor } from './Surfaces';
import { asphaltTextures, grassTexture, pavingTextures, puddleTexture } from './textures';

type Rect = AABB;
const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Rect => ({ minX, minZ, maxX, maxZ });
const PAD = 260;

/** Road surface materials (the weather view makes them glossier and darker when wet). */
export interface RoadMaterials {
  asphalt: THREE.MeshStandardMaterial;
  lots: THREE.MeshStandardMaterial;
  walk: THREE.MeshStandardMaterial;
}

/**
 * Asphalt (roads, junctions, lots), raised sidewalks with curbstones, arcade paving and markings, all on the
 * terrain. Roads are ribbons along `edge.pts` and junctions fill `node.poly` (T41); rectangular blocks keep
 * their rect layout with the grid features (driveways, alleys, arcades, hotels, canal), polygon blocks are
 * raised slabs with curbs along `block.poly`. Grid maps keep their outer sidewalk ring and far ground; other
 * maps are sidewalk from the outer curb line to the bounds, and road-level ground beyond.
 */
export function buildRoads(city: CityModel, scene: THREE.Scene, markings?: MarkingStyle): RoadMaterials {
  const t = city.terrain;
  const H = (x: number, z: number) => t.heightAt(x, z);
  const curb = CONFIG.CURB_HEIGHT;
  const f = city.features;

  const ground = new SurfaceBuilder(H);
  const lots = new SurfaceBuilder(H);
  const walk = new SurfaceBuilder(H);
  const paving = new SurfaceBuilder(H);
  const curbs = new SurfaceBuilder(H, 2);

  // Grid map (Tokyo): outer ring, far ground and canal cuts come from the grid lines (behind `city.grid` in T49)
  const grid = city.nx > 0;

  // Roads between junctions, and the junction areas
  for (const e of city.edges) roadRibbon(ground, e);
  for (const n of city.nodes) {
    const r = asRect(n.poly);
    if (r) ground.patch(r.minX, r.minZ, r.maxX, r.maxZ);
    else ground.polygon(n.poly, [], 0, 2);
  }

  // Blocks: raised ring + interiors (rect blocks), raised slabs (polygon blocks)
  const raised: Rect[] = [];
  const slabs: Vec2[][] = [];
  const grass = new SurfaceBuilder(H);
  for (const bl of city.blocks) {
    if (!bl.rect) {
      // Road-level floors (lots, parks) on polygon blocks need an inner outline: see the backlog
      walk.polygon(bl.poly, [], curb, 2);
      slabs.push(bl.poly);
      continue;
    }
    const r = blockRects(bl, f);
    raised.push(...r.raised);
    for (const q of r.lowered) (q.maxX - q.minX > 20 && q.maxZ - q.minZ > 20 ? lots : ground).patch(q.minX, q.minZ, q.maxX, q.maxZ, 0, 3);
    for (const q of r.grass) grass.patch(q.minX, q.minZ, q.maxX, q.maxZ, 0, 3);
    for (const q of r.floor) (q.maxX - q.minX > 20 && q.maxZ - q.minZ > 20 ? lots : ground).patch(q.minX, q.minZ, q.maxX, q.maxZ, 0, 3);
    for (const q of r.paved) paving.patch(q.minX, q.minZ, q.maxX, q.maxZ, 0.01, 3);
  }
  const b = city.bounds;
  let outer: Vec2[] | null = null;
  if (grid) raised.push(...outerRing(city));
  else {
    // Sidewalk from the outer curb line out to the bounds
    outer = outerCurb(city);
    const box = [
      { x: b.minX, z: b.minZ },
      { x: b.maxX, z: b.minZ },
      { x: b.maxX, z: b.maxZ },
      { x: b.minX, z: b.maxZ },
    ];
    walk.polygon(box, [outer], curb, 2);
  }
  for (const q of raised) walk.patch(q.minX, q.minZ, q.maxX, q.maxZ, curb, 4);

  // Curbstones wherever a raised slab meets road level
  const curbColor = new THREE.Color(0.55, 0.55, 0.58);
  const curbAt = (x: number, z: number) => t.curbAt(x, z);
  for (const q of raised) addCurbs(q, curbAt, H, curbs, curbColor);
  for (const p of slabs) polyCurbs(p, 1, curbAt, H, curbs, curbColor);
  if (outer) {
    polyCurbs(outer, -1, curbAt, H, curbs, curbColor);
    addCurbs(b, curbAt, H, curbs, curbColor); // the slab's edge at the bounds
  }

  if (grid) farGround(city, ground);
  else {
    // Road-level ground beyond the bounds
    const far = [rect(b.minX - PAD, b.minZ - PAD, b.maxX + PAD, b.minZ), rect(b.minX - PAD, b.maxZ, b.maxX + PAD, b.maxZ + PAD), rect(b.minX - PAD, b.minZ, b.minX, b.maxZ), rect(b.maxX, b.minZ, b.maxX + PAD, b.maxZ)];
    for (const q of far) ground.patch(q.minX, q.minZ, q.maxX, q.maxZ, -0.02, 8);
  }
  // Materials
  const tex = asphaltTextures();
  tex.map.repeat.set(1 / 7, 1 / 7);
  tex.normalMap.repeat.set(1 / 7, 1 / 7);
  const puddles = puddleTexture();
  puddles.repeat.set(1 / 30, 1 / 30);
  const asphalt = new THREE.MeshStandardMaterial({
    color: 0x6a6a7a,
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 1,
    roughnessMap: puddles,
    metalness: 0.15,
  });
  scene.add(ground.mesh(asphalt));
  // big open lots: drier, fewer mirror-like puddles
  const lotMat = asphalt.clone();
  lotMat.roughnessMap = null;
  lotMat.roughness = 0.75;
  lotMat.color.set(0x7a7a88);
  scene.add(lots.mesh(lotMat));

  const pave = pavingTextures();
  pave.map.repeat.set(1 / 2, 1 / 2);
  pave.normalMap.repeat.set(1 / 2, 1 / 2);
  const walkMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa6, map: pave.map, normalMap: pave.normalMap, roughness: 0.6, metalness: 0.05 });
  scene.add(walk.mesh(walkMat));
  const pave2 = pavingTextures();
  pave2.map.repeat.set(1 / 1.2, 1 / 1.2);
  pave2.normalMap.repeat.set(1 / 1.2, 1 / 1.2);
  scene.add(paving.mesh(new THREE.MeshStandardMaterial({ color: 0xb08a78, map: pave2.map, normalMap: pave2.normalMap, roughness: 0.45, metalness: 0.1 })));
  scene.add(curbs.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 })));
  if (grass.vertexCount > 0) {
    const lawn = grassTexture();
    lawn.repeat.set(1 / 6, 1 / 6);
    scene.add(grass.mesh(new THREE.MeshStandardMaterial({ color: 0x8a9a80, map: lawn, roughness: 0.95, metalness: 0 })));
  }

  scene.add(buildMarkings(city, markings));
  return { asphalt, lots: lotMat, walk: walkMat };
}

/** Far ground beyond Tokyo's outer ring (cut around the canal). */
function farGround(city: CityModel, ground: SurfaceBuilder): void {
  const sw = CONFIG.SIDEWALK;
  const f = city.features;
  const b = city.bounds;
  const ox0 = city.xs[0] - city.hwX[0] - sw - 40;
  const ox1 = city.xs[city.nx - 1] + city.hwX[city.nx - 1] + sw + 40;
  const oz0 = city.zs[0] - city.hwZ[0] - sw - 40;
  const far: Rect[] = [rect(b.minX - PAD, b.minZ - PAD, b.maxX + PAD, oz0)];
  const k = f.canal;
  const sides: [number, number][] = k
    ? [
        [oz0, k.z0],
        [k.z1, city.waterZ],
      ]
    : [[oz0, city.waterZ]];
  for (const [z0, z1] of sides) far.push(rect(b.minX - PAD, z0, ox0, z1), rect(ox1, z0, b.maxX + PAD, z1));
  for (const q of far) ground.patch(q.minX, q.minZ, q.maxX, q.maxZ, -0.02, 8);
}

/** The polygon as a rect when it is an axis-aligned rectangle (grid junctions: keep the patch tessellation). */
function asRect(poly: Vec2[]): Rect | null {
  if (poly.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % 4];
    if (p.x !== q.x && p.z !== q.z) return null;
  }
  const xs = poly.map((p) => p.x);
  const zs = poly.map((p) => p.z);
  return rect(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
}

/** A road's asphalt between its junctions: a patch for a straight axis-aligned road, else a ribbon along `pts`. */
function roadRibbon(out: SurfaceBuilder, e: RoadEdge): void {
  const hw = e.width / 2;
  const p = e.pts;
  if (p.length === 2 && (p[0].x === p[1].x || p[0].z === p[1].z)) {
    const along = p[0].z === p[1].z;
    const x0 = Math.min(p[0].x, p[1].x);
    const x1 = Math.max(p[0].x, p[1].x);
    const z0 = Math.min(p[0].z, p[1].z);
    const z1 = Math.max(p[0].z, p[1].z);
    if (along) out.patch(x0, z0 - hw, x1, z0 + hw);
    else out.patch(x0 - hw, z0, x0 + hw, z1);
    return;
  }
  out.strip(offset(p, hw), offset(p, -hw), 0, 2);
}

/** Split [lo, hi] by removing the given intervals. */
function cutInterval(lo: number, hi: number, cuts: [number, number][]): [number, number][] {
  let out: [number, number][] = [[lo, hi]];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [a, b] of out) {
      if (c1 <= a || c0 >= b) next.push([a, b]);
      else {
        if (c0 > a) next.push([a, c0]);
        if (c1 < b) next.push([c1, b]);
      }
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a > 0.05);
}

const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** Block surfaces: raised sidewalk ring and slab, road-level asphalt (lots, driveways), arcade paving. */
/** A block's surfaces: raised slabs, road-level cuts (driveways, alleys...), its road-level floor, paving. */
function blockRects(bl: Block, f: CityFeatures): { raised: Rect[]; lowered: Rect[]; floor: Rect[]; paved: Rect[]; grass: Rect[] } {
  const sw = CONFIG.SIDEWALK;
  const raised: Rect[] = [];
  const lowered: Rect[] = [];
  const floor: Rect[] = [];
  const paved: Rect[] = [];
  const grass: Rect[] = [];
  const box = rect(bl.min.x, bl.min.z, bl.max.x, bl.max.z);
  // Road-level cuts: driveways (through the ring, up to a garage door), the garage / passage / nook floors
  // and the alleys through the block. Drawn without overlaps (coplanar patches would z-fight).
  const cuts: Rect[] = [...f.driveways, ...f.interiors.map((r) => r.box), ...f.alleys.map((a) => a.box), ...f.pitStops.map((p) => p.box), ...(f.station ? [f.station.lot] : [])].filter((d) => overlaps(d, box));
  for (let i = 0; i < cuts.length; i++) {
    let parts: Rect[] = [cuts[i]];
    for (let k = 0; k < i; k++) parts = parts.flatMap((p) => subtractRect(p, cuts[k]));
    lowered.push(...parts);
  }
  const ix0 = bl.min.x + sw;
  const ix1 = bl.max.x - sw;
  const iz0 = bl.min.z + sw;
  const iz1 = bl.max.z - sw;
  const xCuts = (z0: number, z1: number) => cuts.filter((c) => c.minZ < z1 && c.maxZ > z0).map((c) => [c.minX, c.maxX] as [number, number]);
  const zCuts = (x0: number, x1: number) => cuts.filter((c) => c.minX < x1 && c.maxX > x0).map((c) => [c.minZ, c.maxZ] as [number, number]);
  for (const [a, b] of cutInterval(bl.min.x, bl.max.x, xCuts(bl.min.z, iz0))) raised.push(rect(a, bl.min.z, b, iz0));
  for (const [a, b] of cutInterval(bl.min.x, bl.max.x, xCuts(iz1, bl.max.z))) raised.push(rect(a, iz1, b, bl.max.z));
  for (const [a, b] of cutInterval(iz0, iz1, zCuts(bl.min.x, ix0))) raised.push(rect(bl.min.x, a, ix0, b));
  for (const [a, b] of cutInterval(iz0, iz1, zCuts(ix1, bl.max.x))) raised.push(rect(ix1, a, bl.max.x, b));

  // Interior, minus the canal water
  let parts: Rect[] = [rect(ix0, iz0, ix1, iz1)];
  const k = f.canal;
  if (k && bl.gj === k.row) parts = [rect(ix0, iz0, ix1, k.z0), rect(ix0, k.z1, ix1, iz1)];
  const lawns = (f.parks ?? []).filter((p) => p.block === bl.id).map((p) => p.lawn);
  if (blockFloor(f, bl)) floor.push(...parts);
  else {
    // Raised slab, minus the driveway / garage cuts reaching in from the ring (already lowered above)
    for (const c of cuts) parts = parts.flatMap((p) => subtractRect(p, c));
    for (const lawn of lawns) parts = parts.flatMap((p) => subtractRect(p, lawn));
    raised.push(...parts);
  }
  grass.push(...lawns);
  return { raised, lowered, floor, paved, grass };
}

/** Sidewalk ring outside the grid (under the skyline buildings), cut where the canal flows out. */
function outerRing(city: CityModel): Rect[] {
  const sw = CONFIG.SIDEWALK;
  const ox0 = city.xs[0] - city.hwX[0];
  const ox1 = city.xs[city.nx - 1] + city.hwX[city.nx - 1];
  const oz0 = city.zs[0] - city.hwZ[0];
  const oz1 = city.zs[city.nz - 1] + city.hwZ[city.nz - 1];
  const out: Rect[] = [rect(ox0 - sw - 40, oz0 - sw - 40, ox1 + sw + 40, oz0), rect(ox0 - sw, oz1, ox1 + sw, city.waterZ)];
  const k = city.features.canal;
  const spans: [number, number][] = k
    ? [
        [oz0, k.z0],
        [k.z1, oz1 + sw],
      ]
    : [[oz0, oz1 + sw]];
  for (const [z0, z1] of spans) out.push(rect(ox0 - sw - 40, z0, ox0 - sw, z1), rect(ox1 + sw, z0, ox1 + sw + 40, z1));
  // bridge sidewalks of the outer roads run straight across the canal
  out.push(rect(ox0 - sw, oz0, ox0, oz1 + sw), rect(ox1, oz0, ox1 + sw, oz1 + sw));
  return out;
}

type CurbAt = (x: number, z: number) => number;
type HeightAt = (x: number, z: number) => number;

/** Curb faces + curbstone band along the edges of a raised rect that border road level. */
function addCurbs(q: Rect, curbAt: CurbAt, H: HeightAt, out: SurfaceBuilder, color: THREE.Color): void {
  const edges: { a: [number, number]; b: [number, number]; n: { x: number; z: number } }[] = [
    { a: [q.minX, q.minZ], b: [q.maxX, q.minZ], n: { x: 0, z: -1 } },
    { a: [q.maxX, q.maxZ], b: [q.minX, q.maxZ], n: { x: 0, z: 1 } },
    { a: [q.minX, q.maxZ], b: [q.minX, q.minZ], n: { x: -1, z: 0 } },
    { a: [q.maxX, q.minZ], b: [q.maxX, q.maxZ], n: { x: 1, z: 0 } },
  ];
  for (const e of edges) curbEdge(e.a, e.b, e.n, curbAt, H, out, color);
}

/**
 * Curbs along a raised polygon's edges where they border road level. `side` 1: the polygon is the raised
 * slab (curbs face out); -1: it is a hole in one (curbs face in).
 */
function polyCurbs(poly: Vec2[], side: 1 | -1, curbAt: CurbAt, H: HeightAt, out: SurfaceBuilder, color: THREE.Color): void {
  // Positive shoelace area: the inside is on the right of travel in game terms, so `(d.z, -d.x)` points out
  const s = (polygonArea(poly) >= 0 ? 1 : -1) * side;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const L = Math.hypot(q.x - p.x, q.z - p.z);
    if (L < 0.01) continue;
    const n = { x: (s * (q.z - p.z)) / L, z: (-s * (q.x - p.x)) / L };
    curbEdge([p.x, p.z], [q.x, q.z], n, curbAt, H, out, color);
  }
}

/** Curb face + curbstone band along one slab edge a-b (outward normal n), wherever the ground beyond it is low. */
function curbEdge(a: [number, number], b: [number, number], n: Vec2, curbAt: CurbAt, H: HeightAt, out: SurfaceBuilder, color: THREE.Color): void {
  const curb = CONFIG.CURB_HEIGHT;
  const top = (x: number, z: number) => H(x, z) + curb + 0.004;
  const STEP = 1;
  const BAND = 0.3;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.round(len / STEP));
  const at = (k: number): [number, number] => [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps];
  const flush = (k0: number, k1: number) => {
    const [x0, z0] = at(k0);
    const [x1, z1] = at(k1);
    out.wall(x0, z0, x1, z1, n, (x, z) => H(x, z) - 0.02, top, 2, color);
    // curbstone top band, inside the edge
    if (n.x !== 0 && n.z !== 0) {
      const inner = (x: number, z: number) => ({ x: x - n.x * BAND, z: z - n.z * BAND });
      out.strip([{ x: x0, z: z0 }, { x: x1, z: z1 }], [inner(x0, z0), inner(x1, z1)], curb + 0.006, 2, color);
      return;
    }
    const bx0 = Math.min(x0, x1, x0 - n.x * BAND);
    const bx1 = Math.max(x0, x1, x0 - n.x * BAND);
    const bz0 = Math.min(z0, z1, z0 - n.z * BAND);
    const bz1 = Math.max(z0, z1, z0 - n.z * BAND);
    out.patch(bx0, bz0, bx1, bz1, curb + 0.006, 2, color);
  };
  let runStart = -1;
  for (let k = 0; k < steps; k++) {
    const s = (k + 0.5) / steps;
    const x = a[0] + (b[0] - a[0]) * s + n.x * 0.1;
    const z = a[1] + (b[1] - a[1]) * s + n.z * 0.1;
    const low = curbAt(x, z) === 0;
    if (low && runStart < 0) runStart = k;
    if (!low && runStart >= 0) {
      flush(runStart, k);
      runStart = -1;
    }
  }
  if (runStart >= 0) flush(runStart, steps);
}
