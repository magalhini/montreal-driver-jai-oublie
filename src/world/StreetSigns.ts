import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import type { AABB, RoadEdge, RoadNode, StreetName } from '../types';
import { inDriveway } from './Features';
import { bladeAtlas, parkingAtlas, PLATE_KINDS } from './QuebecSigns';
import type { CityModel } from './RoadGraph';

/** Street blades (PRD 5.8): sizes in meters. The two blades on a pole sit at different heights, crossed. */
const BLADE = { h: 0.3, perChar: 0.08, min: 0.95, max: 1.7, y: [2.75, 3.1] as [number, number] };
const BLADE_POLE_H = 3.35;
/** Parking plates: each 0.3 x 0.45 m, stacked down a thin pole every so often along residential curbs. */
const PLATE = { w: 0.3, h: 0.45, top: 2.35, gap: 0.04, every: [32, 55] as [number, number] };
const PLATE_POLE_H = 2.65;

/**
 * Static street signs (not breakaway: Montreal's corner poles are sturdy, and these never change after
 * building, so they go through `StaticTiles`):
 * - a black pole at one corner of every junction on a boulevard, with two white blades naming the streets
 *   that cross there, each blade along its street and readable from both sides;
 * - parking-plate stacks along the residential curbs, French day ranges, dressing only.
 * Returns their colliders (thin poles).
 */
export function buildStreetSigns(city: CityModel, scene: THREE.Scene): AABB[] {
  const t = city.terrain;
  const colliders: AABB[] = [];
  const names: StreetName[] = [];
  const nameIndex = new Map<string, number>();
  const idOf = (n: StreetName): number => {
    const key = `${n.generic} ${n.name}`;
    let i = nameIndex.get(key);
    if (i === undefined) nameIndex.set(key, (i = names.push(n) - 1));
    return i;
  };
  const raised = (x: number, z: number) => t.surfaceY(x, z) - t.heightAt(x, z) > CONFIG.CURB_HEIGHT * 0.5;

  // Corner poles: where each goes and which names it carries (the atlas is drawn once they are all known)
  const poles: THREE.Matrix4[] = [];
  const blades: { x: number; y: number; z: number; alongX: boolean; name: number }[] = [];
  const addPole = (x: number, z: number, height: number, radius: number) => {
    const y = t.surfaceY(x, z);
    poles.push(new THREE.Matrix4().makeScale(radius * 2, height, radius * 2).setPosition(x, y + height / 2, z));
    colliders.push({ minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius });
    return y;
  };
  for (const n of city.nodes) {
    const arms = n.edges.map((id) => city.edges[id]);
    if (!arms.some((e) => e.cls === 'boulevard')) continue;
    const row = arms.find((e) => e.axis === 'x' && e.name);
    const col = arms.find((e) => e.axis === 'z' && e.name);
    if (!row && !col) continue;
    const corner = pickCorner(city, n, raised);
    if (!corner) continue;
    const y = addPole(corner.x, corner.z, BLADE_POLE_H, 0.07);
    if (row) blades.push({ x: corner.x, y: y + BLADE.y[0], z: corner.z, alongX: true, name: idOf(row.name!) });
    if (col) blades.push({ x: corner.x, y: y + BLADE.y[1], z: corner.z, alongX: false, name: idOf(col.name!) });
  }

  const atlas = bladeAtlas(names);
  const parts: THREE.BufferGeometry[] = [];
  for (const b of blades) {
    const n = names[b.name];
    const w = Math.min(BLADE.max, Math.max(BLADE.min, 0.32 + BLADE.perChar * n.name.length));
    const [u0, v0, u1, v1] = atlas.uv(b.name);
    // Front and back: the back is the same blade turned round, so both read left to right
    for (const flip of [false, true]) {
      const g = new THREE.PlaneGeometry(w, BLADE.h);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      // The blade hangs off the pole toward the middle of its street's sidewalk run
      const yaw = (b.alongX ? 0 : -Math.PI / 2) + (flip ? Math.PI : 0);
      const off = w / 2 + 0.05;
      g.translate(0, 0, flip ? -0.012 : 0.012);
      g.rotateY(yaw);
      g.translate(b.x + (b.alongX ? off * Math.sign(-b.x || 1) : 0), b.y, b.z + (b.alongX ? 0 : off * Math.sign(-b.z || 1)));
      parts.push(g);
    }
  }

  // Parking plates: residential curbs with a parking band, a stack every 30-55 m
  const plateParts: THREE.BufferGeometry[] = [];
  const rng = new Rng(CONFIG.SEED ^ 0x9a7c);
  for (const e of city.edges) {
    if (e.parking <= 0) continue;
    const a = city.nodes[e.a].pos;
    const b = city.nodes[e.b].pos;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    for (const side of [1, -1]) {
      // Clear of the corner: the junction box, the crosswalk and the ARRÊT or signal post
      for (let s = 20 + rng.range(0, 10); s < len - 20; s += rng.range(PLATE.every[0], PLATE.every[1])) {
        const lat = side * (e.width / 2 + 0.45);
        const x = a.x + ux * s - uz * lat;
        const z = a.z + uz * s + ux * lat;
        const block = city.blockAt({ x: x - uz * side * 2, z: z + ux * side * 2 });
        const count = rng.int(1, 3);
        const kinds = Array.from({ length: count }, () => rng.int(0, PLATE_KINDS - 2));
        if (rng.chance(0.3)) kinds.push(PLATE_KINDS - 1); // an arrow plate at the bottom
        if (block?.district !== 'residential' || !raised(x, z) || inDriveway(city.features, { x, z }, 1)) continue;
        const y = addPole(x, z, PLATE_POLE_H, 0.035);
        // Facing the traffic on this side of the street: lanes run toward +along on the right-hand side
        const toward = (CONFIG.DRIVE_SIDE === 'right') === (side === -1) ? 1 : -1;
        const yaw = Math.atan2(-ux * toward, -uz * toward);
        kinds.forEach((k, i) => {
          for (const flip of [false, true]) {
            const g = new THREE.PlaneGeometry(PLATE.w, PLATE.h);
            const uv = g.getAttribute('uv');
            for (let j = 0; j < uv.count; j++) uv.setX(j, flip ? 0.999 : (k + uv.getX(j)) / PLATE_KINDS);
            // In front of the pole (radius 0.035): the face, and its back a hair behind it (the flip turns -z to +z)
            g.translate(0, 0, flip ? -0.043 : 0.049);
            g.rotateY(yaw + (flip ? Math.PI : 0));
            g.translate(x, y + PLATE.top - PLATE.h / 2 - i * (PLATE.h + PLATE.gap), z);
            plateParts.push(g);
          }
        });
      }
    }
  }

  const unit = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const poleMesh = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.55, metalness: 0.5 }), Math.max(1, poles.length));
  poles.forEach((m, i) => poleMesh.setMatrixAt(i, m));
  poleMesh.count = poles.length;
  scene.add(poleMesh);
  const face = (tex: THREE.Texture) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.08 });
  if (parts.length) scene.add(new THREE.Mesh(mergeGeometries(parts), face(atlas.texture)));
  if (plateParts.length) scene.add(new THREE.Mesh(mergeGeometries(plateParts), face(parkingAtlas())));
  return colliders;
}

/**
 * A sidewalk corner of the junction for the blade pole, just inside both curbs: the first of the four that is
 * raised sidewalk and clear of driveways (the yard gates, the garages).
 */
function pickCorner(city: CityModel, n: RoadNode, raised: (x: number, z: number) => boolean): { x: number; z: number } | null {
  const halfWidth = (axis: 'x' | 'z', sign: number): number => {
    // Width of the road on this side of the corner (rows can change class at a junction)
    const e = n.edges.map((id) => city.edges[id]).find((o: RoadEdge) => o.axis === axis && Math.sign((axis === 'x' ? city.nodes[o.a === n.id ? o.b : o.a].pos.x : city.nodes[o.a === n.id ? o.b : o.a].pos.z) - (axis === 'x' ? n.pos.x : n.pos.z)) === sign);
    return e ? e.width / 2 : 0;
  };
  for (const [sx, sz] of [
    [1, -1],
    [-1, 1],
    [1, 1],
    [-1, -1],
  ]) {
    // Inside the curb of the north-south road on this side, and of the east-west road. At a signal, every corner
    // has a mast-arm pole just past the junction: step back along the sidewalk, clear of it.
    const back = n.signalized ? 3.6 : 1.1;
    const x = n.pos.x + sx * (Math.max(n.hx, halfWidth('z', sz)) + 1.1);
    const z = n.pos.z + sz * (Math.max(n.hz, halfWidth('x', sx)) + back);
    if (raised(x, z) && !inDriveway(city.features, { x, z }, 1.5)) return { x, z };
  }
  return null;
}
