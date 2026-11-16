import * as THREE from 'three';
import { CONFIG } from '../config';
import type { MarkingStyle } from '../maps/MapDef';
import { MONTREAL_MARKINGS } from '../maps/MapDef';
import type { RoadEdge, Vec2 } from '../types';
import { cumulative, offset, pointAt, tangentAt } from './Polyline';
import { travelHalf, type CityModel } from './RoadGraph';

const LOT = new THREE.Color(0.75, 0.75, 0.72);
/** The slot drain down the middle of a cobble street: a dark iron channel between the setts. */
const DRAIN = new THREE.Color(0.1, 0.1, 0.11);
/** Parking-band ticks: how far into the band from the travel lane's edge line (fraction of the band). */
const TICK = 0.55;

/**
 * Lane lines, stop lines, crosswalks, parking bays, draped on the terrain (T42: along any road
 * shape). Lines follow the edge's centerline offset sideways (mitered), dashes are laid by arc length, stop
 * lines run square to the lanes' `endDir`, crosswalks cross each approach just off the junction. Straight
 * axis-aligned pieces are drawn exactly as on the grid; the look comes from the map's `MarkingStyle`.
 *
 * Per street class (PRD 4.2): boulevards get a double yellow center line, dashed white lanes and an edge line
 * with a tick at every curb bay; streets a dashed yellow center line, edge lines and ticks; cobbles no paint
 * along the road, only the slot drain down the middle. Every lengthwise line runs stop line to stop line, so
 * they all end flush at the junctions.
 */
export function buildMarkings(city: CityModel, style: MarkingStyle = MONTREAL_MARKINGS): THREE.Mesh {
  const t = city.terrain;
  const WHITE = new THREE.Color(...style.white);
  const CENTER = new THREE.Color(...style.center);
  const pos: number[] = [];
  const col: number[] = [];
  const LIFT = 0.025;
  const y = (x: number, z: number) => t.heightAt(x, z) + LIFT;
  const quad = (x0: number, z0: number, x1: number, z1: number, c: THREE.Color) => {
    pos.push(x0, y(x0, z0), z0, x0, y(x0, z1), z1, x1, y(x1, z1), z1, x0, y(x0, z0), z0, x1, y(x1, z1), z1, x1, y(x1, z0), z0);
    for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
  };
  /** Axis-aligned rectangle centered at (cx, cz), split along its length where the road bends. */
  const rectM = (cx: number, cz: number, sx: number, sz: number, c: THREE.Color) => {
    const alongX = sx >= sz;
    const len = alongX ? sx : sz;
    const h0 = alongX ? t.heightAt(cx - sx / 2, cz) : t.heightAt(cx, cz - sz / 2);
    const h1 = alongX ? t.heightAt(cx + sx / 2, cz) : t.heightAt(cx, cz + sz / 2);
    const hm = t.heightAt(cx, cz);
    const n = h0 === h1 && hm === h0 ? 1 : Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k < n; k++) {
      const a = -len / 2 + (len * k) / n;
      const b = -len / 2 + (len * (k + 1)) / n;
      if (alongX) quad(cx + a, cz - sz / 2, cx + b, cz + sz / 2, c);
      else quad(cx - sx / 2, cz + a, cx + sx / 2, cz + b, c);
    }
  };
  /** Up-facing triangle. */
  const tri = (a: Vec2, b: Vec2, c: Vec2, cl: THREE.Color) => {
    const cr = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const [p, q] = cr < 0 ? [b, c] : [c, b];
    pos.push(a.x, y(a.x, a.z), a.z, p.x, y(p.x, p.z), p.z, q.x, y(q.x, q.z), q.z);
    for (let i = 0; i < 3; i++) col.push(cl.r, cl.g, cl.b);
  };
  /** A straight band of width w from p to q (split every 2 m where the ground bends). */
  const band = (p: Vec2, q: Vec2, w: number, c: THREE.Color) => {
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 1e-6) return;
    if (p.z === q.z) return rectM((p.x + q.x) / 2, p.z, len, w, c);
    if (p.x === q.x) return rectM(p.x, (p.z + q.z) / 2, w, len, c);
    const nx = (-(q.z - p.z) / len) * (w / 2);
    const nz = ((q.x - p.x) / len) * (w / 2);
    const h0 = t.heightAt(p.x, p.z);
    const flat = h0 === t.heightAt(q.x, q.z) && h0 === t.heightAt((p.x + q.x) / 2, (p.z + q.z) / 2);
    const n = flat ? 1 : Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k < n; k++) {
      const a = { x: p.x + ((q.x - p.x) * k) / n, z: p.z + ((q.z - p.z) * k) / n };
      const b = { x: p.x + ((q.x - p.x) * (k + 1)) / n, z: p.z + ((q.z - p.z) * (k + 1)) / n };
      const A = { x: a.x - nx, z: a.z - nz };
      const B = { x: a.x + nx, z: a.z + nz };
      const C = { x: b.x + nx, z: b.z + nz };
      const D = { x: b.x - nx, z: b.z - nz };
      tri(A, B, C, c);
      tri(A, C, D, c);
    }
  };
  /** Paint along a polyline between arc lengths s0 and s1, solid or dashed ([paint, gap]). */
  const along = (line: Vec2[], s0: number, s1: number, w: number, c: THREE.Color, dash?: [number, number]) => {
    if (s1 <= s0) return;
    const cum = cumulative(line);
    const piece = (a: number, b: number) => {
      for (let i = 0; i + 1 < line.length; i++) {
        const u = Math.max(a, cum[i]);
        const v = Math.min(b, cum[i + 1]);
        if (v - u > 1e-6 || (line.length === 2 && v > u)) band(pointAt(line, cum, u), pointAt(line, cum, v), w, c);
      }
    };
    if (!dash) return piece(s0, s1);
    for (let s = s0; s < s1; s += dash[0] + dash[1]) piece(s, Math.min(s + dash[0], s1));
  };

  const SO = CONFIG.STOP_OFFSET;
  const cw = style.crosswalk;
  const bays = new Map<number, Set<number>[]>();
  for (const b of city.features.curb) {
    const sides = bays.get(b.edge) ?? [new Set<number>(), new Set<number>()];
    bays.set(b.edge, sides);
    const set = sides[b.side > 0 ? 0 : 1];
    set.add(Math.round(b.s0 * 100) / 100);
    set.add(Math.round(b.s1 * 100) / 100);
  }
  for (const e of city.edges) {
    const hw = e.width / 2;
    const LW = e.laneWidth;
    const th = travelHalf(e);
    const pts = e.pts;
    const cum = cumulative(pts);
    const L = cum[cum.length - 1];
    /** Point at arc length s, lateral offset o (+ = left of a -> b). */
    const at = (s: number, o: number): Vec2 => {
      const c = pointAt(pts, cum, s);
      const d = tangentAt(pts, cum, s);
      return { x: c.x + d.z * o, z: c.z - d.x * o };
    };
    /** Lengthwise line at lateral offset d (+ = left of a -> b), from the stop offset to the stop offset. */
    const lineAt = (d: number, w: number, c: THREE.Color, dash?: [number, number]) => {
      const off = d === 0 ? pts : offset(pts, d);
      const oc = cumulative(off);
      const OL = oc[oc.length - 1];
      along(off, SO * (OL / L), OL - SO * (OL / L), w, c, dash);
    };
    const dividers = (from: number, sgn: number) => {
      for (let k = 1; k < e.lanesPerDir; k++) lineAt(sgn * (from + LW * k), 0.14, WHITE, style.laneDash);
    };
    if (e.cls === 'cobble') {
      // Setts, no paint: a slot drain down the middle, from crosswalk to crosswalk
      const s0 = 0.6 + cw.depth + 0.4;
      along(pts, s0, L - s0, 0.3, DRAIN);
    } else {
      // Edge lines where the travel lanes end: at the parking band, else just off the curb
      const edge = e.parking > 0 ? th : hw - 0.3;
      lineAt(-edge, 0.13, WHITE);
      lineAt(edge, 0.13, WHITE);
      if (e.oneWay) dividers(-(e.lanesPerDir * LW) / 2, 1);
      else if (e.avenue) {
        lineAt(-0.18, 0.15, CENTER);
        lineAt(0.18, 0.15, CENTER);
        dividers(e.median, -1);
        dividers(e.median, 1);
      } else {
        lineAt(0, 0.14, CENTER, style.streetDash);
        dividers(e.median, -1);
        dividers(e.median, 1);
      }
      // A tick into the parking band at each end of every bay
      const sides = bays.get(e.id);
      if (sides && e.parking > 0) {
        sides.forEach((set, k) => {
          const sgn = k === 0 ? 1 : -1;
          for (const s of set) band(at(s, sgn * edge), at(s, sgn * (edge + e.parking * TICK)), 0.13, WHITE);
        });
      }
    }

    for (const end of [0, 1]) {
      const n = city.nodes[end === 0 ? e.a : e.b];
      /** Arc length `d` in from this end. */
      const sIn = (d: number) => (end === 0 ? d : L - d);
      crosswalk(sIn(0.6), sIn(0.6 + cw.depth));
      if (n.signalized || n.control === 'stop') stopLine(e, n.id, sIn(SO - 0.1));
    }

    /** Crosswalk bars across the road between arc lengths a and b. */
    function crosswalk(a: number, b: number): void {
      // Bars at laterals o (+ = left): anchored at the curb nearer the world's -x / -z (the grid's look), or centered
      const left = at((a + b) / 2, 1);
      const mid = pointAt(pts, cum, (a + b) / 2);
      const flip = !cw.centered && left.x + left.z < mid.x + mid.z ? -1 : 1;
      const count = Math.floor((2 * hw - 1.2) / cw.pitch + 1e-9) + 1;
      const first = cw.centered ? (-(count - 1) * cw.pitch) / 2 : -hw + 0.6;
      for (let k = 0; k < count; k++) {
        const o = flip * (first + k * cw.pitch);
        band(at(a, o), at(b, o), cw.bar, WHITE);
      }
    }

    /** Stop line across the lanes entering node `node`, square to their direction, at arc length s. */
    function stopLine(edge: RoadEdge, node: number, s: number): void {
      const incoming = city.lanesEntering(edge, node);
      if (!incoming.length) return;
      const l0 = city.lanes[incoming[0]];
      const c = pointAt(pts, cum, s);
      const u = { x: l0.endDir.z, z: -l0.endDir.x };
      const side = Math.sign((l0.end.x - c.x) * u.x + (l0.end.z - c.z) * u.z) || 1;
      // Across the travel lanes only: from the center line's edge out to the parking band (or the curb)
      const [o0, o1] = edge.oneWay ? [-hw + 0.2, hw - 0.2] : [Math.max(0.2, edge.median + 0.05), edge.parking > 0 ? travelHalf(edge) : hw - 0.2];
      const p = (o: number) => ({ x: c.x + u.x * side * o, z: c.z + u.z * side * o });
      band(p(o0), p(o1), 0.4, WHITE);
    }
  }

  // Parking lot bays (one stripe either side of each slot)
  for (const p of city.features.parking) {
    const dz = p.yaw === 0 ? 1 : -1;
    rectM(p.pos.x - 1.5, p.pos.z + dz * 0.2, 0.12, 5, LOT);
    rectM(p.pos.x + 1.5, p.pos.z + dz * 0.2, 0.12, 5, LOT);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
  return new THREE.Mesh(geo, mat);
}
