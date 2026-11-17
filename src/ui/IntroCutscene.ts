import * as THREE from "three";
import { CONFIG } from "../config";
import { fwd, leftOf } from "../core/math";
import type { World } from "../core/World";
import type { Closures } from "../gameplay/Closures";
import type { Vec2 } from "../types";
import type { Car } from "../vehicles/Car";
import { metroSites } from "../world/MetroEntrances";
import type { Potholes } from "../world/Potholes";
import { laneOffset } from "../world/RoadGraph";

/** Shot lengths and fades (s). Five shots make the ten seconds. */
export const INTRO_TUNING = {
  shot: 2,
  /** Black at the start (out of the title) and at the end (into the driver's seat). */
  fadeIn: 0.45,
  fadeOut: 0.4,
};

/** One shot: the camera dollies `from` -> `to` while looking at `look()` (which may follow a moving car). */
interface Shot {
  title: string;
  sub: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  look: () => THREE.Vector3;
  /** Re-frame when the shot comes up (a moving subject: where it is now, not at the start of the intro). */
  restage?: () => Shot | null;
}

const CURB_SIDE = CONFIG.DRIVE_SIDE === "left" ? 1 : -1;
const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * Ten seconds of Montreal before the drive (both modes): a rue barrée fence, an ARRÊT sign at an all-way stop,
 * an SPVM cruiser going by, the deepest pothole in town and a métro entrance, each with a caption in the
 * letterbox. The city keeps running underneath (the cruiser is really driving). ESC, F or Space skips it.
 * Shots that the city can't stage this session (no cruiser on the road, no fence rolled) are left out.
 */
export class IntroCutscene {
  /** Black over the screen (0..1), shared with the HUD fade. */
  fade = 0;
  private shots: Shot[] = [];
  private t = 0;
  private index = -1;
  private ending = -1;
  private done: (() => void) | null = null;
  private readonly cine: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly ui: HTMLElement,
    private readonly world: World,
    private readonly closures: Closures,
    private readonly potholes: Potholes,
  ) {
    this.cine = document.createElement("div");
    this.cine.className = "cine intro-cine";
    this.cine.innerHTML =
      '<div class="cine-bar top"></div><div class="cine-bar bottom"></div><div class="cine-caption"></div><div class="cine-skip"><kbd>ESC</kbd> / <kbd>F</kbd> / <kbd>SPACE</kbd> skip</div>';
    this.caption = this.cine.querySelector(".cine-caption")!;
    ui.appendChild(this.cine);
  }

  /** The intro owns the camera and the screen. */
  get playing(): boolean {
    return this.done !== null;
  }

  /** Roll the intro, then call `then` (the briefing, or the free-roam welcome). */
  play(then: () => void): void {
    this.shots = this.stage();
    if (!this.shots.length) {
      then();
      return;
    }
    this.done = then;
    this.t = 0;
    this.index = -1;
    this.ending = -1;
    this.fade = 1;
    this.cine.classList.add("show");
    this.ui.classList.add("cinematic");
  }

  /** ESC / F / Space: straight to the fade into the car. */
  skip(): void {
    if (this.playing && this.ending < 0) this.ending = 0;
  }

  /** Once per frame, real time (the city runs under it). */
  update(dt: number): void {
    if (!this.playing) {
      this.fade = Math.max(0, this.fade - dt / INTRO_TUNING.fadeOut);
      return;
    }
    const T = INTRO_TUNING;
    if (this.ending >= 0) {
      this.ending += dt;
      this.fade = Math.min(1, this.ending / T.fadeOut);
      if (this.fade >= 1) this.finish();
      return;
    }
    this.t += dt;
    const total = this.shots.length * T.shot;
    const i = Math.min(this.shots.length - 1, Math.floor(this.t / T.shot));
    if (i !== this.index) {
      this.index = i;
      const fresh = this.shots[i].restage?.();
      if (fresh) this.shots[i] = fresh;
      this.showCaption(this.shots[i]);
    }
    this.fade = Math.max(0, 1 - this.t / T.fadeIn);
    if (this.t >= total - T.fadeOut) this.ending = this.t - (total - T.fadeOut);
  }

  /** Put the camera on the current shot. */
  aim(camera: THREE.PerspectiveCamera): void {
    const shot = this.shots[Math.max(0, this.index)];
    if (!shot) return;
    const u = ease(
      Math.min(
        1,
        Math.max(
          0,
          (this.t - Math.max(0, this.index) * INTRO_TUNING.shot) /
            INTRO_TUNING.shot,
        ),
      ),
    );
    camera.position.lerpVectors(shot.from, shot.to, u);
    camera.lookAt(shot.look());
  }

  private finish(): void {
    const then = this.done;
    this.done = null;
    this.cine.classList.remove("show");
    this.caption.classList.remove("show");
    this.ui.classList.remove("cinematic");
    then?.();
  }

  private showCaption(s: Shot): void {
    this.caption.innerHTML = `<div class="name">${s.title}</div><div class="jp">${s.sub}</div>`;
    this.caption.style.animationDuration = `${INTRO_TUNING.shot}s`;
    this.caption.classList.remove("show");
    void this.caption.offsetWidth;
    this.caption.classList.add("show");
  }

  /** Find this session's fence, stop sign, cruiser, pit and métro, and frame each one. */
  private stage(): Shot[] {
    return [
      this.fenceShot(),
      this.arretShot(),
      this.policeShot(),
      this.potholeShot(),
      this.metroShot(),
    ].filter((s): s is Shot => s !== null);
  }

  private ground(p: Vec2, up: number): THREE.Vector3 {
    return new THREE.Vector3(
      p.x,
      this.world.city.terrain.surfaceY(p.x, p.z) + up,
      p.z,
    );
  }

  /** Nearest to downtown, so the background is city and not the edge of the map. */
  private central<T>(items: T[], at: (t: T) => Vec2): T | null {
    const c = this.world.city.nodeAt(
      Math.min(8, this.world.city.nx - 1),
      Math.min(4, this.world.city.nz - 1),
    ).pos;
    let best: T | null = null;
    let bestD = Infinity;
    for (const it of items) {
      const p = at(it);
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  private fenceShot(): Shot | null {
    const fences = this.closures.hard
      .filter((h) => h.side === "both")
      .flatMap((h) => h.fences);
    const f = this.central(fences, (x) => ({
      x: (x.a.x + x.b.x) / 2,
      z: (x.a.z + x.b.z) / 2,
    }));
    if (!f) return null;
    const mid = { x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2 };
    const side = { x: -f.facing.z, z: f.facing.x };
    const at = (d: number, s: number, up: number) =>
      this.ground(
        {
          x: mid.x + f.facing.x * d + side.x * s,
          z: mid.z + f.facing.z * d + side.z * s,
        },
        up,
      );
    const look = this.ground(mid, 1.1);
    return {
      title: "Rue barrée",
      sub: "DÉTOUR · the GPS has no idea",
      from: at(14, 2.5, 2.2),
      to: at(8.5, 1, 1.7),
      look: () => look,
    };
  }

  private arretShot(): Shot | null {
    const city = this.world.city;
    const lanes = city.lanes.filter(
      (l) =>
        l.index === 0 && city.nodes[l.to].control === "stop" && l.length > 30,
    );
    const lane = this.central(lanes, (l) => l.end);
    if (!lane) return null;
    const e = city.edges[lane.edgeId];
    const d = lane.dir;
    const left = { x: d.z, z: -d.x };
    const out = CURB_SIDE * (e.width / 2 + 0.45 - laneOffset(e, lane.index));
    const along = lane.length - 0.3;
    const sign = {
      x: lane.start.x + d.x * along + left.x * out,
      z: lane.start.z + d.z * along + left.z * out,
    };
    const at = (back: number, lat: number, up: number) =>
      this.ground(
        {
          x: lane.end.x - d.x * back + left.x * lat,
          z: lane.end.z - d.z * back + left.z * lat,
        },
        up,
      );
    const look = this.ground(sign, 2.1);
    return {
      title: "Arrêt",
      sub: "all-way · full stop",
      from: at(11, 0.6, 1.6),
      to: at(6.5, 0.2, 1.8),
      look: () => look,
    };
  }

  private policeShot(): Shot | null {
    const shot = this.framePolice();
    return shot && { ...shot, restage: () => this.framePolice() };
  }

  /** The fastest cruiser on the road right now, framed so it reaches the camera halfway through the shot. */
  private framePolice(): Shot | null {
    const cops = this.world.cars.filter(
      (c) => c.kind === "police" && !c.removed,
    );
    if (!cops.length) return null;
    const car: Car = cops.reduce((a, c) => (c.speed > a.speed ? c : a));
    // Ahead of the cruiser at the roadside on the drive side, low; it comes up the street and goes by
    const f = fwd(car.yaw);
    const l = leftOf(car.yaw);
    const ahead = 5 + Math.min(16, car.speed * INTRO_TUNING.shot * 0.55);
    const lat = CURB_SIDE * 4.2;
    const p = {
      x: car.pos.x + f.x * ahead + l.x * lat,
      z: car.pos.z + f.z * ahead + l.z * lat,
    };
    const from = this.ground(p, 1.25);
    const to = this.ground({ x: p.x + f.x * 1.5, z: p.z + f.z * 1.5 }, 1.35);
    return {
      title: "SPVM",
      sub: "Service de police de la Ville de Montréal",
      from,
      to,
      look: () => this.v.set(car.pos.x, from.y - 0.35, car.pos.z),
    };
  }

  private potholeShot(): Shot | null {
    const pits = this.potholes.pits.filter((p) => p.depth === "big");
    if (!pits.length) return null;
    const pit = pits.reduce((a, p) => (p.r > a.r ? p : a));
    const e = this.world.city.edges[pit.edge];
    const a = e.pts[0];
    const b = e.pts[e.pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const d = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    const at = (back: number, side: number, up: number) =>
      this.ground(
        {
          x: pit.pos.x - d.x * back - d.z * side,
          z: pit.pos.z - d.z * back + d.x * side,
        },
        up,
      );
    const look = this.ground(pit.pos, -0.2);
    return {
      title: "Nid-de-poule",
      sub: "deep enough to keep a tire",
      from: at(pit.r + 8, 1.4, 2.3),
      to: at(pit.r + 5, -0.4, 1.6),
      look: () => look,
    };
  }

  private metroShot(): Shot | null {
    const site = this.central(metroSites(this.world.city), (s) => s.pos);
    if (!site) return null;
    const n = site.normal;
    const c = site.toCorner;
    const at = (out: number, along: number, up: number) =>
      this.ground(
        {
          x: site.pos.x + n.x * out + c.x * along,
          z: site.pos.z + n.z * out + c.z * along,
        },
        up,
      );
    // The blade sign hangs off the canopy's corner end, about 4 m along and 1.8 m out
    const sign = this.ground(
      {
        x: site.pos.x + c.x * 4.2 + n.x * 1.8,
        z: site.pos.z + c.z * 4.2 + n.z * 1.8,
      },
      2.8,
    );
    return {
      title: "Métro",
      sub: `${site.name} · you should have taken the metro.`,
      from: at(9, -6, 1.7),
      to: at(7, -2.5, 2.1),
      look: () => sign,
    };
  }
}
