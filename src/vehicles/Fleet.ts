import { clamp } from '../core/math';
import type { Car, CarLook } from './Car';
import { COUPE, type CarSpec } from './CarSpec';
import { STOCK_BUILD, tunedSpec, type CarBuild } from './Tuning';

interface FleetCar {
  spec: CarSpec;
  look: CarLook;
}

/**
 * The player's car. Montreal Driver has one; it is a record so the pit garage's per-car builds and parts
 * tables keep their shape.
 */
export const FLEET = {
  coupe: { spec: COUPE, look: { style: 'coupe' as const, color: 0xd2381f, detail: 'driver' as const } },
} satisfies Record<string, FleetCar>;

/** The car the player drives. */
export const PLAYER_CAR: FleetId = 'coupe';

export type FleetId = keyof typeof FLEET;

/** Which fleet car this is, from its spec and body. Null when it isn't one of ours. */
export function fleetIdOf(car: Car): FleetId | null {
  const ids = Object.keys(FLEET) as FleetId[];
  return (
    ids.find((id) => {
      const f = FLEET[id];
      return car.phys.spec.name === f.spec.name && car.look.style === f.look.style && car.look.detail === f.look.detail;
    }) ?? null
  );
}

/** A fleet car's look with the pit garage's paint, rims and charm. */
export function builtLook(id: FleetId, build: CarBuild = STOCK_BUILD): CarLook {
  const look = FLEET[id].look;
  return { style: look.style, color: build.paint ?? look.color, detail: look.detail, wheels: build.wheels, charm: build.charm };
}

/**
 * Swap the player's spec and look in place, so the live spec panel keeps its bindings. `build` is what the
 * pit garage has done to this car (stock when left out). The burnout kit comes with that car's build, so a
 * swap leaves every other car's kit where it was.
 */
export function equipCar(car: Car, id: FleetId, build: CarBuild = STOCK_BUILD): void {
  car.burnout = build.burnout;
  const next = tunedSpec(FLEET[id].spec, id, build);
  const spec = car.phys.spec;
  const gears = spec.gears;
  gears.splice(0, gears.length, ...next.gears);
  Object.assign(spec, next, { gears });
  Object.assign(car.look, builtLook(id, build));
  const s = car.phys.state;
  if (s.gear > gears.length) s.gear = gears.length;
  s.rpm = clamp(s.rpm, spec.idleRpm, spec.redline);
  s.steerAngle = clamp(s.steerAngle, -spec.maxSteer, spec.maxSteer);
}
