import * as THREE from 'three';
import { CONFIG } from '../config';
import { Rng } from '../core/Rng';
import type { Vec2 } from '../types';
import { inDriveway } from './Features';
import { cumulative, pointAt, tangentAt } from './Polyline';
import type { CityModel } from './RoadGraph';

/** Plowed snow along the curbs (PRD 4.4). Lengths in meters. */
export const BERM_TUNING = {
  /** Center of a pile, measured from the curb line into the sidewalk. */
  inset: 0.6,
  /** Kept clear at each end of a block (the crosswalk and the corner). */
  cornerClear: 6,
  length: [3, 8] as [number, number],
  width: [0.95, 1.4] as [number, number],
  height: [0.22, 0.55] as [number, number],
  /** Gap between piles, and now and then a long clear stretch where someone shoveled out a door. */
  gap: [0.2, 2.5] as [number, number],
  longGap: [6, 14] as [number, number],
  longGapChance: 0.14,
};

/**
 * Snow on roofs, curbs and lawns. Albedo alone tops out below the limestone under this light, so a faint cool
 * self-light lifts it to the brightest surface in the frame, the way snow reads on an overcast day.
 */
export function snowMaterial(opts: { vertexColors?: boolean; flatShading?: boolean } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: opts.vertexColors ? 0xffffff : new THREE.Color().setRGB(0.92, 0.94, 0.97, THREE.SRGBColorSpace),
    emissive: new THREE.Color(0.1, 0.11, 0.13),
    roughness: 0.92,
    metalness: 0,
    ...opts,
  });
}

/** Low dome: flat bottom on the sidewalk, white on top, grey-brown slush along the bottom (vertex colors). */
function bermGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const white = new THREE.Color().setRGB(0.9, 0.92, 0.95, THREE.SRGBColorSpace);
  const dirty = new THREE.Color().setRGB(0.42, 0.39, 0.35, THREE.SRGBColorSpace);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Lumpy: push vertices in and out a little so a row of piles is not a row of eggs
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = y > 0.02 ? 1 + 0.2 * Math.sin(x * 5.1 + z * 3.7) * Math.cos(z * 4.3 - x * 2.2) : 1;
    // Flattened crown: a plowed ridge, not an egg
    const yy = Math.min(y, 0.75 + 0.1 * Math.sin(x * 7.0 + z * 2.0));
    pos.setXYZ(i, x * k, yy * k, z * k);
    const grit = 0.5 + 0.5 * Math.sin(x * 13.0 + z * 9.0);
    c.copy(dirty).lerp(white, THREE.MathUtils.smoothstep(y, 0.12, 0.6) * (0.85 + 0.15 * grit));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Snow berms on the sidewalk edge of every block face: one instanced mesh (the static tiling cuts it up for
 * culling). Visual only; curbs are not physical and neither is the snow on them.
 */
export function buildSnowBerms(city: CityModel, scene: THREE.Scene): void {
  const k = BERM_TUNING;
  const rng = new Rng(CONFIG.SEED ^ 0x5a0);
  const t = city.terrain;
  const mats: THREE.Matrix4[] = [];
  const p: Vec2 = { x: 0, z: 0 };
  const dir: Vec2 = { x: 0, z: 0 };
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sidewalk = (x: number, z: number) => t.surfaceY(x, z) - t.heightAt(x, z) > CONFIG.CURB_HEIGHT * 0.5;

  for (const e of city.edges) {
    const cum = cumulative(e.pts);
    const total = cum[cum.length - 1];
    for (const side of [1, -1]) {
      let s = k.cornerClear + rng.range(0, 2);
      while (s < total - k.cornerClear) {
        const len = Math.min(rng.range(k.length[0], k.length[1]), total - k.cornerClear - s);
        const mid = s + len / 2;
        const w = rng.range(k.width[0], k.width[1]);
        const h = rng.range(k.height[0], k.height[1]);
        s += len + (rng.chance(k.longGapChance) ? rng.range(k.longGap[0], k.longGap[1]) : rng.range(k.gap[0], k.gap[1]));
        if (len < 1.2) continue;
        pointAt(e.pts, cum, mid, p);
        tangentAt(e.pts, cum, mid, dir);
        // Left of the direction of travel is (-dz, dx); `side` picks the curb
        const lat = side * (e.width / 2 + k.inset);
        const x = p.x - dir.z * lat;
        const z = p.z + dir.x * lat;
        if (!sidewalk(x, z) || inDriveway(city.features, { x, z }, 1)) continue;
        q.setFromAxisAngle(up, Math.atan2(dir.x, dir.z));
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, t.surfaceY(x, z) - 0.02, z), q, new THREE.Vector3(w / 2, h, len / 2)));
      }
    }
  }
  if (mats.length === 0) return;
  const mesh = new THREE.InstancedMesh(bermGeometry(), snowMaterial({ vertexColors: true, flatShading: true }), mats.length);
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}
