import * as THREE from "three";
import { CONFIG, KMH } from "./config";
import { Debug } from "./core/Debug";
import { addDebugPanels } from "./debugPanels";
import { Events } from "./core/Events";
import { Game } from "./core/Game";
import { Input } from "./core/Input";
import { Rng } from "./core/Rng";
import { World } from "./core/World";
import { Heat } from "./ai/Heat";
import { AudioSystem } from "./audio/AudioSystem";
import { CATEGORIES, type AudioKey } from "./audio/Mixer";
import { OffenseDetector } from "./ai/OffenseDetector";
import { Pathfinder } from "./ai/Pathfinding";
import { PoliceSystem } from "./ai/PoliceAI";
import { ParkedCars } from "./ai/ParkedCars";
import { PedestrianView } from "./ai/PedestrianView";
import { Pedestrians } from "./ai/Pedestrians";
import { RouteDebugView } from "./ai/RouteDebugView";
import { DogWalkers } from "./ai/DogWalkers";
import { DogView } from "./ai/DogView";
import { RiderDodge } from "./ai/RiderDodge";
import { Riders } from "./ai/Riders";
import { RiderView } from "./ai/RiderView";
import { TrafficSystem } from "./ai/TrafficAI";
import { BustSystem } from "./gameplay/Bust";
import { Economy } from "./gameplay/Economy";
import { Gps } from "./gameplay/Gps";
import { Tires } from "./gameplay/Tires";
import { formatClock, WinterTires } from "./gameplay/WinterTires";
import { Snowstorm, SNOWSTORM_TUNING } from "./gameplay/Snowstorm";
import { TirePickup } from "./gameplay/TirePickup";
import { TirePickupView } from "./gameplay/TirePickupView";
import { PortPicnic } from "./gameplay/PortPicnic";
import { PortPicnicView } from "./gameplay/PortPicnicView";
import { storageStop } from "./gameplay/MissionRoute";
import { Recovery } from "./gameplay/Recovery";
import { Wreck, wreckDetail } from "./gameplay/Wreck";
import { WreckView } from "./gameplay/WreckView";
import { Breakdown } from "./gameplay/Breakdown";
import { BreakdownView } from "./gameplay/BreakdownView";
import { PitStopSystem } from "./gameplay/PitStop";
import { PotholeHits } from "./gameplay/PotholeHits";
import { Closures, closureSalt, defaultAnchors } from "./gameplay/Closures";
import { Cones } from "./gameplay/Cones";
import { Chantier } from "./gameplay/Chantier";
import { OfficerView } from "./gameplay/OfficerView";
import { ParkingTicket } from "./gameplay/ParkingTicket";
import { TicketAgentView } from "./gameplay/TicketAgentView";
import { CollisionSystem } from "./physics/Collision";
import { SpatialHash } from "./physics/SpatialHash";
import { CameraRig } from "./render/CameraRig";
import { StaticTiles } from "./render/StaticTiles";
import {
  GRAPHICS,
  GRAPHICS_OPTIONS,
  POSTFX,
  PostFX,
  setGraphic,
  type GraphicsKey,
} from "./render/PostFX";
import { Cockpit } from "./vehicles/Cockpit";
import { SpeedLimiter } from "./gameplay/SpeedLimiter";
import { Renderer } from "./render/Renderer";
import { FullMap } from "./ui/FullMap";
import { Hud } from "./ui/Hud";
import { buildMapImage } from "./ui/MapImage";
import { Menu, type PlayMode } from "./ui/Menu";
import { Briefing } from "./ui/Briefing";
import { IntroCutscene } from "./ui/IntroCutscene";
import { currentMap } from "./maps";
import { Messages } from "./ui/Messages";
import { Minimap } from "./ui/Minimap";
import { PitShop } from "./ui/PitShop";
import { Builds } from "./gameplay/Builds";
import { Car } from "./vehicles/Car";
import { equipCar, FLEET, PLAYER_CAR } from "./vehicles/Fleet";
import { CarView } from "./vehicles/CarView";
import { repair } from "./vehicles/Damage";
import { Effects } from "./vehicles/Effects";
import { PlayerController } from "./vehicles/PlayerController";
import { Ignition } from "./vehicles/Ignition";
import { TurnSignals } from "./vehicles/TurnSignals";
import { VehiclePhysics } from "./vehicles/VehiclePhysics";
import { buildAlleys } from "./world/AlleyView";
import { buildBuildings } from "./world/BuildingFactory";
import { buildCanal } from "./world/CanalView";
import { buildParks } from "./world/ParkView";
import { solidParts } from "./world/Interiors";
import { buildEnvironment } from "./world/Environment";
import { RainView } from "./world/RainView";
import { buildSnowBerms } from "./world/SnowCover";
import { SNOW_TUNING, SnowView } from "./world/SnowView";
import { Weather } from "./world/Weather";
import { buildFerris } from "./world/FerrisWheel";
import { buildLandmarks } from "./world/LandmarkView";
import { buildOldCity } from "./world/OldCityProps";
import { buildPlazas } from "./world/PlazaView";
import { buildPoliceStation } from "./world/PoliceStationView";
import { buildPitStops } from "./world/PitStopView";
import { Potholes } from "./world/Potholes";
import { buildPotholes } from "./world/PotholeView";
import { buildMedians } from "./world/BoulevardMedians";
import { buildClosures } from "./world/ClosureView";
import { ConeView } from "./world/ConeView";
import { buildRoads } from "./world/RoadMesh";
import { buildStreetLamps } from "./world/StreetLamps";
import { buildStreetProps } from "./world/StreetProps";
import { buildShopSigns } from "./world/ShopSigns";
import { buildMetroEntrances } from "./world/MetroEntrances";
import { buildRoadSigns } from "./world/RoadSigns";
import { buildStreetSigns } from "./world/StreetSigns";
import { buildTireStorage } from "./world/TireStorage";
import { buildHomeBay } from "./world/HomeBay";
import { SteamVents } from "./world/SteamVents";
import { TrafficLights } from "./world/TrafficLights";
import { TrafficLightView } from "./world/TrafficLightView";

const r = new Renderer(document.getElementById("app")!);
const events = new Events();
const input = new Input();
const rng = new Rng(CONFIG.SEED + 1);
// T36: the city chosen at load (switching cities reloads the page)
const map = currentMap();
const city = map.generate(CONFIG.SEED);
VehiclePhysics.ground = city.terrain;

// Potholes are rolled first: the boulevard islands keep off them
const potholes = new Potholes(city, CONFIG.SEED);
// Rue barrée and cone lines (PRD Phase 7): rolled once per page load (`?closures=<n>` replays one), then frozen.
// The anchors are the winter-tire drive: west spawn, eastern garage (PRD 5.1).
const anchors = defaultAnchors(city);
const closures = new Closures(
  city,
  CONFIG.SEED,
  closureSalt(),
  anchors,
  potholes.pits,
);
// Everything added to the scene from here to the tiling below is static city (IMPROVEMENTS #20)
const staticStart = r.scene.children.length;
const envParts = buildEnvironment(r.scene, r.renderer, city);
const roadMats = buildRoads(city, r.scene, map.markings);
const buildings = buildBuildings(city.buildings, r.scene);
// Montreal shop boards on some street faces (PRD 11B): IGA, Provigo, Starbucks, Tim Hortons, poutine
buildShopSigns(city, r.scene);
// STM metro entrances on corner buildings, the blue MÉTRO sign off each canopy
buildMetroEntrances(city, r.scene);
// Notre-Dame and the clock tower (their own meshes; their boxes are in `city.buildings` as colliders)
buildLandmarks(city, r.scene);
buildPoliceStation(city, r.scene);
const propColliders = buildStreetProps(city, r.scene);
// Street lamps break away (and still hit the car), so their meshes are edited per instance and stay out of the tiling
const streetLamps = buildStreetLamps(city);
// Speed plates and ARRÊT signs at the curb (breakaway posts: edited per instance, so their group joins the
// scene after the tiling below)
const signPosts = buildRoadSigns(city);
// Street blades at the boulevard corners and parking plates on the residential curbs (static)
const streetSignColliders = buildStreetSigns(city, r.scene);
// Vieux-Montréal's cobbles: bare trees, bike racks and winter terraces on the sidewalks (PRD Phase 5)
const oldCityColliders = buildOldCity(city, r.scene, streetLamps.positions);
// Planted islands with bare trees down the middle of René-Lévesque and the other long boulevards
const medianColliders = buildMedians(
  city,
  r.scene,
  potholes.pits,
  closures.busyEdges,
);
// Work zones: barricades, boards, fences and the machines behind them (colliders are the roll's)
buildClosures(city, closures, r.scene);
const canal = buildCanal(city, r.scene);
buildAlleys(city, r.scene);
// IMPROVEMENTS #20: garages (pit stops)
buildPitStops(city, r.scene);
buildParks(city, r.scene);
// Fountain squares and the Old Port's promenade, lot and railing
buildPlazas(city, r.scene);
// Winter (PRD 4.4): plowed snow along the curbs (roof caps come with the buildings)
if (CONFIG.SKY === "winterDay") buildSnowBerms(city, r.scene);
// Cut the whole-city meshes into tiles so they can be frustum / distance culled
const tiles = new StaticTiles();
tiles.split(r.scene.children.slice(staticStart));
// The wheel turns, so it stays out of the static tiling
const ferris = buildFerris(city, r.scene);
r.scene.add(streetLamps.group);
r.scene.add(signPosts.group);
// Potholes (PRD 5.4): seeded craters in the lanes, not on any map. One decal mesh, kept out of the tiling
buildPotholes(city, potholes.pits, r.scene);
const lights = new TrafficLights(city, rng);
const lightView = new TrafficLightView(
  city,
  lights,
  r.scene,
  r.camera,
  map.signals,
);
const landmarkColliders = [
  ...city.features.pitStops.flatMap((p) => p.colliders),
  ...(city.features.station?.colliders ?? []),
  ...(city.features.parks ?? []).flatMap((p) => p.colliders),
  ...(city.features.squares ?? []).flatMap((s) => s.colliders),
  ...(city.features.port?.colliders ?? []),
];
const statics = new SpatialHash([
  ...city.buildings.flatMap(solidParts),
  ...city.walls,
  ...propColliders,
  ...streetSignColliders,
  ...oldCityColliders,
  ...medianColliders,
  ...streetLamps.colliders,
  ...signPosts.colliders,
  ...lightView.colliders,
  ...landmarkColliders,
  ...closures.colliders,
]);
const world = new World(city, events, rng, statics, lights);
world.roadworks = closures;
signPosts.attach(events, statics);
streetLamps.attach(events, statics);

// The legal curb bay on the west side of the grid, pointed east: the winter-tire spawn, and free roam's too
const start = {
  pos: anchors.spawn,
  yaw: Math.atan2(anchors.heading.x, anchors.heading.z),
};
// What the pit garage has done to the car (saved between sessions)
const builds = new Builds();
const starter = FLEET[PLAYER_CAR];
const player = new Car(
  "player",
  starter.spec,
  { ...starter.look },
  start.pos,
  start.yaw,
);
equipCar(player, PLAYER_CAR, builds.of(PLAYER_CAR));
world.player = player;
world.addCar(player);
// A red the player is sitting at changes 25% sooner, for their direction only
lights.forWaiting(() => (world.mode === "free" && !world.controlLocked ? player : null));

const camRig = new CameraRig(r.camera);
camRig.groundAt = (x, z) => city.terrain.surfaceY(x, z);
camRig.rooms = city.features.interiors;
camRig.alleys = city.features.alleys;
camRig.courts = (city.features.parks ?? []).filter((p) => p.enclosed).flatMap((p) => [p.lawn, p.gate, ...(p.gates ?? [])]);
camRig.walls = new SpatialHash(city.buildings.flatMap(solidParts));
const carView = new CarView(r.scene, () => world.cars, r.camera);
carView.groundAt = (x, z) => city.terrain.heightAt(x, z);
carView.surfaceAt = (x, z) => city.terrain.surfaceY(x, z);
const effects = new Effects(r.scene);
effects.heightAt = (x, z) => city.terrain.heightAt(x, z);
effects.setViewportHeight(window.innerHeight, r.camera.fov);
r.onResize((_w, h) => effects.setViewportHeight(h, r.camera.fov));
events.on("collision", (e) => {
  effects.sparksAt(e.pos, e.impulse / 6000);
  if (e.a === player.id || e.b === player.id)
    camRig.addShake(Math.min(1, e.impulse / 15000));
});
events.on("propBroken", (e) => {
  if (e.struck) return; // the collision handler already sparked and shook
  effects.sparksAt(e.pos, 0.4);
  if (e.car === player.id) camRig.addShake(0.08);
});

const uiRoot = document.getElementById("ui")!;
const hud = new Hud(uiRoot);
const economy = new Economy();
new Messages(uiRoot, events);

const post = new PostFX(r.renderer, r.scene, r.camera);
r.onResize(() => post.setSize());
const cockpit = new Cockpit(player);
const game = new Game(() => {
  cockpit.renderMirror(r.renderer, r.scene);
  post.render(game.time);
});
game.addSim({ update: () => world.cars.forEach((c) => c.savePrev()) });
const weather = new Weather(CONFIG.SEED + 11);
const winter = CONFIG.SKY === "winterDay";
// Winter map: slush, no rain cycle, and grip comes from the tires (PRD 4.4), not from the wet road
if (winter) weather.holdWinter();
game.addSim(weather);
const tires = new Tires();
// Snow squalls a few minutes into the drive: thicker snow, and summer tires lose up to a fifth of their grip
const snowstorm = new Snowstorm(world);
snowstorm.tireSet = () => tires.set;
if (winter) game.addSim(snowstorm);
game.addSim({
  update: () =>
    (VehiclePhysics.surfaceGrip = winter ? tires.grip * snowstorm.gripScale(tires.set) : weather.grip),
});
game.addSim(lights);
const limiter = new SpeedLimiter(world);
game.addSim(new PlayerController(world, input, limiter));
const ignition = new Ignition(world);
game.addSim(ignition);
const signals = new TurnSignals(world);
game.addSim(signals);
const traffic = new TrafficSystem(world);
// Always Busy: a full boulevard, in the winter-tire drive and in free roam.
traffic.target = CONFIG.MAX_TRAFFIC;
traffic.populate();
game.addSim(traffic);
const heat = new Heat(world);
// Traffic and police know about the fences (PRD 5.2); the GPS gets its own pathfinder below, which doesn't
const pathfinder = new Pathfinder(city, undefined, closures.closed);
const police = new PoliceSystem(world, heat, pathfinder);
police.populate();
game.addSim(police);
const parked = new ParkedCars(world);
game.addSim(parked);
const peds = new Pedestrians(world);
world.pedestrians = peds.peds;
peds.populate();
game.addSim(peds);
// Street life (IMPROVEMENTS #12): cyclists / scooters at the curb, dogs on leashes (trucks come with traffic)
const riders = new Riders(world);
riders.populate();
game.addSim(riders);
const riderDodge = new RiderDodge(world);
game.addSim(riderDodge);
const dogs = new DogWalkers(world, peds);
game.addSim(dogs);
game.addSim({ update: (dt) => world.cars.forEach((c) => c.step(dt)) });
// Wheels into the pits: the player and the SPVM are kicked and damaged, nearby traffic only bounces
const potholeHits = new PotholeHits(world, potholes);
game.addSim(potholeHits);
game.addSim({ update: () => world.compact() });
game.addSim(new CollisionSystem(statics, () => world.cars, events));
// Cones (PRD 5.3): shoved by every car after the collisions settled
const cones = new Cones(world, closures);
game.addSim(cones);
game.addSim(signPosts);
game.addView(signPosts);
game.addSim(streetLamps);
game.addView(streetLamps);
const wreck = new Wreck(world, economy, heat, police, game);
game.addSim(wreck);
// Past 120% damage the wheels come off: towed back repaired for a fee
const breakdown = new Breakdown(world, economy, heat, police);
breakdown.blocked = () =>
  bust.phase !== "free" || wreck.active || recovery.active;
breakdown.onRespawn = () => camRig.snap();
game.addSim(breakdown);
game.addSim(new OffenseDetector(world));
// Cone lines breached, the call-ins and the "rue barrée" line
const chantier = new Chantier(world, closures, cones, heat, police);
game.addSim(chantier);
game.addSim(heat);
const bust = new BustSystem(world, heat, police, economy);
bust.onRespawn = () => camRig.snap();
game.addSim(bust);
// Every painted curb stall is illegal. Sit between the lines and the agency walks up.
const parkingTickets = new ParkingTicket(world, economy);
game.addSim(parkingTickets);
const recovery = new Recovery(world, economy);
recovery.blocked = () =>
  bust.phase !== "free" || wreck.active || breakdown.active;
wreck.onRespawn = () => camRig.snap();
recovery.onRespawn = () => camRig.snap();
game.addSim(recovery);
const pitStops = new PitStopSystem(world, police);
pitStops.blocked = () =>
  bust.phase !== "free" ||
  wreck.active ||
  breakdown.active ||
  recovery.fade > 0;
game.addSim(pitStops);
events.on("splash", (e) => {
  effects.splash(e.pos, e.y);
  if (e.car === player.id) camRig.addShake(0.5);
});
// The GPS plans through every fence (PRD 5.2: that absence is the design)
const gps = new Gps(world, new Pathfinder(city));
game.addSim(gps);
const mission = new WinterTires(world, tires, gps, heat, economy);
const tireStorage = buildTireStorage(r.scene, city, storageStop(city));
// The one legal parking spot in Montreal: every session starts in it
buildHomeBay(r.scene, city);
const sceneBusy = () =>
  bust.phase !== "free" || wreck.active || breakdown.active || recovery.active;
// The storage stop on Ottawa: stop in its circle and the scene loads the tires into the trunk
const pickup = new TirePickup(world, storageStop(city));
pickup.armed = () => mission.needsTires;
pickup.blocked = sceneBusy;
pickup.chased = () => police.pursuers > 0;
pickup.onLoaded = () => mission.loadTires();
game.addSim(pickup);
// After the tires: stop in the Vieux-Port lot and he sits down with the lox bagel
const picnic = new PortPicnic(world);
picnic.armed = () => mission.wantsPicnic;
picnic.blocked = sceneBusy;
picnic.chased = () => police.pursuers > 0;
picnic.onDone = () => mission.finishPicnic();
game.addSim(picnic);
// After the cutscenes, so the clock sees the car taken on the same tick it is taken
game.addSim(mission);
pitStops.hint = (stop) => mission.bayHint(stop);
game.addSim({ update: (dt) => (world.time += dt) });
events.on("wrecked", (e) => {
  hud.stunt("WRECKED", wreckDetail(e.speed, e.kind, e.otherMass), null, true);
});

const mapImage = buildMapImage(city);
const minimap = new Minimap(uiRoot, mapImage, city, gps, player, police, () =>
  viewHeading(r.camera),
);
const fullMap = new FullMap(uiRoot, mapImage, city, gps, player, police, input);

// T30: title screen (the city keeps running behind it under the orbit camera) and pause menu
let session: PlayMode = "free";
const briefing = new Briefing(uiRoot);
// Montreal, then the car, before either mode starts (ESC / F / Space skip it)
const intro = new IntroCutscene(uiRoot, world, closures, potholes, {
  car: player,
  body: () => carView.bodyOf(player.id),
  cockpit,
});
let introCam = false;
const menu = new Menu(uiRoot, {
  cash: () => economy.cash,
  start: startSession,
  resume: () => {
    menu.hide();
    game.setPaused("menu", false);
  },
  quit: quitToTitle,
  mode: () => session,
  sound: (k) => audio.ui(k),
  volumes: {
    sliders: [
      { key: "master", label: "MASTER", hint: "Everything" },
      ...Object.entries(CATEGORIES).map(([key, c]) => ({
        key,
        label: c.label,
        hint: c.hint,
      })),
    ],
    get: (k) => audio.mixer.settings[k as AudioKey],
    set: (k, v) => audio.mixer.set(k as AudioKey, v),
  },
  graphics: {
    options: GRAPHICS_OPTIONS,
    get: (k) => GRAPHICS[k as GraphicsKey],
    set: (k, on) => setGraphic(k as GraphicsKey, on),
  },
});
// The spec panel is built with the debug folders, after this. The pit garage retitles it when parts are fitted.
let adoptSpec = (): void => {};
let uiSound = (_kind: "move" | "ok" | "back"): void => {};
// Pit garage: stop in a pit stop's circle for repairs, parts, rims, paint and mirror charms
const shop = new PitShop(uiRoot, r.renderer, post, builds, {
  car: () => player,
  cash: () => economy.cash,
  pay: (amount) => {
    if (economy.cash < amount) return false;
    economy.charge(amount);
    return true;
  },
  refund: (amount) => economy.earn(amount),
  repairQuote: () => pitStops.quote(),
  repair: () => repair(player),
  equip: (id, build) => {
    equipCar(player, id, build);
    adoptSpec();
  },
  park: (stop) => {
    player.teleport({ x: stop.bay.x, z: stop.bay.z }, stop.bay.yaw);
    camRig.snap();
  },
  message: (text, tone) => events.message(text, tone),
  pause: (on) => game.setPaused("pitshop", on),
  sound: (kind) => uiSound(kind),
  garage: (ev) => audio.garage.event(ev),
  winterTires: (stop) => mission.offer(stop),
  installWinterTires: () => mission.install(),
  tireCue: (step) => audio.garage.tire(step),
});
const orbitCenter = new THREE.Vector3();
uiRoot.classList.add("on-title");
menu.showTitle();
let shopWas = false;
game.onFrame((dt) => {
  input.poll();
  menu.update(dt);
  const back = input.pressed("pause") || input.pressed("escape");
  // Escape skips the storage scene instead of pausing
  if (pickup.playing && input.pressed("escape") && !menu.open) pickup.skip();
  if (picnic.playing && input.pressed("escape") && !menu.open) picnic.skip();
  intro.update(dt);
  if (
    intro.playing &&
    (input.pressed("escape") ||
      input.pressed("interact") ||
      input.pressed("handbrake"))
  )
    intro.skip();
  const briefingOn = briefing.open;
  if (briefingOn) {
    const choice = briefing.poll(input.pressed("escape"));
    if (choice === "drive") {
      briefing.hide();
      world.controlLocked = false;
      mission.startClock();
      events.message(
        "GPS set: tire storage first, then Jacques-Cartier Pneus Garage. It does not know which streets are closed.",
        "info",
        7,
      );
    } else if (choice === "title") quitToTitle();
  }
  const arrived = briefingOn ? null : pitStops.take();
  if (arrived) shop.open(arrived);
  const shopOn = briefingOn ? false : shop.frame(dt, input, back);
  // Back on the street from the garage: the winter-tire debrief, if INSTALL was picked in there
  if (shopWas && !shop.active) mission.leftGarage();
  shopWas = shop.active;
  if (briefingOn) {
    // The briefing owns confirm and escape until the car is released
  } else if (shopOn) {
    // The pit garage owns the keys until its fades are done
  } else if (menu.open) {
    if (back) menu.back();
  } else if (
    input.pressed("map") ||
    (fullMap.open && input.pressed("escape"))
  ) {
    fullMap.toggle();
    game.setPaused("map", fullMap.open);
  } else if (intro.playing) {
    // The intro owns the keys until it hands over to the briefing or the car
  } else if (back && !fullMap.open && !pickup.playing && !picnic.playing) {
    game.setPaused("menu", true);
    menu.showPause();
  }
  minimap.visible =
    !fullMap.open && world.mode !== "menu" && !briefing.open && !intro.playing && !picnic.cinematic;
  fullMap.update(dt);
  camRig.lookBack =
    input.isHeld("lookBack") &&
    !menu.open &&
    !fullMap.open &&
    !shop.active &&
    !briefing.open &&
    world.mode !== "menu";
  if (!menu.open && !fullMap.open && !shop.active && !briefing.open) {
    if (input.pressed("camera")) camRig.cycle();
    if (input.pressed("limiter")) limiter.on = !limiter.on;
    if (input.pressed("headlights") && !game.paused)
      player.headlights = !player.headlights;
    if (input.pressed("ignition") && !world.controlLocked && !game.paused)
      ignition.toggle();
    if (!world.controlLocked && !game.paused && player.phys.engineOn) {
      if (input.pressed("blinkLeft")) signals.toggle("left");
      if (input.pressed("blinkRight")) signals.toggle("right");
    }
  }
  if (input.pressed("debug")) Debug.toggle();
  Debug.update(dt);
  buildings.update(game.time);
  canal?.update(game.time, dt);
  ferris?.update(game.time);
});
game.addView(lightView);
// Phase 1 pass: manhole covers, and steam from some of them downtown / in the oldtown
const steam = new SteamVents(city, r.scene, r.camera);
game.addView(steam);
game.addView(carView);
game.addView(new ConeView(cones, r.scene, city.terrain));
const pedView = new PedestrianView(peds, r.scene, city.terrain);
game.addView(pedView);
game.addView(new DogView(dogs, peds, r.scene, city.terrain));
const riderView = new RiderView(world, r.scene, city.terrain, r.camera);
game.addView(riderView);
game.addView(new OfficerView(bust, r.scene, city.terrain));
game.addView(new TicketAgentView(parkingTickets, r.scene, city.terrain));
const pickupView = new TirePickupView(
  pickup,
  player,
  tireStorage,
  r.scene,
  city.terrain,
  () => carView.bodyOf(player.id),
);
game.addView(pickupView);
let pickupCam = false;
const picnicView = new PortPicnicView(picnic, uiRoot, r.scene, city.terrain);
game.addView(picnicView);
let picnicCam = false;
const wreckView = new WreckView(wreck, r.scene, r.camera, effects, (x, z) =>
  city.terrain.heightAt(x, z),
);
game.addView(wreckView);
const breakdownView = new BreakdownView(
  breakdown,
  player,
  r.scene,
  effects,
  (x, z) => city.terrain.heightAt(x, z),
  statics,
);
game.addView(breakdownView);
events.on("brokeDown", () => {
  hud.stunt(
    "BROKEN DOWN",
    "Your car took too much damage. That looks expensive... ",
    null,
    true,
  );
  camRig.addShake(0.2);
});
game.addView({
  sync: (alpha, dt) => {
    effects.wet = weather.wetness;
    pedView.rain = weather.rain;
    riderView.rain = weather.rain;
    effects.update(
      world.cars,
      player.pos,
      wreck.playing ? dt * game.timeScale : dt,
    );
    camRig.focus = bust.officer?.pos ?? parkingTickets.cameraFocus;
    cockpit.fit(player);
    const body = carView.bodyOf(player.id);
    cockpit.attach(body);
    camRig.cockpit = body ? { body, eye: cockpit.eye } : null;
    camRig.orbit = world.mode === "menu";
    orbitCenter.set(player.pos.x, 0, player.pos.z);
    // Before the intro aims: the charm shot reads the toy's pose, and the cabin has to be open while it does.
    const inCabin =
      !breakdown.playing &&
      !pickup.cinematic &&
      !picnic.cinematic &&
      (intro.inside || (camRig.cabinAt(player.interpPos(alpha)) && !intro.playing));
    cockpit.update(player, dt, inCabin);
    carView.setCutaway(inCabin ? player.id : null, ...cockpit.cabin);
    if (wreck.playing) wreckView.aim(r.camera);
    else if (breakdown.playing) breakdownView.aim(r.camera);
    else if (intro.playing) intro.aim(r.camera);
    else if (pickup.cinematic) pickupView.aim(r.camera, dt);
    else if (picnic.cinematic) picnicView.aim(r.camera, dt);
    else {
      if (pickupCam || introCam || picnicCam) camRig.snap();
      camRig.update(player, alpha, Math.max(dt, 1 / 240), orbitCenter);
    }
    pickupCam = pickup.cinematic;
    picnicCam = picnic.cinematic;
    introCam = intro.playing;
    // Post FX on top of the tuned settings: the wreck's punch
    post.boost.bloom = 0.55 * wreck.fx;
    post.boost.aberration = 0.0035 * wreck.fx;
    steam.rain = weather.rain;
    hud.paused = game.pausedBy("debug") && !menu.open && !fullMap.open;
    hud.limiter = limiter.on ? Math.round(limiter.cap / KMH) : null;
    hud.speedLimit = limiter.postedKmh;
    hud.speeding = player.speed > limiter.cap + 5 * KMH;
    hud.lights = player.lampsOn;
    hud.engine = ignition.state;
    hud.immune = world.immune;
    hud.cash = economy.cash;
    if (world.mode === "free") hud.objective = mission.objective();
    hud.clock = world.mode === "free" ? mission.clockText : null;
    hud.felony = heat.value;
    hud.evading = heat.evading;
    hud.bust = bust.progress;
    hud.bustedFine = bust.busted ? bust.fine : null;
    hud.fade = Math.max(
      bust.fade,
      recovery.fade,
      wreck.fade,
      breakdown.fade,
      shop.fade,
      intro.fade,
      pickup.fade,
      picnic.fade,
    );
    hud.update(player, dt);
    tiles.update(r.camera);
    streetLamps.cull(r.camera);
  },
});

Debug.attach({
  renderer: r.renderer,
  camera: r.camera,
  game,
  onFreeCam: (on) => {
    camRig.enabled = !on;
    world.controlLocked = on || world.mode === "menu";
    if (!on) camRig.snap();
  },
});
adoptSpec = addDebugPanels({
  world,
  player,
  events,
  city,
  traffic,
  peds,
  riders,
  riderDodge,
  dogs,
  heat,
  police,
  bust,
  wreck,
  economy,
  gps,
  camRig,
  tiles,
  pitStops,
  builds,
  tires,
  potholes,
  potholeHits,
  closures,
  cones,
  chantier,
  openPitShop: (s) => shop.open(s),
  mission,
  storage: storageStop(city),
}).adoptSpec;
Debug.watch("mission", () => mission.status());
const routeView = new RouteDebugView(
  pathfinder,
  city,
  player,
  new Rng(CONFIG.SEED + 7),
  r.scene,
  r.camera,
  r.renderer.domElement,
);
game.addView(routeView);
game.addView(minimap); // after the camera update
const roofs = [
  ...city.features.interiors.map((i) => i.box),
  ...city.features.pitStops.map((p) => p.canopy),
];
const rainView = new RainView(
  weather,
  r.scene,
  r.camera,
  city.terrain,
  envParts,
  roadMats,
  roofs,
);
game.addView({ sync: () => (rainView.storm = snowstorm.intensity) });
game.addView(rainView);
if (CONFIG.SKY === "winterDay") {
  const snowView = new SnowView(r.scene, r.camera);
  game.addView({ sync: () => (snowView.storm = snowstorm.intensity) });
  game.addView(snowView);
  const snowFolder = Debug.addFolder("Snow");
  snowFolder.add({ go: () => snowstorm.toggle() }, "go").name("start / end a squall");
  snowFolder.add(SNOWSTORM_TUNING, "firstAfter", 10, 600, 10).name("first squall after (s)");
  snowFolder.add(SNOWSTORM_TUNING, "hold", 10, 400, 10).name("squall lasts (s)");
  snowFolder.add(SNOWSTORM_TUNING, "summerGrip", 0.5, 1, 0.01).name("summer grip in squall");
  Debug.watch("snow", () => `${snowstorm.status()}  grip x${VehiclePhysics.surfaceGrip.toFixed(2)}`);
  snowFolder.add(SNOW_TUNING, "fall", 0.2, 4, 0.05).name("fall m/s");
  snowFolder.add(SNOW_TUNING, "size", 0.01, 0.15, 0.005).name("flake size m");
  snowFolder.add(SNOW_TUNING, "opacity", 0, 1, 0.05);
}
// T34: synthesized audio, ears on the camera (after the camera update)
const audio: AudioSystem = new AudioSystem({
  world,
  city,
  camera: r.camera,
  cabin: () => camRig.interior,
  rain: () => weather.rain,
  wetness: () => weather.wetness,
  paused: () => game.paused,
  title: (): boolean => menu.onTitle,
  timeScale: () => game.timeScale,
  garage: () => shop.scene,
  fade: () =>
    Math.max(
      bust.fade,
      recovery.fade,
      wreck.fade,
      breakdown.fade,
      shop.fade,
      intro.fade,
      pickup.fade,
      picnic.fade,
    ),
  hornHeld: () => input.isHeld("horn"),
  pursuit: () => heat.inPursuit,
  peds: peds.peds,
  vents: steam.vents,
  roofs,
});
game.addView(audio);
uiSound = (kind) => audio.ui(kind);
mission.warm = () => audio.garage.warm();
mission.onDone = ({ chases, elapsed, reward }) =>
  hud.stunt(
    "WINTER TIRES",
    `Done in ${formatClock(elapsed)}. ${chases === 0 ? "Never chased." : chases === 1 ? "Chased once." : `Chased ${chases} times.`}`,
    reward,
    true,
  );
mission.onFeast = () =>
  hud.stunt("LOX BAGEL", `By the clock tower, in ${formatClock(mission.elapsed)}.`, false, true);
const audioFolder = Debug.addFolder("Audio");
for (const k of Object.keys(audio.mixer.settings) as AudioKey[])
  audioFolder
    .add(audio.mixer.settings, k, 0, 1, 0.05)
    .onChange((v: number) => audio.mixer.set(k, v));

game.start();
// Build the pit garage while the title screen is up, so the first stop starts without a hitch
setTimeout(() => shop.prepare(), 2500);

/**
 * Title -> driving. Winter tires is the drive across town; free roam is the same city with winter tires and
 * no pin. Cash and the pit garage upgrades carry over between sessions.
 */
function startSession(mode: PlayMode): void {
  session = mode;
  briefing.hide();
  resetSession();
  world.mode = "free";
  menu.hide();
  game.setPaused("menu", false);
  uiRoot.classList.remove("on-title");
  world.controlLocked = true;
  if (mode === "mission") mission.arm();
  else tires.set = "winter";
  // The intro first, then the briefing card (mission) or the car (free roam)
  intro.play(() => {
    if (session !== mode || world.mode !== "free") return;
    if (mode === "mission") briefing.show();
    else {
      world.controlLocked = false;
      greet();
    }
  });
  hud.objective = mission.objective();
}

/** Pause menu -> title: the car goes back to the start and the city keeps running behind the title. */
function quitToTitle(): void {
  briefing.hide();
  resetSession();
  world.mode = "menu";
  world.controlLocked = true;
  game.setPaused("menu", false);
  uiRoot.classList.add("on-title");
  menu.showTitle();
}

/** Abort busts / tows and chases, put the repaired car back at the start. The mission pin does not survive. */
function resetSession(): void {
  bust.cancel();
  parkingTickets.cancel();
  wreck.cancel();
  breakdown.cancel();
  recovery.cancel();
  police.standDown();
  heat.reset();
  potholeHits.reset();
  chantier.reset();
  mission.clear();
  pickup.reset();
  picnic.reset();
  snowstorm.reset();
  repair(player);
  player.teleport(start.pos, start.yaw);
  player.blinker = null;
  player.headlights = true;
  limiter.on = false;
  gps.setWaypoint(null);
  gps.setDestination(null);
  camRig.snap();
}

let greeted = false;
/** Welcome and a few practical tips, on the first session only. Landmark and scenery hints are left for the map. */
function greet(): void {
  if (greeted) return;
  greeted = true;
  events.message("Bienvenue à Montréal", "info");
  const hint = (s: number, text: string) =>
    setTimeout(
      () => world.mode !== "menu" && events.message(text, "info"),
      s * 1000,
    );
  hint(3, "Press M for the city map: the GPS routes you.");
  hint(
    9,
    "Don't let the SPVM see you drive too fast. Hit L for the speed limiter",
  );
  if (city.features.pitStops.length)
    hint(16, "Garages are marked on the map: you can repair your car");
}

/** Yaw of the screen's up direction on the ground (camera forward + up, projected), for the heading-up minimap. */
function viewHeading(cam: THREE.Camera): number {
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements;
  return Math.atan2(e[4] - e[8], e[6] - e[10]);
}

(window as unknown as { dbg: unknown }).dbg = {
  audio,
  menu,
  riders,
  riderDodge,
  riderView,
  dogs,
  weather,
  tires,
  mission,
  snowstorm,
  pickup,
  pickupView,
  picnic,
  picnicView,
  briefing,
  signals,
  effects,
  gps,
  minimap,
  fullMap,
  r,
  world,
  game,
  THREE,
  traffic,
  peds,
  pathfinder,
  routeView,
  heat,
  police,
  bust,
  wreck,
  wreckView,
  breakdown,
  breakdownView,
  economy,
  camRig,
  city,
  post,
  POSTFX,
  recovery,
  cockpit,
  carView,
  limiter,
  tiles,
  pitStops,
  shop,
  builds,
  steam,
  parked,
  potholes,
  potholeHits,
  closures,
  cones,
  chantier,
  signPosts,
  streetSignColliders,
  medianColliders,
};
