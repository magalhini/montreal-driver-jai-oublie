import { dot, fwd } from '../core/math';
import type { Rng } from '../core/Rng';
import type { SimSystem, Vec2 } from '../types';
import { project, reversed, segDir, tangentAt } from './Polyline';
import type { CityModel } from './RoadGraph';

export type LightState = 'green' | 'yellow' | 'red';

export const GREEN_T = 13;
export const YELLOW_T = 3;
export const ALLRED_T = 1.6;
const HALF = GREEN_T + YELLOW_T + ALLRED_T;
/** Offsets are drawn over two phases on every map (the grid's cycle), so the random stream doesn't depend on the map. */
const OFFSET_SPAN = HALF * 2;
/** Approaches this close to straight across from each other share a phase. */
const OPPOSITE_DEG = 35;
/** Creeping or stopped, not rolling through (m/s). */
const WAIT_SPEED = 3;
/** Still queued for this light, not stopped back up the block (m before the stop line). */
const WAIT_REACH = 35;
/**
 * A red the player is sitting at ends in 75% of the time: that junction's clock runs at 4/3 until their
 * direction turns green. Their own green is left alone.
 */
const WAIT_HURRY = 1 / 0.75 - 1;

/**
 * Per-junction signal phases (T43). A junction's approaches (edges with lanes entering it) are grouped:
 * roughly opposite approaches (within 35 degrees of straight) share a phase, every other approach gets its
 * own. The groups take turns (green, yellow, all red), ordered by direction starting from the x axis, so
 * a grid crossing runs x, then z, exactly as before. Exit-only arms (one-way roads leaving) have no phase.
 */
export class TrafficLights implements SimSystem {
  private offsets: Float32Array;
  /** Phase group of each (node, edge) approach (-1 = no lanes entering), and groups per node. */
  private group = new Map<number, number>();
  private groups: Uint8Array;
  time = 0;
  /** Incremented whenever any light may have changed (cheap view invalidation). */
  version = 0;
  private lastBucket = -1;
  /** The player, once the session exists. Null while a menu has the car. */
  private waiter: (() => { pos: Vec2; yaw: number; speed: number } | null) | null = null;

  constructor(private city: CityModel, rng: Rng) {
    this.offsets = new Float32Array(city.nodes.length);
    this.groups = new Uint8Array(city.nodes.length);
    for (const n of city.nodes) this.offsets[n.id] = rng.range(0, OFFSET_SPAN);
    for (const n of city.nodes) this.groups[n.id] = this.groupApproaches(n.id);
  }

  /** Who might be waiting at a red. While they sit there, that approach changes 25% sooner. */
  forWaiting(waiter: () => { pos: Vec2; yaw: number; speed: number } | null): void {
    this.waiter = waiter;
  }

  private key(nodeId: number, edgeId: number): number {
    return nodeId * 65536 + edgeId;
  }

  /** Pair opposite approaches (closest pairs first) and number the groups by direction. */
  private groupApproaches(nodeId: number): number {
    const city = this.city;
    const n = city.nodes[nodeId];
    const arms: { edge: number; dir: Vec2; ang: number }[] = [];
    for (const eid of n.edges) {
      const e = city.edges[eid];
      if (!city.lanesEntering(e, nodeId).length) {
        this.group.set(this.key(nodeId, eid), -1);
        continue;
      }
      // Direction from the junction out along the arm
      const dir = segDir(e.a === nodeId ? e.pts : reversed(e.pts), 0);
      const a = Math.atan2(dir.z, dir.x);
      arms.push({ edge: eid, dir, ang: ((a % Math.PI) + Math.PI) % Math.PI });
    }
    const pairs: [number, number, number][] = [];
    const cos = Math.cos((OPPOSITE_DEG * Math.PI) / 180);
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const c = -(arms[i].dir.x * arms[j].dir.x + arms[i].dir.z * arms[j].dir.z);
        if (c >= cos) pairs.push([c, i, j]);
      }
    }
    pairs.sort((p, q) => q[0] - p[0]);
    const groupOf = new Array<number>(arms.length).fill(-1);
    const sets: number[][] = [];
    for (const [, i, j] of pairs) {
      if (groupOf[i] >= 0 || groupOf[j] >= 0) continue;
      groupOf[i] = groupOf[j] = sets.length;
      sets.push([i, j]);
    }
    arms.forEach((_, i) => groupOf[i] < 0 && ((groupOf[i] = sets.length), sets.push([i])));
    // Order groups by direction (mod 180 degrees) from the x axis
    const order = sets.map((s, k) => ({ k, ang: Math.min(...s.map((i) => arms[i].ang)) })).sort((p, q) => p.ang - q.ang);
    const rank = new Array<number>(sets.length);
    order.forEach((o, r) => (rank[o.k] = r));
    arms.forEach((a, i) => this.group.set(this.key(nodeId, a.edge), rank[groupOf[i]]));
    return sets.length;
  }

  update(dt: number): void {
    this.time += dt;
    this.hurryForWaiter(dt);
    const bucket = Math.floor(this.time * 4);
    if (bucket !== this.lastBucket) {
      this.lastBucket = bucket;
      this.version++;
    }
  }

  /** Number of phases a junction cycles through (0 / 1 = always green). */
  phases(nodeId: number): number {
    return this.city.nodes[nodeId].signalized ? this.groups[nodeId] : 0;
  }

  /** Phase group of an approach (-1 if no lanes enter the junction from it). */
  groupOf(nodeId: number, edgeId: number): number {
    return this.group.get(this.key(nodeId, edgeId)) ?? -1;
  }

  /**
   * Stopped at a red, pointed along the lane: pull that junction's clock forward so the player's direction
   * turns green in three quarters of the remaining wait. Stops the moment their light is no longer red.
   */
  private hurryForWaiter(dt: number): void {
    const car = this.waiter?.();
    if (!car || car.speed > WAIT_SPEED) return;
    const at = this.city.laneAt(car.pos);
    if (!at) return;
    const lane = at.lane;
    const nodeId = lane.to;
    if (this.phases(nodeId) < 2 || this.state(nodeId, lane.edgeId) !== 'red') return;
    const pr = project(lane.pts, lane.cum, car.pos);
    const toStop = lane.length - pr.s;
    if (toStop < -1.5 || toStop > WAIT_REACH) return;
    if (dot(fwd(car.yaw), tangentAt(lane.pts, lane.cum, pr.s)) < 0.5) return;
    this.offsets[nodeId] += dt * WAIT_HURRY;
  }

  /** The phase running now and the seconds into it. */
  private phaseNow(nodeId: number): { k: number; t: number } {
    const g = this.groups[nodeId];
    const t = (this.time + this.offsets[nodeId]) % (HALF * g);
    const k = Math.floor(t / HALF);
    return { k, t: t - k * HALF };
  }

  /** Signal facing traffic on edge `edgeId` arriving at node `nodeId`. */
  state(nodeId: number, edgeId: number): LightState {
    const n = this.city.nodes[nodeId];
    if (!n.signalized || this.groups[nodeId] < 2) return 'green';
    const mine = this.groupOf(nodeId, edgeId);
    const { k, t } = this.phaseNow(nodeId);
    if (k !== mine) return 'red';
    if (t < GREEN_T) return 'green';
    if (t < GREEN_T + YELLOW_T) return 'yellow';
    return 'red';
  }

  /** Seconds of green remaining for an approach (0 if not green). */
  greenLeft(nodeId: number, edgeId: number): number {
    if (this.state(nodeId, edgeId) !== 'green') return 0;
    if (!this.city.nodes[nodeId].signalized || this.groups[nodeId] < 2) return 99;
    return GREEN_T - this.phaseNow(nodeId).t;
  }

  /**
   * Seconds pedestrians crossing approach `edgeId` have before its traffic may move: while it is red and
   * another approach is in its green, that green's time left; else 0 (99 at junctions without signals).
   */
  walkLeft(nodeId: number, edgeId: number): number {
    if (!this.city.nodes[nodeId].signalized || this.groups[nodeId] < 2) return 99;
    if (this.state(nodeId, edgeId) !== 'red') return 0;
    const { k, t } = this.phaseNow(nodeId);
    if (k === this.groupOf(nodeId, edgeId) || t >= GREEN_T) return 0;
    return GREEN_T - t;
  }
}
