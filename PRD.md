# Montreal Driver

Product requirements for turning this repository into a satirical daytime driving game set in downtown Montreal. The handling stays. The city, the laws of the street, and the reason you are out in the car all change.

Build it in the phases at the bottom. Each phase is meant for one working session: read this file, touch only the files that phase names, and leave the driving model alone.

---

## 1. Product

**Title:** Montreal Driver

**One-line pitch:** It is the day after the winter-tire deadline. The GPS has a route to the garage. Montreal does not.

**Player fantasy:** You can drive. The city cannot. Boulevards are wide and full of cars that brake late. Side streets drop into potholes. A street the map still paints in blue is a fence, an excavator, and a sign that says **RUE BARRÉE**. Orange cones are a suggestion. The SPVM is not.

**First session, and the only mode this PRD ships:**

1. The car is on summer tires, one day past the date they had to come off (2 December, snow already down).
2. A garage on the far side of downtown will mount the winter set.
3. The GPS draws a route and never learns about construction.
4. Hard closures force a detour. Cone lines can be driven through, and doing that a couple of times brings the police.
5. Potholes punish speed. A few garages will hammer the car back together for Canadian dollars.
6. Arrive, stop in the bay, and the winter tires go on. Grip comes back. That is the win.

Free roam can stay in the pause menu as a way to look at the city. Delivery jobs, jazz bars, lookout nights, stunt yards, and the Tokyo career are not part of this game.

**Tone:** affectionate and specific, not mean. The jokes are the ones Montreal drivers already tell: the sign appears when you are already in the street, the GPS is confident and wrong, the pothole was not there yesterday, and someone in a Honda is three centimetres off your bumper. French is the language of the street. The menus stay in English, with Montreal names left in French.

---

## 2. What this build keeps

These systems are the reason this repo exists. Phases may call them. They do not get a physics rewrite, a new collision solver, or a new pursuit state machine.

| System | Where it lives | What a phase is allowed to do |
| --- | --- | --- |
| Arcade tire model, drift, handbrake, clutch dump, gears, engine braking | `src/vehicles/VehiclePhysics.ts` | Read it. Set `VehiclePhysics.surfaceGrip` from snow and from summer tires. Do not edit the tire curve. |
| Impact damage, the damage bar, breakdown and tow | `src/vehicles/Damage.ts`, `src/gameplay/Breakdown.ts` | Call `addDamage`. Potholes and barricades are new callers. |
| Heat, witnessed offenses, pursuit, bust, escape | `src/ai/Heat.ts`, `src/ai/PoliceAI.ts`, `src/ai/OffenseDetector.ts`, `src/gameplay/Bust.ts` | Add one offense kind. Reskin the cruiser. Leave `WANTED_HEAT` (0.25) and the chase loop as they are. |
| Traffic that follows lanes | `src/ai/TrafficAI.ts`, `src/ai/LaneDriver.ts` | Raise the count. Add a small erratic layer on top. |
| GPS that replans from the way you are pointing | `src/gameplay/Gps.ts`, `src/ai/Pathfinding.ts` | Give the pathfinder an optional blocked-edge set. The GPS pathfinder receives an empty set. |
| Collisions | `src/physics/Collision.ts`, `src/physics/SpatialHash.ts` | Cones are a new light prop. Barricades are ordinary static boxes. |
| Wallet | `src/gameplay/Economy.ts` | Change the symbol, the format, the starting cash, and the storage key. |
| Fixed 60 Hz sim, sim/view split, one road graph | `src/core/`, `src/types.ts`, `src/world/RoadGraph.ts` | New sim state stays plain data. three.js stays in view files. |
| Audio engine and the files in `public/audio/` | `src/audio/` | Replay existing clips. No new recordings in this PRD. |

`src/maps/montreal/` is already a downtown grid (Guy to Saint-Hubert, Sherbrooke to the river), with the canal, the port, parks, and block heights. It is wired up under the name Osaka, it drives on the left, and it is dressed with the night-time Tokyo kit. Later phases rename it and redress it. They do not throw the layout away.

---

## 3. Reference, from `inspo/`

Match the read of these photos, not a photogrammetry copy of them.

- **ARRÊT.** Red octagon, white **ARRÊT**, small all-way plaque under some of them (four little ARRÊT faces). Brick and stone behind them. Daylight, clear sky. `stop-sign-arret.jpg`.
- **Street blade.** White blade, black type, the word **Rue** small over the name, a red four-lobed Montreal rosette on the right. A separate black-and-white arrow blade under it. `montreal-street-signage.jpeg`.
- **RUE BARRÉE.** Orange board, black type, often beside **DÉTOUR** (arrow) and **CIRCULATION LOCALE SEULEMENT** or **VOIE BARRÉE**. Hung on orange-and-white striped barricade rails, or on a drum with rubber bases. Cones and a gravel pile or a fence behind. `rue-barre-barrier-with-cone.jpg`, `rue-barree-traffic-cones.webp`, `construction-detour-rue-barree.webp`, `detour-rue-barree.webp`.
- **Work in the street.** Yellow excavator in a cut trench, concrete barriers, a worker in an orange vest, pink mesh fence, downtown stone façades. `montreal-construction.webp`, `montreal-construction-downtown.webp`.
- **Potholes.** Cratered asphalt, round pits full of grey meltwater, cracks, a patched circle that failed, cars still using the street. Snow piled on the sidewalk, road surface wet and dark. `montreal-pothole.jpg`, `montreal-potholes.webp`.
- **SPVM.** White sedan, a single blue stripe along the doors, **POLICE** in blue, **Montréal** and the small crest under it, a blue cross-like mark on the rear door, roof lightbar, fleet number, **9-1-1** at the back. `montreal-spvm.jpg`.
- **Basilica.** Twin stone towers, rose window, Gothic arches, on a pedestrian-scaled street of brick and limestone, hanging flower baskets, black lamps. `montreal-notre-dame.webp`.
- **Old brick and the port.** Orange-red brick warehouses, the clock tower and the river as the south edge. `montreal-old-port.jpg`. The generator already places a clock and the silos; the phase that dresses landmarks makes them readable.
- **Narrow paved street.** Grey setts or cobbles, a centre drain slot, trees, bikes, terraces, much narrower than a boulevard. `montreal-saint-catherine-cobbletstone.jpg`. Use this for Vieux-Montréal and one Sainte-Catherine stretch, not for Sherbrooke or René-Lévesque.
- **Parking plates.** Stacked white signs, red **P** slashes, French day ranges (`LUN. AU VEN.`, `MARDI`, `1 MARS AU 1 DÉC.`). Set dressing only. `montreal-parking-signs.jpg`.

---

## 4. The city

### 4.1 One city, right-hand traffic

Montreal is the only city on the title screen. `MapId` becomes `'montreal'`. `driveSide` is `'right'`. The catalog entry that currently says Osaka, and the legacy key that maps `montreal` → `osaka`, both go away. Tokyo’s generator can remain in the tree, unlisted, so a handling comparison is still possible with `?map=tokyo`. It is not a product surface.

Lane offsets already flip on `CONFIG.DRIVE_SIDE` in `MontrealGenerator.ts` and `CityGenerator.ts`. The pathfinder already treats the hard turn as the turn across traffic when `DRIVE_SIDE === 'right'`. Phase 1 is mostly naming, the menu, and a drive down a boulevard to confirm oncoming cars are on the left of the player.

### 4.2 Street classes

`CONFIG.LANE_WIDTH` is 6 m and every street is either one lane each way or two. That reads as a Japanese grid even when the names are French. Montreal gets three classes, stored on the edge, all wider than today’s side streets except the old-city cobbles, which are supposed to feel tight.

| Class | Where | Asphalt | Notes |
| --- | --- | --- | --- |
| Boulevard | Sherbrooke, Sainte-Catherine (the wide parts), René-Lévesque, Notre-Dame, Wellington, Peel, Robert-Bourassa, Saint-Laurent, Berri | 3 travel lanes each way. Lane 3.5 m. | About 21 m of travel way, plus a 2.4 m parking lane on each curb. The widest roads in the game. |
| Street | The rest of the grid | 1 travel lane each way, lane 3.6 m, plus a 2.3 m parking lane each curb | About 12 m of asphalt before parking is counted as road. Wider than a Tokyo side street in this game (those are two 6 m lanes with no parked row as a separate band, and they feel like alleys because the blocks and the camera were tuned for them). Parked cars sit in the parking band. |
| Cobble | Saint-Paul, de la Commune, and the Sainte-Catherine blocks through Vieux-Montréal (the row already marked in `layout.ts` around Notre-Dame / Saint-Paul) | 1 lane each way, lane 3.1 m, no parking band | Narrower than a Montreal street. Grey setts, a slot drain down the middle, short sightlines. |

Sidewalks stay. Curbs stay visual: the physics ground is still the road height (`world/Terrain.ts` / `FieldTerrain.ts`). No stacked roads.

Speed limits, painted on Quebec-style signs (white square, black numerals, not the Japanese red-ring circle):

- Boulevard: 50 km/h
- Street: 40 km/h
- Cobble: 30 km/h

`STREET_LIMIT_KMH` and `AVENUE_LIMIT_KMH` become per-edge values the existing speeding check already reads from `RoadEdge.speedLimit`. The painted “40” on the asphalt can go; Quebec does not paint the limit in the lane.

### 4.3 Names

`layout.ts` already names the axes (Guy, Peel, Saint-Laurent, Sherbrooke, Sainte-Catherine, René-Lévesque, Notre-Dame, Saint-Paul, Wellington, and the rest). Those names move onto street blades and onto the map. The minimap and the full map label boulevards. District ids inside the sim can stay (`downtown`, `harbor`, `residential`, `shotengai`, `depot`) so the building factory does not have to be retyped; the player-facing words change:

| Sim district | On the map |
| --- | --- |
| downtown | Centre-ville |
| shotengai, east of Notre-Dame | Vieux-Montréal |
| shotengai, the Saint-Laurent / Berri band | Quartier latin |
| residential, west | Shaughnessy |
| residential, south of downtown | Griffintown |
| harbor | Vieux-Port |
| depot | The garage yard, renamed in copy only |

### 4.4 Look

Daytime, early December, overcast with breaks. Not night, not neon, not rain as the main weather.

- Sky: pale blue-grey, brighter at the horizon, soft white cloud, no stars, no moon, no pink bloom horizon. A low winter sun from the south-west is enough for one directional light and a cool hemisphere fill.
- Snow: a thin white cap on roofs, ledges, and the sidewalk edge. Plowed snow berms along the curb, dirty at the bottom. Light flakes in the air, slow, using the same idea as `RainView` with a white, low-rate particle. The driving surface stays wet asphalt and slush, not a snowpack, so the car still feels like the car you already like.
- Roads: dark grey, damp, worn. Cobbles are a separate tiled material, matte, with the slot drain as a dark strip. Lane paint is white. Centre lines on boulevards are yellow. Markings already exist as `MONTREAL_MARKINGS` in `src/maps/MapDef.ts`; keep that palette and stop using it on the Osaka alias.
- Buildings: orange-red brick and limestone in Vieux-Montréal and along the side streets, stone bases and punched windows downtown, glass only on the towers the height table already makes tall. Kill the neon signs, video screens, and searchlights for this map. Street lamps are black, globe or teardrop, on in the grey afternoon at a low warm emissive, not as the key light.
- One basilica: twin towers, rose window, stone, on the north side of Notre-Dame in the Vieux-Montréal band, readable from a block away. Low poly. It replaces a normal block frontage; it does not add a second collision story.
- The port edge keeps water, the clock tower, and the brick sheds. Flat winter light instead of night reflections.

Summer tires on slush set `VehiclePhysics.surfaceGrip` to **0.86** for the whole mission. After the winter tires are mounted it returns to **1**. That is the only handling change, and it goes through the hook `main.ts` already uses for rain. The tire curve stays put, so the car still rotates, still catches, and still rewards a clean handbrake. The grip dip is enough that a boulevard sweeper feels slightly loose and a pothole unsettles you, which is the joke, and not enough to make the car a different game.

Weather’s random rain state machine does not run during the mission. Snowfall is constant and light. `wetness` sits at about 0.45 so the road looks damp. Grip comes from the tire flag, not from `Weather.wetGrip`.

---

## 5. Systems

### 5.1 Mission

New sim object, `src/gameplay/WinterTires.ts`.

- On a mission start, pick a spawn on the west side of the grid (Guy / Sherbrooke side, on a street, pointed east) and a destination garage on the east side (Berri / Notre-Dame side). Both are road points that exist in the graph. They are far enough apart that the shortest path is a cross-town drive, on the order of the full width of `layout.ts` (about 2.5 km before detours).
- `Gps.setDestination` points at the garage and is fixed, so a map click does not replace it.
- The car’s tire flag is `summer` until the player stops in the garage bay (the existing pit-stop “stand in the circle” test). A short beat plays: the car is locked, garage audio from `public/audio/` (jack, impact wrench, ratchet, hood), a line of copy, then control returns with `tires = 'winter'` and grip at 1.
- Getting busted charges the fine and puts you back on the street, mission still active. The debrief at the garage mentions whether the SPVM joined the drive.
- Breakdown still tows and repairs for a fee, in dollars, and the mission continues.
- There is no timer. The pressure is the city, not a clock.

Win copy, garage bay, after the tires are on: the car is legal, the street outside is not, and the GPS still thinks the way home is clear.

### 5.2 GPS that does not know

`Pathfinder` gains an optional `blocked: ReadonlySet<number>` of edge ids. While expanding, a blocked edge is not a legal step.

- The GPS pathfinder is constructed with an empty set. It will draw the route straight through a fence. After the player turns away, the existing 0.5 s replan picks another confident, possibly also wrong, route.
- Traffic, parked-car spawning, and police pathfinding share one pathfinder built with the hard-closure set, so civilians do not queue into an excavator and cruisers can actually follow you around the detour.
- The route line on the minimap and the full map is unchanged visually. No “road closed” hatching. That absence is the design.

Session rule, applied when closures are rolled: the GPS path from spawn to garage must cross at least one hard closure, and the graph with hard closures removed must still connect spawn to garage. If a roll fails either test, drop the newest closure and try again. Never close the spawn edge or the garage edge.

### 5.3 Two kinds of blocked street

Rolled once per session from `CONFIG.SEED` plus a run salt, then frozen. Aim for roughly one hard closure every four to six blocks on streets, rarer on boulevards (a boulevard closure is a partial barricade: one direction, or the middle of the block, still enough to remove that edge from the AI graph). Cobbles can close too. Cap the count so the detour is a nuisance across the whole drive, not a maze with one exit.

**Hard closure** (immovable, damages the car):

- Spans the travel lanes of one edge, mid-block.
- Colliders are normal static AABBs: striped rail, mesh fence, concrete barrier, a yellow excavator or a gravel pile. Hitting them uses the existing impact-damage path. They do not break away.
- Signs, readable at street speed, one or two of: **RUE BARRÉE**, **DÉTOUR** with an arrow that points at a side street (the arrow can lie; it is a sign, not a nav aid), **CIRCULATION LOCALE SEULEMENT**, **VOIE BARRÉE**.
- Cones scattered in front of the fence are the soft props from the next paragraph. They are not what stops the car. The fence does.
- A worker in an orange vest can stand on the sidewalk as a pedestrian reskin. Hitting them is still the existing pedestrian offense.

**Soft closure** (cones only):

- A line of cones across a lane or a whole street, sometimes with one **DÉTOUR** board on a stand and no fence.
- The edge stays in every pathfinder, including the AI one. Traffic will try to use it and will slow; the player can go through.
- Cones are light dynamic props, not cars and not static boxes. On contact they take a velocity away from the impact, slide with high friction, and stop. They do not damage the car. They can be kicked more than once. They stay in the world (no respawn) so a street you have already bullied looks bullied.
- A line has an id. Crossing it above 15 km/h, or hitting two cones from that line, counts as one breach. Breaches are stored on the mission, not on a timer that forgets them.
- Breach one: message, small heat (0.12), called in even if no cruiser can see you.
- Breach two: another 0.14, which crosses `WANTED_HEAT` (0.25). The nearest patrol is sent toward the player. Once a cruiser has line of sight, the existing pursuit starts. Further breaches keep adding heat the way a repeated crash does.
- New `OffenseKind`: `'chantier'`. Copy: “Through the cones. Someone called it in.” Add it to `Heat`, the event union in `src/types.ts`, and the once-per-pursuit list only if playtests show the chase starting too often from a single messy line. Default: every line is its own breach, and they stack.

Cones elsewhere: a handful on an otherwise open street, around a pothole patch, at a corner. Those are props. They share the light-body code. They do not belong to a line id, so clipping one is not a call to the SPVM. The city should look like it is always under construction even on the blocks you can actually drive.

### 5.4 Potholes

Pure data on an edge: position along the centreline, lateral offset, radius (0.6 m to 2.2 m), depth class `small | big`.

- Some edges roll zero holes. Streets and cobbles roll more than boulevards. A few edges roll a cluster, like the photos: five or six craters in one intersection approach.
- Visual: a dark disc pressed into the asphalt mesh (or a decal on top of it), lighter muddy water in the middle, cracked rim. Snow does not fill them.
- Sim: the player car (and traffic, simply) checks pits near the current lane. A hit adds a short upward pitch kick and a lateral velocity nudge proportional to speed and to how far off-centre the tire line is, by writing into the existing `VehicleState` (`vel`, `pitch`). That is “affect the driving a bit.” It is not a new suspension model.
- Damage, player only: under 20 km/h, no damage, just the kick. From 20 to 50 km/h, a small `addDamage`. Above 50 km/h, a big pit can take a serious chunk, enough that two or three careless boulevards put the repair bill in mind, and a string of them can reach `BREAKDOWN_DAMAGE`. Traffic does not accumulate damage.
- The GPS does not know about potholes either. They are not on the map.

### 5.5 Traffic

Montreal’s default density is today’s **RUSH HOUR** band as the new normal: `MAX_TRAFFIC` rises so that the middle menu setting is already a full boulevard, and the top setting is worse. Exact counts are a playtest number; start at 64 civilian cars in the spawn radius and tune. Pedestrians stay, a bit thicker on cobbles and around the basilica.

Erratic layer, small and on top of `LaneDriver`, not a new driver:

- Occasional late brake into a light (they still stop; they stop from too close).
- A random slow crawl or a double-parked car in the parking band that sticks a metre into the travel lane.
- More horn events from `TrafficHorns` when the player sits in a lane.
- Lane changes that are legal and a bit abrupt on boulevards only.

They still obey hard closures and lights. Erratic does not mean they drive through fences or the player’s living room. The satire is density and bad manners, with the same avoidance that already keeps the sim stable.

### 5.6 SPVM

The pursuit code stays. The cruiser’s materials change in the police branch of `CarBody.ts` / `CarEnds.ts`:

- White body, black glass, a blue stripe through the doors, **POLICE** on the front door, **Montréal** under it, a simple blue cross badge on the rear door, a lightbar, **9-1-1** small at the rear quarter.
- No need for the real crest in detail. A blue geometric mark is enough at game scale. Do not paste the reference photo on the car.
- Siren audio stays (`src/audio/Sirens.ts`). The lightbar uses the existing police emissive flash.
- Patrol count can stay at `PATROL_COPS`. What changes is how often the player earns the chase: speed, red lights, sidewalks, crashes, and cone lines.
- Bust fine is in dollars (see below). The bust screen says SPVM, not the current force name.

Speeding margin stays generous (`SPEEDING_MARGIN_KMH`) so a flowing boulevard is not an instant chase. The thing that should get you pulled is holding a stupid speed, a red light, or a second cone line.

### 5.7 Money

Canadian dollars. Display `1 250 $` (narrow no-break space, dollar sign after the number, the way a Montreal receipt looks). `formatCash` is the only formatter the HUD, the garage, and the bust screen use.

- New storage key (`montrealDriver.cash`). Do not read `neonDriver.cash`, or a yen balance becomes a dollar balance.
- Starting cash: **350 $**. Enough for one cheap repair or one fine, not for both and a second repair.
- Repair at a garage: the existing pit quote, repriced. A full repair of a battered car should be able to empty the wallet. Suggested start: **40 $** plus **280 $** times the shown damage (0..1), rounded to 5 $. Tune in play.
- Bust fine: **75 $** plus **200 $** times heat, rounded to 5 $. A full-heat bust hurts. It does not delete the mission.
- Breakdown tow: **120 $**.
- The winter-tire mount is free. It is the goal, not a shop.
- No yen glyph left in the debug panel labels that players can open. Debug sliders can stay numeric.

Garages are the existing pit stops, redressed: a bay, a price board in dollars, a French name on the kiosk (**Pneus Métro**, **Garage du Canal**, **Mécanique Berri** — three of them, one of which is the mission destination). Stopping in a non-destination bay opens the repair flow only. Stopping in the destination bay offers repair first if the car is hurt, then the tire mount.

### 5.8 Signs and props to add

All of these are view-side meshes plus, where noted, sim data. Canvas textures are already how `RoadSigns.ts` draws limits; follow that, with French copy and the shapes in the photos.

- ARRÊT octagon on the near-right corner of stop-controlled junctions. A few busy ones get the all-way plaque.
- White street blades on black lamp poles at boulevard corners, name taken from the layout axis.
- Quebec speed square, black on white, at the start of an edge when the limit changes.
- Orange construction kit: rail barricade, drum, cone, fence panel, excavator (a simple yellow articulated mesh), gravel pile, **RUE BARRÉE** / **DÉTOUR** / **CIRCULATION LOCALE SEULEMENT** / **VOIE BARRÉE** boards.
- Parking plates on some residential curbs, French, not interactive.
- Orange cones as the only new dynamic prop.

Japanese regulatory art (red-ring speed circles, lane numerals, neon kanji, shrine and café signs) does not spawn on this map.

### 5.9 Audio

Reuse `public/audio/` as-is. See `public/audio/CREDITS.md` and keep those credits.

| Need | Clip |
| --- | --- |
| Engine, horn, siren, impacts, UI | The synth and sample paths already wired in `src/audio/` |
| City bed | `city-busy.m4a` under everything, `city-harbor.m4a` near the port |
| Snow / wind | `rain-light.m4a` very quiet, no thunder, no heavy rain |
| Tire-change beat | `jack.m4a`, `impact-wrench.m4a`, `ratchet.m4a`, `hood.m4a`, `garage-room.m4a` |
| Garage repair | The existing pit-garage set |

Do not start the jazz records or the café machine on this map. A later audio pass can record Montreal; this PRD does not.

---

## 6. Player-facing copy (starter set)

Title subline: **2 décembre. Les pneus d’hiver, c’est hier.**

Mission card: “The garage is across town. The GPS has a route. A lot of streets will not.”

HUD labels stay short and in English, with French where it is the sign: speed, damage, cash as `350 $`, heat as a meter with no new tutorial. Messages:

- Pothole, first big hit: “That was a pothole.”
- Hard closure in front of the car: “Rue barrée. The GPS didn’t know.”
- First cone line: “Through the cones. Someone called it in.”
- Second: “That’s twice. The SPVM is bored enough.”
- Garage, tires on: “Winter tires. You’re legal. The street isn’t.”
- Can’t afford the repair: “Not enough for the repair. Try not to find another crater.”

---

## 7. Phases

Each phase ends with `npm run typecheck` passing. Where the phase changes what you see or how the car meets the city, run the dev server and drive the case in the “Done when” line. Do not start the next phase’s features early. If a phase needs a constant the playtest will move, put it in a `*_TUNING` object the way heat and GPS already do.

### Phase 0 — Freeze and name

**Goal:** The repo introduces itself as Montreal Driver, and the files nobody should rewrite are written down where a later session will see them.

**Steps**

1. Add this file’s section 2 as a short comment at the top of `VehiclePhysics.ts` only if it is not already obvious: “Montreal Driver tunes grip from outside. Do not change the tire curve for map content.” One comment, not a rewrite.
2. `package.json` name becomes `montreal-driver`. The window title and the menu heading read **Montreal Driver**.
3. Leave gameplay behaviour as it is. This phase is identity, not the city.

**Done when:** The title screen says Montreal Driver, and a drive still drifts, brakes, and handbrake-turns the way it does today.

### Phase 1 — Right-hand Montreal, one city

**Goal:** The street grid in `src/maps/montreal/` is the game, and traffic is on the right.

**Steps**

1. In `src/maps/catalog.ts`, replace the Osaka entry with `montreal`: title Montreal, the subline from section 6, `driveSide: 'right'`, a new seed (keep the layout; the seed only feeds dressings). Delete the legacy map that aliases `montreal` to `osaka`.
2. Point `src/maps/index.ts` at `generateMontreal` and `MONTREAL_MARKINGS`. Signals for this map are `'pole'` (vertical heads by the stop line, which is what the Montreal photos show) once Phase 4 paints them; until then `'overhead'` may stay if pole heads do not exist yet. Prefer switching the style flag in Phase 4 so this phase does not invent signal art.
3. Menu city row lists Montreal only. `?map=tokyo` can still resolve for a private comparison.
4. Rename the “Osaka” strings inside `MontrealGenerator.ts` and the height-grid error in `layout.ts`.
5. Confirm lane offsets: on a two-way street the player’s forward lane is the right-hand one, oncoming traffic approaches on the player’s left, stop lines sit on the right-side approach.

**Done when:** A new session loads the Montreal grid, cars on the other side of the centre line are coming toward you on your left, and the GPS still draws a route.

### Phase 2 — Wider boulevards, narrower old streets

**Goal:** Three street classes, all from section 4.2.

**Steps**

1. Put lane width, parking-band width, and lanes-per-direction on the edge (or on parallel arrays in the generator) instead of a single `CONFIG.LANE_WIDTH` for this map. Tokyo’s generator, if it still builds, keeps its own widths.
2. Tag edges from `layout.ts`: the avenue index sets become boulevards with 3 lanes each way; Saint-Paul, de la Commune, and the Vieux-Montréal stretch of Sainte-Catherine become cobble; everything else is a street with a parking band.
3. `RoadMesh` and `RoadMarkings` consume the edge width. Centre line, lane dashes, and parking-lane ticks have to meet at junctions with no gaps. Cobble edges get the sett material and a centre slot, and skip the yellow centre line.
4. Parked cars spawn in the parking band, not in the travel lane. Double-parked offenders are Phase 8.
5. Speed limits: 50 / 40 / 30 as in section 4.2, written onto `RoadEdge.speedLimit`.

**Done when:** René-Lévesque feels like a boulevard you can change lanes on, a Griffintown street has room to pass a parked car, and Saint-Paul is visibly tighter than both. The car’s grip is unchanged.

### Phase 3 — Daylight, slush, and brick

**Goal:** The screenshot reads as a winter afternoon, and summer tires are slightly loose.

**Steps**

1. Branch `buildEnvironment` on the map: daytime sky shader, no moon, no neon env map, cool hemisphere, one low directional sun, fog a pale grey rather than purple. Bloom, if it stays on, stays low enough that brake lights do not halo the street.
2. Snow caps and curb berms as instanced meshes. A light flake field. Roads stay the wet asphalt material at a fixed wetness.
3. Building tints for this map: brick orange, limestone, dark stone, glass only above a height threshold downtown. Skip `NeonSigns`, `VideoScreens`, and `Searchlights` when the map is Montreal.
4. Mission tire flag can be a temporary debug toggle in this phase: summer grip 0.86, winter grip 1, wired through `VehiclePhysics.surfaceGrip`. The real mission sets it in Phase 11.
5. Weather’s rain cycle does not advance on this map.

**Done when:** You can tell it is daytime without reading the HUD, snow sits on roofs and curbs, the road is wet, and holding a slide on summer tires is a little easier to start than on winter tires. The slide still recovers the way it does now.

### Phase 4 — French signs

**Goal:** A corner looks like the ARRÊT photo and a blade looks like the Rue Barré photo.

**Steps**

1. Replace the round red-ring speed sign and the painted lane numerals on this map with the white Quebec speed square.
2. ARRÊT octagons at stop approaches, a few all-way plaques.
3. Street blades from the layout names, white with black type, small “Rue” / “Boulevard” / “Avenue” line, red rosette. Arrow blades only where a one-way needs one. This grid is two-way; use arrows sparingly, at the closures in Phase 7, not on every pole.
4. Parking-plate stacks on residential curbs. No gameplay.
5. Signal heads: vertical three-lamp housings on the pole by the stop line (`signals: 'pole'`).
6. Map labels for the long boulevards, French names, on the minimap and the full map.

**Done when:** Standing at a corner you can read ARRÊT, a street name, and a speed number, and none of them are Japanese.

### Phase 5 — Landmarks and the old city

**Goal:** The drive has three pictures you can recognise: the basilica, orange brick, the port.

**Steps**

1. Basilica block on Notre-Dame in Vieux-Montréal: twin towers, rose window, stone front, the side streets still drivable. Collision is the footprint only.
2. Push brick warehouse masses along the canal and the port, using the heights already in `Massing.ts` and `Harbor.ts`. The clock tower stays a landmark, dressed so it reads as stone and a spire in daylight. The Harbor should be more like the Old Port: a long stretch of a pedestrian park, with a long stretch of road, ending with a parking lot and the clock tower. The Vieux-Port should resemble the real one as much as possible. It's illegal to drive there.
3. Cobble streets from Phase 2 get trees, a few terraces, and bike-shaped props on the sidewalk. Pedestrian density up on those blocks only.
4. Globe lamps on the cobbles, black poles, warm bulbs at low intensity.
5. No more "Dispatch" locations, replace them with other relevant buildings or parks. Montreal has pedestrianizes parks with fountains surrounded by streets, for example
6. Pedestrians should be wearing jackets because it's winter

**Done when:** From a block north of Notre-Dame the towers are the skyline of that street, and the port edge is brick, water, and the clock, in daylight.

### Phase 6 — Potholes

**Goal:** Speed costs the car. Crawling is ugly and cheap.

**Steps**

1. `src/world/Potholes.ts` (data) and a view file that stamps the craters. Seeded, some edges empty, clusters allowed, boulevards lighter than streets and cobbles.
2. A sim system checks the player against nearby pits and applies the kick plus `addDamage` per section 5.4. Thresholds live in `POTHOLE_TUNING`.
3. Traffic may nudge visually if that is cheap; it must not pile up damage or leave the lane permanently.
4. The first heavy hit emits the pothole message, then a cooldown so a cluster does not spam the HUD.

**Done when:** At 40 km/h a big pit twitches the wheel and ticks the damage bar. At walking speed it does not. A clean street still exists. The tire curve file is untouched.

### Phase 7 — Rue barrée, cones, and a GPS that lies

**Goal:** The route on the map and the street in front of you disagree, on purpose.

**Steps**

1. `src/gameplay/Closures.ts` rolls hard and soft closures for the session, with the connectivity and “GPS path hits a fence” tests from section 5.2.
2. Extend `Pathfinder` with a blocked-edge set. GPS gets none. Traffic and police get the hard set.
3. Hard closure view: striped rails, fence, excavator or gravel, orange signs. Static colliders, real damage. Signs should resemble the ones in the `inspo` folder, orange signs with `RUE BARREE` and `DETOUR`.
4. Cone prop: instanced mesh, a small sim list of positions and velocities, shoved by the player and by traffic, no damage. Lines have ids and the two-strike `chantier` offense from section 5.3, including the call-in that counts as witnessed and the patrol vector on the second strike.
5. Loose cones with no line id, around pits and corners, same prop, no offense.
6. HUD lines for the fence and for each strike.

**Done when:** Following the GPS ends at a fence you cannot move. A side street gets you moving again and the GPS invents a new route without drawing the closure. You can scatter a cone line, and the second line of the session brings a cruiser once it can see you. One cone on an open corner does not.

### Phase 8 — Heavy, rude traffic

**Goal:** The boulevard is work even when it is open.

**Steps**

1. Raise the traffic target and make the default menu level the busy one. Keep a quiet option for testing.
2. Add the late-brake, double-park, and abrupt lane-change behaviours from section 5.5 as small chances inside the existing driver.
3. Horns fire more often when the player blocks a lane.
4. AI routes respect hard closures from Phase 7.

**Done when:** Sitting at a green light on René-Lévesque means a queue, a horn, and someone nosing past. Nobody drives through a hard closure. The player car’s handling is the same car as Phase 0.

### Phase 9 — SPVM livery

**Goal:** The car in the mirror is the one in `inspo/montreal-spvm.jpg`, at game scale.

**Steps**

1. White body, blue stripe, POLICE, Montréal, badge mark, lightbar, 9-1-1, fleet number as a simple digit pair.
2. Bust copy and the fine formula in dollars from section 5.7. Heat and pursuit states stay.
3. Confirm speeding, red light, sidewalk, and `chantier` all still feed the same meter.
4. Replace instances of copy in the game, saying SPVM instead of police.

**Done when:** A red light with a cruiser in sight starts the same chase as before, in a white and blue car, and the fine is in dollars.

### Phase 10 — Dollars and garages

**Goal:** Damage is a bill, and three garages can pay it down.

**Steps**

1. `formatCash`, starting cash, fines, tow, and the new storage key from section 5.7.
2. Redress pit stops as the three named garages. Repair flow is the current pit shop, priced in dollars, with the French names on the sign.
3. If the wallet cannot cover the quote, the bay tells you and releases the car. No credit.

**Done when:** You can crack a rim on a pothole, pay at Garage du Canal, and watch the cash and the damage bar both move. A second repair can be unaffordable. Old yen saves do not appear.

### Phase 11 — The winter-tire run

**Goal:** The loop in section 5.1 is the game you get from the title screen.

**Steps**

1. `WinterTires` mission: west spawn, east garage, summer grip, fixed GPS destination, bay completion, winter grip, debrief line that mentions a clean run or a chase.
2. Title screen primary action is this drive. Free roam is secondary and spawns with winter tires, grip 1, no destination, closures and potholes still on so the city is the same city.
3. Bust and breakdown return you to the mission.
4. The destination garage still offers a paid repair before the free mount if the car is damaged.
5. The mission should appear in a modal upon the game starting. Explain "It's December 1st and you forgot to change to your winter tires. Your goal: make it to the garage to change your tires in the other side of the city. The SPVM is watching: drive too fast, run a red light or a STOP sign and they'll be on your tail. Be careful about potholes: drive over them too fast and your car will be severely damaged."
6. The garage is called "Jacques-Cartier Pneus Garage". Show it on the map, it should have a sign outside too.

**Done when:** From a cold start you can be sent across the grid, lose the GPS route to a fence, pay or avoid a repair, pick up the police or slip them, and finish in the bay with the winter tires on. Quitting to free roam does not leave the mission destination stuck on the map.

### Phase 11 B: — Cars and City signs

**Goal: No more Japanese traffic cars, all cars should look westernized.**

**Steps**

1. No more Kei trucks and small cars. Sedans should look more modern, and Kei Trucks should be replaced with pick-up trucks.
2. Taxis shouldn't be yellow, but green and white.
3. Some of the signs displayed on buildings should be Montreal/Canada specific: IGA, Provigo, Starbucks, Tim Hortons, Poutine.

### Phase 12 — Pass and credits

**Goal:** The first session is understandable without reading this file.

**Steps**

1. Title card, mission card, and the message strings in section 6.
2. Controls page unchanged except the title and any yen leftover.
3. Audio buses: busy city bed, quiet rain-light as wind, no jazz, garage clips on the tire mount and on a paid repair.
4. Credits page keeps `public/audio/CREDITS.md` and states that the recordings are reused placeholders.

**Done when:** A person who has not seen the repo can start the drive, understand the garage is the goal, and hear the city without a neon soundtrack.

### Phase 13 — Playtest pass

**Goal:** The numbers in the `*_TUNING` blocks match the joke.

Drive these and adjust constants only:

- A careful run that never crosses a cone line and never passes 70 km/h should reach the garage with damage on the bar and cash left, most of the time, in one try of about ten minutes.
- A greedy run down the GPS line should hit a fence within the first few turns and, if the player rams it, feel it in the damage bar.
- Two cone lines should produce a chase. One should produce a warning.
- Summer-tire grip should still be fun in a hairpin. If the car feels like a different game, move 0.86 toward 1. Do not edit `tireCurve`.
- Closure density: the detour is constant, and a path always remains. If testers get sealed in a neighbourhood, lower the cap and rerun the connectivity test.
- Frame time with 64 cars, cones on screen, and snowfall stays interactive. Cones and berms are instanced.

**Done when:** The three drives above behave as written, and `npm run typecheck` is clean.

---

## 8. Out of this PRD

- A full Island of Montreal, the bridges, the Turcot, the 40, or a real OSM import. The downtown grid is the map.
- A new vehicle-dynamics model, per-wheel damage, or ice grip curves.
- New recorded audio, licensed music, or a radio with real songs.
- Parking tickets, tow-away rules, and the parking plates as gameplay. The plates are there to be read.
- Multiplayer, a campaign of unrelated jobs, and the Tokyo delivery career.
- Copying SPVM or city logos as scanned artwork. Shapes and words are fine; the photographs in `inspo/` stay reference.

---

## 9. First playable, in one paragraph

You start west of downtown on summer tires, in the snow, with about 350 $ and a GPS line aimed at a garage near Berri. The line runs through at least one **RUE BARRÉE**. Boulevards are wide and jammed, old streets are cobbled and tight, potholes kick the car and bill you if you are fast, cones scatter and the second line of them calls the SPVM, and the chase is the chase this game already has. You arrive, you pay if you must, the winter tires go on, and the car grips the way it was built to grip.
