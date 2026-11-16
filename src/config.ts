import { DEFAULT_MAP, MAPS, type DriveSide } from "./maps/catalog";

export type { DriveSide };

/** The one city (`maps/catalog.ts`). */
const MAP = DEFAULT_MAP;

export const CONFIG = {
  MAP,
  SEED: MAPS[MAP].seed,
  DRIVE_SIDE: MAPS[MAP].driveSide,

  // Street dimensions (meters). The grid itself is `maps/montreal/layout.ts`.
  LANE_WIDTH: 6,
  SIDEWALK: 4,
  CURB_HEIGHT: 0.15,
  STOP_OFFSET: 4.5, // distance from intersection box edge to stop line
  STREET_LIMIT_KMH: 40,
  AVENUE_LIMIT_KMH: 60,
  SPEEDING_MARGIN_KMH: 25,

  // Population
  MAX_TRAFFIC: 36,
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
