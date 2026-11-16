import * as THREE from 'three';
import type { AABB, Vec2 } from '../types';
import { AVIATION } from './BuildingDetails';
import { DEPOT, type DepotGate } from './Depot';
import { arrowTexture, lobbyTexture, signTexture } from './SignTextures';
import type { CityModel } from './RoadGraph';
import { SurfaceBuilder } from './SurfaceBuilder';
import { sharedGlow } from './textures';

type M = THREE.Matrix4;

/** Instanced unit boxes, one material, optional per-instance colors. */
class Boxes {
  private mats: M[] = [];
  private cols: THREE.Color[] = [];
  constructor(private readonly mat: THREE.Material) {}
  /** Box `w` x `h` x `d` standing on `y0`, centered on (x, z), turned `yaw` about its center. */
  add(x: number, z: number, y0: number, w: number, h: number, d: number, yaw = 0, c?: THREE.Color): void {
    this.mats.push(new THREE.Matrix4().makeRotationY(yaw).scale(new THREE.Vector3(w, h, d)).setPosition(x, y0 + h / 2, z));
    if (c) this.cols.push(c);
  }
  /** Box over an AABB, from `y0` up `h`. */
  over(r: AABB, y0: number, h: number, inset = 0, c?: THREE.Color): void {
    this.add((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, y0, r.maxX - r.minX - inset * 2, h, r.maxZ - r.minZ - inset * 2, 0, c);
  }
  addTo(scene: THREE.Scene, geo: THREE.BufferGeometry, order = 0): void {
    if (!this.mats.length) return;
    const im = new THREE.InstancedMesh(geo, this.mat, this.mats.length);
    this.mats.forEach((m, i) => im.setMatrixAt(i, m));
    this.cols.forEach((c, i) => im.setColorAt(i, c));
    im.renderOrder = order;
    scene.add(im);
  }
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Yellow and black diagonal hazard stripes (tiles). */
const hazardTex = (): THREE.CanvasTexture =>
  canvasTex(
    128,
    128,
    (g) => {
      g.fillStyle = '#16120a';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#f2b51c';
      for (let k = -2; k < 4; k++) {
        g.beginPath();
        g.moveTo(k * 64, 128);
        g.lineTo(k * 64 + 32, 128);
        g.lineTo(k * 64 + 160, 0);
        g.lineTo(k * 64 + 128, 0);
        g.closePath();
        g.fill();
      }
    },
    true,
  );

/** A roller shutter: corrugated slats, closed. */
const shutterTex = (): THREE.CanvasTexture =>
  canvasTex(128, 128, (g) => {
    g.fillStyle = '#5a5e68';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 8) {
      g.fillStyle = '#3c4048';
      g.fillRect(0, y, 128, 2);
      g.fillStyle = '#737885';
      g.fillRect(0, y + 3, 128, 1);
    }
  });

/** An open dock door: the lit warehouse inside, shelving and parcels. */
const dockTex = (): THREE.CanvasTexture =>
  canvasTex(256, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#fff1c8');
    grad.addColorStop(1, '#b8743a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(60,34,16,0.75)';
    for (const x of [20, 150]) {
      g.fillRect(x, 40, 86, 6);
      g.fillRect(x, 110, 86, 6);
      g.fillRect(x, 180, 86, 6);
      g.fillRect(x, 40, 6, 216);
      g.fillRect(x + 80, 40, 6, 216);
    }
    g.fillStyle = '#9a6332';
    for (const [x, y, w, h] of [
      [30, 70, 30, 40],
      [64, 84, 22, 26],
      [160, 140, 34, 40],
      [198, 152, 26, 28],
      [34, 150, 40, 30],
      [170, 66, 26, 44],
    ]) g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(20,12,6,0.5)';
    g.fillRect(0, 0, 256, 12);
  });

const flat = (geo: THREE.PlaneGeometry): THREE.PlaneGeometry => geo.rotateX(-Math.PI / 2) as THREE.PlaneGeometry;

/**
 * The Dispatch Office yard (`Depot.ts`): the HQ tower's rooftop sign, blade, lit lobby and canopy, crown
 * lights and mast; the wings' loading docks; three lit gates (pillars, a neon arch, hazard-striped curb cuts,
 * IN arrows, light on the ground); drive lanes edged with amber studs to the ring; the planter wall with its
 * glowing edge; light masts, containers, pallets, the guard booth and the parking bays. All static.
 */
export function buildDepot(city: CityModel, scene: THREE.Scene): void {
  const d = city.features.depot;
  if (!d) return;
  const t = city.terrain;
  const H = (x: number, z: number) => t.heightAt(x, z);
  const D = DEPOT;
  const amber = new THREE.Color(D.amber);
  const glow = (k: number) => new THREE.MeshBasicMaterial({ color: amber.clone().multiplyScalar(k), toneMapped: false });
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const cx = (d.yard.minX + d.yard.maxX) / 2;
  const front = d.dockZ;
  const [tower, ...wings] = city.buildings.filter((b) => b.district === 'depot');
  const floor = tower?.floorY ?? H(d.ring.x, d.ring.z);

  const dark = new Boxes(new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.55, metalness: 0.5 }));
  const concrete = new Boxes(new THREE.MeshStandardMaterial({ color: 0x55545a, roughness: 0.95 }));
  const hedge = new Boxes(new THREE.MeshStandardMaterial({ color: 0x1f4a2a, roughness: 1 }));
  const amberGlow = new Boxes(glow(2.4));
  const warm = new Boxes(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.2, 1.6), toneMapped: false }));
  // Lit windows seen from outside (the guard booth): warm, but far below the lamps so they don't bloom out
  const windows = new Boxes(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.72, 0.42) }));
  const painted = new Boxes(new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 }));
  const pools: M[] = [];
  const pool = (x: number, z: number, size: number) => pools.push(new THREE.Matrix4().makeScale(size, 1, size).setPosition(x, H(x, z) + 0.06, z));

  // ── Ground: the plaza in front of the HQ, the drive lanes, the bays ──
  const paint = new SurfaceBuilder((x, z) => H(x, z), 1);
  const PLAZA = new THREE.Color(0.2, 0.19, 0.21);
  const LANE = new THREE.Color(0.15, 0.15, 0.17);
  const WHITE = new THREE.Color(0.8, 0.8, 0.78);
  paint.patch(cx - 22, front, cx + 22, d.ring.z + 9, 0.015, 2, PLAZA);
  const laneW = 9;
  for (const g of d.gates) {
    const x0 = Math.min(g.edge.x, g.lane.x);
    const x1 = Math.max(g.edge.x, g.lane.x);
    const z0 = Math.min(g.edge.z, g.lane.z);
    const z1 = Math.max(g.edge.z, g.lane.z);
    if (g.side === 'S') paint.patch(x0 - laneW / 2, z0, x1 + laneW / 2, z1, 0.03, 2, LANE);
    else paint.patch(x0, z0 - laneW / 2, x1, z1 + laneW / 2, 0.03, 2, LANE);
  }
  // Bay lines, and a white stop bar at the head of each bay
  for (const b of d.bays) for (const s of [-1, 1]) paint.patch(b.x + (s * D.bayW) / 2 - 0.06, b.z - D.bayD / 2, b.x + (s * D.bayW) / 2 + 0.06, b.z + D.bayD / 2, 0.04, 2, WHITE);
  const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  scene.add(paint.mesh(paintMat));

  // Amber studs along both edges of every lane, and a dashed ring around the plaza's dispatch circle
  const stud = (x: number, z: number) => amberGlow.add(x, z, H(x, z), 0.35, 0.06, 0.35);
  for (const g of d.gates) {
    const len = Math.hypot(g.lane.x - g.edge.x, g.lane.z - g.edge.z);
    const across = { x: -g.inward.z, z: g.inward.x };
    for (let s = 1; s < len; s += 2.5)
      for (const k of [-1, 1]) stud(g.edge.x + g.inward.x * s + across.x * k * (laneW / 2), g.edge.z + g.inward.z * s + across.z * k * (laneW / 2));
  }
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) stud(d.ring.x + Math.cos(a) * 9, d.ring.z + Math.sin(a) * 9);

  // Arrows down each lane toward the ring, and IN arrows on the curb cuts
  const arrowMat = (label: string, k: number) =>
    new THREE.MeshBasicMaterial({ map: arrowTexture(label), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, color: amber.clone().multiplyScalar(k), toneMapped: false });
  const inMat = arrowMat('IN', 1.8);
  const laneArrow = arrowMat('', 1.2);
  const decal = (mat: THREE.Material, p: Vec2, dir: Vec2, w: number, l: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
    m.rotation.set(-Math.PI / 2, Math.atan2(-dir.x, -dir.z), 0, 'YXZ');
    m.position.set(p.x, H(p.x, p.z) + 0.05, p.z);
    m.renderOrder = 2;
    scene.add(m);
  };
  for (const g of d.gates) {
    const mid = { x: (g.mouth.minX + g.mouth.maxX) / 2, z: (g.mouth.minZ + g.mouth.maxZ) / 2 };
    decal(inMat, mid, g.inward, 1.9, 3.8);
    const len = Math.hypot(g.lane.x - g.edge.x, g.lane.z - g.edge.z);
    for (let s = 8; s < len - 3; s += 12) decal(laneArrow, { x: g.edge.x + g.inward.x * s, z: g.edge.z + g.inward.z * s }, g.inward, 2.4, 4.8);
  }

  // Hazard stripes on both edges of each curb cut and in front of every dock
  const hazard = hazardTex();
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, emissive: new THREE.Color(0.35, 0.25, 0.04), emissiveMap: hazard });
  const stripe = (x: number, z: number, w: number, l: number, rot = 0) => {
    const geo = flat(new THREE.PlaneGeometry(w, l));
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 1.2), uv.getY(i) * (l / 1.2));
    const m = new THREE.Mesh(geo, hazardMat);
    m.rotation.y = rot;
    m.position.set(x, H(x, z) + 0.05, z);
    m.renderOrder = 2;
    scene.add(m);
  };
  for (const g of d.gates) {
    const r = g.mouth;
    if (g.side === 'S') for (const x of [r.minX + 0.3, r.maxX - 0.3]) stripe(x, (r.minZ + r.maxZ) / 2, 0.6, r.maxZ - r.minZ);
    else for (const z of [r.minZ + 0.3, r.maxZ - 0.3]) stripe((r.minX + r.maxX) / 2, z, r.maxX - r.minX, 0.6);
  }
  for (const x of d.docks) stripe(x, front + 0.5, 4.2, 1);

  // ── Gates: pillars with glowing faces, an arch with the neon name both ways, light on the ground ──
  const gateSign = signTexture(
    [
      { text: '配送センター', size: 92 },
      { text: 'DISPATCH  ▸  IN', size: 64 },
    ],
    D.amber,
    1024,
    256,
  );
  const signMat = new THREE.MeshBasicMaterial({ map: gateSign, color: new THREE.Color(2, 2, 2), side: THREE.DoubleSide });
  for (const g of d.gates) gateParts(g);
  function gateParts(g: DepotGate): void {
    const across = { x: -g.inward.z, z: g.inward.x };
    const yaw = Math.atan2(across.x, across.z) + Math.PI / 2;
    const span = D.gateW + D.pillar * 2;
    const base = H(g.edge.x, g.edge.z);
    const c = { x: g.edge.x + g.inward.x * (D.planter.thick / 2), z: g.edge.z + g.inward.z * (D.planter.thick / 2) };
    for (const s of [-1, 1]) {
      const p = { x: c.x + across.x * s * (D.gateW / 2 + D.pillar / 2), z: c.z + across.z * s * (D.gateW / 2 + D.pillar / 2) };
      dark.add(p.x, p.z, base, D.pillar, D.archY + 1.8, D.pillar, yaw);
      // Glowing stripe down the street face and the inner face of the pillar
      for (const f of [-1, 1]) {
        const q = { x: p.x - g.inward.x * f * (D.pillar / 2 + 0.02), z: p.z - g.inward.z * f * (D.pillar / 2 + 0.02) };
        amberGlow.add(q.x, q.z, base + 0.3, 0.18, D.archY - 0.5, 0.04, yaw);
      }
      amberGlow.add(p.x, p.z, base + D.archY + 1.8, D.pillar + 0.1, 0.12, D.pillar + 0.1, yaw);
    }
    // Arch beam, its sign on both faces, and a row of downlights under it
    dark.add(c.x, c.z, base + D.archY, span, 1.8, 1.0, yaw);
    for (const f of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(D.gateW - 0.4, 1.6), signMat);
      m.position.set(c.x - g.inward.x * f * 0.52, base + D.archY + 0.9, c.z - g.inward.z * f * 0.52);
      m.rotation.y = Math.atan2(-g.inward.x * f, -g.inward.z * f);
      scene.add(m);
    }
    for (let k = -2; k <= 2; k++) warm.add(c.x + across.x * k * 2.4, c.z + across.z * k * 2.4, base + D.archY - 0.08, 0.7, 0.08, 0.5, yaw);
    pool(c.x, c.z, 16);
    pool(c.x - g.inward.x * 5, c.z - g.inward.z * 5, 12);
  }
  // Guard booth just inside the south gate
  const south = d.gates.find((g) => g.side === 'S');
  if (south) {
    // Guard booth: lit windows all round, a flat roof with a glowing edge
    const b = d.booth;
    const by = H((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
    concrete.over(b, by, 1.0);
    windows.over(b, by + 1.0, 1.3, 0.12);
    // Window frames: corner posts and a mullion down the middle of each side
    const mx = (b.minX + b.maxX) / 2;
    const mz = (b.minZ + b.maxZ) / 2;
    for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ], [mx, b.minZ], [mx, b.maxZ], [b.minX, mz], [b.maxX, mz]]) dark.add(x, z, by + 1.0, 0.22, 1.3, 0.22);
    dark.over({ minX: b.minX - 0.4, minZ: b.minZ - 0.4, maxX: b.maxX + 0.4, maxZ: b.maxZ + 0.4 }, by + 2.3, 0.25);
    amberGlow.over({ minX: b.minX - 0.42, minZ: b.minZ - 0.42, maxX: b.maxX + 0.42, maxZ: b.maxZ + 0.42 }, by + 2.36, 0.08);
  }

  // ── Planter wall: concrete trough, hedge, a glowing strip along the top on the street side ──
  for (const r of d.planters) {
    const y = H((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
    concrete.over(r, y, 0.75);
    hedge.over(r, y + 0.75, 0.45, 0.1);
    const alongX = r.maxX - r.minX > r.maxZ - r.minZ;
    // The street side is the side nearer the block edge
    if (alongX) {
      const z = r.maxZ > d.yard.maxZ - 1 ? r.maxZ + 0.03 : r.minZ - 0.03;
      amberGlow.add((r.minX + r.maxX) / 2, z, y + 0.62, r.maxX - r.minX, 0.07, 0.05);
    } else {
      const x = r.minX < d.yard.minX + 1 ? r.minX - 0.03 : r.maxX + 0.03;
      amberGlow.add(x, (r.minZ + r.maxZ) / 2, y + 0.62, 0.05, 0.07, r.maxZ - r.minZ);
    }
  }

  // ── The HQ tower: lobby, canopy, rooftop sign both ways, vertical blade, crown lights, mast ──
  if (tower) {
    const top = floor + tower.height;
    const tw = tower.maxX - tower.minX;
    const lobby = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.6), new THREE.MeshBasicMaterial({ map: lobbyTexture(D.amber), color: new THREE.Color(1.6, 1.6, 1.6) }));
    lobby.position.set(cx, floor + 1.8, tower.maxZ + 0.06);
    scene.add(lobby);
    dark.add(cx, tower.maxZ + 1.6, floor + 4.0, 15, 0.3, 3.2);
    amberGlow.add(cx, tower.maxZ + 3.22, floor + 4.0, 15.05, 0.1, 0.06);
    warm.add(cx, tower.maxZ + 1.6, floor + 3.95, 13, 0.05, 2.6);
    // Rooftop sign (back to back: the yard and the street behind both see it)
    const roofTex = signTexture(
      [
        { text: '配送センター', size: 120 },
        { text: 'NEO DISPATCH', size: 78 },
      ],
      D.amber,
      1024,
      300,
    );
    const roofMat = new THREE.MeshBasicMaterial({ map: roofTex, color: new THREE.Color(2.2, 2.2, 2.2) });
    for (const f of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(tw - 2, (tw - 2) * (300 / 1024)), roofMat);
      m.position.set(cx, top + 3.8, (tower.minZ + tower.maxZ) / 2 + f * 0.35);
      m.rotation.y = f > 0 ? 0 : Math.PI;
      scene.add(m);
    }
    dark.add(cx, (tower.minZ + tower.maxZ) / 2, top, tw - 1.6, 7.4, 0.6);
    // Blade sign down the south-east corner, glyphs facing east and west
    const blade = signTexture([{ text: '配送センター', size: 0 }], D.amber, 160, 960, true);
    const bladeMat = new THREE.MeshBasicMaterial({ map: blade, color: new THREE.Color(2, 2, 2) });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 12), bladeMat);
      m.position.set(tower.maxX - 1.2 + s * 0.14, floor + 11, tower.maxZ + 1.3);
      m.rotation.y = (s * Math.PI) / 2;
      scene.add(m);
    }
    dark.add(tower.maxX - 1.2, tower.maxZ + 1.3, floor + 4.9, 0.25, 12.2, 2.15);
    // Crown: a glowing band around the roof edge
    const cz = (tower.minZ + tower.maxZ) / 2;
    const td = tower.maxZ - tower.minZ;
    amberGlow.add(cx, tower.maxZ + 0.05, top - 0.6, tw + 0.1, 0.18, 0.08);
    amberGlow.add(cx, tower.minZ - 0.05, top - 0.6, tw + 0.1, 0.18, 0.08);
    amberGlow.add(tower.minX - 0.05, cz, top - 0.6, 0.08, 0.18, td + 0.1);
    amberGlow.add(tower.maxX + 0.05, cz, top - 0.6, 0.08, 0.18, td + 0.1);
    // Radio mast with its red light
    dark.add(tower.minX + 3, tower.minZ + 3, top, 0.25, 9, 0.25);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), AVIATION);
    beacon.position.set(tower.minX + 3, top + 9.2, tower.minZ + 3);
    scene.add(beacon);
  }

  // ── Wings: loading docks (shutters, a few open and lit), dock lamps, a glowing band under the roof ──
  const shutter = new THREE.MeshStandardMaterial({ map: shutterTex(), roughness: 0.6, metalness: 0.4 });
  const open = new THREE.MeshBasicMaterial({ map: dockTex(), color: new THREE.Color(1.5, 1.5, 1.5) });
  d.docks.forEach((x, i) => {
    const wing = wings.find((w) => x > w.minX && x < w.maxX);
    const y = wing?.floorY ?? floor;
    const lit = i % 3 !== 1;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.6), lit ? open : shutter);
    m.position.set(x, y + 1.8, front + 0.05);
    scene.add(m);
    dark.add(x, front + 0.25, y + 3.6, 4.4, 0.35, 0.5);
    for (const s of [-1, 1]) dark.add(x + s * 2.1, front + 0.25, y, 0.35, 1.3, 0.5);
    warm.add(x, front + 0.45, y + 4.3, 1.0, 0.18, 0.3);
    pool(x, front + 3, 8);
  });
  for (const w of wings) {
    amberGlow.add((w.minX + w.maxX) / 2, w.maxZ + 0.06, (w.floorY ?? floor) + w.height - 0.9, w.maxX - w.minX, 0.16, 0.06);
  }

  // ── Yard dressing: containers, pallets, light masts ──
  for (const c of d.containers) {
    const r = c.box;
    const y = H((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
    painted.over(r, y, 2.6, 0, new THREE.Color(c.color));
    for (let x = r.minX + 0.4; x < r.maxX; x += 0.6) painted.add(x, (r.minZ + r.maxZ) / 2, y + 0.1, 0.08, 2.4, r.maxZ - r.minZ + 0.06, 0, new THREE.Color(c.color).multiplyScalar(0.7));
  }
  // A third container on top of the first stack of each pair
  for (let i = 0; i < d.containers.length; i += 2) {
    const r = d.containers[i].box;
    painted.over(r, H((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2) + 2.6, 2.6, 0, new THREE.Color(0x8a8f96));
  }
  for (const p of d.pallets) {
    const y = H((p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2);
    painted.over(p, y, 0.15, 0, new THREE.Color(0x6b5136));
    painted.over(p, y + 0.15, 0.9, 0.08, new THREE.Color(0xa47a4a));
  }
  for (const m of d.masts) {
    const y = H(m.x, m.z);
    dark.add(m.x, m.z, y, 0.3, 11, 0.3);
    dark.add(m.x, m.z, y + 11, 2.4, 0.3, 1.2);
    warm.add(m.x, m.z, y + 10.92, 2.2, 0.1, 1.0);
    pool(m.x, m.z, 26);
  }

  dark.addTo(scene, unit);
  concrete.addTo(scene, unit);
  hedge.addTo(scene, unit);
  amberGlow.addTo(scene, unit);
  warm.addTo(scene, unit);
  windows.addTo(scene, unit);
  painted.addTo(scene, unit);

  // Warm light pools on the ground (gates, docks, masts)
  const poolMat = new THREE.MeshBasicMaterial({ map: sharedGlow(), color: new THREE.Color(0.6, 0.42, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const im = new THREE.InstancedMesh(flat(new THREE.PlaneGeometry(1, 1)), poolMat, pools.length);
  pools.forEach((m, i) => im.setMatrixAt(i, m));
  im.renderOrder = 1;
  scene.add(im);
}
