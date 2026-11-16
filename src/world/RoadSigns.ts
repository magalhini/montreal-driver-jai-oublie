import * as THREE from 'three';
import { CONFIG, KMH } from '../config';
import type { Lane, RoadEdge, Vec2 } from '../types';
import { allWayTexture, arretTexture, octagonGeometry, speedPlateTexture } from './QuebecSigns';
import { laneOffset, type CityModel } from './RoadGraph';
import { RoadSignPosts, type SignFace, type SignPost } from './RoadSignPosts';
import { inDriveway } from './StreetProps';

/**
 * The regulatory signs at the curb (PRD 5.8), as breakaway posts on the drive side:
 * - the Quebec speed plate (black on white) a few meters into a block where the limit changes, and on every
 *   other block as a reminder (Quebec does not paint the limit on the lane; the HUD repeats it);
 * - ARRÊT at the stop line of every approach to an all-way stop, with the all-way plaque under it where the
 *   junction has one.
 */
/** Which side of a lane its curb is on (+1 = left, as `leftVec`). */
const CURB_SIDE = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;

/** Sign plates (m): the speed plate, the octagon, the plaque under it. */
const SPEED = { w: 0.6, h: 0.75, y: 2.15 };
const ARRET = { w: 0.75, h: 0.75, y: 2.1 };
const PLAQUE = { w: 0.45, h: 0.3, y: 1.5 };

const sign = (tex: THREE.Texture, emissive = 0.1): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: emissive });

/**
 * Places the curb signs. They're breakaway posts whose meshes change after building, so they come back as
 * `RoadSignPosts` and must stay out of `StaticTiles`.
 */
export function buildRoadSigns(city: CityModel): RoadSignPosts {
  const t = city.terrain;
  // One plate per posted limit in use (km/h): 50 / 40 / 30 for boulevards, streets and cobbles
  const LIMITS = [...new Set(city.edges.map((e) => Math.round(e.speedLimit / KMH)))].sort((a, b) => b - a);
  const square = new THREE.PlaneGeometry(1, 1);
  const kinds: SignFace[] = LIMITS.map((kmh) => ({ geo: square, mat: sign(speedPlateTexture(kmh)), ...SPEED }));
  const arret = kinds.push({ geo: octagonGeometry(), mat: sign(arretTexture(), 0.14), ...ARRET }) - 1;
  const plaque = kinds.push({ geo: square, mat: sign(allWayTexture()), ...PLAQUE }) - 1;

  const posts: SignPost[] = [];
  const breakAt = CONFIG.SIGN_BREAK_KMH * KMH;
  const up = new THREE.Vector3(0, 1, 0);
  /** A post just past the curb on the lane's own side, `along` meters from the lane's start, facing its traffic. */
  const post = (e: RoadEdge, lane: Lane, along: number, faces: number[]): boolean => {
    const d = lane.dir;
    const left: Vec2 = { x: d.z, z: -d.x };
    const out = CURB_SIDE * (e.width / 2 + 0.45 - laneOffset(e, lane.index));
    const q = { x: lane.start.x + d.x * along + left.x * out, z: lane.start.z + d.z * along + left.z * out };
    if (inDriveway(city, q, 0.8)) return false;
    // The face looks back at the oncoming driver (+Z of lookAt(eye, target) points from target to eye)
    const face = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(d.x, 0, d.z), up);
    posts.push({
      foot: new THREE.Vector3(q.x, t.surfaceY(q.x, q.z), q.z),
      rot: new THREE.Quaternion().setFromRotationMatrix(face),
      faces,
      collider: { minX: q.x - 0.08, maxX: q.x + 0.08, minZ: q.z - 0.08, maxZ: q.z + 0.08, breakAt },
    });
    return true;
  };

  for (const e of city.edges) {
    const which = LIMITS.findIndex((k) => Math.abs(k * KMH - e.speedLimit) < 0.1);
    for (const id of [...e.lanesAB, ...e.lanesBA]) {
      const lane = city.lanes[id];
      if (lane.index !== 0) continue; // one post per direction, from the curb lane
      // ARRÊT at the stop line of an all-way stop (a step short of it, clear of the crosswalk)
      const end = city.nodes[lane.to];
      if (end.control === 'stop') post(e, lane, lane.length - 0.3, end.allWayPlaque ? [arret, plaque] : [arret]);
      // Speed plate where the limit changes from the road behind, and every other block
      if (which < 0 || lane.length < 30) continue;
      const behind = straightBehind(city, e, lane.from);
      if (behind && Math.abs(behind.speedLimit - e.speedLimit) < 0.1 && e.id % 2 === 1) continue;
      for (const along of [11, 16, 21]) if (post(e, lane, along, [which])) break;
    }
  }
  return new RoadSignPosts(posts, kinds, t);
}

/** The road that continues straight on through node `n` from edge `e` (the block behind a car entering `e`). */
function straightBehind(city: CityModel, e: RoadEdge, n: number): RoadEdge | null {
  for (const id of city.nodes[n].edges) {
    const o = city.edges[id];
    if (o !== e && o.axis === e.axis) return o;
  }
  return null;
}
