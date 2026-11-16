import type { CarSpec } from './CarSpec';

/** Peak power in metric horsepower, taken at the torque peak. */
export function peakPs(spec: CarSpec): number {
  const watts = spec.peakTorque * spec.peakRpm * (Math.PI / 30);
  return Math.round(watts / 735.5);
}

/**
 * Flat-road speed where full throttle in top gear balances drag and rolling resistance,
 * or just under the redline if the engine still has pull. Rounded to 5 km/h.
 */
export function topSpeedKmh(spec: CarSpec): number {
  const ratio = spec.gears[spec.gears.length - 1] * spec.finalDrive;
  const drive = (v: number): number => {
    const rpm = (v / spec.wheelRadius) * (30 / Math.PI) * ratio;
    if (rpm >= spec.redline * 0.98) return 0;
    const tq =
      rpm < spec.peakRpm
        ? 0.55 + 0.45 * Math.max(0, (rpm - spec.idleRpm) / (spec.peakRpm - spec.idleRpm))
        : 1 - 0.38 * ((rpm - spec.peakRpm) / (spec.redline - spec.peakRpm));
    return (spec.peakTorque * tq * ratio * spec.driveEfficiency) / spec.wheelRadius;
  };
  const resist = (v: number) => spec.drag * v * v + spec.rollingResistance * v;
  let lo = 1;
  let hi = 95;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (drive(mid) > resist(mid)) lo = mid;
    else hi = mid;
  }
  return Math.max(5, Math.round((lo * 3.6) / 5) * 5);
}

/** How the car feels from the driver's seat, from the tire curve and the steering lock. */
export function handling(spec: CarSpec): string {
  if (spec.peakFalloff >= 0.15) return 'LOOSE';
  if (spec.maxSteer >= 0.7) return 'TIGHT';
  if (spec.driftAssist >= 0.85 && spec.peakFalloff <= 0.06) return 'PLANTED';
  return 'BALANCED';
}
