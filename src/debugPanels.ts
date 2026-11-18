import { CONFIG } from './config';
import { Debug } from './core/Debug';
import type { Events } from './core/Events';
import { fwd } from './core/math';
import type { World } from './core/World';
import { DOG_TUNING, type DogWalkers } from './ai/DogWalkers';
import { HEAT_TUNING, type Heat } from './ai/Heat';
import type { Pedestrians } from './ai/Pedestrians';
import { SIGHT_TUNING, type PoliceSystem } from './ai/PoliceAI';
import { PURSUIT_TUNING } from './ai/PursuitDriver';
import { DRIVER_TUNING, ERRATIC_TUNING, MERGE_STATS } from './ai/LaneDriver';
import { DOUBLE_PARK_TUNING } from './ai/ParkedCars';
import { HORN_TUNING } from './audio/TrafficHorns';
import type { RiderDodge } from './ai/RiderDodge';
import { RIDER_TUNING, type Riders } from './ai/Riders';
import { TRUCK_TUNING, type TrafficSystem } from './ai/TrafficAI';
import { BUST_TUNING, type BustSystem } from './gameplay/Bust';
import type { Wreck } from './gameplay/Wreck';
import { FINE_TUNING, formatCash, type Economy } from './gameplay/Economy';
import type { Gps } from './gameplay/Gps';
import { TIRE_TUNING, type Tires } from './gameplay/Tires';
import { PIT_TUNING, type PitStopSystem } from './gameplay/PitStop';
import { POTHOLE_TUNING, type PotholeHits } from './gameplay/PotholeHits';
import type { Potholes } from './world/Potholes';
import type { Closures } from './gameplay/Closures';
import { CONE_TUNING, type Cones } from './gameplay/Cones';
import { CHANTIER_TUNING, type Chantier } from './gameplay/Chantier';
import { CALL_TUNING } from './ai/PoliceAI';
import type { Lane } from './types';
import type { CameraRig } from './render/CameraRig';
import { GRAPHICS, GRAPHICS_OPTIONS, POSTFX, setGraphic, type GraphicsKey } from './render/PostFX';
import type { StaticTiles } from './render/StaticTiles';
import type { Interior, OffenseKind, Vec2 } from './types';
import type { Car } from './vehicles/Car';
import { addDamage, repair } from './vehicles/Damage';
import { equipCar, PLAYER_CAR } from './vehicles/Fleet';
import { addSpecPanel } from './vehicles/SpecPanel';
import type { Builds } from './gameplay/Builds';
import type { WinterTires } from './gameplay/WinterTires';
import type { StorageStop } from './gameplay/MissionRoute';
import type { PitStop } from './world/PitStops';
import { interiorAt, SIDE_OUT } from './world/Interiors';
import { surfaceAt } from './world/Surfaces';
import type { CityModel } from './world/RoadGraph';

/** The systems the debug panel tunes and watches. */
export interface DebugSystems {
  world: World;
  player: Car;
  events: Events;
  city: CityModel;
  traffic: TrafficSystem;
  peds: Pedestrians;
  riders: Riders;
  riderDodge: RiderDodge;
  dogs: DogWalkers;
  heat: Heat;
  police: PoliceSystem;
  bust: BustSystem;
  wreck: Wreck;
  economy: Economy;
  gps: Gps;
  camRig: CameraRig;
  tiles: StaticTiles;
  pitStops: PitStopSystem;
  builds: Builds;
  tires: Tires;
  potholes: Potholes;
  potholeHits: PotholeHits;
  closures: Closures;
  cones: Cones;
  chantier: Chantier;
  openPitShop: (stop: PitStop) => void;
  mission: WinterTires;
  storage: StorageStop;
}

/** Debug panel folders (cheats, tuning knobs, spawn buttons) and overlay watch lines. Call after `Debug.attach`. */
export function addDebugPanels(sys: DebugSystems): { adoptSpec: () => void } {
  let adoptSpec = (): void => {};
  const { world, player, events, city, traffic, peds, riders, riderDodge, dogs, heat, police, bust, economy, gps, wreck } = sys;
  // Cheats (IMPROVEMENTS #15): full immunity = the police ignore offenses, no busts, no damage
  const cheats = Debug.gui.addFolder('Cheats');
  cheats
    .add(world, 'immune')
    .name('full immunity')
    .onChange((on: boolean) => {
      player.invulnerable = on;
      if (!on) return;
      police.callOff();
      heat.reset();
      events.message('Immunity on: the SPVM ignores you, no damage', 'info');
    });
  cheats.add({ go: () => wreck.debugBoom() }, 'go').name('explode the car');
  cheats.add({ fix: () => repair(player) }, 'fix').name('repair car');
  // Phase 3 stand-in for the winter-tire mission: which set is on the car, and how much grip each gives
  const tires = Debug.addFolder('Tires');
  tires.add(sys.tires, 'set', ['summer', 'winter']).name('tires on the car').listen();
  tires.add(TIRE_TUNING, 'summerGrip', 0.6, 1, 0.01).name('summer grip x');
  tires.add(TIRE_TUNING, 'winterGrip', 0.6, 1.1, 0.01).name('winter grip x');
  Debug.watch('tires', () => `${sys.tires.set}  grip x${sys.tires.grip.toFixed(2)}`);
  addPotholePanel(sys);
  addClosurePanel(sys);
  Debug.watch('cars', () => {
    const trucks = [...traffic.drivers.values()].filter((d) => d.car.look.style === 'truck' || d.car.look.style === 'pickup').length;
    const moods = { yield: 0, evade: 0, ped: 0 };
    for (const d of traffic.drivers.values()) if (d.mood !== 'cruise') moods[d.mood]++;
    return `${world.cars.length} (traffic ${traffic.drivers.size}, trucks ${trucks}) yield ${moods.yield} evade ${moods.evade} ped ${moods.ped}`;
  });
  Debug.watch('player', () => {
    const s = player.phys.state;
    return `${player.phys.spec.name}  ${(Math.abs(s.speed) * 3.6).toFixed(0)} km/h  gear ${s.gear}  rpm ${s.rpm.toFixed(0)}  dmg ${(s.damage * 100).toFixed(0)}%`;
  });
  Debug.watch('wreck', () => (wreck.phase === 'free' ? 'ok' : `${wreck.phase}  ${wreck.animT.toFixed(2)}s`));
  Debug.watch('peds', () => `${peds.count} / ${peds.target}`);
  Debug.watch('dodge', () => {
    const s = peds.dodge.stats;
    return `dives ${s.dives}  steps ${s.steps}  missed ${s.pushes}  near-miss ${s.nearMisses}  sidewalk ${s.sidewalk}`;
  });
  Debug.addFolder('Pedestrians').add(peds, 'target', 0, CONFIG.MAX_PEDS, 1);
  Debug.watch('riders', () => {
    const s = riderDodge.stats;
    const scooters = world.riders.filter((x) => x.kind === 'scooter').length;
    return `${riders.count} / ${riders.target} (${scooters} scooters)  swerves ${s.swerves}  hops ${s.hops}  brakes ${s.brakes}  shoves ${s.shoves}  near-miss ${s.nearMisses}`;
  });
  Debug.watch('dogs', () => `${dogs.count} on leashes  sniffs ${dogs.stats.sniffs}  leaps ${dogs.stats.leaps}`);
  const streetFolder = Debug.addFolder('Street life');
  streetFolder.add(riders, 'target', 0, 40, 1).name('riders');
  streetFolder.add(RIDER_TUNING, 'scooters', 0, 1, 0.05).name('scooter share');
  streetFolder.add(DOG_TUNING, 'share', 0, 5, 0.1).name('dog walkers x');
  streetFolder.add(TRUCK_TUNING, 'boxTruck', 0, 1, 0.01).name('box truck share');
  streetFolder.add(TRUCK_TUNING, 'pickup', 0, 1, 0.01).name('pickup share');
  streetFolder.add(TRUCK_TUNING, 'maxBoxTrucks', 0, 10, 1).name('max box trucks');
  const laneAhead = (d: number) => {
    const f = fwd(player.yaw);
    return city.nearestLanePoint({ x: player.pos.x + f.x * d, z: player.pos.z + f.z * d });
  };
  streetFolder.add({ cyclist: () => { const h = laneAhead(30); riders.spawn(h.lane, h.t, 'bicycle'); } }, 'cyclist').name('spawn cyclist ahead');
  streetFolder.add({ scooter: () => { const h = laneAhead(30); riders.spawn(h.lane, h.t, 'scooter'); } }, 'scooter').name('spawn scooter ahead');
  streetFolder.add({ truck: () => { const h = laneAhead(40); traffic.spawnCar(h.lane, h.pos, { style: 'truck' }); } }, 'truck').name('spawn truck ahead');
  streetFolder.add({ pickup: () => { const h = laneAhead(40); traffic.spawnCar(h.lane, h.pos, { style: 'pickup' }); } }, 'pickup').name('spawn pickup ahead');
  Debug.watch('heat', () => {
    const short: Record<OffenseKind, string> = {
      redLight: 'red',
      speeding: 'speed',
      wrongWay: 'wrong',
      carCrash: 'crash',
      policeCrash: 'spvm',
      pedEndangered: 'ped',
      sidewalk: 'walk',
      chantier: 'cones',
    };
    const counts = (Object.keys(short) as OffenseKind[]).map((k) => `${short[k]} ${heat.witnessed[k]}/${heat.detected[k]}`);
    const waived = heat.waived.speeding + heat.waived.wrongWay;
    return `${(heat.value * 100).toFixed(0)}%  ${counts.join(' ')}${waived ? `  waived ${waived}` : ''}`;
  });
  const heatFolder = Debug.addFolder('Heat');
  heatFolder.add(heat, 'value', 0, 1, 0.01).name('felony').listen();
  heatFolder.add(heat, 'reset');
  heatFolder.add(HEAT_TUNING, 'drainDelay', 0, 15, 0.5).name('drain after unseen (s)');
  heatFolder.add(HEAT_TUNING, 'drain', 0, 0.2, 0.005).name('drain per second');
  Debug.watch('police', () => {
    const seen = world.time - police.lastSeen;
    const modes = [...police.cops.values()].filter((c) => c.chase).map((c) => (c.chase!.mode === 'direct' ? 'D' : 'R'));
    return `${police.cops.size} SPVM  ${police.pursuers}/${police.wantedUnits} pursuing [${modes.join('')}]  seen ${seen < 99 ? seen.toFixed(1) + ' s ago' : 'never'}`;
  });
  const policeFolder = Debug.addFolder('SPVM');
  policeFolder.add(police, 'target', 0, 12, 1).name('patrols');
  policeFolder.add(police, 'witnessAll').name('witness everything');
  policeFolder.add(
    {
      spawnAhead: () => {
        const f = fwd(player.yaw);
        const hit = city.nearestLanePoint({ x: player.pos.x + f.x * 45, z: player.pos.z + f.z * 45 });
        police.spawn(hit.lane, hit.pos);
      },
    },
    'spawnAhead',
  ).name('spawn a cruiser ahead');
  policeFolder.add(SIGHT_TUNING, 'lightsOff', 0.3, 1, 0.05).name('sight with headlights off (x)');
  policeFolder.add(SIGHT_TUNING, 'covered', 0.2, 1, 0.05).name('sight under a roof (x)');
  policeFolder.add(PURSUIT_TUNING, 'topSpeed', 20, 60, 1).name('pursuit top speed (m/s)');
  policeFolder.add(PURSUIT_TUNING, 'ramSpeed', 0, 15, 0.5).name('ram closing speed (m/s)');
  policeFolder.add(PURSUIT_TUNING, 'cornerSpeed', 6, 20, 0.5).name('corner speed (m/s)');
  policeFolder.add(PURSUIT_TUNING, 'loseTime', 4, 30, 1).name('lose after unseen (s)');
  policeFolder.add(PURSUIT_TUNING, 'pingInterval', 1, 20, 1).name('radio ping every (s)');
  policeFolder.add(PURSUIT_TUNING, 'flankLead', 0, 6, 0.1).name('flankers aim ahead (s, 0 = off)');
  policeFolder.add(PURSUIT_TUNING, 'flankUntil', 10, 80, 1).name('flank until within (m)');
  // Phase 3 pass: how civilian drivers behave
  const ai = Debug.addFolder('Traffic AI').close();
  ai.add(DRIVER_TUNING, 'pedClear', 0, 3, 0.1).name('ped clearance (m)');
  ai.add(DRIVER_TUNING, 'pedGap', 0.5, 4, 0.1).name('stop short of ped (m)');
  ai.add(DRIVER_TUNING, 'signalAt', 0, 60, 1).name('signal before line (m)');
  ai.add(DRIVER_TUNING, 'sirenRange', 0, 100, 1).name('yield to siren within (m)');
  ai.add(DRIVER_TUNING, 'yieldNudge', 0, 1.8, 0.05).name('pull over (m)');
  ai.add(DRIVER_TUNING, 'yieldSpeed', 0, 1, 0.05).name('yield speed (x limit)');
  ai.add(DRIVER_TUNING, 'evadeTime', 0, 4, 0.1).name('swerve at time to impact (s)');
  ai.add(DRIVER_TUNING, 'evadeNudge', 0, 2.5, 0.05).name('swerve (m)');
  ai.add(DRIVER_TUNING, 'launchMin', 0, 1.5, 0.05).name('reaction min (s)');
  ai.add(DRIVER_TUNING, 'launchMax', 0, 2.5, 0.05).name('reaction max (s)');
  // Phase 8: Montreal manners
  const rude = ai.addFolder('Rude (Phase 8)').close();
  rude.add(ERRATIC_TUNING, 'lateBrake', 0, 1, 0.01).name('late brake for red (chance)');
  rude.add(ERRATIC_TUNING, 'lateDecel', 2.5, 7, 0.1).name('late brake decel (m/s2)');
  rude.add(ERRATIC_TUNING, 'dpNudge', 0, 1.6, 0.05).name('squeeze past double-park (m)');
  rude.add(ERRATIC_TUNING, 'dpPass', 2, 10, 0.5).name('squeeze speed (m/s)');
  rude.add(ERRATIC_TUNING, 'hopAfter', 0.5, 8, 0.1).name('lane hop after stuck (s)');
  rude.add(ERRATIC_TUNING, 'hopRandom', 0, 0.2, 0.005).name('random lane hops (per s)');
  rude.add(ERRATIC_TUNING, 'hopRate', 1, 4, 0.1).name('lane hop speed');
  rude.add(ERRATIC_TUNING, 'hopGap', 0.4, 1, 0.05).name('lane hop gap (x merge)');
  rude.add(DOUBLE_PARK_TUNING, 'intrude', 0, 1.6, 0.05).name('double-park into lane (m, on wake)');
  rude.add(HORN_TUNING, 'first', 0.3, 6, 0.1).name('honk after blocked (s)');
  rude.add(HORN_TUNING, 'angry', 2, 15, 0.5).name('long honk after (s)');
  rude.add(HORN_TUNING, 'queue', 6, 40, 1).name('queue honks within (m)');
  Debug.watch('rude', () => `merges ${MERGE_STATS.merges}  hops ${MERGE_STATS.hops}`);
  Debug.watch('bust', () => `${bust.phase}  ring ${(bust.progress * 100).toFixed(0)}%  busts ${bust.busts}  unseen ${Math.min(heat.unseen, 99).toFixed(1)} s`);
  const bustFolder = Debug.addFolder('Bust & cash');
  bustFolder.add(BUST_TUNING, 'speed', 0.5, 8, 0.5).name('stopped below (m/s)');
  bustFolder.add(BUST_TUNING, 'radius', 4, 20, 0.5).name('cop within (m)');
  bustFolder.add(BUST_TUNING, 'time', 0.5, 8, 0.5).name('for (s)');
  bustFolder.add(FINE_TUNING, 'base', 0, 400, 5).name('fine base ($)');
  bustFolder.add(FINE_TUNING, 'perHeat', 0, 600, 5).name('fine per heat ($)');
  bustFolder.add(economy, 'cash', 0, 200000, 100).listen();
  bustFolder.add(economy, 'reset').name('reset cash');
  const cars = Debug.addFolder('Cars');
  const specPanel = addSpecPanel(player.phys.spec);
  adoptSpec = () => specPanel.adopt();
  cars
    .add(
      {
        go: () => {
          sys.builds.reset();
          equipCar(player, PLAYER_CAR, sys.builds.of(PLAYER_CAR));
          specPanel.adopt();
        },
      },
      'go',
    )
    .name('reset pit garage upgrades');
  Debug.watch('air', () => {
    const s = player.phys.state;
    return `${s.airborne ? 'AIR' : 'ground'}  y ${s.y.toFixed(1)}  grade ${(s.slope * 100).toFixed(0)}%  load ${s.load.toFixed(2)}  last ${s.airTime.toFixed(2)} s`;
  });
  const fxFolder = Debug.addFolder('Post FX');
  fxFolder.add(POSTFX, 'enabled');
  fxFolder.add(POSTFX, 'bloom', 0, 3, 0.01);
  fxFolder.add(POSTFX, 'bloomRadius', 0, 1, 0.01);
  fxFolder.add(POSTFX, 'bloomThreshold', 0, 2, 0.01);
  fxFolder.add(POSTFX, 'vignette', 0, 1, 0.01);
  fxFolder.add(POSTFX, 'grain', 0, 0.2, 0.005);
  fxFolder.add(POSTFX, 'aberration', 0, 0.01, 0.0001);
  fxFolder.add(POSTFX, 'saturation', 0, 2, 0.01);
  fxFolder.add(POSTFX, 'curve', 0, 0.25, 0.005).name('screen bend');
  for (const opt of GRAPHICS_OPTIONS) {
    fxFolder
      .add(GRAPHICS, opt.key)
      .name(opt.label.toLowerCase())
      .listen()
      .onChange((v: boolean) => setGraphic(opt.key as GraphicsKey, v));
  }
  Debug.watch('gps', () => (gps.target ? `${gps.route ? `${gps.remaining.toFixed(0)} m  ${gps.route.nodes.length} nodes` : 'no route'}` : 'no target'));
  addAlleyPanel(sys);
  addWorldPanel(sys);
  addTeleportPanel(sys);
  return { adoptSpec };
}

/** Alleys, passages and nooks (IMPROVEMENTS #19): teleports to the nearest one and the ground under the car. */
function addAlleyPanel({ city, player, camRig }: DebugSystems): void {
  const f = city.features;
  const d2 = (p: Vec2) => (p.x - player.pos.x) ** 2 + (p.z - player.pos.z) ** 2;
  const go = (pos: Vec2, dir: Vec2) => {
    player.teleport(pos, Math.atan2(dir.x, dir.z));
    camRig.snap();
  };
  /** 8 m out from a room's first opening, facing in. */
  const toRoom = (kind: Interior['kind']) => {
    const doors = f.interiors.filter((r) => r.kind === kind).map((r) => {
      const q = r.doors[0];
      const o = SIDE_OUT[q.side];
      const mid = (q.from + q.to) / 2;
      const b = r.box;
      const edge = q.side === 'N' ? b.minZ : q.side === 'S' ? b.maxZ : q.side === 'W' ? b.minX : b.maxX;
      const at = q.side === 'N' || q.side === 'S' ? { x: mid, z: edge } : { x: edge, z: mid };
      return { pos: { x: at.x + o.x * 8, z: at.z + o.z * 8 }, dir: { x: -o.x, z: -o.z } };
    });
    const best = doors.sort((a, b) => d2(a.pos) - d2(b.pos))[0];
    if (best) go(best.pos, best.dir);
  };
  const folder = Debug.addFolder('Alleys');
  folder
    .add(
      {
        go: () => {
          const mouths = f.alleys.flatMap((a) => {
            const b = a.box;
            if (a.axis === 'z') {
              const x = (b.minX + b.maxX) / 2 - 1.5;
              return [{ pos: { x, z: b.minZ + 1 }, dir: { x: 0, z: 1 } }, { pos: { x: x + 3, z: b.maxZ - 1 }, dir: { x: 0, z: -1 } }];
            }
            const z = (b.minZ + b.maxZ) / 2 - 1.5;
            return [{ pos: { x: b.minX + 1, z: z + 3 }, dir: { x: 1, z: 0 } }, { pos: { x: b.maxX - 1, z }, dir: { x: -1, z: 0 } }];
          });
          const best = mouths.sort((a, b) => d2(a.pos) - d2(b.pos))[0];
          if (best) go(best.pos, best.dir);
        },
      },
      'go',
    )
    .name('teleport to nearest alley');
  folder.add({ go: () => toRoom('passage') }, 'go').name('teleport to nearest underpass');
  folder.add({ go: () => toRoom('nook') }, 'go').name('teleport to nearest hidden nook');
  Debug.watch('ground', () => {
    const r = interiorAt(f.interiors, player.pos);
    return `${surfaceAt(city, player.pos)}${r ? `  ${r.id}${r.hidden ? ' (hidden)' : ''}` : ''}  ${f.alleys.length} alleys`;
  });
}

/**
 * Teleports for checking the places the drive goes: every garage (dropped in its circle with the menu open),
 * Jacques Pneu with the winter tires already in the trunk (the TIRES tab's INSTALL row), the storage circle on
 * Ottawa, and the home bay.
 */
function addTeleportPanel({ city, player, camRig, openPitShop, mission, storage, events }: DebugSystems): void {
  const folder = Debug.addFolder('Teleport');
  const put = (p: Vec2, yaw: number) => {
    player.teleport({ x: p.x, z: p.z }, yaw);
    camRig.snap();
  };
  const garage = (s: PitStop) => {
    put(s.bay, s.bay.yaw);
    openPitShop(s);
  };
  for (const s of city.features.pitStops) folder.add({ go: () => garage(s) }, 'go').name(`garage: ${s.name}`);
  const goal = mission.garage;
  if (goal)
    folder
      .add(
        {
          go: () => {
            if (!mission.active) {
              events.message('Debug: start the winter-tire drive first (title > Winter tires).', 'warn');
              return;
            }
            mission.loadTires();
            garage(goal);
          },
        },
        'go',
      )
      .name(`garage: ${goal.name}, tires in trunk`);
  // A car length back from the circle, in the curb lane, so the stop is still yours to make
  folder.add({ go: () => put({ x: storage.pos.x - Math.sin(storage.yaw) * 12, z: storage.pos.z - Math.cos(storage.yaw) * 12 }, storage.yaw) }, 'go').name('tire storage (short of the circle)');
  const home = city.features.curb.find((b) => b.legal);
  if (home) folder.add({ go: () => put(home.pos, home.yaw) }, 'go').name('home bay (the start)');
}

/** Bigger city (IMPROVEMENTS #20): draw distance / tiling stats, pit stops, the precinct. */
function addWorldPanel({ city, player, camRig, tiles, pitStops, openPitShop }: DebugSystems): void {
  const f = city.features;
  const folder = Debug.addFolder('World');
  folder.add(tiles, 'distanceScale', 0.3, 2, 0.05).name('draw distance x');
  Debug.watch('tiles', () => `${tiles.stats.visible} drawn / ${tiles.stats.tiles} tiles (${tiles.stats.split} meshes split)`);
  const d2 = (p: Vec2) => (p.x - player.pos.x) ** 2 + (p.z - player.pos.z) ** 2;
  const nearestStop = () => [...f.pitStops].sort((a, b) => d2(a.sign) - d2(b.sign))[0];
  folder
    .add(
      {
        go: () => {
          const s = nearestStop();
          if (!s) return;
          // In line with the service circle, out on the street side, facing in
          const sx = s.sides[0] === 'W' ? -1 : 1;
          const c = s.canopy;
          player.teleport({ x: (c.minX + c.maxX) / 2 + sx * ((c.maxX - c.minX) / 2 + 4), z: s.bay.z }, Math.atan2(-sx, 0));
          camRig.snap();
        },
      },
      'go',
    )
    .name('teleport to nearest pit stop');
  folder.add({ go: () => addDamage(player, 0.4) }, 'go').name('damage car +40%');
  folder.add(PIT_TUNING, 'settle', 0.2, 5, 0.1).name('pit stop settle (s)');
  folder.add(PIT_TUNING, 'fullRepair', 0, 50000, 500).name('pit stop full repair ($)');
  folder.add({ go: () => nearestStop() && openPitShop(nearestStop()) }, 'go').name('open the pit garage now');
  Debug.watch('pit', () => (pitStops.current ? `${pitStops.current.name}  ${(pitStops.progress * 100).toFixed(0)}%  quote ${formatCash(pitStops.quote())}` : 'no pit stop'));
  const station = f.station;
  if (station) {
    folder
      .add(
        {
          go: () => {
            const back = 14;
            player.teleport({ x: station.dispatch.x + station.out.x * back, z: station.dispatch.z + station.out.z * back }, Math.atan2(-station.out.x, -station.out.z));
            camRig.snap();
          },
        },
        'go',
      )
      .name('teleport to the SPVM');
  }
}

/** Phase 6: pothole thresholds and kicks, the last hit, and a button that lines the car up on a big pit. */
function addPotholePanel(sys: DebugSystems): void {
  const { potholes, potholeHits: hits, player, city, events } = sys;
  const T = POTHOLE_TUNING;
  const f = Debug.addFolder('Potholes');
  f.add(T, 'safeKmh', 0, 60, 1).name('no damage below km/h');
  f.add(T, 'hardKmh', 20, 120, 1).name('serious above km/h');
  f.add(T, 'smallHigh', 0, 0.05, 0.001).name('small dmg at hard km/h-');
  f.add(T, 'bigHigh', 0, 0.1, 0.001).name('big dmg at hard km/h-');
  f.add(T, 'bigHard', 0, 0.2, 0.005).name('big dmg past hard');
  f.add(T, 'bigPerKmh', 0, 0.01, 0.0005).name('big dmg per km/h over');
  f.add(T, 'wheelCap', 0, 0.4, 0.01).name('max dmg per wheel');
  f.add(T, 'damageScale', 0, 2, 0.05).name('damage x');
  f.add(T, 'pitch', 0, 0.2, 0.005).name('nose kick rad');
  f.add(T, 'shove', 0, 0.1, 0.005).name('shove x speed');
  f.add(T, 'yank', 0, 0.3, 0.01).name('steering yank rad');
  f.add(T, 'thump', 0, 1, 0.01).name('thump per m/s');
  f.add(T, 'feelKmh', 0, 80, 1).name('suspension above km/h');
  f.add(T, 'heave', 0, 4, 0.05).name('heave kick m/s');
  f.add(T, 'nod', 0, 3, 0.05).name('nose nod rad/s');
  f.add(T, 'messageCooldown', 0, 120, 1).name('message cooldown s');
  // Put the car 45 m before the nearest big pit, on its line, pointed the way that lane drives
  f.add(
    {
      go: () => {
        let best = null as (typeof potholes.pits)[number] | null;
        let bestD = Infinity;
        for (const p of potholes.pits) {
          if (p.depth !== 'big') continue;
          const d = (p.pos.x - player.pos.x) ** 2 + (p.pos.z - player.pos.z) ** 2;
          if (d < bestD && d > 60 * 60) {
            best = p;
            bestD = d;
          }
        }
        if (!best) return;
        const lane = city.laneOnEdge(city.edges[best.edge], best.pos).lane;
        const dir = lane.dir;
        player.teleport({ x: best.pos.x - dir.x * 45, z: best.pos.z - dir.z * 45 }, Math.atan2(dir.x, dir.z));
        sys.camRig.snap();
        events.message(`Big pothole (r ${best.r.toFixed(1)} m) 45 m ahead`, 'info');
      },
    },
    'go',
  ).name('line up on a big pothole');
  const big = potholes.pits.filter((p) => p.depth === 'big').length;
  const edges = new Set(potholes.pits.map((p) => p.edge)).size;
  Debug.watch('potholes', () => {
    const l = hits.last;
    const last = l ? `  last ${l.depth} @${l.kmh.toFixed(0)} km/h +${(l.damage * 100).toFixed(1)}%` : '';
    return `${potholes.pits.length} (${big} big) on ${edges}/${city.edges.length} edges  hits ${hits.hits}${last}`;
  });
}

/** Phase 7: the session's closures, cone and breach knobs, and buttons that put the car in front of a fence or a cone line. */
function addClosurePanel(sys: DebugSystems): void {
  const { closures, cones, chantier, player, city, events, police, gps } = sys;
  const f = Debug.addFolder('Rue barrée & cones');
  f.add(CHANTIER_TUNING, 'conesHit', 1, 10, 1).name('breach at cones hit');
  f.add(CHANTIER_TUNING, 'firstHeat', 0, 0.5, 0.01).name('heat 1st line');
  f.add(CHANTIER_TUNING, 'nextHeat', 0, 0.5, 0.01).name('heat next lines');
  f.add(CALL_TUNING, 'time', 5, 120, 1).name('call-in lasts s');
  f.add(CALL_TUNING, 'skill', 0.3, 1, 0.01).name('call-in speed x');
  f.add(CONE_TUNING, 'kick', 0.5, 3, 0.05).name('cone kick x');
  f.add(CONE_TUNING, 'friction', 1, 15, 0.5).name('cone friction m/s2');
  f.add(CONE_TUNING, 'topple', 0.5, 10, 0.1).name('cone falls above m/s');
  f.add(CONE_TUNING, 'carDrag', 0, 0.05, 0.001).name('car slowed per cone');
  // Teleport 50 m before a fence or a cone line, in a lane that runs into it, pointed at it
  const lineUp = (lanes: number[], target: { x: number; z: number }, what: string) => {
    let best: Lane | null = null;
    for (const id of lanes) {
      const l = city.lanes[id];
      if (!best || l.index > best.index) best = l;
    }
    if (!best) return;
    const d = best.dir;
    const along = (target.x - best.start.x) * d.x + (target.z - best.start.z) * d.z;
    const back = Math.min(50, along - 4);
    const p = { x: best.start.x + d.x * (along - back), z: best.start.z + d.z * (along - back) };
    player.teleport(p, Math.atan2(d.x, d.z));
    sys.camRig.snap();
    events.message(`${what} ${back.toFixed(0)} m ahead`, 'info');
  };
  const nearest = <T extends { pos: { x: number; z: number } }>(xs: T[]): T | null => {
    let best: T | null = null;
    let bestD = Infinity;
    for (const x of xs) {
      const d = (x.pos.x - player.pos.x) ** 2 + (x.pos.z - player.pos.z) ** 2;
      if (d < bestD && d > 70 * 70) (best = x), (bestD = d);
    }
    return best;
  };
  f.add(
    {
      go: () => {
        const h = nearest(closures.hard.map((x) => ({ x, pos: x.center })));
        if (!h) return;
        const lanes = h.x.lanes.filter((id) => city.lanes[id].from === city.edges[h.x.edge].a);
        lineUp(lanes.length ? lanes : h.x.lanes, h.x.fences[0].a, 'Fence');
      },
    },
    'go',
  ).name('line up on a fence');
  f.add(
    {
      go: () => {
        const l = nearest(closures.lines.map((x) => ({ x, pos: x.cones[0] })));
        if (!l) return;
        const mid = { x: (l.x.a.x + l.x.b.x) / 2, z: (l.x.a.z + l.x.b.z) / 2 };
        lineUp(l.x.lanes, mid, 'Cone line');
      },
    },
    'go',
  ).name('line up on a cone line');
  f.add(
    {
      go: () => {
        const m = nearest(closures.merges.map((x) => ({ x, pos: x.taper })));
        if (m) lineUp([m.x.into], m.x.taper, `Lane ends (${m.x.kind}), taper`);
      },
    },
    'go',
  ).name('line up on a lane merge');
  f.add(DRIVER_TUNING, 'mergeLook', 20, 150, 5).name('AI merge look m');
  f.add(DRIVER_TUNING, 'mergeSignal', 0, 3, 0.1).name('AI signal before merge s');
  f.add({ go: () => police.respond(player.pos) }, 'go').name('call it in (send a patrol)');
  f.add({ go: () => gps.setWaypoint(closures.hard.length ? closures.hard[0].center : null) }, 'go').name('GPS to a work zone');
  const partial = closures.hard.filter((h) => h.side !== 'both').length;
  Debug.watch('closures', () => {
    const route = gps.route && closures.routeHitsFence(gps.route) ? '  GPS route hits a fence' : '';
    return `salt ${closures.salt}: ${closures.hard.length} fences (${partial} one-way), ${closures.lines.length} cone tapers, ${closures.merges.length} merges (${MERGE_STATS.merges} done), ${cones.cones.length} cones (${cones.scattered} moved)  breaches ${chantier.breaches}  answering ${police.responding}  test route ${closures.gpsHitsFence ? 'hits' : 'MISSES'} a fence, storage leg ${closures.storageLegFences}, garage leg ${closures.garageLegFences}${closures.garageLegBoulevard ? ' (boulevard)' : ''} (${closures.dropped} dropped)${route}`;
  });
}
