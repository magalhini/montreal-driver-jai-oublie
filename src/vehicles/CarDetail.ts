import * as THREE from 'three';
import type { CarDetail, CarStyle } from './Car';
import type { BodyProfile } from './BodyProfiles';
import { circle, disc, onX, prep, rbox, slice, strip, yAt } from './CarGeometry';
import { look, type Kit } from './CarKit';
import { AMBER, BLACK, CHROME, CHROME_C, GLOW, GOLD, MATTE, TRIM, WHITE, rgb } from './CarMaterial';

const archSpan = (st: BodyProfile): [number, number] => {
  const R = st.r + (st.arch?.[0] ?? 0.055);
  return [st.wr + R + 0.08, st.wf - R - 0.08];
};

/** Checker squares along both doors, sitting just proud of the skin. */
function checkers(kit: Kit, st: BodyProfile, y: number, h: number): void {
  const hw = st.W / 2;
  const [z0, z1] = archSpan(st);
  const n = Math.max(8, Math.round((z1 - z0) / 0.12));
  const step = (z1 - z0) / n;
  const dark = look(BLACK, MATTE);
  const light = look(WHITE);
  for (let i = 0; i < n; i++) {
    const a = z0 + step * i;
    kit.both(rbox(a, a + step * 0.92, y, y + h, hw + 0.006, hw + 0.016, 0.003, 0.002), i % 2 === 0 ? dark : light);
  }
}

/** Hired Crown: white roof, company stripe, door checkers and badge, mudflaps, a fender aerial. The roof sign is the sedan's. */
function addTaxi(kit: Kit, st: BodyProfile): void {
  const hw = st.W / 2;
  const hl = st.L / 2;
  const dark = look(BLACK, MATTE);
  const chrome = look(CHROME_C, CHROME);
  const green = look(rgb(0.04, 0.22, 0.09));
  const roof = [st.ws[1], ...st.roof, st.bl[0]];
  const top = Math.max(...roof.map((p) => p[1]));
  kit.add(strip(roof, -0.42, 0.42, 0.012), look(WHITE));
  checkers(kit, st, st.belt - 0.2, 0.075);
  const [z0, z1] = archSpan(st);
  kit.both(rbox(z0, z1, st.belt - 0.12, st.belt - 0.1, hw + 0.008, hw + 0.02, 0.004, 0.002), green);
  const bz = (st.doors[0] + (st.doors[1] ?? st.doors[0])) / 2;
  const by = st.belt - 0.28;
  kit.both(onX(circle(bz, by, 0.055), hw + 0.012), chrome);
  kit.both(onX(circle(bz, by, 0.036), hw + 0.016), dark);
  kit.both(rbox(bz - 0.01, bz + 0.01, by - 0.022, by + 0.022, hw + 0.014, hw + 0.022, 0.003, 0.002), look(GOLD, CHROME));
  const flapZ = st.wr - st.r - 0.12;
  kit.both(rbox(flapZ - 0.04, flapZ + 0.02, 0.1, 0.36, hw - 0.32, hw - 0.04, 0.01, 0.006), dark);
  const az = hl - 0.55;
  const ay = yAt([st.nose[st.nose.length - 1], ...st.hood], az);
  kit.add(prep(new THREE.CylinderGeometry(0.003, 0.005, 0.46, 5).translate(hw - 0.16, ay + 0.24, az)), dark);
  kit.both(rbox(-0.22, -0.08, top + 0.004, top + 0.028, 0.4, 0.52, 0.006, 0.003), look(AMBER, GLOW));
}

/** Metro cruiser: a push bar, steady corner lamps, a pillar spotlight, door badges and a second aerial. */
function addPatrol(kit: Kit, st: BodyProfile): void {
  const hw = st.W / 2;
  const hl = st.L / 2;
  const dark = look(BLACK, MATTE);
  const chrome = look(CHROME_C, CHROME);
  const steel = look(TRIM, MATTE);
  kit.add(rbox(hl + 0.05, hl + 0.14, 0.22, 0.36, -hw + 0.12, hw - 0.12, 0.018, 0.01), steel);
  kit.both(rbox(hl + 0.01, hl + 0.14, 0.22, 0.56, hw - 0.26, hw - 0.16, 0.014, 0.008), steel);
  kit.add(rbox(hl + 0.08, hl + 0.14, 0.5, 0.57, -hw + 0.22, hw - 0.22, 0.012, 0.006), steel);
  kit.add(rbox(hl - 0.02, hl + 0.045, 0.46, 0.54, hw - 0.34, hw - 0.18, 0.01, 0.005), look(rgb(0.75, 0.03, 0.02), GLOW));
  kit.add(rbox(hl - 0.02, hl + 0.045, 0.46, 0.54, -hw + 0.18, -hw + 0.34, 0.01, 0.005), look(rgb(0.08, 0.16, 0.75), GLOW));
  // Driver's spotlight on the side of the right A-pillar, behind the glass plane so the head
  // comes out of the pillar instead of sitting in front of the windshield.
  const [ws0, ws1] = st.ws;
  const along = 0.42;
  const vz = ws1[0] - ws0[0];
  const vy = ws1[1] - ws0[1];
  const vlen = Math.hypot(vz, vy);
  const gz = ws0[0] + vz * along + (vz / vlen) * 0.05;
  const gy = ws0[1] + vy * along - (vy / vlen) * 0.05;
  const roofTop = Math.max(ws1[1], st.bl[0][1], ...st.roof.map((p) => p[1]));
  const tumble = 1 + (st.tumble - 1) * THREE.MathUtils.clamp((gy - st.belt) / (roofTop - st.belt), 0, 1);
  const face = -(st.gW / 2) * tumble;
  kit.add(rbox(gz - 0.02, gz + 0.012, gy - 0.026, gy + 0.026, face - 0.075, face + 0.04, 0.014, 0.006), chrome);
  kit.add(disc(0.022, face - 0.04, gy, gz + 0.02, 1), look(rgb(0.95, 0.95, 0.88), GLOW));
  const bz = (st.doors[0] + (st.doors[1] ?? st.doors[0])) / 2;
  const by = st.belt - 0.22;
  kit.both(onX(circle(bz, by, 0.06), hw + 0.012), chrome);
  kit.both(onX(circle(bz, by, 0.04), hw + 0.016), dark);
  kit.both(rbox(bz - 0.012, bz + 0.012, by - 0.028, by + 0.028, hw + 0.014, hw + 0.022, 0.003, 0.002), look(GOLD, CHROME));
  const az = -hl + 0.45;
  const ay = yAt(st.deck, az);
  kit.add(prep(new THREE.CylinderGeometry(0.003, 0.005, 0.5, 4).translate(0.4, ay + 0.26, az)), dark);
}

/** Hood slots on the Karola, a rub strip and badge on the Mame. Traffic of the same shape leaves these off. */
function addDriver(kit: Kit, st: BodyProfile, style: CarStyle): void {
  const hw = st.W / 2;
  const dark = look(BLACK, MATTE);
  const chrome = look(CHROME_C, CHROME);
  if (style === 'coupe') {
    const slot = slice([st.nose[st.nose.length - 1], ...st.hood], st.hood[0][0] - 0.06, st.ws[0][0] + 0.4);
    for (const s of [-1, 1]) kit.add(strip(slot, s * 0.36, s * 0.48, 0.008), dark);
    const bz = st.wf - (st.r + (st.arch?.[0] ?? 0.055)) - 0.2;
    const by = st.belt - 0.18;
    kit.both(onX(circle(bz, by, 0.04, 10), hw + 0.009), chrome);
    kit.both(onX(circle(bz, by, 0.024, 8), hw + 0.012), dark);
  } else if (style === 'city') {
    const R = st.r + (st.arch?.[0] ?? 0.055);
    const z0 = st.wr + R + 0.06;
    const z1 = st.wf - R - 0.06;
    const y = st.sill + 0.09;
    kit.both(
      onX(
        [
          [z0, y - 0.006],
          [z1, y - 0.006],
          [z1, y + 0.006],
          [z0, y + 0.006],
        ],
        hw + 0.009,
      ),
      chrome,
    );
    const bz = (z0 + z1) / 2;
    kit.both(onX(circle(bz, y + 0.16, 0.034, 10), hw + 0.009), chrome);
    kit.both(onX(circle(bz, y + 0.16, 0.02, 8), hw + 0.012), look(rgb(0.72, 0.14, 0.12)));
  }
}

/** Livery and aero that traffic cars of the same silhouette do not get. */
export function addCarDetail(kit: Kit, st: BodyProfile, detail: CarDetail, style: CarStyle): void {
  if (detail === 'taxi') addTaxi(kit, st);
  else if (detail === 'patrol') addPatrol(kit, st);
  else if (detail === 'driver') addDriver(kit, st, style);
}
