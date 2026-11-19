import * as THREE from 'three';
import type { World } from '../core/World';
import type { Vec2 } from '../types';
import type { Pothole } from '../world/Potholes';

/**
 * The first pothole that damages the car, once per page load: time slows, a low camera beside the pit zooms in
 * on the wheel dropping into it (and the rear one after it), then the chase camera cuts back in. A tip stays up
 * for `tip` seconds after, and the player can dismiss it early. Times are real seconds.
 */
export const POTHOLE_CAM = {
  /** Sim speed during the shot. Under 0.2, so a wreck that starts mid-shot puts the clock back to full speed. */
  slow: 0.18,
  /**
   * Slow motion, then a cut back to the chase camera at full speed. At `slow` this is about 0.4 sim s, so the rear
   * wheel finds the pit too. No ramp back up: a wreck mid-ramp would save the half speed and restore it after.
   */
  hold: 2.4,
  /** Fast cars clear the frame sooner: cut once the tail is this far past the pit (m), after at least `minHold`. */
  clear: 0.8,
  minHold: 1.2,
  /** Field of view at the cut, and where the zoom settles. */
  fovFrom: 52,
  fovTo: 34,
  /** Lens: this far out past the pit's rim, ahead of it along the car's heading, and above the road (m). */
  out: 2.6,
  ahead: 2.6,
  height: 1.1,
  tip: 5,
};

const TIP_TEXT = "You just drove through a pothole, be careful! They'll damage your car";

/** Distance from `from` along `dir` to the first building wall, Infinity if none within `max`. */
type WallRay = (from: Vec2, dir: Vec2, max: number) => number;

export class PotholeCam {
  /** Plays once per page load; the debug panel re-arms it. */
  armed = true;
  /** Another scene owns the player or the screen (bust, wreck, garage, intro...). */
  blocked: () => boolean = () => false;
  private phase: 'free' | 'slow' = 'free';
  private t = 0;
  private saved = 1;
  /** The clock value this shot last set. Anything else means another system took the clock. */
  private set = 1;
  private readonly pit = new THREE.Vector3();
  private readonly lens = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly flank = new THREE.Vector3();
  /** Unit vector from the car toward the side whose wheel dropped in, and the heading at the drop. */
  private out: Vec2 = { x: 0, z: 0 };
  private heading: Vec2 = { x: 0, z: 1 };
  private readonly cine: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly tipBar: HTMLElement;
  private tipLeft = 0;

  constructor(
    private readonly world: World,
    private readonly clock: { timeScale: number },
    private readonly ui: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly wallRay: WallRay,
  ) {
    this.cine = document.createElement('div');
    this.cine.className = 'cine pothole-cine';
    this.cine.innerHTML =
      '<div class="cine-bar top"></div><div class="cine-bar bottom"></div><div class="cine-skip"><kbd>ESC</kbd> skip</div>';
    ui.appendChild(this.cine);

    // Outside `.cine`, so it outlives the shot. `cine-keep` keeps it up while the HUD is hidden.
    this.tip = document.createElement('div');
    this.tip.className = 'pothole-tip cine-keep';
    this.tip.innerHTML = `
      <button class="pothole-tip-close" type="button" aria-label="Dismiss">×</button>
      <p></p>
      <div class="pothole-tip-foot"><span><kbd>F</kbd> dismiss</span><div class="pothole-tip-bar"><i></i></div></div>`;
    this.tip.querySelector('p')!.textContent = TIP_TEXT;
    this.tipBar = this.tip.querySelector('.pothole-tip-bar i')!;
    this.tip.querySelector('button')!.addEventListener('click', () => this.dismiss());
    ui.appendChild(this.tip);
  }

  /** The cinematic camera is up. */
  get playing(): boolean {
    return this.phase !== 'free';
  }

  get tipOpen(): boolean {
    return this.tipLeft > 0;
  }

  /** Wheel `wheel` (FL, FR, RL, RR) of the player's car just dropped into `p` and took damage. True if the shot plays. */
  trigger(p: Pothole, wheel: number): boolean {
    const w = this.world;
    if (!this.armed || this.phase !== 'free' || w.mode === 'menu' || this.blocked()) return false;
    this.armed = false;
    const car = w.player;
    const yaw = car.phys.state.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Left of the heading is (cos yaw, -sin yaw); even wheels are on the left
    const side = wheel % 2 === 0 ? 1 : -1;
    this.out = { x: fz * side, z: -fx * side };
    this.heading = { x: fx, z: fz };
    const o = this.out;
    this.pit.set(p.pos.x, this.groundAt(p.pos.x, p.pos.z), p.pos.z);

    // Out past that flank and ahead of the pit, looking down at it: the front tire drops in coming toward the lens,
    // then the car rolls past and the rear one finds the same pit
    const C = POTHOLE_CAM;
    let reach = p.r + C.out;
    const wall = this.wallRay(p.pos, o, reach + 0.6);
    if (wall < reach + 0.6) reach = Math.max(1.2, wall - 0.6);
    const lx = p.pos.x + o.x * reach + fx * C.ahead;
    const lz = p.pos.z + o.z * reach + fz * C.ahead;
    let high = reach < 1.8 ? 1.8 : C.height;
    // A parked car or a cruiser where the lens would be: look down over its roof instead
    for (const c of w.cars) {
      if (c === car || c.removed) continue;
      if ((c.pos.x - lx) ** 2 + (c.pos.z - lz) ** 2 < (c.halfL + 0.6) ** 2) high = 2.1;
    }
    this.lens.set(lx, this.groundAt(lx, lz) + high, lz);

    this.saved = this.clock.timeScale >= 0.2 ? this.clock.timeScale : 1;
    this.clock.timeScale = POTHOLE_CAM.slow;
    this.set = this.clock.timeScale;
    this.phase = 'slow';
    this.t = 0;
    this.cine.classList.add('show');
    this.ui.classList.add('cinematic');
    this.tipLeft = POTHOLE_CAM.tip;
    this.tip.classList.add('show');
    return true;
  }

  /** Every render frame, with real seconds. */
  frame(dt: number, paused: boolean): void {
    this.tip.classList.toggle('held', paused);
    if (this.tipLeft > 0 && !paused) {
      this.tipLeft -= dt;
      this.tipBar.style.transform = `scaleX(${Math.max(0, this.tipLeft / POTHOLE_CAM.tip)})`;
      if (this.tipLeft <= 0) this.hideTip();
    }
    if (this.phase === 'free') return;
    // A wreck took the clock: it puts it back itself
    const taken = this.clock.timeScale !== this.set;
    if (taken || this.blocked()) {
      this.stop(!taken);
      return;
    }
    if (paused) return;
    this.t += dt;
    const car = this.world.player;
    const past = (car.pos.x - this.pit.x) * this.heading.x + (car.pos.z - this.pit.z) * this.heading.z - car.halfL;
    const gone = this.t >= POTHOLE_CAM.minHold && past > POTHOLE_CAM.clear;
    if (gone || this.t >= POTHOLE_CAM.hold) this.stop(true);
  }

  /** The camera while `playing`: fixed beside the pit, following the car's flank a little as it rolls past. */
  aim(camera: THREE.PerspectiveCamera): void {
    const car = this.world.player;
    const s = car.phys.state;
    const reach = Math.max(0.5, car.halfW - 0.18);
    this.flank.set(car.pos.x + this.out.x * reach, s.y + 0.35, car.pos.z + this.out.z * reach);
    // Aimed at the road, so the pit sits mid-frame above the tip and the car fills the top half
    this.look.copy(this.pit).lerp(this.flank, 0.25);
    this.look.y = this.pit.y;
    camera.position.copy(this.lens);
    camera.lookAt(this.look);
    const zoom = 1 - Math.exp(-this.t * 1.4);
    camera.fov = POTHOLE_CAM.fovFrom + (POTHOLE_CAM.fovTo - POTHOLE_CAM.fovFrom) * zoom;
    camera.near = 0.1;
    camera.updateProjectionMatrix();
  }

  /** ESC: back to the chase camera at full speed. The tip stays. */
  skip(): void {
    if (this.phase !== 'free') this.stop(true);
  }

  /** F or the ×: the tip goes, and the shot with it if it's still up. */
  dismiss(): void {
    this.hideTip();
    this.skip();
  }

  /** Quit to title: no shot, no tip. Stays disarmed. */
  cancel(): void {
    this.hideTip();
    this.skip();
  }

  private stop(restore: boolean): void {
    this.phase = 'free';
    this.t = 0;
    if (restore) this.clock.timeScale = this.saved;
    this.cine.classList.remove('show');
    this.ui.classList.remove('cinematic');
    // Close to the chase lens, so the cut back doesn't zoom out across the next second
    this.camera.fov = 66;
    this.camera.updateProjectionMatrix();
  }

  private hideTip(): void {
    this.tipLeft = 0;
    this.tip.classList.remove('show');
  }
}
