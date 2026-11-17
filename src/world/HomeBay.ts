import * as THREE from 'three';
import { CONFIG } from '../config';
import type { CityModel } from './RoadGraph';

const GREEN = '#1f8a43';
const FONT = 'Arial, Helvetica, sans-serif';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The bay's paint: a green box and a P, the one stall in town that says yes. Long axis is the canvas height. */
function paintTexture(): THREE.Texture {
  return canvasTexture(128, 320, (g) => {
    g.strokeStyle = GREEN;
    g.lineWidth = 10;
    g.strokeRect(8, 8, 112, 304);
    g.fillStyle = 'rgba(31, 138, 67, 0.18)';
    g.fillRect(13, 13, 102, 294);
    g.fillStyle = GREEN;
    g.font = `bold 96px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('P', 64, 160);
  });
}

/** Curb plate in the style of the city's own: a green P, permitted at all hours. */
function plateTexture(): THREE.Texture {
  return canvasTexture(128, 192, (g) => {
    g.fillStyle = '#f6f6f2';
    g.fillRect(0, 0, 128, 192);
    g.strokeStyle = '#111';
    g.lineWidth = 4;
    g.strokeRect(4, 4, 120, 184);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeStyle = GREEN;
    g.lineWidth = 8;
    g.beginPath();
    g.arc(64, 58, 38, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = GREEN;
    g.font = `bold 60px ${FONT}`;
    g.fillText('P', 64, 60);
    g.fillStyle = '#111';
    g.font = `bold 19px ${FONT}`;
    ['PERMIS', 'EN TOUT', 'TEMPS'].forEach((t, i) => g.fillText(t, 64, 122 + i * 24));
  });
}

/**
 * The home bay (`MissionRoute.homeBay`): green paint in the stall where every session starts, and a green
 * P plate on the sidewalk at its front end, facing the traffic coming up behind. Static, no colliders.
 */
export function buildHomeBay(scene: THREE.Scene, city: CityModel): void {
  const bay = city.features.curb.find((b) => b.legal);
  if (!bay) return;
  const e = city.edges[bay.edge];
  const len = bay.s1 - bay.s0;
  const width = Math.max(1.8, e.parking);
  const f = { x: Math.sin(bay.yaw), z: Math.cos(bay.yaw) };
  // The curb is on the side traffic keeps to
  const s = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;
  const out = { x: s * f.z, z: -s * f.x };
  const t = city.terrain;

  const paint = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.2, len - 0.3),
    new THREE.MeshBasicMaterial({ map: paintTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  // Plane's +Y (the canvas's up) along the bay
  paint.rotation.set(-Math.PI / 2, bay.yaw + Math.PI, 0, 'YXZ');
  paint.position.set(bay.pos.x, t.heightAt(bay.pos.x, bay.pos.z) + 0.03, bay.pos.z);
  paint.renderOrder = 2;
  scene.add(paint);

  const along = len / 2 - 0.4;
  const lat = width / 2 + 0.55;
  const px = bay.pos.x + f.x * along + out.x * lat;
  const pz = bay.pos.z + f.z * along + out.z * lat;
  const y = t.surfaceY(px, pz);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 6), new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5, metalness: 0.6 }));
  post.position.set(px, y + 1.25, pz);
  scene.add(post);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.69), new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.6, side: THREE.DoubleSide, emissive: 0x222222 }));
  plate.position.set(px - f.x * 0.04, y + 2.05, pz - f.z * 0.04);
  // Face the traffic coming up behind the bay
  plate.rotation.y = bay.yaw + Math.PI;
  scene.add(plate);
}
