import { Rng } from '../core/Rng';
import type { RoadEdge, StreetClass, Vec2 } from '../types';
import { cumulative, pointAt, tangentAt } from './Polyline';
import { laneOffset, travelHalf, type CityModel } from './RoadGraph';
import { surfaceAt } from './Surfaces';

/**
 * Potholes (PRD 5.4, Phase 6): pure data on the road edges, rolled once from the city seed. Some edges roll
 * none, streets and cobbles roll more than boulevards, and a few edges roll a cluster of five or six craters
 * in one junction approach. The GPS and the maps do not know about them. Drawn by `PotholeView.ts`, hit by
 * `gameplay/PotholeHits.ts`.
 */
export type PitDepth = 'small' | 'big';

export interface Pothole {
  id: number;
  edge: number;
  /** Arc length along the edge's centerline (m) and offset from it (m, + = left of a -> b). */
  s: number;
  lat: number;
  pos: Vec2;
  /** Radius of the crater (m), 0.6 .. 2.2. */
  r: number;
  depth: PitDepth;
}

/** How the roll treats each street class. Playtest numbers. */
export const POTHOLE_ROLL: Record<StreetClass, { empty: number; max: number; cluster: number; bigShare: number; maxR: number; extra: number }> = {
  /**
   * Share of edges with no holes at all, most holes on a 150 m block, chance of a cluster, share of big ones,
   * largest radius, and a share of holes added on top. About 20% more than the previous roll (boulevards
   * were already at +20%, so their extra is 0.44).
   */
  boulevard: { empty: 0.6, max: 2, cluster: 0.05, bigShare: 0.3, maxR: 2.2, extra: 0.44 },
  street: { empty: 0.3, max: 3, cluster: 0.14, bigShare: 0.4, maxR: 2.0, extra: 0.2 },
  cobble: { empty: 0.2, max: 5, cluster: 0.22, bigShare: 0.35, maxR: 1.5, extra: 0.2 },
};

const SALT = 0x9071e;
/** Keep holes this far (m) from the junction boxes at the ends of an edge. */
const END_GAP = 2;
const CELL = 8;
/** Extra holes keep this far (m) from the centerline, clear of the boulevard islands. */
const CENTER_STRIP = 0.8;

/** Rolls the session's potholes (deterministic for a seed). */
export function rollPotholes(city: CityModel, seed: number): Pothole[] {
  const rng = new Rng((seed ^ SALT) >>> 0);
  const out: Pothole[] = [];
  for (const e of city.edges) {
    const roll = POTHOLE_ROLL[e.cls];
    const cum = cumulative(e.pts);
    const L = cum[cum.length - 1];
    const empty = rng.chance(roll.empty);
    const clustered = rng.chance(roll.cluster);
    const scaled = Math.round(rng.int(1, roll.max) * Math.min(1.5, Math.max(0.6, L / 150)));
    if (L < 2 * END_GAP + 8) continue;
    const mine: Pothole[] = [];
    const place = (s: number, lat: number, r: number, depth: PitDepth, packed: boolean): boolean =>
      tryPlace(city, e, cum, mine, out.length + mine.length, s, lat, r, depth, packed ? 0.75 : 1.3);
    if (clustered) {
      // Five or six craters in one junction approach, packed into the lanes just before the stop line
      const n = rng.int(5, 6);
      const atEnd = rng.chance(0.5);
      const side = rng.sign();
      const centre = rng.range(7, 16);
      for (let k = 0, tries = 0; k < n && tries < 30; tries++) {
        const { r, depth } = rollSize(rng, roll, rng.chance(roll.bigShare + 0.15));
        const along = centre + rng.range(-6, 6);
        const s = atEnd ? L - along : along;
        if (place(s, side * laneLat(e, rng, r), r, depth, true)) k++;
      }
    }
    if (!empty) {
      for (let k = 0, tries = 0; k < scaled && tries < 20; tries++) {
        const { r, depth } = rollSize(rng, roll, rng.chance(roll.bigShare));
        if (place(rng.range(END_GAP, L - END_GAP), rng.sign() * laneLat(e, rng, r), r, depth, false)) k++;
      }
    }
    out.push(...mine);
  }
  addExtra(city, seed, out);
  return out;
}

/**
 * Classes with `extra` > 0 get that share of their holes again, scattered over their roads by length, from a
 * stream of their own. A pass on top, so the holes rolled above stay exactly where they were.
 */
function addExtra(city: CityModel, seed: number, out: Pothole[]): void {
  const rng = new Rng((seed ^ SALT ^ 0x5e7a) >>> 0);
  const byEdge = new Map<number, Pothole[]>();
  for (const p of out) {
    let list = byEdge.get(p.edge);
    if (!list) byEdge.set(p.edge, (list = []));
    list.push(p);
  }
  for (const cls of Object.keys(POTHOLE_ROLL) as StreetClass[]) {
    const roll = POTHOLE_ROLL[cls];
    if (roll.extra <= 0) continue;
    const edges = city.edges.filter((e) => e.cls === cls && e.length > 2 * END_GAP + 8);
    if (!edges.length) continue;
    const want = Math.round(out.filter((p) => city.edges[p.edge].cls === cls).length * roll.extra);
    // Shared out between the roads (Peel, Wellington, ...) by length, largest remainders first, so every one
    // gets its part rather than whatever the dice give it
    const roads = new Map<string, RoadEdge[]>();
    for (const e of edges) {
      const key = e.name?.name ?? `#${e.id}`;
      let list = roads.get(key);
      if (!list) roads.set(key, (list = []));
      list.push(e);
    }
    const total = edges.reduce((a, e) => a + e.length, 0);
    const shares = [...roads.values()].map((list) => {
      const len = list.reduce((a, e) => a + e.length, 0);
      const exact = (want * len) / total;
      return { list, len, n: Math.floor(exact), rest: exact - Math.floor(exact) };
    });
    const left = want - shares.reduce((a, x) => a + x.n, 0);
    [...shares].sort((x, y) => y.rest - x.rest).slice(0, left).forEach((x) => x.n++);
    for (const { list: road, len, n } of shares) {
      for (let k = 0, tries = 0; k < n && tries < n * 10; tries++) {
        // An edge of this road picked by length
        let u = rng.next() * len;
        const e = road.find((x) => (u -= x.length) < 0) ?? road[road.length - 1];
        const cum = cumulative(e.pts);
        const L = cum[cum.length - 1];
        const list = byEdge.get(e.id) ?? [];
        const { r, depth } = rollSize(rng, roll, rng.chance(roll.bigShare));
        const lat = rng.sign() * laneLat(e, rng, r);
        // Off the center strip, where the boulevards' planted islands go (`BoulevardMedians` keeps clear of holes)
        if (Math.abs(lat) - r < CENTER_STRIP) continue;
        if (!tryPlace(city, e, cum, list, out.length, rng.range(END_GAP, L - END_GAP), lat, r, depth, 1.3)) continue;
        byEdge.set(e.id, list);
        out.push(list[list.length - 1]);
        k++;
      }
    }
  }
}

/** Radius and depth class for a new hole. */
function rollSize(rng: Rng, roll: (typeof POTHOLE_ROLL)[StreetClass], big: boolean): { r: number; depth: PitDepth } {
  const r = big ? rng.range(1.1, roll.maxR) : rng.range(0.6, 1.1);
  return { r: Math.min(r, roll.maxR), depth: big ? 'big' : 'small' };
}

/** Adds a hole to `list` if it fits: inside the edge, on the road, and `gap` x the radii clear of the others. */
function tryPlace(city: CityModel, e: RoadEdge, cum: number[], list: Pothole[], id: number, s: number, lat: number, r: number, depth: PitDepth, gap: number): boolean {
  const L = cum[cum.length - 1];
  if (s < END_GAP + r || s > L - END_GAP - r) return false;
  const pos = edgePoint(e, cum, s, lat);
  if (surfaceAt(city, pos) !== 'road') return false;
  for (const q of list) if (Math.hypot(q.pos.x - pos.x, q.pos.z - pos.z) < (q.r + r) * gap) return false;
  list.push({ id, edge: e.id, s, lat, pos, r, depth });
  return true;
}

/**
 * Distance from the centerline (unsigned) for a hole of radius r: in a travel lane, around where the wheels
 * run, kept off the parking band. One-way edges: their lanes span the road, so it stays inside the half.
 */
function laneLat(e: RoadEdge, rng: Rng, r: number): number {
  const half = e.oneWay ? e.width / 2 - e.parking : travelHalf(e);
  const lane = laneOffset(e, rng.int(0, Math.max(0, e.lanesPerDir - 1)));
  const lat = lane + rng.range(-1.3, 1.3);
  return Math.min(half - r * 0.6, Math.max(e.median + r * 0.3, lat));
}

function edgePoint(e: RoadEdge, cum: number[], s: number, lat: number): Vec2 {
  const p = pointAt(e.pts, cum, s);
  const t = tangentAt(e.pts, cum, s);
  // left of the direction (`leftVec`): (dz, -dx)
  return { x: p.x + t.z * lat, z: p.z - t.x * lat };
}

/** The rolled holes and a uniform hash for "which pits are near this point". */
export class Potholes {
  readonly pits: Pothole[];
  private readonly cells = new Map<number, Pothole[]>();
  private static readonly NONE: readonly Pothole[] = [];

  constructor(city: CityModel, seed: number) {
    this.pits = rollPotholes(city, seed);
    for (const p of this.pits) {
      const i0 = Math.floor((p.pos.x - p.r) / CELL);
      const i1 = Math.floor((p.pos.x + p.r) / CELL);
      const j0 = Math.floor((p.pos.z - p.r) / CELL);
      const j1 = Math.floor((p.pos.z + p.r) / CELL);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const k = key(i, j);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(p);
        }
    }
  }

  /** Pits whose crater reaches the 8 m cell holding p (a superset of the pits under p). */
  at(x: number, z: number): readonly Pothole[] {
    return this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? Potholes.NONE;
  }
}

const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
