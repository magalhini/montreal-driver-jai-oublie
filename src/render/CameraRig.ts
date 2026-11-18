import * as THREE from 'three';
import { clamp, damp, lerpAngle, wrapAngle } from '../core/math';
import { CONFIG } from '../config';
import type { SpatialHash } from '../physics/SpatialHash';
import type { AABB, Interior, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import type { Alley } from '../world/Features';

type Mode = 'far' | 'near' | 'cockpit' | 'bumper' | 'top';
const MODES: Mode[] = ['near', 'far', 'cockpit', 'bumper', 'top'];
/** Cockpit camera looks along the car's +z, pitched down a little to take in the dash. */
const COCKPIT_LOOK = new THREE.Quaternion().setFromEuler(new THREE.Euler((-8 * Math.PI) / 180, Math.PI, 0, 'YXZ'));
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Chase camera pull-back with speed (m per m/s, and its cap): the illusion of speed. 40% gentler since
 * IMPROVEMENTS #17 (was 0.06 / 3.5 m), and another 15% in the Phase 2 pass (was 0.036 / 2.1 m), so at speed
 * the car doesn't shrink away from the camera.
 */
const SPEED_PULL = 0.0306;
const SPEED_PULL_MAX = 1.785;
/** Chase camera stays this far in front of a wall between it and the car (m), and never closer than this to the car. */
const WALL_MARGIN = 0.5;
const WALL_MIN_DIST = 2.2;
/** High-speed buzz: starts at this speed (m/s), full amplitude (m) by +25 m/s. */
const BUZZ_FROM = 28;
const BUZZ_AMP = 0.022;
/** Keep the camera this far from room walls and under the ceiling. */
const ROOM_MARGIN = 0.35;

/** Between an alley's buildings: past the sidewalk ring at both mouths (any position across). */
function between(a: Alley, x: number, z: number): boolean {
  const sw = CONFIG.SIDEWALK;
  const t = a.axis === 'z' ? z : x;
  const [l0, l1] = a.axis === 'z' ? [a.box.minZ, a.box.maxZ] : [a.box.minX, a.box.maxX];
  return t > l0 + sw && t < l1 - sw;
}

/** Inside an alley's lane, between its buildings. */
function inLane(a: Alley, x: number, z: number): boolean {
  const u = a.axis === 'z' ? x : z;
  const [a0, a1] = a.axis === 'z' ? [a.box.minX, a.box.maxX] : [a.box.minZ, a.box.maxZ];
  return u > a0 && u < a1 && between(a, x, z);
}

/** Spring-damped chase camera with velocity look-ahead, plus an orbit mode for the title screen. */
export class CameraRig {
  mode: Mode = 'near';
  orbit = false;
  enabled = true;
  /** Point of interest next to the car (busted officer): raised three-quarter view from that side. */
  focus: { x: number; z: number } | null = null;
  private camYaw = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;
  private orbitAngle = 0;
  private shake = 0;
  /** Smoothed car height followed by the chase camera (lags a little on jumps). */
  private camY = 0;
  /** 0..1 blend toward the airborne framing (higher, looking down at the car and its shadow). */
  private air = 0;
  /** Ground height for keeping the camera above hills and ramps. */
  groundAt: (x: number, z: number) => number = () => 0;
  /** Semi-indoor rooms (garages): while the car or the camera is in one, the camera stays inside its walls. */
  rooms: Interior[] = [];
  /** Alleys (IMPROVEMENTS #19): while the car or the camera is between their buildings, the camera keeps in line with the lane. */
  alleys: Alley[] = [];
  /**
   * Enclosed gardens (the lawn and each gate). On the lawn the chase view eases up to the top camera and
   * back to the player's mode on the way out: buildings stand on every side, and a lens behind the car
   * rattles as the wall test gains and loses them. The gates are narrow lanes. There the chase views take
   * the driver's seat instead of that top camera.
   */
  courts: AABB[] = [];
  /** 0..1 blend from the current chase framing up to the top view (the open lawn, not the lanes in). */
  private court = 0;
  /** Chase view is sitting in the driver's seat because the car is in a garden's lane. */
  private laneSeat = false;
  /** Alley the camera was last inside (keeps holding it there until it leaves the block). */
  private lastAlley: Alley | null = null;
  /** Player car's body group and the driver's eye in its frame, for the cockpit view. */
  cockpit: { body: THREE.Object3D; eye: THREE.Vector3 } | null = null;
  /** Head sway in the car frame (m), leaning against acceleration. */
  private lean = new THREE.Vector3();
  /** Building footprints the chase camera must not see through (it is pulled in front of them). */
  walls: SpatialHash | null = null;
  /** Look behind the car (held key): the camera turns around for as long as it is set. */
  lookBack = false;
  private wasLookBack = false;
  private buzzT = 0;
  private lastLandT = 99;

  constructor(private camera: THREE.PerspectiveCamera) {}

  cycle(): void {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
  }

  /** True while the camera sits in the driver's seat (the cockpit model should be shown). */
  get interior(): boolean {
    return this.seatOpen() && (this.mode === 'cockpit' || this.laneSeat);
  }

  /**
   * The cabin should be drawn for a car at `p`. True in the cockpit, and in a narrow lane into a garden
   * while a chase view is selected: that lane would otherwise lift to the top camera. Call this before the
   * cockpit is shown; `update` moves the lens on the same rule.
   */
  cabinAt(p: Vec2): boolean {
    if (!this.seatOpen()) return false;
    if (this.mode === 'cockpit') return true;
    return this.inCourtLane(p);
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  snap(): void {
    this.initialized = false;
  }

  update(car: Car, alpha: number, dt: number, orbitCenter?: THREE.Vector3): void {
    if (!this.enabled) return;
    const cam = this.camera;
    if (this.orbit && orbitCenter) {
      this.orbitAngle += dt * 0.06;
      const r = 260;
      cam.position.set(
        orbitCenter.x + Math.sin(this.orbitAngle) * r,
        120,
        orbitCenter.z + Math.cos(this.orbitAngle) * r,
      );
      cam.lookAt(orbitCenter.x, 10, orbitCenter.z);
      cam.fov = 55;
      cam.updateProjectionMatrix();
      this.initialized = false;
      return;
    }

    const p = car.interpPos(alpha);
    const yaw = car.interpYaw(alpha);
    const s = car.phys.state;
    const carY = car.interpY(alpha);
    const speed = Math.hypot(s.vel.x, s.vel.z);
    // A garden lane takes the seat before the lawn's overhead blend, and drops that blend so the
    // chase view is itself again at the mouth.
    this.laneSeat = this.seatOpen() && this.mode !== 'cockpit' && this.inCourtLane(p);
    const overCourt = (this.mode === 'near' || this.mode === 'far') && !this.focus && !this.laneSeat && this.insideCourt(p);
    if (this.laneSeat) this.court = 0;
    else this.court += ((overCourt ? 1 : 0) - this.court) * damp(3.4, dt);
    const velYaw = Math.atan2(s.vel.x, s.vel.z);
    let target = yaw;
    if (speed > 4 && s.speed > 0) target = yaw + wrapAngle(velYaw - yaw) * 0.55;

    if (!this.initialized) {
      this.camYaw = yaw;
      this.camY = carY;
    }
    // Follow height quickly on the ground, loosely in the air so jumps read as jumps
    this.camY += (carY - this.camY) * damp(s.airborne ? 3.5 : 9, dt);
    const cy = this.camY;
    this.air += ((s.airborne && s.airTime > 0.15 ? 1 : 0) - this.air) * damp(s.airborne ? 2.5 : 4, dt);
    const k = this.mode === 'bumper' ? 20 : 4.5;
    this.camYaw = lerpAngle(this.camYaw, target, damp(k, dt));
    // Hard landings jolt the camera (the suspension bottoming out)
    if (s.landT < this.lastLandT && s.landImpact > 2.5) this.addShake(Math.min(0.55, (s.landImpact - 2) * 0.07));
    this.lastLandT = s.landT;
    const back = this.lookBack && !this.focus && this.mode !== 'top';
    if (back !== this.wasLookBack) {
      this.wasLookBack = back;
      this.initialized = false; // cut, don't swing through the car
    }
    if (back) {
      this.rearView(p, yaw, carY, car.halfL, speed, dt, s.heave);
      return;
    }
    if (this.interior) {
      this.driverView(car, speed, dt);
      return;
    }

    // The close chase is framed for a full-size car. On the small city car it sits 25% nearer, and the
    // speed pull-back is only a short extra, so the car does not shrink away down the road.
    const cityNear = car.look.style === 'city' && this.mode === 'near';
    let dist = 9.5;
    let height = 3.6;
    let lookAhead = 4;
    if (this.mode === 'near') {
      dist = cityNear ? 6.2 * 0.75 : 6.2;
      height = cityNear ? 2.05 : 2.3;
    } else if (this.mode === 'top') {
      dist = 14;
      height = 34;
      lookAhead = 8;
    }
    const pull = cityNear ? 0.4 : 1;
    dist += clamp(speed * SPEED_PULL * pull, 0, SPEED_PULL_MAX * pull);
    lookAhead += speed * 0.25 * pull;
    if (this.mode !== 'top') {
      height += this.air * 1.6;
      dist += this.air * 1.5;
      lookAhead *= 1 - this.air * 0.5;
    }
    if (this.court > 0.001 && this.mode !== 'top') {
      // Close overhead, not the street-wide top view: that one sits back inside the roofs around a garden.
      dist += (3.2 - dist) * this.court;
      height += (20 - height) * this.court;
      lookAhead += (7 - lookAhead) * this.court;
    }

    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    // The chase camera takes part of the suspension ride, so a pothole is felt and the body is still seen to move.
    const bob = this.mode === 'top' ? 0 : s.heave * 0.55 * (1 - this.court);
    const desired = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (this.focus) {
      // Raised chase view looking down at the car and whoever stands beside it. Staying behind the car
      // (along the road) keeps it out of buildings; the height clears a cop boxed in behind.
      const dx = this.focus.x - p.x;
      const dz = this.focus.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      desired.set(p.x - fx * 7 + (dx / d) * 1.5, cy + 5.2 + bob, p.z - fz * 7 + (dz / d) * 1.5);
      look.set((p.x + this.focus.x) / 2, cy + 0.8 + bob, (p.z + this.focus.z) / 2);
      if (!this.initialized) {
        this.pos.copy(desired);
        this.look.copy(look);
      } else {
        this.pos.lerp(desired, damp(2.5, dt));
        this.look.lerp(look, damp(3, dt));
      }
    } else if (this.mode === 'bumper') {
      const yf = Math.sin(yaw);
      const zf = Math.cos(yaw);
      const pitch = s.pitch + s.susPitch;
      const ride = s.heave;
      if (car.look.style === 'keitruck') {
        // Cab-over: the shared mount (0.6 m forward, 1.15 m up) is inside the shell, so the
        // lens sees the back of the body. Sit ahead of the face (z ≈ 1.72) and aim down the
        // road, in the truck's frame, so the view stays on the outside.
        _e.set(-pitch, yaw, s.roll, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(0, 1.2, 2.05).applyQuaternion(_q);
        desired.set(p.x + _p.x, carY + _p.y + ride, p.z + _p.z);
        _p.set(0, 0.55, 18).applyQuaternion(_q);
        look.set(p.x + _p.x, carY + _p.y + ride, p.z + _p.z);
      } else {
        desired.set(p.x + yf * 0.6, carY + 1.15 + ride, p.z + zf * 0.6);
        look.set(p.x + yf * 20, carY + 1.0 + ride + Math.tan(pitch) * 20, p.z + zf * 20);
      }
      this.pos.copy(desired);
      this.look.copy(look);
    } else {
      desired.set(p.x - fx * dist, cy + height + bob, p.z - fz * dist);
      look.set(p.x + fx * lookAhead, cy + 1.1 + bob + (carY - cy) * 0.6, p.z + fz * lookAhead);
      // Stay over the lawn or the lane. A lens that swings back into the street wall ends up under a snowy roof.
      if (this.court > 0.05) this.keepOverCourt(desired, p);
      if (!this.initialized) {
        this.pos.copy(desired);
        this.look.copy(look);
      } else {
        this.pos.lerp(desired, damp(10, dt));
        this.look.lerp(look, damp(14, dt));
      }
    }
    this.initialized = true;
    const chase = this.focus || (this.mode !== 'top' && this.mode !== 'bumper');
    // Overhead, the lens is above the roofs. Pulling it in front of whichever wall the ray hits is what shakes.
    const lifted = !this.focus && (overCourt || this.court > 0.4);
    if (chase && !lifted && !this.keepInRooms(p, dt)) this.keepOutOfWalls(p, cy);

    cam.position.copy(this.pos);
    const floor = this.groundAt(cam.position.x, cam.position.z) + 0.6;
    if (cam.position.y < floor) cam.position.y = floor;
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.4;
      this.shake *= Math.exp(-6 * dt);
    }
    // A faint road buzz at high speed (smooth, not random jitter), part of the sense of speed
    this.buzzT += dt;
    const buzz = this.mode === 'top' || this.court > 0.5 ? 0 : clamp((speed - BUZZ_FROM) / 25, 0, 1) * BUZZ_AMP * (s.airborne ? 0 : 1);
    if (buzz > 0) {
      const t = this.buzzT;
      cam.position.y += buzz * (Math.sin(t * 37) * 0.6 + Math.sin(t * 61 + 1.3) * 0.4);
      cam.position.x += buzz * 0.5 * Math.sin(t * 43 + 0.7);
    }
    cam.lookAt(this.look);
    // The wide-open lens at speed shrinks a small car the same way a long pull-back does.
    const widen = cityNear ? 0.4 : 1;
    this.lens(this.mode === 'bumper' ? 75 : 62 + clamp(speed * 0.35 * widen, 0, 20 * widen), 0.3, dt);
  }

  /** The open court under the car: the lawn if it is on one, otherwise the gate it is driving through. */
  private courtAround(p: Vec2): AABB | null {
    let best: AABB | null = null;
    let area = 0;
    for (const b of this.courts) {
      if (p.x <= b.minX || p.x >= b.maxX || p.z <= b.minZ || p.z >= b.maxZ) continue;
      const a = (b.maxX - b.minX) * (b.maxZ - b.minZ);
      if (a > area) {
        best = b;
        area = a;
      }
    }
    return best;
  }

  /** Pull an overhead camera back inside the opening, so it cannot pass into the buildings around it. */
  private keepOverCourt(pos: THREE.Vector3, car: Vec2): void {
    const b = this.courtAround(car);
    if (!b) return;
    const m = 0.5;
    if (b.maxX - b.minX > m * 2 + 0.4) pos.x = clamp(pos.x, b.minX + m, b.maxX - m);
    if (b.maxZ - b.minZ > m * 2 + 0.4) pos.z = clamp(pos.z, b.minZ + m, b.maxZ - m);
  }

  /** Driver's seat can show: a chase view, or the cockpit the player already picked. Not bumper, top, look-back, or the bust framing. */
  private seatOpen(): boolean {
    return this.enabled && !this.orbit && !this.focus && !this.lookBack && this.cockpit !== null && (this.mode === 'near' || this.mode === 'far' || this.mode === 'cockpit');
  }

  /**
   * Inside a gate of an enclosed garden. Those boxes are alleys as well as courts; the lawn is only a court.
   * A point on the grass is not a lane, so the overhead view stays there.
   */
  private inCourtLane(p: Vec2): boolean {
    if (this.mode !== 'near' && this.mode !== 'far') return false;
    if (!this.insideCourt(p)) return false;
    for (const a of this.alleys) {
      const b = a.box;
      if (p.x <= b.minX || p.x >= b.maxX || p.z <= b.minZ || p.z >= b.maxZ) continue;
      for (const c of this.courts) {
        if (c.minX === b.minX && c.maxX === b.maxX && c.minZ === b.minZ && c.maxZ === b.maxZ) return true;
      }
    }
    return false;
  }

  /** True when `p` is on an enclosed garden's lawn or in one of its gates (not on the street in front). */
  private insideCourt(p: Vec2): boolean {
    for (const b of this.courts) {
      if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ) return true;
    }
    return false;
  }

  /**
   * Chase camera in a garage: inside the walls (open only through the doors, and in line with the opening
   * while out past it) and under the ceiling. Clamps the spring state, so it slides along the walls.
   */
  private keepInRooms(car: Vec2, dt: number): boolean {
    const c = this.pos;
    const m = ROOM_MARGIN;
    for (const r of this.rooms) {
      const b = r.box;
      const camIn = c.x > b.minX && c.x < b.maxX && c.z > b.minZ && c.z < b.maxZ;
      const carIn = car.x > b.minX && car.x < b.maxX && car.z > b.minZ && car.z < b.maxZ;
      if (!camIn && !carIn) continue;
      const open = (side: string) => r.doors.some((d) => d.side === side);
      if (!open('W')) c.x = Math.max(c.x, b.minX + m);
      if (!open('E')) c.x = Math.min(c.x, b.maxX - m);
      if (!open('N')) c.z = Math.max(c.z, b.minZ + m);
      if (!open('S')) c.z = Math.min(c.z, b.maxZ - m);
      for (const d of r.doors) {
        const ns = d.side === 'N' || d.side === 'S';
        const past = d.side === 'N' ? c.z < b.minZ : d.side === 'S' ? c.z > b.maxZ : d.side === 'W' ? c.x < b.minX : c.x > b.maxX;
        if (!past) continue;
        if (ns) c.x = clamp(c.x, d.from + m, d.to - m);
        else c.z = clamp(c.z, d.from + m, d.to - m);
      }
      c.y = Math.min(c.y, r.floor + r.height - m);
      return true;
    }
    return this.keepInAlleys(car, dt);
  }

  /**
   * Out on the streets: when a building comes between the car and the chase camera (backing up to a wall,
   * sliding along a facade, reversing out of a corner), the camera is pulled in front of it, and rises a little
   * the closer it gets so it looks down past the car's roof. It eases back out on its own spring.
   */
  private keepOutOfWalls(car: Vec2, carY: number): void {
    if (!this.walls) return;
    const c = this.pos;
    const dx = c.x - car.x;
    const dz = c.z - car.z;
    const d = Math.hypot(dx, dz);
    if (d < WALL_MIN_DIST) return;
    const ux = dx / d;
    const uz = dz / d;
    const hit = this.walls.rayDistance(car, { x: ux, z: uz }, d + WALL_MARGIN);
    if (hit === Infinity) return;
    const keep = Math.max(WALL_MIN_DIST, hit - WALL_MARGIN);
    if (keep >= d) return;
    c.x = car.x + ux * keep;
    c.z = car.z + uz * keep;
    c.y = Math.max(c.y, carY + 2.3 + (1 - keep / d) * 1.8);
  }

  /**
   * Open alleys: once the camera is between an alley's buildings (inside the sidewalk ring) it is kept
   * within the lane, so it never swings through a wall; out on the street behind the mouth of the alley the
   * car is in, it eases in line with the opening instead (no jump when turning in). Where two alleys cross
   * the camera is free to follow into either.
   */
  private keepInAlleys(car: Vec2, dt: number): boolean {
    const c = this.pos;
    const m = ROOM_MARGIN + 0.25;
    for (const a of this.alleys) {
      if (inLane(a, c.x, c.z)) {
        this.lastAlley = a;
        return true;
      }
    }
    let a = this.alleys.find((q) => inLane(q, car.x, car.z)) ?? null;
    const last = this.lastAlley;
    if (!a && last && between(last, c.x, c.z)) a = last;
    if (!a) {
      this.lastAlley = null;
      return false;
    }
    const z = a.axis === 'z';
    const cur = z ? c.x : c.z;
    const target = z ? clamp(cur, a.box.minX + m, a.box.maxX - m) : clamp(cur, a.box.minZ + m, a.box.maxZ - m);
    const next = between(a, c.x, c.z) ? target : cur + (target - cur) * damp(10, dt);
    if (z) c.x = next;
    else c.z = next;
    return true;
  }

  /**
   * Looking back (held): a camera just ahead of the car, over its roof, looking down the road behind, so a
   * cop on your bumper fills the frame. From the cockpit and bumper views it is a low rear-bumper camera.
   */
  private rearView(p: Vec2, yaw: number, carY: number, halfL: number, speed: number, dt: number, heave: number): void {
    const cam = this.camera;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const low = this.mode === 'cockpit' || this.mode === 'bumper';
    const ahead = low ? -(halfL + 0.25) : 4.6;
    const up = low ? 0.95 : 2.7;
    const ride = heave * (low ? 0.9 : 0.5);
    cam.position.set(p.x + fx * ahead, carY + up + ride, p.z + fz * ahead);
    const floor = this.groundAt(cam.position.x, cam.position.z) + 0.6;
    if (cam.position.y < floor) cam.position.y = floor;
    this.look.set(p.x - fx * 18, carY + (low ? 1.0 : 0.6) + ride, p.z - fz * 18);
    this.pos.copy(cam.position);
    cam.lookAt(this.look);
    this.lens(66 + clamp(speed * 0.2, 0, 10), 0.3, dt);
  }

  /** Eases the field of view toward `fov`; the near plane switches at once. */
  private lens(fov: number, near: number, dt: number): void {
    const cam = this.camera;
    if (Math.abs(cam.fov - fov) > 0.05 || cam.near !== near) {
      cam.fov += (fov - cam.fov) * damp(3, dt);
      cam.near = near;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Driver's seat: rigid with the car body (so the interior stays put), head swaying against acceleration
   * and staying a little more level than the car when it rolls.
   */
  private driverView(car: Car, speed: number, dt: number): void {
    const { body, eye } = this.cockpit!;
    const s = car.phys.state;
    const cam = this.camera;
    this.lean.x += (clamp(-s.accelL * 0.004, -0.04, 0.04) - this.lean.x) * damp(5, dt);
    this.lean.z += (clamp(-s.accelF * 0.003, -0.03, 0.03) - this.lean.z) * damp(5, dt);
    cam.position.copy(eye).add(this.lean).applyMatrix4(body.matrixWorld);
    body.matrixWorld.decompose(_p, _q, _s);
    _e.setFromQuaternion(_q, 'YXZ');
    _e.z *= 0.6;
    cam.quaternion.setFromEuler(_e).multiply(COCKPIT_LOOK);
    if (this.shake > 0.001) {
      cam.rotateX((Math.random() - 0.5) * this.shake * 0.05);
      cam.rotateY((Math.random() - 0.5) * this.shake * 0.05);
      this.shake *= Math.exp(-6 * dt);
    }
    // Keep the chase state continuous for switching back out
    this.pos.copy(cam.position);
    this.look.set(0, 0, -10).applyQuaternion(cam.quaternion).add(cam.position);
    this.initialized = true;
    this.lens(64 + clamp(speed * 0.12, 0, 8), 0.1, dt);
  }
}
