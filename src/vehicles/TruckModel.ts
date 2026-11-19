import * as THREE from 'three';
import type { TruckStyle } from './Car';
import type { CarParts } from './CarModel';
import { bake, Kit, lensGeo, look, paintBase, type Base } from './CarKit';
import { BLACK, CHROME, CHROME_C, GLASS, GLASS_C, MATTE, TRIM } from './CarMaterial';
import { buildBoxTruck } from './TruckBox';
import { buildPickup } from './TruckPickup';
import { buildPostVan, postLivery } from './PostVan';
import type { P3, TruckCtx } from './TruckCab';

/**
 * Overall dimensions per truck style (m): length, width, wheel radius, front / rear axle z,
 * rear duals, and the wheel centers' distance from the center line (front, rear outer, rear inner).
 */
export const TRUCK_DIMS: Record<TruckStyle, { L: number; W: number; r: number; wf: number; wr: number; duals: boolean; tf: number; tr: number; ti: number }> = {
  truck: { L: 5.7, W: 1.94, r: 0.38, wf: 1.75, wr: -1.3, duals: true, tf: 0.8, tr: 0.835, ti: 0.59 },
  pickup: { L: 5.4, W: 1.94, r: 0.36, wf: 1.68, wr: -1.42, duals: false, tf: 0.82, tr: 0.82, ti: 0 },
  postvan: { L: 5.72, W: 2.0, r: 0.38, wf: 1.75, wr: -1.3, duals: false, tf: 0.85, tr: 0.85, ti: 0 },
};

interface TruckBase {
  base: Base;
  front: THREE.BufferGeometry;
  rear: THREE.BufferGeometry;
  headPos: P3[];
  tailPos: P3[];
}

/** Shared geometry per style; paint is applied per color, as for the cars. */
const bases = new Map<string, TruckBase>();

function buildBase(style: TruckStyle): TruckBase {
  const d = TRUCK_DIMS[style];
  const c: TruckCtx = {
    kit: new Kit(),
    hw: d.W / 2,
    r: d.r,
    wf: d.wf,
    wr: d.wr,
    body: look(1),
    seam: look(0.3, MATTE),
    dark: look(BLACK, MATTE),
    trim: look(TRIM, MATTE),
    chrome: look(CHROME_C, CHROME),
    glass: look(GLASS_C, GLASS),
    heads: [],
    tails: [],
    headPos: [],
    tailPos: [],
  };
  if (style === 'truck') buildBoxTruck(c);
  else if (style === 'postvan') buildPostVan(c);
  else buildPickup(c);
  return { base: bake(c.kit), front: lensGeo(c.heads), rear: lensGeo(c.tails), headPos: c.headPos, tailPos: c.tailPos };
}

/** Truck parts: a box van or a pickup. Paint is the cab (and bed) color. */
export function buildTruckParts(style: TruckStyle, color: number): CarParts {
  const d = TRUCK_DIMS[style];
  const key = style;
  let b = bases.get(key);
  if (!b) {
    b = buildBase(style);
    bases.set(key, b);
  }
  const wheelPos: P3[] = [
    [d.tf, d.r, d.wf],
    [-d.tf, d.r, d.wf],
    [d.tr, d.r, d.wr],
    [-d.tr, d.r, d.wr],
  ];
  if (d.duals) wheelPos.push([d.ti, d.r, d.wr], [-d.ti, d.r, d.wr]);
  return {
    body: paintBase(b.base, new THREE.Color(color)),
    front: b.front,
    rear: b.rear,
    wheelPos,
    headPos: b.headPos,
    tailPos: b.tailPos,
    wheelRadius: d.r,
    length: d.L,
    width: d.W,
    livery: style === 'postvan' ? postLivery() : undefined,
  };
}
