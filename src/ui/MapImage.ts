import { CONFIG } from '../config';
import type { Block, DistrictType, RoadEdge, Vec2 } from '../types';
import { inner } from '../world/Features';
import { DESTINATION_GARAGE } from '../world/PitStops';
import type { CityModel } from '../world/RoadGraph';

/** Pixels per meter of the pre-rendered map. */
const PPM = 2;
/** World margin drawn around the drivable bounds (outer skyline, harbor water). */
const MARGIN = 70;
/** Elevation tint sample spacing (m). */
const ELEV_STEP = 4;

const C = {
  void: '#06040e',
  outer: '#0b0918',
  water: '#0a1c36',
  quay: '#2e6db0',
  sidewalk: '#1c1932',
  road: '#5c6186',
  avenue: '#7d83b0',
  lot: '#191826',
  bay: 'rgba(255, 255, 255, 0.22)',
  interior: '#5a2350',
  alley: '#454a6e',
  passage: '#2c2f4c',
  passageEdge: 'rgba(160, 168, 220, 0.55)',
  park: '#14321e',
  plaza: '#3a3848',
  gravel: '#5e5a54',
  pitStop: '#2a2633',
  canopy: '#e8e6f0',
};

const GROUND: Record<DistrictType, string> = {
  downtown: '#211538',
  shotengai: '#2a1230',
  harbor: '#0e2129',
  residential: '#131629',
  depot: '#2c210d',
};
/** Building footprint color at low / high rise. */
const BUILDING: Record<DistrictType, [number, number, number]> = {
  downtown: [70, 46, 120],
  shotengai: [92, 38, 88],
  harbor: [34, 72, 82],
  residential: [42, 50, 84],
  depot: [96, 74, 30],
};

/** Pre-rendered top-down city: north (-z) up, east (+x) right. `x0`, `z0` = world position of the top-left pixel. */
export interface MapImage {
  canvas: HTMLCanvasElement;
  x0: number;
  z0: number;
  /** World size covered (m). */
  width: number;
  height: number;
}

export interface MapLabel {
  text: string;
  sub?: string;
  pos: Vec2;
  kind: 'district' | 'landmark';
}

/** Draws the static city once: ground by district, elevation tint, buildings, water, roads, lots and ramps. */
export function buildMapImage(city: CityModel): MapImage {
  const b = city.bounds;
  const x0 = b.minX - MARGIN;
  const z0 = b.minZ - MARGIN;
  const width = b.maxX - b.minX + MARGIN * 2;
  const height = b.maxZ - b.minZ + MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * PPM);
  canvas.height = Math.ceil(height * PPM);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(PPM, 0, 0, PPM, -x0 * PPM, -z0 * PPM);
  const rect = (minX: number, minZ: number, maxX: number, maxZ: number) => ctx.fillRect(minX, minZ, maxX - minX, maxZ - minZ);

  ctx.fillStyle = C.void;
  rect(x0, z0, x0 + width, z0 + height);
  ctx.fillStyle = C.outer;
  rect(b.minX, b.minZ, b.maxX, b.maxZ);

  // Blocks: sidewalk ring, then the district ground (lots get their own surface)
  const f = city.features;
  for (const blk of city.blocks) {
    ctx.fillStyle = C.sidewalk;
    rect(blk.min.x, blk.min.z, blk.max.x, blk.max.z);
    const r = inner(blk);
    const kind = f.kinds[blk.id];
    ctx.fillStyle = kind === 'lot' ? C.lot : GROUND[blk.district];
    rect(r.minX, r.minZ, r.maxX, r.maxZ);
  }
  // Pit stop forecourts (IMPROVEMENTS #20), before the buildings so the kiosk shows on top
  ctx.fillStyle = C.pitStop;
  for (const s of f.pitStops) rect(s.box.minX, s.box.minZ, s.box.maxX, s.box.maxZ);
  drawElevation(ctx, city);

  // Gardens: the gate, the lawn and the path. Trees are drawn over the buildings.
  for (const park of f.parks ?? []) {
    ctx.fillStyle = C.gravel;
    rect(park.gate.minX, park.gate.minZ, park.gate.maxX, park.gate.maxZ);
    ctx.fillStyle = C.park;
    rect(park.lawn.minX, park.lawn.minZ, park.lawn.maxX, park.lawn.maxZ);
    ctx.fillStyle = C.gravel;
    rect(park.path.minX, park.path.minZ, park.path.maxX, park.path.maxZ);
  }

  // Buildings: taller reads brighter
  // Pedestrian squares (paving, the fountain) and the Old Port (lawns, the walk, the lot and its curb cuts)
  for (const sq of f.squares ?? []) {
    ctx.fillStyle = C.plaza;
    rect(sq.plaza.minX, sq.plaza.minZ, sq.plaza.maxX, sq.plaza.maxZ);
    ctx.fillStyle = C.park;
    for (const l of sq.lawns) rect(l.minX, l.minZ, l.maxX, l.maxZ);
    ctx.fillStyle = C.water;
    ctx.beginPath();
    ctx.arc(sq.fountain.pos.x, sq.fountain.pos.z, sq.fountain.r, 0, Math.PI * 2);
    ctx.fill();
  }
  const port = f.port;
  if (port) {
    ctx.fillStyle = C.plaza;
    rect(port.walk.minX, port.walk.minZ, port.walk.maxX, port.walk.maxZ);
    ctx.fillStyle = C.park;
    for (const l of port.lawns) rect(l.minX, l.minZ, l.maxX, l.maxZ);
    ctx.fillStyle = C.lot;
    rect(port.lot.minX, port.lot.minZ, port.lot.maxX, port.lot.maxZ);
    for (const m of port.mouths) rect(m.minX, m.minZ, m.maxX, m.maxZ);
  }

  for (const bd of city.buildings) {
    const inset = 0.6;
    if (bd.custom) {
      // Stone landmarks read pale on the map
      ctx.fillStyle = 'rgb(176, 166, 150)';
      rect(bd.minX + 0.3, bd.minZ + 0.3, bd.maxX - 0.3, bd.maxZ - 0.3);
      continue;
    }
    if (bd.scramble) {
      ctx.fillStyle = 'rgb(168, 206, 255)';
      rect(bd.minX + inset, bd.minZ + inset, bd.maxX - inset, bd.maxZ - inset);
      if (bd.tower) {
        const i = bd.tower.inset;
        ctx.fillStyle = 'rgb(214, 232, 255)';
        rect(bd.minX + i, bd.minZ + i, bd.maxX - i, bd.maxZ - i);
      }
      continue;
    }
    const [r, g, bl] = BUILDING[bd.district];
    const k = 0.5 + Math.min(1, bd.height / 90) * 0.55;
    ctx.fillStyle = `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(bl * k)})`;
    rect(bd.minX + inset, bd.minZ + inset, bd.maxX - inset, bd.maxZ - inset);
  }
  for (const d of [...(f.squares ?? []), ...(port ? [port] : [])]) {
    ctx.fillStyle = 'rgba(160, 170, 180, 0.75)';
    for (const t of d.trees) rect(t.x - 1.3, t.z - 1.3, t.x + 1.3, t.z + 1.3);
  }
  for (const park of f.parks ?? []) {
    for (const t of park.trees) {
      ctx.fillStyle = t.pink ? 'rgba(242, 166, 200, 0.7)' : 'rgba(36, 78, 48, 0.85)';
      rect(t.pos.x - 1.5, t.pos.z - 1.5, t.pos.x + 1.5, t.pos.z + 1.5);
    }
  }

  // Alleys through the blocks (IMPROVEMENTS #19): narrow lanes, darker where they run under a building
  for (const a of f.alleys) {
    ctx.fillStyle = C.alley;
    rect(a.box.minX, a.box.minZ, a.box.maxX, a.box.maxZ);
  }

  // Semi-indoor areas that aren't secret (home garage, passages): their floor shows through the building.
  // Hidden nooks stay off the map.
  for (const r of f.interiors) {
    if (r.hidden) continue;
    const b = r.box;
    if (r.kind === 'passage') {
      ctx.fillStyle = C.passage;
      rect(b.minX, b.minZ, b.maxX, b.maxZ);
      // the walls along the passage
      ctx.fillStyle = C.passageEdge;
      const ns = r.doors[0].side === 'N' || r.doors[0].side === 'S';
      if (ns) {
        rect(b.minX, b.minZ, b.minX + 0.7, b.maxZ);
        rect(b.maxX - 0.7, b.minZ, b.maxX, b.maxZ);
      } else {
        rect(b.minX, b.minZ, b.maxX, b.minZ + 0.7);
        rect(b.minX, b.maxZ - 0.7, b.maxX, b.maxZ);
      }
      continue;
    }
    ctx.fillStyle = C.interior;
    rect(b.minX, b.minZ, b.maxX, b.maxZ);
  }

  // Water: harbor to the south, canal across one block row (bridges are drawn over it with the roads)
  ctx.fillStyle = C.water;
  rect(x0, city.waterZ, x0 + width, z0 + height);
  const canal = f.canal;
  if (canal) rect(x0, canal.z0, x0 + width, canal.z1);
  ctx.fillStyle = C.quay;
  rect(x0, city.waterZ, x0 + width, city.waterZ + 1.2);
  if (canal) {
    rect(x0, canal.z0, x0 + width, canal.z0 + 0.8);
    rect(x0, canal.z1 - 0.8, x0 + width, canal.z1);
  }
  // Roads: side streets, then avenues on top, then junction boxes
  const edges = [...city.edges].sort((p, q) => Number(p.avenue) - Number(q.avenue));
  for (const e of edges) {
    const a = city.nodes[e.a].pos;
    const c = city.nodes[e.b].pos;
    const hw = e.width / 2;
    ctx.fillStyle = e.avenue ? C.avenue : C.road;
    if (e.axis === 'x') rect(Math.min(a.x, c.x), a.z - hw, Math.max(a.x, c.x), a.z + hw);
    else rect(a.x - hw, Math.min(a.z, c.z), a.x + hw, Math.max(a.z, c.z));
  }
  for (const n of city.nodes) {
    ctx.fillStyle = n.edges.some((id) => city.edges[id].avenue) ? C.avenue : C.road;
    rect(n.pos.x - n.hx, n.pos.z - n.hz, n.pos.x + n.hx, n.pos.z + n.hz);
  }

  // The precinct: its lot, the cruiser bays and the building
  const station = f.station;
  if (station) {
    ctx.fillStyle = '#141c30';
    rect(station.lot.minX, station.lot.minZ, station.lot.maxX, station.lot.maxZ);
    ctx.fillStyle = 'rgba(106, 166, 255, 0.4)';
    for (const b of station.bays) rect(b.x - 1.3, b.z - 2.6, b.x + 1.3, b.z + 2.6);
    const sb = station.building;
    ctx.fillStyle = '#2a4a88';
    rect(sb.minX, sb.minZ, sb.maxX, sb.maxZ);
  }
  // Pit stop canopies
  ctx.fillStyle = C.canopy;
  for (const s of f.pitStops) rect(s.canopy.minX, s.canopy.minZ, s.canopy.maxX, s.canopy.maxZ);

  // Parking bays
  ctx.fillStyle = C.bay;
  for (const s of f.parking) rect(s.pos.x - 1.15, s.pos.z - 2.4, s.pos.x + 1.15, s.pos.z + 2.4);
  return { canvas, x0, z0, width, height };
}

/** Elevation tint: ground lightens and warms with height, so the hills read on the map without edge artifacts. */
function drawElevation(ctx: CanvasRenderingContext2D, city: CityModel): void {
  const t = city.terrain;
  const b = city.bounds;
  const nx = Math.ceil((b.maxX - b.minX) / ELEV_STEP) + 1;
  const nz = Math.ceil((b.maxZ - b.minZ) / ELEV_STEP) + 1;
  const canal = city.features.canal;
  const img = new ImageData(nx, nz);
  for (let j = 0; j < nz; j++) {
    const z = b.minZ + j * ELEV_STEP;
    if (z > city.waterZ || (canal && z > canal.z0 - 2 && z < canal.z1 + 2)) continue;
    for (let i = 0; i < nx; i++) {
      const h = t.heightAt(b.minX + i * ELEV_STEP, z);
      if (h < 1) continue;
      const k = Math.min(1, h / 22);
      const o = (j * nx + i) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 190 + 40 * k;
      img.data[o + 2] = 150;
      img.data[o + 3] = Math.round(k * 0.2 * 255);
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = nx;
  tmp.height = nz;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, b.minX - ELEV_STEP / 2, b.minZ - ELEV_STEP / 2, nx * ELEV_STEP, nz * ELEV_STEP);
  ctx.restore();
}

/**
 * Player-facing neighbourhood names (PRD 4.3). The sim's district ids stay; one id can be two places: the
 * old-city shops south of Notre-Dame vs the latin quarter band, the homes west of downtown vs Griffintown.
 * `gi` / `gj` are the area's centroid in blocks.
 */
function districtName(d: DistrictType, gi: number, gj: number, gx: number): string {
  const southOfNotreDame = gj >= 8;
  switch (d) {
    case 'downtown':
      return 'CENTRE-VILLE';
    case 'shotengai':
      return southOfNotreDame ? 'VIEUX-MONTRÉAL' : 'QUARTIER LATIN';
    case 'residential':
      return southOfNotreDame ? 'GRIFFINTOWN' : gi < gx / 2 ? 'SHAUGHNESSY' : 'QUARTIER DES SPECTACLES';
    case 'harbor':
      return 'VIEUX-PORT';
    case 'depot':
      return 'GARAGE';
  }
}

/** A straight run of one named boulevard, junction to junction, labelled on the minimap and the full map. */
export interface StreetLabel {
  text: string;
  a: Vec2;
  b: Vec2;
}

/** The long boulevards by name (PRD Phase 4): one run per stretch of a row or column that is boulevard. */
export function streetLabels(city: CityModel): StreetLabel[] {
  const groups = new Map<string, RoadEdge[]>();
  for (const e of city.edges) {
    if (!e.avenue || !e.name) continue;
    const key = `${e.axis}|${e.name.name}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(e);
  }
  const out: StreetLabel[] = [];
  for (const edges of groups.values()) {
    const coord = (e: RoadEdge) => (e.axis === 'x' ? city.nodes[e.a].pos.x : city.nodes[e.a].pos.z);
    edges.sort((p, q) => coord(p) - coord(q));
    let run: RoadEdge[] = [];
    const flush = () => {
      if (!run.length) return;
      out.push({ text: run[0].name!.name.toUpperCase(), a: city.nodes[run[0].a].pos, b: city.nodes[run[run.length - 1].b].pos });
      run = [];
    };
    for (const e of edges) {
      if (run.length && run[run.length - 1].b !== e.a) flush();
      run.push(e);
    }
    flush();
  }
  return out;
}

const center = (b: Block): Vec2 => ({ x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2 });

/**
 * Full map labels: one per district area (connected blocks of a district; the residential ring is split by
 * quadrant), plus landmarks (arcades, canal, canal jump, stunt yard, parking, hills).
 */
export function mapLabels(city: CityModel): MapLabel[] {
  const out: MapLabel[] = [];
  const gx = city.nx - 1;
  const gz = city.nz - 1;
  const seen = new Set<number>();
  for (const start of city.blocks) {
    if (seen.has(start.id)) continue;
    const group: Block[] = [];
    const stack = [start];
    seen.add(start.id);
    while (stack.length) {
      const b = stack.pop()!;
      group.push(b);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = b.gi + di;
        const j = b.gj + dj;
        if (i < 0 || j < 0 || i >= gx || j >= gz) continue;
        const n = city.blocks[j * gx + i];
        if (n.district === start.district && !seen.has(n.id)) {
          seen.add(n.id);
          stack.push(n);
        }
      }
    }
    const parts =
      start.district === 'residential' && group.length > 10
        ? [0, 1, 2, 3].map((q) => group.filter((b) => (b.gi < gx / 2 ? 0 : 1) + (b.gj < gz / 2 ? 0 : 2) === q))
        : [group];
    for (const part of parts) {
      if (part.length < (start.district === 'shotengai' || start.district === 'residential' ? 2 : 1)) continue;
      // Anchor at the block nearest the area's centroid (stays inside L / ring shapes)
      const cs = part.map(center);
      const cx = cs.reduce((s, c) => s + c.x, 0) / cs.length;
      const cz = cs.reduce((s, c) => s + c.z, 0) / cs.length;
      let best = cs[0];
      for (const c of cs) if (Math.hypot(c.x - cx, c.z - cz) < Math.hypot(best.x - cx, best.z - cz)) best = c;
      const gi = part.reduce((s, b) => s + b.gi, 0) / part.length;
      const gj = part.reduce((s, b) => s + b.gj, 0) / part.length;
      out.push({ text: districtName(start.district, gi, gj, gx), pos: best, kind: 'district' });
    }
  }

  const f = city.features;
  f.kinds.forEach((k, id) => {
    if (k === 'lot') out.push({ text: 'PARKING', pos: center(city.blocks[id]), kind: 'landmark' });
  });
  for (const s of f.pitStops) {
    const jacques = s.name === DESTINATION_GARAGE;
    out.push({
      text: jacques ? 'JACQUES PNEU' : s.name.toUpperCase(),
      sub: 'garage',
      // North of the lot, so the mission pin on the service circle does not sit on the words
      pos: { x: (s.box.minX + s.box.maxX) / 2, z: (jacques ? s.box.minZ - 24 : (s.box.minZ + s.box.maxZ) / 2) },
      kind: 'landmark',
    });
  }
  // The basilica and the square in front of it are one label (they are a block apart: two would collide)
  const nd = f.basilica;
  const armes = f.squares?.find((q) => q.name);
  if (nd) out.push({ text: 'BASILIQUE NOTRE-DAME', sub: armes?.name, pos: { x: (nd.minX + nd.maxX) / 2, z: nd.minZ }, kind: 'landmark' });
  if (f.port) {
    const w = f.port.walk;
    out.push({ text: 'PROMENADE DU VIEUX-PORT', sub: 'piétons seulement', pos: { x: (w.minX + w.maxX) / 2 - 300, z: (w.minZ + w.maxZ) / 2 }, kind: 'landmark' });
  }
  // The lot sits right beside the clock tower: one label for both
  if (f.clock) out.push({ text: "TOUR DE L'HORLOGE", sub: f.port ? 'parking' : undefined, pos: { ...f.clock.pos }, kind: 'landmark' });
  if (f.canal) {
    const i = Math.floor(gx * 0.75);
    out.push({ text: f.canal.label ?? 'CANAL DE LACHINE', sub: f.canal.labelSub, pos: { x: (city.xs[i] + city.xs[i + 1]) / 2, z: f.canal.zc }, kind: 'landmark' });
  }
  // Highest junction on each half of the city, if it is a real hill
  for (const west of [true, false]) {
    let top: Vec2 | null = null;
    let topH = 8;
    for (const n of city.nodes) {
      if (n.pos.x < 0 !== west) continue;
      const hh = city.terrain.heightAt(n.pos.x, n.pos.z);
      if (hh > topH) {
        topH = hh;
        top = n.pos;
      }
    }
    if (top) out.push({ text: west ? 'HILLS' : 'RIDGE', sub: `▲ ${Math.round(topH)} m`, pos: { x: top.x + CONFIG.SIDEWALK * 6, z: top.z + CONFIG.SIDEWALK * 6 }, kind: 'landmark' });
  }
  return out;
}
