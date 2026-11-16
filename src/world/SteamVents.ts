import * as THREE from 'three';
import { Rng } from '../core/Rng';
import type { Vec2, ViewSystem } from '../types';
import type { CityModel } from './RoadGraph';

/**
 * Manhole covers on the streets, and steam rising from some of them in the busy districts (downtown,
 * shotengai), tinted by the neon around. One instanced draw of camera-facing puffs; only vents near the camera
 * emit. More steam in the rain (cold air over warm sewers).
 */
const MAX = 260;
const RANGE = 150;
const TINTS = [0xffd6f0, 0xd6f4ff, 0xfff0dc, 0xe8dcff].map((c) => new THREE.Color(c));

interface Vent {
  pos: Vec2;
  y: number;
  rate: number;
  tint: THREE.Color;
  acc: number;
}

function coverTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2a2e';
  g.beginPath();
  g.arc(64, 64, 63, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#4a4a50';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.stroke();
  // the city's crest pattern: a ring of petals around a hub
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
    g.quadraticCurveTo(64 + Math.cos(a + 0.4) * 40, 64 + Math.sin(a + 0.4) * 40, 64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50);
    g.stroke();
  }
  g.beginPath();
  g.arc(64, 64, 12, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class SteamVents implements ViewSystem {
  /** Rain 0..1 (the weather), more steam when wet. */
  rain = 0;
  /** Vent positions (read by the audio for the hiss, T34). */
  readonly vents: Vent[] = [];
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly offs = new Float32Array(MAX * 3);
  private readonly look = new Float32Array(MAX * 4); // size, alpha, rotation, tint index
  private readonly life = new Float32Array(MAX * 3); // age, lifetime, seed
  private readonly vel = new Float32Array(MAX * 3);
  private n = 0;

  constructor(
    city: CityModel,
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    const rng = new Rng(0x5733a);
    const covers: THREE.Matrix4[] = [];
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    for (const e of city.edges) {
      const a = city.nodes[e.a];
      const b = city.nodes[e.b];
      const alongX = e.axis === 'x';
      const t0 = (alongX ? a.pos.x + a.hx : a.pos.z + a.hz) + 12;
      const t1 = (alongX ? b.pos.x - b.hx : b.pos.z - b.hz) - 12;
      if (t1 - t0 < 10) continue;
      const fixed = alongX ? a.pos.z : a.pos.x;
      const mid = (t0 + t1) / 2;
      const side = city.blockAt(alongX ? { x: mid, z: fixed + e.width / 2 + 3 } : { x: fixed + e.width / 2 + 3, z: mid });
      const busy = side && (side.district === 'downtown' || side.district === 'shotengai');
      const count = rng.int(1, 2);
      for (let k = 0; k < count; k++) {
        const t = rng.range(t0, t1);
        // in the middle of a lane (where the sewer runs under it)
        const lane = (rng.chance(0.5) ? 1 : -1) * (e.avenue ? 6.2 : 2.0);
        const pos = alongX ? { x: t, z: fixed + lane } : { x: fixed + lane, z: t };
        const y = city.terrain.heightAt(pos.x, pos.z);
        covers.push(new THREE.Matrix4().compose(new THREE.Vector3(pos.x, y + 0.035, pos.z), flat, new THREE.Vector3(0.75, 0.75, 1)));
        if (busy && rng.chance(0.55)) this.vents.push({ pos, y, rate: rng.range(2.5, 5), tint: rng.pick(TINTS), acc: 0 });
      }
    }
    const coverMat = new THREE.MeshStandardMaterial({ map: coverTexture(), roughness: 0.45, metalness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    const im = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 20), coverMat, covers.length);
    covers.forEach((m, i) => im.setMatrixAt(i, m));
    scene.add(im);

    // Steam puffs
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.offs, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iLook', new THREE.InstancedBufferAttribute(this.look, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: { ...THREE.UniformsLib.fog, uTints: { value: TINTS } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos;
        attribute vec4 iLook;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vTint;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vAlpha = iLook.y;
          vTint = iLook.w;
          float c = cos(iLook.z), s = sin(iLook.z);
          vec2 q = mat2(c, -s, s, c) * position.xy * iLook.x;
          vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
          mvPosition.xy += q;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTints[4];
        varying vec2 vUv;
        varying float vAlpha;
        varying float vTint;
        #include <fog_pars_fragment>
        void main() {
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float puff = (1.0 - smoothstep(0.2, 1.0, r)) * (0.75 + 0.25 * sin(atan(d.y, d.x) * 3.0 + vTint * 7.0));
          vec3 col = vTint < 0.5 ? uTints[0] : vTint < 1.5 ? uTints[1] : vTint < 2.5 ? uTints[2] : uTints[3];
          gl_FragColor = vec4(col * 0.55, puff * vAlpha);
          #include <fog_fragment>
        }`,
    });
    const steam = new THREE.Mesh(this.geo, mat);
    steam.frustumCulled = false;
    steam.renderOrder = 3;
    scene.add(steam);
  }

  sync(_alpha: number, dt: number): void {
    if (dt <= 0) return;
    const cam = this.camera.position;
    const boost = 1 + this.rain * 0.8;
    // Emit from the vents near the camera
    for (const v of this.vents) {
      if (Math.abs(v.pos.x - cam.x) > RANGE || Math.abs(v.pos.z - cam.z) > RANGE) continue;
      v.acc += v.rate * boost * dt;
      while (v.acc >= 1 && this.n < MAX) {
        v.acc -= 1;
        const i = this.n++;
        this.offs.set([v.pos.x + (Math.random() - 0.5) * 0.4, v.y + 0.1, v.pos.z + (Math.random() - 0.5) * 0.4], i * 3);
        this.life.set([0, 2.8 + Math.random() * 1.6, Math.random() * 10], i * 3);
        this.vel.set([(Math.random() - 0.5) * 0.3 + 0.25, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3], i * 3);
        this.look.set([0.6, 0, Math.random() * 6.28, TINTS.indexOf(v.tint)], i * 4);
      }
      if (v.acc > 1) v.acc = 1;
    }
    // Age, rise, spread, fade; remove dead ones by swapping in the last
    for (let i = 0; i < this.n; i++) {
      const a = (this.life[i * 3] += dt);
      const L = this.life[i * 3 + 1];
      if (a >= L) {
        const last = --this.n;
        if (i !== last) {
          this.offs.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.life.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.look.copyWithin(i * 4, last * 4, last * 4 + 4);
        }
        i--;
        continue;
      }
      const k = a / L;
      const slow = 1 - k * 0.6;
      this.offs[i * 3] += this.vel[i * 3] * dt;
      this.offs[i * 3 + 1] += this.vel[i * 3 + 1] * dt * slow;
      this.offs[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.look[i * 4] = 0.6 + 3.2 * Math.sqrt(k);
      this.look[i * 4 + 1] = 0.3 * Math.min(1, k * 5) * (1 - k) ** 1.4;
      this.look[i * 4 + 2] += dt * 0.25;
    }
    this.geo.instanceCount = this.n;
    (this.geo.getAttribute('iPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iLook') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
