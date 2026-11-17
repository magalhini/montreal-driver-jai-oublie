/** Which set is on the car. The mission starts on summer tires; the garage bay mounts the winter set. */
export type TireSet = 'summer' | 'winter';

/**
 * Grip from the tires, the only handling change in Montreal Driver (PRD 4.4). It reaches the car through
 * `VehiclePhysics.surfaceGrip`; the tire curve stays as it is. Playtest numbers: if summer tires make the car
 * a different game, move `summerGrip` toward 1.
 */
export const TIRE_TUNING = {
  /** Summer tires on slush. */
  summerGrip: 0.86,
  winterGrip: 1,
};

/**
 * The car's tire flag (pure sim state). The winter-tire run sets it to summer at the start of the drive
 * and to winter when the bay finishes the mount. Free roam sets winter. The debug panel can still flip it.
 */
export class Tires {
  set: TireSet = 'summer';

  get grip(): number {
    return this.set === 'summer' ? TIRE_TUNING.summerGrip : TIRE_TUNING.winterGrip;
  }
}
