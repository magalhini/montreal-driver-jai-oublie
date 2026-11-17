import * as THREE from 'three';
import type { CarDetail, CarStyle } from './Car';
import { addCarDetail } from './CarDetail';
import { BODY_BEVEL, BODY_BEVEL_P, CAB_BEVEL, CAB_BEVEL_P, PROFILES, type BodyProfile } from './BodyProfiles';
import { buildEnds } from './CarEnds';
import { clip, extrude, inset, lerp2, mirrorX, onX, onXGrid, prep, rbox, refineSides, rrect, shade, slice, strip, taper, warpArrays, warpGeo, yAt, type V2, type Warp3 } from './CarGeometry';
import { bake, Kit, lensGeo, look, type Base, type Look } from './CarKit';
import { AMBER, BLACK, CHROME, CHROME_C, GLASS, GLASS_C, GLOW, MATTE, POLICE_BLACK, rgb, TRIM, WHITE } from './CarMaterial';

export interface BaseParts {
  base: Base;
  front: THREE.BufferGeometry;
  rear: THREE.BufferGeometry;
  barL?: THREE.BufferGeometry;
  barR?: THREE.BufferGeometry;
  /** Roof lamp, separate so it can change between for-hire and hired. */
  sign?: THREE.BufferGeometry;
  headPos: [number, number, number][];
  tailPos: [number, number, number][];
  /** Number plates: center and facing (+1 front, -1 rear). */
  platePos: { at: [number, number, number]; dir: 1 | -1 }[];
}

const smooth01 = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Bell on [-1, 1] with a flat derivative at the peak and the ends. */
const bell = (u: number): number => (Math.abs(u) >= 1 ? 0 : smooth01(1 - Math.abs(u)));

type Round = NonNullable<BodyProfile['round']>;

/**
 * Plan-view rounding of the ends: past each end's wheel arch the corners pull back and the width narrows,
 * both growing with the square of the distance into the overhang. A vertex at the centerline stays put,
 * so the nose only curves once the body is split across its width.
 */
function endWarp(st: BodyProfile, R: number, round: Round): (x: number, z: number) => [number, number] {
  const hl = st.L / 2;
  const hw = st.W / 2;
  const zf0 = st.wf + R;
  const zr0 = st.wr - R;
  return (x, z) => {
    let t: number;
    let pull: number;
    let pinch: number;
    if (z > zf0) {
      t = Math.min(1, (z - zf0) / (hl - zf0));
      [pull, pinch] = round.front;
    } else if (z < zr0) {
      t = Math.min(1, (zr0 - z) / (zr0 + hl));
      [pull, pinch] = round.rear;
      pull = -pull;
    } else return [x, z];
    const u = Math.min(1.1, Math.abs(x) / hw);
    const t2 = t * t;
    return [x * (1 - pinch * t2), z - pull * u * u * t2];
  };
}

/** Mild end round for the player's cars whose profile doesn't carry one (coupe, sedan, the cruiser). */
function softRound(st: BodyProfile): Round {
  if (st.L < 4.35) return { front: [0.085, 0.04], rear: [0.07, 0.034] };
  return { front: [0.058, 0.026], rear: [0.046, 0.02] };
}

/**
 * Shape pass with no extra triangles: end round, a fender swell with a narrower waist between the axles,
 * a tucked rocker, and (on a body split across its width) a low crown on the hood and trunk.
 * The swell fades out above the belt so the glass, mirrors and stalks are left alone.
 */
function shapeWarp(st: BodyProfile, R: number, shaped: boolean): Warp3 {
  const spec = st.round ?? (shaped ? softRound(st) : undefined);
  const end = spec ? endWarp(st, R, spec) : null;
  const hw = st.W / 2;
  const bevel = st.bevel ?? BODY_BEVEL;
  const flare = st.flare ?? 0.011;
  const hood0 = st.ws[0][0];
  const hood1 = st.nose[st.nose.length - 1][0];
  const hoodY = st.ws[0][1];
  const hoodLen = hood1 - hood0;
  const crown = shaped ? Math.min(0.015, Math.max(0, hoodLen - 0.25) * 0.016) : 0;
  const deck0 = st.bl[1][0];
  const deck1 = st.deck[st.deck.length - 1][0];
  const deckLen = deck0 - deck1;
  const deckCrown = shaped ? Math.min(0.01, Math.max(0, deckLen - 0.4) * 0.014) : 0;
  const arches = [st.wr, st.wf];
  const reach = R * 1.15;
  return (x, y, z) => {
    let x1 = x;
    let z1 = z;
    if (end) [x1, z1] = end(x, z);
    const ax = Math.abs(x1);
    const sx = Math.sign(x1) || 1;
    const onto = smooth01((ax - (hw - bevel - 0.05)) / 0.06);
    const proud = smooth01((hw + 0.03 - ax) / 0.025);
    const belowBelt = smooth01((st.belt + 0.02 - y) / 0.03);
    const side = onto * proud * belowBelt;
    let bulge = 0;
    for (const wz of arches) bulge = Math.max(bulge, bell((z1 - wz) / reach));
    const span = st.wf - st.wr;
    const along = span > 0 ? (z1 - st.wr) / span : 0;
    const waist = along > 0 && along < 1 ? Math.sin(along * Math.PI) : 0;
    x1 += sx * side * flare * (bulge - waist * 0.45);
    const low = smooth01(1 - (y - st.sill) / 0.045);
    x1 -= sx * side * low * flare * 0.5;
    let y1 = y;
    if (crown > 0) {
      const u = hoodLen > 0.05 ? (z1 - hood0) / hoodLen : 0;
      const hump = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
      const across = smooth01(1 - ax / (hw * 0.95));
      // The hood falls toward the nose, so this reaches below the cowl instead of only the belt line.
      const top = smooth01((y - (hoodY - 0.22)) / 0.08) * smooth01((hoodY + 0.05 - y) / 0.035);
      y1 += hump * across * top * crown;
    }
    if (deckCrown > 0) {
      const u = deckLen > 0.05 ? (deck0 - z1) / deckLen : 0;
      const hump = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
      const across = smooth01(1 - Math.abs(x1) / (hw * 0.95));
      const top = smooth01((y - (st.belt - 0.06)) / 0.04) * smooth01((st.belt + 0.04 - y) / 0.03);
      y1 += hump * across * top * deckCrown;
    }
    return [x1, y1, z1];
  };
}

/** Flat decals every car gets: a belt gap, a filler flap, fender repeaters, a roof drip rail. A few dozen triangles. */
function addSkinDetails(kit: Kit, st: BodyProfile, style: CarStyle, hw: number, ghw: number, R: number, seam: Look, dark: Look, trim: Look): void {
  const yb = st.belt - 0.016;
  const bz0 = st.wr + R + 0.05;
  const bz1 = st.wf - R - 0.05;
  if (bz1 - bz0 > 0.35) {
    kit.both(
      onXGrid(
        [
          [bz0, yb],
          [bz1, yb],
          [bz1, yb + 0.006],
          [bz0, yb + 0.006],
        ],
        hw + 0.008,
        0.1,
      ),
      seam,
    );
  }
  const archBack = st.wr - R;
  const tailZ = Math.min(...st.tail.map((p) => p[0]));
  const room = archBack - tailZ;
  if (room > 0.18) {
    const fz = archBack - Math.min(0.15, room * 0.4);
    const fy = st.sill + (st.belt - st.sill) * 0.5;
    kit.add(onX(rrect(fz, fy, 0.1, 0.076, 0.016, 1), hw + 0.007), seam);
    kit.add(onX(rrect(fz, fy, 0.07, 0.05, 0.012, 1), hw + 0.01), dark);
  }
  const rz = Math.min(st.wf - R - 0.05, st.doors[0] - 0.08);
  if (rz > st.wr + R) {
    kit.both(onX(rrect(rz, st.belt - 0.12, 0.05, 0.024, 0.009, 1), hw + 0.008), look(AMBER, GLOW));
  }
  // Wagon already carries roof rails along this edge.
  if (style !== 'wagon') {
    const rail = ghw * st.tumble - 0.08;
    if (rail > 0.18) kit.both(strip([st.ws[1], ...st.roof, st.bl[0]], rail - 0.01, rail + 0.006, 0.005), trim);
  }
}

/** Shared geometry of one body style; paint is applied per color by paintBase(). */
export function buildBase(style: CarStyle, taxi: boolean, detail?: CarDetail): BaseParts {
  const st = PROFILES[style];
  const kit = new Kit();
  const hl = st.L / 2;
  const hw = st.W / 2;
  const police = style === 'police';
  const body = police ? look(POLICE_BLACK) : look(1);
  const upper = police ? look(WHITE) : body;
  const seam = police ? look(rgb(0.004, 0.004, 0.006), MATTE) : look(0.3, MATTE);
  const dark = look(BLACK, MATTE);
  const trim = look(TRIM, MATTE);
  const chrome = look(CHROME_C, CHROME);
  const glass = look(GLASS_C, GLASS);
  const brightTrim = style === 'coupe' || style === 'sedan' || style === 'city' ? chrome : trim;
  const heads: THREE.BufferGeometry[] = [];
  const tails: THREE.BufferGeometry[] = [];
  const headPos: [number, number, number][] = [];
  const tailPos: [number, number, number][] = [];
  const platePos: BaseParts['platePos'] = [];

  // The player's own bodies are split across the width, so the end round and the hood crown become a
  // curve instead of a flat face sliding back. Traffic keeps a single span: same outline, far fewer triangles.
  const shaped = style === 'sports' || detail === 'driver' || detail === 'taxi' || detail === 'patrol';
  // --- Lower body: side profile with wheel arches, extruded across the width ---
  const [archGap, archLift] = st.arch ?? [0.055, 0.015];
  const R = st.r + archGap;
  const cy = st.r + archLift;
  const arches = [st.wr, st.wf];
  const bottom: V2[] = [];
  for (const wz of arches) {
    const a = Math.asin((st.sill - cy) / R);
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const phi = Math.PI - a + (2 * a - Math.PI) * (i / n);
      bottom.push([wz + Math.cos(phi) * R, cy + Math.sin(phi) * R]);
    }
  }
  const lower = extrude([...st.nose, ...st.hood, ...st.deck, ...st.tail, ...bottom], st.W, BODY_BEVEL_P, st.bevel ?? BODY_BEVEL, 2, shaped ? 4 : 1);
  // Flat side polygons fold through the doors once the flare moves the outline. Give the skin interior points first.
  refineSides(lower, 0.18);
  kit.add(
    shade(lower),
    (c, n, cap) => {
      // arch tunnel plus the inner bevel ring (the outer ring stays paint as a rounded lip)
      if (!cap) for (const wz of arches) if (Math.hypot(c.z - wz, c.y - cy) < R + 0.025) return dark;
      if (n.y < -0.6) return dark;
      return body;
    },
    lower.cap,
  );
  // Wheel wells: dark blocks between the wheels so the arches don't show daylight
  for (const wz of arches) kit.add(prep(new THREE.BoxGeometry(st.W - 0.5, cy + R - st.sill + 0.02, R * 2).translate(0, (cy + R + st.sill) / 2 - 0.01, wz)), dark);

  // --- Greenhouse: roof + pillars in paint, glass as glossy panels on top ---
  const roofTop = Math.max(...st.roof.map((p) => p[1]), st.ws[1][1], st.bl[0][1]);
  const down = (p: V2, q: V2): V2 => {
    const t = 0.06 / (q[1] - p[1]);
    return [p[0] - (q[0] - p[0]) * t, p[1] - 0.06];
  };
  const gh: V2[] = [down(st.ws[0], st.ws[1]), st.ws[1], ...st.roof, st.bl[0], down(st.bl[1], st.bl[0])];
  const cab = extrude(gh, st.gW, CAB_BEVEL_P, CAB_BEVEL, 2);
  taper(cab.g, st.belt, roofTop, st.tumble);
  kit.add(shade(cab), upper);
  const cabDecal = (g: THREE.BufferGeometry, l: Look) => {
    taper(g, st.belt, roofTop, st.tumble);
    g.computeVertexNormals();
    kit.add(g, l);
  };
  // Side windows (clipped from the greenhouse outline, then inset to leave pillars)
  const ghw = st.gW / 2;
  for (const w of st.wins) {
    let poly = clip(gh, [0, st.belt], [1, st.belt]);
    if (w.front) poly = clip(poly, [w.front[1], roofTop], [w.front[0], st.belt]);
    if (w.rear) poly = clip(poly, [w.rear[0], st.belt], [w.rear[1], roofTop]);
    const surround = onX(inset(poly, st.winInset - 0.016), ghw + 0.003);
    const pane = onX(inset(poly, st.winInset), ghw + 0.006);
    for (const g of [surround, mirrorX(surround)]) cabDecal(g, brightTrim);
    for (const g of [pane, mirrorX(pane)]) cabDecal(g, glass);
  }
  // Windshield and rear window
  const panel = (a: V2, b: V2, t0: number, t1: number, side: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const hwG = ghw - CAB_BEVEL - side;
    cabDecal(strip([lerp2(a, b, (t0 - 0.018) / len), lerp2(a, b, 1 - (t1 - 0.018) / len)], -hwG - 0.018, hwG + 0.018, 0.003), brightTrim);
    cabDecal(strip([lerp2(a, b, t0 / len), lerp2(a, b, 1 - t1 / len)], -hwG, hwG, 0.006), glass);
  };
  panel(st.ws[0], st.ws[1], 0.04, 0.035, st.pillar);
  panel(st.bl[0], st.bl[1], 0.04, style === 'coupe' ? 0.16 : style === 'sports' ? 0.07 : 0.05, st.cPillar);
  // Wipers parked at the windshield base
  {
    const [a, b] = st.ws;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const seg = [lerp2(a, b, 0.07 / len), lerp2(a, b, 0.095 / len)];
    cabDecal(strip(seg, -ghw * 0.82, -0.06, 0.011), dark);
    cabDecal(strip(seg, 0.04, ghw * 0.72, 0.011), dark);
  }

  // --- Body side details ---
  const sx = hw + 0.003;
  const sideFlat0 = st.sill + 0.075;
  const sideFlat1 = st.belt - BODY_BEVEL_P - 0.012;
  if (police) {
    // Japanese patrol car: white doors over a black body
    const z0 = st.doors[0] + 0.05;
    const z1 = Math.max(st.doors[st.doors.length - 1] - 0.02, st.wr + R + 0.01);
    kit.both(
      onXGrid(
        [
          [z0, sideFlat0 + 0.01],
          [z0, sideFlat1 + 0.01],
          [z1, sideFlat1 + 0.01],
          [z1, sideFlat0 + 0.01],
        ],
        sx,
        0.1,
      ),
      look(WHITE),
    );
  }
  for (const z of st.doors) {
    kit.both(
      onX(
        [
          [z + 0.006, sideFlat0],
          [z + 0.006, sideFlat1],
          [z - 0.006, sideFlat1],
          [z - 0.006, sideFlat0],
        ],
        sx + 0.002,
      ),
      seam,
    );
  }
  for (const z of st.handles) {
    const y = st.belt - 0.085;
    kit.both(rbox(z - 0.06, z + 0.06, y - 0.012, y + 0.012, hw - 0.01, hw + 0.012, 0.01, 0.005), chrome);
  }
  // Side trim lines
  const archEnd = st.wf - R - 0.05;
  const archStart = st.wr + R + 0.05;
  if (style === 'coupe') {
    const y = st.sill + 0.1;
    kit.both(rbox(archStart, archEnd, y - 0.009, y + 0.009, hw - 0.01, hw + 0.009, 0.008, 0.004), chrome);
  } else if (style === 'sedan' || style === 'wagon' || style === 'kei') {
    const y = style === 'kei' ? 0.5 : 0.56;
    kit.both(rbox(archStart, archEnd, y - 0.025, y + 0.025, hw - 0.01, hw + 0.014, 0.012, 0.006), trim);
    if (style !== 'kei') kit.both(rbox(archStart + 0.02, archEnd - 0.02, y + 0.006, y + 0.014, hw + 0.01, hw + 0.018, 0.003, 0.002), chrome);
  } else if (style === 'city') {
    const y = st.belt - 0.045;
    kit.both(rbox(archStart, archEnd, y - 0.007, y + 0.007, hw - 0.008, hw + 0.01, 0.006, 0.003), chrome);
  }

  // --- Top seams: hood and trunk / hatch shut lines ---
  const top = [...st.hood];
  const hoodZ0 = st.ws[0][0] + 0.06;
  const seamX = hw - 0.14;
  for (const s of [-1, 1]) {
    const lineXs = s > 0 ? [seamX - 0.006, seamX + 0.006] : [-seamX - 0.006, -seamX + 0.006];
    kit.add(strip(slice([st.nose[st.nose.length - 1], ...top], hl - 0.08, hoodZ0), lineXs[0], lineXs[1], 0.003), seam);
  }
  kit.add(strip(slice(top, hoodZ0 + 0.006, hoodZ0 - 0.006), -seamX, seamX, 0.003), seam);
  if (style === 'coupe' || style === 'sports' || style === 'sedan' || style === 'police' || style === 'city') {
    const z0 = st.bl[1][0] - 0.05;
    const deck = [...st.deck];
    for (const s of [-1, 1]) {
      const xs = s > 0 ? [seamX - 0.006, seamX + 0.006] : [-seamX - 0.006, -seamX + 0.006];
      kit.add(strip(slice(deck, z0, deck[deck.length - 1][0] + 0.01), xs[0], xs[1], 0.003), seam);
    }
    kit.add(strip(slice(deck, z0 + 0.006, z0 - 0.006), -seamX, seamX, 0.003), seam);
  }

  // --- Mirrors ---
  if (style === 'sports') {
    // Small body-color door mirrors on black stalks, at the front corner of the door glass
    const z = st.ws[0][0] - 0.2;
    const y = st.belt + 0.09;
    kit.both(rbox(z - 0.045, z + 0.06, y - 0.04, y + 0.035, hw + 0.03, hw + 0.13, 0.03, 0.012), body);
    kit.both(rbox(z - 0.05, z + 0.055, y - 0.035, y + 0.0, hw - 0.06, hw + 0.04, 0.012, 0.006), dark);
    // The glass, facing back at the driver
    kit.both(rbox(z - 0.052, z - 0.04, y - 0.032, y + 0.027, hw + 0.04, hw + 0.12, 0.004, 0.002), glass);
  } else if (style === 'coupe' || style === 'wagon') {
    const z = st.ws[0][0] - 0.16;
    const y = st.belt + 0.07;
    const m = style === 'coupe' ? chrome : trim;
    kit.both(rbox(z - 0.05, z + 0.05, y - 0.035, y + 0.035, hw + 0.02, hw + 0.13, 0.025, 0.01), m);
    kit.both(prep(new THREE.BoxGeometry(0.05, 0.03, 0.03).translate(hw + 0.0, y - 0.02, z)), m);
    kit.both(rbox(z - 0.057, z - 0.045, y - 0.027, y + 0.027, hw + 0.03, hw + 0.12, 0.004, 0.002), glass);
  } else if (style === 'city') {
    // Small chrome mirrors on the front fenders, just ahead of the cowl
    const z = 1.12;
    const y = yAt([st.nose[st.nose.length - 1], ...st.hood], z);
    const x = hw - 0.08;
    kit.both(prep(new THREE.BoxGeometry(0.014, 0.09, 0.014).translate(x, y + 0.04, z)), trim);
    kit.both(rbox(z - 0.022, z + 0.028, y + 0.075, y + 0.12, x - 0.028, x + 0.028, 0.014, 0.006), chrome);
  } else {
    // Fender mirrors, as on Japanese cars of the era
    const z = hl - (style === 'kei' ? 0.42 : 0.62);
    const y = yAt([st.nose[st.nose.length - 1], ...st.hood], z);
    const x = hw - 0.13;
    const m = style === 'kei' ? chrome : trim;
    kit.both(prep(new THREE.BoxGeometry(0.016, 0.12, 0.016).translate(x, y + 0.05, z)), trim);
    kit.both(rbox(z - 0.03, z + 0.035, y + 0.09, y + 0.15, x - 0.035, x + 0.035, 0.02, 0.008), m);
  }

  addSkinDetails(kit, st, style, hw, ghw, R, seam, dark, trim);

  // --- Front and rear ends ---
  buildEnds({ kit, st, style, taxi, police, hl, hw, ghw, body, seam, dark, trim, chrome, heads, tails, headPos, tailPos, platePos });

  // --- Roof furniture ---
  const roofPts = [st.ws[1], ...st.roof, st.bl[0]];
  let barL: THREE.BufferGeometry | undefined;
  let barR: THREE.BufferGeometry | undefined;
  if (police) {
    const zc = -0.35;
    const y = yAt(roofPts, zc) - 0.01;
    kit.add(rbox(zc - 0.14, zc + 0.14, y, y + 0.06, -0.6, 0.6, 0.02, 0.01), dark);
    kit.add(rbox(zc - 0.1, zc + 0.1, y + 0.05, y + 0.15, -0.05, 0.05, 0.02, 0.01), trim);
    barL = rbox(zc - 0.12, zc + 0.12, y + 0.05, y + 0.17, 0.04, 0.56, 0.045, 0.02);
    barR = rbox(zc - 0.12, zc + 0.12, y + 0.05, y + 0.17, -0.56, -0.04, 0.045, 0.02);
    // whip antenna on the trunk
    kit.add(prep(new THREE.CylinderGeometry(0.004, 0.006, 0.6, 4).translate(-0.55, yAt(st.deck, -2.0) + 0.3, -2.0)), dark);
  }
  let sign: THREE.BufferGeometry | undefined;
  if (taxi) {
    const zc = -0.05;
    const y = yAt(roofPts, zc) - 0.01;
    kit.add(rbox(zc - 0.075, zc + 0.075, y, y + 0.04, -0.17, 0.17, 0.015, 0.008), dark);
    const shape = new THREE.Shape([new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0.11, 0.12), new THREE.Vector2(-0.11, 0.12)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelOffset: -0.012, bevelSegments: 1 });
    g.translate(0, y + 0.035, zc - 0.035);
    // Own mesh: amber while the cab is for hire, red once a fare is aboard (`CarView`).
    sign = lensGeo([prep(g)]);
  }
  if (detail && detail !== 'work') addCarDetail(kit, st, detail, style);
  const w = shapeWarp(st, R, shaped);
  warpArrays(kit.pos, kit.nrm, w);
  for (const g of [...heads, ...tails]) warpGeo(g, w);
  for (const p of [...headPos, ...tailPos, ...platePos.map((q) => q.at)]) {
    const n = w(p[0], p[1], p[2]);
    p[0] = n[0];
    p[1] = n[1];
    p[2] = n[2];
  }

  const strip0 = (g?: THREE.BufferGeometry) => (g ? lensGeo([g]) : undefined);
  return {
    base: bake(kit),
    front: lensGeo(heads),
    rear: lensGeo(tails),
    barL: strip0(barL),
    barR: strip0(barR),
    sign,
    headPos,
    tailPos,
    platePos,
  };
}
