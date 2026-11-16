import * as THREE from 'three';
import { CONFIG } from '../config';
import { leftVec, yawOf } from '../core/math';
import { GlowQuads } from '../render/GlowQuads';
import type { SignalStyle } from '../maps/MapDef';
import type { AABB, Vec2, ViewSystem } from '../types';
import { cumulative, pointAt, project } from './Polyline';
import type { CityModel } from './RoadGraph';
import type { TrafficLights } from './TrafficLights';

type Lamp = 'green' | 'yellow' | 'red';

interface Head {
  node: number;
  /** The approach this head faces. */
  edge: number;
  /** Halo position per lamp, just in front of the lens. */
  glow: Record<Lamp, THREE.Vector3>;
  rot: THREE.Quaternion;
}

/** Lens colors are not tone mapped, so they stay saturated instead of washing out to white. */
const ON: Record<Lamp, THREE.Color> = {
  green: new THREE.Color(0.15, 1, 0.7),
  yellow: new THREE.Color(1, 0.72, 0.05),
  red: new THREE.Color(1, 0.08, 0.06),
};
/** Above 1 on purpose: the additive halo saturates over a wider core. */
const HALO: Record<Lamp, THREE.Color> = {
  green: new THREE.Color(0.08, 1.6, 0.95),
  yellow: new THREE.Color(1.6, 1, 0.04),
  red: new THREE.Color(1.7, 0.1, 0.05),
};
const OFF = new THREE.Color(0.05, 0.05, 0.06);
const HALO_SIZE = 2.2;
/** Halos grow with distance so the signal state reads from several blocks away. */
const HALO_GROW_DIST = 35;
const HALO_MAX_SCALE = 4;
const HALO_RANGE = 420;
/**
 * Halos ignore the fog (signals cut through it) but dim with distance: a straight street lines up a dozen
 * signals at its vanishing point, and at full strength their additive halos stacked into one white blob.
 */
const HALO_FADE_START = 90;
const HALO_FADE_FLOOR = 0.12;

/** Distance from o along unit d to where the ray leaves convex polygon `poly` (0 if it starts outside). */
function rayExit(poly: Vec2[], o: Vec2, d: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const den = d.x * ez - d.z * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - o.x) * ez - (a.z - o.z) * ex) / den;
    const u = ((a.x - o.x) * d.z - (a.z - o.z) * d.x) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best === Infinity ? 0 : best;
}

/**
 * Signal heads, one per approach (T43), facing its traffic along the lanes' `endDir`. `overhead` (Tokyo):
 * horizontal heads hung from an arm on a pole beyond the junction, on the far side of the approach. `mast`
 * (North America, Montreal): the same far-side pole and arm, with a vertical head hanging under the arm.
 * `pole` (European): vertical heads on a pole at the stop line, on the drive-side curb.
 */
export class TrafficLightView implements ViewSystem {
  readonly colliders: AABB[] = [];
  private heads: Head[] = [];
  private lamps: Record<Lamp, THREE.InstancedMesh>;
  private version = -1;
  private halos: GlowQuads;
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private s = new THREE.Vector3();

  constructor(
    city: CityModel,
    private lights: TrafficLights,
    scene: THREE.Scene,
    private camera: THREE.Camera,
    style: SignalStyle = 'overhead',
  ) {
    const housings: THREE.Matrix4[] = [];
    const poles: THREE.Matrix4[] = [];
    const arms: THREE.Matrix4[] = [];
    const lampM: Record<Lamp, THREE.Matrix4[]> = { green: [], yellow: [], red: [] };
    const side = CONFIG.DRIVE_SIDE === 'left' ? 1 : -1;
    const H = 5.6;
    const armed = style !== 'pole';
    /** Three lamps stacked, red on top (`mast`, `pole`), or side by side (`overhead`). */
    const vertical = style !== 'overhead';

    for (const n of city.nodes) {
      if (!n.signalized) continue;
      for (const eid of n.edges) {
        const e = city.edges[eid];
        const entering = city.lanesEntering(e, n.id);
        if (!entering.length) continue; // exit-only arm of a one-way road
        const l0 = city.lanes[entering[0]];
        // traffic direction toward the node
        const d: Vec2 = { x: l0.endDir.x, z: l0.endDir.z };
        const lv = leftVec(d);
        const hw = e.width / 2;
        const yaw = yawOf({ x: -d.x, z: -d.z });
        const rot = new THREE.Matrix4().makeRotationY(yaw);
        let pole: Vec2;
        let head: Vec2;
        let top: number;
        if (armed) {
          // Beyond the junction, on the driver's side of the incoming road, the head hung over its lanes
          const far = rayExit(n.poly, n.pos, d);
          const at = { x: n.pos.x + d.x * (far + 1.6), z: n.pos.z + d.z * (far + 1.6) };
          pole = { x: at.x + lv.x * side * (hw + 0.9), z: at.z + lv.z * side * (hw + 0.9) };
          head = { x: at.x + lv.x * side * (hw * 0.45), z: at.z + lv.z * side * (hw * 0.45) };
          top = H + city.terrain.heightAt(n.pos.x, n.pos.z);
          const armLen = Math.hypot(pole.x - head.x, pole.z - head.z) + 0.3;
          // A vertical head hangs under the arm (its top at the arm), a horizontal one is bolted along it
          const armY = vertical ? top + 0.62 : top + 0.35;
          arms.push(new THREE.Matrix4().makeScale(armLen, 0.12, 0.12).premultiply(rot).setPosition((pole.x + head.x) / 2, armY, (pole.z + head.z) / 2));
          if (vertical) {
            housings.push(new THREE.Matrix4().makeScale(0.4, 1.16, 0.32).premultiply(rot).setPosition(head.x, top, head.z));
            // Bracket from the arm down to the housing
            housings.push(new THREE.Matrix4().makeScale(0.08, 0.1, 0.08).premultiply(rot).setPosition(head.x, top + 0.6, head.z));
          } else housings.push(new THREE.Matrix4().makeScale(1.35, 0.46, 0.32).premultiply(rot).setPosition(head.x, top, head.z));
        } else {
          // At the stop line, just behind the drive-side curb
          const cum = cumulative(e.pts);
          const c = pointAt(e.pts, cum, project(e.pts, cum, l0.end).s);
          const out = hw + 0.7;
          pole = { x: c.x + lv.x * side * out, z: c.z + lv.z * side * out };
          head = { x: pole.x - d.x * 0.2, z: pole.z - d.z * 0.2 };
          top = city.terrain.surfaceY(pole.x, pole.z) + 3.1;
          housings.push(new THREE.Matrix4().makeScale(0.36, 1.08, 0.3).premultiply(rot).setPosition(head.x, top, head.z));
        }
        const poleY = city.terrain.surfaceY(pole.x, pole.z);
        const thick = style === 'pole' ? 0.16 : style === 'mast' ? 0.26 : 0.24;
        poles.push(new THREE.Matrix4().makeScale(thick, top + 0.4 - poleY, thick).setPosition(pole.x, poleY, pole.z));
        const front = 0.17;
        // Lamp positions: across the head with red nearest the road's center (overhead: red on the right in Tokyo,
        // on the left in Montreal) or stacked (pole: red on top)
        const at = (k: number, ahead: number) =>
          vertical
            ? new THREE.Vector3(head.x - d.x * ahead, top - 0.34 * k, head.z - d.z * ahead)
            : new THREE.Vector3(head.x - d.x * ahead + lv.x * 0.42 * k * side, top, head.z - d.z * ahead + lv.z * 0.42 * k * side);
        const place = (k: number) => new THREE.Matrix4().copy(rot).setPosition(at(k, front));
        lampM.green.push(place(1));
        lampM.yellow.push(place(0));
        lampM.red.push(place(-1));
        this.heads.push({
          node: n.id,
          edge: eid,
          glow: { green: at(1, front + 0.05), yellow: at(0, front + 0.05), red: at(-1, front + 0.05) },
          rot: new THREE.Quaternion().setFromRotationMatrix(rot),
        });
        this.colliders.push({ minX: pole.x - 0.2, maxX: pole.x + 0.2, minZ: pole.z - 0.2, maxZ: pole.z + 0.2 });
      }
    }

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    // Montreal (stop-line poles or mast arms): dark round posts and black housings; Tokyo's arms keep the grey box kit
    const dark = style !== 'overhead';
    const baseBox = (dark ? new THREE.CylinderGeometry(0.5, 0.5, 1, 10) : boxGeo.clone()).translate(0, 0.5, 0);
    const metal = new THREE.MeshStandardMaterial({ color: dark ? 0x2a2c30 : 0x55565e, metalness: 0.6, roughness: 0.4 });
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[]) => {
      const im = new THREE.InstancedMesh(geo, mat, ms.length);
      ms.forEach((m, i) => im.setMatrixAt(i, m));
      scene.add(im);
      return im;
    };
    mk(baseBox, metal, poles);
    mk(boxGeo, metal, arms);
    mk(boxGeo, new THREE.MeshStandardMaterial({ color: dark ? 0x18191c : 0x8a8c94, metalness: 0.5, roughness: 0.45 }), housings);
    const disc = new THREE.CircleGeometry(0.18, 16);
    const lampMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.lamps = {
      green: mk(disc, lampMat(), lampM.green),
      yellow: mk(disc, lampMat(), lampM.yellow),
      red: mk(disc, lampMat(), lampM.red),
    };
    for (const k of ['green', 'yellow', 'red'] as const) {
      for (let i = 0; i < this.heads.length; i++) this.lamps[k].setColorAt(i, OFF);
    }
    // Lit signals cut through the fog, like real lamps do
    this.halos = new GlowQuads(scene, this.heads.length, false);
  }

  sync(): void {
    if (this.version !== this.lights.version) {
      this.version = this.lights.version;
      this.heads.forEach((h, i) => {
        const st = this.lights.state(h.node, h.edge);
        this.lamps.green.setColorAt(i, st === 'green' ? ON.green : OFF);
        this.lamps.yellow.setColorAt(i, st === 'yellow' ? ON.yellow : OFF);
        this.lamps.red.setColorAt(i, st === 'red' ? ON.red : OFF);
      });
      for (const k of ['green', 'yellow', 'red'] as const) this.lamps[k].instanceColor!.needsUpdate = true;
    }

    const cam = this.camera.position;
    this.halos.begin();
    for (const h of this.heads) {
      const st = this.lights.state(h.node, h.edge);
      const p = h.glow[st];
      const dist = p.distanceTo(cam);
      if (dist > HALO_RANGE) continue;
      const size = HALO_SIZE * Math.min(HALO_MAX_SCALE, 1 + dist / HALO_GROW_DIST);
      const t = Math.max(0, (dist - HALO_FADE_START) / (HALO_RANGE - HALO_FADE_START));
      const k = HALO_FADE_FLOOR + (1 - HALO_FADE_FLOOR) * (1 - t) * (1 - t);
      this.halos.push(this.m.compose(p, h.rot, this.s.setScalar(size)), this.c.copy(HALO[st]).multiplyScalar(k));
    }
    this.halos.end();
  }
}
