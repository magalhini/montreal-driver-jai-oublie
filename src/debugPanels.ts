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
import { DRIVER_TUNING } from './ai/LaneDriver';
import type { RiderDodge } from './ai/RiderDodge';
import { RIDER_TUNING, type Riders } from './ai/Riders';
import { TRUCK_TUNING, type TrafficSystem } from './ai/TrafficAI';
import { BUST_TUNING, type BustSystem } from './gameplay/Bust';
import type { Wreck } from './gameplay/Wreck';
import type { Economy } from './gameplay/Economy';
import type { Gps } from './gameplay/Gps';
import { PIT_TUNING, type PitStopSystem } from './gameplay/PitStop';
import type { CameraRig } from './render/CameraRig';
import { GRAPHICS, GRAPHICS_OPTIONS, POSTFX, setGraphic, type GraphicsKey } from './render/PostFX';
import type { StaticTiles } from './render/StaticTiles';
import type { Interior, OffenseKind, Vec2 } from './types';
import type { Car } from './vehicles/Car';
import { addDamage, repair } from './vehicles/Damage';
import { equipCar, PLAYER_CAR } from './vehicles/Fleet';
import { addSpecPanel } from './vehicles/SpecPanel';
import type { Builds } from './gameplay/Builds';
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
  openPitShop: (stop: PitStop) => void;
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
      events.message('Immunity on: the police ignore you, no damage', 'info');
    });
  cheats.add({ go: () => wreck.debugBoom() }, 'go').name('explode the car');
  cheats.add({ fix: () => repair(player) }, 'fix').name('repair car');
  Debug.watch('cars', () => {
    const trucks = [...traffic.drivers.values()].filter((d) => d.car.look.style === 'truck' || d.car.look.style === 'keitruck').length;
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
  streetFolder.add(TRUCK_TUNING, 'keiTruck', 0, 1, 0.01).name('kei truck share');
  streetFolder.add(TRUCK_TUNING, 'maxBoxTrucks', 0, 10, 1).name('max box trucks');
  const laneAhead = (d: number) => {
    const f = fwd(player.yaw);
    return city.nearestLanePoint({ x: player.pos.x + f.x * d, z: player.pos.z + f.z * d });
  };
  streetFolder.add({ cyclist: () => { const h = laneAhead(30); riders.spawn(h.lane, h.t, 'bicycle'); } }, 'cyclist').name('spawn cyclist ahead');
  streetFolder.add({ scooter: () => { const h = laneAhead(30); riders.spawn(h.lane, h.t, 'scooter'); } }, 'scooter').name('spawn scooter ahead');
  streetFolder.add({ truck: () => { const h = laneAhead(40); traffic.spawnCar(h.lane, h.pos, { style: 'truck' }); } }, 'truck').name('spawn truck ahead');
  streetFolder.add({ kei: () => { const h = laneAhead(40); traffic.spawnCar(h.lane, h.pos, { style: 'keitruck' }); } }, 'kei').name('spawn kei truck ahead');
  Debug.watch('heat', () => {
    const short: Record<OffenseKind, string> = {
      redLight: 'red',
      speeding: 'speed',
      wrongWay: 'wrong',
      carCrash: 'crash',
      policeCrash: 'cop',
      pedEndangered: 'ped',
      sidewalk: 'walk',
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
    return `${police.cops.size} cops  ${police.pursuers}/${police.wantedUnits} pursuing [${modes.join('')}]  seen ${seen < 99 ? seen.toFixed(1) + ' s ago' : 'never'}`;
  });
  const policeFolder = Debug.addFolder('Police');
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
  ).name('spawn cop ahead');
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
  Debug.watch('bust', () => `${bust.phase}  ring ${(bust.progress * 100).toFixed(0)}%  busts ${bust.busts}  unseen ${Math.min(heat.unseen, 99).toFixed(1)} s`);
  const bustFolder = Debug.addFolder('Bust & cash');
  bustFolder.add(BUST_TUNING, 'speed', 0.5, 8, 0.5).name('stopped below (m/s)');
  bustFolder.add(BUST_TUNING, 'radius', 4, 20, 0.5).name('cop within (m)');
  bustFolder.add(BUST_TUNING, 'time', 0.5, 8, 0.5).name('for (s)');
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
  fxFolder.add(POSTFX, 'scanlines', 0, 1, 0.01).name('scanline strength');
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
  folder.add(PIT_TUNING, 'fullRepair', 0, 50000, 500).name('pit stop full repair ¥');
  folder.add({ go: () => nearestStop() && openPitShop(nearestStop()) }, 'go').name('open the pit garage now');
  Debug.watch('pit', () => (pitStops.current ? `${pitStops.current.name}  ${(pitStops.progress * 100).toFixed(0)}%  quote ¥${pitStops.quote()}` : 'no pit stop'));
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
      .name('teleport to police station');
  }
}
