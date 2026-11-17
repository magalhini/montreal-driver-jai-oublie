import { formatCash } from "../gameplay/Economy";
import type { Car } from "../vehicles/Car";
import "./hud.css";

const RPM_SEGS = 20;
const BAR_SEGS = 12;
/** Circumference of the bust ring (r = 42 in a 100 x 100 viewBox). */
const RING_LEN = 2 * Math.PI * 42;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent: HTMLElement,
  html = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

/** Segmented neon bar that only touches the DOM when the lit count changes. */
class SegBar {
  readonly el: HTMLElement;
  private segs: HTMLElement[] = [];
  private lit = -1;

  constructor(parent: HTMLElement, count: number) {
    this.el = el("div", "hud-bar", parent);
    for (let i = 0; i < count; i++) this.segs.push(el("i", "", this.el));
  }

  /** `color(i, count)` picks each lit segment's color. */
  set(frac: number, color: (i: number, n: number) => string): void {
    const n = Math.round(Math.min(1, Math.max(0, frac)) * this.segs.length);
    if (n === this.lit) return;
    this.lit = n;
    this.segs.forEach((s, i) => {
      s.classList.toggle("on", i < n);
      s.style.setProperty("--seg", i < n ? color(i, this.segs.length) : "");
    });
  }
}

const rampColor = (i: number, n: number) =>
  i / n < 0.5 ? "#3ef2ff" : i / n < 0.8 ? "#ffb43e" : "#ff3e5e";
const felonyColor = (i: number, n: number) =>
  i / n < 0.34 ? "#ffb43e" : i / n < 0.67 ? "#ff7a3e" : "#ff2e6a";

/** Retro DOM overlay: speedometer, gear, rpm, cash, damage, felony, objective, bust ring and busted screen. */
export class Hud {
  /** Set by gameplay systems; rendered on the next update. */
  cash = 0;
  felony = 0;
  /** Pursued but out of sight: the felony bar blinks. */
  evading = false;
  /** 0..1 fill of the "BUSTED" ring. */
  bust = 0;
  /** Word in the middle of the ring. */
  bustLabel = "CASSÉE!";
  /** Busted screen showing this fine (null: hidden). */
  bustedFine: number | null = null;
  /** Black screen fade 0..1 (under the HUD). */
  fade = 0;
  objective = "";
  /** Mission clock under the objective (`m:ss`), null to hide it. */
  clock: string | null = null;
  paused = false;
  /** Speed limiter cap in km/h while it is on, null while off. */
  limiter: number | null = null;
  /** Player headlights on (K). */
  lights = true;
  /** Ignition (IMPROVEMENTS #21): off shows P and ENGINE OFF in the gear line. */
  engine: "on" | "off" | "cranking" = "on";
  /** Debug full immunity is on (the felony label says so). */
  immune = false;
  /** Posted speed limit (km/h) of the current road, and whether the player is over the speeding threshold. */
  speedLimit = 40;
  speeding = false;

  private speedEl: HTMLElement;
  private limiterEl: HTMLElement;
  private clockEl: HTMLElement;
  private shownClock: string | null = null;
  private limitEl: HTMLElement;
  private lightsEl: HTMLElement;
  private gearEl: HTMLElement;
  private cashEl: HTMLElement;
  private objEl: HTMLElement;
  private pausedEl: HTMLElement;
  private rpm: SegBar;
  private damage: SegBar;
  private felonyBar: SegBar;
  private felonyLabel: HTMLElement;
  private bustEl: HTMLElement;
  private bustFill: SVGCircleElement;
  private bustSpan: HTMLElement;
  private bustedEl: HTMLElement;
  private fineEl: HTMLElement;
  private fadeEl: HTMLElement;
  private stuntEl: HTMLElement;
  private stuntT = 0;
  private shown = {
    limiter: NaN as number | null,
    lights: null as boolean | null,
    speed: -1,
    limit: -1,
    speeding: false,
    gear: "",
    cash: NaN,
    obj: "",
    paused: false,
    evading: false,
    immune: false,
    bust: -1,
    bustLabel: "",
    fine: -1,
    fade: -1,
  };
  private cashFlash = 0;

  constructor(readonly root: HTMLElement) {
    this.fadeEl = el("div", "hud-fade", root);
    const speedo = el("div", "hud-panel hud-speedo", root);
    this.limiterEl = el("div", "hud-limiter", speedo);
    this.lightsEl = el("div", "hud-lights", speedo);
    this.limitEl = el("div", "hud-limit", speedo, "40");
    this.speedEl = el("div", "hud-speed", speedo);
    this.rpm = new SegBar(speedo, RPM_SEGS);
    this.gearEl = el("div", "hud-gear", speedo);

    const status = el("div", "hud-panel hud-status", root);
    el("div", "hud-label", status, "DAMAGE");
    this.damage = new SegBar(status, BAR_SEGS);
    this.felonyLabel = el("div", "hud-label", status, "FELONY");
    this.felonyBar = new SegBar(status, BAR_SEGS);

    this.cashEl = el("div", "hud-panel hud-cash", root);
    this.objEl = el("div", "hud-objective", root);
    this.clockEl = el("div", "hud-clock", root);
    this.bustEl = el(
      "div",
      "hud-bust",
      root,
      `<svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="42"/><circle class="fill" cx="50" cy="50" r="42" stroke-dasharray="${RING_LEN}"/></svg><span>BUSTED</span>`,
    );
    this.bustFill = this.bustEl.querySelector(".fill")!;
    this.bustSpan = this.bustEl.querySelector("span")!;
    this.bustedEl = el(
      "div",
      "hud-busted",
      root,
      '<div class="title">SPVM</div>',
    );
    this.fineEl = el("div", "fine", this.bustedEl);
    this.pausedEl = el("div", "hud-paused", root, "PAUSED");
    this.stuntEl = el("div", "hud-stunt", root);
  }

  /**
   * Big center popup. `reward` null omits the cash line and draws the title as a failure
   * (a smashed delivery, the clock running out, the SPVM seeing you); false omits it, no failure.
   */
  stunt(
    title: string,
    detail: string,
    reward: number | null | false,
    hold = false,
  ): void {
    const pay =
      typeof reward === "number"
        ? `<div class="reward">+${formatCash(reward)}</div>`
        : "";
    this.stuntEl.classList.toggle("fail", reward === null);
    this.stuntEl.classList.toggle("long", hold);
    this.stuntEl.innerHTML = `<div class="title">${title}</div><div class="detail">${detail}</div>${pay}`;
    this.stuntEl.classList.remove("show");
    void this.stuntEl.offsetWidth; // restart the animation
    this.stuntEl.classList.add("show");
    this.stuntT = hold ? 5.2 : 2.4;
  }

  /** Call once per render frame. */
  update(player: Car, dt: number): void {
    const s = player.phys.state;
    if (this.stuntT > 0 && (this.stuntT -= dt) <= 0)
      this.stuntEl.classList.remove("show");
    if (this.limiter !== this.shown.limiter) {
      this.shown.limiter = this.limiter;
      this.limiterEl.classList.toggle("on", this.limiter !== null);
      this.limiterEl.innerHTML =
        this.limiter === null
          ? "LIMITER OFF <kbd>L</kbd>"
          : `LIMITER ${this.limiter}<small>km/h</small>`;
    }
    if (this.lights !== this.shown.lights) {
      this.shown.lights = this.lights;
      this.lightsEl.classList.toggle("off", !this.lights);
      this.lightsEl.innerHTML = this.lights
        ? "LIGHTS ON <kbd>K</kbd>"
        : "LIGHTS OFF <kbd>K</kbd>";
    }
    if (
      this.speedLimit !== this.shown.limit ||
      this.speeding !== this.shown.speeding
    ) {
      this.shown.limit = this.speedLimit;
      this.shown.speeding = this.speeding;
      this.limitEl.textContent = String(this.speedLimit);
      this.limitEl.classList.toggle("over", this.speeding);
      this.speedEl.classList.toggle("over", this.speeding);
    }
    const kmh = Math.round(Math.abs(s.speed) * 3.6);
    if (kmh !== this.shown.speed) {
      this.shown.speed = kmh;
      this.speedEl.innerHTML = `${kmh}<small>km/h</small>`;
    }
    const gear =
      this.engine !== "on"
        ? "P"
        : s.gear < 0
          ? "R"
          : s.gear === 0
            ? "N"
            : String(s.gear);
    const label =
      this.engine === "off"
        ? "P <small>ENGINE OFF <kbd>I</kbd></small>"
        : this.engine === "cranking"
          ? "P <small>STARTING</small>"
          : `GEAR ${gear}`;
    if (label !== this.shown.gear) {
      this.shown.gear = label;
      this.gearEl.innerHTML = label;
    }
    const spec = player.phys.spec;
    this.rpm.set(
      (s.rpm - spec.idleRpm) / (spec.redline - spec.idleRpm),
      rampColor,
    );
    this.damage.set(Math.min(1, s.damage), rampColor);
    this.felonyBar.set(this.felony, felonyColor);
    if (
      this.evading !== this.shown.evading ||
      this.immune !== this.shown.immune
    ) {
      this.shown.evading = this.evading;
      this.shown.immune = this.immune;
      this.felonyBar.el.classList.toggle("evading", this.evading);
      this.felonyLabel.textContent = this.immune
        ? "FELONY - IMMUNE"
        : this.evading
          ? "FELONY - EVADING"
          : "FELONY";
    }
    this.updateBust();

    if (this.cash !== this.shown.cash) {
      if (!Number.isNaN(this.shown.cash)) {
        this.cashEl.classList.toggle("flash-good", this.cash > this.shown.cash);
        this.cashEl.classList.toggle("flash-bad", this.cash < this.shown.cash);
        this.cashFlash = 1.2;
      }
      this.shown.cash = this.cash;
      this.cashEl.textContent = formatCash(this.cash);
    }
    if (this.cashFlash > 0) {
      this.cashFlash -= dt;
      if (this.cashFlash <= 0)
        this.cashEl.classList.remove("flash-good", "flash-bad");
    }
    if (this.clock !== this.shownClock) {
      this.shownClock = this.clock;
      this.clockEl.textContent = this.clock ?? "";
    }
    if (this.objective !== this.shown.obj) {
      this.shown.obj = this.objective;
      this.objEl.textContent = this.objective;
    }
    if (this.paused !== this.shown.paused) {
      this.shown.paused = this.paused;
      this.pausedEl.classList.toggle("show", this.paused);
    }
  }

  private updateBust(): void {
    if (this.bustLabel !== this.shown.bustLabel) {
      this.shown.bustLabel = this.bustLabel;
      this.bustSpan.textContent = this.bustLabel;
    }
    const ring = this.bustedFine !== null ? 0 : Math.round(this.bust * 100);
    if (ring !== this.shown.bust) {
      this.shown.bust = ring;
      this.bustEl.classList.toggle("show", ring > 0);
      this.bustFill.style.strokeDashoffset = String(
        RING_LEN * (1 - ring / 100),
      );
    }
    const fine = this.bustedFine ?? -1;
    if (fine !== this.shown.fine) {
      this.shown.fine = fine;
      this.bustedEl.classList.toggle("show", fine >= 0);
      this.fineEl.textContent = fine >= 0 ? `FINE ${formatCash(fine)}` : "";
    }
    const fade = Math.round(this.fade * 50) / 50;
    if (fade !== this.shown.fade) {
      this.shown.fade = fade;
      this.fadeEl.style.opacity = String(fade);
    }
  }
}
