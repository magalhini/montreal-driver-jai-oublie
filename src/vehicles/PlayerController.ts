import type { Input } from '../core/Input';
import type { World } from '../core/World';
import type { SpeedLimiter } from '../gameplay/SpeedLimiter';
import type { SimSystem } from '../types';

/** While the horn is held, `horn` events repeat this often (seconds). */
const HORN_REPEAT = 0.6;

/** Maps input to the player's car each simulation step. */
export class PlayerController implements SimSystem {
  private hornCooldown = 0;

  constructor(
    private world: World,
    private input: Input,
    private limiter?: SpeedLimiter,
  ) {}

  update(dt: number): void {
    const car = this.world.player;
    if (this.world.controlLocked) {
      // Brake against the direction of travel (brake input at a standstill would engage reverse), then hold.
      const v = car.phys.state.speed;
      car.input.throttle = v < -1 ? 0.6 : 0;
      car.input.brake = v > 1 ? 0.6 : 0;
      car.input.steer = 0;
      car.input.handbrake = Math.abs(v) <= 1;
      car.input.burnout = false;
      return;
    }
    car.input.throttle = this.input.throttleAxis;
    car.input.brake = this.input.brakeAxis;
    car.input.steer = this.input.steerAxis;
    car.input.handbrake = this.input.isHeld('handbrake');
    car.input.burnout = car.burnout && this.input.isHeld('burnout');
    // Z is a throttle. The clutch slip on top of it lives in the physics, and ends once the wheels hook.
    if (car.input.burnout) car.input.throttle = Math.max(car.input.throttle, 1);
    this.limiter?.apply(car);

    this.hornCooldown -= dt;
    if (!this.input.isHeld('horn')) this.hornCooldown = 0;
    else if (this.hornCooldown <= 0) {
      this.hornCooldown = HORN_REPEAT;
      this.world.events.emit({ type: 'horn' });
    }
  }
}
