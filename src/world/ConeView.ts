import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Cones } from '../gameplay/Cones';
import type { ViewSystem } from '../types';
import type { CityGround } from './Ground';

/** Montreal cone colours: safety orange, the white reflective bands, the black rubber base. */
export const CONE_ORANGE = 0xff6a10;
export const CONE_WHITE = 0xf2f2ee;
const RUBBER = 0x161616;

function painted(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.index ? g.toNonIndexed() : g;
}

/**
 * The tall Montreal "cône": a striped orange tube about 1.1 m high on a wide black rubber ring (PRD 3,
 * `inspo/rue-barree-traffic-cones.webp`). Base on the ground at y = 0, standing along +Y.
 */
export function coneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const seg = 8;
  const base = new THREE.CylinderGeometry(0.33, 0.36, 0.07, seg);
  base.translate(0, 0.035, 0);
  parts.push(painted(base, RUBBER));
  // Bands from the bottom: orange / white, the tube narrowing slightly to the top
  const bands: [number, number][] = [
    [0.2, CONE_ORANGE],
    [0.09, CONE_WHITE],
    [0.17, CONE_ORANGE],
    [0.09, CONE_WHITE],
    [0.17, CONE_ORANGE],
    [0.09, CONE_WHITE],
    [0.17, CONE_ORANGE],
    [0.07, CONE_WHITE],
  ];
  const total = bands.reduce((a, b) => a + b[0], 0);
  const r = (y: number) => 0.185 - 0.04 * (y / total);
  let y = 0.07;
  for (const [h, col] of bands) {
    const y0 = y - 0.07;
    const g = new THREE.CylinderGeometry(r(y0 + h), r(y0), h, seg, 1, true);
    g.translate(0, y + h / 2, 0);
    parts.push(painted(g, col));
    y += h;
  }
  const cap = new THREE.CircleGeometry(r(total), seg);
  cap.rotateX(-Math.PI / 2);
  cap.translate(0, y, 0);
  parts.push(painted(cap, CONE_ORANGE));
  const out = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  out.computeVertexNormals();
  return out;
}

/** Half the tube's diameter at its widest: how high the axis sits when a cone lies on its side. */
const LYING_Y = 0.2;

/**
 * Instanced cones, one batch per 250 m tile (by where they started) so three.js can cull them. Only the cones
 * the sim moved this step are re-posed.
 */
export class ConeView implements ViewSystem {
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** For cone i: its batch and slot. */
  private readonly batchOf: number[] = [];
  private readonly slotOf: number[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qs = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly dirty = new Set<number>();

  constructor(
    private readonly sim: Cones,
    scene: THREE.Scene,
    private readonly ground: CityGround,
  ) {
    const geo = coneGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    const buckets = new Map<string, number[]>();
    sim.cones.forEach((c, i) => {
      const k = `${Math.floor(c.pos.x / 250)},${Math.floor(c.pos.z / 250)}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(i);
    });
    for (const list of buckets.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.castShadow = true;
      list.forEach((ci, slot) => {
        this.batchOf[ci] = this.meshes.length;
        this.slotOf[ci] = slot;
        this.pose(im, ci, slot);
      });
      im.computeBoundingSphere();
      this.meshes.push(im);
      scene.add(im);
    }
  }

  private pose(im: THREE.InstancedMesh, i: number, slot: number): void {
    const c = this.sim.cones[i];
    const y = this.ground.surfaceY(c.pos.x, c.pos.z);
    if (c.down) {
      // On its side: the axis horizontal along lieYaw, rolled about it by the spin
      this.e.set(Math.PI / 2, c.lieYaw, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.qs.setFromAxisAngle(this.v.set(0, 1, 0), c.yaw);
      this.q.multiply(this.qs);
      // Base at the cone's position, so the tube lies forward of it
      this.v.set(c.pos.x, y + LYING_Y, c.pos.z);
    } else {
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), c.yaw);
      this.v.set(c.pos.x, y, c.pos.z);
    }
    this.m.compose(this.v, this.q, this.one);
    im.setMatrixAt(slot, this.m);
  }

  sync(): void {
    for (const i of this.sim.moved) this.dirty.add(i);
    if (!this.dirty.size) return;
    const touched = new Set<THREE.InstancedMesh>();
    for (const i of this.dirty) {
      const im = this.meshes[this.batchOf[i]];
      this.pose(im, i, this.slotOf[i]);
      touched.add(im);
    }
    this.dirty.clear();
    for (const im of touched) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }
}
