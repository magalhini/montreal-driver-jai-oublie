import { DEFAULT_MAP, MAPS, type DriveSide, type SkyStyle } from "./maps/catalog";

export type { DriveSide, SkyStyle };

/** The one city (`maps/catalog.ts`). */
const MAP = DEFAULT_MAP;

export const CONFIG = {
  MAP,
  SEED: MAPS[MAP].seed,
  DRIVE_SIDE: MAPS[MAP].driveSide,
  /** Daylight and snow, or the night kit (`render/Look.ts`). */
  SKY: MAPS[MAP].sky,

  // Street dimensions (meters). The grid, and each edge's lanes and parking, are `maps/montreal/layout.ts`.
  SIDEWALK: 4,
  CURB_HEIGHT: 0.15,
  STOP_OFFSET: 4.5, // distance from intersection box edge to stop line
  /** Limits live on each edge (`RoadEdge.speedLimit`); this one only applies before the car has touched a road. */
  STREET_LIMIT_KMH: 40,
  SPEEDING_MARGIN_KMH: 25,

  // Population
  /** Civilian cars around the player at the default (BUSY) traffic level: PRD 5.5's rush hour as the new normal. */
  MAX_TRAFFIC: 64,
  MAX_PEDS: 140,
  MAX_RIDERS: 12,
  PATROL_COPS: 4,
  MAX_PURSUERS: 5,
  SPAWN_MIN: 75,
  SPAWN_RADIUS: 210,
  DESPAWN_RADIUS: 270,
  PED_RADIUS: 110,

  // Simulation
  STEP: 1 / 60,
  /** Speed-limit sign posts snap off (without slowing the car) when hit at this speed or faster. */
  SIGN_BREAK_KMH: 50,
  /** Street lamp posts snap off at this speed or faster. The hit still damages the car. Signal poles do not. */
  LAMP_BREAK_KMH: 50,

  // Economy (yen)
  START_CASH: 50000,
  /** Busted fine = FINE_BASE + FINE_PER_HEAT x heat (0..1). */
  FINE_BASE: 5000,
  FINE_PER_HEAT: 35000,
};

export const KMH = 1 / 3.6;
