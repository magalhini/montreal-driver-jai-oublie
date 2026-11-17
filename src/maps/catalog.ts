export type DriveSide = "left" | "right";
/** Time of day the city is dressed for: the winter afternoon, or the night kit the base game shipped with. */
export type SkyStyle = "winterDay" | "night";

/**
 * What a city is, without its generator: `config.ts` reads this at load to set the seed and the drive side,
 * so it must not import anything that reads `CONFIG` (generators live in `maps/index.ts`).
 */
export interface MapInfo {
  id: MapId;
  /** Menu name. */
  title: string;
  /** Title screen tagline. */
  sub: string;
  /** Feeds the dressings (buildings, props, parked cars); the street layout is fixed in `maps/montreal/layout.ts`. */
  seed: number;
  driveSide: DriveSide;
  sky: SkyStyle;
}

/** Montreal Driver ships one city. */
export type MapId = "montreal";

export const MAPS: Record<MapId, MapInfo> = {
  montreal: {
    id: "montreal",
    title: "MONTREAL",
    sub: "1 décembre. Les pneus d’hiver, c’est hier.",
    seed: 20261202,
    driveSide: "right",
    sky: "winterDay",
  },
};

export const DEFAULT_MAP: MapId = "montreal";

export function resolveMap(id: string | null | undefined): MapId | null {
  if (!id) return null;
  return id in MAPS ? (id as MapId) : null;
}
