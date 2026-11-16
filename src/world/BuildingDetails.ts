import * as THREE from 'three';
import { CONFIG } from '../config';
import { LOOK } from '../render/Look';
import { Rng, hash01 } from '../core/Rng';
import type { AABB, Building, Facing } from '../types';
import type { Layout } from './BuildingFrame';
import { layoutOf } from './BuildingFrame';
import { openingTop } from './Interiors';

/** Ground floor level and bottom of a building's box (buildings on slopes sink their low side into the ground). */
export function buildingBase(b: Building): { floor: number; bottom: number } {
  const floor = b.floorY ?? CONFIG.CURB_HEIGHT;
  return { floor, bottom: Math.min(floor, b.footY ?? floor) };
}

/**
 * Footprint of the top part (the tower shaft for buildings with a podium), in the coordinates of `box`: the
 * building itself (world) by default, or its `layoutOf(b).box` (local frame for rotated buildings).
 */
export function roofRect(b: Building, box: AABB = b): AABB {
  if (!b.tower) return { minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ };
  const i = b.tower.inset;
  return { minX: box.minX + i, maxX: box.maxX - i, minZ: box.minZ + i, maxZ: box.maxZ - i };
}

/** `box` pulled in by `inset` on every side, never past a 1.5 m core. */
export function insetFootprint(box: AABB, inset: number): AABB {
  const w = box.maxX - box.minX;
  const d = box.maxZ - box.minZ;
  const i = Math.min(Math.max(0, inset), w / 2 - 0.75, d / 2 - 0.75);
  if (!(i > 0)) return { minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ };
  return { minX: box.minX + i, maxX: box.maxX - i, minZ: box.minZ + i, maxZ: box.maxZ - i };
}

/** Inset of the top tier: the shaft plus every extra setback. */
export function towerCrownInset(t: NonNullable<Building['tower']>): number {
  let i = t.inset;
  for (const s of t.steps ?? []) i += s.inset;
  return i;
}

/**
 * Split `rect` along its long axis with a slot `gap` meters wide.
 * `slot` is the opening; the slabs are what remains.
 */
export function splitShaft(rect: AABB, gap: number): { slabs: AABB[]; slot: AABB | null } {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  const alongX = w >= d;
  const span = alongX ? w : d;
  const g = Math.min(gap, span - 4);
  if (g < 1.2) return { slabs: [rect], slot: null };
  if (alongX) {
    const mid = (rect.minX + rect.maxX) / 2;
    return {
      slabs: [
        { ...rect, maxX: mid - g / 2 },
        { ...rect, minX: mid + g / 2 },
      ],
      slot: { ...rect, minX: mid - g / 2, maxX: mid + g / 2 },
    };
  }
  const mid = (rect.minZ + rect.maxZ) / 2;
  return {
    slabs: [
      { ...rect, maxZ: mid - g / 2 },
      { ...rect, minZ: mid + g / 2 },
    ],
    slot: { ...rect, minZ: mid - g / 2, maxZ: mid + g / 2 },
  };
}

function inNotch(b: Building, box: AABB, x: number, z: number, sx: number, sz: number): boolean {
  const g = b.tower?.notch;
  if (!g || !b.tower) return false;
  const split = splitShaft(insetFootprint(box, towerCrownInset(b.tower)), g);
  const s = split.slot;
  if (!s) return false;
  return x + sx / 2 > s.minX && x - sx / 2 < s.maxX && z + sz / 2 > s.minZ && z - sz / 2 < s.maxZ;
}

type M = THREE.Matrix4;

/**
 * Places matrices built in a layout's box into the world (in place): unchanged for axis-aligned buildings,
 * rotated about Y by the frame's yaw and moved to its center for rotated ones.
 */
export function layoutPlacer(l: Layout): (m: M) => M {
  const f = l.frame;
  if (!f) return (m) => m;
  const w = new THREE.Matrix4().makeRotationY(f.yaw).setPosition(f.center.x, 0, f.center.z);
  return (m) => m.premultiply(w);
}
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number): M => new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);

class Batch {
  mats: M[] = [];
  cols: THREE.Color[] = [];
  add(m: M, c?: THREE.Color): void {
    this.mats.push(m);
    if (c) this.cols.push(c);
  }
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, this.mats.length));
    im.count = this.mats.length;
    this.mats.forEach((m, i) => im.setMatrixAt(i, m));
    this.cols.forEach((c, i) => im.setColorAt(i, c));
    return im;
  }
}

/**
 * Aviation obstruction lights (tower masts, harbor cranes): one shared material, slowly pulsed in sync across
 * the skyline by `blinkAviation` like the real red beacons over Tokyo.
 */
export const AVIATION = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.12, 0.12), toneMapped: false });
const AV_ON = new THREE.Color(2.6, 0.14, 0.12);
const AV_OFF = new THREE.Color(0.18, 0.02, 0.02);

/** Call every frame: ~1.5 s cycle, a soft rise, a hold and a fade. */
export function blinkAviation(time: number): void {
  const p = (time / 1.5) % 1;
  const k = p < 0.15 ? p / 0.15 : p < 0.45 ? 1 : p < 0.65 ? 1 - (p - 0.45) / 0.2 : 0;
  AVIATION.color.copy(AV_OFF).lerp(AV_ON, k);
}

const AWNING = [0xb3202a, 0x1f6b4a, 0x23408f, 0xd4761c, 0x6b2a7a, 0xc9b26a, 0x8a1f45].map((c) => new THREE.Color(c));
const SCRAMBLE_LIGHT = [
  new THREE.Color(2.5, 0.22, 1.15),
  new THREE.Color(0.25, 1.65, 2.3),
  new THREE.Color(2.35, 1.15, 0.22),
  new THREE.Color(1.45, 0.35, 2.45),
];

/** Parapets, balconies, shop awnings, rooftop machinery, water tanks, masts and aviation lights. */
export function buildBuildingDetails(buildings: Building[], scene: THREE.Scene): void {
  const rng = new Rng(4242);
  const rim = new Batch(); // parapets + balcony slabs (concrete, tinted)
  const rails = new Batch(); // balcony railing panels
  const awnings = new Batch();
  const machines = new Batch();
  const tanks = new Batch();
  const glow = new Batch(); // scramble billboards, ribs and crown lights (untonemapped, so they bloom)
  const reds: M[] = [];
  const concrete = (k: number) => new THREE.Color(0.2 * k, 0.2 * k, 0.22 * k);

  let place = (m: M) => m;
  const parapet = (r: AABB, y: number, h: number, c: THREE.Color) => {
    const t = 0.28;
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    rim.add(place(box(w, h, t, cx, y, r.minZ + t / 2)), c);
    rim.add(place(box(w, h, t, cx, y, r.maxZ - t / 2)), c);
    rim.add(place(box(t, h, d - 2 * t, r.minX + t / 2, y, cz)), c);
    rim.add(place(box(t, h, d - 2 * t, r.maxX - t / 2, y, cz)), c);
  };

  for (const b of buildings) {
    // Laid out on `lb` (the building's AABB, or its local box when rotated), then placed into the world
    const layout = layoutOf(b);
    const lb = layout.box;
    place = layoutPlacer(layout);
    const { floor } = buildingBase(b);
    const top = floor + b.height;
    const roof = roofRect(b, lb);
    const tone = rng.range(0.7, 1.15);
    // Stepped towers parapet the crown; a plain shaft still parapets `roof` (the first setback)
    const crown = b.tower?.steps?.length ? insetFootprint(lb, towerCrownInset(b.tower)) : roof;
    parapet(crown, top, b.district === 'harbor' ? 0.5 : rng.range(0.8, 1.2), concrete(tone));
    if (b.tower) parapet(lb, floor + b.tower.podium, 1.1, concrete(tone * 1.1));
    if (b.tower?.steps) {
      let inset = b.tower.inset;
      for (const s of b.tower.steps) {
        parapet(insetFootprint(lb, inset), floor + s.at, 0.7, concrete(tone * 1.05));
        inset += s.inset;
      }
    }
    if (b.landmark) continue;
    const accent = b.scramble ? SCRAMBLE_LIGHT[Math.floor(hash01(b.seed, 19) * SCRAMBLE_LIGHT.length)] : null;

    // Street-facing details
    for (const f of b.faces) {
      const along = f === 'N' || f === 'S';
      const len = along ? lb.maxX - lb.minX : lb.maxZ - lb.minZ;
      const out = f === 'N' || f === 'W' ? -1 : 1;
      const edge = f === 'N' ? lb.minZ : f === 'S' ? lb.maxZ : f === 'W' ? lb.minX : lb.maxX;
      const start = along ? lb.minX : lb.minZ;
      /** Box hanging off the facade: s along it, protruding `depth` outward (in the layout box; `facadeBox` places it). */
      const localBox = (s0: number, s1: number, depth: number, y: number, h: number, offset = 0): M => {
        const mid = start + (s0 + s1) / 2;
        const n = edge + out * (offset + depth / 2);
        return along ? box(s1 - s0, h, depth, mid, y, n) : box(depth, h, s1 - s0, n, y, mid);
      };
      const facadeBox = (s0: number, s1: number, depth: number, y: number, h: number, offset = 0): M => place(localBox(s0, s1, depth, y, h, offset));

      if (b.district === 'residential' && b.height > 7) {
        // Full-width balconies, a deeper middle run, or alternating halves. Garages keep the plain run.
        // Towers stop the balconies at the podium so they don't hang beside the setback.
        const stop = b.tower ? floor + b.tower.podium - 0.3 : top - 1.2;
        const mode = b.cavity || b.tower ? 0.4 : hash01(b.seed, 9);
        if (mode >= 0.15 && stop > floor + 6) {
          const edgeInset = mode < 0.58 ? 0.3 : mode < 0.82 ? Math.min(len * 0.2, 2.4) : 0.4;
          let row = 0;
          for (let y = floor + 3.2 + 2.9; y < stop; y += 2.9) {
            let s0 = edgeInset;
            let s1 = len - edgeInset;
            if (mode >= 0.82) {
              const mid = len * 0.5;
              if (row % 2 === 0) s1 = Math.max(s0 + 1.4, mid - 0.15);
              else s0 = Math.min(s1 - 1.4, mid + 0.15);
            }
            if (s1 - s0 > 1.3) {
              const depth = mode >= 0.58 && mode < 0.82 ? 1.4 : 1.05;
              rim.add(facadeBox(s0, s1, depth, y - 0.12, 0.16), concrete(tone * 1.35));
              rails.add(facadeBox(s0, s1, 0.05, y + 0.04, 1.0, depth - 0.05));
            }
            row++;
          }
        }
      }
      if (b.district === 'downtown' && !b.scramble && len > 8) {
        // Lobby cornice and the lip where a tower sets back, both on the street wall
        rim.add(facadeBox(0.2, len - 0.2, 0.32, floor + 4.32, 0.26), concrete(tone * 0.72));
        if (b.tower) rim.add(facadeBox(0, len, 0.85, floor + b.tower.podium - 0.22, 0.48), concrete(tone * 0.9));
        // Fins and belts sit on the shaft face once the building steps in (negative offset pulls them inward)
        const pull = b.tower ? -b.tower.inset : 0;
        const margin = (b.tower?.inset ?? 0) + 0.5;
        const yFin = floor + (b.tower ? b.tower.podium : 4.5);
        const shaftTop = b.tower?.steps?.length ? floor + Math.min(...b.tower.steps.map((s) => s.at)) : top;
        if (b.height > 26 && len - 2 * margin > 6 && hash01(b.seed, 12) > 0.42 && shaftTop - yFin > 10) {
          const fins = 3 + Math.floor(hash01(b.seed, 13) * 4);
          const fh = shaftTop - 1.2 - yFin;
          for (let i = 0; i < fins; i++) {
            const s = margin + ((i + 0.5) / fins) * (len - 2 * margin);
            machines.add(facadeBox(s - 0.14, s + 0.14, 0.55, yFin, fh, pull), new THREE.Color(0.14, 0.15, 0.17));
          }
        }
        if (b.height > 24 && len - 2 * margin > 4 && hash01(b.seed, 15) > 0.48) {
          const yBelt0 = b.tower ? floor + b.tower.podium + 8 : floor + 14;
          for (let y = yBelt0; y < shaftTop - 3; y += 15) rim.add(facadeBox(margin, len - margin, 0.38, y, 0.22, pull), concrete(tone * 1.15));
        }
      }
      if (b.scramble && accent && len > 16) {
        const ins = b.tower?.inset ?? 0;
        const pull = -ins;
        const margin = ins + 0.6;
        const yBase = floor + (b.tower?.podium ?? 12);
        const shaftTop = b.tower?.steps?.length ? floor + Math.min(...b.tower.steps.map((s) => s.at)) : top;
        if (len - 2 * margin > 8) {
          for (let y = yBase + 6; y < shaftTop - 4; y += 14) {
            rim.add(facadeBox(margin, len - margin, 0.45, y, 0.32, pull), new THREE.Color(0.07, 0.075, 0.09));
            glow.add(facadeBox(margin + 0.4, len - margin - 0.4, 0.1, y + 0.1, 0.08, pull + 0.4), accent);
          }
          const face = len - 2 * margin;
          const bw = Math.min(face - 2, 20);
          const s0 = margin + (face - bw) / 2;
          const boardH = Math.min(6.5, bw * 0.32);
          const boardY = yBase + (shaftTop - yBase) * 0.52;
          if (boardY + boardH < shaftTop - 1) glow.add(facadeBox(s0, s0 + bw, 0.7, boardY, boardH, pull), accent);
        }
      }
      if (b.district === 'shotengai' && len > 3) {
        const n = Math.max(1, Math.round(len / 4.5));
        const sw = len / n;
        for (let k = 0; k < n; k++) {
          if (!rng.chance(0.6)) continue;
          const s0 = k * sw + 0.25;
          const s1 = (k + 1) * sw - 0.25;
          if (openingTop(b, f, start + s0, start + s1) !== null) continue; // no awning over a passage / nook
          const m = localBox(s0, s1, 1.35, floor + 2.75, 0.06);
          // tilt down toward the street
          const tilt = new THREE.Matrix4().makeRotationAxis(along ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), (along ? out : -out) * 0.32);
          const pos = new THREE.Vector3().setFromMatrixPosition(m);
          const sc = new THREE.Vector3(along ? s1 - s0 : 1.35, 0.06, along ? 1.35 : s1 - s0);
          const mm = place(new THREE.Matrix4().makeScale(sc.x, sc.y, sc.z).premultiply(tilt).setPosition(pos.x, pos.y, pos.z));
          awnings.add(mm, rng.pick(AWNING).clone().multiplyScalar(rng.range(0.7, 1.1)));
        }
      }
      if (b.district === 'harbor') {
        // canopy over the loading doors
        machines.add(facadeBox(0.5, len - 0.5, 1.6, floor + 5.4, 0.15), new THREE.Color(0.18, 0.19, 0.2));
      }
    }

    if (b.scramble && accent) {
      // Corner pylons where two street faces meet, and a lit ring under the crown parapet
      const ph = Math.min(26, Math.max(14, b.height * 0.16));
      const y0 = floor + (b.tower?.podium ?? 10);
      const ins = b.tower?.inset ?? 0;
      const corners: [number, number, Facing, Facing][] = [
        [lb.minX + ins, lb.minZ + ins, 'W', 'N'],
        [lb.maxX - ins, lb.minZ + ins, 'E', 'N'],
        [lb.minX + ins, lb.maxZ - ins, 'W', 'S'],
        [lb.maxX - ins, lb.maxZ - ins, 'E', 'S'],
      ];
      for (const [x, z, fa, fb] of corners) {
        if (!b.faces.includes(fa) || !b.faces.includes(fb)) continue;
        const ox = (fa === 'W' ? -1 : 1) * 0.15;
        const oz = (fb === 'N' ? -1 : 1) * 0.15;
        glow.add(place(box(0.7, ph, 0.7, x + ox, y0, z + oz)), accent);
      }
      const cap = b.tower?.steps?.length ? insetFootprint(lb, towerCrownInset(b.tower)) : roof;
      const cw = cap.maxX - cap.minX;
      const cd = cap.maxZ - cap.minZ;
      const ccx = (cap.minX + cap.maxX) / 2;
      const ccz = (cap.minZ + cap.maxZ) / 2;
      const gy = top - 0.15;
      glow.add(place(box(cw + 0.45, 0.42, 0.26, ccx, gy, cap.minZ)), accent);
      glow.add(place(box(cw + 0.45, 0.42, 0.26, ccx, gy, cap.maxZ)), accent);
      glow.add(place(box(0.26, 0.42, cd + 0.45, cap.minX, gy, ccz)), accent);
      glow.add(place(box(0.26, 0.42, cd + 0.45, cap.maxX, gy, ccz)), accent);
    }

    // Rooftop clutter
    const rw = roof.maxX - roof.minX;
    const rd = roof.maxZ - roof.minZ;
    const n = b.district === 'harbor' ? rng.int(0, 1) : rng.int(1, 4);
    for (let k = 0; k < n; k++) {
      const sx = rng.range(1.2, Math.min(4.5, rw * 0.35));
      const sz = rng.range(1.2, Math.min(4.5, rd * 0.35));
      const x = rng.range(roof.minX + sx, roof.maxX - sx);
      const z = rng.range(roof.minZ + sz, roof.maxZ - sz);
      const hy = rng.range(0.8, 2.4);
      const shade = rng.range(0.12, 0.3);
      let px = x;
      let pz = z;
      if (b.tower?.steps?.length) {
        const cap = insetFootprint(lb, towerCrownInset(b.tower));
        const x0 = cap.minX + sx * 0.5;
        const x1 = cap.maxX - sx * 0.5;
        const z0 = cap.minZ + sz * 0.5;
        const z1 = cap.maxZ - sz * 0.5;
        if (x1 > x0) px = Math.min(Math.max(px, x0), x1);
        if (z1 > z0) pz = Math.min(Math.max(pz, z0), z1);
      }
      if (inNotch(b, lb, px, pz, sx, sz)) continue;
      machines.add(place(box(sx, hy, sz, px, top, pz)), new THREE.Color().setScalar(shade));
    }
    if ((b.district === 'residential' || b.district === 'shotengai') && rng.chance(0.45) && rw > 6 && rd > 6) {
      const x = rng.range(roof.minX + 2.5, roof.maxX - 2.5);
      const z = rng.range(roof.minZ + 2.5, roof.maxZ - 2.5);
      const r = rng.range(0.9, 1.3);
      machines.add(place(box(r * 1.8, 1.1, r * 1.8, x, top, z)), new THREE.Color(0.1, 0.1, 0.11)); // stand
      tanks.add(place(box(r, rng.range(1.6, 2.2), r, x, top + 1.1, z)), new THREE.Color().setHSL(rng.pick([0.55, 0.08, 0.6, 0]), 0.15, rng.range(0.35, 0.6)));
    }
    if (b.height > 40) {
      const cx = (roof.minX + roof.maxX) / 2;
      const cz = (roof.minZ + roof.maxZ) / 2;
      let y = top;
      if (b.height > 60 && rw > 10 && rd > 10) {
        // mechanical penthouse crown (pulled onto the top setback when the shaft steps in)
        const ch = rng.range(3, 7);
        let pw = rw * 0.55;
        let pd = rd * 0.55;
        if (b.tower?.steps?.length) {
          const cap = insetFootprint(lb, towerCrownInset(b.tower));
          pw = Math.min(pw, (cap.maxX - cap.minX) * 0.72);
          pd = Math.min(pd, (cap.maxZ - cap.minZ) * 0.72);
        }
        if (!b.tower?.notch && pw > 2 && pd > 2) {
          machines.add(place(box(pw, ch, pd, cx, top, cz)), new THREE.Color(0.08, 0.09, 0.11));
          y += ch;
        }
      }
      const mast = rng.range(3, 9);
      let mx = cx;
      let mz = cz;
      if (b.tower?.notch) {
        const slab = splitShaft(roof, b.tower.notch).slabs[0];
        mx = (slab.minX + slab.maxX) / 2;
        mz = (slab.minZ + slab.maxZ) / 2;
      }
      machines.add(place(box(0.25, mast, 0.25, mx, y, mz)), new THREE.Color(0.25, 0.25, 0.27));
      reds.push(place(new THREE.Matrix4().makeScale(0.6, 0.6, 0.6).setPosition(mx, y + mast, mz)));
    }
  }

  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);
  const center = new THREE.BoxGeometry(1, 1, 1);
  const plain = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.1 });
  scene.add(rim.mesh(unit, plain));
  scene.add(rails.mesh(unit, new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.35, metalness: 0.3 })));
  scene.add(awnings.mesh(center, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x220a08 })));
  scene.add(machines.mesh(unit, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.35 })));
  // By day the billboards and crown lights are unlit painted panels
  const glowMat = LOOK.day ? new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.2 }) : new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  scene.add(glow.mesh(unit, glowMat));
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
  cyl.translate(0, 0.5, 0);
  scene.add(tanks.mesh(cyl, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.4 })));
  const red = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), AVIATION, Math.max(1, reds.length));
  red.count = reds.length;
  reds.forEach((mm, i) => red.setMatrixAt(i, mm));
  scene.add(red);
}

