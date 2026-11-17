import * as THREE from 'three';
import { STORAGE_AT } from '../gameplay/MissionRoute';
import type { CityModel } from './RoadGraph';
import { neonTexture } from './SignTextures';

/**
 * The winter-tire storage corner (de la Montagne & Ottawa): a sidewalk board the GPS stop sits beside.
 * Hidden until that drive starts, and again once the tires are in the car. No collider; it stands on the
 * sidewalk, off the lanes.
 */
export function buildStorageBeacon(scene: THREE.Scene, city: CityModel): THREE.Group {
  const node = city.nodeAt(STORAGE_AT.i, STORAGE_AT.j);
  const foot = { x: node.pos.x + node.hx + 1.8, z: node.pos.z + node.hz + 1.8 };
  const y = city.terrain.surfaceY(foot.x, foot.z);
  const group = new THREE.Group();
  group.position.set(foot.x, y, foot.z);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, 3.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6, metalness: 0.4 }),
  );
  pole.position.y = 1.7;
  group.add(pole);

  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1),
    new THREE.MeshBasicMaterial({
      map: neonTexture(['PNEUS', 'STORAGE'], '#ffb43e', 2.2, 1),
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  board.position.y = 2.7;
  // Plane faces +Z. Point that at the intersection so the lanes can read it.
  board.rotation.y = Math.atan2(node.pos.x - foot.x, node.pos.z - foot.z);
  group.add(board);

  group.visible = false;
  scene.add(group);
  return group;
}
