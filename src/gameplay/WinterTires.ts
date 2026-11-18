import type { Heat } from "../ai/Heat";
import type { World } from "../core/World";
import type { SimSystem, Vec2 } from "../types";
import type { Economy } from "./Economy";
import { DESTINATION_GARAGE, type PitStop } from "../world/PitStops";
import type { Gps } from "./Gps";
import { garageVias, storagePoint, storageVias } from "./MissionRoute";
import { portPicnic } from "./PortPicnic";
import type { Tires } from "./Tires";

/** Workshop sounds for the tire swap, in order (PRD 5.1). */
export type TireCue = "jack" | "wrench" | "ratchet" | "hood";

/** When each tool plays after INSTALL in the garage menu (s). Playtest numbers live here. */
export const TIRE_CUES: { at: number; step: TireCue }[] = [
  { at: 0, step: "jack" },
  { at: 0.55, step: "wrench" },
  { at: 1.5, step: "ratchet" },
];

/**
 * The prize for fitting the tires (dollars). Time and the police each earn a share: the time share is whole up
 * to `parTime` and gone at `slowTime`; the clean share loses `perChase` for every chase that started. Rounded
 * down to `step`, never under `minimum`. A perfect run (fast, never chased) pays `timePrize + cleanPrize`.
 */
export const REWARD_TUNING = {
  timePrize: 1200,
  cleanPrize: 800,
  /** Seconds. The route is about 5.8 km, about 10 min at the limit with the lights. */
  parTime: 9 * 60,
  slowTime: 20 * 60,
  perChase: 400,
  step: 50,
  minimum: 100,
};

/** `m:ss`, the HUD clock and the debrief. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What the garage's TIRES tab offers on this drive. */
export type TireOffer = "ready" | "storage" | "fitted";

/** Shown when the winter-tire drive starts, before the car is released. */
export const MISSION_BRIEF =
  "It's December 1st and you forgot to change to your winter tires! Grab them from storage and head to the garage to change them. The SPVM is watching: drive too fast, run a red light or endanger a pedestrian and they'll be on your tail. Be careful with potholes: drive over them above 30km/h and your car will be damaged.";

/** The stops on the briefing card, in order. */
export const MISSION_STEPS = [
  "Pick up your winter tires from storage",
  "Drive to Jacques-Cartier Pneus Garage to swap them",
  "Park at the Vieux-Port and enjoy your lox bagel",
];

/**
 * The winter-tire run (PRD 5.1, Phase 11). One drive: summer tires, a fixed GPS course that stops for the
 * tires in Griffintown and then takes the long way through downtown to Jacques-Cartier Pneus. There, the garage menu
 * opens on its TIRES tab: INSTALL puts the winter set on. Back on the street, the GPS points at the
 * Vieux-Port lot by the clock tower: stop there and he sits on a bench and eats a lox bagel. The garage
 * will not fit the tires until the storage stop is done. A bust or a breakdown puts you back on the street
 * with the drive still on. The clock runs from the briefing until the bagel is eaten, and it pauses whenever a
 * cutscene has the car (the storage stop, the port, a bust, a wreck). The prize (`REWARD_TUNING`) is scored
 * at INSTALL, for the time so far and for never being chased. Free roam never arms this.
 */
export class WinterTires implements SimSystem {
  /** The drive from the title screen is on (until the tires are on, or you quit). */
  active = false;
  /** The winter set is on. The bay is an ordinary garage after this. */
  done = false;
  /** The coda: the GPS is on the Vieux-Port lot, the bagel is not eaten yet. */
  picnic = false;
  /** He sat by the water. The drive is over. */
  feasted = false;
  /** The storage stop is done. The garage is the pin only after this. */
  pickedUp = false;
  /** Police chases started on this drive. */
  chases = 0;
  /** Seconds on this drive's clock (briefing until the bagel, not counting cutscenes). */
  elapsed = 0;
  /** The prize paid at INSTALL. */
  reward = 0;
  /** Elapsed frozen when the prize was scored, so the bagel leg does not shrink it. */
  private scoreTime = 0;
  private scored = false;
  /** The clock is running (the briefing was dismissed, and the bagel is not eaten). */
  private clock = false;
  private pursuitWas = false;
  /** Fitted in the garage menu; the debrief waits for the car to be back on the street. */
  private debriefOwed = false;
  /** Start fetching the tool clips when the drive begins, so the workshop is not silent. */
  warm: (() => void) | null = null;
  /** Big debrief card, when the tires are on. The feed lines are sent from here either way. */
  onDone:
    | ((result: { chases: number; elapsed: number; reward: number }) => void)
    | null = null;
  /** The bagel card, once he has sat down. */
  onFeast: (() => void) | null = null;

  /** Eastern garage, the one named Jacques-Cartier Pneus. Null only if the city has no pit stops. */
  readonly garage: PitStop | null;
  /** The storage circle on Ottawa, where the winter tires wait. */
  private readonly storage: Vec2;

  constructor(
    private readonly world: World,
    private readonly tires: Tires,
    private readonly gps: Gps,
    private readonly heat: Heat,
    private readonly economy: Economy,
  ) {
    const pits = world.city.features.pitStops;
    this.garage =
      pits.find((p) => p.name === DESTINATION_GARAGE) ??
      (pits.length ? pits.reduce((a, p) => (p.bay.x > a.bay.x ? p : a)) : null);
    this.storage = storagePoint(world.city);
  }

  /**
   * Title -> this drive. Summer tires, the pin fixed on the storage stop. The caller locks the car until the
   * briefing is dismissed, and puts the car on the west spawn.
   */
  arm(): void {
    this.clear();
    this.active = true;
    this.tires.set = "summer";
    this.aimStorage();
    this.warm?.();
  }

  /** Free roam, quit, or a fresh session: the pin is not this drive's anymore. */
  clear(): void {
    this.active = false;
    this.done = false;
    this.picnic = false;
    this.feasted = false;
    this.pickedUp = false;
    this.chases = 0;
    this.elapsed = 0;
    this.reward = 0;
    this.scoreTime = 0;
    this.scored = false;
    this.clock = false;
    this.pursuitWas = false;
    this.debriefOwed = false;
  }

  /** The briefing is dismissed and the car is the player's: the clock starts. */
  startClock(): void {
    if (this.active && !this.feasted) this.clock = true;
  }

  /** HUD clock until the bagel is eaten, null once the drive is over. */
  get clockText(): string | null {
    return this.active && !this.feasted ? formatClock(this.elapsed) : null;
  }

  /** The prize for this run as it stands. Frozen at INSTALL. */
  prize(): number {
    const T = REWARD_TUNING;
    const seconds = this.scored ? this.scoreTime : this.elapsed;
    const late = Math.min(
      1,
      Math.max(0, (seconds - T.parTime) / (T.slowTime - T.parTime)),
    );
    const raw =
      T.timePrize * (1 - late) +
      Math.max(0, T.cleanPrize - T.perChase * this.chases);
    return Math.max(T.minimum, Math.floor(raw / T.step) * T.step);
  }

  /** Canopy line while the drive is on and this bay is the goal. Null keeps the usual repair line. */
  bayHint(stop: PitStop): string | null {
    const offer = this.offer(stop);
    if (offer === "storage")
      return `${stop.name}: the winter tires are still in storage.`;
    if (offer === "ready")
      return `${stop.name}: stop in the circle to put the winter tires on, for free.`;
    return null;
  }

  /** The garage's TIRES tab at this stop, or null for no tab (another garage, free roam, the drive is over). */
  offer(stop: PitStop): TireOffer | null {
    if (!this.active || stop !== this.garage) return null;
    if (this.done) return this.debriefOwed ? "fitted" : null;
    return this.pickedUp ? "ready" : "storage";
  }

  /**
   * INSTALL in the garage menu: the winter set goes on, the prize is scored from the time so far and paid,
   * and the pin is dropped. The clock keeps running until the bagel. Returns the prize and that time, or
   * null when the drive can't take the tires. The debrief waits for the street.
   */
  install(): { reward: number; elapsed: number } | null {
    if (!this.active || this.done || !this.pickedUp) return null;
    this.done = true;
    this.debriefOwed = true;
    this.tires.set = "winter";
    this.scoreTime = this.elapsed;
    this.scored = true;
    this.reward = this.prize();
    this.economy.earn(this.reward);
    // The pin was the drive. Free roam, and the map click, get the GPS back.
    this.gps.setDestination(null);
    return { reward: this.reward, elapsed: this.scoreTime };
  }

  /** The garage closed and the car is back on the street: the tires are on, the bagel is next. Once. */
  leftGarage(): void {
    if (!this.debriefOwed) return;
    this.debriefOwed = false;
    const run = this.chases
      ? "The SPVM joined you there for a bit."
      : "A clean run!";
    this.world.events.message(
      "Winter tires. You're legal. The street isn't.",
      "good",
      8,
    );
    if (this.aimPort()) {
      this.world.events.message(
        `${run} The lox bagel is at the Vieux-Port. Park by the clock tower.`,
        "info",
        9,
      );
    } else {
      this.world.events.message(
        `${run} You deserve the best lox bagel.`,
        "info",
        8,
      );
    }
    this.onDone?.({
      chases: this.chases,
      elapsed: this.elapsed,
      reward: this.reward,
    });
  }

  /** Stopped in the lot and the cutscene finished. The clock stops for good. */
  finishPicnic(): void {
    if (!this.picnic || this.feasted) return;
    this.feasted = true;
    this.picnic = false;
    this.clock = false;
    this.gps.setDestination(null);
    this.world.events.message(
      "Lox on a sesame bagel. The river. The rest of December can wait.",
      "good",
      8,
    );
    this.onFeast?.();
  }

  /** The lot is the pin: tires on, and he has not sat down yet. */
  get wantsPicnic(): boolean {
    return this.active && this.picnic && !this.feasted;
  }

  /**
   * Debug: the winter set is already on and the GPS aims at the lot. No use until the drive is armed.
   */
  debugPicnic(): void {
    if (!this.active) return;
    this.pickedUp = true;
    this.done = true;
    this.debriefOwed = false;
    this.feasted = false;
    this.picnic = false;
    this.tires.set = "winter";
    this.aimPort();
  }

  /** HUD line for the current session. */
  objective(): string {
    if (!this.active) return "Free roam: explore the city";
    if (this.feasted) return "Lox bagel, by the water.";
    if (this.picnic) return "Park at the Vieux-Port, by the clock tower";
    if (this.done) return "Winter tires on. The street isn't.";
    if (!this.pickedUp) return "Pick up the winter tires";
    return "Get to Jacques-Cartier Pneus Garage";
  }

  /** Debug overlay. */
  status(): string {
    if (!this.active) return "off";
    const phase = this.feasted
      ? "bagel"
      : this.picnic
        ? "to the port"
        : this.done
          ? "done"
          : this.pickedUp
            ? "to the garage"
            : "to storage";
    return `${phase}  ${this.tires.set}  ${formatClock(this.elapsed)}  chases ${this.chases}  prize ${this.prize()}`;
  }

  update(dt: number): void {
    const pursuit = this.heat.inPursuit;
    if (this.active && !this.feasted) {
      if (!this.done && pursuit && !this.pursuitWas) this.chases++;
      // A cutscene has the car (storage, the port, a bust, a wreck): the clock waits, then carries on.
      if (this.clock && this.world.mode === "free" && !this.world.controlLocked)
        this.elapsed += dt;
    }
    this.pursuitWas = pursuit;
  }

  /** The storage circle wants the car: the drive is on and the tires are not in it yet. */
  get needsTires(): boolean {
    return this.active && !this.done && !this.pickedUp;
  }

  /** The storage scene put the tires in the trunk: retarget the GPS on the garage. */
  loadTires(): void {
    if (!this.needsTires) return;
    this.pickedUp = true;
    this.aimGarage();
    this.world.events.message(
      "Winter tires are in the trunk. Jacques-Cartier Pneus is on the other side of town.",
      "good",
      7,
    );
  }

  /** The last pin, once the tires are on: the Vieux-Port lot beside the clock tower. */
  private aimPort(): boolean {
    const spot = portPicnic(this.world.city);
    if (!spot) return false;
    this.picnic = true;
    this.feasted = false;
    this.gps.setCourse([], spot.pin, "VIEUX-PORT");
    return true;
  }

  /** The first pin: down Lucien-L'Allier and along Ottawa to the storage circle. */
  private aimStorage(): void {
    this.gps.setCourse(storageVias(this.world.city), this.storage, "STORAGE");
  }

  /** The second pin, only once the tires are in the car: through downtown to Jacques-Cartier Pneus. */
  private aimGarage(): void {
    const g = this.garage;
    if (!g) return;
    this.gps.setCourse(
      garageVias(this.world.city),
      { x: g.bay.x, z: g.bay.z },
      "JACQUES-CARTIER PNEUS",
    );
  }
}
