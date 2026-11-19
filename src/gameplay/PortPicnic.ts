import { dist, fwd, leftOf, yawOf } from '../core/math';
import type { World } from '../core/World';
import { inBox } from '../world/Features';
import { formatCash, type Economy } from './Economy';
import { PARKING_TICKET_TUNING, type TicketAgent } from './ParkingTicket';
import type { CityModel } from '../world/RoadGraph';
import type { AABB, SimSystem, Vec2 } from '../types';

/** The last stop, and its cutscene. Playtest numbers live here. */
export const PICNIC_TUNING = {
  /** Count as stopped below this speed (m/s), for `settle` seconds, with the car's center in the lot. */
  stopSpeed: 1.2,
  settle: 0.85,
  /** The "pull into the lot" line, once the car is this close to the pin (m). */
  hintAt: 55,
  /** Walking pace along the promenade (m/s). */
  walk: 1.55,
  /** Turn and sit, then the bagel (s). */
  sit: 1.15,
  eat: 6.6,
  /** Fade to black and back (s, each way). Also the dip between the bench and the ticket. */
  fade: 0.4,
  /** The agent's pace up to the car (m/s), the scribble (s), and how long they walk off before the fade (s). */
  agentWalk: 1.75,
  write: 3.4,
  walkOff: 1.7,
  /** Dollars: the bagel permit nobody has. */
  fine: PARKING_TICKET_TUNING.fine,
};

/** Which shot the cutscene camera is on: him on the bench, then the car in the lot. */
export type PicnicShot = 'bench' | 'ticket';

export type PicnicPose = 'walk' | 'sit' | 'eat';

/** The player, out of the car. Drawn by `PortPicnicView`. */
export interface PicnicDriver {
  pos: Vec2;
  prev: Vec2;
  yaw: number;
  pose: PicnicPose;
  /** Seconds in the current pose. */
  t: number;
  /** Meters walked (leg cycle). */
  walked: number;
  visible: boolean;
}

type Who = 'driver' | 'agent';

type Beat =
  | { kind: 'walk'; who?: Who; pts: Vec2[]; speed: number; start?: () => void; endAt?: number }
  | { kind: 'hold'; who?: Who; dur: number; pose: PicnicPose | 'write'; face?: number; start?: () => void }
  /** Dip to black; `mid` runs on the black frame. */
  | { kind: 'cut'; mid: () => void; cut?: boolean };

interface Walker {
  pos: Vec2;
  yaw: number;
  walked: number;
}

/** Where the coda points, and which bench the cutscene uses. */
export interface PortPicnicSpot {
  /** Map pin, in the aisle by the curb cut nearest the clock. */
  pin: Vec2;
  lot: AABB;
  /** The promenade bench closest to the clock tower, facing the water. */
  bench: { pos: Vec2; yaw: number };
}

/**
 * The Vieux-Port coda: the lot by the clock tower, and the bench the driver sits on.
 * Null if this city has no promenade.
 */
export function portPicnic(city: CityModel): PortPicnicSpot | null {
  const port = city.features.port;
  if (!port?.benches.length) return null;
  const clock = city.features.clock?.pos;
  let bench = port.benches[0];
  let best = Infinity;
  for (const b of port.benches) {
    const d = clock ? (b.pos.x - clock.x) ** 2 + (b.pos.z - clock.z) ** 2 : -b.pos.x;
    if (d < best) {
      best = d;
      bench = b;
    }
  }
  const mouth = [...port.mouths].sort((a, b) => b.minX - a.minX)[0];
  const pin = mouth
    ? { x: (mouth.minX + mouth.maxX) / 2, z: (port.lot.minZ + port.lot.maxZ) / 2 }
    : { x: (port.lot.minX + port.lot.maxX) / 2, z: (port.lot.minZ + port.lot.maxZ) / 2 };
  return { pin, lot: port.lot, bench: { pos: { x: bench.pos.x, z: bench.pos.z }, yaw: bench.yaw } };
}

/**
 * After the winter tires are on: stop in the Vieux-Port lot by the clock tower and the scene takes the car.
 * The driver walks to the nearest bench, sits facing the water and eats a lox bagel. Then the cut back to
 * the lot: an agent walks up to the car and writes it up (no Ville-Marie Bagel permit). Escape skips it,
 * and the fine still sticks. A bust, a wreck or a tow mid-scene calls it off; the lot takes the car again
 * the next time it stops.
 */
export class PortPicnic implements SimSystem {
  /** The lot wants the car (the tires are on, the bagel is not eaten). */
  armed: () => boolean = () => false;
  /** Other sequences own the car (bust, tow, wreck). */
  blocked: () => boolean = () => false;
  /** The police are on the car: he does not get out. */
  chased: () => boolean = () => false;
  /** He sat, he ate. The drive is over. */
  onDone: (() => void) | null = null;

  /** The scene has the car. */
  playing = false;
  /** The cutscene camera owns the view (between the two fades). */
  cinematic = false;
  /** Black over the screen (0..1). */
  fade = 0;
  /** Seconds since the scene started (camera drift). */
  sceneT = 0;
  /** The bench the shot is built on. Null until the scene starts. */
  bench: { pos: Vec2; yaw: number } | null = null;
  shot: PicnicShot = 'bench';
  /** Side of the car the agent works (+1 = the car's left). */
  ticketSide: 1 | -1 = 1;
  /** The parking agent, only on the ticket shot. Drawn by a `TicketAgentView`. */
  agent: TicketAgent | null = null;
  readonly driver: PicnicDriver = {
    pos: { x: 0, z: 0 },
    prev: { x: 0, z: 0 },
    yaw: 0,
    pose: 'walk',
    t: 0,
    walked: 0,
    visible: false,
  };

  private beats: Beat[] = [];
  private beatT = 0;
  private ending = 0;
  private hinted = false;
  /** The stop counted once: drive out of the lot before it takes the car again. */
  private served = false;
  private progress = 0;
  /** The fine has been charged this scene. */
  private fined = false;
  private paid = 0;

  constructor(
    private readonly world: World,
    private readonly economy: Economy,
  ) {}

  /** Quit, free roam, a fresh session. */
  reset(): void {
    if (this.playing) this.release(false);
    this.playing = false;
    this.cinematic = false;
    this.fade = 0;
    this.progress = 0;
    this.hinted = false;
    this.served = false;
    this.bench = null;
    this.shot = 'bench';
    this.agent = null;
    this.driver.visible = false;
    this.beats = [];
  }

  /** Escape during the scene: straight to the end. He still got the bagel, and the ticket. */
  skip(): void {
    if (!this.playing || this.ending > 0) return;
    this.beats = [];
    this.ending = 1e-6;
  }

  update(dt: number): void {
    if (this.playing) {
      this.play(dt);
      return;
    }
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt / PICNIC_TUNING.fade);
    this.watch(dt);
  }

  private watch(dt: number): void {
    const w = this.world;
    const spot = portPicnic(w.city);
    if (!this.armed() || w.mode !== 'free' || !spot) {
      this.progress = 0;
      this.hinted = false;
      return;
    }
    const p = w.player;
    const inside = inBox(p.pos, spot.lot);
    if (!inside) this.served = false;
    const d = dist(p.pos, spot.pin);
    if (d > PICNIC_TUNING.hintAt + 12) this.hinted = false;
    if (!this.hinted && d < PICNIC_TUNING.hintAt) {
      this.hinted = true;
      w.events.message('Vieux-Port: pull into the lot by the clock tower and stop.', 'info');
    }
    const st = p.phys.state;
    if (this.served || !inside || Math.abs(st.speed) > PICNIC_TUNING.stopSpeed || st.airborne || w.controlLocked || this.blocked()) {
      this.progress = 0;
      return;
    }
    this.progress = Math.min(1, this.progress + dt / PICNIC_TUNING.settle);
    if (this.progress < 1) return;
    this.served = true;
    this.progress = 0;
    if (this.chased()) {
      w.events.message('Vieux-Port: not while the SPVM is on you.', 'warn');
      return;
    }
    this.begin(spot);
  }

  private begin(spot: PortPicnicSpot): void {
    const w = this.world;
    const bench = spot.bench;
    this.playing = true;
    this.cinematic = false;
    this.sceneT = 0;
    this.ending = 0;
    this.beatT = 0;
    this.bench = bench;
    this.shot = 'bench';
    this.agent = null;
    this.fined = false;
    this.paid = 0;
    w.controlLocked = true;

    const face = fwd(bench.yaw);
    // In front of the seat, on the water side: he walks up, then the view slides him back as he sits
    const stand = { x: bench.pos.x + face.x * 0.9, z: bench.pos.z + face.z * 0.9 };
    const side = leftOf(bench.yaw);
    const approach = { x: stand.x - side.x * 4.4, z: stand.z - side.z * 4.4 };
    const d = this.driver;
    d.pos = { ...approach };
    d.prev = { ...approach };
    d.yaw = yawOf({ x: stand.x - approach.x, z: stand.z - approach.z });
    d.pose = 'walk';
    d.t = 0;
    d.walked = 0;
    d.visible = false;

    const T = PICNIC_TUNING;
    this.beats = [
      { kind: 'hold', dur: T.fade, pose: 'walk', start: () => (d.visible = false) },
      { kind: 'walk', pts: [stand], speed: T.walk, start: () => (d.visible = true) },
      { kind: 'hold', dur: T.sit, pose: 'sit', face: bench.yaw },
      { kind: 'hold', dur: T.eat, pose: 'eat', face: bench.yaw },
      ...this.ticketBeats(),
    ];
    this.startBeat();
  }

  /**
   * Back to the lot: the agent comes up the car's flank from behind, stops by the windshield, writes it up,
   * and walks back off the way they came. Every point is in the car's frame, read on the black frame.
   */
  private ticketBeats(): Beat[] {
    const T = PICNIC_TUNING;
    const p = this.world.player;
    const lat = (k: number) => this.ticketSide * (p.halfW + k);
    let door: Vec2 = { x: 0, z: 0 };
    const walkUp: Vec2[] = [];
    const walkOff: Vec2[] = [];
    return [
      {
        kind: 'cut',
        mid: () => {
          this.shot = 'ticket';
          this.driver.visible = false;
          this.ticketSide = this.clearSide();
          const start = this.carPoint(-(p.halfL + 5.5), lat(1.15));
          walkUp.push(this.carPoint(-(p.halfL + 0.45), lat(0.9)), (door = this.carPoint(0.55, lat(0.62))));
          walkOff.push(this.carPoint(-(p.halfL + 0.6), lat(1.4)), this.carPoint(-(p.halfL + 9), lat(2.4)));
          this.agent = {
            pos: { ...start },
            prev: { ...start },
            yaw: yawOf({ x: walkUp[0].x - start.x, z: walkUp[0].z - start.z }),
            pose: 'walk',
            t: 0,
            walked: 0,
          };
        },
      },
      { kind: 'walk', who: 'agent', pts: walkUp, speed: T.agentWalk },
      {
        kind: 'hold',
        who: 'agent',
        dur: T.write,
        pose: 'write',
        start: () => {
          const o = this.agent;
          if (o) o.yaw = yawOf({ x: p.pos.x - door.x, z: p.pos.z - door.z });
          this.fine();
        },
      },
      { kind: 'walk', who: 'agent', pts: walkOff, speed: T.agentWalk, endAt: T.walkOff },
    ];
  }

  /** The flank with fewer cars beside it (the lot is full of them); the driver's side on a tie. */
  private clearSide(): 1 | -1 {
    const p = this.world.player;
    const crowd = (side: 1 | -1) => {
      const at = this.carPoint(0, side * (p.halfW + 1));
      let n = 0;
      for (const c of this.world.cars) if (c !== p && !c.removed && dist(c.pos, at) < 2.6) n++;
      return n;
    };
    return crowd(-1) < crowd(1) ? -1 : 1;
  }

  private carPoint(along: number, lat: number): Vec2 {
    const p = this.world.player;
    const f = fwd(p.yaw);
    const l = leftOf(p.yaw);
    return { x: p.pos.x + f.x * along + l.x * lat, z: p.pos.z + f.z * along + l.z * lat };
  }

  /** The pen hits the book: charged once per scene, on the write or on a skip. */
  private fine(): void {
    if (this.fined) return;
    this.fined = true;
    this.paid = this.economy.charge(PICNIC_TUNING.fine);
  }

  private play(dt: number): void {
    const T = PICNIC_TUNING;
    if (this.blocked() || this.world.mode !== 'free') {
      this.release(false);
      return;
    }
    this.world.controlLocked = true;
    this.sceneT += dt;
    const d = this.driver;
    d.prev.x = d.pos.x;
    d.prev.z = d.pos.z;
    d.t += dt;
    const o = this.agent;
    if (o) {
      o.prev.x = o.pos.x;
      o.prev.z = o.pos.z;
      o.t += dt;
    }
    // The beats keep running under the closing fade, so the agent walks into the black
    this.step(dt);
    if (this.ending > 0) {
      this.ending += dt;
      this.fade = Math.min(1, this.ending / T.fade);
      if (this.ending >= T.fade) this.release(true);
      return;
    }
    const beat = this.beats[0];
    if (this.sceneT < T.fade) this.fade = this.sceneT / T.fade;
    else if (beat?.kind === 'cut') this.fade = Math.max(0, 1 - Math.abs(this.beatT - T.fade) / T.fade);
    else {
      this.cinematic = true;
      this.fade = Math.max(0, this.fade - dt / T.fade);
    }
  }

  private step(dt: number): void {
    const T = PICNIC_TUNING;
    const beat = this.beats[0];
    if (!beat) {
      if (this.ending === 0) this.ending = 1e-6;
      return;
    }
    this.beatT += dt;
    if (beat.kind === 'walk') {
      const who = beat.who === 'agent' ? this.agent : this.driver;
      if (!who || this.walk(beat, dt, who)) this.nextBeat();
      else if (beat.endAt !== undefined && this.beatT >= beat.endAt && this.ending === 0) this.ending = 1e-6;
    } else if (beat.kind === 'cut') {
      if (!beat.cut && this.beatT >= T.fade) {
        beat.cut = true;
        beat.mid();
      }
      if (this.beatT >= T.fade * 2) this.nextBeat();
    } else if (this.beatT >= beat.dur) this.nextBeat();
    const last = this.beats[0];
    if (this.ending === 0 && this.beats.length === 1 && last.kind === 'hold' && this.beatT >= last.dur - T.fade) this.ending = 1e-6;
  }

  private walk(beat: Extract<Beat, { kind: 'walk' }>, dt: number, d: Walker): boolean {
    let move = beat.speed * dt;
    while (move > 0 && beat.pts.length) {
      const target = beat.pts[0];
      const dx = target.x - d.pos.x;
      const dz = target.z - d.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) d.yaw = yawOf({ x: dx, z: dz });
      if (len > move) {
        d.pos.x += (dx / len) * move;
        d.pos.z += (dz / len) * move;
        d.walked += move;
        return false;
      }
      d.pos.x = target.x;
      d.pos.z = target.z;
      d.walked += len;
      move -= len;
      beat.pts.shift();
    }
    return beat.pts.length === 0;
  }

  private nextBeat(): void {
    this.beats.shift();
    this.startBeat();
  }

  private startBeat(): void {
    this.beatT = 0;
    const b = this.beats[0];
    if (!b) return;
    if (b.kind === 'cut') return;
    if (b.who === 'agent') {
      const o = this.agent;
      if (o) {
        o.t = 0;
        o.pose = b.kind === 'walk' ? 'walk' : b.pose === 'write' ? 'write' : 'walk';
        if (b.kind === 'hold' && b.face !== undefined) o.yaw = b.face;
      }
      b.start?.();
      return;
    }
    const d = this.driver;
    d.t = 0;
    b.start?.();
    if (b.kind === 'walk') d.pose = 'walk';
    else {
      d.pose = b.pose === 'write' ? 'sit' : b.pose;
      if (b.face !== undefined) d.yaw = b.face;
    }
  }

  /** End of the scene. `ate`: he got the bagel (and the ticket); the car goes back to the player. */
  private release(ate: boolean): void {
    const w = this.world;
    this.playing = false;
    this.cinematic = false;
    this.beats = [];
    this.ending = 0;
    this.driver.visible = false;
    this.agent = null;
    this.shot = 'bench';
    if (!ate) {
      this.fade = 0;
      return;
    }
    this.fine();
    if (w.mode === 'free' && !this.blocked()) w.controlLocked = false;
    this.onDone?.();
    const fine = PICNIC_TUNING.fine;
    const short = this.paid < fine ? ` (all you had: ${formatCash(this.paid)})` : '';
    w.events.message('Agence de mobilité durable de Montréal issued you a fine.', 'bad', 8);
    w.events.message(`You can't park here without a Ville-Marie Bagel permit. ${formatCash(fine)}${short}.`, 'bad', 8);
  }
}
