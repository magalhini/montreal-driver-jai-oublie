import { KMH } from "../config";
import { clamp, lerp } from "../core/math";
import type { World } from "../core/World";
import type { SimSystem } from "../types";
import type { Car } from "../vehicles/Car";
import { addDamage } from "../vehicles/Damage";
import type { Pothole, Potholes } from "../world/Potholes";

/**
 * Thresholds and kicks for the potholes (PRD 5.4, Phase 6). Damage is per wheel that drops in, so a big pit
 * under both wheels of one side costs twice, and the rear axle finds it again a moment later.
 */
export const POTHOLE_TUNING = {
  /** Below this a pit only jolts the car (no damage). */
  safeKmh: 32,
  /** Above this a big pit takes a serious chunk. */
  hardKmh: 50,
  /** Damage per wheel (share of the bar) from safeKmh up to hardKmh. */
  smallLow: 0.003,
  smallHigh: 0.01,
  bigLow: 0.012,
  bigHigh: 0.03,
  /** Per wheel at hardKmh, plus this much per km/h above it, up to `wheelCap`. */
  smallHard: 0.015,
  smallPerKmh: 0.0005,
  bigHard: 0.05,
  bigPerKmh: 0.002,
  wheelCap: 0.14,
  /** Everything above, scaled (playtest: 0.85 was 15% gentler than the first pass; 0.5 since, still too much). */
  damageScale: 0.5,
  /** Kicks for a big pit at 60 km/h (small pits and slower cars get less): nose pitch (rad). */
  pitch: 0.05,
  /** Sideways shove as a share of speed, and a steering yank (rad), toward the pit when a tire clips its edge. */
  shove: 0.025,
  yank: 0.06,
  /** Suspension thump ("landing" speed, m/s) per m/s of car speed. Over 1.5 it is heard, over 2.5 the camera shakes. */
  thump: 0.25,
  /** Above this the body rides the hit: it drops on its suspension and rebounds, instead of only twitching. */
  feelKmh: 30,
  /** Downward heave speed (m/s) and nose rate (rad/s) for a centred big pit around 60 km/h. Less just over 30, more past 60. */
  heave: 1.7,
  nod: 0.9,
  /** AI cars this close to the player bounce through pits. Cruisers also take the kick and the damage. */
  aiRange: 140,
  /** Seconds before another pothole line can show. */
  messageCooldown: 25,
};

const LINES = [
  "That was a pothole. Drive under 30km/h to avoid damage.",
  "Another pothole. It wasn't there yesterday.",
  "Tabarnak, so many nids-de-poule.",
];

/** Small pits are shallower: they kick and cost this share of a big one's kick. */
const SMALL_KICK = 0.45;
/** A wheel that moves farther than this in one step was teleported (respawn, tow, garage), not driven. */
const JUMP = 4;

/** Wheel contact points and which pit each wheel is in, per car. */
interface Track {
  /** Previous step's wheel positions: FL, FR, RL, RR as x, z pairs. */
  prev: Float64Array;
  inPit: Int32Array;
  fresh: boolean;
  seen: number;
}

/** What the debug overlay shows about the last player hit. */
export interface PotholeHitInfo {
  kmh: number;
  damage: number;
  depth: Pothole["depth"];
}

/**
 * Checks the cars' wheels against the pits after the physics step. The player and the SPVM get the kick
 * (pitch, a shove and a steering yank toward the pit, the suspension thump) written into `VehicleState`,
 * and `addDamage` by speed. The pothole line is only for the player. Other nearby cars only bounce.
 * Nothing here touches the tire model.
 */
export class PotholeHits implements SimSystem {
  last: PotholeHitInfo | null = null;
  hits = 0;
  /** The player's car took damage from a pit: true if the slow-motion shot played (it brings its own tip). */
  cutscene: ((p: Pothole, wheel: number) => boolean) | null = null;
  private readonly tracks = new Map<number, Track>();
  private cooldown = 0;
  private told = 0;
  private stepNo = 0;
  private readonly wheels = new Float64Array(8);

  constructor(
    private readonly world: World,
    private readonly potholes: Potholes,
  ) {}

  /** A new session: the first heavy hit gets the first line again. */
  reset(): void {
    this.cooldown = 0;
    this.told = 0;
    this.last = null;
    this.hits = 0;
    this.tracks.clear();
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.stepNo++;
    const player = this.world.player;
    if (!player) return;
    const range2 = POTHOLE_TUNING.aiRange ** 2;
    for (const car of this.world.cars) {
      if (car.removed || car.parked || car.kind === "parked") continue;
      if (
        car !== player &&
        (car.pos.x - player.pos.x) ** 2 + (car.pos.z - player.pos.z) ** 2 >
          range2
      )
        continue;
      const driving = car === player && this.world.mode !== "menu";
      this.check(car, driving || car.kind === "police", driving);
    }
    // Forget cars that left the range or the world
    if (this.stepNo % 120 === 0)
      for (const [id, t] of this.tracks)
        if (this.stepNo - t.seen > 60) this.tracks.delete(id);
  }

  /** `hurt` applies the kick and the damage. `tell` is the player's HUD line and the debug last-hit. */
  private check(car: Car, hurt: boolean, tell: boolean): void {
    const s = car.phys.state;
    let t = this.tracks.get(car.id);
    if (!t) {
      t = {
        prev: new Float64Array(8),
        inPit: new Int32Array(4).fill(-1),
        fresh: true,
        seen: 0,
      };
      this.tracks.set(car.id, t);
    }
    if (this.stepNo - t.seen > 1) t.fresh = true;
    t.seen = this.stepNo;
    const w = this.wheels;
    const sp = car.phys.spec;
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    // left of the heading: (cos yaw, -sin yaw)
    const lx = fz;
    const lz = -fx;
    const track = Math.max(0.5, sp.halfWidth - 0.18);
    for (let i = 0; i < 4; i++) {
      const along = i < 2 ? sp.cgToFront : -sp.cgToRear;
      const side = i % 2 === 0 ? track : -track;
      w[i * 2] = s.pos.x + fx * along + lx * side;
      w[i * 2 + 1] = s.pos.z + fz * along + lz * side;
    }
    const skip = t.fresh || s.airborne || car.wheelsOff || car.ghost;
    t.fresh = false;
    for (let i = 0; i < 4; i++) {
      const x1 = w[i * 2];
      const z1 = w[i * 2 + 1];
      const x0 = t.prev[i * 2];
      const z0 = t.prev[i * 2 + 1];
      t.prev[i * 2] = x1;
      t.prev[i * 2 + 1] = z1;
      if (skip || (x1 - x0) ** 2 + (z1 - z0) ** 2 > JUMP * JUMP) {
        t.inPit[i] = -1;
        continue;
      }
      // The wheel's path this step against the pits around it (swept, so a fast car cannot skip a small one)
      let hit: Pothole | null = null;
      let hitD = Infinity;
      for (const p of this.potholes.at(x1, z1)) {
        const d = segDist(p.pos.x, p.pos.z, x0, z0, x1, z1);
        if (d < p.r * 0.85 && d < hitD) {
          hit = p;
          hitD = d;
        }
      }
      const was = t.inPit[i];
      t.inPit[i] = hit ? hit.id : -1;
      if (!hit || hit.id === was) continue;
      this.drop(car, hurt, tell, i, hit, hitD, lx, lz, x1, z1);
    }
  }

  /** Wheel `i` just dropped into `p`, `d` m from its centre. */
  private drop(
    car: Car,
    hurt: boolean,
    tell: boolean,
    i: number,
    p: Pothole,
    d: number,
    lx: number,
    lz: number,
    wx: number,
    wz: number,
  ): void {
    const T = POTHOLE_TUNING;
    const s = car.phys.state;
    const speed = Math.hypot(s.vel.x, s.vel.z);
    const kmh = speed / KMH;
    const deep = p.depth === "big" ? 1 : SMALL_KICK;
    // Through the middle is deeper than clipping the rim
    const centre = 1 - 0.5 * (d / p.r) ** 2;
    const k = deep * centre;
    const front = i < 2;
    // Suspension thump (the view's landing bounce, the camera shake and the pothole rumble read these)
    const thump = Math.min(8, T.thump * speed * k);
    if (thump > s.landImpact * Math.exp(-s.landT * 6)) {
      s.landImpact = thump;
      s.landT = 0;
      s.landPit = true;
    }
    const f = Math.min(1.5, kmh / 60);
    // Front wheel in: the nose dips. Rear wheel: the tail drops and the nose comes up.
    s.pitch += (front ? -1 : 0.6) * T.pitch * f * k;
    // Above 30 the shell follows the wheel in and the spring brings it back up. Damage is unchanged.
    if (kmh > T.feelKmh) {
      const u = clamp((kmh - T.feelKmh) / 60, 0, 1);
      const ride = (0.55 + 0.85 * u) * k;
      s.heaveV = Math.max(-2.5, s.heaveV - T.heave * ride);
      s.susPitchV = clamp(
        s.susPitchV + (front ? -1 : 0.65) * T.nod * ride,
        -2,
        2,
      );
    }
    if (!hurt) return;

    // Toward the pit, by how far off the tire's line its centre is: dead centre is a straight thud, an edge pulls
    const off = clamp(((p.pos.x - wx) * lx + (p.pos.z - wz) * lz) / p.r, -1, 1);
    const shove = off * T.shove * speed * deep;
    s.vel.x += lx * shove;
    s.vel.z += lz * shove;
    if (front) s.steerAngle += off * T.yank * f * deep;

    const dmg = addDamage(car, damageFor(p.depth, kmh) * centre);
    if (!tell) return;
    this.hits++;
    this.last = { kmh, damage: dmg, depth: p.depth };
    // The shot's tip stands in for the first line
    if (dmg > 0 && this.cutscene?.(p, i)) {
      this.told++;
      this.cooldown = T.messageCooldown;
      return;
    }
    if (dmg > 0 && p.depth === "big" && this.cooldown <= 0) {
      const line =
        this.told === 0
          ? LINES[0]
          : LINES[1 + ((this.told - 1) % (LINES.length - 1))];
      this.world.events.message(line, "warn");
      this.told++;
      this.cooldown = T.messageCooldown;
    }
  }
}

/** Damage for one wheel through a pit's centre at `kmh` (PRD 5.4: none under `safeKmh`, small to `hardKmh`, serious above). */
export function damageFor(depth: Pothole["depth"], kmh: number): number {
  const T = POTHOLE_TUNING;
  if (kmh < T.safeKmh) return 0;
  const big = depth === "big";
  if (kmh < T.hardKmh) {
    const u = (kmh - T.safeKmh) / Math.max(1, T.hardKmh - T.safeKmh);
    return (
      T.damageScale *
      (big ? lerp(T.bigLow, T.bigHigh, u) : lerp(T.smallLow, T.smallHigh, u))
    );
  }
  const over = kmh - T.hardKmh;
  return (
    T.damageScale *
    Math.min(
      T.wheelCap,
      big ? T.bigHard + T.bigPerKmh * over : T.smallHard + T.smallPerKmh * over,
    )
  );
}

/** Distance from (px, pz) to the segment (ax, az) -> (bx, bz). */
function segDist(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const u = l2 > 1e-9 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * u), pz - (az + dz * u));
}
