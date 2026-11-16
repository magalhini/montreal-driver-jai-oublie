import * as THREE from 'three';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private resizeHooks: ((w: number, h: number) => void)[] = [];
  /** Replaced by PostFX when enabled. */
  renderFn: () => void;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = false;
    this.renderer.localClippingEnabled = true; // cockpit view cuts the cabin out of the player's body
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 1600);
    this.camera.position.set(0, 30, -40);

    this.renderFn = () => this.renderer.render(this.scene, this.camera);

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      for (const f of this.resizeHooks) f(w, h);
    });
  }

  onResize(fn: (w: number, h: number) => void): void {
    this.resizeHooks.push(fn);
  }

  render(): void {
    this.renderFn();
  }
}
