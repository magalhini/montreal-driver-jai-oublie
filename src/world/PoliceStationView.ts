import * as THREE from 'three';
import { SIGN_FONT as FONT } from './SignTextures';
import { STATION } from './PoliceStation';
import type { CityModel } from './RoadGraph';

/** Dark board, glowing lines. */
function signTexture(lines: { text: string; size: number }[], color: string, w: number, h: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#060814';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  const total = lines.reduce((s, l) => s + l.size * 1.15, 0);
  let y = h / 2 - total / 2;
  for (const l of lines) {
    g.font = `bold ${l.size}px ${FONT}`;
    y += (l.size * 1.15) / 2;
    g.fillText(l.text, w / 2, y);
    y += (l.size * 1.15) / 2;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The precinct's dressing: a roof sign, a 警 blade, a red/blue roof bar, a canopy, floodlight masts and the
 * bay lines. Empty bays (the future dispatch spots) get a blue stall line. The building is a city building.
 */
export function buildPoliceStation(city: CityModel, scene: THREE.Scene): void {
  const s = city.features.station;
  if (!s) return;
  const t = city.terrain;
  const floor = s.building.floorY ?? t.heightAt(s.facade.x, s.facade.z);
  const top = floor + s.building.height;
  const yaw = Math.atan2(s.out.x, s.out.z);
  const at = (u: number, v: number, y: number): THREE.Vector3 =>
    new THREE.Vector3(s.facade.x + s.along.x * u + s.out.x * v, y, s.facade.z + s.along.z * u + s.out.z * v);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const dark = new THREE.MeshStandardMaterial({ color: 0x141820, roughness: 0.55, metalness: 0.45 });
  const glow = new THREE.Color(s.color).multiplyScalar(2.1);

  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 3.6),
    new THREE.MeshBasicMaterial({ map: signTexture([{ text: s.jp, size: 150 }, { text: s.name, size: 78 }], s.color, 1024, 280), color: new THREE.Color(1.8, 1.8, 1.8) }),
  );
  board.position.copy(at(0, 0.3, top + 2.1));
  board.rotation.y = yaw;
  scene.add(board);
  const back = new THREE.Mesh(box, dark);
  back.scale.set(16.3, 3.8, 0.22);
  back.position.copy(at(0, 0.12, top + 2.1));
  back.rotation.y = yaw;
  scene.add(back);

  // Red / blue bar on the sign, the station's own light bar
  for (const [side, color] of [
    [-1, new THREE.Color(3.2, 0.25, 0.35)],
    [1, new THREE.Color(0.35, 0.7, 3.4)],
  ] as const) {
    const bar = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    bar.scale.set(3.2, 0.16, 0.12);
    bar.position.copy(at(side * 4.2, 0.4, top + 3.95));
    bar.rotation.y = yaw;
    scene.add(bar);
  }

  const blade = signTexture([{ text: s.glyph, size: 280 }], s.color, 256, 640);
  const bladeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 4.6), new THREE.MeshBasicMaterial({ map: blade, color: new THREE.Color(1.8, 1.8, 1.8), side: THREE.DoubleSide }));
  bladeMesh.position.copy(at(STATION.buildingW / 2 - 1.2, 1.1, floor + 6.4));
  bladeMesh.rotation.y = yaw + Math.PI / 2;
  scene.add(bladeMesh);

  const canopy = new THREE.Mesh(box, dark);
  canopy.scale.set(10, 0.22, 2.2);
  canopy.position.copy(at(0, 1.1, floor + 3.4));
  canopy.rotation.y = yaw;
  scene.add(canopy);
  const strip = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: glow, toneMapped: false }));
  strip.scale.set(10.1, 0.08, 0.08);
  strip.position.copy(at(0, 2.2, floor + 3.35));
  strip.rotation.y = yaw;
  scene.add(strip);

  const lines: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const open = new Set(s.open);
  const mid = STATION.apron + STATION.bayDepth / 2;
  s.bays.forEach((b, i) => {
    const col = open.has(i) ? new THREE.Color(0.45, 0.7, 1) : new THREE.Color(0.78, 0.78, 0.74);
    for (const side of [-1, 1]) {
      const p = { x: b.x + side * (STATION.bayWidth / 2), z: s.facade.z + s.out.z * mid };
      const y = t.heightAt(p.x, p.z) + 0.03;
      lines.push(new THREE.Matrix4().makeRotationY(yaw).scale(new THREE.Vector3(0.1, 0.012, STATION.bayDepth)).setPosition(p.x, y, p.z));
      colors.push(col);
    }
  });
  const paint = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff }), lines.length);
  lines.forEach((m, i) => {
    paint.setMatrixAt(i, m);
    paint.setColorAt(i, colors[i]);
  });
  scene.add(paint);

  // Floodlight masts (the colliders are the poles)
  const mastGeo = new THREE.BoxGeometry(1, 1, 1);
  const heads: THREE.Matrix4[] = [];
  const poles: THREE.Matrix4[] = [];
  for (const c of s.colliders) {
    const x = (c.minX + c.maxX) / 2;
    const z = (c.minZ + c.maxZ) / 2;
    const y = t.heightAt(x, z);
    poles.push(new THREE.Matrix4().makeScale(0.28, 8, 0.28).setPosition(x, y + 4, z));
    heads.push(new THREE.Matrix4().makeScale(1.4, 0.22, 0.7).setPosition(x, y + 8.1, z));
  }
  const poleMesh = new THREE.InstancedMesh(mastGeo, dark, poles.length);
  poles.forEach((m, i) => poleMesh.setMatrixAt(i, m));
  scene.add(poleMesh);
  const headMesh = new THREE.InstancedMesh(mastGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.85, 2.2), toneMapped: false }), heads.length);
  heads.forEach((m, i) => headMesh.setMatrixAt(i, m));
  scene.add(headMesh);
}
