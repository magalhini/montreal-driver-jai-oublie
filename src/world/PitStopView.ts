import * as THREE from 'three';
import type { AABB } from '../types';
import type { CityModel } from './RoadGraph';
import { sharedGlow } from './textures';

/**
 * Pit stops (IMPROVEMENTS #20): a flat canopy on two columns with a bright light panel underneath (the
 * classic glowing forecourt you can see from blocks away), branded fascia, pump islands, a price sign
 * at the corner, the pit garage's service circle beside the pumps. The kiosk is a regular building. All static.
 */
const FONT = "Arial, Helvetica, sans-serif";
const RED = '#c42018';

/** Two lines for a garage name: "Jacques-Cartier Pneus Garage" -> "JACQUES-CARTIER PNEUS" / "GARAGE". */
function nameLines(name: string): string[] {
  const words = name.toUpperCase().split(/\s+/);
  if (words.length <= 2) return words;
  if (words[words.length - 1] === 'GARAGE') return [words.slice(0, -1).join(' '), 'GARAGE'];
  return [words.slice(0, 2).join(' '), words.slice(2).join(' ')];
}

type M = THREE.Matrix4;
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number): M => new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);

function instanced(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, mats: M[]): void {
  if (!mats.length) return;
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  scene.add(im);
}

/** White fascia with a red band and this garage's name, repeated along the canopy. */
function fasciaTexture(name: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = RED;
  g.fillRect(0, 40, 1024, 14);
  g.fillStyle = '#f2c14e';
  g.fillRect(0, 54, 1024, 5);
  const label = name.toUpperCase();
  let size = 30;
  g.font = `bold ${size}px ${FONT}`;
  while (size > 16 && g.measureText(label).width > 480) g.font = `bold ${--size}px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillStyle = RED;
  for (let x = 16; x < 1024; x += 512) g.fillText(label, x, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Street sign at the corner: the garage's name, then what you stop for. */
function signTexture(name: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, 256, 384);
  g.fillStyle = RED;
  g.fillRect(0, 0, 256, 176);
  g.fillStyle = '#f2c14e';
  g.fillRect(0, 176, 256, 12);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  const maxW = 232;
  const width = (s: string, px: number) => {
    g.font = `bold ${px}px ${FONT}`;
    return g.measureText(s).width;
  };
  let lines = nameLines(name);
  // A long brand (Jacques-Cartier Pneus) will not fit one line of the red panel; break it into words.
  if (lines.some((l) => width(l, 20) > maxW)) lines = lines.flatMap((l) => l.split(' '));
  let size = lines.some((l) => l.length > 12) ? 22 : lines.some((l) => l.length > 10) ? 26 : 34;
  while (size > 16 && lines.some((l) => width(l, size) > maxW)) size--;
  const step = size + 8;
  const y0 = (176 - (lines.length * step - 8)) / 2;
  g.font = `bold ${size}px ${FONT}`;
  lines.forEach((line, i) => g.fillText(line, 128, y0 + i * step));
  g.fillStyle = '#14141a';
  g.fillRect(16, 204, 224, 160);
  g.fillStyle = '#ffb43e';
  g.font = `bold 28px ${FONT}`;
  g.fillText('PNEUS', 128, 242);
  g.fillStyle = '#fff';
  g.font = `bold 22px ${FONT}`;
  g.fillText('RÉPARATION', 128, 278);
  g.fillStyle = '#9dff6a';
  g.font = `bold 22px ${FONT}`;
  g.fillText('STOP IN', 128, 318);
  g.fillText('THE CIRCLE', 128, 346);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The service circle painted on the forecourt: an amber ring and this garage's name. */
function bayTexture(name: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.translate(256, 256);
  g.strokeStyle = '#ffb43e';
  g.shadowColor = '#ffb43e';
  g.shadowBlur = 18;
  g.lineWidth = 22;
  g.beginPath();
  g.arc(0, 0, 226, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;
  g.lineWidth = 8;
  g.setLineDash([26, 18]);
  g.beginPath();
  g.arc(0, 0, 186, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  const line = nameLines(name)[0] ?? name.toUpperCase();
  let size = 48;
  g.font = `bold ${size}px ${FONT}`;
  while (size > 22 && g.measureText(line).width > 320) g.font = `bold ${--size}px ${FONT}`;
  g.fillText(line, 0, -16);
  g.fillStyle = '#ffb43e';
  g.font = `bold 32px ${FONT}`;
  g.fillText('STOP HERE', 0, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildPitStops(city: CityModel, scene: THREE.Scene): void {
  const stops = city.features.pitStops;
  if (!stops.length) return;
  const t = city.terrain;
  const white: M[] = [];
  const red: M[] = [];
  const concrete: M[] = [];
  const lightPanels: M[] = [];
  const screens: M[] = [];
  const pools: M[] = [];
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  for (const s of stops) {
    const fascia = new THREE.MeshBasicMaterial({ map: fasciaTexture(s.name), color: new THREE.Color(1.25, 1.25, 1.25) });
    const bayMat = new THREE.MeshBasicMaterial({ map: bayTexture(s.name), color: new THREE.Color(1.3, 1.3, 1.3), transparent: true, depthWrite: false, toneMapped: false });
    // Service circle, the writing facing a car that comes in off the street beside it
    const bay = new THREE.Mesh(new THREE.PlaneGeometry(2 * s.bay.r, 2 * s.bay.r), bayMat);
    bay.rotation.set(-Math.PI / 2, s.sides[1] === 'N' ? Math.PI : 0, 0, 'YXZ');
    bay.position.set(s.bay.x, t.heightAt(s.bay.x, s.bay.z) + 0.05, s.bay.z);
    bay.renderOrder = 2;
    scene.add(bay);
    const c = s.canopy;
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    const w = c.maxX - c.minX;
    const d = c.maxZ - c.minZ;
    const y0 = t.heightAt(cx, cz);
    const yc = y0 + s.canopyHeight;
    // Canopy slab, light panel underneath, fascia around
    white.push(box(w, 0.9, d, cx, yc + 0.45, cz));
    // Rows of light strips in the underside (one big panel would flood the bloom when you're under it)
    for (let k = -2; k <= 2; k++) lightPanels.push(box(w - 2, 0.06, 0.32, cx, yc - 0.03, cz + (k * (d - 2)) / 5));
    const band = (len: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), fascia);
      m.position.set(x, yc + 0.45, z);
      m.rotation.y = ry;
      scene.add(m);
    };
    band(w, cx, c.maxZ + 0.02, 0);
    band(w, cx, c.minZ - 0.02, Math.PI);
    band(d, c.maxX + 0.02, cz, Math.PI / 2);
    band(d, c.minX - 0.02, cz, -Math.PI / 2);
    pools.push(new THREE.Matrix4().compose(new THREE.Vector3(cx, y0 + 0.04, cz), flat, new THREE.Vector3(w * 1.7, d * 1.9, 1)));
    // Islands, a column on each, pumps at both ends
    for (const i of s.islands) islandParts(i, y0, yc, concrete, white, red, screens);
    // Price sign at the corner, angled to face both streets
    const sx = s.sides[0] === 'W' ? -1 : 1;
    const sz = s.sides[1] === 'N' ? -1 : 1;
    const ys = t.heightAt(s.sign.x, s.sign.z);
    concrete.push(box(0.5, 6.6, 0.5, s.sign.x, ys + 3.3, s.sign.z));
    const tex = signTexture(s.name);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.35, 1.35, 1.35) });
    const yaw = Math.atan2(sx, sz);
    for (const flip of [0, Math.PI]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.9), mat);
      m.position.set(s.sign.x + Math.sin(yaw + flip) * 0.21, ys + 8.4, s.sign.z + Math.cos(yaw + flip) * 0.21);
      m.rotation.y = yaw + flip;
      scene.add(m);
    }
    red.push(new THREE.Matrix4().compose(new THREE.Vector3(s.sign.x, ys + 8.4, s.sign.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(2.75, 4.05, 0.4)));
  }

  const unit = new THREE.BoxGeometry(1, 1, 1);
  instanced(scene, unit, new THREE.MeshStandardMaterial({ color: 0xeeeef0, roughness: 0.5, metalness: 0.2 }), white);
  instanced(scene, unit, new THREE.MeshStandardMaterial({ color: 0xd8301c, roughness: 0.45, metalness: 0.2, emissive: 0x300804 }), red);
  instanced(scene, unit, new THREE.MeshStandardMaterial({ color: 0x8c8c94, roughness: 0.8, metalness: 0.05 }), concrete);
  instanced(scene, unit, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.7, 1.6) }), lightPanels);
  instanced(scene, unit, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 1.8) }), screens);
  const poolMat = new THREE.MeshBasicMaterial({ map: sharedGlow(), color: new THREE.Color(0.3, 0.3, 0.28), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), poolMat, pools.length);
  pools.forEach((m, i) => im.setMatrixAt(i, m));
  im.renderOrder = 1;
  scene.add(im);
}

function islandParts(i: AABB, y0: number, yc: number, concrete: M[], white: M[], red: M[], screens: M[]): void {
  const x = (i.minX + i.maxX) / 2;
  const z = (i.minZ + i.maxZ) / 2;
  const len = i.maxX - i.minX;
  concrete.push(box(len, 0.25, i.maxZ - i.minZ, x, y0 + 0.125, z));
  white.push(box(0.55, yc - y0, 0.55, x, y0 + (yc - y0) / 2, z));
  for (const k of [-1, 1]) {
    const px = x + k * (len / 2 - 0.8);
    white.push(box(0.75, 1.55, 0.55, px, y0 + 0.25 + 0.775, z));
    red.push(box(0.8, 0.22, 0.6, px, y0 + 0.25 + 1.66, z));
    for (const f of [-1, 1]) screens.push(box(0.42, 0.3, 0.02, px, y0 + 1.35, z + f * 0.285));
  }
}
