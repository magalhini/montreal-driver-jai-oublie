import * as THREE from 'three';
import { CONFIG } from '../config';
import type { CityModel } from './RoadGraph';

/** Handles the weather view animates (overcast sky, moon behind clouds, fog). */
export interface EnvironmentParts {
  sky: THREE.ShaderMaterial;
  /** Night only. */
  moon: THREE.Mesh | null;
  fog: THREE.FogExp2;
  background: THREE.Color;
}

/** Winter afternoon (PRD 4.4): constants a look pass will move. Colors are linear. */
export const WINTER_SKY = {
  /** Toward the sun: low, from the south-west (+Z is the river side, -X is west). */
  sunDir: new THREE.Vector3(-0.68, 0.36, 0.64).normalize(),
  sunColor: new THREE.Color(1.0, 0.9, 0.78),
  sunIntensity: 2.6,
  /** Cool sky fill over a grey, snow-lit ground bounce. */
  hemiSky: new THREE.Color(0.62, 0.7, 0.82),
  hemiGround: new THREE.Color(0.42, 0.42, 0.44),
  hemiIntensity: 1.6,
  /** Pale grey haze; the sky's horizon is the same color so buildings fade into it, not against it. */
  fog: new THREE.Color(0.7, 0.74, 0.8),
  fogDensity: 0.0023,
  /** A touch brighter than night's 1: overcast daylight, snow in the frame. */
  exposure: 1.1,
  zenith: new THREE.Color(0.3, 0.42, 0.6),
  cloud: new THREE.Color(0.86, 0.87, 0.9),
  /** Share of the sky under cloud (0 clear .. 1 overcast). */
  cover: 0.55,
  /** Sky and wet-asphalt reflections. */
  envIntensity: 0.7,
};

/** Sky, fog, lights, environment map and harbor water for the map's time of day. */
export function buildEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, city: CityModel): EnvironmentParts {
  const parts = CONFIG.SKY === 'winterDay' ? winterDay(scene, renderer) : night(scene, renderer);
  addHarbor(scene, city, CONFIG.SKY === 'winterDay');
  return parts;
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/**
 * December afternoon: blue-grey sky, white at the horizon, broken soft cloud, a low sun in the south-west.
 * Written in linear light and tone mapped like the rest of the frame, so the horizon matches the fog.
 */
const DAY_SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform float uRain;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uCloud;
  uniform float uCover;
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.75, max(y, 0.0)));
    float sun = max(dot(d, uSunDir), 0.0);
    // Haze brightens toward the sun, then a soft disc that the cloud mostly covers
    c += uSunColor * (0.22 * pow(sun, 6.0) + 0.5 * pow(sun, 60.0));
    // Clouds on a flat ceiling: a broken layer, darker underneath, lit on the sun side
    vec2 p = d.xz / max(y + 0.06, 0.06) * 0.55;
    float n = fbm(p);
    float cl = smoothstep(1.0 - uCover - 0.12, 1.0 - uCover + 0.22, n);
    float shade = 0.72 + 0.28 * smoothstep(0.3, 0.8, fbm(p * 1.7 + 4.0)) + 0.25 * pow(sun, 4.0);
    vec3 cloud = uCloud * shade;
    float sky = smoothstep(-0.02, 0.1, y);
    c = mix(c, cloud, cl * sky * 0.92);
    c += uSunColor * pow(sun, 900.0) * 3.0 * (1.0 - cl);
    // Flat grey overcast when it rains or snows hard
    c = mix(c, uCloud * 0.7, uRain * 0.8);
    // Below the horizon: the haze
    c = mix(uHorizon, c, smoothstep(-0.04, 0.02, y));
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
  }`;

function winterDay(scene: THREE.Scene, renderer: THREE.WebGLRenderer): EnvironmentParts {
  const k = WINTER_SKY;
  renderer.toneMappingExposure = k.exposure;
  const background = k.fog.clone();
  scene.background = background;
  const fog = new THREE.FogExp2(0xffffff, k.fogDensity);
  fog.color.copy(k.fog);
  scene.fog = fog;

  const skyMat = (): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uRain: { value: 0 },
        uSunDir: { value: k.sunDir },
        uSunColor: { value: k.sunColor },
        uHorizon: { value: fog.color },
        uZenith: { value: k.zenith },
        uCloud: { value: k.cloud },
        uCover: { value: k.cover },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: DAY_SKY_FRAGMENT,
    });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), skyMat());
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  sky.onBeforeRender = (_r, _s, cam) => sky.position.copy(cam.position);

  scene.add(new THREE.HemisphereLight(k.hemiSky, k.hemiGround, k.hemiIntensity));
  const sun = new THREE.DirectionalLight(k.sunColor, k.sunIntensity);
  sun.position.copy(k.sunDir).multiplyScalar(500);
  scene.add(sun);

  // Reflections: the same sky over grey ground, with a ring of brick and stone masses on the horizon so car
  // paint and wet asphalt pick up a street, not an empty dome
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat()));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.16, 0.17) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.5;
  envScene.add(ground);
  const masses = [new THREE.Color(0.32, 0.14, 0.09), new THREE.Color(0.45, 0.42, 0.38), new THREE.Color(0.14, 0.14, 0.15), new THREE.Color(0.22, 0.26, 0.3)];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.11 * Math.sin(i * 7.3);
    const h = 4 + ((i * 37) % 11);
    const m = new THREE.Mesh(new THREE.BoxGeometry(9, h, 4), new THREE.MeshBasicMaterial({ color: masses[i % masses.length] }));
    m.position.set(Math.cos(a) * 30, -1.5 + h / 2, Math.sin(a) * 30);
    m.lookAt(0, m.position.y, 0);
    envScene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = k.envIntensity;
  pmrem.dispose();
  return { sky: sky.material, moon: null, fog, background };
}

/** Night sky, fog, lights and the neon environment map (the base game's look). */
function night(scene: THREE.Scene, renderer: THREE.WebGLRenderer): EnvironmentParts {
  const background = new THREE.Color(0x0b0618);
  scene.background = background;
  const fog = new THREE.FogExp2(0x1a0d2e, 0.0032);
  scene.fog = fog;

  // Sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uRain: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uRain;
        float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        void main() {
          float y = clamp(vDir.y, -0.1, 1.0);
          vec3 top = vec3(0.01, 0.005, 0.04);
          vec3 mid = vec3(0.09, 0.02, 0.16);
          vec3 hor = vec3(0.45, 0.08, 0.32);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, y));
          c = mix(c, top, smoothstep(0.18, 0.7, y));
          // Rain: low overcast lit from below by the city (pink-purple at the horizon), no stars
          vec3 cloud = mix(vec3(0.34, 0.12, 0.3), vec3(0.06, 0.035, 0.09), smoothstep(0.0, 0.45, y));
          c = mix(c, cloud, uRain * 0.85);
          vec3 sp = floor(vDir * 500.0);
          float star = step(0.9985, h(sp)) * smoothstep(0.15, 0.5, y) * (1.0 - uRain);
          c += vec3(star) * 0.8;
          gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0); // authored in sRGB, the frame is linear
        }`,
    }),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  sky.onBeforeRender = (_r, _s, cam) => sky.position.copy(cam.position);

  // Moon
  const moon: THREE.Mesh = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 2.4), fog: false }));
  moon.position.set(-700, 420, -900);
  moon.lookAt(0, 0, 0);
  scene.add(moon);

  scene.add(new THREE.HemisphereLight(0x5a4a9a, 0x140c1c, 0.9));
  const moonLight = new THREE.DirectionalLight(0x8090ff, 0.35);
  moonLight.position.set(-300, 400, -300);
  scene.add(moonLight);

  // Neon environment map for reflections on wet asphalt and car paint
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x05030a);
  const colors = [0xff2a6d, 0x05d9e8, 0xb967ff, 0xff9f1c, 0x39ff88, 0xffffff];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2 + Math.random() * 5, 0.6 + Math.random() * 3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colors[i % colors.length]).multiplyScalar(2.5), side: THREE.DoubleSide }),
    );
    const a = (i / 26) * Math.PI * 2;
    m.position.set(Math.cos(a) * 20, -2 + Math.random() * 12, Math.sin(a) * 20);
    m.lookAt(0, m.position.y, 0);
    envScene.add(m);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x1a0a30, side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 25;
  envScene.add(ceiling);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  return { sky: sky.material, moon, fog, background };
}

/** Harbor water and the quay wall along the river. */
function addHarbor(scene: THREE.Scene, city: CityModel, day: boolean): void {
  // Harbor water. One city-sized quad, clipped by the camera's near plane, flashes as a black square
  // over the view. The cells stay small enough that a clipped triangle cannot cover the screen.
  const waterCell = 40;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 1200, Math.ceil(3000 / waterCell), Math.ceil(1200 / waterCell)),
    day
      ? new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.12, metalness: 0.7 })
      : new THREE.MeshStandardMaterial({ color: 0x050a18, roughness: 0.08, metalness: 0.9 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.6, city.waterZ + 600);
  scene.add(water);
  // Quay wall, in short runs: one 3 km face has the same near-plane flash as the water.
  // The footbridge to the wheel cuts one run in two.
  const span = 40;
  const runs = Math.ceil(3000 / span);
  const gap = city.features.port?.wheel?.bridge;
  const pieces: { x: number; w: number }[] = [];
  for (let i = 0; i < runs; i++) {
    const a = -1500 + i * span;
    const b = a + span;
    const cut = gap && gap.minX < b && gap.maxX > a;
    if (!cut) pieces.push({ x: (a + b) / 2, w: span });
    else {
      if (gap.minX - a > 0.4) pieces.push({ x: (a + gap.minX) / 2, w: gap.minX - a });
      if (b - gap.maxX > 0.4) pieces.push({ x: (gap.maxX + b) / 2, w: b - gap.maxX });
    }
  }
  const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: day ? 0x6a6660 : 0x2a2a30 }), Math.max(1, pieces.length));
  const wallM = new THREE.Matrix4();
  pieces.forEach((p, i) => wall.setMatrixAt(i, wallM.makeScale(p.w, 1, 1).setPosition(p.x, -0.5, city.waterZ + 0.5)));
  scene.add(wall);
}
