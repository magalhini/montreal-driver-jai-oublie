import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LOOK } from './Look';

/** Live-tunable amounts (Debug "Post FX" folder). Graphics toggles gate these; 0 skips that look. */
export const POSTFX = {
  enabled: true,
  // By day only lamps and lit signals clear the threshold: the sky and snow must not haze, brake lights not halo
  bloom: LOOK.day ? 0.22 : 0.5,
  bloomRadius: 0.25,
  bloomThreshold: LOOK.day ? 1.4 : 0.9,
  vignette: 0.38,
  grain: 0.035,
  aberration: 0.0006,
  saturation: 1.08,
  /** Barrel bend when SCREEN BEND is on. */
  curve: 0.085,
};

/** Picture options on the GRAPHICS page. Saved to `localStorage`. */
export const GRAPHICS_OPTIONS = [
  { key: 'bloom', label: 'NEON GLOW', hint: 'Bloom on signs, lamps and tail lights' },
  { key: 'vignette', label: 'VIGNETTE', hint: 'Darkened corners' },
  { key: 'grain', label: 'FILM GRAIN', hint: 'Fine noise, like old footage' },
  { key: 'aberration', label: 'RGB SHIFT', hint: 'Color fringing toward the edges of the screen' },
  { key: 'curve', label: 'SCREEN BEND', hint: 'Curve the picture like a glass tube' },
] as const;

export type GraphicsKey = (typeof GRAPHICS_OPTIONS)[number]['key'];

const GRAPHICS_DEFAULTS: Record<GraphicsKey, boolean> = {
  bloom: true,
  vignette: true,
  grain: true,
  aberration: true,
  curve: false,
};

export const GRAPHICS_KEY = 'neonDriver.graphics';

function loadGraphics(): Record<GraphicsKey, boolean> {
  const out = { ...GRAPHICS_DEFAULTS };
  try {
    const raw = localStorage.getItem(GRAPHICS_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Record<GraphicsKey, boolean>>) : {};
    for (const opt of GRAPHICS_OPTIONS) {
      const saved = v[opt.key];
      if (typeof saved === 'boolean') out[opt.key] = saved;
    }
  } catch {
    // unreadable save, or no localStorage (node): defaults
  }
  return out;
}

function saveGraphics(): void {
  try {
    localStorage.setItem(GRAPHICS_KEY, JSON.stringify(GRAPHICS));
  } catch {
    // private mode
  }
}

/** On/off picture options. Intensities stay in `POSTFX`. */
export const GRAPHICS: Record<GraphicsKey, boolean> = loadGraphics();

export function setGraphic(key: GraphicsKey, on: boolean): void {
  GRAPHICS[key] = on;
  saveGraphics();
}

/** How much of each look is active this frame (toggle × tuned amount). */
function lookAmount(key: GraphicsKey, amount: number): number {
  return GRAPHICS[key] ? amount : 0;
}

/** Final pass: linear -> sRGB, then the retro glass (bend, fringe, vignette, grain). */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: POSTFX.vignette },
    uGrain: { value: POSTFX.grain },
    uAberration: { value: POSTFX.aberration },
    uSaturation: { value: POSTFX.saturation },
    uTired: { value: 0 },
    uBlink: { value: 0 },
    uCurve: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uSaturation, uTired, uBlink, uCurve;
    varying vec2 vUv;
    vec3 toSRGB(vec3 c) {
      c = max(c, 0.0);
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    // Glass tube: the picture bows out toward the corners. uCurve 0 leaves uv alone.
    vec2 bend(vec2 uv) {
      vec2 p = uv * 2.0 - 1.0;
      p *= 1.0 + dot(p, p) * uCurve;
      return p * 0.5 + 0.5;
    }
    void main() {
      vec2 uv = bend(vUv);
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * uAberration * (1.0 + r2 * 6.0);
      vec3 c = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      if (uTired > 0.0) {
        // Tired driver (IMPROVEMENTS #25): a slowly drifting double image, softer contrast, washed colors
        vec2 g = vec2(sin(uTime * 0.37) + 0.6 * sin(uTime * 0.91), cos(uTime * 0.29) + 0.5 * sin(uTime * 0.73)) * 0.0055 * uTired;
        vec3 ghost = vec3(texture2D(tDiffuse, uv + g + off).r, texture2D(tDiffuse, uv + g).g, texture2D(tDiffuse, uv + g - off).b);
        c = mix(c, ghost, 0.42 * uTired);
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation * (1.0 - 0.3 * uTired));
      c = toSRGB(c);
      c = mix(c, c * 0.88 + 0.045, uTired * 0.6);
      c *= 1.0 - min(1.0, uVignette + 0.4 * uTired) * smoothstep(0.08 - 0.06 * uTired, 0.62, r2 * 1.6);
      float n = hash(vUv * 1000.0 + fract(uTime * 7.3) * 91.7) - 0.5;
      c += n * uGrain;
      // Heavy eyelids, in front of the glass: the screen closes from the top and the bottom
      if (uBlink > 0.0) {
        float e = abs(vUv.y - 0.5) * 2.0 + 0.12 * r2;
        float open = 1.0 - uBlink * 1.08;
        c *= 1.0 - smoothstep(open - 0.18, open + 0.02, e);
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * Post-processing: MSAA scene render -> bloom -> finish pass.
 * The scene target is flagged like an XR target so three still applies tone mapping per material while
 * rendering into it: `toneMapped: false` lamps keep their saturated HDR colors and are what blooms.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private overlay: RenderPass;
  /** Added on top of `POSTFX` this frame (the wreck punch, tiredness). */
  readonly boost = { bloom: 0, bloomRadius: 0, bloomThreshold: 0, aberration: 0 };
  /** Tired-driver look 0..1 and eyelid closure 0..1 (IMPROVEMENTS #25). */
  tired = 0;
  blink = 0;
  private target: THREE.WebGLRenderTarget;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.composer = new EffectComposer(renderer, this.target);
    // Flag BOTH ping-pong buffers: the composer clones the target (which drops the flag) and swaps the two
    // every frame, so flagging only one rendered every other frame un-tone-mapped and the bloom strobed.
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    }
    this.composer.setPixelRatio(1); // sizes below are already in drawing-buffer pixels
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(new RenderPass(scene, camera));
    // A second scene drawn over the city with a fresh depth buffer (the coffee shop interior, IMPROVEMENTS
    // #25): where it has no geometry (its window) the city shows through, seen from the same camera.
    this.overlay = new RenderPass(new THREE.Scene(), camera);
    this.overlay.clear = false;
    this.overlay.clearDepth = true;
    this.overlay.enabled = false;
    this.composer.addPass(this.overlay);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), POSTFX.bloom, POSTFX.bloomRadius, POSTFX.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.setSize();
  }

  /**
   * Scene drawn over the city (null: none). A camera of its own, different from the chase camera,
   * replaces the city instead of compositing (the garage showroom).
   */
  setOverlay(scene: THREE.Scene | null, camera?: THREE.Camera): void {
    this.overlay.enabled = scene !== null;
    const replace = camera !== undefined && camera !== this.camera;
    this.overlay.clear = replace;
    this.overlay.clearDepth = true;
    if (scene) this.overlay.scene = scene;
    this.overlay.camera = camera ?? this.camera;
  }

  setSize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setSize(size.x, size.y);
  }

  render(time: number): void {
    // Count draw calls over all passes (the composer renders several times per frame)
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (!POSTFX.enabled) {
      this.renderer.render(this.scene, this.camera);
      if (this.overlay.enabled) {
        const auto = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.overlay.scene, this.camera);
        this.renderer.autoClear = auto;
      }
      return;
    }
    const b = this.boost;
    this.bloom.strength = lookAmount('bloom', POSTFX.bloom) + b.bloom;
    this.bloom.enabled = this.bloom.strength > 0;
    this.bloom.radius = Math.min(1, POSTFX.bloomRadius + b.bloomRadius);
    this.bloom.threshold = Math.max(0, POSTFX.bloomThreshold + b.bloomThreshold);
    const u = this.finish.uniforms;
    u.uTime.value = time;
    u.uVignette.value = lookAmount('vignette', POSTFX.vignette);
    u.uGrain.value = lookAmount('grain', POSTFX.grain);
    u.uAberration.value = lookAmount('aberration', POSTFX.aberration) + b.aberration;
    u.uTired.value = this.tired;
    u.uBlink.value = this.blink;
    u.uSaturation.value = POSTFX.saturation;
    u.uCurve.value = lookAmount('curve', POSTFX.curve);
    this.composer.render();
  }
}
