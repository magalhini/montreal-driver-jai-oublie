/** All tunable vehicle parameters. Garage upgrades will modify a copy of these. */
export interface CarSpec {
  name: string;
  mass: number; // kg
  inertiaScale: number; // multiplies m * (a^2 + b^2) / 2
  cgToFront: number; // m
  cgToRear: number; // m
  cgHeight: number; // m
  halfWidth: number; // collision box
  halfLength: number;
  wheelRadius: number;
  // Engine & drivetrain
  peakTorque: number; // Nm
  idleRpm: number;
  peakRpm: number;
  redline: number;
  gears: number[];
  reverseGear: number;
  finalDrive: number;
  driveEfficiency: number;
  // Tires
  gripFront: number; // friction coefficient
  gripRear: number;
  corneringStiffness: number; // curve sharpness (B)
  peakFalloff: number; // 0..1 how much grip drops past the peak (slide-y feel)
  handbrakeGrip: number; // rear grip multiplier while handbrake
  // Brakes & resistance
  brakeForce: number; // N total
  brakeBiasFront: number;
  handbrakeForce: number;
  drag: number;
  rollingResistance: number;
  // Steering & assists
  maxSteer: number; // radians
  steerSpeed: number; // rad/s
  steerReturn: number; // rad/s
  steerSpeedFalloff: number; // speed (m/s) at which steering halves
  driftAssist: number; // 0..1 counter-steer / yaw stabilization
  yawDamping: number;
}

export const KAROLA: CarSpec = {
  name: "1972 Toyoda Karola",
  mass: 1100,
  inertiaScale: 1.0,
  cgToFront: 1.24,
  cgToRear: 1.26,
  cgHeight: 0.5,
  halfWidth: 0.84,
  halfLength: 2.12,
  wheelRadius: 0.31,
  peakTorque: 190,
  idleRpm: 900,
  peakRpm: 4600,
  redline: 7000,
  gears: [3.35, 2.15, 1.5, 1.12, 0.88],
  reverseGear: 3.2,
  finalDrive: 3.9,
  driveEfficiency: 0.8,
  gripFront: 1.15,
  gripRear: 1.2,
  corneringStiffness: 8.2,
  peakFalloff: 0.2,
  handbrakeGrip: 0.38,
  brakeForce: 11800,
  brakeBiasFront: 0.62,
  handbrakeForce: 3800,
  drag: 0.42,
  rollingResistance: 12,
  maxSteer: 0.6,
  steerSpeed: 2.8,
  steerReturn: 4.5,
  steerSpeedFalloff: 32,
  driftAssist: 0.55,
  yawDamping: 0.35,
};

export const TRAFFIC_SEDAN: CarSpec = {
  ...KAROLA,
  name: "Traffic Sedan",
  mass: 1250,
  peakTorque: 190,
  gripFront: 1.35,
  gripRear: 1.4,
  peakFalloff: 0.05,
  halfWidth: 0.88,
  halfLength: 2.3,
  driftAssist: 0.9,
  yawDamping: 0.8,
  steerSpeed: 3.5,
  steerSpeedFalloff: 60,
};

export const POLICE_CRUISER: CarSpec = {
  ...KAROLA,
  name: "Police Cruiser",
  mass: 1350,
  peakTorque: 300,
  gripFront: 1.32,
  gripRear: 1.28,
  peakFalloff: 0.1,
  halfWidth: 0.9,
  halfLength: 2.35,
  brakeForce: 14000,
  driftAssist: 0.85,
  yawDamping: 0.6,
  steerSpeed: 3.6,
  steerSpeedFalloff: 45,
  redline: 6800,
};

/** 2-ton cab-over box truck (IMPROVEMENTS #12): heavy, slow to pull away, long wheelbase. */
export const BOX_TRUCK: CarSpec = {
  ...TRAFFIC_SEDAN,
  name: "Box Truck",
  mass: 3600,
  inertiaScale: 1.25,
  cgToFront: 1.6,
  cgToRear: 1.45,
  cgHeight: 0.95,
  halfWidth: 0.97,
  halfLength: 2.85,
  wheelRadius: 0.38,
  peakTorque: 420,
  peakRpm: 2400,
  redline: 4200,
  gears: [5.0, 2.9, 1.8, 1.25, 1.0],
  finalDrive: 4.6,
  gripFront: 1.25,
  gripRear: 1.3,
  brakeForce: 34000,
  handbrakeForce: 13000, // holds 3.6 t on the steepest streets (AI parks on the handbrake below 1.2 m/s)
  drag: 1.3,
  rollingResistance: 40,
  maxSteer: 0.68,
  steerSpeed: 2.6,
};

/** Kei flatbed truck: kei-car size and weight. */
export const KEI_TRUCK: CarSpec = {
  ...TRAFFIC_SEDAN,
  name: "Kei Truck",
  mass: 820,
  cgToFront: 1.0,
  cgToRear: 0.95,
  halfWidth: 0.74,
  halfLength: 1.7,
  wheelRadius: 0.28,
  peakTorque: 120,
};

/**
 * Small rounded city car: short wheelbase, light, and quick to turn. Grip is matched to the slight
 * rear weight so it stays neutral, first gear hooks up instead of spinning, and it runs out of breath near 155 km/h.
 */
export const MAME: CarSpec = {
  name: "1973 Mame",
  mass: 720,
  inertiaScale: 0.95,
  cgToFront: 1.02,
  cgToRear: 0.88,
  cgHeight: 0.44,
  halfWidth: 0.7,
  halfLength: 1.53,
  wheelRadius: 0.28,
  peakTorque: 128,
  idleRpm: 950,
  peakRpm: 4500,
  redline: 7200,
  gears: [3.15, 2.02, 1.4, 1.06, 0.84],
  reverseGear: 3.3,
  finalDrive: 4.35,
  driveEfficiency: 0.86,
  gripFront: 1.38,
  gripRear: 1.34,
  corneringStiffness: 9.2,
  peakFalloff: 0.12,
  handbrakeGrip: 0.38,
  brakeForce: 8000,
  brakeBiasFront: 0.66,
  handbrakeForce: 2400,
  drag: 0.4,
  rollingResistance: 11,
  maxSteer: 0.64,
  steerSpeed: 3.3,
  steerReturn: 5.2,
  steerSpeedFalloff: 28,
  driftAssist: 0.66,
  yawDamping: 0.52,
};

export function cloneSpec(s: CarSpec): CarSpec {
  return { ...s, gears: [...s.gears] };
}
