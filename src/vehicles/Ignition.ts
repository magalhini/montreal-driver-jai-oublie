import type { World } from '../core/World';
import type { SimSystem } from '../types';

/** Switching off is refused above this speed (m/s): P can't be engaged while rolling. */
const STOP_SPEED = 1.0;
/** Pressing the pedals with the engine off reminds you how to start it, at most this often (s). */
const NAG_EVERY = 4;

/**
 * The player's ignition key (IMPROVEMENTS #21): I switches the engine off and puts the gearbox in P (the car
 * can't move, lamps go dark, the rev counter falls to 0), and I again cranks it back to life.
 */
export class Ignition implements SimSystem {
  private nag = 0;

  constructor(private readonly world: World) {}

  get state(): 'on' | 'off' | 'cranking' {
    const p = this.world.player.phys;
    return p.engineOn ? 'on' : p.cranking ? 'cranking' : 'off';
  }

  /** Call from frame input handling (not while controls are locked). */
  toggle(): void {
    const car = this.world.player;
    const phys = car.phys;
    if (phys.engineOn) {
      if (Math.abs(phys.state.speed) > STOP_SPEED) {
        this.world.events.message('Stop the car before switching off', 'warn');
        return;
      }
      phys.stopEngine();
      car.blinker = null;
    } else phys.startEngine();
  }

  update(dt: number): void {
    this.nag -= dt;
    const car = this.world.player;
    if (car.phys.engineOn || car.phys.cranking || this.world.controlLocked) return;
    if ((car.input.throttle > 0.3 || car.input.brake > 0.3) && this.nag <= 0) {
      this.nag = NAG_EVERY;
      this.world.events.message('Engine off: press I to start', 'info');
    }
  }
}
