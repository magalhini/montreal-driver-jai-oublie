import type { Block, DistrictType, Vec2 } from '../types';
import { offset, reversed, segDir } from './Polyline';
import type { CityModel } from './RoadGraph';
import { polygonArea } from './RoadIndex';

interface HalfEdge {
  edge: number;
  /** Runs a -> b. */
  fwd: boolean;
  from: number;
  to: number;
  /** Direction leaving `from`. */
  ang: number;
}

/**
 * Curb outlines of the faces of the planar road graph (T38; curb line since T41): each face's roads offset by
 * half width toward the face, joined at each junction by a straight cut from one arm's curb end to the next
 * arm's, which is the junction polygon's edge between them (blocks and junctions share it: no gap, no overlap).
 * `outer` is the face around the whole network.
 */
function faceOutlines(city: CityModel): { polys: Vec2[][]; areas: number[]; outer: number; inSign: number } {
  const halves: HalfEdge[] = [];
  const out = new Map<number, HalfEdge[]>();
  for (const e of city.edges) {
    for (const fwd of [true, false]) {
      const line = fwd ? e.pts : reversed(e.pts);
      const d = segDir(line, 0);
      const h: HalfEdge = { edge: e.id, fwd, from: fwd ? e.a : e.b, to: fwd ? e.b : e.a, ang: Math.atan2(d.z, d.x) };
      halves.push(h);
      (out.get(h.from) ?? out.set(h.from, []).get(h.from)!).push(h);
    }
  }
  for (const list of out.values()) list.sort((p, q) => p.ang - q.ang);

  // Walk faces: arriving at v, leave by the arm just before the reverse of the arrival in angle order
  const used = new Set<HalfEdge>();
  const faces: HalfEdge[][] = [];
  for (const start of halves) {
    if (used.has(start)) continue;
    const face: HalfEdge[] = [];
    let h = start;
    for (let guard = 0; guard < 10000 && !used.has(h); guard++) {
      used.add(h);
      face.push(h);
      const list = out.get(h.to)!;
      const back = list.findIndex((x) => x.edge === h.edge && x.fwd !== h.fwd);
      h = list[(back - 1 + list.length) % list.length];
    }
    faces.push(face);
  }

  const centerArea = (face: HalfEdge[]) => polygonArea(face.flatMap((h) => (h.fwd ? city.edges[h.edge].pts : reversed(city.edges[h.edge].pts))));
  const areas = faces.map(centerArea);
  let outer = 0;
  areas.forEach((a, i) => Math.abs(a) > Math.abs(areas[outer]) && (outer = i));
  const inSign = -Math.sign(areas[outer]);
  // A face with positive area lies on the math-left of its walk, which is `offset`'s negative side
  const offSign = inSign > 0 ? -1 : 1;
  const polys = faces.map((face) => {
    const poly = face.flatMap((h) => {
      const e = city.edges[h.edge];
      return offset(h.fwd ? e.pts : reversed(e.pts), (offSign * e.width) / 2);
    });
    return poly.filter((p, i) => {
      const q = poly[(i + 1) % poly.length];
      return Math.hypot(p.x - q.x, p.z - q.z) > 0.05;
    });
  });
  return { polys, areas, outer, inSign };
}

/**
 * Blocks of a non-grid network (T38): the faces of the planar road graph, outlined by their curb lines (see
 * `faceOutlines`). The outer face and slivers under `minArea` are dropped. Ids continue from `city.blocks`;
 * the caller adds them (and calls `finishLayout`).
 */
export function extractBlocks(city: CityModel, district: (center: Vec2) => DistrictType, minArea = 300): Block[] {
  const { polys, areas, outer, inSign } = faceOutlines(city);
  const blocks: Block[] = [];
  polys.forEach((clean, fi) => {
    if (fi === outer || Math.sign(areas[fi]) !== inSign) return;
    const area = polygonArea(clean);
    if (Math.sign(area) !== inSign || Math.abs(area) < minArea) return;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of clean) {
      x0 = Math.min(x0, p.x);
      z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x);
      z1 = Math.max(z1, p.z);
    }
    const center = centroid(clean);
    blocks.push({
      id: city.blocks.length + blocks.length,
      gi: -1,
      gj: -1,
      min: { x: x0, z: z0 },
      max: { x: x1, z: z1 },
      district: district(center),
      poly: clean,
      center,
      rect: false,
    });
  });
  return blocks;
}

/** Curb line around the whole network (non-grid maps, T41): everything between it and the bounds is sidewalk. */
export function outerCurb(city: CityModel): Vec2[] {
  const { polys, outer } = faceOutlines(city);
  return polys[outer];
}

/** Area centroid of a simple polygon. */
export function centroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const c = p.x * q.z - q.x * p.z;
    a += c;
    cx += (p.x + q.x) * c;
    cz += (p.z + q.z) * c;
  }
  if (Math.abs(a) < 1e-9) return { ...poly[0] };
  return { x: cx / (3 * a), z: cz / (3 * a) };
}
