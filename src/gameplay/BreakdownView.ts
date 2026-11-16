import * as THREE from 'three';
import { fwd, leftOf } from '../core/math';
import type { SpatialHash } from '../physics/SpatialHash';
import type { AABB, ViewSystem } from '../types';
import type { Car } from '../vehicles/Car';
import { carMaterial } from '../vehicles/CarMaterial';
import { buildCarParts } from '../vehicles/CarModel';
import { wheelPair } from '../vehicles/CarWheel';
import type { Effects } from '../vehicles/Effects';
import type { Breakdown } from './Breakdown';

const GRAVITY = 9.8;
/** Body settles onto the road over this long (s), then a small bounce. */
const DROP_TIME = 0.16;
/** Smoke puffs per second off the bonnet. */
const SMOKE_RATE = 26;

interface Loose {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  r: number;
  heading: number;
  spin: number;
  /** Lean (rad): 0 upright, +-PI/2 lying flat. */
  tilt: number;
  tiltDir: number;
  onGround: boolean;
}

/**
 * The broken-down car on screen (`Breakdown`): its four wheels fly off and roll away (simple ballistics, a
 * bounce or two, rolling, a wobble, then they topple over; walls stop them), the body drops onto the road,
 * thick smoke pours from the bonnet, and a slow orbit camera looks on. The loose wheels go at the respawn.
 */
export class BreakdownView implements ViewSystem {
  private wheels: Loose[] = [];
  private readonly group = new THREE.Group();
  private readonly mat = carMaterial({ roughness: 0.45, metalness: 0.6 });
  private seq = 0;
  private time = 0;
  private smokeAcc = 0;
  private drop = 0;
  private orbit0 = 0;
  private readonly tmp: AABB[] = [];
  private readonly e = new THREE.Euler();

  constructor(
    private readonly breakdown: Breakdown,
    private readonly player: Car,
    scene: THREE.Scene,
    private readonly effects: Effects,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly statics: SpatialHash,
  ) {
    scene.add(this.group);
  }

  sync(_alpha: number, frameDt: number): void {
    const b = this.breakdown;
    if (!b.playing) {
      if (this.wheels.length && b.phase !== 'fadeOut') this.clear();
      return;
    }
    if (b.seq !== this.seq) this.build();
    const dt = Math.min(frameDt, 1 / 30);
    this.time += dt;
    const p = this.player;

    // The body settles onto the road, with a little bounce
    const t = this.time;
    const k = Math.min(1, t / DROP_TIME);
    const bounce = t > DROP_TIME ? 0.035 * Math.exp(-(t - DROP_TIME) * 7) * Math.sin((t - DROP_TIME) * 28) : 0;
    p.bodyDrop = this.drop * k * k + bounce;

    for (const w of this.wheels) this.step(w, dt);

    // Smoke off the bonnet: thick and dark, a few sparks as it lets go
    const f = fwd(p.yaw);
    const hood = { x: p.pos.x + f.x * p.halfL * 0.62, z: p.pos.z + f.z * p.halfL * 0.62 };
    const y = p.y + 0.95 - p.bodyDrop;
    this.smokeAcc += dt * SMOKE_RATE;
    while (this.smokeAcc >= 1) {
      this.smokeAcc--;
      const shade = Math.random() < 0.25 ? 0.32 : 0.1;
      this.effects.puff(hood.x + (Math.random() - 0.5) * 0.8, y, hood.z + (Math.random() - 0.5) * 0.8, 1.0 + Math.random() * 0.8, 1.8 + Math.random() * 1.4, shade, 1.2 + Math.random() * 1.2);
    }
    if (t < 0.25 && Math.random() < 0.5) this.effects.sparksAt(hood, 0.25, y);
  }

  /** The broken-down car from outside, the camera circling slowly. */
  aim(cam: THREE.PerspectiveCamera): void {
    const p = this.player;
    const a = this.orbit0 + this.time * 0.32;
    const r = 8.5 - Math.min(1.5, this.time * 0.4);
    const gy = this.groundAt(p.pos.x, p.pos.z);
    cam.position.set(p.pos.x + Math.sin(a) * r, gy + 3.1, p.pos.z + Math.cos(a) * r);
    cam.lookAt(p.pos.x, gy + 0.7, p.pos.z);
  }

  private build(): void {
    this.clear();
    this.seq = this.breakdown.seq;
    this.time = 0;
    this.smokeAcc = 0;
    const p = this.player;
    const parts = buildCarParts(p.look.style, p.look.color, p.look.detail);
    parts.body.computeBoundingBox();
    // the underside comes down onto the road
    this.drop = Math.max(0, (parts.body.boundingBox?.min.y ?? 0.2) - 0.03);
    parts.body.dispose();
    this.orbit0 = p.yaw + Math.PI * 0.78;
    const geo = wheelPair(p.look.wheels ?? 'stock');
    const f = fwd(p.yaw);
    const l = leftOf(p.yaw);
    const r = parts.wheelRadius;
    const v = p.phys.state.vel;
    // the four corners (trucks' inner rear duals stay with the wreck)
    for (const [wx, wy, wz] of parts.wheelPos.slice(0, 4)) {
      const side = wx < 0 ? -1 : 1;
      const mesh = new THREE.Mesh(side > 0 ? geo.pos : geo.neg, this.mat);
      mesh.scale.setScalar(r);
      this.group.add(mesh);
      const out = 2.5 + Math.random() * 2;
      const along = (Math.random() - 0.5) * 2.5;
      const vel = new THREE.Vector3(l.x * side * out + f.x * along + v.x * 0.3, 2.4 + Math.random() * 2.4, l.z * side * out + f.z * along + v.z * 0.3);
      this.wheels.push({
        mesh,
        pos: new THREE.Vector3(p.pos.x + l.x * wx + f.x * wz, p.y + wy, p.pos.z + l.z * wx + f.z * wz),
        vel,
        r,
        heading: Math.atan2(vel.x, vel.z),
        spin: 0,
        tilt: 0,
        tiltDir: Math.random() < 0.5 ? -1 : 1,
        onGround: false,
      });
    }
  }

  private step(w: Loose, dt: number): void {
    const { pos, vel } = w;
    const rest = () => this.groundAt(pos.x, pos.z) + w.r * Math.cos(w.tilt) + 0.32 * w.r * Math.abs(Math.sin(w.tilt));
    const px = pos.x;
    const pz = pos.z;
    if (!w.onGround) {
      vel.y -= GRAVITY * dt;
      pos.addScaledVector(vel, dt);
      const floor = rest();
      if (pos.y <= floor) {
        pos.y = floor;
        if (vel.y < -1.2) {
          vel.y = -vel.y * 0.38;
          vel.x *= 0.85;
          vel.z *= 0.85;
        } else {
          vel.y = 0;
          w.onGround = true;
        }
      }
    } else {
      const speed = Math.hypot(vel.x, vel.z);
      if (Math.abs(w.tilt) < Math.PI / 2) {
        if (speed > 0.9) {
          // rolling: slows, and wanders more the slower it goes
          const decay = Math.exp(-0.9 * dt);
          w.heading += w.tiltDir * (0.25 / (speed + 0.4)) * dt;
          const s = speed * decay;
          vel.x = Math.sin(w.heading) * s;
          vel.z = Math.cos(w.heading) * s;
          w.tilt = w.tiltDir * Math.min(0.25, 0.6 / (s + 1.5)) * 0.4 + w.tilt * 0.6;
        } else {
          // too slow to stay up: it falls over
          vel.x *= Math.exp(-4 * dt);
          vel.z *= Math.exp(-4 * dt);
          w.tilt += w.tiltDir * dt * (1.4 + Math.abs(w.tilt) * 5);
          if (Math.abs(w.tilt) >= Math.PI / 2) {
            w.tilt = (w.tiltDir * Math.PI) / 2;
            vel.x = vel.z = 0;
          }
        }
      }
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      pos.y = rest();
    }
    // walls, poles, parked cars' boxes: bounce back off them
    if (this.blocked(pos)) {
      pos.x = px;
      pos.z = pz;
      vel.x *= -0.35;
      vel.z *= -0.35;
      if (Math.hypot(vel.x, vel.z) > 0.05) w.heading = Math.atan2(vel.x, vel.z);
    }
    w.spin += (Math.hypot(vel.x, vel.z) / w.r) * dt;
    if (!w.onGround) w.heading = Math.atan2(vel.x, vel.z) || w.heading;
    this.e.set(w.spin, w.heading, w.tilt, 'YZX');
    w.mesh.position.copy(pos);
    w.mesh.rotation.copy(this.e);
  }

  private blocked(p: THREE.Vector3): boolean {
    for (const b of this.statics.query(p.x - 0.3, p.z - 0.3, p.x + 0.3, p.z + 0.3, this.tmp)) {
      if (b.top !== undefined && p.y > b.top) continue;
      if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ) return true;
    }
    return false;
  }

  private clear(): void {
    for (const w of this.wheels) this.group.remove(w.mesh);
    this.wheels = [];
  }
}
