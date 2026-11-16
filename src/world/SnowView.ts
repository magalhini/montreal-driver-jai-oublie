import * as THREE from 'three';
import type { ViewSystem } from '../types';

/** Light, constant snowfall (PRD 4.4). The rain view's idea with slow white flakes and no splashes. */
export const SNOW_TUNING = {
  /** Flakes in the box around the camera. */
  count: 4200,
  /** Fall speed (m/s) and the drift that carries them sideways. */
  fall: 1.1,
  wind: new THREE.Vector2(0.55, 0.25),
  /** Flake diameter near the camera (m); far flakes are drawn a little bigger so they stay a pixel or two. */
  size: 0.045,
  opacity: 0.85,
};

/** Volume around the camera (m), centered ahead of it and raised. */
const BOX = new THREE.Vector3(48, 24, 48);
const AHEAD = 12;
const RAISE = 5;

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uFall;
  uniform float uSize;
  uniform vec2 uWind;
  uniform vec3 uBox;
  uniform vec3 uCenter;
  varying vec2 vUv;
  varying float vA;
  void main() {
    // World-fixed flakes wrapped into the box that follows the camera, each wobbling on its own clock
    float w = aSeed.w * 6.2832;
    vec3 vel = vec3(uWind.x, -uFall * (0.75 + 0.5 * aSeed.w), uWind.y);
    vec3 p = aSeed.xyz * uBox + vel * uTime;
    p.x += 0.35 * sin(uTime * (0.7 + aSeed.w) + w);
    p.z += 0.35 * cos(uTime * (0.6 + aSeed.y) + w * 1.7);
    p = uCenter + mod(p - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;
    vec3 q = abs(p - uCenter) / (0.5 * uBox);
    float edge = 1.0 - smoothstep(0.7, 1.0, max(q.x, max(q.y, q.z)));
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    float near = smoothstep(1.2, 2.6, dist); // nothing inside the car around a cockpit camera
    float size = uSize * (0.7 + 0.6 * aSeed.x) + dist * 0.0009;
    mv.xy += position.xy * size;
    vUv = position.xy + 0.5;
    vA = edge * near;
    gl_Position = projectionMatrix * mv;
  }`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vA;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

/** Snowflakes around the camera: one instanced draw of camera-facing soft dots. */
export class SnowView implements ViewSystem {
  private readonly mesh: THREE.Mesh;
  private readonly u: Record<string, THREE.IUniform>;
  private readonly fwd = new THREE.Vector3();
  private readonly cam = new THREE.Vector3();
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    const k = SNOW_TUNING;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(k.count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = k.count;
    this.u = {
      uTime: { value: 0 },
      uFall: { value: k.fall },
      uSize: { value: k.size },
      uWind: { value: k.wind },
      uBox: { value: BOX },
      uCenter: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(0.86, 0.88, 0.92) },
      uOpacity: { value: k.opacity },
    };
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  sync(_alpha: number, dt: number): void {
    this.time += dt;
    const k = SNOW_TUNING;
    this.camera.getWorldPosition(this.cam);
    this.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, 1);
    this.fwd.normalize();
    this.u.uCenter.value.set(this.cam.x + this.fwd.x * AHEAD, this.cam.y + RAISE, this.cam.z + this.fwd.z * AHEAD);
    this.u.uTime.value = this.time;
    this.u.uFall.value = k.fall;
    this.u.uSize.value = k.size;
    this.u.uOpacity.value = k.opacity;
  }
}
