import * as THREE from 'three';
import type { CityModel } from './RoadGraph';

/** Handles the weather view animates (overcast sky, moon behind clouds, fog). */
export interface EnvironmentParts {
  sky: THREE.ShaderMaterial;
  moon: THREE.Mesh;
  fog: THREE.FogExp2;
  background: THREE.Color;
}

/** Night sky, fog, lights, neon environment map and harbor water. */
export function buildEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, city: CityModel): EnvironmentParts {
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

  // Harbor water. One city-sized quad, clipped by the camera's near plane, flashes as a black square
  // over the view. The cells stay small enough that a clipped triangle cannot cover the screen.
  const waterCell = 40;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 1200, Math.ceil(3000 / waterCell), Math.ceil(1200 / waterCell)),
    new THREE.MeshStandardMaterial({ color: 0x050a18, roughness: 0.08, metalness: 0.9 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.6, city.waterZ + 600);
  scene.add(water);
  // Quay wall, in short runs: one 3 km face has the same near-plane flash as the water
  const span = 40;
  const runs = Math.ceil(3000 / span);
  const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(span, 2, 1), new THREE.MeshStandardMaterial({ color: 0x2a2a30 }), runs);
  const wallM = new THREE.Matrix4();
  for (let i = 0; i < runs; i++) wall.setMatrixAt(i, wallM.makeTranslation(-1500 + (i + 0.5) * span, -0.5, city.waterZ + 0.5));
  scene.add(wall);
  return { sky: sky.material, moon, fog, background };
}
