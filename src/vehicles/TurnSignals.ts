import { wrapAngle } from '../core/math';
import type { World } from '../core/World';
import type { SimSystem } from '../types';

export const TURN_SIGNAL_TUNING = {
  /** Self-cancel once the car has turned this far (rad) toward the signalled side... */
  cancelTurn: (50 * Math.PI) / 180,
  /** ...and the steering input is back near center (keys released / stick centered). */
  cancelSteer: 0.2,
};

/**
 * Player turn signals (Q / E). They are never an offense. Like a real indicator stalk they
 * switch themselves off when the wheel straightens after a turn; lane changes don't turn far enough to cancel.
 * A taxi passenger may tip when one is used properly (`gameplay/FareTip.ts`).
 */
export class TurnSignals implements SimSystem {
  /** Yaw turned toward the signalled side since it was switched on (rad). */
  private turned = 0;
  private lastYaw = 0;

  constructor(private readonly world: World) {}

  /** Toggles one side (switching from the other side directly). Call from frame input handling. */
  toggle(side: 'left' | 'right'): void {
    const car = this.world.player;
    car.blinker = car.blinker === side ? null : side;
    car.blinkT = 0;
    this.turned = 0;
    this.lastYaw = car.yaw;
  }

  update(): void {
    const car = this.world.player;
    if (!car.blinker) return;
    // Yaw grows when turning left
    const d = wrapAngle(car.yaw - this.lastYaw);
    this.lastYaw = car.yaw;
    this.turned += car.blinker === 'left' ? d : -d;
    const t = TURN_SIGNAL_TUNING;
    if (this.turned > t.cancelTurn && Math.abs(car.input.steer) < t.cancelSteer) car.blinker = null;
  }
}
