import { CONFIG } from '../config';
import { dot, fwd, leftVec, segT, wrapAngle } from '../core/math';
import type { World } from '../core/World';
import type { Block, DistrictType, SimSystem, Vec2 } from '../types';
import { ALLRED_T, YELLOW_T } from '../world/TrafficLights';
import { DOG_SHARE, DOG_TUNING } from './DogWalkers';
import { carsWaitingAtStop } from './LaneDriver';
import { dodgeState, PANIC_PACE, PedestrianDodge, type DodgeState } from './PedestrianDodge';

/** Distance of the walking line from the curb (matches crosswalk centerlines). */
const INSET = 2.2;
const MAX_LATERAL = 0.55;
const CROSS_MAX_SPEED = 2.4;
const DESPAWN_RADIUS = CONFIG.PED_RADIUS + 15;
const SPAWN_MIN = 55;
/** Player moved farther than this in one step: a respawn/teleport, so refill instantly. */
const TELEPORT_DIST = 40;
const DISTRICT_WEIGHT: Record<DistrictType, number> = { oldtown: 1, downtown: 0.8, depot: 0.6, residential: 0.4, harbor: 0.15 };

/**
 * Where the crowd gathers (PRD Phase 5): a sidewalk beside a cobble street, a fountain loop or the Old Port's
 * promenade is listed this many times among the spawn candidates, so it fills up first. The squares' walks
 * spawn at `plazaShare` of their district's rate (nobody lingers by a drained fountain in December).
 */
export const PED_TUNING = { cobbleBoost: 3, plazaBoost: 1, promenadeBoost: 1, promenadeStep: 45, plazaShare: 0.5 };

export interface WalkNode {
  id: number;
  pos: Vec2;
  edges: number[];
}

export interface WalkEdge {
  id: number;
  a: number;
  b: number;
  length: number;
  /** Set for crosswalks: the junction and the approach (edge) being crossed. */
  crossing: { node: number; edge: number } | null;
  district: DistrictType;
  /** Spawn acceptance (the district's share unless overridden) and how often it is listed (`PED_TUNING`). */
  weight: number;
  boost: number;
}

export interface Ped extends DodgeState {
  id: number;
  active: boolean;
  pos: Vec2;
  prev: Vec2;
  heading: number;
  vel: Vec2;
  edge: number;
  /** Node the ped is walking toward. */
  to: number;
  lateral: number;
  baseSpeed: number;
  speed: number;
  waiting: boolean;
  waitTime: number;
  onRoad: boolean;
  /** Walk cycle phase (radians), advanced by distance walked. */
  phase: number;
  look: number;
  umbrella: boolean;
  /** Walking a dog on a leash (`ai/DogWalkers.ts`). */
  dog: boolean;
  /** Seconds standing still (the dog stopped to sniff). */
  pause: number;
  /** Seconds spent held up by a car body in the way out on the road (gives up waiting after a while). */
  blocked: number;
}

/** A ped out on the road stops rather than walk into a car this close ahead (m, around the car's body)... */
const CAR_CLEAR = 0.45;
const CAR_LOOK = 0.9;
/** ...but not for longer than this (s): then they squeeze past as before (no standoffs with a stopped car). */
const CAR_WAIT_MAX = 2.5;
/**
 * At an all-way stop a ped doesn't step off the curb while a car is this close to the crosswalk (m beyond the
 * car's half length): the car that took its turn gets across first. Cars waiting at the line sit further back.
 */
const STOP_CROSS_CLEAR = 2;
/**
 * All-way stops: once a car has waited this long at a line (s), peds at the curb let it go before stepping off,
 * so a steady trickle of walkers can't hold the junction. Nobody waits longer than `maxWait` for it, though.
 */
export const PED_YIELD = { after: 1, maxWait: 8 };

/** Sidewalk loops around blocks joined by signal-controlled crosswalks. */
export class WalkGraph {
  nodes: WalkNode[] = [];
  edges: WalkEdge[] = [];
  sidewalkEdges: number[] = [];

  constructor(world: World) {
    const city = world.city;
    const gx = city.nx - 1;
    const gz = city.nz - 1;
    // corners per block: 0 NW, 1 NE, 2 SE, 3 SW
    const corner = (b: Block, k: number) => b.id * 4 + k;
    for (const b of city.blocks) {
      const pts: Vec2[] = [
        { x: b.min.x + INSET, z: b.min.z + INSET },
        { x: b.max.x - INSET, z: b.min.z + INSET },
        { x: b.max.x - INSET, z: b.max.z - INSET },
        { x: b.min.x + INSET, z: b.max.z - INSET },
      ];
      pts.forEach((pos, k) => this.nodes.push({ id: corner(b, k), pos, edges: [] }));
    }
    for (const b of city.blocks) {
      // The road beside each side, in corner order: N, E, S, W
      const at = (i: number, j: number) => city.nodeAt(i, j).id;
      const roads = [
        city.edgeBetween(at(b.gi, b.gj), at(b.gi + 1, b.gj)),
        city.edgeBetween(at(b.gi + 1, b.gj), at(b.gi + 1, b.gj + 1)),
        city.edgeBetween(at(b.gi, b.gj + 1), at(b.gi + 1, b.gj + 1)),
        city.edgeBetween(at(b.gi, b.gj), at(b.gi, b.gj + 1)),
      ];
      for (let k = 0; k < 4; k++) {
        const cobble = roads[k]?.cls === 'cobble';
        const id = this.link(corner(b, k), corner(b, (k + 1) % 4), null, b.district, cobble ? 1 : undefined, cobble ? PED_TUNING.cobbleBoost : 1);
        this.sidewalkEdges.push(id);
      }
    }
    const block = (i: number, j: number) => city.blocks[j * gx + i];
    // Crossings over vertical roads (axis 'z') between block (i-1, j) and (i, j)
    for (let j = 0; j < gz; j++) {
      for (let i = 1; i < gx; i++) {
        const w = block(i - 1, j);
        const e = block(i, j);
        const road = city.edgeBetween(city.nodeAt(i, j).id, city.nodeAt(i, j + 1).id)!.id;
        this.link(corner(w, 1), corner(e, 0), { node: city.nodeAt(i, j).id, edge: road }, e.district);
        this.link(corner(w, 2), corner(e, 3), { node: city.nodeAt(i, j + 1).id, edge: road }, e.district);
      }
    }
    // Crossings over horizontal roads (axis 'x') between block (i, j-1) and (i, j)
    for (let j = 1; j < gz; j++) {
      for (let i = 0; i < gx; i++) {
        const n = block(i, j - 1);
        const s = block(i, j);
        const road = city.edgeBetween(city.nodeAt(i, j).id, city.nodeAt(i + 1, j).id)!.id;
        this.link(corner(n, 3), corner(s, 0), { node: city.nodeAt(i, j).id, edge: road }, s.district);
        this.link(corner(n, 2), corner(s, 1), { node: city.nodeAt(i + 1, j).id, edge: road }, s.district);
      }
    }
    // A loop around each square's fountain, with a walk in from the middle of the sidewalk on each open side
    for (const sq of city.features.squares ?? []) {
      const b = city.blocks[sq.block];
      const c = sq.fountain.pos;
      const r = sq.fountain.r + 5;
      const w = (x: number, y: number) => this.link(x, y, null, b.district, DISTRICT_WEIGHT[b.district] * PED_TUNING.plazaShare, PED_TUNING.plazaBoost);
      // On the walks' axes round the basin: ring[0] east, then south, west, north
      const ring = [0, 1, 2, 3].map((k) => this.node({ x: c.x + Math.cos((k * Math.PI) / 2) * r, z: c.z + Math.sin((k * Math.PI) / 2) * r }));
      for (let k = 0; k < 4; k++) this.sidewalkEdges.push(w(ring[k], ring[(k + 1) % 4]));
      // Along the walks from the middle of each sidewalk the square opens onto (always the south one)
      const open = CONFIG.SIDEWALK + 0.5;
      const sides: [number, number, Vec2, number][] = [[2, 3, { x: c.x, z: b.max.z - INSET }, 1]];
      if (sq.plaza.minZ <= b.min.z + open) sides.push([0, 1, { x: c.x, z: b.min.z + INSET }, 3]);
      if (sq.plaza.minX <= b.min.x + open) sides.push([3, 0, { x: b.min.x + INSET, z: c.z }, 2]);
      if (sq.plaza.maxX >= b.max.x - open) sides.push([1, 2, { x: b.max.x - INSET, z: c.z }, 0]);
      for (const [ca, cb, pos, rk] of sides) {
        const mid = this.node(pos);
        this.sidewalkEdges.push(w(corner(b, ca), mid), w(mid, corner(b, cb)), w(mid, ring[rk]));
      }
    }
    // The Old Port's promenade: one long walk by the water (walkers turn round at its ends), and a branch
    // across the footbridge onto the wheel's island
    const port = city.features.port;
    if (port) {
      const { z, x0, x1 } = port.stroll;
      const wheel = port.wheel;
      const n = Math.max(1, Math.round((x1 - x0) / PED_TUNING.promenadeStep));
      const hop = (a: number, b: number) => this.sidewalkEdges.push(this.link(a, b, null, 'harbor', 1, PED_TUNING.promenadeBoost));
      let ring: number[] | null = null;
      const island = () => {
        if (ring || !wheel) return ring;
        const c = wheel.pos;
        const r = 10;
        ring = [0, 1, 2, 3].map((k) => this.node({ x: c.x + Math.cos((k * Math.PI) / 2) * r, z: c.z + Math.sin((k * Math.PI) / 2) * r }));
        for (let k = 0; k < 4; k++) hop(ring[k], ring[(k + 1) % 4]);
        return ring;
      };
      let prev = this.node({ x: x0, z });
      for (let k = 1; k <= n; k++) {
        const next = this.node({ x: x0 + ((x1 - x0) * k) / n, z });
        const px = this.nodes[prev].pos.x;
        const nx = this.nodes[next].pos.x;
        const cuts = wheel ? wheel.gaps.filter((gx) => px < gx && gx <= nx) : [];
        if (!cuts.length) hop(prev, next);
        else {
          const loop = island()!;
          let cursor = prev;
          for (const gx of cuts) {
            const gate = this.node({ x: gx, z });
            hop(cursor, gate);
            const land = this.node({ x: gx, z: wheel!.deck.minZ + 2.4 });
            hop(gate, land);
            hop(land, loop[3]);
            cursor = gate;
          }
          hop(cursor, next);
        }
        prev = next;
      }
    }
  }

  private node(pos: Vec2): number {
    const id = this.nodes.length;
    this.nodes.push({ id, pos, edges: [] });
    return id;
  }

  private link(a: number, b: number, crossing: WalkEdge['crossing'], district: DistrictType, weight = DISTRICT_WEIGHT[district], boost = 1): number {
    const pa = this.nodes[a].pos;
    const pb = this.nodes[b].pos;
    const e: WalkEdge = { id: this.edges.length, a, b, length: Math.hypot(pb.x - pa.x, pb.z - pa.z), crossing, district, weight, boost };
    this.edges.push(e);
    this.nodes[a].edges.push(e.id);
    this.nodes[b].edges.push(e.id);
    return e.id;
  }

  other(e: WalkEdge, n: number): number {
    return e.a === n ? e.b : e.a;
  }

  dir(e: WalkEdge, to: number): Vec2 {
    const from = this.nodes[this.other(e, to)].pos;
    const p = this.nodes[to].pos;
    return { x: (p.x - from.x) / e.length, z: (p.z - from.z) / e.length };
  }
}

/** Pedestrians walking sidewalks around the player and crossing on walk signals. */
export class Pedestrians implements SimSystem {
  readonly graph: WalkGraph;
  readonly peds: Ped[] = [];
  readonly dodge: PedestrianDodge;
  target = CONFIG.MAX_PEDS;
  private activeCount = 0;
  private spawnTimer = 0;
  private near: number[] = [];
  private nearCenter: Vec2 | null = null;
  private lastPlayerPos: Vec2 | null = null;
  /** When the player's car came to a stop (sim time), or -1 while it's moving. */
  private playerStill = -1;

  constructor(private world: World) {
    this.graph = new WalkGraph(world);
    this.dodge = new PedestrianDodge(world, this);
    for (let i = 0; i < CONFIG.MAX_PEDS; i++) {
      this.peds.push({
        ...dodgeState(),
        id: i,
        active: false,
        pos: { x: 0, z: 0 },
        prev: { x: 0, z: 0 },
        heading: 0,
        vel: { x: 0, z: 0 },
        edge: 0,
        to: 0,
        lateral: 0,
        baseSpeed: 1.3,
        speed: 1.3,
        waiting: false,
        waitTime: 0,
        onRoad: false,
        phase: 0,
        look: 0,
        umbrella: false,
        dog: false,
        pause: 0,
        blocked: 0,
      });
    }
  }

  get count(): number {
    return this.activeCount;
  }

  /** Fill the area around the player right away (on game start / respawn). */
  populate(): void {
    for (let k = 0; k < this.target * 6 && this.activeCount < this.target; k++) this.trySpawn(8, true);
  }

  /** Sidewalk edges that pass within spawn range of the player (refreshed as the player moves). */
  private nearbyEdges(): number[] {
    const pp = this.world.player.pos;
    if (this.nearCenter && Math.hypot(pp.x - this.nearCenter.x, pp.z - this.nearCenter.z) < 20) return this.near;
    this.nearCenter = { ...pp };
    const g = this.graph;
    const r = CONFIG.PED_RADIUS + 20;
    this.near = [];
    for (const id of g.sidewalkEdges) {
      const e = g.edges[id];
      const a = g.nodes[e.a].pos;
      const b = g.nodes[e.b].pos;
      const t = segT(pp, a, b);
      if (Math.hypot(a.x + (b.x - a.x) * t - pp.x, a.z + (b.z - a.z) * t - pp.z) >= r) continue;
      for (let k = 0; k < e.boost; k++) this.near.push(id);
    }
    return this.near;
  }

  private trySpawn(rMin: number, ignoreView = false): void {
    const ped = this.peds.find((p) => !p.active);
    if (!ped) return;
    const w = this.world;
    const g = this.graph;
    const rng = w.rng;
    const near = this.nearbyEdges();
    if (!near.length) return;
    const e = g.edges[rng.pick(near)];
    if (!rng.chance(e.weight)) return;
    const t = rng.range(0.05, 0.95);
    const pa = g.nodes[e.a].pos;
    const pb = g.nodes[e.b].pos;
    const to = rng.chance(0.5) ? e.b : e.a;
    const d = g.dir(e, to);
    const lateral = rng.range(0.2, MAX_LATERAL);
    const lv = leftVec(d);
    const pos = { x: pa.x + (pb.x - pa.x) * t + lv.x * lateral, z: pa.z + (pb.z - pa.z) * t + lv.z * lateral };
    const pp = w.player.pos;
    const dx = pos.x - pp.x;
    const dz = pos.z - pp.z;
    const dist = Math.hypot(dx, dz);
    if (dist < rMin || dist > DESPAWN_RADIUS - 5) return;
    // Ahead of the player: spawn only beyond view range (but a bit farther out); elsewhere: the normal ring.
    const ahead = !ignoreView && dot({ x: dx, z: dz }, fwd(w.player.yaw)) > -0.3 * dist;
    if (ahead && dist < 90) return;
    if (!ahead && dist > CONFIG.PED_RADIUS) return;

    ped.active = true;
    ped.pos = pos;
    ped.prev = { ...pos };
    ped.edge = e.id;
    ped.to = to;
    ped.lateral = lateral;
    ped.heading = Math.atan2(d.x, d.z);
    ped.baseSpeed = rng.range(1.05, 1.6);
    ped.speed = ped.baseSpeed;
    ped.waiting = false;
    ped.waitTime = 0;
    ped.onRoad = false;
    ped.phase = rng.range(0, Math.PI * 2);
    ped.look = rng.int(0, 1e6);
    ped.umbrella = rng.chance(0.12);
    ped.dog = rng.chance(DOG_SHARE[e.district] * DOG_TUNING.share);
    if (ped.dog) ped.baseSpeed = ped.speed = rng.range(0.85, 1.15);
    ped.pause = 0;
    ped.dodge = 'none';
    ped.panic = 0;
    this.activeCount++;
  }

  private despawn(p: Ped): void {
    p.active = false;
    this.activeCount--;
  }

  /** Target point for a ped: the end of its edge, shifted to its side of the path. */
  private targetOf(p: Ped): Vec2 {
    const e = this.graph.edges[p.edge];
    const d = this.graph.dir(e, p.to);
    const lv = leftVec(d);
    const n = this.graph.nodes[p.to].pos;
    const end = { x: n.x + lv.x * p.lateral, z: n.z + lv.z * p.lateral };
    const rel = { x: p.pos.x - end.x, z: p.pos.z - end.z };
    if (Math.abs(dot(rel, lv)) < 1) return end;
    // Knocked off the line (after a dodge): head back to it a couple of meters ahead
    const back = Math.min(0, dot(rel, d) + 2);
    return { x: end.x + d.x * back, z: end.z + d.z * back };
  }

  /** Can a ped start crossing now, and at what speed? Returns 0 if it must wait. */
  private crossSpeed(p: Ped, e: WalkEdge): number {
    const c = e.crossing!;
    const node = this.world.city.nodes[c.node];
    if (node.control === 'stop') {
      if (this.carOnCrossing(e)) return 0;
      if (p.waitTime < PED_YIELD.maxWait && this.carsWaiting(node.id)) return 0;
    }
    // Cross while this approach is red and another one is in its green
    const greenLeft = this.world.lights.walkLeft(c.node, c.edge);
    if (greenLeft <= 0) return 0;
    const available = greenLeft + YELLOW_T + ALLRED_T - 1;
    const needed = e.length / available;
    if (needed > CROSS_MAX_SPEED) return 0;
    return Math.max(p.baseSpeed, needed);
  }

  /** Pick the next edge leaving the node the ped just reached (`p.to`), avoiding a U-turn. */
  private chooseNext(p: Ped): void {
    const g = this.graph;
    const rng = this.world.rng;
    const node = g.nodes[p.to];
    const options = node.edges.filter((id) => id !== p.edge);
    const weights = options.map((id) => (g.edges[id].crossing ? 0.7 : 1));
    let r = rng.next() * weights.reduce((s, w) => s + w, 0);
    let pick = options.length ? options[0] : p.edge;
    for (let k = 0; k < options.length; k++) {
      r -= weights[k];
      if (r <= 0) {
        pick = options[k];
        break;
      }
    }
    p.edge = pick;
    p.to = g.other(g.edges[pick], node.id);
    const e = g.edges[pick];
    p.waiting = !!e.crossing;
    p.waitTime = 0;
    p.speed = p.baseSpeed;
  }

  /** A car (traffic, or the player) has been sitting at this all-way stop long enough that the peds let it go. */
  private carsWaiting(nodeId: number): boolean {
    if (carsWaitingAtStop(this.world, nodeId, PED_YIELD.after)) return true;
    const pl = this.world.player;
    if (!pl || this.playerStill < 0 || this.world.time - this.playerStill < PED_YIELD.after) return false;
    const n = this.world.city.nodes[nodeId];
    return Math.hypot(pl.pos.x - n.pos.x, pl.pos.z - n.pos.z) < Math.max(n.hx, n.hz) + 10;
  }

  /** A car on or right at this crosswalk (all-way stops: wait for it to get through). */
  private carOnCrossing(e: WalkEdge): boolean {
    const a = this.graph.nodes[e.a].pos;
    const b = this.graph.nodes[e.b].pos;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    for (const c of this.world.cars) {
      if (c.removed) continue;
      const rx = c.pos.x - a.x;
      const rz = c.pos.z - a.z;
      const along = rx * ux + rz * uz;
      if (along < -1 || along > len + 1) continue;
      if (Math.abs(rx * uz - rz * ux) < c.halfL + STOP_CROSS_CLEAR) return true;
    }
    return false;
  }

  /** A car's body (any car) right where this ped is about to step. */
  private carInTheWay(p: Ped, dx: number, dz: number): boolean {
    const x = p.pos.x + dx * CAR_LOOK;
    const z = p.pos.z + dz * CAR_LOOK;
    for (const c of this.world.cars) {
      const rx = x - c.pos.x;
      const rz = z - c.pos.z;
      if (Math.abs(rx) > 4 || Math.abs(rz) > 4) continue;
      const s = Math.sin(c.yaw);
      const k = Math.cos(c.yaw);
      if (Math.abs(rx * s + rz * k) < c.halfL + CAR_CLEAR && Math.abs(rx * k - rz * s) < c.halfW + CAR_CLEAR) return true;
    }
    return false;
  }

  update(dt: number): void {
    const pl = this.world.player;
    if (pl && !pl.removed && pl.speed < 0.8) {
      if (this.playerStill < 0) this.playerStill = this.world.time;
    } else this.playerStill = -1;
    const pp = this.world.player.pos;
    const g = this.graph;
    const rng = this.world.rng;
    for (const p of this.peds) {
      if (!p.active) continue;
      p.prev.x = p.pos.x;
      p.prev.z = p.pos.z;
      if (Math.hypot(p.pos.x - pp.x, p.pos.z - pp.z) > DESPAWN_RADIUS) {
        this.despawn(p);
        continue;
      }
      if (this.dodge.move(p, dt)) continue;
      if (p.waiting && p.panic > 0) this.giveUpCrossing(p, { x: p.pos.x - pp.x, z: p.pos.z - pp.z });
      const e = g.edges[p.edge];
      if (p.pause > 0 && !p.waiting && p.panic <= 0) {
        p.pause -= dt;
        p.vel.x = p.vel.z = 0;
        continue;
      }

      if (p.waiting) {
        const s = this.crossSpeed(p, e);
        p.waitTime += dt;
        if (s > 0) {
          p.waiting = false;
          p.speed = s;
        } else {
          // Occasionally give up and walk elsewhere
          if (p.waitTime > 4 && rng.chance(0.002)) this.giveUpCrossing(p);
          const cd = g.dir(e, p.to);
          p.heading += wrapAngle(Math.atan2(cd.x, cd.z) - p.heading) * Math.min(1, dt * 5);
          p.vel.x = 0;
          p.vel.z = 0;
          continue;
        }
      }

      const tgt = this.targetOf(p);
      const dx = tgt.x - p.pos.x;
      const dz = tgt.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const pace = p.panic > 0 ? Math.max(p.speed, p.baseSpeed * PANIC_PACE) : p.speed;
      let speed = pace * this.crowdFactor(p, dx / (d || 1), dz / (d || 1));
      if (p.onRoad && d > 0 && this.carInTheWay(p, dx / d, dz / d)) {
        p.blocked += dt;
        if (p.blocked < CAR_WAIT_MAX) {
          p.vel.x = p.vel.z = 0;
          continue;
        }
      } else p.blocked = 0;
      const step = speed * dt;
      if (d <= step) {
        p.pos.x = tgt.x;
        p.pos.z = tgt.z;
        this.chooseNext(p);
        speed = 0;
      } else {
        p.pos.x += (dx / d) * step;
        p.pos.z += (dz / d) * step;
        p.heading += wrapAngle(Math.atan2(dx, dz) - p.heading) * Math.min(1, dt * 8);
      }
      p.vel.x = d > 0 ? (dx / d) * speed : 0;
      p.vel.z = d > 0 ? (dz / d) * speed : 0;
      p.phase += speed * dt * 4.2;
      p.onRoad = !!this.world.city.roadAt(p.pos);
    }
    this.dodge.update(dt);

    if (this.lastPlayerPos && Math.hypot(pp.x - this.lastPlayerPos.x, pp.z - this.lastPlayerPos.z) > TELEPORT_DIST) this.populate();
    this.lastPlayerPos = { ...pp };

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.1;
      for (let k = 0; k < 12 && this.activeCount < this.target; k++) this.trySpawn(SPAWN_MIN);
    }
  }

  /** A ped waiting at a crosswalk walks off along a sidewalk instead (the one best facing `away`, if given). */
  giveUpCrossing(p: Ped, away?: Vec2): void {
    const g = this.graph;
    const e = g.edges[p.edge];
    const node = g.other(e, p.to);
    const alt = g.nodes[node].edges.filter((id) => !g.edges[id].crossing);
    if (!alt.length) return;
    const facing = (id: number) => dot(g.dir(g.edges[id], g.other(g.edges[id], node)), away!);
    p.edge = away ? alt.reduce((best, id) => (facing(id) > facing(best) ? id : best)) : this.world.rng.pick(alt);
    p.to = g.other(g.edges[p.edge], node);
    p.waiting = false;
    p.speed = p.baseSpeed;
  }

  /** Slow down behind slower peds walking the same way (cheap O(n^2), n ~ 150). */
  private crowdFactor(p: Ped, fx: number, fz: number): number {
    let f = 1;
    for (const o of this.peds) {
      if (o === p || !o.active || o.waiting) continue;
      const rx = o.pos.x - p.pos.x;
      const rz = o.pos.z - p.pos.z;
      if (Math.abs(rx) > 1.4 || Math.abs(rz) > 1.4) continue;
      const ahead = rx * fx + rz * fz;
      if (ahead <= 0 || ahead > 1.3) continue;
      if (Math.sin(o.heading) * fx + Math.cos(o.heading) * fz < 0.3) continue;
      const side = Math.abs(rx * fz - rz * fx);
      if (side > 0.45) continue;
      f = Math.min(f, Math.max(0, (ahead - 0.55) / 0.75));
    }
    return f;
  }
}
