import type { CarStyle } from './Car';
import type { V2 } from './CarGeometry';

// ---------------------------------------------------------------------------
// Body styles
// ---------------------------------------------------------------------------

interface Win {
  /** Keep glass ahead of the line through (z at belt, z at roof). */
  front?: [number, number];
  /** Keep glass behind the line through (z at belt, z at roof). */
  rear?: [number, number];
}

export interface BodyProfile {
  L: number;
  W: number;
  r: number;
  wf: number;
  wr: number;
  sill: number;
  belt: number;
  /** Front face from the front-bottom up to the hood's leading edge. */
  nose: V2[];
  /** Hood from the leading edge back to the windshield base. */
  hood: V2[];
  /** From the rear window base back to the rear top edge. */
  deck: V2[];
  /** Tail face from the top edge down to the rear-bottom. */
  tail: V2[];
  ws: [V2, V2]; // windshield base (on belt) and top
  roof: V2[];
  bl: [V2, V2]; // rear window top and base (on belt)
  gW: number; // greenhouse width at the belt
  tumble: number; // roof width / belt width
  pillar: number; // A-pillar width seen from the front
  cPillar: number;
  wins: Win[];
  winInset: number;
  doors: number[];
  handles: number[];
  /** Wheel arch radius beyond the tire and center lift above the axle. */
  arch?: [number, number];
  /** Rounding of the lower body's side edges (x); defaults to BODY_BEVEL. */
  bevel?: number;
  /**
   * Rounds the ends in plan view, ahead of the front arch and behind the rear one:
   * [corner pull-back (m), width pinch (share)] for the front and the rear. See `shapeWarp` in CarBody.
   * The pull is how far the corner sits behind the centerline, so the body needs width splits to show it.
   */
  round?: { front: [number, number]; rear: [number, number] };
  /** How far the side skin swells over the arches (m). The doors between them sit a little narrower. */
  flare?: number;
}

const COUPE: BodyProfile = {
  L: 4.2,
  W: 1.64,
  r: 0.31,
  wf: 1.28,
  wr: -1.24,
  sill: 0.22,
  belt: 0.79,
  nose: [
    [2.03, 0.235],
    [2.085, 0.262],
    [2.1, 0.295],
    [2.1, 0.615],
    [2.088, 0.66],
    [2.05, 0.69],
  ],
  hood: [
    [1.85, 0.712],
    [1.45, 0.74],
    [1.05, 0.764],
    [0.75, 0.78],
    [0.56, 0.79],
  ],
  deck: [
    [-1.8, 0.79],
    [-1.86, 0.794],
    [-1.99, 0.8],
    [-2.055, 0.812],
    [-2.09, 0.802],
  ],
  tail: [
    [-2.1, 0.775],
    [-2.1, 0.33],
    [-2.088, 0.285],
    [-2.035, 0.245],
  ],
  ws: [
    [0.56, 0.79],
    [-0.08, 1.19],
  ],
  roof: [
    [-0.21, 1.22],
    [-0.45, 1.232],
    [-0.68, 1.218],
  ],
  bl: [
    [-0.86, 1.182],
    [-1.8, 0.79],
  ],
  gW: 1.48,
  tumble: 0.8,
  pillar: 0.032,
  cPillar: 0.1,
  wins: [{ front: [-0.5, -0.44] }, { rear: [-0.5, -0.44], front: [-1.36, -0.94] }],
  winInset: 0.04,
  doors: [0.52, -0.54],
  handles: [-0.46],
  arch: [0.05, 0.01],
  flare: 0.014,
};

const SEDAN: BodyProfile = {
  L: 4.82,
  W: 1.82,
  r: 0.33,
  wf: 1.5,
  wr: -1.4,
  sill: 0.24,
  belt: 0.8,
  nose: [
    [2.3, 0.24],
    [2.38, 0.3],
    [2.41, 0.42],
    [2.41, 0.7],
    [2.37, 0.745],
    [2.26, 0.77],
  ],
  hood: [
    [1.9, 0.785],
    [1.4, 0.8],
    [1.0, 0.805],
    [0.7, 0.8],
  ],
  deck: [
    [-1.58, 0.8],
    [-1.78, 0.818],
    [-2.15, 0.8],
    [-2.32, 0.77],
    [-2.38, 0.74],
  ],
  tail: [
    [-2.41, 0.78],
    [-2.41, 0.34],
    [-2.38, 0.28],
    [-2.3, 0.24],
  ],
  ws: [
    [0.7, 0.8],
    [0.08, 1.36],
  ],
  roof: [
    [-0.04, 1.385],
    [-0.48, 1.4],
    [-0.98, 1.385],
  ],
  bl: [
    [-1.12, 1.35],
    [-1.58, 0.8],
  ],
  gW: 1.64,
  tumble: 0.84,
  pillar: 0.036,
  cPillar: 0.055,
  wins: [{ front: [-0.22, -0.16] }, { rear: [-0.22, -0.16], front: [-1.08, -0.92] }],
  winInset: 0.04,
  doors: [0.72, -0.28, -1.12],
  handles: [-0.1, -0.82],
  arch: [0.05, 0.015],
  bevel: 0.09,
  round: { front: [0.14, 0.07], rear: [0.12, 0.055] },
  flare: 0.012,
};

const WAGON: BodyProfile = {
  L: 4.6,
  W: 1.72,
  r: 0.32,
  wf: 1.45,
  wr: -1.4,
  sill: 0.24,
  belt: 0.87,
  nose: [
    [2.24, 0.265],
    [2.288, 0.3],
    [2.3, 0.35],
    [2.3, 0.725],
    [2.288, 0.765],
    [2.245, 0.785],
  ],
  hood: [
    [1.9, 0.8],
    [1.45, 0.82],
    [1.08, 0.845],
    [0.93, 0.87],
  ],
  deck: [
    [-2.25, 0.87],
    [-2.283, 0.86],
  ],
  tail: [
    [-2.3, 0.835],
    [-2.3, 0.35],
    [-2.288, 0.3],
    [-2.24, 0.265],
  ],
  ws: [
    [0.93, 0.87],
    [0.26, 1.37],
  ],
  roof: [
    [0.15, 1.398],
    [-0.6, 1.405],
    [-1.6, 1.402],
    [-2.06, 1.394],
  ],
  bl: [
    [-2.16, 1.372],
    [-2.25, 0.87],
  ],
  gW: 1.56,
  tumble: 0.88,
  pillar: 0.04,
  cPillar: 0.07,
  wins: [{ front: [-0.2, -0.16] }, { rear: [-0.2, -0.16], front: [-0.98, -0.98] }, { rear: [-1.08, -1.08], front: [-1.98, -1.9] }],
  winInset: 0.042,
  doors: [0.95, -0.23, -0.98],
  handles: [-0.15, -0.9],
};

/** Same design stretched to other dimensions (police cruiser = bigger sedan). */
function scaled(s: BodyProfile, L: number, W: number, r: number, wf: number, wr: number, dy: number): BodyProfile {
  const k = L / s.L;
  const p = (v: V2): V2 => [v[0] * k, v[1] + dy];
  const ln = (v?: [number, number]): [number, number] | undefined => (v ? [v[0] * k, v[1] * k] : undefined);
  return {
    ...s,
    L,
    W,
    r,
    wf,
    wr,
    sill: s.sill + dy,
    belt: s.belt + dy,
    nose: s.nose.map(p),
    hood: s.hood.map(p),
    deck: s.deck.map(p),
    tail: s.tail.map(p),
    ws: [p(s.ws[0]), p(s.ws[1])],
    roof: s.roof.map(p),
    bl: [p(s.bl[0]), p(s.bl[1])],
    gW: s.gW + (W - s.W),
    wins: s.wins.map((w) => ({ front: ln(w.front), rear: ln(w.rear) })),
    doors: s.doors.map((z) => z * k),
    handles: s.handles.map((z) => z * k),
  };
}

export const PROFILES: Record<CarStyle, BodyProfile> = {
  coupe: COUPE,
  sedan: SEDAN,
  wagon: WAGON,
  police: scaled(SEDAN, 4.6, 1.76, 0.33, 1.45, -1.4, 0.01),
};

export const BODY_BEVEL = 0.075; // rounding of the lower body's side edges (x)
export const BODY_BEVEL_P = 0.035; // ... and in the side profile (keep < half the fender height over the arches)
export const CAB_BEVEL = 0.055;
export const CAB_BEVEL_P = 0.045;
