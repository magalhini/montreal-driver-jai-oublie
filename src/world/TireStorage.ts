import * as THREE from 'three';
import type { StorageStop } from '../gameplay/MissionRoute';
import type { CityModel } from './RoadGraph';
import { neonTexture } from './SignTextures';

const FONT = 'Arial, Helvetica, sans-serif';
const AMBER = '#ffb43e';

/** Roll-up door size (m). */
const DOOR_W = 3;
const DOOR_H = 2.7;

/** The storage circle painted in the curb lane: an amber ring, PNEUS, STOP HERE. */
function ringTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.translate(256, 256);
  g.strokeStyle = AMBER;
  g.shadowColor = AMBER;
  g.shadowBlur = 18;
  g.lineWidth = 24;
  g.beginPath();
  g.arc(0, 0, 226, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;
  g.lineWidth = 8;
  g.setLineDash([26, 18]);
  g.beginPath();
  g.arc(0, 0, 184, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = `bold 60px ${FONT}`;
  g.fillText('PNEUS', 0, -22);
  g.fillStyle = AMBER;
  g.font = `bold 34px ${FONT}`;
  g.fillText('STOP HERE', 0, 46);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Corrugated steel for the roll-up door. */
function slatTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9aa0a6';
  g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = '#6c7278';
    g.fillRect(0, y + 12, 128, 3);
    g.fillStyle = '#b9bfc4';
    g.fillRect(0, y + 2, 128, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  return t;
}

/** A winter tire, lying flat or standing (shared by the stacks here and the one the driver carries). */
export function tireMesh(): THREE.Group {
  const g = new THREE.Group();
  const rubber = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.92 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8e94, roughness: 0.45, metalness: 0.6 });
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.1, 8, 18), rubber);
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 14).rotateX(Math.PI / 2), steel);
  g.add(rim);
  return g;
}

/** What the pickup scene animates: the door going up, the circle and marker showing while they are wanted. */
export interface TireStorage {
  /** `door` 0..1 up; `wanted`: the drive still needs the tires (circle and marker on). */
  update(door: number, wanted: boolean, time: number): void;
}

/**
 * The winter-tire storage on Ottawa: a roll-up door in the building face with ENTREPOSAGE PNEUS over it,
 * stacks of tires against the wall, and the circle in the curb lane with an amber marker bobbing over it
 * while the drive needs the tires. No colliders; everything stands on the sidewalk or lies on the road.
 */
export function buildTireStorage(scene: THREE.Scene, city: CityModel, stop: StorageStop): TireStorage {
  const t = city.terrain;
  const c = stop.curb;
  // Face of the building, looking at the street
  const out = { x: -c.x, z: -c.z };
  const face = Math.atan2(out.x, out.z);
  const walkY = t.surfaceY(stop.door.x + out.x * 0.6, stop.door.z + out.z * 0.6);
  const front = new THREE.Group();
  front.position.set(stop.door.x, walkY, stop.door.z);
  front.rotation.y = face;
  scene.add(front);

  // Dark bay behind the door, then the door itself (it rolls up into the housing from the bottom)
  const bay = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H), new THREE.MeshBasicMaterial({ color: 0x0c0b0a }));
  bay.position.set(0, DOOR_H / 2, 0.03);
  front.add(bay);
  const slats = slatTexture();
  const doorMat = new THREE.MeshStandardMaterial({ map: slats, roughness: 0.55, metalness: 0.45, emissive: 0x1a1a1e });
  const roll = new THREE.Group();
  roll.position.set(0, DOOR_H, 0.06);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H).translate(0, -DOOR_H / 2, 0), doorMat);
  roll.add(panel);
  front.add(roll);
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.5 });
  const housing = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.3, 0.38, 0.32), steel);
  housing.position.set(0, DOOR_H + 0.19, 0.16);
  front.add(housing);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, DOOR_H, 0.16), steel);
    post.position.set(s * (DOOR_W / 2 + 0.07), DOOR_H / 2, 0.08);
    front.add(post);
  }

  // The board over the door, and a warm lamp under it
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.05),
    new THREE.MeshBasicMaterial({ map: neonTexture(['ENTREPOSAGE', 'PNEUS · TIRE STORAGE'], AMBER, 3.6, 1.05), toneMapped: false }),
  );
  board.position.set(0, DOOR_H + 1.05, 0.12);
  front.add(board);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.1), toneMapped: false }));
  lamp.position.set(0, DOOR_H + 0.45, 0.3);
  front.add(lamp);

  // Tires stacked against the wall either side of the door
  const stacks: [number, number][] = [
    [-(DOOR_W / 2 + 0.75), 4],
    [-(DOOR_W / 2 + 1.5), 2],
    [DOOR_W / 2 + 0.75, 3],
  ];
  for (const [x, n] of stacks) {
    for (let k = 0; k < n; k++) {
      const tire = tireMesh();
      tire.rotation.x = Math.PI / 2;
      tire.rotation.z = k * 0.7;
      tire.position.set(x + (k % 2) * 0.03, 0.1 + k * 0.2, 0.45);
      front.add(tire);
    }
  }

  // The circle in the curb lane, the writing upright for a car arriving the way traffic drives
  const roadY = t.heightAt(stop.pos.x, stop.pos.z);
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTexture(), color: new THREE.Color(1.3, 1.3, 1.3), transparent: true, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2 * stop.r, 2 * stop.r), ringMat);
  ring.rotation.set(-Math.PI / 2, stop.yaw + Math.PI, 0, 'YXZ');
  ring.position.set(stop.pos.x, roadY + 0.05, stop.pos.z);
  ring.renderOrder = 2;
  scene.add(ring);

  // A marker over the circle, so it reads from down the street
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 0.9, 4).rotateX(Math.PI),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.25, 0.35), toneMapped: false }),
  );
  marker.position.set(stop.pos.x, roadY + 3.6, stop.pos.z);
  scene.add(marker);

  return {
    update(door, wanted, time) {
      const up = Math.min(1, Math.max(0, door));
      roll.scale.y = Math.max(0.04, 1 - up);
      slats.repeat.y = roll.scale.y;
      ring.visible = wanted;
      marker.visible = wanted;
      if (!wanted) return;
      ringMat.opacity = 0.75 + 0.25 * Math.sin(time * 3.2);
      marker.position.y = roadY + 3.6 + Math.sin(time * 2.4) * 0.25;
      marker.rotation.y = time * 1.6;
    },
  };
}
