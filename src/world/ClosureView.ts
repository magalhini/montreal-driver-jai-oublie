import * as THREE from 'three';
import { Rng } from '../core/Rng';
import type { ClosureSign, Closures, Fence, HardClosure, LaneMerge } from '../gameplay/Closures';
import type { Vec2 } from '../types';
import { coneGeometry } from './ConeView';
import type { CityModel } from './RoadGraph';

/**
 * Rue barrée, built (PRD 3, 5.3, 5.8; `inspo/rue-barre*`, `detour-rue-barree`, `montreal-construction`):
 * orange-and-white striped rail barricades on black rubber feet across the street, square orange boards
 * hung on them (RUE BARRÉE, DÉTOUR with an arrow and the cross street's name, CIRCULATION LOCALE SEULEMENT,
 * VOIE BARRÉE), mesh fence panels with a pink scrim over the sidewalks, and behind them the work: a yellow
 * excavator in a cut, a gravel pile or a trench, sometimes a worker in an orange vest. Static and instanced (the
 * tiling culls it); the colliders are the sim's (`Closures.colliders`).
 */
const ORANGE = '#f6621a';
const INK = '#141210';
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Bold condensed type, squeezed to `maxW`. */
function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, maxW: number): void {
  g.font = `bold ${size}px ${FONT}`;
  const w = g.measureText(s).width;
  g.save();
  g.translate(x, y);
  // Highway signs read narrow: always a little condensed, more if needed
  g.scale(Math.min(0.86, maxW / w), 1);
  g.fillText(s, 0, 0);
  g.restore();
}

function board(g: CanvasRenderingContext2D, W: number, H: number): void {
  g.fillStyle = ORANGE;
  g.fillRect(0, 0, W, H);
  // Scuffs and the reflective sheeting's grain
  const r = new Rng(W * 7 + H);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = r.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(80,30,0,0.06)';
    g.fillRect(r.range(0, W), r.range(0, H), r.range(2, 18), r.range(1, 3));
  }
  g.strokeStyle = INK;
  g.lineWidth = Math.round(W * 0.03);
  const m = W * 0.05;
  const rad = W * 0.05;
  g.beginPath();
  g.roundRect(m, m, W - 2 * m, H - 2 * m, rad);
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
}

function arrow(g: CanvasRenderingContext2D, cx: number, cy: number, len: number, dir: 1 | -1): void {
  const hl = len / 2;
  const head = len * 0.32;
  const shaft = len * 0.09;
  const hw = len * 0.2;
  g.beginPath();
  g.moveTo(cx + dir * hl, cy);
  g.lineTo(cx + dir * (hl - head), cy - hw);
  g.lineTo(cx + dir * (hl - head), cy - shaft);
  g.lineTo(cx - dir * hl, cy - shaft);
  g.lineTo(cx - dir * hl, cy + shaft);
  g.lineTo(cx + dir * (hl - head), cy + shaft);
  g.lineTo(cx + dir * (hl - head), cy + hw);
  g.closePath();
  g.fill();
}

/** The square boards (512 px square). */
export function closureSignTexture(kind: ClosureSign): THREE.CanvasTexture {
  return canvasTex(512, 512, (g) => {
    board(g, 512, 512);
    const W = 400;
    switch (kind) {
      case 'rueBarree':
      case 'voieBarree':
        text(g, kind === 'rueBarree' ? 'RUE' : 'VOIE', 256, 180, 150, W);
        text(g, 'BARRÉE', 256, 340, 150, W);
        break;
      case 'locale':
        text(g, 'CIRCULATION', 256, 150, 96, W);
        text(g, 'LOCALE', 256, 258, 96, W);
        text(g, 'SEULEMENT', 256, 366, 96, W);
        break;
      case 'detourLeft':
      case 'detourRight':
        text(g, 'DÉTOUR', 256, 165, 130, W);
        arrow(g, 256, 330, 330, kind === 'detourLeft' ? -1 : 1);
        break;
    }
  });
}

/** The tab under a DÉTOUR board with the street it sends you to ("STE-CATHERINE"), 512 x 176. */
export function detourTabTexture(name: string): THREE.CanvasTexture {
  const short = name
    .toUpperCase()
    .replace(/^SAINTE-/, 'STE-')
    .replace(/^SAINT-/, 'ST-');
  return canvasTex(512, 176, (g) => {
    board(g, 512, 176);
    text(g, short, 256, 92, 92, 420);
  });
}

/**
 * The orange "lane ends" diamond (MUTCD W4-2 style, as Quebec uses it): a solid line on the side that stays,
 * the closing edge bending in from the other side with a dashed lane line ending where it meets. `side`: the
 * way traffic moves over ('left' = the right lane ends). 512 px square, transparent outside the diamond.
 */
export function laneEndsTexture(side: 'left' | 'right'): THREE.CanvasTexture {
  return canvasTex(512, 512, (g) => {
    if (side === 'right') {
      g.translate(512, 0);
      g.scale(-1, 1);
    }
    const dia = (r: number) => {
      g.beginPath();
      g.moveTo(256, 256 - r);
      g.lineTo(256 + r, 256);
      g.lineTo(256, 256 + r);
      g.lineTo(256 - r, 256);
      g.closePath();
    };
    g.fillStyle = INK;
    dia(250);
    g.fill();
    g.fillStyle = ORANGE;
    dia(236);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 9;
    g.lineJoin = 'round';
    dia(214);
    g.stroke();
    g.fillStyle = INK;
    // The line that stays (left)
    g.fillRect(182, 140, 30, 236);
    // The closing edge (right): straight at the bottom, bending in to the left, straight on up
    g.beginPath();
    g.moveTo(306, 376);
    g.lineTo(336, 376);
    g.lineTo(336, 262);
    g.lineTo(292, 210);
    g.lineTo(292, 140);
    g.lineTo(262, 140);
    g.lineTo(262, 222);
    g.lineTo(306, 274);
    g.closePath();
    g.fill();
    // The dashed lane line between them, ending at the bend
    for (const y of [258, 300, 342]) g.fillRect(250, y, 16, 26);
  });
}

/** Orange and white blocks for the rails (2.4 m: eight blocks). */
function stripeTexture(): THREE.CanvasTexture {
  return canvasTex(512, 64, (g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f2f0ea' : ORANGE;
      g.fillRect(i * 64, 0, 64, 64);
    }
    const r = new Rng(11);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(60,40,30,${r.range(0.05, 0.25)})`;
      g.fillRect(r.range(0, 512), r.range(0, 64), r.range(2, 20), r.range(1, 4));
    }
  });
}

/** Wire grid of the fence panels (alpha). */
function meshTexture(): THREE.CanvasTexture {
  const t = canvasTex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(200,204,208,1)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, 64, 64);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 8);
  return t;
}

/** Instance lists per geometry + material, turned into InstancedMeshes at the end. */
class Batches {
  private readonly lists = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; m: THREE.Matrix4[]; shadow: boolean }>();
  add(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, shadow = true): void {
    let l = this.lists.get(key);
    if (!l) this.lists.set(key, (l = { geo, mat, m: [], shadow }));
    l.m.push(m);
  }
  build(scene: THREE.Scene): void {
    for (const l of this.lists.values()) {
      const im = new THREE.InstancedMesh(l.geo, l.mat, l.m.length);
      l.m.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = l.shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    }
  }
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
/** A unit box with its base at y = 0. */
const footBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const plane = new THREE.PlaneGeometry(1, 1);

/** A frame (local z along a road) tilted to the road's grade between two heights `run` m apart. */
function pitched(m: THREE.Matrix4, y0: number, y1: number, run: number): THREE.Matrix4 {
  return m.multiply(new THREE.Matrix4().makeRotationX(-Math.atan2(y1 - y0, run)));
}

/** World matrix for a frame at `o` with local x = `u` (along), y up, z = `n` (facing). */
function frameMatrix(o: Vec2, y: number, u: Vec2, n: Vec2): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(u.x, 0, u.z), new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, 0, n.z)).setPosition(o.x, y, o.z);
}

const local = (base: THREE.Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0): THREE.Matrix4 =>
  base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(sx, sy, sz)));

export function buildClosures(city: CityModel, closures: Closures, scene: THREE.Scene): void {
  const rng = new Rng(closures.salt ^ 0x5157);
  const b = new Batches();
  const std = (color: number, roughness = 0.75, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const M = {
    rail: new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.6 }),
    rubber: std(0x151515, 0.9),
    post: std(0x3c4a63, 0.5, 0.4),
    steel: std(0x9aa0a6, 0.45, 0.6),
    mesh: new THREE.MeshStandardMaterial({ map: meshTexture(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 }),
    scrim: new THREE.MeshStandardMaterial({ color: 0xe7a6b8, roughness: 0.9, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
    concrete: std(0xb4b1aa, 0.95),
    signBack: std(0x8a8d90, 0.6, 0.3),
    yellow: std(0xf0b81c, 0.55, 0.1),
    dark: std(0x2a2a2c, 0.8),
    glass: std(0x1c242c, 0.15, 0.5),
    gravel: std(0x8f8c86, 1),
    dirt: std(0x4a3d32, 1),
    cut: new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3 }),
    vest: std(0xff6a12, 0.7),
    khaki: std(0x6f6956, 0.9),
    skin: std(0xc89a7c, 0.8),
    hat: std(0xf4f4f0, 0.4),
    cone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
  };
  const signMats = new Map<ClosureSign, THREE.Material>();
  const signMat = (k: ClosureSign) => {
    let m = signMats.get(k);
    if (!m) signMats.set(k, (m = new THREE.MeshStandardMaterial({ map: closureSignTexture(k), roughness: 0.5 })));
    return m;
  };
  const tabMats = new Map<string, THREE.Material>();
  const tabMat = (name: string) => {
    let m = tabMats.get(name);
    if (!m) tabMats.set(name, (m = new THREE.MeshStandardMaterial({ map: detourTabTexture(name), roughness: 0.5 })));
    return m;
  };
  const gravelGeo = new THREE.ConeGeometry(1, 1, 9, 2);
  gravelGeo.translate(0, 0.5, 0);
  const hatGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const headGeo = new THREE.SphereGeometry(1, 10, 8);
  const drum = coneGeometry();
  const Y = (p: Vec2) => city.terrain.surfaceY(p.x, p.z);

  for (const h of closures.hard) {
    for (const [k, f] of h.fences.entries()) buildFence(f, k === 0 ? h.lat1 : h.lat0, k === 0 ? h.lat0 : h.lat1);
    buildWork(h, h.fences[0]);
  }
  // A DÉTOUR board on a stand at the curb end of some cone lines (no fence behind it)
  for (const l of closures.lines) {
    if (!l.board) continue;
    const { pos, facing } = l.board;
    const base = frameMatrix(pos, Y(pos), { x: facing.z, z: -facing.x }, facing);
    b.add(`sign:${l.board.left ? 'detourLeft' : 'detourRight'}`, plane, signMat(l.board.left ? 'detourLeft' : 'detourRight'), local(base, 0, 1.15, 0.05, 0.8, 0.8, 1));
    b.add('signBack', plane, M.signBack, local(base, 0, 1.15, 0.035, 0.8, 0.8, 1, 0, Math.PI));
    for (const x of [-0.3, 0.3]) {
      b.add('post', unitBox, M.post, local(base, x, 0.6, 0, 0.05, 1.2, 0.05));
      b.add('foot', footBox, M.rubber, local(base, x, 0, 0, 0.3, 0.1, 0.6));
    }
  }

  /** One barricade line: rails over the road part, mesh panels over the sidewalks, the boards on the rails. */
  function buildFence(f: Fence, latA: number, latB: number): void {
    const W = Math.hypot(f.b.x - f.a.x, f.b.z - f.a.z);
    const u = { x: (f.b.x - f.a.x) / W, z: (f.b.z - f.a.z) / W };
    const xOf = (lat: number) => ((lat - latA) / (latB - latA)) * W;
    const at = (x: number): Vec2 => ({ x: f.a.x + u.x * x, z: f.a.z + u.z * x });
    const span = (lat0: number, lat1: number): [number, number] => {
      const x0 = xOf(lat0);
      const x1 = xOf(lat1);
      return [Math.min(x0, x1), Math.max(x0, x1)];
    };
    // Rails: units of about 2.4 m, posts at each end, feet on the ground
    const [r0, r1] = span(f.road[0], f.road[1]);
    const n = Math.max(1, Math.round((r1 - r0) / 2.4));
    const w = (r1 - r0) / n;
    for (let i = 0; i < n; i++) {
      const c = at(r0 + w * (i + 0.5));
      const base = frameMatrix(c, Y(c), u, f.facing);
      for (const y of [0.95, 1.5]) b.add('rail', unitBox, M.rail, local(base, 0, y, 0.04, w - 0.05, 0.2, 0.045));
      for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) {
        b.add('post', unitBox, M.post, local(base, x, 0.85, -0.02, 0.06, 1.7, 0.06));
        b.add('foot', footBox, M.rubber, local(base, x, 0, -0.02, 0.38, 0.13, 0.75));
      }
    }
    // Mesh panels over the sidewalks
    for (const walk of f.walks) {
      const [w0, w1] = span(walk[0], walk[1]);
      const k = Math.max(1, Math.round((w1 - w0) / 3));
      const pw = (w1 - w0) / k;
      for (let i = 0; i < k; i++) {
        const c = at(w0 + pw * (i + 0.5));
        const base = frameMatrix(c, Y(c), u, f.facing);
        b.add('mesh', plane, M.mesh, local(base, 0, 1.05, 0, pw - 0.1, 1.9, 1), false);
        b.add('scrim', plane, M.scrim, local(base, 0, 0.75, 0.02, pw - 0.15, 1.1, 1), false);
        b.add('frame', unitBox, M.steel, local(base, 0, 2.0, 0, pw - 0.05, 0.05, 0.05));
        for (const x of [-pw / 2 + 0.05, pw / 2 - 0.05]) {
          b.add('frame', unitBox, M.steel, local(base, x, 1.0, 0, 0.05, 2.0, 0.05));
          b.add('block', footBox, M.concrete, local(base, x, 0, 0, 0.22, 0.14, 0.6));
        }
      }
    }
    // Boards: spread over the road part, hung on the front of the rails
    const signs = f.signs;
    signs.forEach((kind, i) => {
      const x = r0 + ((r1 - r0) * (i + 1)) / (signs.length + 1);
      const c = at(x);
      const base = frameMatrix(c, Y(c), u, f.facing);
      const tab = (kind === 'detourLeft' || kind === 'detourRight') && f.detourName;
      // Bigger than the real 0.75 m boards: they have to read from the driver's seat at street speed
      const S = 1.05;
      const y = tab ? 1.75 : 1.55;
      b.add(`sign:${kind}`, plane, signMat(kind), local(base, 0, y, 0.1, S, S, 1));
      b.add('signBack', plane, M.signBack, local(base, 0, y, 0.085, S, S, 1, 0, Math.PI));
      if (tab) {
        const ty = y - S / 2 - 0.2;
        b.add(`tab:${f.detourName}`, plane, tabMat(f.detourName!), local(base, 0, ty, 0.1, S, S * 0.344, 1));
        b.add('signBack', plane, M.signBack, local(base, 0, ty, 0.085, S, S * 0.344, 1, 0, Math.PI));
      }
    });
  }

  /** What is behind the fences: the cut road, then a machine, a pile or a trench, maybe a worker. */
  function buildWork(h: HardClosure, front: Fence): void {
    const e = city.edges[h.edge];
    const len = h.s1 - h.s0;
    // The zone's road part in edge lateral (both fences share it)
    const [l0, l1] = front.road;
    const t = h.dir;
    const left = { x: t.z, z: -t.x };
    const p0 = e.pts[0];
    const at = (s: number, lat: number): Vec2 => ({ x: p0.x + t.x * s + left.x * lat, z: p0.z + t.z * s + left.z * lat });
    const sMid = (h.s0 + h.s1) / 2;
    const latMid = (l0 + l1) / 2;
    const c = at(sMid, latMid);
    // Ground frame: local x = + lateral (left of a -> b), z = along the edge, tilted to the street's grade
    const g = pitched(frameMatrix(c, Y(c), left, t), Y(at(h.s0, latMid)), Y(at(h.s1, latMid)), len);
    // Torn-up road: a dark cut over most of the road part
    b.add('cut', footBox, M.cut, local(g, 0, 0.005, 0, Math.abs(l1 - l0) - 0.8, 0.02, len - 1.4), false);
    const room = Math.abs(l1 - l0);
    const side = rng.sign();
    if (h.dressing === 'excavator') {
      const ex = side * Math.max(0, room / 2 - 2.2);
      const yaw = rng.range(-0.5, 0.5) + (rng.chance(0.5) ? Math.PI : 0);
      const base = local(g, ex, 0, rng.range(-1, 1), 1, 1, 1, 0, yaw);
      excavator(base);
      // The trench it is digging, and the spoil
      b.add('dirt', footBox, M.dirt, local(g, -ex * 0.4, 0, 0, 1.4, 0.03, len - 3), false);
      b.add('gravel', gravelGeo, M.dirt, local(g, -side * Math.max(0, room / 2 - 1.6), 0, rng.range(-2, 2), 1.4, 0.9, 1.8));
    } else if (h.dressing === 'gravel') {
      b.add('gravel', gravelGeo, M.gravel, local(g, side * rng.range(0, room / 4), 0, rng.range(-1.5, 1.5), Math.min(3.2, room / 3), 1.4, Math.min(3.5, len / 3), 0, rng.range(0, 3)));
      b.add('gravel', gravelGeo, M.gravel, local(g, -side * room / 4, 0, rng.range(-2, 2), 1.6, 0.8, 1.9, 0, rng.range(0, 3)));
    } else {
      // A trench down the middle with concrete barriers along it
      b.add('dirt', footBox, M.dirt, local(g, 0, 0, 0, 1.6, 0.03, len - 2), false);
      for (const sx of [-1.4, 1.4]) for (let z = -len / 2 + 2; z < len / 2 - 1.5; z += 3.1) b.add('jersey', footBox, M.concrete, local(g, sx, 0, z + 1.5, 0.55, 0.8, 3));
      b.add('gravel', gravelGeo, M.dirt, local(g, side * Math.max(0, room / 2 - 1.5), 0, 0, 1.2, 0.8, 2.2));
    }
    // A drum or two inside, and the worker
    for (let i = rng.int(1, 3); i > 0; i--) b.add('drum', drum, M.cone, local(g, rng.range(-room / 2 + 0.6, room / 2 - 0.6), 0, rng.range(-len / 2 + 1, len / 2 - 1), 1, 1, 1, 0, rng.range(0, 6)));
    if (h.worker) {
      const wp = local(g, rng.range(-room / 3, room / 3), 0, (rng.chance(0.5) ? 1 : -1) * (len / 2 - 2), 1, 1, 1, 0, rng.range(0, 6.28));
      for (const lx of [-0.11, 0.11]) b.add('khaki', unitBox, M.khaki, local(wp, lx, 0.43, 0, 0.17, 0.86, 0.2));
      b.add('vest', unitBox, M.vest, local(wp, 0, 1.17, 0, 0.46, 0.62, 0.28));
      for (const lx of [-0.29, 0.29]) b.add('vest', unitBox, M.vest, local(wp, lx, 1.13, 0, 0.11, 0.55, 0.13));
      b.add('skin', headGeo, M.skin, local(wp, 0, 1.6, 0, 0.12, 0.13, 0.12));
      b.add('hat', hatGeo, M.hat, local(wp, 0, 1.66, 0, 0.15, 0.1, 0.15));
    }
    // The barrier run along the centre on a one-direction closure
    if (h.spine) {
      const sp = h.spine;
      const L = Math.hypot(sp.b.x - sp.a.x, sp.b.z - sp.a.z);
      const k = Math.max(1, Math.round(L / 3));
      for (let i = 0; i < k; i++) {
        const q = { x: sp.a.x + ((sp.b.x - sp.a.x) * (i + 0.5)) / k, z: sp.a.z + ((sp.b.z - sp.a.z) * (i + 0.5)) / k };
        const m = pitched(frameMatrix(q, Y(q), left, t), Y(sp.a), Y(sp.b), L);
        b.add('jersey', footBox, M.concrete, local(m, 0, 0, 0, 0.6, 0.82, L / k - 0.08));
      }
    }
  }

  /** Yellow tracked excavator, boom up and the bucket down in the cut. Local +z is its front. */
  function excavator(base: THREE.Matrix4): void {
    for (const x of [-1.1, 1.1]) {
      b.add('dark', footBox, M.dark, local(base, x, 0, 0, 0.6, 0.75, 3.6));
      b.add('yellow', unitBox, M.yellow, local(base, x, 0.6, 0, 0.5, 0.08, 3.3));
    }
    b.add('dark', footBox, M.dark, local(base, 0, 0.75, 0, 1.4, 0.25, 1.4));
    b.add('yellow', footBox, M.yellow, local(base, 0, 1.0, -0.2, 2.5, 0.95, 2.7));
    b.add('yellow', footBox, M.yellow, local(base, 0, 1.2, -1.5, 2.4, 0.85, 0.6));
    // Cab on the left, glass all round
    b.add('yellow', footBox, M.yellow, local(base, -0.65, 1.95, 0.35, 1.05, 1.4, 1.25));
    b.add('glass', footBox, M.glass, local(base, -0.65, 2.15, 0.35, 1.08, 1.0, 1.15));
    // Boom up and out, stick down, bucket at the bottom
    const boomL = 3.4;
    const boomA = -0.75; // pitched up
    const pivot = local(base, 0.45, 1.75, 0.9, 1, 1, 1, boomA);
    b.add('yellow', unitBox, M.yellow, local(pivot, 0, 0, boomL / 2, 0.38, 0.5, boomL));
    const tip = local(pivot, 0, 0, boomL, 1, 1, 1, 1.9);
    const stickL = 3.4;
    b.add('yellow', unitBox, M.yellow, local(tip, 0, 0, stickL / 2, 0.3, 0.42, stickL));
    b.add('dark', unitBox, M.dark, local(tip, 0, -0.1, stickL + 0.25, 0.95, 0.65, 0.7));
  }

  // Lane merges: the diamonds ahead, then the obstacle in the closed lane
  const diamonds = new Map<string, THREE.Material>();
  const diamondMat = (side: 'left' | 'right') => {
    let m = diamonds.get(side);
    if (!m) diamonds.set(side, (m = new THREE.MeshStandardMaterial({ map: laneEndsTexture(side), roughness: 0.5, alphaTest: 0.5 })));
    return m;
  };
  const diamondBack = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.6, metalness: 0.3, alphaTest: 0.5, map: laneEndsTexture('left') });
  diamondBack.color.setScalar(0.25);
  for (const m of closures.merges) {
    for (const sg of m.signs) {
      const base = frameMatrix(sg.pos, Y(sg.pos), { x: sg.facing.z, z: -sg.facing.x }, sg.facing);
      // A 0.9 m square turned on its corner, on a post with a rubber foot
      const D = 1.25;
      b.add(`diamond:${m.side}`, plane, diamondMat(m.side), local(base, 0, 2.0, 0.05, D, D, 1));
      b.add('diamondBack', plane, diamondBack, local(base, 0, 2.0, 0.035, D, D, 1, 0, Math.PI));
      b.add('post', unitBox, M.post, local(base, 0, 1.0, 0, 0.07, 2.0, 0.07));
      b.add('foot', footBox, M.rubber, local(base, 0, 0, 0, 0.5, 0.12, 0.8));
    }
    buildMergeBlock(m);
  }

  /** The hard obstacle a merge leads up to: a machine behind barriers, or a barricaded block of torn-up road. */
  function buildMergeBlock(m: LaneMerge): void {
    const e = city.edges[m.edge];
    const p0 = e.pts[0];
    const p1 = e.pts[e.pts.length - 1];
    const L = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    const t = { x: (p1.x - p0.x) / L, z: (p1.z - p0.z) / L };
    const left = { x: t.z, z: -t.x };
    const at = (s: number, lat: number): Vec2 => ({ x: p0.x + t.x * s + left.x * lat, z: p0.z + t.z * s + left.z * lat });
    const len = m.s1 - m.s0;
    const width = m.lat1 - m.lat0;
    const c = at((m.s0 + m.s1) / 2, (m.lat0 + m.lat1) / 2);
    const latC = (m.lat0 + m.lat1) / 2;
    const g = pitched(frameMatrix(c, Y(c), left, t), Y(at(m.s0, latC)), Y(at(m.s1, latC)), len);
    const ab = m.dir.x * t.x + m.dir.z * t.z > 0;
    // Which side of the box faces the open lane (the merge moves toward it)
    const openX = m.open - (m.lat0 + m.lat1) / 2;
    const inward = -Math.sign(openX);
    b.add('cut', footBox, M.cut, local(g, 0, 0.005, 0, width - 0.3, 0.02, len - 0.6), false);
    // Barriers along the open side (and across both ends on the machine block)
    const k = Math.max(1, Math.round(len / 3));
    for (let i = 0; i < k; i++) b.add('jersey', footBox, M.concrete, local(g, openX + inward * 0.3, 0, -len / 2 + (len * (i + 0.5)) / k, 0.6, 0.82, len / k - 0.08));
    const frontZ = (ab ? -1 : 1) * (len / 2);
    if (m.kind === 'machine') {
      const yaw = ab ? 0 : Math.PI;
      excavator(local(g, inward * Math.max(0, width / 2 - 1.6), 0, 0, 1, 1, 1, 0, yaw + rng.range(-0.15, 0.15)));
      const w2 = width - 0.6;
      for (const z of [frontZ, -frontZ]) b.add('jersey', footBox, M.concrete, local(g, 0, 0, z - Math.sign(z) * 0.3, w2, 0.82, 0.6));
      for (let i = rng.int(1, 2); i > 0; i--) b.add('drum', drum, M.cone, local(g, rng.range(-width / 2 + 0.5, width / 2 - 0.5), 0, frontZ - Math.sign(frontZ) * 0.9, 1, 1, 1));
    } else {
      // Rails across the front and the back, facing out, a board on the front; gravel inside
      const sFront = ab ? m.s0 : m.s1;
      const sBack = ab ? m.s1 : m.s0;
      const dir = m.dir;
      for (const [sv, facing, signs] of [
        [sFront, { x: -dir.x, z: -dir.z }, [rng.chance(0.5) ? 'rueBarree' : 'voieBarree'] as ClosureSign[]],
        [sBack, dir, [] as ClosureSign[]],
      ] as const) {
        // Viewer facing the rails looks against `facing`: their left is +lat when looking along +t
        const looksAlongT = -(facing.x * t.x + facing.z * t.z) > 0;
        const latA = looksAlongT ? m.lat1 : m.lat0;
        const latB = looksAlongT ? m.lat0 : m.lat1;
        buildFence({ a: at(sv, latA), b: at(sv, latB), facing, road: [m.lat0, m.lat1], walks: [], signs: [...signs], detourName: null }, latA, latB);
      }
      b.add('gravel', gravelGeo, M.gravel, local(g, 0, 0, 0, Math.min(2.2, width / 2.2), 1.1, Math.min(3, len / 3), 0, rng.range(0, 3)));
    }
  }

  b.build(scene);
}
