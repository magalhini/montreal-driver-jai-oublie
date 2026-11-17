import type { Pathfinder, Route } from '../ai/Pathfinding';
import { dist, fwd } from '../core/math';
import type { World } from '../core/World';
import type { SimSystem, Vec2 } from '../types';

export const GPS_TUNING = {
  /** Seconds between re-plans (a wrong turn shows a new route within this). */
  replan: 0.5,
  /** The custom waypoint counts as reached within this many meters. */
  arrive: 20,
};

/**
 * Satnav (pure sim): the route from the player to the current target, re-planned every `GPS_TUNING.replan`
 * seconds from the player's direction of travel, so taking a wrong turn shows a new route. Two targets: the
 * custom `waypoint` set on the full map (cleared on arrival) and a gameplay `destination` (a delivery stop,
 * or the nearest dispatch the current car can work from). A click replaces the path: the waypoint wins until it is cleared
 * or reached, then the destination is followed again. A fixed destination (the chauffeur's stop) keeps
 * the route and is cleared by whoever set it.
 */
export class Gps implements SimSystem {
  waypoint: Vec2 | null = null;
  destination: Vec2 | null = null;
  /** Radar word for `destination` ('DEST', or 'SUSPECT' while a patrol call is live). */
  destName = 'DEST';
  route: Route | null = null;
  /** Fixed destinations ignore map clicks. Career guidance does not. */
  private fixed = false;
  private timer = 0;

  constructor(
    private readonly world: World,
    private readonly finder: Pathfinder,
  ) {}

  /** What the route leads to. A map click wins over career guidance; a fixed destination keeps the route. */
  get target(): Vec2 | null {
    if (this.waypoint && !this.fixed) return this.waypoint;
    return this.destination ?? this.waypoint;
  }

  /** Meters left along the current route. */
  get remaining(): number {
    return this.route?.length ?? 0;
  }

  /** Custom waypoint (snapped to the nearest road centerline); null clears it. A fixed destination ignores a click. */
  setWaypoint(p: Vec2 | null): void {
    if (this.fixed && p) {
      this.world.events.message('The GPS is set for the garage.', 'info');
      return;
    }
    this.waypoint = p ? { ...this.finder.snap(p).pos } : null;
    this.replan();
  }

  /** `fixed` (the drive-mode stop) is not replaced by a map click. */
  setDestination(p: Vec2 | null, fixed = false): void {
    this.destination = p ? { ...p } : null;
    this.fixed = fixed && this.destination !== null;
    if (!this.destination) this.destName = 'DEST';
    this.replan();
  }

  update(dt: number): void {
    const wp = this.waypoint;
    // Arriving clears the click and falls back to the gameplay destination, if there is one.
    if (wp && !this.fixed && dist(this.world.player.pos, wp) < GPS_TUNING.arrive) {
      this.waypoint = null;
      this.world.events.message('Waypoint reached', 'good');
      this.replan();
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) this.replan();
  }

  /** Re-plan now (also called whenever a target changes). */
  replan(): void {
    this.timer = GPS_TUNING.replan;
    const target = this.target;
    if (!target) {
      this.route = null;
      return;
    }
    const p = this.world.player;
    const heading = p.speed > 2 ? p.vel : fwd(p.yaw);
    this.route = this.finder.findRoute(p.pos, target, { heading });
  }
}
