import type { Car } from './Car';

const THRESHOLD = 2600; // N*s below which impacts are cosmetic
const SCALE = 55000;

/**
 * Damage is shown (HUD bar, the pit garage) and priced up to 1 (100%), but keeps counting past it to this:
 * then the wheels come off and the car is done (`gameplay/Breakdown.ts`).
 */
export const BREAKDOWN_DAMAGE = 1.2;

/** Damage as shown and priced: 0..1. */
export const shownDamage = (car: Car): number => Math.min(1, car.phys.state.damage);

/** Apply impact damage; returns the damage added (0..1). */
export function applyImpactDamage(car: Car, impulse: number): number {
  if (impulse < THRESHOLD) return 0;
  return addDamage(car, Math.min(0.3, (impulse - THRESHOLD) / SCALE));
}

/** Add damage (0..1) unless the car is invulnerable; returns the damage actually added. */
export function addDamage(car: Car, amount: number): number {
  if (car.invulnerable) return 0;
  const s = car.phys.state;
  const before = s.damage;
  s.damage = Math.min(BREAKDOWN_DAMAGE, s.damage + amount);
  return s.damage - before;
}

export function repair(car: Car): void {
  car.phys.state.damage = 0;
}
