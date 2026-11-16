import type { World } from '../core/World';
import type { Heat } from '../ai/Heat';
import { WANTED_HEAT, type PoliceSystem } from '../ai/PoliceAI';
import type { SimSystem } from '../types';
import type { Closures, ConeLine } from './Closures';
import type { Cones } from './Cones';

/**
 * The street works as rules (PRD 5.3, Phase 7). A cone taper is breached once, when the player has knocked
 * `conesHit` of its cones: clipping one is nothing. Breaches are counted for the session, not forgotten on a
 * timer. The first is phoned in (heat and a line, no cop and no chase); the second tops the meter past
 * `WANTED_HEAT` and sends the nearest patrol at the player, which starts the usual pursuit once it sees them.
 * Further tapers keep adding heat. Loose cones (no line) are only props. Also says so when the car is nose to
 * a fence.
 */
export const CHANTIER_TUNING = {
  /** Cones of one taper the player has to knock before it counts (one or two is a scrape, not a breach). */
  conesHit: 3,
  /** Heat for the first breach and for each one after. */
  firstHeat: 0.12,
  nextHeat: 0.14,
  /** From the second line on the meter lands at least this far past `WANTED_HEAT` (it drains while hidden). */
  wantedMargin: 0.08,
  /** A fence this close ahead in the car's lane, approached at this speed or faster, gets the line (m, m/s). */
  fenceWarn: 40,
  fenceSpeed: 2,
  /** Seconds before the fence line can show again (once per fence anyway). */
  fenceCooldown: 20,
};

const STRIKE_TEXT = [
  'Through the cones. Someone called it in.',
  'That’s twice. The SPVM is bored enough.',
  'Another line of cones. Someone is keeping count.',
];

export class Chantier implements SimSystem {
  /** Lines breached this session (the mission's tally: PRD 5.3). */
  breaches = 0;
  /** Lines already counted, and the cones of each line the player has hit. */
  private readonly breached = new Set<number>();
  private readonly hit = new Map<number, Set<number>>();
  private readonly toldFence = new Set<number>();
  private fenceCooldown = 0;

  constructor(
    private readonly world: World,
    private readonly closures: Closures,
    private readonly cones: Cones,
    private readonly heat: Heat,
    private readonly police: PoliceSystem,
  ) {
    cones.onPlayerHit = (i) => this.coneHit(i);
  }

  /** New session: the tally starts again (the cones stay where they were knocked). */
  reset(): void {
    this.breaches = 0;
    this.breached.clear();
    this.hit.clear();
    this.toldFence.clear();
    this.fenceCooldown = 0;
  }

  private get live(): boolean {
    return this.world.mode !== 'menu' && !this.world.controlLocked;
  }

  update(dt: number): void {
    this.fenceCooldown -= dt;
    if (this.live) this.watchFence();
  }

  private coneHit(i: number): void {
    const line = this.cones.cones[i].line;
    if (line < 0 || !this.live || this.breached.has(line)) return;
    let set = this.hit.get(line);
    if (!set) this.hit.set(line, (set = new Set()));
    set.add(i);
    if (set.size >= CHANTIER_TUNING.conesHit) this.breach(this.closures.lines[line]);
  }

  private breach(l: ConeLine): void {
    const T = CHANTIER_TUNING;
    this.breached.add(l.id);
    this.breaches++;
    const n = this.breaches;
    // From the second line on, the meter lands past the chase threshold even if it drained since the first
    const heat = n === 1 ? T.firstHeat : Math.max(T.nextHeat, WANTED_HEAT + T.wantedMargin - this.heat.value);
    const pos = { x: this.world.player.pos.x, z: this.world.player.pos.z };
    this.world.events.emit({ type: 'offense', kind: 'chantier', pos, witnessed: false, calledIn: true, heat, text: STRIKE_TEXT[Math.min(n, STRIKE_TEXT.length) - 1] });
    if (n >= 2 && !this.heat.inPursuit) this.police.respond(pos);
  }

  /** "Rue barrée": once per fence, when the car is heading into one in its lane. */
  private watchFence(): void {
    const T = CHANTIER_TUNING;
    if (this.fenceCooldown > 0) return;
    const p = this.world.player;
    const at = this.world.city.laneAt(p.pos);
    if (!at) return;
    const h = this.closures.hardOn(at.lane.edgeId);
    if (!h || this.toldFence.has(h.id)) return;
    const v = p.vel.x * at.lane.dir.x + p.vel.z * at.lane.dir.z;
    if (v < T.fenceSpeed || this.closures.barrierAhead(at.lane, p.pos) > T.fenceWarn) return;
    this.toldFence.add(h.id);
    this.fenceCooldown = T.fenceCooldown;
    this.world.events.message('Rue barrée. The GPS didn’t know.', 'warn');
  }

  /** Lines breached (debug). */
  get lines(): number {
    return this.breached.size;
  }
}
