import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Low-poly bicycles, scooters and their riders. Frame: +z forward, y up from the
// ground, +x the rider's left. Every vertex carries a color and an `aPaint` flag:
// painted parts take the instance color, the rest keep their own color.
// ---------------------------------------------------------------------------

export const BIKE_WHEEL_R = 0.33;
export const BIKE_AXLE = 0.55;
export const SCOOTER_WHEEL_R = 0.28;
export const SCOOTER_AXLE = 0.6;
/** Bicycle crank center (z, y) and crank length. */
export const CRANK = { z: -0.05, y: 0.3, r: 0.17 };

const PAINT = -1;
const SILVER = 0xb4b8bc;
const BLACK = 0x18181a;
const RUBBER = 0x0c0c0e;
const CREAM = 0xe2dcc6;
const SKIN = 0xe0bea4;
const HAIR = 0x111015;

/** Material whose instance color only tints vertices flagged `aPaint` = 1. */
export function paintMaterial(params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.25, ...params, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPaint;').replace(
      '#include <color_vertex>',
      `#include <color_vertex>
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb = mix(color, vColor.rgb, aPaint);
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'rider-paint';
  return m;
}

/** Accumulates parts with a color (or PAINT) each, merged into one geometry. */
class Parts {
  private list: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, hex: number): this {
    const out = g.index ? g.toNonIndexed() : g;
    if (out.getAttribute('uv')) out.deleteAttribute('uv');
    out.computeVertexNormals();
    const n = out.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const paint = new Float32Array(n);
    const c = new THREE.Color(hex === PAINT ? 0xffffff : hex);
    for (let i = 0; i < n; i++) {
      col.set([c.r, c.g, c.b], i * 3);
      paint[i] = hex === PAINT ? 1 : 0;
    }
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('aPaint', new THREE.BufferAttribute(paint, 1));
    this.list.push(out);
    return this;
  }

  box(sx: number, sy: number, sz: number, x: number, y: number, z: number, hex: number, rx = 0): this {
    return this.add(new THREE.BoxGeometry(sx, sy, sz).rotateX(rx).translate(x, y, z), hex);
  }

  /** Round tube between two points. */
  tube(a: THREE.Vector3Like, b: THREE.Vector3Like, r: number, hex: number, sides = 5): this {
    const A = new THREE.Vector3().copy(a);
    const d = new THREE.Vector3().copy(b).sub(A);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, sides, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate(A.x, A.y, A.z);
    return this.add(g, hex);
  }

  /** Mudguard arc over a wheel at (z, y), radius r, spanning `arc` radians around the top (+ `back` shifts it rearward). */
  fender(z: number, y: number, r: number, width: number, arc: number, hex: number, back = 0): this {
    // Cylinder vertices sit at (r sin t, h, r cos t); turned onto x that is y = r sin t, z = r cos t (top at t = pi / 2)
    const g = new THREE.CylinderGeometry(r, r, width, 12, 1, true, Math.PI / 2 - arc / 2 + back, arc);
    g.rotateZ(Math.PI / 2).translate(0, y, z);
    this.add(g.clone(), hex);
    return this.add(flipped(g), hex); // the inside shows too
  }

  build(): THREE.BufferGeometry {
    return mergeGeometries(this.list)!;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Same triangles wound the other way (back faces of open shells). */
function flipped(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) [a[(i + 1) * 3 + k], a[(i + 2) * 3 + k]] = [a[(i + 2) * 3 + k], a[(i + 1) * 3 + k]];
  }
  return g;
}

/** Mamachari: step-through frame (paint), basket, rear carrier, mudguards, chain guard, saddle (wheels separate). */
export function bicycleGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  const R = V(0, BIKE_WHEEL_R, -BIKE_AXLE);
  const F = V(0, BIKE_WHEEL_R, BIKE_AXLE);
  const BB = V(0, CRANK.y, CRANK.z);
  const ST = V(0, 0.8, -0.22);
  const HB = V(0, 0.62, 0.42);
  const HT = V(0, 0.84, 0.38);
  const LOW = V(0, 0.36, 0.16);
  p.tube(HB, HT, 0.03, PAINT);
  p.tube(HB, LOW, 0.025, PAINT).tube(LOW, BB, 0.025, PAINT);
  p.tube(BB, ST, 0.022, PAINT);
  for (const s of [-1, 1]) {
    p.tube(V(s * 0.04, BB.y, BB.z), V(s * 0.06, R.y, R.z), 0.012, PAINT);
    p.tube(V(s * 0.02, ST.y - 0.04, ST.z), V(s * 0.06, R.y, R.z), 0.012, PAINT);
    p.tube(V(s * 0.03, HB.y, HB.z), V(s * 0.05, F.y, F.z + 0.03), 0.014, SILVER);
  }
  // seat post + saddle, stem + swept-back bar with grips
  p.tube(ST, V(0, 0.9, -0.25), 0.014, SILVER).box(0.16, 0.06, 0.25, 0, 0.93, -0.26, BLACK);
  p.tube(HT, V(0, 0.99, 0.34), 0.016, SILVER);
  for (const s of [-1, 1]) {
    p.tube(V(0, 0.99, 0.34), V(s * 0.2, 0.99, 0.28), 0.012, SILVER);
    p.tube(V(s * 0.2, 0.99, 0.28), V(s * 0.3, 0.98, 0.18), 0.012, SILVER);
    p.tube(V(s * 0.25, 0.985, 0.23), V(s * 0.31, 0.98, 0.17), 0.019, BLACK);
  }
  // front basket (wire = dark frame with a lighter floor) and the dynamo lamp under it
  p.box(0.34, 0.025, 0.27, 0, 0.72, 0.62, SILVER);
  for (const s of [-1, 1]) p.box(0.012, 0.22, 0.27, s * 0.17, 0.83, 0.62, SILVER);
  p.box(0.34, 0.22, 0.012, 0, 0.83, 0.755, SILVER).box(0.34, 0.22, 0.012, 0, 0.83, 0.485, SILVER);
  p.box(0.34, 0.012, 0.27, 0, 0.94, 0.62, SILVER);
  p.box(0.08, 0.07, 0.08, 0, 0.66, 0.74, BLACK);
  // rear carrier and mudguards, chain guard on the right
  p.box(0.15, 0.015, 0.42, 0, 0.72, -0.55, SILVER);
  for (const s of [-1, 1]) p.tube(V(s * 0.07, 0.72, -0.72), V(s * 0.06, R.y, R.z), 0.008, SILVER);
  p.fender(BIKE_AXLE, BIKE_WHEEL_R, BIKE_WHEEL_R + 0.04, 0.07, 2.2, SILVER, -0.2);
  p.fender(-BIKE_AXLE, BIKE_WHEEL_R, BIKE_WHEEL_R + 0.04, 0.07, 2.4, SILVER, 0.4);
  p.box(0.02, 0.1, 0.62, -0.07, 0.31, -0.3, PAINT);
  p.box(0.03, 0.06, 0.05, 0, 0.36, -0.86, 0x5a0806); // rear reflector
  return p.build();
}

/** 50 cc step-through scooter: cream leg shield, painted body and front fender, seat, rack, fork, exhaust. */
export function scooterGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  const F = V(0, SCOOTER_WHEEL_R, SCOOTER_AXLE);
  p.box(0.44, 0.52, 0.05, 0, 0.62, 0.36, CREAM, -0.22);
  p.box(0.3, 0.06, 0.4, 0, 0.36, 0.1, BLACK); // floorboard
  p.tube(V(0, 0.82, 0.44), V(0, 0.42, 0.12), 0.06, PAINT, 6);
  p.box(0.3, 0.3, 0.62, 0, 0.56, -0.3, PAINT);
  p.box(0.32, 0.12, 0.5, 0, 0.42, -0.42, PAINT);
  p.box(0.26, 0.08, 0.5, 0, 0.75, -0.26, BLACK); // seat
  p.fender(SCOOTER_AXLE, SCOOTER_WHEEL_R, SCOOTER_WHEEL_R + 0.05, 0.14, 2.0, PAINT, -0.15);
  p.fender(-SCOOTER_AXLE, SCOOTER_WHEEL_R, SCOOTER_WHEEL_R + 0.05, 0.14, 1.8, PAINT, 0.3);
  for (const s of [-1, 1]) p.tube(V(s * 0.08, 0.95, 0.46), V(s * 0.08, F.y, F.z), 0.02, SILVER);
  // handlebar cover with the headlight, bars and grips, mirrors
  p.box(0.36, 0.12, 0.2, 0, 1.0, 0.46, PAINT);
  p.add(new THREE.CylinderGeometry(0.07, 0.075, 0.05, 10).rotateX(Math.PI / 2).translate(0, 1.0, 0.57), SILVER);
  for (const s of [-1, 1]) {
    p.tube(V(s * 0.17, 1.0, 0.44), V(s * 0.33, 1.0, 0.42), 0.018, BLACK);
    p.tube(V(s * 0.16, 1.04, 0.46), V(s * 0.24, 1.25, 0.44), 0.008, SILVER);
    p.box(0.08, 0.05, 0.015, s * 0.25, 1.27, 0.44, BLACK);
  }
  // rear rack, tail lamp housing, exhaust on the right
  p.box(0.28, 0.02, 0.36, 0, 0.8, -0.68, BLACK);
  p.box(0.12, 0.06, 0.05, 0, 0.66, -0.88, BLACK);
  p.tube(V(-0.12, 0.28, 0.0), V(-0.14, 0.32, -0.7), 0.035, SILVER, 6);
  return p.build();
}

/** Delivery box for the scooter's rear rack (instance color: silver or red). */
export function deliveryBoxGeometry(): THREE.BufferGeometry {
  return new Parts()
    .box(0.4, 0.34, 0.38, 0, 0.98, -0.68, PAINT)
    .box(0.42, 0.03, 0.4, 0, 1.16, -0.68, PAINT)
    .box(0.12, 0.03, 0.02, 0, 1.0, -0.88, BLACK)
    .build();
}

/** Spoked bicycle wheel (or a chunky scooter wheel with a hub), centered on its axle, rolling about x. */
export function wheelGeometry(scooter: boolean): THREE.BufferGeometry {
  const p = new Parts();
  const r = scooter ? SCOOTER_WHEEL_R : BIKE_WHEEL_R;
  const tire = scooter ? 0.045 : 0.022;
  p.add(new THREE.TorusGeometry(r - tire, tire, 5, 18).rotateY(Math.PI / 2), RUBBER);
  if (scooter) {
    p.add(new THREE.CylinderGeometry(r - tire * 2, r - tire * 2, 0.07, 14).rotateZ(Math.PI / 2), 0x55585c);
    p.add(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8).rotateZ(Math.PI / 2), SILVER);
  } else {
    p.add(new THREE.TorusGeometry(r - tire * 2.2, 0.012, 3, 18).rotateY(Math.PI / 2), SILVER);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI;
      const d = V(0, Math.cos(a), Math.sin(a)).multiplyScalar(r - tire * 2.5);
      p.tube(d.clone().negate(), d, 0.004, SILVER, 3);
    }
    p.add(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 6).rotateZ(Math.PI / 2), SILVER);
  }
  return p.build();
}

/** Seated rider's torso and head (clothes = paint); `helmet` for scooter riders, hair otherwise. */
export function riderGeometry(helmet: boolean): THREE.BufferGeometry {
  const p = new Parts();
  p.box(0.38, 0.54, 0.23, 0, 1.24, -0.2, PAINT, helmet ? 0 : 0.12);
  p.box(0.36, 0.14, 0.26, 0, 0.98, -0.25, PAINT); // hips on the seat
  p.box(0.11, 0.08, 0.11, 0, 1.53, -0.15, SKIN); // neck
  p.box(0.22, 0.24, 0.22, 0, 1.66, -0.14, SKIN);
  if (helmet) {
    p.box(0.27, 0.15, 0.27, 0, 1.76, -0.15, 0xe8e8e4);
    p.box(0.27, 0.13, 0.05, 0, 1.68, -0.29, 0xe8e8e4);
    p.box(0.23, 0.03, 0.06, 0, 1.69, -0.0, 0x20242a); // visor
  } else {
    p.box(0.25, 0.1, 0.25, 0, 1.8, -0.15, HAIR);
    p.box(0.25, 0.16, 0.06, 0, 1.7, -0.26, HAIR);
  }
  return p.build();
}

/** Unit limb: 1 x 1 cross-section, from y = 0 to y = 1 (scaled per instance). */
export function limbGeometry(): THREE.BufferGeometry {
  return new Parts().box(1, 1, 1, 0, 0.5, 0, PAINT).build();
}

/** Umbrella held over the head (transparent canopy + shaft). */
export function umbrellaGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    new THREE.ConeGeometry(0.62, 0.28, 8, 1, true).translate(0, 2.2, -0.12),
    new THREE.CylinderGeometry(0.012, 0.012, 1.0, 4).translate(0, 1.7, -0.12),
  ])!;
}
