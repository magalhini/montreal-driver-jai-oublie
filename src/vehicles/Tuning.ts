import { cloneSpec, type CarSpec } from "./CarSpec";
import type { FleetId } from "./Fleet";

/**
 * What the pit garage sells (`ui/PitShop.ts`): performance parts in stages, tailored to each car,
 * a clutch-dump burnout kit, plus free rims and paint and the little charms that hang from the rearview mirror.
 */
export type PartKind = "engine" | "weight" | "handling" | "brakes";
export const PART_KINDS: PartKind[] = [
  "engine",
  "weight",
  "handling",
  "brakes",
];

export type WheelId =
  | "stock"
  | "mesh"
  | "spoke"
  | "rs8"
  | "steel"
  | "fan"
  | "deep";
export type CharmId = "cone" | "bagel" | "croissant" | "timmies";

/** What the player has done to one car. Part levels count the stages bought (0 = stock). */
export interface CarBuild {
  engine: number;
  weight: number;
  handling: number;
  brakes: number;
  wheels: WheelId;
  /** Paint color; null keeps the factory color. */
  paint: number | null;
  charm: CharmId;
  /** Hold Shift: the clutch slips and the car launches harder, then Shift is the throttle once the wheels hook. */
  burnout: boolean;
}

export const STOCK_BUILD: Readonly<CarBuild> = {
  engine: 0,
  weight: 0,
  handling: 0,
  brakes: 0,
  wheels: "stock",
  paint: null,
  charm: "timmies",
  burnout: false,
};

export const PART_INFO: Record<
  PartKind,
  { label: string; sub: string; unit: string; stages: string[] }
> = {
  engine: {
    label: "ENGINE",
    sub: "moteur",
    unit: "Nm",
    stages: ["Street tune", "Sport cams & headers", "Full race build"],
  },
  weight: {
    label: "WEIGHT",
    sub: "allègement",
    unit: "kg",
    stages: [
      "Strip the trim",
      "Fiberglass hood & trunk",
      "Bucket seats & thin glass",
    ],
  },
  handling: {
    label: "HANDLING",
    sub: "tenue",
    unit: "grip",
    stages: [
      "Sport tires",
      "Stiffer springs & sway bars",
      "Coilovers & semi-slicks",
    ],
  },
  brakes: {
    label: "BRAKES",
    sub: "freins",
    unit: "kN",
    stages: ["Performance pads", "Vented discs", "Four-pot calipers"],
  },
};

/** Share of a stage's price the garage pays to take it back off. */
export const RESALE = 0.8;

/** What removing a fitted stage pays, rounded to 100 dollars. */
export function resale(price: number): number {
  return Math.round((price * RESALE) / 100) * 100;
}

/** Clutch-dump burnout kit, before the car's scale. */
const BURNOUT_PRICE = 500;

/** Price of each stage before the car's scale. */
const BASE_PRICE: Record<PartKind, number[]> = {
  engine: [1500, 2800, 3300],
  weight: [600, 1200, 2000],
  handling: [800, 1500, 2600],
  brakes: [500, 900, 1200],
};

interface CarParts {
  /** Peak torque (Nm) after each stage. */
  engine: number[];
  /** Mass (kg) after each stage. */
  weight: number[];
  /** Tire grip added front and rear after each stage. */
  handling: number[];
  /** Brake force (N) after each stage. */
  brakes: number[];
  /** Parts for exotic cars cost more. */
  priceScale: number;
  /** What the engine tab tells you about this car. */
  note: string;
}

/** Stage values for the player's car. */
const PARTS: Record<FleetId, CarParts> = {
  coupe: {
    engine: [205, 222, 240],
    weight: [1065, 1035, 1000],
    handling: [0.04, 0.08, 0.12],
    brakes: [13000, 14200, 15400],
    priceScale: 1,
    note: "A simple old four. Plenty of room to grow.",
  },
};

export interface PartStage {
  name: string;
  value: number;
  price: number;
}

/** What this car's burnout kit costs, rounded like the other parts. Exotics pay more. */
export function burnoutPrice(id: FleetId): number {
  return Math.round((BURNOUT_PRICE * PARTS[id].priceScale) / 500) * 500;
}

export function partStages(id: FleetId, kind: PartKind): PartStage[] {
  const p = PARTS[id];
  return p[kind].map((value, i) => ({
    name: PART_INFO[kind].stages[i],
    value,
    price: Math.round((BASE_PRICE[kind][i] * p.priceScale) / 500) * 500,
  }));
}

export const engineNote = (id: FleetId): string => PARTS[id].note;

/** The car's factory spec with the bought stages applied. */
export function tunedSpec(
  base: CarSpec,
  id: FleetId,
  build: CarBuild,
): CarSpec {
  const s = cloneSpec(base);
  const p = PARTS[id];
  const at = (kind: PartKind): number | null =>
    build[kind] > 0 ? p[kind][Math.min(build[kind], p[kind].length) - 1] : null;
  const torque = at("engine");
  if (torque !== null) s.peakTorque = torque;
  const mass = at("weight");
  if (mass !== null) s.mass = mass;
  const grip = at("handling");
  if (grip !== null) {
    s.gripFront += grip;
    s.gripRear += grip;
    s.steerSpeed *= 1 + grip * 2.5;
  }
  const brake = at("brakes");
  if (brake !== null) s.brakeForce = brake;
  return s;
}

export const WHEELS: { id: WheelId; name: string }[] = [
  { id: "stock", name: "Factory dish" },
  { id: "mesh", name: "Gold mesh" },
  { id: "rs8", name: "Bronze 8-spoke" },
  { id: "spoke", name: "Gunmetal 5-spoke" },
  { id: "fan", name: "Turbofan" },
  { id: "steel", name: "White steelies" },
  { id: "deep", name: "Chrome deep dish" },
];

/** null is the car's factory color. */
export const PAINTS: { name: string; color: number | null }[] = [
  { name: "Factory color", color: null },
  { name: "White", color: 0xeeeeea },
  { name: "Jet black", color: 0x0e0e12 },
  { name: "Gunmetal", color: 0x4a4e56 },
  { name: "Candy red", color: 0xb8101e },
  { name: "Sunset orange", color: 0xe8601c },
  { name: "Lemon yellow", color: 0xe8cc1c },
  { name: "Racing green", color: 0x1d5a38 },
  { name: "Bright cyan", color: 0x1fc4d6 },
  { name: "Deep blue", color: 0x1e4fb8 },
  { name: "Midnight purple", color: 0x3a1a5a },
  { name: "Rose", color: 0xf08cb4 },
  { name: "Hot pink", color: 0xff2e96 },
];

export const CHARMS: {
  id: CharmId;
  name: string;
  sub: string;
  price: number;
}[] = [
  { id: "timmies", name: "Tim Hortons cup", sub: "double-double", price: 0 },
  { id: "cone", name: "Traffic cone", sub: "cône orange", price: 200 },
  { id: "bagel", name: "Bagel", sub: "sésame", price: 200 },
  { id: "croissant", name: "Chocolatine", sub: "pur beurre", price: 200 },
];
