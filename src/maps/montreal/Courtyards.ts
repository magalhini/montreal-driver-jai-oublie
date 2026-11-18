import { hash01, Rng } from '../../core/Rng';
import type { AABB, Block, Building, Facing, Vec2 } from '../../types';
import type { CityPark } from '../../world/Features';
import { inner } from '../../world/Features';
import { partFaces, subtractRect } from '../../world/Interiors';
import type { CityModel } from '../../world/RoadGraph';

/**
 * Hollow courts behind the street wall are not how Montreal's lanes work. An alley that connects two
 * streets stays (`Alleys.ts`). Where that alley used to come out into an empty yard ringed by buildings,
 * a share of the large blocks get a garden in the middle: lawn, a crossing of paths, a lane in from each
 * street, trees, and sometimes a pavilion or a column. The buildings around it stay. The other blocks
 * stay built, so a through-lane runs between them the whole way.
 *
 * The garden is enclosed. The chase camera takes the driver's seat for the whole of it, lawn and lanes,
 * and gives the player's view back only once the car is on the street again (`enclosed`).
 */

const MIN_LAWN = 30;
/** Bigger than this, the middle stays built and the garden is a square you drive into, not the whole block. */
const MAX_LAWN = 72;
const GATE = 8;
const PATH = 5.4;
/** Share of large blocks that become a garden. Downtown stays mostly built, so the tower cluster holds. */
const RATE: Record<'downtown' | 'residential' | 'oldtown', number> = {
  downtown: 0.16,
  residential: 0.38,
  oldtown: 0.34,
};

const overlaps = (a: AABB, b: AABB, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
const grow = (b: AABB, m: number): AABB => ({ minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m });

export function layCourtyards(city: CityModel, seed: number): void {
  const parks = city.features.parks ?? [];
  for (const bl of city.blocks) {
    if (!eligible(city, bl)) continue;
    const rate = RATE[bl.district as 'downtown' | 'residential' | 'oldtown'];
    if (rate === undefined || hash01(bl.id, 23) >= rate) continue;
    const park = layout(city, bl, new Rng((seed + 53 + bl.id * 17) >>> 0));
    if (!park) continue;
    parks.push(park);
    city.features.driveways.push(park.gate, ...(park.gates ?? []));
  }
  city.features.parks = parks;
}

function eligible(city: CityModel, bl: Block): boolean {
  const f = city.features;
  if (f.kinds[bl.id] !== 'normal') return false;
  if (bl.gj === f.canal?.row) return false;
  return bl.district === 'residential' || bl.district === 'oldtown' || bl.district === 'downtown';
}

function buildingsIn(city: CityModel, bl: Block): Building[] {
  return city.buildings.filter((b) => {
    const x = (b.minX + b.maxX) / 2;
    const z = (b.minZ + b.maxZ) / 2;
    return x > bl.min.x && x < bl.max.x && z > bl.min.z && z < bl.max.z;
  });
}

/** How far the shallowest frontage on `side` reaches in from the sidewalk. The lawn starts there. */
function frontage(bl: Block, buildings: Building[], side: Facing): number {
  const r = inner(bl);
  let depth = Infinity;
  for (const b of buildings) {
    if (!b.faces.includes(side)) continue;
    const d = side === 'N' ? b.maxZ - r.minZ : side === 'S' ? r.maxZ - b.minZ : side === 'W' ? b.maxX - r.minX : r.maxX - b.minX;
    if (d > 0.5) depth = Math.min(depth, d);
  }
  if (!Number.isFinite(depth)) return 12;
  return Math.max(4, Math.min(26, depth));
}

function layout(city: CityModel, bl: Block, rng: Rng): CityPark | null {
  const here = buildingsIn(city, bl);
  const r = inner(bl);
  const avail: AABB = {
    minX: r.minX + frontage(bl, here, 'W'),
    maxX: r.maxX - frontage(bl, here, 'E'),
    minZ: r.minZ + frontage(bl, here, 'N'),
    maxZ: r.maxZ - frontage(bl, here, 'S'),
  };
  const aw = avail.maxX - avail.minX;
  const ad = avail.maxZ - avail.minZ;
  if (aw < MIN_LAWN || ad < MIN_LAWN) return null;
  // A long block keeps its inner buildings. The garden sits in the middle, and the gates are the lanes in.
  const lw = Math.min(MAX_LAWN, aw);
  const ld = Math.min(MAX_LAWN, ad);
  const cx = (avail.minX + avail.maxX) / 2;
  const cz = (avail.minZ + avail.maxZ) / 2;
  const lawn: AABB = { minX: cx - lw / 2, maxX: cx + lw / 2, minZ: cz - ld / 2, maxZ: cz + ld / 2 };

  const avoid = city.features.driveways;
  const gates: AABB[] = [];
  for (const side of ['N', 'S', 'E', 'W'] as Facing[]) {
    const g = fitGate(bl, lawn, side, [...avoid, ...gates]);
    if (g) gates.push(g);
  }
  // A road has to come out the other side. Adjacent gates only make a dead-end yard.
  const sides = new Set(gates.map((g) => gateSide(lawn, g)));
  const through = (sides.has('N') && sides.has('S')) || (sides.has('E') && sides.has('W'));
  if (!through) return null;

  const paths = walks(lawn, gates);
  const monument = placeMonument(bl, lawn, paths, rng);
  const trees = plant(lawn, paths, monument, rng);
  const lamps = placeLamps(lawn, paths);
  const benches = placeBenches(lawn, paths, monument);
  openGround(city, bl, lawn, gates);
  // The cuts are lanes: lamps and the map read them as alleys, and planAlleys leaves this block alone.
  for (const g of gates) {
    const side = gateSide(lawn, g);
    city.features.alleys.push({
      block: bl.id,
      axis: side === 'N' || side === 'S' ? 'z' : 'x',
      box: g,
    });
  }

  const post = (p: Vec2, rad: number): AABB => ({ minX: p.x - rad, maxX: p.x + rad, minZ: p.z - rad, maxZ: p.z + rad });
  const markBox = monument
    ? monument.kind === 'kiosk'
      ? post(monument.pos, 3.15)
      : post(monument.pos, 0.95)
    : null;
  return {
    block: bl.id,
    lawn,
    path: paths[0],
    paths: paths.slice(1),
    gate: gates[0],
    gates: gates.slice(1),
    enclosed: true,
    monument: monument ?? undefined,
    trees,
    lamps,
    benches,
    colliders: [...trees.map((t) => post(t.pos, 0.35)), ...lamps.map((p) => post(p, 0.16)), ...benches.map(benchBox), ...(markBox ? [markBox] : [])],
  };
}

/** Cut the lawn and the gates out of the block. Inner lots keep whatever the garden did not take. */
function openGround(city: CityModel, bl: Block, lawn: AABB, gates: AABB[]): void {
  const holes = [grow(lawn, 1.05), ...gates.map((g) => grow(g, 0.45))];
  const kept: Building[] = [];
  for (const b of city.buildings) {
    const x = (b.minX + b.maxX) / 2;
    const z = (b.minZ + b.maxZ) / 2;
    const inBlock = x > bl.min.x && x < bl.max.x && z > bl.min.z && z < bl.max.z;
    if (!inBlock) {
      kept.push(b);
      continue;
    }
    let parts: Building[] = [b];
    for (const h of holes) parts = parts.flatMap((p) => subtractRect(p, h));
    if (parts.length === 1 && parts[0] === b) {
      kept.push(b);
      continue;
    }
    for (const p of parts) {
      if (p.maxX - p.minX < 2.6 || p.maxZ - p.minZ < 2.6) continue;
      const faces = b.landmark ? b.faces : partFaces(b, p, 2);
      // A street building's offcut that no longer touches the street is debris. An inner lot keeps the part
      // the garden did not take, so the court around the lawn stays built.
      if (!b.landmark && b.faces.length > 0 && faces.length === 0) continue;
      const q: Building = { ...p, faces, seed: (b.seed + Math.imul(Math.round(p.minX), 13) + Math.imul(Math.round(p.minZ), 29)) >>> 0 };
      const t = q.tower;
      if (t && Math.min(q.maxX - q.minX, q.maxZ - q.minZ) < t.inset * 2 + 6) delete q.tower;
      kept.push(q);
    }
  }
  city.buildings = kept;
}

function fitGate(bl: Block, lawn: AABB, side: Facing, avoid: AABB[]): AABB | null {
  const ns = side === 'N' || side === 'S';
  const span0 = (ns ? lawn.minX : lawn.minZ) + GATE;
  const span1 = (ns ? lawn.maxX : lawn.maxZ) - GATE;
  if (span1 - span0 < GATE) return null;
  const mid = (span0 + span1) / 2;
  for (const shift of [0, -16, 16, -32, 32, -48, 48]) {
    const c = Math.max(span0 + GATE / 2, Math.min(span1 - GATE / 2, mid + shift));
    const g = gateAt(bl, lawn, side, c);
    if (avoid.every((d) => !overlaps(g, d, 2.5))) return g;
  }
  return null;
}

/** Which lawn edge the curb cut touches. The cut itself lies outside the grass, out to the street. */
function gateSide(lawn: AABB, g: AABB): Facing {
  if (g.maxZ <= lawn.minZ + 1.5) return 'N';
  if (g.minZ >= lawn.maxZ - 1.5) return 'S';
  if (g.maxX <= lawn.minX + 1.5) return 'W';
  return 'E';
}

function gateAt(bl: Block, lawn: AABB, side: Facing, c: number): AABB {
  const h = GATE / 2;
  if (side === 'N') return { minX: c - h, maxX: c + h, minZ: bl.min.z, maxZ: lawn.minZ };
  if (side === 'S') return { minX: c - h, maxX: c + h, minZ: lawn.maxZ, maxZ: bl.max.z };
  if (side === 'W') return { minX: bl.min.x, maxX: lawn.minX, minZ: c - h, maxZ: c + h };
  return { minX: lawn.maxX, maxX: bl.max.x, minZ: c - h, maxZ: c + h };
}

/** A cross through the middle, plus a short link where a gate had to slide off that line. */
function walks(lawn: AABB, gates: AABB[]): AABB[] {
  const mx = (lawn.minX + lawn.maxX) / 2;
  const mz = (lawn.minZ + lawn.maxZ) / 2;
  const h = PATH / 2;
  const ns: AABB = { minX: mx - h, maxX: mx + h, minZ: lawn.minZ, maxZ: lawn.maxZ };
  const out: AABB[] = [ns, { minX: lawn.minX, maxX: mx - h, minZ: mz - h, maxZ: mz + h }, { minX: mx + h, maxX: lawn.maxX, minZ: mz - h, maxZ: mz + h }];
  for (const g of gates) {
    const side = gateSide(lawn, g);
    if (side === 'N' || side === 'S') {
      const cx = (g.minX + g.maxX) / 2;
      if (Math.abs(cx - mx) < PATH) continue;
      out.push({
        minX: Math.min(cx, mx) - h,
        maxX: Math.max(cx, mx) + h,
        minZ: side === 'N' ? lawn.minZ : lawn.maxZ - PATH,
        maxZ: side === 'N' ? lawn.minZ + PATH : lawn.maxZ,
      });
    } else {
      const cz = (g.minZ + g.maxZ) / 2;
      if (Math.abs(cz - mz) < PATH) continue;
      out.push({
        minX: side === 'W' ? lawn.minX : lawn.maxX - PATH,
        maxX: side === 'W' ? lawn.minX + PATH : lawn.maxX,
        minZ: Math.min(cz, mz) - h,
        maxZ: Math.max(cz, mz) + h,
      });
    }
  }
  return out.filter((p) => p.maxX - p.minX > 1 && p.maxZ - p.minZ > 1);
}

function placeMonument(bl: Block, lawn: AABB, paths: AABB[], rng: Rng): CityPark['monument'] | null {
  const w = lawn.maxX - lawn.minX;
  const d = lawn.maxZ - lawn.minZ;
  if (Math.min(w, d) < 36) return null;
  const mx = (lawn.minX + lawn.maxX) / 2;
  const mz = (lawn.minZ + lawn.maxZ) / 2;
  const kind = hash01(bl.id, 29) < 0.55 ? 'kiosk' : 'column';
  const reach = kind === 'kiosk' ? 9.5 : 6;
  const sx = rng.chance(0.5) ? 1 : -1;
  const sz = rng.chance(0.5) ? 1 : -1;
  const pos = { x: mx + sx * Math.min(w * 0.28, 18), z: mz + sz * Math.min(d * 0.28, 18) };
  const pad = kind === 'kiosk' ? 4.2 : 2.2;
  if (paths.some((p) => overlaps(p, { minX: pos.x - pad, maxX: pos.x + pad, minZ: pos.z - pad, maxZ: pos.z + pad }))) {
    pos.x = mx + sx * Math.min(w * 0.34, 22);
    pos.z = mz + sz * Math.min(d * 0.18, 12);
  }
  if (pos.x < lawn.minX + reach || pos.x > lawn.maxX - reach || pos.z < lawn.minZ + reach || pos.z > lawn.maxZ - reach) return null;
  return { kind, pos };
}

function hits(p: Vec2, box: AABB, m: number): boolean {
  return p.x > box.minX - m && p.x < box.maxX + m && p.z > box.minZ - m && p.z < box.maxZ + m;
}

function plant(lawn: AABB, paths: AABB[], monument: CityPark['monument'] | null, rng: Rng): CityPark['trees'] {
  const trees: CityPark['trees'] = [];
  const step = Math.min(lawn.maxX - lawn.minX, lawn.maxZ - lawn.minZ) > 80 ? 13 : 10;
  for (let x = lawn.minX + 5; x < lawn.maxX - 4; x += step) {
    for (let z = lawn.minZ + 5; z < lawn.maxZ - 4; z += step) {
      const p = { x: x + rng.range(-1.6, 1.6), z: z + rng.range(-1.6, 1.6) };
      if (p.x < lawn.minX + 2.6 || p.x > lawn.maxX - 2.6 || p.z < lawn.minZ + 2.6 || p.z > lawn.maxZ - 2.6) continue;
      if (rng.chance(0.16)) continue;
      if (paths.some((path) => hits(p, path, 2.8))) continue;
      if (monument) {
        const need = monument.kind === 'kiosk' ? 6.2 : 3.4;
        if (Math.hypot(p.x - monument.pos.x, p.z - monument.pos.z) < need) continue;
      }
      trees.push({ pos: p, r: rng.range(2.2, 3.4) });
    }
  }
  return trees;
}

function placeLamps(lawn: AABB, paths: AABB[]): Vec2[] {
  const inset = 3.4;
  const pts: Vec2[] = [
    { x: lawn.minX + inset, z: lawn.minZ + inset },
    { x: lawn.maxX - inset, z: lawn.minZ + inset },
    { x: lawn.minX + inset, z: lawn.maxZ - inset },
    { x: lawn.maxX - inset, z: lawn.maxZ - inset },
  ];
  const w = lawn.maxX - lawn.minX;
  const d = lawn.maxZ - lawn.minZ;
  if (w > 48) {
    pts.push({ x: (lawn.minX + lawn.maxX) / 2, z: lawn.minZ + inset }, { x: (lawn.minX + lawn.maxX) / 2, z: lawn.maxZ - inset });
  }
  if (d > 48) {
    pts.push({ x: lawn.minX + inset, z: (lawn.minZ + lawn.maxZ) / 2 }, { x: lawn.maxX - inset, z: (lawn.minZ + lawn.maxZ) / 2 });
  }
  return pts.filter((p) => paths.every((path) => !hits(p, path, 1.6)));
}

function placeBenches(lawn: AABB, paths: AABB[], monument: CityPark['monument'] | null): CityPark['benches'] {
  const mx = (lawn.minX + lawn.maxX) / 2;
  const mz = (lawn.minZ + lawn.maxZ) / 2;
  const off = PATH / 2 + 1.6;
  const along = Math.min(14, (lawn.maxZ - lawn.minZ) * 0.22);
  const spots: CityPark['benches'] = [
    { pos: { x: mx - off, z: mz - along }, yaw: Math.PI / 2 },
    { pos: { x: mx + off, z: mz - along }, yaw: -Math.PI / 2 },
    { pos: { x: mx - off, z: mz + along }, yaw: Math.PI / 2 },
    { pos: { x: mx + off, z: mz + along }, yaw: -Math.PI / 2 },
  ];
  return spots.filter((b) => {
    if (b.pos.x < lawn.minX + 2 || b.pos.x > lawn.maxX - 2 || b.pos.z < lawn.minZ + 2 || b.pos.z > lawn.maxZ - 2) return false;
    if (paths.some((path) => hits(b.pos, path, 0.8))) return false;
    if (!monument) return true;
    const need = monument.kind === 'kiosk' ? 5.5 : 2.6;
    return Math.hypot(b.pos.x - monument.pos.x, b.pos.z - monument.pos.z) > need;
  });
}

function benchBox(b: CityPark['benches'][number]): AABB {
  const hx = Math.abs(Math.cos(b.yaw)) * 0.9 + 0.35;
  const hz = Math.abs(Math.sin(b.yaw)) * 0.9 + 0.35;
  return { minX: b.pos.x - hx, maxX: b.pos.x + hx, minZ: b.pos.z - hz, maxZ: b.pos.z + hz };
}
