/**
 * Headless traffic soak (T37): the city's street sims (lights, traffic, patrols, parked cars, peds, riders,
 * dogs, collisions) without rendering, with the player car driven by a `LaneDriver` bot so traffic spawns
 * around it as it tours the city. Counts what must stay zero (AI red-light runs, AI-vs-AI collisions) and
 * how much AI driving happens off the road. Loaded by `scripts/soak.mjs` through Vite.
 */
import { CONFIG } from '../src/config';
import { Events } from '../src/core/Events';
import { Rng } from '../src/core/Rng';
import { World } from '../src/core/World';
import { DogWalkers } from '../src/ai/DogWalkers';
import { Heat } from '../src/ai/Heat';
import { LaneDriver } from '../src/ai/LaneDriver';
import { ParkedCars } from '../src/ai/ParkedCars';
import { Pathfinder } from '../src/ai/Pathfinding';
import { Pedestrians } from '../src/ai/Pedestrians';
import { PoliceSystem } from '../src/ai/PoliceAI';
import { Riders } from '../src/ai/Riders';
import { TrafficSystem } from '../src/ai/TrafficAI';
import { mapDef } from '../src/maps';
import { resolveMap } from '../src/maps/catalog';
import { CollisionSystem } from '../src/physics/Collision';
import { SpatialHash } from '../src/physics/SpatialHash';
import type { SimSystem } from '../src/types';
import { Car } from '../src/vehicles/Car';
import { FLEET, PLAYER_CAR } from '../src/vehicles/Fleet';
import { VehiclePhysics } from '../src/vehicles/VehiclePhysics';
import { solidParts } from '../src/world/Interiors';
import { surfaceAt } from '../src/world/Surfaces';
import { TrafficLights } from '../src/world/TrafficLights';

export interface SoakResult {
  seed: number;
  seconds: number;
  /** AI cars that crossed a stop line into a junction on red. */
  redRuns: number;
  /** Stop-line crossings by AI cars at signalized junctions. */
  crossings: number;
  /** Collision events between two moving AI cars (traffic, police; parked cars not counted). */
  aiCollisions: number;
  /** Traffic or police touching a parked car (curb bays sit beside the lanes: should stay near 0). */
  parkedHits: number;
  /** Share of AI car samples (1 Hz) that were not on road-level drivable ground. */
  offRoad: number;
  /** Average AI cars alive. */
  cars: number;
  msPerStep: number;
  /** One line per AI-vs-AI collision. */
  collisionLog: string[];
}

export function soak(id: string, seed: number, seconds: number): SoakResult {
  const map = resolveMap(id);
  if (!map || CONFIG.MAP !== map) throw new Error(`CONFIG.MAP is ${CONFIG.MAP}, expected ${map ?? id} (set NEON_MAP)`);
  const def = mapDef(map);
  const city = def.generate(def.seed);
  VehiclePhysics.ground = city.terrain;
  const events = new Events();
  const rng = new Rng(seed);
  const lights = new TrafficLights(city, rng);
  // Street furniture and landmark colliders are left out: the soak is about lanes, signals and cars
  const statics = new SpatialHash([...city.buildings.flatMap(solidParts), ...city.walls]);
  const world = new World(city, events, rng, statics, lights);
  world.mode = 'free';

  const startLane = city.nearestLanePoint(city.depotPos);
  const starter = FLEET[PLAYER_CAR];
  const player = new Car('player', starter.spec, { ...starter.look }, startLane.pos, Math.atan2(startLane.lane.dir.x, startLane.lane.dir.z));
  world.player = player;
  world.addCar(player);
  const bot = new LaneDriver(world, player, startLane.lane);

  const sims: SimSystem[] = [];
  const add = (s: SimSystem) => sims.push(s);
  add({ update: () => world.cars.forEach((c) => c.savePrev()) });
  add(lights);
  add({ update: () => bot.drive() });
  const traffic = new TrafficSystem(world);
  traffic.populate();
  add(traffic);
  const heat = new Heat(world);
  const police = new PoliceSystem(world, heat, new Pathfinder(city));
  police.populate();
  add(police);
  add(new ParkedCars(world));
  const peds = new Pedestrians(world);
  world.pedestrians = peds.peds;
  peds.populate();
  add(peds);
  const riders = new Riders(world);
  riders.populate();
  add(riders);
  add(new DogWalkers(world, peds));
  add({ update: (dt) => world.cars.forEach((c) => c.step(dt)) });
  add({ update: () => world.compact() });
  add(new CollisionSystem(statics, () => world.cars, events));
  add({ update: (dt) => (world.time += dt) });

  const res: SoakResult = { seed, seconds, redRuns: 0, crossings: 0, aiCollisions: 0, parkedHits: 0, offRoad: 0, cars: 0, msPerStep: 0, collisionLog: [] };
  const lastHit = new Map<string, number>();
  const isAi = (id: number | null) => {
    const k = id === null ? null : world.carById(id)?.kind;
    return k === 'traffic' || k === 'police';
  };
  const isParked = (id: number | null) => id !== null && world.carById(id)?.kind === 'parked';
  events.on('collision', (e) => {
    if ((isAi(e.a) && isParked(e.b)) || (isParked(e.a) && isAi(e.b))) {
      const key = `p${Math.min(e.a, e.b!)}_${Math.max(e.a, e.b!)}`;
      const last = lastHit.get(key);
      lastHit.set(key, world.time);
      if (last === undefined || world.time - last >= 2) {
        res.parkedHits++;
        const ai = world.carById(isAi(e.a) ? e.a : e.b!)!;
        const node = city.nodeBoxAt(e.pos, 2);
        res.collisionLog.push(`t=${world.time.toFixed(1)} ${ai.kind}/parked impulse ${Math.round(e.impulse)} speed ${(ai.phys.state.speed * 3.6).toFixed(0)} km/h ${node ? 'in junction' : 'on road'}`);
      }
      return;
    }
    if (!isAi(e.a) || !isAi(e.b)) return;
    // One crash fires an event per step while the cars touch: count it once (same pair within 2 s)
    const key = `${Math.min(e.a, e.b!)}_${Math.max(e.a, e.b!)}`;
    const last = lastHit.get(key);
    lastHit.set(key, world.time);
    if (last !== undefined && world.time - last < 2) return;
    res.aiCollisions++;
    const ka = world.carById(e.a)!;
    const kb = world.carById(e.b!)!;
    const node = city.nodeBoxAt(e.pos, 2);
    const move = (id: number) => {
      const d = drivers().find((x) => x.car.id === id);
      if (!d) return '?';
      const ed = city.edges[d.lane.edgeId];
      return `${ed.cls[0]}${d.lane.index}->${city.edges[d.next.lane.edgeId].cls[0]}${d.next.lane.index} ${d.next.turn}`;
    };
    res.collisionLog.push(
      `t=${world.time.toFixed(1)} ${ka.kind}/${kb.kind} impulse ${Math.round(e.impulse)} speeds ${(ka.phys.state.speed * 3.6).toFixed(0)}/${(kb.phys.state.speed * 3.6).toFixed(0)} km/h ${node ? `in junction ${node.gi},${node.gj}` : 'on road'} [${move(e.a)} | ${move(e.b!)}]`,
    );
  });

  // Stop-line watch: before / past the line per driver, by lane
  const before = new Map<number, { lane: number; d: number }>();
  const drivers = (): LaneDriver[] => [...traffic.drivers.values(), ...[...police.cops.values()].map((c) => c.driver)];
  let samples = 0;
  let off = 0;
  let carSum = 0;
  const steps = Math.round(seconds / CONFIG.STEP);
  const t0 = performance.now();
  for (let k = 0; k < steps; k++) {
    for (const s of sims) s.update(CONFIG.STEP);
    for (const d of drivers()) {
      if (d.car.removed) continue;
      const dStop = d.distToStopLine();
      const prev = before.get(d.car.id);
      if (prev && prev.lane === d.lane.id && prev.d > 0 && dStop < 0) {
        const node = city.nodes[d.lane.to];
        if (node.signalized && !(d.car.kind === 'police' && police.cops.get(d.car.id)?.chase)) {
          res.crossings++;
          if (lights.state(node.id, d.lane.edgeId) === 'red') res.redRuns++;
        }
      }
      before.set(d.car.id, { lane: d.lane.id, d: dStop });
    }
    if (k % 60 === 0) {
      let n = 0;
      for (const c of world.cars) {
        if (c.kind !== 'traffic' && c.kind !== 'police') continue;
        n++;
        samples++;
        const s = surfaceAt(city, c.pos);
        if (s !== 'road') off++;
      }
      carSum += n;
    }
  }
  res.msPerStep = (performance.now() - t0) / steps;
  res.offRoad = samples ? off / samples : 0;
  res.cars = carSum / Math.max(1, Math.round(steps / 60));
  return res;
}
