import * as THREE from "three";
import { Debug } from "../core/Debug";
import { damp } from "../core/math";
import { LOOK } from "../render/Look";
import type { AABB, ViewSystem } from "../types";
import type { EnvironmentParts } from "./Environment";
import type { RoadMaterials } from "./RoadMesh";
import type { CityGround } from "./Ground";
import { WEATHER_TUNING, type Weather } from "./Weather";

const MAX_DROPS = 14000;
/** Rain volume around the camera (m), centered this far ahead of it so few drops are wasted behind. */
const BOX = new THREE.Vector3(46, 22, 46);
/** Box center: ahead of the camera and raised (little of the volume ends up under the road). */
const AHEAD = 10;
const RAISE = 6;
const MAX_SPLASHES = 1000;
/** Splashes per second at full rain, spread over a disc of this radius ahead of the camera. */
const SPLASH_RATE = 2000;
const SPLASH_RADIUS = 26;
const SPLASH_LIFE = 0.35;
/** Dry areas the drop shader knows about: the nearest ones to the rain box (arcades, garages, passages, nooks). */
const MAX_COVERS = 8;

const dropVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uFall;
  uniform float uExposure;
  uniform float uOpacity;
  uniform vec3 uBox;
  uniform vec3 uCenter;
  uniform vec3 uCamVel;
  uniform vec2 uWind;
  uniform vec4 uCovers[${MAX_COVERS}];
  varying float vA;
  varying float vV;
  void main() {
    vec3 vel = vec3(uWind.x, -uFall * (0.8 + 0.4 * aSeed.w), uWind.y);
    // World-fixed drops wrapped into the box that follows the camera
    vec3 p = aSeed.xyz * uBox + vel * uTime;
    p = uCenter + mod(p - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;
    // Streak along the drop's motion relative to the camera: rain slants toward you at speed
    vec3 rel = vel - uCamVel;
    float rl = max(length(rel), 0.001);
    vec3 dir = rel / rl;
    float len = min(2.4, rl * uExposure);
    vec3 toCam = cameraPosition - p;
    float dist = max(length(toCam), 0.001);
    vec3 side = normalize(cross(dir, toCam / dist) + vec3(1e-4, 0.0, 0.0));
    float width = 0.012 + dist * 0.0011;
    vec3 world = p + side * position.x * width - dir * len * position.y;
    vec3 q = abs(p - uCenter) / (0.5 * uBox);
    float edge = 1.0 - smoothstep(0.7, 1.0, max(q.x, max(q.y, q.z)));
    float near = smoothstep(1.3, 2.4, dist); // nothing inside the car around a cockpit camera
    float dry = 1.0;
    for (int i = 0; i < ${MAX_COVERS}; i++) {
      vec4 c = uCovers[i];
      if (p.x > c.x && p.x < c.z && p.z > c.y && p.z < c.w) dry = 0.0;
    }
    vA = uOpacity * edge * near * dry * (0.55 + 0.45 * aSeed.w);
    vV = position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const dropFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  varying float vV;
  void main() {
    gl_FragColor = vec4(uColor, vA * (1.0 - vV)); // bright head, fading tail
  }`;

const splashVertex = /* glsl */ `
  attribute vec4 aData; // x, y, z, spawn time
  uniform float uTime;
  uniform float uLife;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAge;
  varying float vA;
  void main() {
    float age = (uTime - aData.w) / uLife;
    vAge = age;
    vUv = uv;
    vA = (age < 0.0 || age > 1.0) ? 0.0 : uOpacity * (1.0 - age);
    float size = mix(0.05, 0.3, sqrt(clamp(age, 0.0, 1.0)));
    gl_Position = projectionMatrix * viewMatrix * vec4(aData.xyz + position * size, 1.0);
  }`;

const splashFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAge;
  varying float vA;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float ring = smoothstep(0.5, 0.82, d) * (1.0 - smoothstep(0.82, 1.0, d)) * 0.7;
    float drop = (1.0 - smoothstep(0.0, 0.4, d)) * (1.0 - smoothstep(0.0, 0.25, vAge)) * 0.6;
    gl_FragColor = vec4(uColor, vA * (ring + drop));
  }`;

// Double-sided: the streak billboards' winding depends on which way the drop moves relative to the camera
const additive = (
  uniforms: Record<string, THREE.IUniform>,
  vertexShader: string,
  fragmentShader: string,
) =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

/**
 * Rain (view only, driven by `Weather`): GPU rain streaks in a box that follows the camera (motion-stretched,
 * so rain slants toward you at speed), splash rings on the ground and the canal, and the atmosphere:
 * denser fog, overcast sky with no moon, glossier and darker roads as they get wet (they stay wet after it
 * stops). Covered arcades stay dry. Also owns the Weather debug folder.
 */
export class RainView implements ViewSystem {
  /** Snow squall strength 0..1 (`gameplay/Snowstorm.ts`): the fog closes in with it. */
  storm = 0;
  private readonly drops: THREE.Mesh;
  private readonly dropGeo: THREE.InstancedBufferGeometry;
  private readonly dropU: Record<string, THREE.IUniform>;
  private readonly splashes: THREE.Mesh;
  private readonly splashGeo: THREE.InstancedBufferGeometry;
  private readonly splashData: THREE.InstancedBufferAttribute;
  private readonly splashU: Record<string, THREE.IUniform>;
  private nextSplash = 0;
  private splashAcc = 0;
  private lastSpawn = -99;
  private time = 0;
  private readonly camPrev = new THREE.Vector3();
  private readonly camVel = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly base: {
    fog: THREE.Color;
    bg: THREE.Color;
    density: number;
    env: number;
    asphalt: THREE.Color;
    rough: [number, number, number, number];
  };
  /** Rain closes the sky in: purple city glow at night, flat grey by day. */
  private readonly rainFog = LOOK.day ? new THREE.Color(0.42, 0.44, 0.48) : new THREE.Color(0x2c2238);
  private readonly rainBg = LOOK.day ? new THREE.Color(0.42, 0.44, 0.48) : new THREE.Color(0x1d1428);

  constructor(
    private readonly weather: Weather,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly terrain: CityGround,
    private readonly env: EnvironmentParts,
    private readonly roads: RoadMaterials,
    private readonly covers: AABB[],
  ) {
    // Drops: one instanced quad each (x across the streak, y along it)
    this.dropGeo = new THREE.InstancedBufferGeometry();
    this.dropGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0],
        3,
      ),
    );
    this.dropGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(MAX_DROPS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.dropGeo.setAttribute(
      "aSeed",
      new THREE.InstancedBufferAttribute(seeds, 4),
    );
    this.dropGeo.instanceCount = 0;
    const coverVecs = Array.from({ length: MAX_COVERS }, () => new THREE.Vector4(0, 0, 0, 0));
    this.dropU = {
      uTime: { value: 0 },
      uFall: { value: 11 },
      uExposure: { value: 0.05 },
      uOpacity: { value: 0 },
      uBox: { value: BOX },
      uCenter: { value: new THREE.Vector3() },
      uCamVel: { value: this.camVel },
      uWind: { value: new THREE.Vector2(1.6, 0.7) },
      uCovers: { value: coverVecs },
      uColor: { value: new THREE.Color(0.62, 0.66, 0.85) },
    };
    this.drops = new THREE.Mesh(
      this.dropGeo,
      additive(this.dropU, dropVertex, dropFragment),
    );
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 3;

    // Splashes: flat rings with CPU-spawned positions (they need the terrain height)
    this.splashGeo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.splashGeo.setAttribute("position", plane.getAttribute("position"));
    this.splashGeo.setAttribute("uv", plane.getAttribute("uv"));
    this.splashGeo.setIndex(plane.getIndex());
    this.splashData = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_SPLASHES * 4).fill(-1e5),
      4,
    );
    this.splashData.setUsage(THREE.DynamicDrawUsage);
    this.splashGeo.setAttribute("aData", this.splashData);
    this.splashGeo.instanceCount = MAX_SPLASHES;
    this.splashU = {
      uTime: { value: 0 },
      uLife: { value: SPLASH_LIFE },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0.55, 0.6, 0.8) },
    };
    this.splashes = new THREE.Mesh(
      this.splashGeo,
      additive(this.splashU, splashVertex, splashFragment),
    );
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 3;
    scene.add(this.drops, this.splashes);

    this.base = {
      fog: env.fog.color.clone(),
      bg: env.background.clone(),
      density: env.fog.density,
      env: scene.environmentIntensity,
      asphalt: roads.asphalt.color.clone(),
      rough: [
        roads.asphalt.roughness,
        roads.lots.roughness,
        roads.walk.roughness,
        roads.setts.roughness,
      ],
    };
    camera.getWorldPosition(this.camPrev);
    this.addDebug();
  }

  /** Load the covers closest to the rain box into the drop shader (there are more than it can take). */
  private nearestCovers(center: THREE.Vector3): void {
    const gap = (c: AABB) => Math.hypot(Math.max(c.minX - center.x, 0, center.x - c.maxX), Math.max(c.minZ - center.z, 0, center.z - c.maxZ));
    const near = this.covers.length <= MAX_COVERS ? this.covers : [...this.covers].sort((a, b) => gap(a) - gap(b));
    const vecs = this.dropU.uCovers.value as THREE.Vector4[];
    for (let i = 0; i < MAX_COVERS; i++) {
      const c = near[i];
      if (c) vecs[i].set(c.minX, c.minZ, c.maxX, c.maxZ);
      else vecs[i].set(0, 0, 0, 0);
    }
  }

  sync(_alpha: number, dt: number): void {
    const w = this.weather;
    const rain = w.rain;
    this.time += dt;
    this.trackCamera(dt);

    // Streaks
    const drops = Math.round(MAX_DROPS * Math.min(1, rain * 1.15));
    this.drops.visible = drops > 0;
    this.dropGeo.instanceCount = drops;
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    this.dropU.uCenter.value.set(
      cam.x + this.fwd.x * AHEAD,
      cam.y + RAISE,
      cam.z + this.fwd.z * AHEAD,
    );
    this.dropU.uTime.value = this.time;
    this.dropU.uOpacity.value = 0.16 + 0.16 * rain;
    if (drops > 0) this.nearestCovers(this.dropU.uCenter.value);

    // Splashes
    this.splashU.uTime.value = this.time;
    this.splashU.uOpacity.value = 0.12 + 0.16 * rain;
    this.splashes.visible =
      rain > 0 || this.time - this.lastSpawn < SPLASH_LIFE;
    if (rain > 0 && dt > 0) this.spawnSplashes(rain, dt, cam);

    // Atmosphere and wet surfaces
    const wet = w.wetness;
    const b = this.base;
    this.env.fog.density = b.density + 0.0026 * rain + 0.0055 * this.storm;
    this.env.fog.color.copy(b.fog).lerp(this.rainFog, rain * 0.75);
    this.env.background.copy(b.bg).lerp(this.rainBg, rain * 0.75);
    (this.env.sky.uniforms.uRain as THREE.IUniform<number>).value = rain;
    if (this.env.moon) this.env.moon.visible = rain < 0.15;
    this.scene.environmentIntensity = b.env * (1 + 0.3 * wet);
    this.roads.asphalt.roughness = b.rough[0] * (1 - 0.45 * wet);
    this.roads.lots.roughness = b.rough[1] * (1 - 0.45 * wet);
    this.roads.walk.roughness = b.rough[2] * (1 - 0.4 * wet);
    this.roads.setts.roughness = b.rough[3] * (1 - 0.4 * wet);
    this.roads.asphalt.color.copy(b.asphalt).multiplyScalar(1 - 0.18 * wet);
  }

  /** Camera velocity (smoothed, for the streak slant) and its horizontal forward direction. */
  private trackCamera(dt: number): void {
    const p = this.camera.getWorldPosition(new THREE.Vector3());
    if (dt > 0) {
      const v = p.clone().sub(this.camPrev).divideScalar(dt);
      if (v.length() > 80) v.set(0, 0, 0); // teleport / camera cut
      this.camVel.lerp(v, damp(10, dt));
    }
    this.camPrev.copy(p);
    this.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, 1);
    this.fwd.normalize();
  }

  private spawnSplashes(rain: number, dt: number, cam: THREE.Vector3): void {
    this.splashAcc += SPLASH_RATE * rain * dt;
    const n = Math.floor(this.splashAcc);
    this.splashAcc -= n;
    if (n === 0) return;
    const cx = cam.x + this.fwd.x * (SPLASH_RADIUS * 0.45);
    const cz = cam.z + this.fwd.z * (SPLASH_RADIUS * 0.45);
    const arr = this.splashData.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * SPLASH_RADIUS;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (
        this.covers.some(
          (c) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ,
        )
      )
        continue;
      const water = this.terrain.waterAt(x, z);
      const y = (water ?? this.terrain.surfaceY(x, z)) + 0.03;
      const i = this.nextSplash * 4;
      arr[i] = x;
      arr[i + 1] = y;
      arr[i + 2] = z;
      arr[i + 3] = this.time - Math.random() * dt; // spread within the frame
      this.nextSplash = (this.nextSplash + 1) % MAX_SPLASHES;
    }
    this.lastSpawn = this.time;
    this.splashData.needsUpdate = true;
  }

  private addDebug(): void {
    const w = this.weather;
    const f = Debug.addFolder("Weather");
    f.add(w, "raining").name("raining (toggle)").listen();
    f.add(w, "auto").name("auto cycle");
    f.add(w, "target", 0, 1, 0.01).name("intensity").listen();
    f.add(w, "wetness", 0, 1, 0.01).name("road wetness").listen();
    f.add(WEATHER_TUNING, "wetGrip", 0.6, 1, 0.01).name("wet grip x");
    Debug.watch(
      "weather",
      () =>
        `rain ${w.rain.toFixed(2)} -> ${w.target.toFixed(2)}  wet ${w.wetness.toFixed(2)}  grip x${w.grip.toFixed(2)}  next ${w.auto ? `${w.nextChange.toFixed(0)} s` : "held"}`,
    );
  }
}
