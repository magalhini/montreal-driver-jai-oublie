import { CONFIG, KMH } from '../../config';
import { leftVec, scale } from '../../core/math';
import { Rng } from '../../core/Rng';
import type { Block, Building, Lane, RoadEdge, RoadNode, Vec2 } from '../../types';
import { planAlleys } from '../../world/Alleys';
import { generateBuildings } from '../../world/Districts';
import { settleBuildings } from '../../world/Settle';
import { emptyFeatures } from '../../world/Features';
import { planDepot } from '../../world/Depot';
import { planPitStops } from '../../world/PitStops';
import { planPoliceStation } from '../../world/PoliceStation';
import { CityModel } from '../../world/RoadGraph';
import { dressSkyline } from '../../world/Skyline';
import { Terrain } from '../../world/Terrain';
import { layHarbor, openHarbor } from './Harbor';
import { fitHeights, openCourtyards, placeArena, placeClock, placeSilos } from './Massing';
import { layParks } from './Parks';
import { ARENA, CANAL_ROW, CLOCK, SILOS, X_RAW, Z_RAW, avenueX, avenueZ, districtAt, heightOf, isPark } from './layout';

const OUTER = 28;

/**
 * Downtown Montreal, Guy to Saint-Hubert, Sherbrooke to the river: real block spacing, gardens instead of
 * whole-block lawns, the Lachine Canal as the east-west water, a paved lane along the quay, and roof heights
 * taken from the blocks. Lanes follow `CONFIG.DRIVE_SIDE` (right-hand traffic).
 */
export function generateMontreal(seed = CONFIG.SEED): CityModel {
  const rng = new Rng(seed);
  const city = new CityModel();
  city.flatGround = true;
  const GX = X_RAW.length - 1;
  const GZ = Z_RAW.length - 1;
  const LW = CONFIG.LANE_WIDTH;
  const xMid = (X_RAW[0] + X_RAW[GX]) / 2;
  const zMid = (Z_RAW[0] + Z_RAW[GZ]) / 2;
  city.xs = X_RAW.map((x) => x - xMid);
  city.zs = Z_RAW.map((z) => z - zMid);
  city.hwX = city.xs.map((_, i) => (avenueX(i) ? 2 * LW + 0.25 : LW));
  city.hwZ = city.zs.map((_, j) => (avenueZ(j) ? 2 * LW + 0.25 : LW));

  for (let j = 0; j <= GZ; j++) {
    for (let i = 0; i <= GX; i++) {
      const n: RoadNode = {
        id: j * (GX + 1) + i,
        gi: i,
        gj: j,
        pos: { x: city.xs[i], z: city.zs[j] },
        hx: city.hwX[i],
        hz: city.hwZ[j],
        edges: [],
        signalized: false,
        poly: box(city.xs[i] - city.hwX[i], city.zs[j] - city.hwZ[j], city.xs[i] + city.hwX[i], city.zs[j] + city.hwZ[j]),
        control: 'none',
      };
      city.nodes.push(n);
    }
  }

  const addLane = (e: RoadEdge, from: RoadNode, to: RoadNode, index: number): number => {
    const d: Vec2 = e.axis === 'x' ? { x: Math.sign(to.pos.x - from.pos.x), z: 0 } : { x: 0, z: Math.sign(to.pos.z - from.pos.z) };
    const side = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;
    const med = e.avenue ? 0.25 : 0;
    const off = scale(leftVec(d), side * (med + LW * (index + 0.5)));
    const fromExt = e.axis === 'x' ? from.hx : from.hz;
    const toExt = e.axis === 'x' ? to.hx : to.hz;
    const start = { x: from.pos.x + d.x * (fromExt + 1) + off.x, z: from.pos.z + d.z * (fromExt + 1) + off.z };
    const end = {
      x: to.pos.x - d.x * (toExt + CONFIG.STOP_OFFSET) + off.x,
      z: to.pos.z - d.z * (toExt + CONFIG.STOP_OFFSET) + off.z,
    };
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const lane: Lane = {
      id: city.lanes.length,
      edgeId: e.id,
      from: from.id,
      to: to.id,
      index,
      start,
      end,
      dir: d,
      endDir: d,
      pts: [start, end],
      cum: [0, length],
      length,
    };
    city.lanes.push(lane);
    return lane.id;
  };

  const addEdge = (a: RoadNode, b: RoadNode, axis: 'x' | 'z', avenue: boolean) => {
    const lanesPerDir = avenue ? 2 : 1;
    const ux = axis === 'x' ? 1 : 0;
    const uz = 1 - ux;
    const ea = axis === 'x' ? a.hx : a.hz;
    const eb = axis === 'x' ? b.hx : b.hz;
    const e: RoadEdge = {
      id: city.edges.length,
      a: a.id,
      b: b.id,
      axis,
      pts: [
        { x: a.pos.x + ux * ea, z: a.pos.z + uz * ea },
        { x: b.pos.x - ux * eb, z: b.pos.z - uz * eb },
      ],
      oneWay: false,
      lanesPerDir,
      avenue,
      width: lanesPerDir * 2 * LW + (avenue ? 0.5 : 0),
      speedLimit: (avenue ? CONFIG.AVENUE_LIMIT_KMH : CONFIG.STREET_LIMIT_KMH) * KMH,
      length: Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z),
      lanesAB: [],
      lanesBA: [],
    };
    city.edges.push(e);
    city.registerEdge(e);
    a.edges.push(e.id);
    b.edges.push(e.id);
    for (let k = 0; k < lanesPerDir; k++) {
      e.lanesAB.push(addLane(e, a, b, k));
      e.lanesBA.push(addLane(e, b, a, k));
    }
  };

  for (let j = 0; j <= GZ; j++) {
    for (let i = 0; i < GX; i++) addEdge(city.nodeAt(i, j), city.nodeAt(i + 1, j), 'x', avenueZ(j));
  }
  for (let i = 0; i <= GX; i++) {
    for (let j = 0; j < GZ; j++) addEdge(city.nodeAt(i, j), city.nodeAt(i, j + 1), 'z', avenueX(i));
  }
  for (const n of city.nodes) {
    n.signalized = n.edges.length >= 3;
    n.control = n.signalized ? 'signal' : 'none';
  }

  for (let j = 0; j < GZ; j++) {
    for (let i = 0; i < GX; i++) {
      const min = { x: city.xs[i] + city.hwX[i], z: city.zs[j] + city.hwZ[j] };
      const max = { x: city.xs[i + 1] - city.hwX[i + 1], z: city.zs[j + 1] - city.hwZ[j + 1] };
      const block: Block = {
        id: j * GX + i,
        gi: i,
        gj: j,
        min,
        max,
        district: districtAt(i, j),
        poly: box(min.x, min.z, max.x, max.z),
        center: { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 },
        rect: true,
      };
      city.blocks.push(block);
      if (block.district === 'depot') city.depotBlock = block;
    }
  }
  city.finishLayout();

  const sw = CONFIG.SIDEWALK;
  const northCurb = city.zs[CANAL_ROW] + city.hwZ[CANAL_ROW];
  const southCurb = city.zs[CANAL_ROW + 1] - city.hwZ[CANAL_ROW + 1];
  const zc = (northCurb + southCurb) / 2;
  const half = Math.min(16, (southCurb - northCurb) / 2 - sw - 2.5);
  const f = emptyFeatures();
  f.kinds = city.blocks.map(() => 'normal');
  f.canal = {
    row: CANAL_ROW,
    z0: zc - half,
    z1: zc + half,
    zc,
    water: -2.2,
    bed: -4.2,
    humpHalf: 16,
    humpHeight: 0.9,
    x0: city.xs[0] - city.hwX[0] - sw - 400,
    x1: city.xs[GX] + city.hwX[GX] + sw + 400,
  };
  for (const block of city.blocks) {
    // Held back from cafés, alleys and the yard planners. Buildings still fill them, then the landmarks replace them.
    if ((block.gi === ARENA.i && block.gj === ARENA.j) || (block.gi === SILOS.i && block.gj === SILOS.j) || (block.gi === CLOCK.i && block.gj === CLOCK.j)) {
      f.kinds[block.id] = 'bridge';
    }
    if (isPark(block.gi, block.gj)) f.kinds[block.id] = 'park';
  }
  city.features = f;
  layHarbor(city);
  f.depot = planDepot(city.depotBlock);
  f.driveways.push(...f.depot.gates.map((g) => g.mouth));
  city.depotPos = f.depot.ring;
  f.pitStops = planPitStops(city, f.kinds, () => true, new Rng(seed + 20), CANAL_ROW);
  for (const p of f.pitStops) f.driveways.push(...p.driveways);

  const core = { x: city.xs[5], z: city.zs[4] };
  const reach = 700;
  for (const block of city.blocks) {
    const [, hi] = heightOf(block.gi, block.gj);
    const cf = Math.max(0, Math.min(1, (hi - 36) / 90));
    const here = 1 - Math.min(1, Math.hypot(block.center.x - core.x, block.center.z - core.z) / reach);
    city.buildings.push(...generateBuildings(block, rng, Math.max(cf, here * 0.35), f));
  }
  openCourtyards(city);
  layParks(city, seed);
  openHarbor(city);

  const x0 = city.xs[0] - city.hwX[0];
  const x1 = city.xs[GX] + city.hwX[GX];
  const z0 = city.zs[0] - city.hwZ[0];
  const z1 = city.zs[GZ] + city.hwZ[GZ];
  horizon(city, rng, x0, z0, x1, z1);
  const canal = f.canal;
  city.buildings = city.buildings.filter((b) => b.faces.length > 0 || b.maxZ < canal.z0 - 3 || b.minZ > canal.z1 + 3);

  city.waterZ = z1 + sw + 6;
  city.walls.push(
    { minX: x0 - 60, maxX: x1 + 60, minZ: city.waterZ, maxZ: city.waterZ + 4 },
    { minX: x0 - sw - 2, maxX: x0 - sw, minZ: z0 - 60, maxZ: city.waterZ + 4 },
    { minX: x1 + sw, maxX: x1 + sw + 2, minZ: z0 - 60, maxZ: city.waterZ + 4 },
    { minX: x0 - 60, maxX: x1 + 60, minZ: z0 - sw - 2, maxZ: z0 - sw },
  );
  city.bounds = { minX: x0 - sw, minZ: z0 - sw, maxX: x1 + sw, maxZ: city.waterZ };
  canalWalls(city);
  city.terrain = new Terrain(city, f);
  settleBuildings(city);
  planAlleys(city, seed + 19);
  planPoliceStation(city);
  dressSkyline(city);
  fitHeights(city);
  placeArena(city);
  placeSilos(city);
  placeClock(city);
  settleBuildings(city);
  return city;
}

function horizon(city: CityModel, rng: Rng, x0: number, z0: number, x1: number, z1: number): void {
  const sw = CONFIG.SIDEWALK;
  const band = (minX: number, minZ: number, maxX: number, maxZ: number, alongX: boolean) => {
    let t = alongX ? minX : minZ;
    const end = alongX ? maxX : maxZ;
    while (t < end - 4) {
      const w = Math.min(rng.range(16, 34), end - t);
      const b: Building = {
        minX: alongX ? t : minX,
        maxX: alongX ? t + w - 1 : maxX,
        minZ: alongX ? minZ : t,
        maxZ: alongX ? maxZ : t + w - 1,
        height: rng.range(14, 32),
        district: 'residential',
        faces: [],
        seed: rng.int(0, 1e6),
      };
      city.buildings.push(b);
      t += w;
    }
  };
  band(x0 - OUTER, z0 - sw - OUTER, x1 + OUTER, z0 - sw, true);
  band(x0 - sw - OUTER, z0 - sw, x0 - sw, z1 + sw, false);
  band(x1 + sw, z0 - sw, x1 + sw + OUTER, z1 + sw, false);
}

/** Quay railings between the bridges, and parapets on the bridges themselves. */
function canalWalls(city: CityModel): void {
  const k = city.features.canal;
  if (!k) return;
  const sw = CONFIG.SIDEWALK;
  const gx = city.nx - 1;
  for (let i = 0; i < gx; i++) {
    const xa = city.xs[i] + city.hwX[i] + sw;
    const xb = city.xs[i + 1] - city.hwX[i + 1] - sw;
    if (xb - xa < 4) continue;
    city.walls.push({ minX: xa, maxX: xb, minZ: k.z0 - 0.35, maxZ: k.z0, top: 1.1 }, { minX: xa, maxX: xb, minZ: k.z1, maxZ: k.z1 + 0.35, top: 1.1 });
  }
  for (let i = 0; i <= gx; i++) {
    const e = city.hwX[i] + sw;
    for (const x of [city.xs[i] - e - 0.35, city.xs[i] + e]) {
      city.walls.push({ minX: x, maxX: x + 0.35, minZ: k.z0 - 0.5, maxZ: k.z1 + 0.5, top: k.humpHeight + 1.1 });
    }
  }
}

function box(x0: number, z0: number, x1: number, z1: number): Vec2[] {
  return [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
}
