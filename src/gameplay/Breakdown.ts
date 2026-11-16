import type { Heat } from '../ai/Heat';
import type { PoliceSystem } from '../ai/PoliceAI';
import type { World } from '../core/World';
import type { SimSystem, Vec2 } from '../types';
import { BREAKDOWN_DAMAGE, repair } from '../vehicles/Damage';
import { formatCash, type Economy } from './Economy';
import { clearLaneSpot } from './Wreck';

export const BREAKDOWN_TUNING = {
  /** Seconds the wrecked car sits there, smoking, before the screen fades. */
  hold: 5,
  fadeOut: 0.6,
  fadeIn: 0.7,
  /** What the tow and the repair cost. */
  fee: 500,
};

type Phase = 'free' | 'dead' | 'fadeOut' | 'fadeIn';

/**
 * The car falls apart (damage past `BREAKDOWN_DAMAGE`, 120%, while the HUD stops at 100%): the wheels come off,
 * the body drops onto the road, the engine dies and smoke pours from the bonnet (`BreakdownView`). After a few
 * seconds the screen fades and the car is back on a clear lane nearby, repaired, for `fee`. The active job
 * fails (as after a wreck) and, as after a wreck, the police lose you. Not in "take me for a drive".
 */
export class Breakdown implements SimSystem {
  phase: Phase = 'free';
  /** Seconds into the current phase. */
  t = 0;
  fade = 0;
  /** Counts breakdowns: the view rebuilds its loose wheels when it changes. */
  seq = 0;
  /** Other sequences that own the player (bust, wreck, tow...): wait for them. */
  blocked: () => boolean = () => false;
  /** Called after the car is moved (chase camera snap). */
  onRespawn: (() => void) | null = null;
  private anchor: Vec2 = { x: 0, z: 0 };
  private anchorYaw = 0;

  constructor(
    private readonly world: World,
    private readonly economy: Economy,
    private readonly heat: Heat,
    private readonly police: PoliceSystem,
  ) {}

  get active(): boolean {
    return this.phase !== 'free';
  }

  /** The wreck is on screen (the cinematic camera is up). */
  get playing(): boolean {
    return this.phase === 'dead' || this.phase === 'fadeOut';
  }

  update(dt: number): void {
    const w = this.world;
    const T = BREAKDOWN_TUNING;
    this.t += dt;
    switch (this.phase) {
      case 'free': {
        const p = w.player;
        const driving = w.mode === 'free';
        if (driving && p.phys.state.damage >= BREAKDOWN_DAMAGE - 1e-6 && !w.controlLocked && !this.blocked()) this.start();
        return;
      }
      case 'dead':
        this.hold();
        if (this.t >= T.hold) this.go('fadeOut');
        return;
      case 'fadeOut':
        this.hold();
        this.fade = Math.min(1, this.t / T.fadeOut);
        if (this.t >= T.fadeOut) {
          this.respawn();
          this.go('fadeIn');
        }
        return;
      case 'fadeIn':
        this.fade = Math.max(0, 1 - this.t / T.fadeIn);
        if (this.t >= T.fadeIn) {
          this.go('free');
          this.fade = 0;
          w.controlLocked = w.mode === 'menu';
        }
        return;
    }
  }

  /** Abort (quit to title, session reset): the car gets its wheels back. Leaves the control lock to the caller. */
  cancel(): void {
    if (this.phase === 'free') return;
    this.restore();
    this.go('free');
    this.fade = 0;
  }

  private go(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }

  private start(): void {
    const w = this.world;
    const p = w.player;
    this.seq++;
    this.go('dead');
    this.anchor = { x: p.pos.x, z: p.pos.z };
    this.anchorYaw = p.yaw;
    w.controlLocked = true;
    p.blinker = null;
    p.wheelsOff = true;
    p.phys.stopEngine();
    w.events.emit({ type: 'brokeDown' });
    w.events.message(`A tow truck is bringing it back repaired, for ${formatCash(BREAKDOWN_TUNING.fee)}`, 'bad', BREAKDOWN_TUNING.hold + 1);
  }

  /** The wreck stays where it stopped (the physics would still slide it on its tires). */
  private hold(): void {
    const s = this.world.player.phys.state;
    s.vel.x = 0;
    s.vel.z = 0;
    s.yawRate = 0;
    s.speed = 0;
    s.pos.x = this.anchor.x;
    s.pos.z = this.anchor.z;
    s.yaw = this.anchorYaw;
  }

  private restore(): void {
    const p = this.world.player;
    p.wheelsOff = false;
    p.bodyDrop = 0;
  }

  private respawn(): void {
    const w = this.world;
    const p = w.player;
    this.restore();
    repair(p);
    const spot = clearLaneSpot(w, this.anchor);
    p.teleport(spot.pos, spot.yaw);
    this.heat.reset();
    this.police.callOff();
    const fee = this.economy.charge(BREAKDOWN_TUNING.fee);
    w.events.message(fee > 0 ? `Car towed and repaired: -${formatCash(fee)}` : 'Car towed and repaired', 'bad');
    this.onRespawn?.();
  }
}
