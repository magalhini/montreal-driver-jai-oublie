import { dist, dot, fwd, leftOf, wrapAngle, yawOf } from '../core/math';
import type { World } from '../core/World';
import type { SimSystem, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import type { CurbBay } from '../world/Features';
import { formatCash, type Economy } from './Economy';

/** Parking-ticket gag (every painted curb stall is illegal, except the green home bay the session starts in). */
export const PARKING_TICKET_TUNING = {
  /** Seconds the car must sit between the lines before the agent is called. */
  wait: 3,
  /** Parked below this speed (m/s). The physics already kills the last crawl under about 0.4. */
  parked: 0.7,
  /** Faster than this on the way up, and the agent never starts the ticket. */
  flee: 1.8,
  /** Farther than this (m) from where the car was sitting, same result. */
  leave: 3.5,
  /** Dollars. Charged when the pen hits the book. */
  fine: 100,
  /** How long they scribble (s) before walking back behind the car. */
  write: 3.2,
};

const WALK_SPEED = 1.75;
/** Where they stop to write, along the car from its center. */
const DOOR_ALONG = -0.15;
/** Gap between the agent and the body, on the sidewalk side. */
const DOOR_GAP = 0.62;
/** Past the painted stall: a car kissing a tick still counts as parked in it. */
const SLACK_ALONG = 0.55;
const SLACK_ACROSS = 0.5;

export type TicketPose = 'walk' | 'write';

/** The agent from the Agence de mobilité durable, drawn by `TicketAgentView`. */
export interface TicketAgent {
  pos: Vec2;
  prev: Vec2;
  yaw: number;
  pose: TicketPose;
  /** Seconds in the current pose (the scribble clock). */
  t: number;
  /** Meters walked (leg cycle). */
  walked: number;
}

type Phase = 'idle' | 'approach' | 'write' | 'leave';
type Step = { along: number; lat: number };

/**
 * Sit between the lines of any curb stall — street or boulevard, the paint is the same — and stay there.
 * After three seconds an agent steps out from behind the car, walks up the sidewalk side, and writes a
 * 100 $ ticket. The whole city parks illegally. Driving off before the pen comes out beats it; once they
 * are writing, the fine sticks. One ticket per stay: leave the stall before the next one.
 */
export class ParkingTicket implements SimSystem {
  agent: TicketAgent | null = null;
  /**
   * Chase-camera look target. Null while the agent is still tucked behind the bumper, so the ordinary
   * rear view is what they walk into, and again once they step back behind the car.
   */
  get cameraFocus(): Vec2 | null {
    const o = this.agent;
    if (!o) return null;
    if (this.phase === 'approach' && this.path.length > 1) return null;
    if (this.phase === 'leave' && this.path.length <= 1) return null;
    return o.pos;
  }

  private phase: Phase = 'idle';
  private t = 0;
  private wait = 0;
  private path: Step[] = [];
  /** Side of the player the sidewalk is on (+1 = left). */
  private side: 1 | -1 = 1;
  /** Where the car was when the agent was called. */
  private spot: Vec2 = { x: 0, z: 0 };
  private waitingBay: CurbBay | null = null;
  private calledBay: CurbBay | null = null;
  /** Stall that already got a ticket this stay. */
  private servedBay: CurbBay | null = null;
  private issued = false;

  constructor(
    private world: World,
    private economy: Economy,
  ) {}

  update(dt: number): void {
    const w = this.world;
    if (w.mode === 'menu' || w.controlLocked || w.immune) {
      if (this.phase !== 'idle') this.stopShow();
      this.wait = 0;
      return;
    }
    const o = this.agent;
    if (o) {
      o.prev.x = o.pos.x;
      o.prev.z = o.pos.z;
      o.t += dt;
    }
    this.t += dt;
    switch (this.phase) {
      case 'idle':
        this.watch(dt);
        break;
      case 'approach':
        this.approach(dt);
        break;
      case 'write':
        this.write();
        break;
      case 'leave':
        this.leave(dt);
        break;
    }
  }

  /** Quit to title, or anything else that teleports the car out from under them. */
  cancel(): void {
    this.stopShow();
    this.servedBay = null;
    this.calledBay = null;
    this.waitingBay = null;
    this.issued = false;
  }

  private watch(dt: number): void {
    const bay = this.settledBay();
    if (this.servedBay && bay !== this.servedBay) this.servedBay = null;
    if (bay !== this.waitingBay) {
      this.waitingBay = bay;
      this.wait = 0;
    }
    if (!bay || bay === this.servedBay) return;
    this.wait += dt;
    if (this.wait >= PARKING_TICKET_TUNING.wait) this.spawn(bay);
  }

  private approach(dt: number): void {
    const o = this.agent;
    if (!o) return;
    if (this.fled()) {
      this.stopShow();
      return;
    }
    if (this.advance(o, dt)) this.startWriting(o);
  }

  private write(): void {
    const o = this.agent;
    if (!o) return;
    if (this.fled()) {
      this.stopShow();
      return;
    }
    const door = this.doorStep();
    const at = this.carPoint(door.along, door.lat);
    o.pos.x = at.x;
    o.pos.z = at.z;
    this.faceCar(o);
    if (this.t >= PARKING_TICKET_TUNING.write) this.startLeaving(o);
  }

  private leave(dt: number): void {
    const o = this.agent;
    if (!o) return;
    if (this.fled()) {
      this.stopShow();
      return;
    }
    if (this.advance(o, dt)) this.stopShow();
  }

  /** Step toward the next point in the car's frame. True once the path is used up. */
  private advance(o: TicketAgent, dt: number): boolean {
    const step = this.path[0];
    if (!step) return true;
    const target = this.carPoint(step.along, step.lat);
    const dx = target.x - o.pos.x;
    const dz = target.z - o.pos.z;
    const d = Math.hypot(dx, dz);
    const move = WALK_SPEED * dt;
    if (d > move) {
      o.pos.x += (dx / d) * move;
      o.pos.z += (dz / d) * move;
      o.walked += move;
      o.yaw = Math.atan2(dx, dz);
      return false;
    }
    o.pos.x = target.x;
    o.pos.z = target.z;
    o.walked += d;
    this.path.shift();
    return this.path.length === 0;
  }

  private startWriting(o: TicketAgent): void {
    this.phase = 'write';
    this.t = 0;
    o.pose = 'write';
    o.t = 0;
    this.issue();
  }

  private startLeaving(o: TicketAgent): void {
    const p = this.world.player;
    this.path = [
      { along: -(p.halfL + 0.5), lat: this.side * (p.halfW + 0.8) },
      { along: -(p.halfL + 0.35), lat: this.side * 0.12 },
    ];
    this.phase = 'leave';
    this.t = 0;
    o.pose = 'walk';
    o.t = 0;
  }

  private issue(): void {
    if (this.issued) return;
    this.issued = true;
    this.servedBay = this.calledBay;
    const fine = PARKING_TICKET_TUNING.fine;
    const paid = this.economy.charge(fine);
    const short = paid < fine ? ` (all you had: ${formatCash(paid)})` : '';
    const w = this.world;
    w.events.message('Agence de mobilité durable de Montréal is issuing you a fine.', 'bad', 8);
    w.events.message(`You can't park here. The fine is ${formatCash(fine)}${short}.`, 'bad', 8);
  }

  private stopShow(): void {
    this.phase = 'idle';
    this.agent = null;
    this.path = [];
    this.t = 0;
    this.wait = 0;
  }

  /** Behind the bumper, then out to the curb, then up to the door. */
  private spawn(bay: CurbBay): void {
    const p = this.world.player;
    this.side = this.curbSide(bay);
    this.calledBay = bay;
    this.spot.x = p.pos.x;
    this.spot.z = p.pos.z;
    this.issued = false;
    const tucked = { along: -(p.halfL + 0.4), lat: this.side * 0.1 };
    const out = { along: -(p.halfL + 0.15), lat: this.side * (p.halfW + 0.85) };
    this.path = [out, this.doorStep()];
    const pos = this.carPoint(tucked.along, tucked.lat);
    const next = this.carPoint(out.along, out.lat);
    this.agent = {
      pos: { ...pos },
      prev: { ...pos },
      yaw: yawOf({ x: next.x - pos.x, z: next.z - pos.z }),
      pose: 'walk',
      t: 0,
      walked: 0,
    };
    this.phase = 'approach';
    this.t = 0;
  }

  /** +1 = the player's left. Sidewalk is to the right of a car parked with traffic. */
  private curbSide(bay: CurbBay): 1 | -1 {
    const curb = { x: -Math.cos(bay.yaw), z: Math.sin(bay.yaw) };
    return dot(curb, leftOf(this.world.player.yaw)) >= 0 ? 1 : -1;
  }

  private doorStep(): Step {
    const p = this.world.player;
    return { along: DOOR_ALONG, lat: this.side * (p.halfW + DOOR_GAP) };
  }

  private carPoint(along: number, lat: number): Vec2 {
    const p = this.world.player;
    const f = fwd(p.yaw);
    const l = leftOf(p.yaw);
    return { x: p.pos.x + f.x * along + l.x * lat, z: p.pos.z + f.z * along + l.z * lat };
  }

  private faceCar(o: TicketAgent): void {
    const p = this.world.player.pos;
    o.yaw = yawOf({ x: p.x - o.pos.x, z: p.z - o.pos.z });
  }

  private fled(): boolean {
    const p = this.world.player;
    return p.speed > PARKING_TICKET_TUNING.flee || dist(p.pos, this.spot) > PARKING_TICKET_TUNING.leave;
  }

  /**
   * The stall the car is sitting in: the whole body between the ticks and inside the parking band,
   * and not rolling. Null when it straddles a line or is out in the travel lane.
   */
  private settledBay(): CurbBay | null {
    const p = this.world.player;
    if (p.removed || p.speed > PARKING_TICKET_TUNING.parked) return null;
    const curbs = this.world.city.features.curb;
    const edges = this.world.city.edges;
    let best: CurbBay | null = null;
    let bestD = 100;
    for (const bay of curbs) {
      // The one spot in town where parking is allowed
      if (bay.legal) continue;
      const dx = bay.pos.x - p.pos.x;
      const dz = bay.pos.z - p.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bestD) continue;
      const edge = edges[bay.edge];
      if (!edge || edge.parking <= 0 || !fitsBay(p, bay, edge.parking)) continue;
      best = bay;
      bestD = d2;
    }
    return best;
  }
}

/** Car body inside the painted stall, with a little slack at the ticks. */
function fitsBay(car: Car, bay: CurbBay, parking: number): boolean {
  const f = fwd(bay.yaw);
  const l = leftOf(bay.yaw);
  const rx = car.pos.x - bay.pos.x;
  const rz = car.pos.z - bay.pos.z;
  const along = rx * f.x + rz * f.z;
  const lat = rx * l.x + rz * l.z;
  const dy = wrapAngle(car.yaw - bay.yaw);
  const c = Math.abs(Math.cos(dy));
  const s = Math.abs(Math.sin(dy));
  const alongExt = c * car.halfL + s * car.halfW;
  const latExt = s * car.halfL + c * car.halfW;
  return Math.abs(along) + alongExt <= (bay.s1 - bay.s0) / 2 + SLACK_ALONG && Math.abs(lat) + latExt <= parking / 2 + SLACK_ACROSS;
}
