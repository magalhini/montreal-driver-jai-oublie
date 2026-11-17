import type { PoliceSystem } from "../ai/PoliceAI";
import type { World } from "../core/World";
import type { SimSystem } from "../types";
import { formatDistance } from "../ui/MapDraw";
import { inBox } from "../world/Features";
import type { PitStop } from "../world/PitStops";

export const PIT_TUNING = {
  /** Count as stopped below this speed (m/s). */
  stopSpeed: 1.2,
  /** Seconds stopped in the service circle before the car goes in. */
  settle: 0.8,
  /** Repair price for a fully wrecked car (scales with damage, never more), and the least it costs. */
  fullRepair: 300,
  minimum: 50,
  /** Damage (0..1) at which a message says where to get the car fixed; it re-arms once the car is below `rearm`. */
  adviseAt: 0.2,
  rearm: 0.1,
  /** How long that message stays up (s): it's a long one to read while driving. */
  adviseSeconds: 9,
};

const HEADINGS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
];

/** Compass direction from `a` to `b` (north is -z). */
function heading(
  a: { x: number; z: number },
  b: { x: number; z: number },
): string {
  const deg = (Math.atan2(b.x - a.x, a.z - b.z) * 180) / Math.PI;
  return HEADINGS[Math.round(((deg + 360) % 360) / 45) % 8];
}

/**
 * Pit stops (IMPROVEMENTS #20): pull in under a gas station canopy and stop in the service circle; the
 * car goes into the pit garage (`ui/PitShop.ts`) for repairs and upgrades. No service while the police
 * are chasing you. Once per visit (drive out from under the canopy to reset).
 */
export class PitStopSystem implements SimSystem {
  /** Station the player is under, and how far along the stop in its circle is (0..1, for the debug overlay). */
  current: PitStop | null = null;
  progress = 0;
  /** Other sequences on screen (bust, wreck, breakdown, recovery). */
  blocked: () => boolean = () => false;
  /** Canopy line for this station, or null for the usual repair / upgrade line. */
  hint: (stop: PitStop) => string | null = () => null;
  private visited = false;
  private arrived: PitStop | null = null;
  /** The damage message was shown (until the car is repaired). */
  private advised = false;

  constructor(
    private readonly world: World,
    private readonly police: PoliceSystem,
  ) {}

  /** What a repair costs right now (0 when the car is fine). */
  quote(): number {
    const dmg = Math.min(1, this.world.player.phys.state.damage);
    if (dmg < 0.01) return 0;
    return Math.max(
      PIT_TUNING.minimum,
      Math.min(
        PIT_TUNING.fullRepair,
        Math.round((dmg * PIT_TUNING.fullRepair) / 10) * 10,
      ),
    );
  }

  /** The station the player just stopped at, once (the frame loop opens the garage). */
  take(): PitStop | null {
    const s = this.arrived;
    this.arrived = null;
    return s;
  }

  /**
   * Once the car is `adviseAt` damaged: where the nearest pit stop is and what to do there. Waits while
   * another sequence has the screen (a wreck, a bust...); shown again only after a repair.
   */
  private advise(open: boolean): void {
    const w = this.world;
    const p = w.player;
    const dmg = p.phys.state.damage;
    if (dmg < PIT_TUNING.rearm) this.advised = false;
    if (
      this.advised ||
      dmg < PIT_TUNING.adviseAt ||
      !open ||
      w.controlLocked ||
      this.blocked()
    )
      return;
    const stops = w.city.features.pitStops;
    if (!stops.length) return;
    this.advised = true;
    const at = (s: PitStop) => ({ x: s.bay.x, z: s.bay.z });
    const near = stops.reduce((a, b) =>
      Math.hypot(at(a).x - p.pos.x, at(a).z - p.pos.z) <=
      Math.hypot(at(b).x - p.pos.x, at(b).z - p.pos.z)
        ? a
        : b,
    );
    const d = Math.hypot(near.bay.x - p.pos.x, near.bay.z - p.pos.z);
    w.events.message(
      `Your car is damaged. Repair it at ${near.name}, ${formatDistance(d)} ${heading(p.pos, near.bay)} (GARAGE on the map)`,
      "warn",
      PIT_TUNING.adviseSeconds,
    );
  }

  update(dt: number): void {
    const w = this.world;
    const p = w.player;
    const stop =
      w.city.features.pitStops.find((s) => inBox(p.pos, s.canopy)) ?? null;
    const driving = w.mode === "free";
    this.advise(driving && !stop);
    if (stop !== this.current) {
      this.current = stop;
      this.progress = 0;
      this.visited = false;
      if (stop && driving) {
        const fix = this.quote();
        w.events.message(
          this.hint(stop) ??
            `${stop.name}: stop in the circle for ${fix > 0 ? "repairs and " : ""}upgrades`,
          "info",
        );
      }
    }
    if (
      !stop ||
      this.visited ||
      !driving ||
      w.controlLocked ||
      this.blocked()
    ) {
      this.progress = 0;
      return;
    }
    const s = p.phys.state;
    const inBay =
      Math.hypot(p.pos.x - stop.bay.x, p.pos.z - stop.bay.z) < stop.bay.r;
    if (!inBay || Math.abs(s.speed) > PIT_TUNING.stopSpeed || s.airborne) {
      this.progress = 0;
      return;
    }
    this.progress = Math.min(1, this.progress + dt / PIT_TUNING.settle);
    if (this.progress < 1) return;
    this.visited = true;
    if (this.police.pursuers > 0) {
      w.events.message('Pit garage: "Not with the SPVM on your tail!"', "warn");
      return;
    }
    this.arrived = stop;
  }
}
