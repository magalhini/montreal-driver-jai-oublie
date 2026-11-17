import type { Heat } from '../ai/Heat';
import { dist } from '../core/math';
import type { World } from '../core/World';
import type { SimSystem, Vec2 } from '../types';
import { DESTINATION_GARAGE, type PitStop } from '../world/PitStops';
import { GPS_TUNING, type Gps } from './Gps';
import { garageVias, storagePoint, storageVias } from './MissionRoute';
import type { Tires } from './Tires';

/** Forecourt sounds for the tire mount, in order (PRD 5.1). */
export type TireCue = 'jack' | 'wrench' | 'ratchet' | 'hood';

/**
 * How long the bay holds the car, and when each tool plays. The last cue finishes before the car is released.
 * Playtest numbers live here.
 */
export const WINTER_TUNING = {
  /** Seconds from the lock until the winter tires are on and the car is yours again. */
  mount: 8.4,
  cues: [
    { at: 0.35, step: 'jack' },
    { at: 2.3, step: 'wrench' },
    { at: 4.7, step: 'ratchet' },
    { at: 6.9, step: 'hood' },
  ] as { at: number; step: TireCue }[],
};

/** Shown when the winter-tire drive starts, before the car is released. */
export const MISSION_BRIEF =
  "It's December 1st and you forgot to change to your winter tires. Your goal: make it to the garage to change your tires in the other side of the city. The SPVM is watching: drive too fast, run a red light or a STOP sign and they'll be on your tail. Be careful about potholes: drive over them too fast and your car will be severely damaged.";

/** The two stops on the briefing card, in order. */
export const MISSION_STEPS = [
  'Pick up your winter tires from storage',
  'Drive to Jacques Pneu Garage to swap them',
];

/**
 * The winter-tire run (PRD 5.1, Phase 11). One drive: summer tires, a fixed GPS course that stops for the
 * tires in Griffintown and then takes the long way through downtown to Jacques Pneu, and the mount in that
 * bay. The garage will not fit them until the storage stop is done. A bust or a breakdown puts you back on
 * the street with the drive still on. There is no clock. Free roam never arms this.
 */
export class WinterTires implements SimSystem {
  /** The drive from the title screen is on (until the tires are on, or you quit). */
  active = false;
  /** The winter set is on. The bay is an ordinary garage after this. */
  done = false;
  /** The storage stop is done. The garage is the pin only after this. */
  pickedUp = false;
  /** A chase or a bust happened on this drive. The debrief says so. */
  chased = false;
  /** The car is locked in the bay while the tires go on. */
  mounting = false;
  /** Shop visit at the destination, still owed the free mount when it closes. */
  private pendingMount = false;
  private mountT = 0;
  /** True while a cue at this time has already played (mount clock). */
  private played = 0;
  /** Other sequences own the car (bust, tow, wreck). */
  blocked: () => boolean = () => false;
  /** Garage clips, wired once the audio graph exists. */
  onCue: ((step: TireCue) => void) | null = null;
  /** Start fetching the clips when the drive begins, so the bay is not silent. */
  warm: (() => void) | null = null;
  /** Big debrief card. The feed line is sent from here either way. */
  onDone: ((chased: boolean) => void) | null = null;

  /** Eastern garage, the one named Jacques Pneu. Null only if the city has no pit stops. */
  readonly garage: PitStop | null;
  /** De la Montagne & Ottawa, where the winter tires are stored. */
  private readonly storage: Vec2;

  constructor(
    private readonly world: World,
    private readonly tires: Tires,
    private readonly gps: Gps,
    private readonly heat: Heat,
  ) {
    const pits = world.city.features.pitStops;
    this.garage =
      pits.find((p) => p.name === DESTINATION_GARAGE) ??
      (pits.length ? pits.reduce((a, p) => (p.bay.x > a.bay.x ? p : a)) : null);
    this.storage = storagePoint(world.city);
    world.events.on('busted', () => {
      if (this.active && !this.done) this.chased = true;
    });
  }

  /**
   * Title -> this drive. Summer tires, the pin fixed on the storage stop. The caller locks the car until the
   * briefing is dismissed, and puts the car on the west spawn.
   */
  arm(): void {
    this.active = true;
    this.done = false;
    this.pickedUp = false;
    this.chased = false;
    this.mounting = false;
    this.pendingMount = false;
    this.mountT = 0;
    this.played = 0;
    this.tires.set = 'summer';
    this.aimStorage();
    this.warm?.();
  }

  /** Free roam, quit, or a fresh session: the pin is not this drive's anymore. */
  clear(): void {
    this.active = false;
    this.done = false;
    this.pickedUp = false;
    this.chased = false;
    this.mounting = false;
    this.pendingMount = false;
    this.mountT = 0;
    this.played = 0;
  }

  /** Canopy line while the drive is on and this bay is the goal. Null keeps the usual repair line. */
  bayHint(stop: PitStop): string | null {
    if (this.waitingOnStorage(stop)) return `${stop.name}: the winter tires are still in storage.`;
    if (!this.isGoal(stop)) return null;
    const hurt = this.world.player.phys.state.damage >= 0.01;
    return hurt
      ? `${stop.name}: stop in the circle. Repair first, then the winter tires go on for free.`
      : `${stop.name}: stop in the circle. The winter tires go on here, for free.`;
  }

  /**
   * The player stopped in a bay. The destination offers a paid repair first when the car is hurt, then the
   * free mount. Any other bay is the repair shop only.
   */
  arrival(stop: PitStop): 'mount' | 'repair' | 'shop' {
    if (this.waitingOnStorage(stop)) {
      this.world.events.message('The winter tires are still in storage.', 'info');
      return 'shop';
    }
    if (!this.isGoal(stop)) return 'shop';
    if (this.world.player.phys.state.damage >= 0.01) {
      this.pendingMount = true;
      return 'repair';
    }
    return 'mount';
  }

  /** The destination shop just closed. True once, when the mount is still owed. */
  consumeMount(): boolean {
    const owed = this.pendingMount && this.active && !this.done && !this.mounting;
    this.pendingMount = false;
    return owed;
  }

  /** Lock the car and play the tire change. */
  beginMount(): void {
    if (!this.active || !this.pickedUp || this.done || this.mounting || this.blocked()) return;
    this.pendingMount = false;
    this.mounting = true;
    this.mountT = 0;
    this.played = 0;
    this.world.controlLocked = true;
    const name = this.garage?.name ?? DESTINATION_GARAGE;
    this.world.events.message(`${name}: winter tires going on.`, 'info');
  }

  /** HUD line for the current session. */
  objective(): string {
    if (!this.active) return 'Free roam: explore the city';
    if (this.mounting) return 'Winter tires going on';
    if (this.done) return "Winter tires on. The street isn't.";
    if (!this.pickedUp) return 'Pick up the winter tires';
    return 'Get to Jacques Pneu Garage';
  }

  /** Debug overlay. */
  status(): string {
    if (!this.active) return 'off';
    const phase = this.mounting ? `mount ${this.mountT.toFixed(1)}s` : this.done ? 'done' : this.pickedUp ? 'to the garage' : 'to storage';
    return `${phase}  ${this.tires.set}  ${this.chased ? 'chased' : 'clean'}`;
  }

  update(dt: number): void {
    if (this.active && !this.done && this.heat.inPursuit) this.chased = true;
    this.watchStorage();
    if (!this.mounting) return;
    // A bust or a tow takes the car. The drive stays on; the bay will mount the tires the next time.
    if (this.blocked() || this.world.mode !== 'free') {
      this.mounting = false;
      this.mountT = 0;
      this.played = 0;
      return;
    }
    this.world.controlLocked = true;
    const prev = this.mountT;
    this.mountT += dt;
    for (let i = this.played; i < WINTER_TUNING.cues.length; i++) {
      const cue = WINTER_TUNING.cues[i];
      if (prev < cue.at && this.mountT >= cue.at) {
        this.played = i + 1;
        this.onCue?.(cue.step);
      }
    }
    if (this.mountT >= WINTER_TUNING.mount) this.finish();
  }

  private waitingOnStorage(stop: PitStop): boolean {
    return this.active && !this.done && !this.pickedUp && stop === this.garage;
  }

  private isGoal(stop: PitStop): boolean {
    return this.pickedUp && this.active && !this.done && !this.mounting && !this.pendingMount && stop === this.garage;
  }

  /** The first pin: down Lucien-L'Allier to the storage corner. */
  private aimStorage(): void {
    this.gps.setCourse(storageVias(this.world.city), this.storage, 'STORAGE');
  }

  /** The second pin, only once the tires are in the car: through downtown to Jacques Pneu. */
  private aimGarage(): void {
    const g = this.garage;
    if (!g) return;
    this.gps.setCourse(garageVias(this.world.city), { x: g.bay.x, z: g.bay.z }, 'JACQUES PNEU');
  }

  /** Driving through the storage corner loads the tires and retargets the GPS. */
  private watchStorage(): void {
    if (!this.active || this.done || this.pickedUp || this.mounting) return;
    if (dist(this.world.player.pos, this.storage) >= GPS_TUNING.arrive) return;
    this.pickedUp = true;
    this.aimGarage();
    this.world.events.message('Winter tires are in the car. Jacques Pneu is on the other side of town.', 'good', 7);
  }

  private finish(): void {
    this.mounting = false;
    this.done = true;
    this.tires.set = 'winter';
    // The pin was the drive. Free roam, and the map click, get the GPS back.
    this.gps.setDestination(null);
    if (this.world.mode === 'free' && !this.blocked()) this.world.controlLocked = false;
    const run = this.chased ? 'The SPVM joined you there for a bit.' : 'A clean run!';
    this.world.events.message("Winter tires. You're legal. The street isn't.", 'good', 8);
    this.world.events.message(`${run} You deserve the best lax bagel.`, 'info', 8);
    this.onDone?.(this.chased);
  }
}
