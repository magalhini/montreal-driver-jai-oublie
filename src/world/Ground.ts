import type { Vec2 } from '../types';

/** What vehicles and views need from the ground. */
export interface Ground {
  /** Drivable surface height (roads, lots, ramps, canal bed). Sidewalk curbs are visual only. */
  heightAt(x: number, z: number): number;
  /** Water surface height if (x, z) is over water, else null. */
  waterAt(x: number, z: number): number | null;
}

export const FLAT_GROUND: Ground = { heightAt: () => 0, waterAt: () => null };

/**
 * A city's height field (T38): what generic code may ask of `city.terrain`, whatever the map. The grid
 * `Terrain` implements it.
 */
export interface CityGround extends Ground {
  /** Junction heights by node id. */
  readonly nodeH: number[];
  /** Terrain without bridges, ramps or water (building foundations). */
  base(x: number, z: number): number;
  /** Open water inside the city (canal, river), where the surface is `water`; not the sea past the bounds. */
  isWater(x: number, z: number): boolean;
  /** Curb offset here: `CONFIG.CURB_HEIGHT` on raised surfaces (sidewalks, slabs), else 0. */
  curbAt(x: number, z: number): number;
  /** Visual ground: drivable height plus the curb on raised surfaces. */
  surfaceY(x: number, z: number): number;
  /** Height gradient (dh/dx, dh/dz). */
  gradient(x: number, z: number, out?: Vec2, e?: number): Vec2;
}
