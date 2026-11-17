import type { World } from '../core/World';
import type { SimSystem } from '../types';
import type { TireSet } from './Tires';

/** Snow squalls on the winter map. Playtest numbers live here. */
export const SNOWSTORM_TUNING = {
  /** Seconds of driving in a session before the first squall. */
  firstAfter: 180,
  /** How long a squall lasts at full strength, and how long it takes to build up and to ease off (s). */
  hold: 150,
  ramp: 15,
  /** Calm between the end of one squall and the start of the next (s). */
  calm: 420,
  /** Summer tires keep this share of their grip at the height of a squall (winter tires keep all of it). */
  summerGrip: 0.8,
};

type Phase = 'calm' | 'building' | 'squall' | 'easing';

/**
 * A snow squall a few minutes into the drive (pure sim): the snow thickens over `ramp` seconds, holds for
 * `hold`, and eases off. `intensity` (0..1) drives the flakes and the fog; summer tires lose up to a fifth of
 * their grip with it. A warning goes up as it starts and a note when it passes. The clock only runs while the
 * player has the car (not on the title, the briefing or a cutscene), so the first one always comes mid-drive.
 */
export class Snowstorm implements SimSystem {
  /** 0 calm .. 1 the height of the squall. */
  intensity = 0;
  private phase: Phase = 'calm';
  private t = 0;
  private next: number = SNOWSTORM_TUNING.firstAfter;

  /** Which set is on the car (the warning says what the squall means for it). */
  tireSet: () => TireSet = () => 'summer';

  constructor(private readonly world: World) {}

  /** A fresh session: calm skies, the first squall a few minutes out. */
  reset(): void {
    this.intensity = 0;
    this.phase = 'calm';
    this.t = 0;
    this.next = SNOWSTORM_TUNING.firstAfter;
  }

  /** Grip multiplier for this tire set right now (stacks on the tire's own grip). */
  gripScale(set: TireSet): number {
    return set === 'summer' ? 1 - (1 - SNOWSTORM_TUNING.summerGrip) * this.intensity : 1;
  }

  /** Debug: start a squall now, or end the one blowing. */
  toggle(): void {
    if (this.phase === 'calm') this.start();
    else this.setPhase('easing');
  }

  /** Debug overlay. */
  status(): string {
    const T = SNOWSTORM_TUNING;
    if (this.phase === 'calm') return `calm, squall in ${Math.max(0, this.next - this.t).toFixed(0)} s`;
    const left = this.phase === 'squall' ? T.hold - this.t : this.phase === 'building' ? T.ramp - this.t + T.hold : T.ramp - this.t;
    return `${this.phase} ${(this.intensity * 100).toFixed(0)}%  ${Math.max(0, left).toFixed(0)} s`;
  }

  update(dt: number): void {
    const w = this.world;
    const T = SNOWSTORM_TUNING;
    if (w.mode !== 'free') return;
    // Waiting for the first squall only counts driving time
    if (this.phase === 'calm' && w.controlLocked) return;
    this.t += dt;
    switch (this.phase) {
      case 'calm':
        this.intensity = 0;
        if (this.t >= this.next) this.start();
        break;
      case 'building':
        this.intensity = Math.min(1, this.t / T.ramp);
        if (this.t >= T.ramp) this.setPhase('squall');
        break;
      case 'squall':
        this.intensity = 1;
        if (this.t >= T.hold) this.setPhase('easing');
        break;
      case 'easing':
        this.intensity = Math.max(0, 1 - this.t / T.ramp);
        if (this.t >= T.ramp) {
          this.setPhase('calm');
          this.next = T.calm;
          w.events.message('The squall is passing. The streets are still slick.', 'info', 6);
        }
        break;
    }
  }

  private start(): void {
    this.setPhase('building');
    const text =
      this.tireSet() === 'summer'
        ? 'Snow squall warning: heavy snow for the next few minutes. Your summer tires will lose grip, so brake early.'
        : 'Snow squall warning: heavy snow for the next few minutes. Good thing the winter tires are on.';
    this.world.events.message(text, 'warn', 9);
  }

  private setPhase(p: Phase): void {
    if (p === 'easing' && this.phase === 'building') {
      // Cut short while still building: ease off from where it got to
      this.t = (1 - this.intensity) * SNOWSTORM_TUNING.ramp;
    } else this.t = 0;
    this.phase = p;
  }
}
