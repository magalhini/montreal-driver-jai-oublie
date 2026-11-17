import * as THREE from 'three';
import type { CarStyle } from './Car';
import type { BodyProfile } from './BodyProfiles';
import { disc, extrude, fan, mirrorX, onX, onZ, prep, rbox, ring, rrect, shade, slice, strip, yAt, type V2, type XY } from './CarGeometry';
import { look, type Kit, type Look } from './CarKit';
import { AMBER, CHROME, GLASS, GLOW, GOLD, MATTE, PLATE_INK, PLATE_KEI, PLATE_TAXI, PLATE_WHITE, REFLECTOR, rgb, SPVM_BLUE } from './CarMaterial';

/** Shared state while building one body style. */
export interface BodyCtx {
  kit: Kit;
  st: BodyProfile;
  style: CarStyle;
  taxi: boolean;
  police: boolean;
  hl: number;
  hw: number;
  ghw: number;
  body: Look;
  seam: Look;
  dark: Look;
  trim: Look;
  chrome: Look;
  heads: THREE.BufferGeometry[];
  tails: THREE.BufferGeometry[];
  headPos: [number, number, number][];
  tailPos: [number, number, number][];
  /** Plate centers on the body (x, y, z) and which way each faces (+1 front, -1 rear). */
  platePos: { at: [number, number, number]; dir: 1 | -1 }[];
}

/** Front and rear ends: grilles, lamps (lenses go to heads / tails), bumpers, plates, exhausts, plus the coupe hood bulge and wagon roof rails. */
export function buildEnds(c: BodyCtx): void {
  const { kit, st, style, taxi, police, hl, hw, ghw, body, seam, dark, trim, chrome, heads, tails, headPos, tailPos, platePos } = c;
  const plateColor = style === 'kei' ? PLATE_KEI : taxi ? PLATE_TAXI : PLATE_WHITE;
  const inkColor = taxi ? rgb(0.75, 0.75, 0.7) : style === 'kei' ? rgb(0.02, 0.02, 0.02) : PLATE_INK;
  const plate = (y: number, z: number, dir: 1 | -1, lit: boolean) => {
    platePos.push({ at: [0, y, z], dir });
    kit.add(onZ(rrect(0, y, 0.33, 0.165, 0.012), z, dir), look(plateColor, lit ? GLOW : MATTE));
    const ink = look(inkColor, MATTE);
    kit.add(onZ(rrect(0.02, y + 0.048, 0.14, 0.022, 0.004), z + dir * 0.004, dir), ink);
    kit.add(onZ(rrect(0.035, y - 0.022, 0.2, 0.06, 0.006), z + dir * 0.004, dir), ink);
    kit.add(onZ(rrect(-0.12, y - 0.022, 0.03, 0.04, 0.006), z + dir * 0.004, dir), ink);
  };
  const bumper = (zFace: number, dir: 1 | -1, y0: number, y1: number, depth: number, l: Look, wrap = 0.3) => {
    const zIn = zFace - dir * 0.04;
    const zOut = zFace + dir * depth;
    kit.add(rbox(Math.min(zIn, zOut), Math.max(zIn, zOut), y0, y1, -hw - 0.02, hw + 0.02, (y1 - y0) * 0.45, 0.025), l);
    const za = zFace - dir * wrap;
    const zb = zFace + dir * depth * 0.5;
    kit.both(rbox(Math.min(za, zb), Math.max(za, zb), y0, y1, hw - 0.03, hw + 0.022, (y1 - y0) * 0.45, 0.01), l);
  };
  const exhaust = (x: number, y: number, z: number) => {
    kit.add(prep(new THREE.CylinderGeometry(0.034, 0.034, 0.22, 10, 1, true).rotateX(Math.PI / 2).translate(x, y, z), true), look(rgb(0.5, 0.5, 0.52), CHROME));
    kit.add(disc(0.03, x, y, z - 0.08, -1), dark);
  };
  const zf = hl;
  const zr = -hl;
  const rect = (x: number, y: number, w: number, h: number, rad: number, z: number, dir: 1 | -1, l: Look) => kit.add(onZ(rrect(x, y, w, h, rad), z, dir), l);

  if (style === 'coupe') {
    // Front: black grille panel holding round twin headlights, chrome blade bumper
    const ly = 0.505;
    rect(0, ly, 1.43, 0.19, 0.04, zf + 0.003, 1, chrome);
    rect(0, ly, 1.4, 0.165, 0.03, zf + 0.006, 1, dark);
    for (const y of [ly - 0.035, ly, ly + 0.035]) rect(0, y, 0.44, 0.01, 0.003, zf + 0.009, 1, chrome);
    kit.add(disc(0.024, 0, ly + 0.058, zf + 0.012, 1), look(GOLD, CHROME));
    for (const s of [-1, 1]) {
      for (const [x, r] of [
        [0.585, 0.084],
        [0.395, 0.071],
      ]) {
        kit.add(ring(r - 0.004, r + 0.016, s * x, ly, zf + 0.009, 1), chrome);
        heads.push(disc(r, s * x, ly, zf + 0.012, 1));
      }
      headPos.push([s * 0.49, ly, zf + 0.08]);
      rect(s * 0.56, 0.318, 0.14, 0.03, 0.01, zf + 0.004, 1, look(AMBER, GLOW));
    }
    bumper(zf, 1, 0.335, 0.395, 0.07, chrome);
    for (const s of [-1, 1]) kit.add(rbox(zf + 0.03, zf + 0.1, 0.31, 0.415, s * 0.33 - 0.035, s * 0.33 + 0.035, 0.02, 0.008), dark);
    plate(0.365, zf + 0.075, 1, false);
    // Power bulge down the middle of the long hood
    const hoodLine = [st.nose[st.nose.length - 1], ...st.hood];
    const crest = slice(hoodLine, 1.95, st.ws[0][0] + 0.02);
    const bulge = extrude(
      [...crest.map(([z, y]): V2 => [z, y + 0.022]), ...crest.reverse().map(([z, y]): V2 => [z, y - 0.04])],
      0.6,
      0.02,
      0.04,
      2,
    );
    kit.add(shade(bulge), body, bulge.cap);
    // Rear: black panel with round twin tail lamps
    rect(0, 0.635, 1.44, 0.17, 0.035, zr - 0.003, -1, dark);
    for (const s of [-1, 1]) {
      for (const x of [0.615, 0.445]) {
        kit.add(ring(0.064, 0.082, s * x, 0.635, zr - 0.006, -1), chrome);
        tails.push(disc(0.068, s * x, 0.635, zr - 0.009, -1));
      }
      tailPos.push([s * 0.53, 0.635, zr - 0.07]);
    }
    plate(0.635, zr - 0.006, -1, true);
    bumper(zr, -1, 0.39, 0.45, 0.07, chrome);
    exhaust(-0.45, 0.3, zr - 0.02);
  } else if (style === 'sports') {
    buildSportsEnds(c, plate, exhaust, rect);
  } else if (style === 'sedan' || style === 'police') {
    // Front: quad rectangular headlights flanking a chrome (or black) grille
    const grille = police ? dark : chrome;
    rect(0, 0.615, 0.76, 0.2, 0.02, zf + 0.003, 1, grille);
    rect(0, 0.615, 0.72, 0.165, 0.015, zf + 0.006, 1, dark);
    for (let i = -3; i <= 3; i++) rect(i * 0.1, 0.615, 0.012, 0.15, 0.003, zf + 0.009, 1, police ? trim : chrome);
    kit.add(disc(police ? 0.04 : 0.028, 0, 0.615, zf + 0.012, 1), police ? look(SPVM_BLUE) : look(GOLD, CHROME));
    for (const s of [-1, 1]) {
      rect(s * 0.585, 0.615, 0.39, 0.175, 0.02, zf + 0.003, 1, chrome);
      rect(s * 0.585, 0.615, 0.365, 0.15, 0.015, zf + 0.006, 1, dark);
      for (const x of [0.49, 0.68]) heads.push(onZ(rrect(s * x, 0.615, 0.165, 0.125, 0.014), zf + 0.01, 1));
      headPos.push([s * 0.585, 0.615, zf + 0.08]);
      rect(s * 0.6, 0.5, 0.28, 0.045, 0.012, zf + 0.004, 1, look(AMBER, GLOW));
    }
    bumper(zf, 1, 0.37, 0.47, 0.08, police ? trim : chrome);
    rect(0, 0.42, st.W - 0.1, 0.03, 0.01, zf + 0.084, 1, police ? look(rgb(0.07, 0.07, 0.08), MATTE) : dark);
    plate(0.42, zf + 0.09, 1, false);
    // Rear: wide tail lamps with a dark red reflector garnish between them
    rect(0, 0.675, 0.8, 0.12, 0.012, zr - 0.004, -1, look(REFLECTOR, GLASS));
    for (const s of [-1, 1]) {
      rect(s * 0.595, 0.675, 0.37, 0.17, 0.02, zr - 0.003, -1, trim);
      tails.push(onZ(rrect(s * 0.635, 0.675, 0.27, 0.14, 0.014), zr - 0.009, -1));
      rect(s * 0.46, 0.675, 0.07, 0.14, 0.01, zr - 0.007, -1, look(AMBER, GLOW));
      tailPos.push([s * 0.62, 0.675, zr - 0.07]);
      // wrap-around lens on the rear quarter
      const wrap = onX(
        [
          [zr + 0.09, 0.615],
          [zr + 0.09, 0.735],
          [zr + 0.22, 0.735],
          [zr + 0.22, 0.615],
        ],
        hw + 0.006,
      );
      tails.push(s > 0 ? wrap : mirrorX(wrap));
    }
    plate(0.535, zr - 0.006, -1, true);
    bumper(zr, -1, 0.36, 0.45, 0.08, police ? trim : chrome);
    rect(0, 0.405, st.W - 0.1, 0.03, 0.01, zr - 0.084, -1, police ? look(rgb(0.07, 0.07, 0.08), MATTE) : dark);
    exhaust(-0.55, 0.3, zr + 0.0);
  } else if (style === 'wagon') {
    rect(0, 0.62, 0.84, 0.17, 0.02, zf + 0.003, 1, dark);
    for (const y of [0.57, 0.62, 0.67]) rect(0, y, 0.78, 0.014, 0.005, zf + 0.007, 1, chrome);
    kit.add(disc(0.026, 0, 0.62, zf + 0.011, 1), chrome);
    for (const s of [-1, 1]) {
      rect(s * 0.6, 0.62, 0.34, 0.18, 0.02, zf + 0.003, 1, chrome);
      rect(s * 0.6, 0.62, 0.32, 0.16, 0.015, zf + 0.006, 1, dark);
      heads.push(onZ(rrect(s * 0.6, 0.62, 0.29, 0.135, 0.016), zf + 0.01, 1));
      headPos.push([s * 0.6, 0.62, zf + 0.08]);
      rect(s * 0.62, 0.5, 0.26, 0.045, 0.012, zf + 0.004, 1, look(AMBER, GLOW));
    }
    bumper(zf, 1, 0.37, 0.47, 0.08, trim);
    plate(0.42, zf + 0.085, 1, false);
    // Rear: vertical tail lamps beside the tailgate
    for (const s of [-1, 1]) {
      rect(s * 0.7, 0.625, 0.16, 0.32, 0.02, zr - 0.003, -1, trim);
      tails.push(onZ(rrect(s * 0.7, 0.66, 0.13, 0.22, 0.014), zr - 0.009, -1));
      rect(s * 0.7, 0.515, 0.13, 0.06, 0.01, zr - 0.007, -1, look(AMBER, GLOW));
      tailPos.push([s * 0.7, 0.66, zr - 0.07]);
      rect(s * 0.6, 0.65, 0.012, 0.4, 0.004, zr - 0.003, -1, seam);
    }
    rect(0, 0.45, 1.2, 0.012, 0.004, zr - 0.003, -1, seam);
    rect(0, 0.68, 0.42, 0.024, 0.008, zr - 0.005, -1, chrome);
    plate(0.555, zr - 0.006, -1, true);
    bumper(zr, -1, 0.36, 0.45, 0.08, trim);
    exhaust(-0.55, 0.3, zr + 0.0);
    // Roof rails
    const ry = yAt([st.ws[1], ...st.roof, st.bl[0]], -1.0) + 0.045;
    for (const s of [-1, 1]) {
      const x = s * (ghw * st.tumble - 0.14);
      kit.add(rbox(-1.95, 0.05, ry - 0.012, ry + 0.012, x - 0.014, x + 0.014, 0.01, 0.005), chrome);
      for (const z of [0.0, -1.0, -1.9]) kit.add(prep(new THREE.BoxGeometry(0.03, 0.05, 0.06).translate(x, ry - 0.025, z)), trim);
    }
  } else if (style === 'city') {
    // Snub nose: round lamps on the flat face, a small slatted mouth between them, a thin chrome bumper
    const ly = 0.51;
    for (const s of [-1, 1]) {
      kit.add(ring(0.072, 0.092, s * 0.4, ly, zf + 0.004, 1), chrome);
      heads.push(disc(0.074, s * 0.4, ly, zf + 0.008, 1));
      headPos.push([s * 0.4, ly, zf + 0.08]);
      rect(s * 0.4, 0.355, 0.11, 0.026, 0.01, zf + 0.004, 1, look(AMBER, GLOW));
    }
    rect(0, ly, 0.26, 0.15, 0.04, zf + 0.003, 1, dark);
    for (const y of [ly - 0.04, ly, ly + 0.04]) rect(0, y, 0.2, 0.008, 0.003, zf + 0.007, 1, chrome);
    bumper(zf, 1, 0.25, 0.32, 0.05, chrome, 0.18);
    plate(0.285, zf + 0.055, 1, false);
    // Rear: round lamps high on the tail, plate below, one offset exhaust
    const ry = 0.56;
    for (const s of [-1, 1]) {
      kit.add(ring(0.05, 0.068, s * 0.44, ry, zr - 0.004, -1), chrome);
      tails.push(disc(0.052, s * 0.44, ry, zr - 0.008, -1));
      tailPos.push([s * 0.44, ry, zr - 0.07]);
    }
    plate(0.4, zr - 0.006, -1, true);
    bumper(zr, -1, 0.25, 0.32, 0.05, chrome, 0.18);
    exhaust(-0.32, 0.27, zr + 0.02);
  } else {
    // Kei: round headlights with chrome bezels, small grille, chrome bumpers
    rect(0, 0.53, 0.5, 0.12, 0.02, zf + 0.003, 1, dark);
    for (const y of [0.505, 0.555]) rect(0, y, 0.44, 0.012, 0.004, zf + 0.007, 1, chrome);
    for (const s of [-1, 1]) {
      kit.add(ring(0.086, 0.106, s * 0.45, 0.53, zf + 0.006, 1), chrome);
      heads.push(disc(0.09, s * 0.45, 0.53, zf + 0.01, 1));
      headPos.push([s * 0.45, 0.53, zf + 0.08]);
    }
    bumper(zf, 1, 0.32, 0.4, 0.06, chrome, 0.22);
    plate(0.37, zf + 0.065, 1, false);
    for (const s of [-1, 1]) {
      rect(s * 0.555, 0.6, 0.14, 0.27, 0.02, zr - 0.003, -1, trim);
      tails.push(onZ(rrect(s * 0.555, 0.63, 0.115, 0.17, 0.014), zr - 0.009, -1));
      rect(s * 0.555, 0.505, 0.115, 0.05, 0.01, zr - 0.007, -1, look(AMBER, GLOW));
      tailPos.push([s * 0.555, 0.63, zr - 0.07]);
      rect(s * 0.47, 0.66, 0.012, 0.4, 0.004, zr - 0.003, -1, seam);
    }
    rect(0, 0.455, 0.95, 0.012, 0.004, zr - 0.003, -1, seam);
    plate(0.56, zr - 0.006, -1, true);
    bumper(zr, -1, 0.32, 0.4, 0.06, chrome, 0.22);
    exhaust(-0.42, 0.28, zr + 0.02);
  }
}

type PlateFn = (y: number, z: number, dir: 1 | -1, lit: boolean) => void;
type RectFn = (x: number, y: number, w: number, h: number, rad: number, z: number, dir: 1 | -1, l: Look) => void;

/** Flat polygon given as (x, distance along a -> b) on the plane through the side-profile segment a -> b, lifted `off` outward. */
function onSlope(poly: XY[], a: V2, b: V2, off: number): THREE.BufferGeometry {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tz = (b[0] - a[0]) / len;
  const ty = (b[1] - a[1]) / len;
  const nz = ty;
  const ny = -tz;
  return fan(
    poly.map(([x, d]) => new THREE.Vector3(x, a[1] + ty * d + ny * off, a[0] + tz * d + nz * off)),
    new THREE.Vector3(0, ny, nz),
  );
}

/**
 * Hayate: a smooth body-color nose with the headlights faired in under clear covers on the sloping panel above
 * a small oval mouth, and slim tail lamps wrapped toward the corners. No chrome, no grille, no wing.
 */
function buildSportsEnds(c: BodyCtx, plate: PlateFn, exhaust: (x: number, y: number, z: number) => void, rect: RectFn): void {
  const { kit, st, hl, seam, dark, trim, heads, tails, headPos, tailPos } = c;
  const zf = hl;
  const zr = -hl;
  // Headlight panel: the flat run of the nose between these two profile points
  const a = st.nose[4];
  const b = st.nose[6];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n: V2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  const mid = 0.085;
  for (const s of [-1, 1]) {
    const x = s * 0.46;
    kit.add(onSlope(rrect(x, mid, 0.34, 0.138, 0.055, 3), a, b, 0.003), dark);
    heads.push(onSlope(rrect(x, mid, 0.305, 0.1, 0.042, 3), a, b, 0.007));
    kit.add(onSlope(rrect(x - s * 0.02, mid, 0.008, 0.1, 0.002), a, b, 0.009), dark);
    const pz = a[0] + ((b[0] - a[0]) / len) * mid;
    const py = a[1] + ((b[1] - a[1]) / len) * mid;
    headPos.push([x, py + n[1] * 0.08, pz + n[0] * 0.08]);
    rect(s * 0.6, 0.335, 0.13, 0.038, 0.014, zf + 0.004, 1, look(AMBER, GLOW));
  }
  // Oval mouth with two slats, the plate on a small mount in front of it
  rect(0, 0.325, 0.8, 0.1, 0.045, zf + 0.004, 1, dark);
  for (const y of [0.305, 0.345]) rect(0, y, 0.74, 0.008, 0.003, zf + 0.007, 1, trim);
  kit.add(rbox(zf - 0.01, zf + 0.024, 0.285, 0.44, -0.18, 0.18, 0.012, 0.005), dark);
  plate(0.3625, zf + 0.026, 1, false);
  // Bumper shut line under the lamp panel
  kit.add(onSlope(rrect(0, 0.004, 1.36, 0.007, 0.002), a, b, 0.002), seam);

  // Rear: slim tail lamps out to the corners, a dark garnish between them, recessed plate
  const ly = 0.6;
  rect(0, ly, 0.5, 0.05, 0.016, zr - 0.004, -1, dark);
  for (const s of [-1, 1]) {
    rect(s * 0.52, ly, 0.45, 0.118, 0.035, zr - 0.004, -1, dark);
    tails.push(onZ(rrect(s * 0.555, ly, 0.36, 0.088, 0.028), zr - 0.009, -1));
    rect(s * 0.33, ly, 0.07, 0.088, 0.014, zr - 0.008, -1, look(AMBER, GLOW));
    tailPos.push([s * 0.55, ly, zr - 0.07]);
  }
  rect(0, 0.46, 0.38, 0.2, 0.025, zr - 0.003, -1, dark);
  plate(0.46, zr - 0.006, -1, true);
  rect(0, 0.355, 1.3, 0.008, 0.003, zr - 0.003, -1, seam);
  rect(0, 0.29, 1.24, 0.085, 0.03, zr - 0.003, -1, dark);
  for (const x of [-0.4, 0.4]) exhaust(x, 0.26, zr + 0.09);
  // The Hayate is only ever the player's car: two hood slots and a shallow intake in the door.
  const slot = slice([st.nose[st.nose.length - 1], ...st.hood], 1.42, 1.02);
  for (const s of [-1, 1]) {
    kit.add(strip(slot, s * 0.16, s * 0.3, 0.007), dark);
    kit.add(strip(slot, s * 0.19, s * 0.27, 0.011), seam);
  }
  const iz = (st.doors[0] + st.doors[1]) / 2;
  const iy = st.sill + (st.belt - st.sill) * 0.42;
  kit.both(onX(rrect(iz, iy, 0.22, 0.038, 0.014, 1), st.W / 2 + 0.007), dark);
}
