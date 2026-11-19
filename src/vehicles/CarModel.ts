/**
 * Procedural car models (public entry). Modules:
 * - CarMaterial: matId material patch (glass / chrome / trim / glow in one draw call) and the color palette
 * - CarGeometry: profile extrusion, smoothing, decals and 2D polygon helpers
 * - CarKit: triangle accumulator with per-vertex tint + matId, shared buffers per style
 * - BodyProfiles: side-profile data per body style
 * - CarBody / CarEnds: body, greenhouse and side details / front and rear ends
 * - CarWheel: shared unit wheel
 * - CarDetail: extra bodywork on the cars the player drives (traffic leaves it off)
 * - TruckModel: box truck and pickup, same CarParts output
 */
import * as THREE from 'three';
import { isTruck, type BodyStyle, type CarDetail } from './Car';
import { PROFILES } from './BodyProfiles';
import { buildBase, type BaseParts } from './CarBody';
import { paintBase } from './CarKit';
import { buildTruckParts } from './TruckModel';

export { carMaterial } from './CarMaterial';
export { wheelGeometry } from './CarWheel';

export interface CarParts {
  body: THREE.BufferGeometry;
  front: THREE.BufferGeometry; // headlight lenses
  rear: THREE.BufferGeometry; // tail lights
  barL?: THREE.BufferGeometry; // police light bar halves
  barR?: THREE.BufferGeometry;
  /** Taxi roof lamp (green, Montreal: white body, green light). */
  sign?: THREE.BufferGeometry;
  wheelPos: [number, number, number][]; // FL, FR, RL, RR (+ inner rear duals on trucks); the first two steer
  /** Lens centers on the body surface, for glow halos. */
  headPos: [number, number, number][];
  tailPos: [number, number, number][];
  /** Number plates (cars only; trucks leave this empty): center and facing (+1 front, -1 rear). */
  platePos?: { at: [number, number, number]; dir: 1 | -1 }[];
  wheelRadius: number;
  length: number;
  width: number;
  /** Printed side panels (lettering the vertex-colored body can't carry): shared geometry and material. */
  livery?: { geo: THREE.BufferGeometry; mat: THREE.Material };
}

const baseCache = new Map<string, BaseParts>();
const cache = new Map<string, CarParts>();
/** White paint that marks a sedan as a taxi. The roof lamp and the green belt are added for this color. */
export const TAXI_COLOR = 0xf4f7f2;

/** Procedural car parts for a body style and paint color (cached). `detail` adds the player's extra bodywork. */
export function buildCarParts(style: BodyStyle, color: number, detail?: CarDetail): CarParts {
  const key = detail ? `${style}_${color}_${detail}` : `${style}_${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (isTruck(style)) {
    const t = buildTruckParts(style, color);
    cache.set(key, t);
    return t;
  }
  const taxi = style === 'sedan' && (color === TAXI_COLOR || detail === 'taxi');
  const bkey = `${taxi ? 'taxi' : style}${detail ? `_${detail}` : ''}`;
  let b = baseCache.get(bkey);
  if (!b) {
    b = buildBase(style, taxi, detail);
    baseCache.set(bkey, b);
  }
  const st = PROFILES[style];
  const wx = st.W / 2 - 0.12;
  const result: CarParts = {
    body: paintBase(b.base, new THREE.Color(color)),
    front: b.front,
    rear: b.rear,
    wheelPos: [
      [wx, st.r, st.wf],
      [-wx, st.r, st.wf],
      [wx, st.r, st.wr],
      [-wx, st.r, st.wr],
    ],
    headPos: b.headPos,
    tailPos: b.tailPos,
    platePos: b.platePos,
    wheelRadius: st.r,
    length: st.L,
    width: st.W,
  };
  if (b.barL && b.barR) {
    result.barL = b.barL;
    result.barR = b.barR;
  }
  if (b.sign) result.sign = b.sign;
  cache.set(key, result);
  return result;
}
