export type Action =
  | 'throttle'
  | 'brake'
  | 'left'
  | 'right'
  | 'handbrake'
  | 'horn'
  | 'camera'
  | 'limiter'
  | 'headlights'
  | 'blinkLeft'
  | 'blinkRight'
  | 'map'
  | 'interact'
  | 'pause'
  | 'debug'
  | 'one'
  | 'two'
  | 'three'
  | 'escape'
  | 'lookBack'
  | 'ignition'
  | 'burnout';

const KEYMAP: Record<string, Action> = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
  ShiftLeft: 'burnout',
  ShiftRight: 'burnout',
  KeyH: 'horn',
  KeyC: 'camera',
  KeyR: 'lookBack',
  KeyI: 'ignition',
  KeyL: 'limiter',
  KeyK: 'headlights',
  KeyM: 'map',
  KeyQ: 'blinkLeft',
  KeyE: 'blinkRight',
  KeyF: 'interact',
  KeyP: 'pause',
  Backquote: 'debug',
  Digit1: 'one',
  Digit2: 'two',
  Digit3: 'three',
  Escape: 'escape',
};

/** Keyboard + gamepad input with held / pressed-this-frame states. */
export class Input {
  private held = new Set<Action>();
  private pressedQueue = new Set<Action>();
  private pressedFrame = new Set<Action>();
  private padPrev = new Set<Action>();

  /** Analog values (gamepad overrides keyboard when active). */
  steerAxis = 0;
  throttleAxis = 0;
  brakeAxis = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.held.has(a)) this.pressedQueue.add(a);
      this.held.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.held.delete(a);
    });
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Call once per render frame before reading `pressed`. */
  poll(): void {
    this.pressedFrame = this.pressedQueue;
    this.pressedQueue = new Set();

    let steer = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    let thr = this.held.has('throttle') ? 1 : 0;
    let brk = this.held.has('brake') ? 1 : 0;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) steer = ax;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05) thr = rt;
      if (lt > 0.05) brk = lt;
      const padNow = new Set<Action>();
      if (pad.buttons[0]?.pressed) padNow.add('handbrake');
      if (pad.buttons[4]?.pressed) padNow.add('burnout'); // LB
      if (pad.buttons[1]?.pressed) padNow.add('horn');
      if (pad.buttons[3]?.pressed) padNow.add('camera');
      if (pad.buttons[5]?.pressed) padNow.add('lookBack'); // RB
      if (pad.buttons[10]?.pressed) padNow.add('ignition'); // left stick click
      if (pad.buttons[2]?.pressed) padNow.add('interact');
      if (pad.buttons[9]?.pressed) padNow.add('pause');
      if (pad.buttons[8]?.pressed) padNow.add('map');
      if (pad.buttons[12]?.pressed) padNow.add('limiter'); // d-pad up
      if (pad.buttons[13]?.pressed) padNow.add('headlights'); // d-pad down
      if (pad.buttons[14]?.pressed) padNow.add('blinkLeft'); // d-pad left
      if (pad.buttons[15]?.pressed) padNow.add('blinkRight'); // d-pad right
      for (const a of padNow) if (!this.padPrev.has(a) && a !== 'handbrake' && a !== 'horn' && a !== 'burnout') this.pressedFrame.add(a);
      this.padHeld = padNow;
      this.padPrev = padNow;
    } else {
      this.padHeld.clear();
    }
    this.steerAxis = steer;
    this.throttleAxis = thr;
    this.brakeAxis = brk;
  }

  private padHeld = new Set<Action>();

  isHeld(a: Action): boolean {
    return this.held.has(a) || this.padHeld.has(a);
  }

  pressed(a: Action): boolean {
    return this.pressedFrame.has(a);
  }
}
