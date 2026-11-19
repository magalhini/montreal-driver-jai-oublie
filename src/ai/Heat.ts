import type { World } from '../core/World';
import type { GameEvent, OffenseKind, SimSystem } from '../types';

export type OffenseEvent = Extract<GameEvent, { type: 'offense' }>;

/** Felony added per witnessed offense (meter is 0..1). */
export const OFFENSE_HEAT: Record<OffenseKind, number> = {
  redLight: 0.1,
  speeding: 0.06,
  wrongWay: 0.08,
  carCrash: 0.12,
  policeCrash: 0.25,
  pedEndangered: 0.12,
  sidewalk: 0.05,
  chantier: 0.12,
};

export const OFFENSE_TEXT: Record<OffenseKind, string> = {
  redLight: 'Ran a red light!',
  speeding: 'Speeding!',
  wrongWay: 'Wrong way!',
  carCrash: 'Hit a car!',
  policeCrash: 'Rammed an SPVM car!',
  pedEndangered: 'Endangered a pedestrian!',
  sidewalk: 'Driving on the sidewalk!',
  chantier: 'Through the cones. Someone called it in.',
};

/**
 * Offenses charged only once per pursuit (IMPROVEMENTS #13): the police are already chasing you for them,
 * so repeats while the chase goes on add no heat (and no message). Other offenses always count.
 */
export const ONCE_PER_PURSUIT: readonly OffenseKind[] = ['speeding', 'wrongWay'];

const MESSAGE_COOLDOWN = 2.5;
const PUSHED_TIME = 2;
/** No pursuit for this long: the once-per-pursuit charges are forgotten (the offense that starts a chase is seen a step before the police report the pursuit). */
const CHASE_OVER = 1;

/** Escape knobs (live-tunable from the debug panel). */
export const HEAT_TUNING = {
  /** Seconds out of every cop's sight before the meter starts to drain. */
  drainDelay: 3,
  /** Meter drained per second while hidden (pursuit or not). */
  drain: 0.04,
};

const perKind = (): Record<OffenseKind, number> => ({
  redLight: 0,
  speeding: 0,
  wrongWay: 0,
  carCrash: 0,
  policeCrash: 0,
  pedEndangered: 0,
  sidewalk: 0,
  chantier: 0,
});

/**
 * Felony meter. Consumes raw offenses (`witnessed: false`) from all detectors, asks `witness` whether
 * anyone saw it, and for witnessed ones raises the meter, shows a message and re-emits the offense
 * with `witnessed: true` (listeners that react to seen offenses filter on that flag).
 * Speeding and wrong-way driving are charged once per pursuit (`ONCE_PER_PURSUIT`).
 * The meter only drains while no cop has seen the player for `HEAT_TUNING.drainDelay` seconds, so
 * escaping is about breaking line of sight; the police end the pursuit (`escaped`) after `loseTime`.
 */
export class Heat implements SimSystem {
  /** 0..1 */
  value = 0;
  /** Set by `PoliceSystem` (line of sight from any cop). */
  witness: (o: OffenseEvent) => boolean = () => true;
  /** Set by the police each step. */
  inPursuit = false;
  /** Seconds since any cop saw the player (set by the police each step). */
  unseen = Infinity;
  readonly detected = perKind();
  readonly witnessed = perKind();
  /** Witnessed repeats of ONCE_PER_PURSUIT offenses that added nothing. */
  readonly waived = perKind();
  private msgCooldown = perKind();
  /** ONCE_PER_PURSUIT kinds already charged in the current pursuit. */
  private charged = new Set<OffenseKind>();
  private calm = 0;

  constructor(private world: World) {
    world.events.on('offense', (e) => {
      if (!e.witnessed) this.onOffense(e);
    });
  }

  /** Out of sight long enough for the meter to drain. */
  get hidden(): boolean {
    return this.unseen > HEAT_TUNING.drainDelay;
  }

  /** Pursued but hidden: the HUD flashes the meter. (Not while the player is locked: busted, menus.) */
  get evading(): boolean {
    return this.inPursuit && this.hidden && !this.world.controlLocked;
  }

  update(dt: number): void {
    this.calm = this.inPursuit ? 0 : this.calm + dt;
    if (this.calm > CHASE_OVER) this.charged.clear();
    if (this.hidden && !this.world.controlLocked) this.value = Math.max(0, this.value - HEAT_TUNING.drain * dt);
    for (const k in this.msgCooldown) this.msgCooldown[k as OffenseKind] -= dt;
  }

  reset(): void {
    this.value = 0;
    this.charged.clear();
  }

  private onOffense(e: OffenseEvent): void {
    const p = this.world.player;
    // Being shoved around (hit recently, not on the throttle) is not the player's fault.
    if (p.lastHit < PUSHED_TIME && p.input.throttle < 0.1) return;
    this.detected[e.kind]++;
    if (this.world.immune || this.world.onCourse || this.world.noChase) return;
    // A called-in offense counts without a cop, and a cop who happens to see it does not jump into a chase over
    // it (the cone lines: `gameplay/Chantier.ts` decides when a patrol is sent). Anything else needs a witness.
    if (!e.calledIn && !this.witness(e)) return;
    this.witnessed[e.kind]++;
    if (ONCE_PER_PURSUIT.includes(e.kind)) {
      if (this.charged.has(e.kind)) {
        this.waived[e.kind]++;
        this.world.events.emit({ ...e, witnessed: true });
        return;
      }
      this.charged.add(e.kind);
      this.calm = 0; // the chase this starts is reported by the police a step later
    }
    this.value = Math.min(1, this.value + (e.heat ?? OFFENSE_HEAT[e.kind]));
    if (this.msgCooldown[e.kind] <= 0 || e.text) {
      this.msgCooldown[e.kind] = MESSAGE_COOLDOWN;
      this.world.events.message(e.text ?? OFFENSE_TEXT[e.kind], 'bad');
    }
    this.world.events.emit({ ...e, witnessed: true });
  }
}
