import { CONFIG, KMH } from '../../config';
import { STORAGE_STOP, storageStop } from '../../gameplay/MissionRoute';
import { montrealRelief } from './Relief';
import { leftVec, scale } from '../../core/math';
import { Rng, hash01 } from '../../core/Rng';
import type { Block, Building, Lane, RoadEdge, RoadNode, StreetClass, StreetName, Vec2 } from '../../types';
import { planAlleys } from '../../world/Alleys';
import { generateBuildings } from '../../world/Districts';
import { settleBuildings } from '../../world/Settle';
import { planCurbParking } from '../../world/CurbParking';
import { emptyFeatures } from '../../world/Features';
import { planPitStops } from '../../world/PitStops';
import { planPoliceStation } from '../../world/PoliceStation';
import { CityModel, laneOffset } from '../../world/RoadGraph';
import { dressSkyline } from '../../world/Skyline';
import { Terrain } from '../../world/Terrain';
import { layPort, portWaterZ } from './Harbor';
import { fitHeights, openCourtyards, placeArena, placeBasilica, placeSilos } from './Massing';
import { layParks } from './Parks';
import { laySquares } from './Squares';
import { ARENA, BASILICA, CANAL_ROW, SILOS, START, STREET_CLASSES, X_RAW, Z_RAW, classWidth, colClass, colName, districtAt, heightOf, isPark, isSquare, junctionControl, rowClass, rowName } from './layout';

const OUTER = 28;

/**
 * Downtown Montreal, Guy to Saint-Hubert, Sherbrooke to the river: real block spacing, gardens instead of
 * whole-block lawns, pedestrian squares, the Lachine Canal as the east-west water, the Old Port's promenade
 * along the river, the basilica on Notre-Dame, and roof heights taken from the blocks. Lanes follow
 * `CONFIG.DRIVE_SIDE` (right-hand traffic).
 *
 * Every edge carries its street class (`layout.ts`: boulevard, street or cobble) and the widths that go with
 * it. A row can change class part way (Sainte-Catherine, Saint-Paul), so a junction box is as wide as the
 * widest road through it, and each block's curb follows the road actually beside it.
 */
export function generateMontreal(seed = CONFIG.SEED): CityModel {
  const rng = new Rng(seed);
  const city = new CityModel();
  const GX = X_RAW.length - 1;
  const GZ = Z_RAW.length - 1;
  const xMid = (X_RAW[0] + X_RAW[GX]) / 2;
  const zMid = (Z_RAW[0] + Z_RAW[GZ]) / 2;
  city.xs = X_RAW.map((x) => x - xMid);
  city.zs = Z_RAW.map((z) => z - zMid);
  // Half widths: of the row-j road between columns i and i + 1, and of the column-i road between rows j and j + 1
  const hwRow = (i: number, j: number) => classWidth(rowClass(i, j)) / 2;
  const hwCol = (i: number, j: number) => classWidth(colClass(i, j)) / 2;
  const widest = (n: number, f: (k: number) => number) => Math.max(...Array.from({ length: n }, (_, k) => f(k)));
  city.hwX = city.xs.map((_, i) => widest(GZ, (j) => hwCol(i, j)));
  city.hwZ = city.zs.map((_, j) => widest(GX, (i) => hwRow(i, j)));

  for (let j = 0; j <= GZ; j++) {
    for (let i = 0; i <= GX; i++) {
      // The box spans the widest road through the junction on each axis
      const hx = Math.max(j > 0 ? hwCol(i, j - 1) : 0, j < GZ ? hwCol(i, j) : 0);
      const hz = Math.max(i > 0 ? hwRow(i - 1, j) : 0, i < GX ? hwRow(i, j) : 0);
      const n: RoadNode = {
        id: j * (GX + 1) + i,
        gi: i,
        gj: j,
        pos: { x: city.xs[i], z: city.zs[j] },
        hx,
        hz,
        edges: [],
        signalized: false,
        poly: box(city.xs[i] - hx, city.zs[j] - hz, city.xs[i] + hx, city.zs[j] + hz),
        control: 'none',
      };
      city.nodes.push(n);
    }
  }

  const addLane = (e: RoadEdge, from: RoadNode, to: RoadNode, index: number): number => {
    const d: Vec2 = e.axis === 'x' ? { x: Math.sign(to.pos.x - from.pos.x), z: 0 } : { x: 0, z: Math.sign(to.pos.z - from.pos.z) };
    const side = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;
    const off = scale(leftVec(d), side * laneOffset(e, index));
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

  const addEdge = (a: RoadNode, b: RoadNode, axis: 'x' | 'z', cls: StreetClass, name: StreetName | null) => {
    const k = STREET_CLASSES[cls];
    const lanesPerDir = k.lanesPerDir;
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
      avenue: cls === 'boulevard',
      cls,
      laneWidth: k.laneWidth,
      parking: k.parking,
      median: k.median,
      width: classWidth(cls),
      speedLimit: k.limitKmh * KMH,
      length: Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z),
      lanesAB: [],
      lanesBA: [],
    };
    if (name) e.name = name;
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
    for (let i = 0; i < GX; i++) addEdge(city.nodeAt(i, j), city.nodeAt(i + 1, j), 'x', rowClass(i, j), rowName(i, j));
  }
  for (let i = 0; i <= GX; i++) {
    for (let j = 0; j < GZ; j++) addEdge(city.nodeAt(i, j), city.nodeAt(i, j + 1), 'z', colClass(i, j), colName(i));
  }
  for (const n of city.nodes) {
    n.control = junctionControl(n.edges.map((id) => city.edges[id].cls), hash01(n.id, 41));
    n.signalized = n.control === 'signal';
    // The all-way plaque under the ARRÊT signs at about a third of the stops
    if (n.control === 'stop' && hash01(n.id, 43) < 0.35) n.allWayPlaque = true;
  }

  for (let j = 0; j < GZ; j++) {
    for (let i = 0; i < GX; i++) {
      // Curbs of the four roads around the block (a cobble row leaves a deeper block than the boulevard beside it)
      const min = { x: city.xs[i] + hwCol(i, j), z: city.zs[j] + hwRow(i, j) };
      const max = { x: city.xs[i + 1] - hwCol(i + 1, j), z: city.zs[j + 1] - hwRow(i, j + 1) };
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
    // Held back from garages, alleys and the precinct. Buildings still fill them, then the landmarks replace them.
    const at = (p: { i: number; j: number }) => block.gi === p.i && block.gj === p.j;
    if (at(ARENA) || at(SILOS) || at(BASILICA)) f.kinds[block.id] = 'bridge';
    if (isPark(block.gi, block.gj)) f.kinds[block.id] = 'park';
    if (isSquare(block.gi, block.gj)) f.kinds[block.id] = 'square';
  }
  city.features = f;
  // On the street along the square's north side (William), where the old yard's start was
  const startBlock = city.blocks[START.j * GX + START.i];
  city.startPos = { x: startBlock.center.x, z: startBlock.min.z + 30 };
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
  laySquares(city);

  const x0 = city.xs[0] - city.hwX[0];
  const x1 = city.xs[GX] + city.hwX[GX];
  const z0 = city.zs[0] - city.hwZ[0];
  const z1 = city.zs[GZ] + city.hwZ[GZ];
  horizon(city, rng, x0, z0, x1, z1);
  const canal = f.canal;
  city.buildings = city.buildings.filter((b) => b.faces.length > 0 || b.maxZ < canal.z0 - 3 || b.minZ > canal.z1 + 3);

  city.waterZ = portWaterZ(z1);
  city.walls.push(
    { minX: x0 - 60, maxX: x1 + 60, minZ: city.waterZ, maxZ: city.waterZ + 4 },
    { minX: x0 - sw - 2, maxX: x0 - sw, minZ: z0 - 60, maxZ: city.waterZ + 4 },
    { minX: x1 + sw, maxX: x1 + sw + 2, minZ: z0 - 60, maxZ: city.waterZ + 4 },
    { minX: x0 - 60, maxX: x1 + 60, minZ: z0 - sw - 2, maxZ: z0 - sw },
  );
  city.bounds = { minX: x0 - sw, minZ: z0 - sw, maxX: x1 + sw, maxZ: city.waterZ };
  canalWalls(city);
  layPort(city);
  // The hill from the river up to Sherbrooke, rolling block to block (`Relief.ts`)
  city.relief = montrealRelief(city);
  city.terrain = new Terrain(city, f);
  settleBuildings(city);
  planAlleys(city, seed + 19);
  planPoliceStation(city);
  dressSkyline(city);
  fitHeights(city);
  placeArena(city);
  placeSilos(city);
  placeBasilica(city);
  settleBuildings(city);
  // Last: the bays keep clear of every curb cut the planners above made
  f.curb = planCurbParking(city);
  // Nobody parks on the winter-tire storage's circle
  const store = storageStop(city);
  const along = { x: Math.sin(store.yaw), z: Math.cos(store.yaw) };
  f.curb = f.curb.filter(
    (b) => b.edge !== store.edge || Math.abs((b.pos.x - store.pos.x) * along.x + (b.pos.z - store.pos.z) * along.z) > STORAGE_STOP.clearBays || (b.pos.x - store.pos.x) * store.curb.x + (b.pos.z - store.pos.z) * store.curb.z < -2,
  );
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
