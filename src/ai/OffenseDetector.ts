import { CONFIG, KMH } from '../config';
import type { World } from '../core/World';
import type { Lane, OffenseKind, RoadEdge, SimSystem, Vec2 } from '../types';
import { cumulative, project, tangentAt } from '../world/Polyline';

/** Minimum speed along the road for a stop-line crossing to count. */
const RED_MIN_SPEED = 1.5;
const SPEEDING_OVER = CONFIG.SPEEDING_MARGIN_KMH * KMH;
const SPEEDING_DELAY = 0.5;
const SPEEDING_REPEAT = 6;
/** Center must be this far over the centerline (short overtakes and wide turns are fine). */
const WRONG_LAT = 1;
const WRONG_MIN_SPEED = 3;
const WRONG_DELAY = 1;
const WRONG_REPEAT = 5;

/** Speed (m/s) above which driving on a road with this posted limit counts as speeding. */
export function speedingThreshold(postedLimit: number): number {
  return postedLimit + SPEEDING_OVER;
}
const CRASH_MIN_IMPULSE = 1800;
/** The player must be driving toward the other car at least this fast (being rammed is not an offense). */
const CRASH_CLOSING = 1.5;
const CRASH_COOLDOWN = 2;
/** A position jump larger than this in one step is a teleport: forget tracking state. */
const TELEPORT = 5;

interface Approach {
  node: number;
  dStop: number;
}

const edgeCum = new WeakMap<RoadEdge, number[]>();
/** The player against an edge's centerline: lateral offset (+ = left of a -> b) and speed along it (+ = toward b). */
function onEdge(e: RoadEdge, p: Vec2, vel: Vec2): { lateral: number; v: number } {
  let cum = edgeCum.get(e);
  if (!cum) edgeCum.set(e, (cum = cumulative(e.pts)));
  const pr = project(e.pts, cum, p);
  const t = tangentAt(e.pts, cum, pr.s);
  return { lateral: pr.lateral, v: vel.x * t.x + vel.z * t.z };
}

/** Signed distance to a lane's stop line along the lane (negative once past it). */
function toStopLine(l: Lane, p: Vec2): number {
  const pr = project(l.pts, l.cum, p);
  if (pr.s < l.length) return l.length - pr.s;
  return -((p.x - l.end.x) * l.endDir.x + (p.z - l.end.z) * l.endDir.z);
}

/**
 * Detects the player's traffic offenses: running a red light (crossing a stop line on red), speeding
 * (limit + margin), wrong-way driving and crashing into cars. Red light and wrong way work on any road shape
 * (T43): the car is projected onto the lane / centerline polylines. Emits `offense` with `witnessed: false`;
 * `Heat` decides whether anyone saw it.
 */
export class OffenseDetector implements SimSystem {
  private approach: Approach | null = null;
  private lastEdge: RoadEdge | null = null;
  private speedingT = 0;
  private nextSpeeding = SPEEDING_DELAY;
  private wrongT = 0;
  private nextWrong = WRONG_DELAY;
  private crashCooldown = new Map<number, number>();
  private last: Vec2 = { x: 0, z: 0 };

  constructor(private world: World) {
    world.events.on('collision', (e) => {
      const p = world.player;
      if (world.controlLocked || e.b === null || e.impulse < CRASH_MIN_IMPULSE) return;
      if (e.a !== p.id && e.b !== p.id) return;
      const other = world.carById(e.a === p.id ? e.b : e.a);
      if (!other || (this.crashCooldown.get(other.id) ?? 0) > world.time) return;
      const dx = other.pos.x - p.pos.x;
      const dz = other.pos.z - p.pos.z;
      const toward = (p.vel.x * dx + p.vel.z * dz) / (Math.hypot(dx, dz) || 1);
      if (toward < CRASH_CLOSING) return;
      this.crashCooldown.set(other.id, world.time + CRASH_COOLDOWN);
      this.emit(other.kind === 'police' ? 'policeCrash' : 'carCrash', e.pos);
    });
  }

  update(dt: number): void {
    const w = this.world;
    const car = w.player;
    const pos = car.pos;
    const jumped = Math.abs(pos.x - this.last.x) + Math.abs(pos.z - this.last.z) > TELEPORT;
    this.last.x = pos.x;
    this.last.z = pos.z;
    if (w.controlLocked || jumped) {
      this.approach = null;
      this.speedingT = this.wrongT = 0;
      return;
    }
    const hit = w.city.roadAt(pos);
    if (hit?.edge) this.lastEdge = hit.edge;
    else if (!hit) this.lastEdge = null;

    this.checkRedLight(hit?.edge ?? null);
    this.checkSpeeding(dt);
    this.checkWrongWay(hit?.edge ?? null, dt);
  }

  private checkRedLight(edge: RoadEdge | null): void {
    if (!edge) {
      // Inside a junction (or off road): keep the approach so the crossing into the box is seen next step.
      if (!this.world.city.nodeBoxAt(this.world.player.pos)) this.approach = null;
      return;
    }
    const { city, lights, player } = this.world;
    const { v } = onEdge(edge, player.pos, player.vel);
    if (Math.abs(v) < RED_MIN_SPEED) {
      this.approach = null;
      return;
    }
    const node = city.nodes[v > 0 ? edge.b : edge.a];
    // Distance to the stop line along the lane into that junction nearest the car (none: against a one-way)
    let lane: Lane | null = null;
    let best = Infinity;
    for (const id of city.lanesEntering(edge, node.id)) {
      const l = city.lanes[id];
      const d = project(l.pts, l.cum, player.pos).dist;
      if (d < best) (best = d), (lane = l);
    }
    if (!lane) {
      this.approach = null;
      return;
    }
    const dStop = toStopLine(lane, player.pos);
    const prev = this.approach;
    if (prev && prev.node === node.id && prev.dStop > 0 && dStop <= 0 && lights.state(node.id, edge.id) === 'red') {
      this.emit('redLight', player.pos);
    }
    this.approach = { node: node.id, dStop };
  }

  private checkSpeeding(dt: number): void {
    const edge = this.lastEdge;
    if (!edge || this.world.player.speed <= speedingThreshold(edge.speedLimit)) {
      this.speedingT = 0;
      this.nextSpeeding = SPEEDING_DELAY;
      return;
    }
    this.speedingT += dt;
    if (this.speedingT >= this.nextSpeeding) {
      this.nextSpeeding += SPEEDING_REPEAT;
      this.emit('speeding', this.world.player.pos);
    }
  }

  private checkWrongWay(edge: RoadEdge | null, dt: number): void {
    if (!edge) {
      // Junctions neither start nor end a wrong-way run.
      if (!this.world.city.nodeBoxAt(this.world.player.pos)) this.wrongT = 0;
      return;
    }
    const { player } = this.world;
    const { lateral, v } = onEdge(edge, player.pos, player.vel);
    // Lateral offset from the centerline, positive on the A->B lanes' side; one-way roads only run A->B
    const lat = (CONFIG.DRIVE_SIDE === 'left' ? 1 : -1) * lateral;
    const wrong = edge.oneWay
      ? v < -WRONG_MIN_SPEED
      : (lat > WRONG_LAT && v < -WRONG_MIN_SPEED) || (lat < -WRONG_LAT && v > WRONG_MIN_SPEED);
    if (!wrong) {
      this.wrongT = 0;
      this.nextWrong = WRONG_DELAY;
      return;
    }
    this.wrongT += dt;
    if (this.wrongT >= this.nextWrong) {
      this.nextWrong += WRONG_REPEAT;
      this.emit('wrongWay', player.pos);
    }
  }

  private emit(kind: OffenseKind, pos: Vec2): void {
    this.world.events.emit({ type: 'offense', kind, pos: { x: pos.x, z: pos.z }, witnessed: false });
  }
}
