import * as THREE from 'three';
import { fan, prep, PX, type XY } from './CarGeometry';
import { bake, Kit, look, paintBase, type Look } from './CarKit';
import { BLACK, CHROME, CHROME_C, DISH, MATTE, PAINT, rgb, TIRE } from './CarMaterial';
import type { WheelId } from './Tuning';

/** A ring of dark openings in the wheel face; `twist` sweeps them round (rad from inner to outer edge). */
interface Holes {
  n: number;
  r0: number;
  r1: number;
  half: number;
  twist?: number;
  offset?: number;
}

/**
 * Rim design: a polished lip down to `lipIn`, a dish down to the center cap at `capR` (`depth` is how far
 * in the dish sits at the cap), and openings in the dish.
 */
interface Design {
  lip: Look;
  lipIn: number;
  dish: Look;
  depth: number;
  cap: Look;
  capR: number;
  holes: Holes[];
}

const chrome = look(CHROME_C, CHROME);
const dark = look(BLACK, MATTE);

const DESIGNS: Record<WheelId, Design> = {
  stock: { lip: chrome, lipIn: 0.6, dish: look(DISH, PAINT), depth: 0.25, cap: chrome, capR: 0.34, holes: [{ n: 6, r0: 0.4, r1: 0.56, half: 0.13 }] },
  mesh: {
    lip: chrome,
    lipIn: 0.66,
    dish: look(rgb(0.72, 0.5, 0.16), PAINT),
    depth: 0.27,
    cap: look(rgb(0.85, 0.62, 0.22), CHROME),
    capR: 0.16,
    holes: [
      { n: 16, r0: 0.2, r1: 0.39, half: 0.085 },
      { n: 16, r0: 0.43, r1: 0.63, half: 0.07, offset: Math.PI / 16 },
    ],
  },
  rs8: {
    lip: chrome,
    lipIn: 0.68,
    dish: look(rgb(0.3, 0.17, 0.06), PAINT),
    depth: 0.24,
    cap: look(rgb(0.04, 0.04, 0.045), PAINT),
    capR: 0.15,
    holes: [{ n: 8, r0: 0.25, r1: 0.6, half: 0.2 }],
  },
  spoke: {
    lip: chrome,
    lipIn: 0.68,
    dish: look(rgb(0.2, 0.2, 0.22), PAINT),
    depth: 0.22,
    cap: chrome,
    capR: 0.13,
    holes: [{ n: 5, r0: 0.22, r1: 0.64, half: 0.42 }],
  },
  fan: {
    lip: look(rgb(0.62, 0.62, 0.64), PAINT),
    lipIn: 0.66,
    dish: look(rgb(0.7, 0.7, 0.72), PAINT),
    depth: 0.27,
    cap: look(rgb(0.04, 0.04, 0.045), PAINT),
    capR: 0.12,
    holes: [{ n: 14, r0: 0.18, r1: 0.62, half: 0.07, twist: 0.9 }],
  },
  steel: {
    lip: look(rgb(0.8, 0.8, 0.77), PAINT),
    lipIn: 0.62,
    dish: look(rgb(0.8, 0.8, 0.77), PAINT),
    depth: 0.24,
    cap: chrome,
    capR: 0.27,
    holes: [{ n: 4, r0: 0.42, r1: 0.53, half: 0.17, offset: Math.PI / 4 }],
  },
  deep: {
    lip: chrome,
    lipIn: 0.5,
    dish: chrome,
    depth: 0.12,
    cap: dark,
    capR: 0.13,
    holes: [{ n: 6, r0: 0.19, r1: 0.44, half: 0.22 }],
  },
};

const lathe = (pts: XY[], seg: number) => {
  const g = new THREE.LatheGeometry(
    pts.map(([r, a]) => new THREE.Vector2(r, a)),
    seg,
  );
  g.rotateZ(-Math.PI / 2);
  return prep(g, true);
};

function build(d: Design): THREE.BufferGeometry {
  const kit = new Kit();
  // Tire: rounded tread and shoulders; the hidden inner sidewall is left open
  kit.add(
    lathe(
      [
        [0.9, -0.31],
        [1.0, -0.17],
        [1.0, 0.17],
        [0.93, 0.31],
        [0.72, 0.3],
      ],
      18,
    ),
    look(TIRE, MATTE),
  );
  kit.add(
    lathe(
      [
        [0.74, 0.3],
        [0.7, 0.33],
        [d.lipIn + 0.02, 0.33],
        [d.lipIn, 0.31],
      ],
      18,
    ),
    d.lip,
  );
  kit.add(
    lathe(
      [
        [d.lipIn, 0.31],
        [d.capR, d.depth],
      ],
      18,
    ),
    d.dish,
  );
  kit.add(
    lathe(
      [
        [d.capR, d.depth],
        [d.capR * 0.7, d.depth + 0.06],
        [0.0, d.depth + 0.075],
      ],
      12,
    ),
    d.cap,
  );
  // Openings in the dish, just proud of its surface
  const ax = (r: number) => d.depth + ((r - d.capR) / (d.lipIn - d.capR)) * (0.31 - d.depth) + 0.006;
  for (const h of d.holes) {
    const radial = h.twist ? 4 : 1;
    const across = Math.max(1, Math.ceil((2 * h.half) / 0.14));
    for (let i = 0; i < h.n; i++) {
      const base = (i / h.n) * Math.PI * 2 + (h.offset ?? 0);
      const pt = (u: number, v: number) => {
        const r = h.r0 + (h.r1 - h.r0) * u;
        const a = base + (h.twist ?? 0) * u + (v * 2 - 1) * h.half;
        return new THREE.Vector3(ax(r), Math.cos(a) * r, Math.sin(a) * r);
      };
      for (let k = 0; k < radial; k++) {
        for (let j = 0; j < across; j++) {
          const u0 = k / radial;
          const u1 = (k + 1) / radial;
          const v0 = j / across;
          const v1 = (j + 1) / across;
          kit.add(fan([pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)], PX), dark);
        }
      }
    }
  }
  return paintBase(bake(kit), new THREE.Color(0));
}

/**
 * The wheel model faces +x (the car's left). Right-side wheels need a mirrored copy; `scale(-1)` mirrors
 * positions and normals but not the winding, so the triangles are flipped too (non-indexed list).
 */
function mirroredX(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  g.scale(-1, 1, 1);
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    const n = a.itemSize;
    const arr = a.array as Float32Array;
    for (let v = 0; v < a.count; v += 3) {
      for (let k = 0; k < n; k++) [arr[(v + 1) * n + k], arr[(v + 2) * n + k]] = [arr[(v + 2) * n + k], arr[(v + 1) * n + k]];
    }
    a.needsUpdate = true;
  }
  return g;
}

const cache = new Map<WheelId, { pos: THREE.BufferGeometry; neg: THREE.BufferGeometry }>();

/** Unit-radius wheel, axle along x: `pos` faces +x (wheels at x > 0), `neg` is its mirror image. Cached. */
export function wheelPair(id: WheelId = 'stock'): { pos: THREE.BufferGeometry; neg: THREE.BufferGeometry } {
  let hit = cache.get(id);
  if (!hit) {
    const pos = build(DESIGNS[id]);
    hit = { pos, neg: mirroredX(pos) };
    cache.set(id, hit);
  }
  return hit;
}

/** Unit-radius factory wheel, detailed face toward +x. */
export function wheelGeometry(): THREE.BufferGeometry {
  return wheelPair('stock').pos;
}
