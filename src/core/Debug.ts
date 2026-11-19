import GUI from 'lil-gui';
import * as THREE from 'three';
import type { Game } from './Game';

interface DebugTargets {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  game: Game;
  /** Called when the free-fly camera is toggled (disable chase cam / player control). */
  onFreeCam: (on: boolean) => void;
}

const FLY_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft'];

/** lil-gui panel (toggled with `~`), stats overlay and a free-fly camera. */
class DebugPanel {
  readonly gui = new GUI({ title: 'Debug (~)' });
  private stats = document.createElement('div');
  private watches: { label: string; fn: () => string }[] = [];
  private t?: DebugTargets;
  private fps = 60;
  private statsTimer = 0;
  private keys = new Set<string>();
  private dragging = false;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  readonly settings = { freeCam: false, flySpeed: 40, hideUi: false };

  constructor() {
    this.gui.hide();
    Object.assign(this.stats.style, {
      position: 'fixed',
      left: '24px',
      top: '84px',
      padding: '4px 8px',
      font: '12px/1.4 monospace',
      color: '#7fffd4',
      background: 'rgba(0,0,0,0.6)',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '1000',
      display: 'none',
    });
    document.body.appendChild(this.stats);

    window.addEventListener('keydown', (e) => {
      if (FLY_KEYS.includes(e.code)) this.keys.add(e.code);
      if (e.code === 'KeyF' && this.visible) this.setFreeCam(!this.settings.freeCam);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get visible(): boolean {
    return !this.gui._hidden;
  }

  attach(t: DebugTargets): void {
    this.t = t;
    const g = this.gui.addFolder('General');
    g.add(t.game, 'paused');
    g.add(t.game, 'timeScale', 0, 2, 0.05);
    g.add(this.settings, 'freeCam')
      .name('free camera (F)')
      .onChange((v: boolean) => this.setFreeCam(v));
    g.add(this.settings, 'flySpeed', 5, 200, 1);
    // For recording footage: hides everything in #ui (HUD, minimap, messages, menus).
    // Stays hidden after closing the debug panel, which also hides the stats overlay.
    g.add(this.settings, 'hideUi')
      .name('hide UI (recording)')
      .onChange((v: boolean) => {
        const ui = document.getElementById('ui');
        if (ui) ui.style.visibility = v ? 'hidden' : '';
      });

    const canvas = t.renderer.domElement;
    canvas.addEventListener('mousedown', () => (this.dragging = this.settings.freeCam));
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.euler.y -= e.movementX * 0.003;
      this.euler.x = THREE.MathUtils.clamp(this.euler.x - e.movementY * 0.003, -1.5, 1.5);
    });
  }

  addFolder(name: string): GUI {
    return this.gui.addFolder(name).close();
  }

  /** Show a live value in the stats overlay. */
  watch(label: string, fn: () => string): void {
    this.watches.push({ label, fn });
  }

  toggle(): void {
    const show = !this.visible;
    this.gui.show(show);
    this.stats.style.display = show ? 'block' : 'none';
    if (!show && this.settings.freeCam) this.setFreeCam(false);
  }

  private setFreeCam(on: boolean): void {
    if (!this.t) return;
    this.settings.freeCam = on;
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    if (on) this.euler.setFromQuaternion(this.t.camera.quaternion, 'YXZ');
    this.t.onFreeCam(on);
  }

  /** Call once per render frame. */
  update(dt: number): void {
    if (!this.t || !this.visible) return;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;
    if (this.settings.freeCam) this.fly(dt);

    this.statsTimer -= dt;
    if (this.statsTimer > 0) return;
    this.statsTimer = 0.25;
    const info = this.t.renderer.info.render;
    const lines = [
      `FPS ${this.fps.toFixed(0)}  sim ${this.t.game.simTimeMs.toFixed(2)} ms`,
      `draws ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k`,
      ...this.watches.map((w) => `${w.label} ${w.fn()}`),
    ];
    this.stats.textContent = lines.join('\n');
  }

  private fly(dt: number): void {
    const cam = this.t!.camera;
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    const fwd = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
    const strafe = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
    const up = k('KeyE') - k('KeyQ');
    const speed = this.settings.flySpeed * (this.keys.has('ShiftLeft') ? 4 : 1) * dt;
    cam.quaternion.setFromEuler(this.euler);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(f, fwd * speed).addScaledVector(r, strafe * speed);
    cam.position.y += up * speed;
  }
}

export const Debug = new DebugPanel();
