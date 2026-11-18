import type * as THREE from "three";
import type { GarageEvent } from "../audio/GarageAudio";
import type { Input } from "../core/Input";
import type { Builds } from "../gameplay/Builds";
import { formatClock, TIRE_CUES, type TireCue, type TireOffer } from "../gameplay/WinterTires";
import { formatCash } from "../gameplay/Economy";
import type { PostFX } from "../render/PostFX";
import type { Tone } from "../types";
import type { Car } from "../vehicles/Car";
import { peakPs, topSpeedKmh } from "../vehicles/CarStats";
import type { CarSpec } from "../vehicles/CarSpec";
import { builtLook, FLEET, fleetIdOf, type FleetId } from "../vehicles/Fleet";
import {
  burnoutPrice,
  CHARMS,
  engineNote,
  PAINTS,
  PART_INFO,
  partStages,
  resale,
  STOCK_BUILD,
  tunedSpec,
  WHEELS,
  type CarBuild,
  type PartKind,
} from "../vehicles/Tuning";
import { INTRO, PitGarage, type ShopShot } from "../world/PitGarage";
import type { PitStop } from "../world/PitStops";
import "./pitshop.css";

type Tab = "tires" | "repair" | PartKind | "burnout" | "wheels" | "paint" | "charm";

const TABS: { id: Tab; label: string; jp: string; shot: ShopShot }[] = [
  // Only at the winter-tire drive's garage (`ShopHost.winterTires`), and then always first
  { id: "tires", label: "TIRES", jp: "タイヤ", shot: "wheel" },
  { id: "repair", label: "REPAIR", jp: "修理", shot: "overview" },
  {
    id: "engine",
    label: PART_INFO.engine.label,
    jp: PART_INFO.engine.jp,
    shot: "front",
  },
  {
    id: "weight",
    label: PART_INFO.weight.label,
    jp: PART_INFO.weight.jp,
    shot: "side",
  },
  {
    id: "handling",
    label: PART_INFO.handling.label,
    jp: PART_INFO.handling.jp,
    shot: "rear",
  },
  {
    id: "brakes",
    label: PART_INFO.brakes.label,
    jp: PART_INFO.brakes.jp,
    shot: "wheel",
  },
  { id: "burnout", label: "BURNOUT", jp: "バーンアウト", shot: "rear" },
  { id: "wheels", label: "WHEELS", jp: "ホイール", shot: "wheel" },
  { id: "paint", label: "PAINT", jp: "塗装", shot: "side" },
  { id: "charm", label: "CHARMS", jp: "porte-bonheur", shot: "bench" },
];

const isPart = (t: Tab): t is PartKind =>
  t === "engine" || t === "weight" || t === "handling" || t === "brakes";

interface Row {
  name: string;
  detail: string;
  tag: string;
  tagClass: "price" | "free" | "fitted" | "locked" | "owned" | "refund";
  /** Price, for the can't-afford tint. */
  price?: number;
  /** CSS color of the paint swatch. */
  swatch?: string;
  /** The build to show (and compare stats with) while this row is highlighted. */
  preview: CarBuild;
  confirm(): void;
}

export interface ShopHost {
  car(): Car;
  cash(): number;
  /** Take the money; false (and nothing taken) when the wallet can't cover it. */
  pay(amount: number): boolean;
  /** Pay the player back for a part taken off. */
  refund(amount: number): void;
  repairQuote(): number;
  repair(): void;
  /** Put this build on the player's car (spec, paint, rims, charm). */
  equip(id: FleetId, build: CarBuild): void;
  /** Back on the forecourt: parked in the circle, nose to the street. */
  park(stop: PitStop): void;
  message(text: string, tone: Tone): void;
  /** Stop the simulation for the whole visit. */
  pause(on: boolean): void;
  sound(kind: "move" | "ok" | "back"): void;
  /** The crew answers the menu with a recorded sound: previews, fits, the till, leaving (`audio/GarageAudio.ts`). */
  garage(ev: GarageEvent): void;
  /** What the TIRES tab offers at this garage, or null for no tab. */
  winterTires(stop: PitStop): TireOffer | null;
  /** Put the winter set on (the drive's goal). Returns the prize and the time, or null when the drive can't take it. */
  installWinterTires(): { reward: number; elapsed: number } | null;
  /** One tool of the tire swap. */
  tireCue(step: TireCue): void;
}

type Phase = "idle" | "out" | "intro" | "menu" | "in" | "back";

const HOLD_DELAY = 0.38;
const HOLD_REPEAT = 0.12;
const css = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`;

/**
 * NEO OIL pit garage (stop in a pit stop's service circle). The city fades out, a short cutscene plays (the
 * car rolls into the workshop and the crew gets to work: any key skips it), then the menu comes up over the
 * workshop with the mechanics busy on the car. Repairs and performance parts cost money; parts come in
 * stages tailored to each car, and the top stage of each can be taken off for 80% of its price. The burnout kit is
 * one per car, and it is still there when you come back to it. Rims and paint are free, the mirror charms are cheap toys you keep. Rims,
 * paint and charms preview on the car as you browse. Esc leaves: the car is back in the circle, ready to go.
 */
export class PitShop {
  private readonly garage: PitGarage;
  private readonly root: HTMLElement;
  private readonly cine: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly el: Record<
    | "station"
    | "cash"
    | "tabs"
    | "title"
    | "jp"
    | "car"
    | "note"
    | "rows"
    | "status"
    | "stats"
    | "foot",
    HTMLElement
  >;
  private phase: Phase = "idle";
  /** Black screen 0..1, shared with the HUD fade. */
  fade = 0;
  /** Seconds since the car arrived (drives the workshop scene). */
  private t = 0;
  private skipping = false;
  private lit = false;
  private stop: PitStop | null = null;
  private id: FleetId | null = null;
  private tab = 0;
  private row = 0;
  private focus: "tabs" | "rows" = "tabs";
  private status = "";
  private statusTone: "good" | "warn" = "good";
  private spent = 0;
  private enter = false;
  private holdDir = 0;
  private holdT = 0;
  private padPrev = new Set<number>();
  private shownKey = "";
  /** Tool sounds still to play for a tire swap, on the menu clock. */
  private cues: { at: number; step: TireCue }[] = [];

  constructor(
    private readonly ui: HTMLElement,
    renderer: THREE.WebGLRenderer,
    private readonly post: PostFX,
    private readonly builds: Builds,
    private readonly host: ShopHost,
  ) {
    this.garage = new PitGarage(renderer);
    this.cine = document.createElement("div");
    this.cine.className = "cine pit-cine";
    this.cine.innerHTML =
      '<div class="cine-bar top"></div><div class="cine-bar bottom"></div><div class="cine-caption"></div><div class="cine-skip"><kbd>F</kbd> / <kbd>SPACE</kbd> skip</div>';
    this.caption = this.cine.querySelector(".cine-caption")!;
    ui.appendChild(this.cine);

    this.root = document.createElement("div");
    this.root.className = "pit-shop";
    this.root.innerHTML = `
      <div class="ps-top"><div class="ps-kicker">NEO OIL PIT GARAGE</div><div class="ps-jp">ネオ石油 整備工場</div><div class="ps-station"></div></div>
      <div class="ps-cash"><span>CASH</span><b></b></div>
      <div class="ps-tabs"></div>
      <div class="ps-panel">
        <div class="ps-head"><span class="ps-title"></span><span class="ps-title-jp"></span></div>
        <div class="ps-car"></div>
        <div class="ps-note"></div>
        <div class="ps-rows"></div>
        <div class="ps-status"></div>
        <div class="ps-stats"></div>
      </div>
      <div class="ps-foot"></div>`;
    const q = (c: string) => this.root.querySelector<HTMLElement>(c)!;
    this.el = {
      station: q(".ps-station"),
      cash: q(".ps-cash b"),
      tabs: q(".ps-tabs"),
      title: q(".ps-title"),
      jp: q(".ps-title-jp"),
      car: q(".ps-car"),
      note: q(".ps-note"),
      rows: q(".ps-rows"),
      status: q(".ps-status"),
      stats: q(".ps-stats"),
      foot: q(".ps-foot"),
    };
    ui.appendChild(this.root);

    this.root.addEventListener("click", (e) => {
      if (!this.ready) return;
      const target = e.target as HTMLElement;
      const tab = target.closest<HTMLElement>("[data-tab]");
      const row = target.closest<HTMLElement>("[data-row]");
      if (tab) {
        this.focus = "tabs";
        this.selectTab(Number(tab.dataset.tab));
      } else if (row) {
        const i = Number(row.dataset.row);
        if (this.focus === "rows" && this.row === i) this.confirm();
        else {
          this.focus = "rows";
          this.row = i;
          this.host.sound("move");
          this.previewSound();
        }
      }
    });
    window.addEventListener("keydown", (e) => {
      if (e.repeat || !this.active) return;
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        this.enter = true;
      }
    });
  }

  get active(): boolean {
    return this.phase !== "idle";
  }

  /** Seconds since the car arrived (the cutscene, then the menu), or null outside the workshop: the audio follows it. */
  get scene(): number | null {
    return this.phase === "intro" || this.phase === "menu" || this.phase === "in"
      ? this.t
      : null;
  }

  /** Build the workshop ahead of time (call on the title screen). */
  prepare(): void {
    this.garage.prepare();
  }

  /** Drive in: the player stopped in this station's circle. */
  open(stop: PitStop): void {
    if (this.active) return;
    this.stop = stop;
    this.id = fleetIdOf(this.host.car());
    this.phase = "out";
    this.t = 0;
    this.skipping = false;
    this.tab = 0;
    this.row = 0;
    this.focus = "tabs";
    this.status = "";
    this.spent = 0;
    this.cues = [];
    // The winter-tire drive's garage: the cursor is already on INSTALL
    if (this.host.winterTires(stop) === "ready") this.focus = "rows";
    this.host.pause(true);
    this.host.sound("ok");
  }

  /** Fades, the cutscene, the menu keys. Returns true while the garage owns the screen and the input. */
  frame(dt: number, input: Input, back: boolean): boolean {
    if (!this.active) {
      this.enter = false;
      return false;
    }
    this.animate(dt);
    const any =
      back ||
      this.enter ||
      input.pressed("interact") ||
      input.pressed("handbrake");
    if (this.phase === "intro" && any && !this.skipping && this.t > 0.4)
      this.skipping = true;
    else if (this.ready) this.controls(dt, input, back);
    this.enter = false;
    this.present(dt);
    return true;
  }

  private get ready(): boolean {
    return this.phase === "menu" && this.fade <= 0.05;
  }

  private animate(dt: number): void {
    switch (this.phase) {
      case "out":
        this.fade = Math.min(1, this.fade + dt / 0.6);
        if (this.fade >= 1) {
          this.garage.prepare();
          this.phase = "intro";
          this.t = 0;
          this.caption.innerHTML = `<div class="name">${this.stop?.name ?? "GARAGE"}</div><div class="jp">PNEUS · RÉPARATION</div>`;
          const kicker = this.root.querySelector(".ps-kicker");
          const brand = this.root.querySelector(".ps-jp");
          if (kicker) kicker.textContent = this.stop?.name ?? "GARAGE";
          if (brand) brand.textContent = "PNEUS · RÉPARATION";
          this.caption.classList.remove("show");
          void this.caption.offsetWidth;
          this.caption.classList.add("show");
        }
        return;
      case "intro":
        this.t += dt;
        if (this.skipping) {
          this.fade = Math.min(1, this.fade + dt / 0.25);
          if (this.fade >= 1) {
            this.skipping = false;
            this.t = INTRO;
            this.phase = "menu";
          }
        } else {
          this.fade = Math.max(0, this.fade - dt / 0.5);
          if (this.t >= INTRO) this.phase = "menu";
        }
        return;
      case "menu":
        this.t += dt;
        while (this.cues.length && this.t >= this.cues[0].at)
          this.host.tireCue(this.cues.shift()!.step);
        this.fade = Math.max(0, this.fade - dt / 0.35);
        return;
      case "in":
        this.t += dt;
        this.fade = Math.min(1, this.fade + dt / 0.5);
        if (this.fade >= 1) {
          if (this.stop) this.host.park(this.stop);
          const bill =
            this.spent > 0
              ? `${formatCash(this.spent)} well spent. Drive safe!`
              : this.spent < 0
                ? `${formatCash(-this.spent)} back in your pocket. Drive safe!`
                : "Come back any time!";
          this.host.message(`${this.stop?.name ?? "NEO OIL"}: ${bill}`, "good");
          this.phase = "back";
        }
        return;
      case "back":
        this.fade = Math.max(0, this.fade - dt / 0.6);
        if (this.fade <= 0) {
          this.phase = "idle";
          this.stop = null;
          this.host.pause(false);
        }
        return;
    }
  }

  /** The workshop in place of the city, and the chrome over it. */
  private present(dt: number): void {
    const scene =
      this.phase === "intro" || this.phase === "menu" || this.phase === "in";
    if (scene) {
      const preview = this.previewBuild();
      if (this.id) this.garage.setCar(builtLook(this.id, preview));
      else this.garage.setCar({ ...this.host.car().look });
      this.garage.setCharm(preview.charm);
      const shot = this.phase === "intro" ? "overview" : this.tabs()[this.tab].shot;
      this.garage.update(
        this.t,
        dt,
        this.id ? shot : "overview",
        window.innerWidth / Math.max(1, window.innerHeight),
      );
      this.post.setOverlay(this.garage.scene, this.garage.camera);
      this.lit = true;
    } else if (this.lit) {
      this.lit = false;
      this.post.setOverlay(null);
    }
    const chrome = this.phase === "menu" || this.phase === "in";
    this.ui.classList.toggle("cinematic", this.phase === "intro");
    this.cine.classList.toggle("show", this.phase === "intro");
    this.ui.classList.toggle("in-pitshop", chrome);
    this.root.classList.toggle("show", chrome);
    this.root.classList.toggle("ready", this.ready);
    this.root.style.opacity = chrome ? String(1 - this.fade) : "0";
    if (chrome) this.render();
  }

  /** The car's saved build, or the highlighted rim / paint / charm on top of it while browsing those. */
  private previewBuild(): CarBuild {
    if (!this.id)
      return { ...STOCK_BUILD, charm: this.host.car().look.charm ?? "cone" };
    const build = this.builds.of(this.id);
    if (this.phase !== "menu" || this.focus !== "rows") return build;
    const tab = this.tabs()[this.tab].id;
    if (tab !== "wheels" && tab !== "paint" && tab !== "charm") return build;
    return this.rows()[this.row]?.preview ?? build;
  }

  private controls(dt: number, input: Input, back: boolean): void {
    const pad = this.pad();
    const up = input.pressed("throttle") || input.pressed("limiter");
    const down = input.pressed("brake") || input.pressed("headlights");
    const left = input.pressed("left") || input.pressed("blinkLeft");
    const right = input.pressed("right") || input.pressed("blinkRight");
    const ok =
      this.enter ||
      input.pressed("interact") ||
      input.pressed("handbrake") ||
      pad.ok;
    if (back || pad.back) {
      this.back();
      return;
    }
    if (up) this.move(-1);
    else if (down) this.move(1);
    const dir =
      (input.isHeld("brake") ? 1 : 0) - (input.isHeld("throttle") ? 1 : 0);
    if (dir !== 0 && dir === this.holdDir) {
      if ((this.holdT -= dt) <= 0) {
        this.holdT = HOLD_REPEAT;
        this.move(dir);
      }
    } else {
      this.holdDir = dir;
      this.holdT = HOLD_DELAY;
    }
    if (this.focus === "tabs" && (right || ok)) this.enterRows();
    else if (this.focus === "rows" && left) this.back();
    else if (this.focus === "rows" && ok) this.confirm();
  }

  /** Gamepad A confirms, B backs out (the d-pad arrives through the input map). */
  private pad(): { ok: boolean; back: boolean } {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p): p is Gamepad => !!p && p.connected);
    if (!pad) return { ok: false, back: false };
    const now = new Set<number>();
    pad.buttons.forEach((b, i) => b.pressed && now.add(i));
    const hit = (i: number) => now.has(i) && !this.padPrev.has(i);
    this.padPrev = now;
    return { ok: hit(0), back: hit(1) };
  }

  private move(dir: number): void {
    if (this.focus === "tabs") {
      this.selectTab(
        (this.tab + dir + this.tabs().length) % this.tabs().length,
      );
      return;
    }
    const n = this.rows().length;
    if (n === 0) return;
    this.row = (this.row + dir + n) % n;
    this.status = "";
    this.host.sound("move");
    this.previewSound();
  }

  /** Browsing paint and charms: a quick taste of what the row sounds like fitted. */
  private previewSound(): void {
    const tab = this.tabs()[this.tab].id;
    const build = this.id ? this.builds.of(this.id) : null;
    if (!build) return;
    if (tab === "paint") {
      const p = PAINTS[this.row];
      if (p && p.color !== build.paint)
        this.host.garage({ kind: "paint", fit: false });
    } else if (tab === "charm") {
      const c = CHARMS[this.row];
      if (c && c.id !== build.charm)
        this.host.garage({ kind: "charm", id: c.id, fit: false });
    }
  }

  private tabs(): typeof TABS {
    const tires = this.stop !== null && this.host.winterTires(this.stop) !== null;
    const list = tires ? TABS : TABS.filter((t) => t.id !== "tires");
    return this.id ? list : list.filter((t) => t.id === "tires" || t.id === "repair");
  }

  private selectTab(i: number): void {
    if (i === this.tab) return;
    this.tab = i;
    this.row = this.startRow();
    this.status = "";
    this.host.sound("move");
  }

  private enterRows(): void {
    this.focus = "rows";
    this.row = this.startRow();
    this.host.sound("ok");
    if (this.tabs()[this.tab].id === "engine") this.host.garage({ kind: "hood" });
  }

  private back(): void {
    if (this.focus === "rows") {
      this.focus = "tabs";
      this.status = "";
      this.host.sound("back");
      return;
    }
    this.host.sound("back");
    this.host.garage({ kind: "leave" });
    this.phase = "in";
  }

  /** Where the cursor lands in a tab: the next stage to buy, or what's fitted. */
  private startRow(): number {
    const tab = this.tabs()[this.tab].id;
    if (!this.id || tab === "repair" || tab === "tires") return 0;
    const b = this.builds.of(this.id);
    if (tab === "burnout") return 0;
    if (isPart(tab))
      return Math.min(b[tab], partStages(this.id, tab).length - 1);
    if (tab === "wheels")
      return Math.max(
        0,
        WHEELS.findIndex((w) => w.id === b.wheels),
      );
    if (tab === "paint")
      return Math.max(
        0,
        PAINTS.findIndex((p) => p.color === b.paint),
      );
    return Math.max(
      0,
      CHARMS.findIndex((c) => c.id === b.charm),
    );
  }

  private confirm(): void {
    this.rows()[this.row]?.confirm();
  }

  private say(text: string, tone: "good" | "warn"): void {
    this.status = text;
    this.statusTone = tone;
    this.host.sound(tone === "good" ? "ok" : "back");
  }

  /** Charge for something; says so and returns false when the wallet is short. */
  private charge(price: number): boolean {
    if (price <= 0) return true;
    if (!this.host.pay(price)) {
      this.say(`Not enough cash: that's ${formatCash(price)}`, "warn");
      return false;
    }
    this.spent += price;
    this.host.garage({ kind: "pay" });
    return true;
  }

  /** Pay the player for a part taken off. `spent` is the visit's net, so a refund can make it negative. */
  private giveBack(amount: number): void {
    if (amount <= 0) return;
    this.host.refund(amount);
    this.spent -= amount;
    this.host.garage({ kind: "refund" });
  }

  private fit(build: CarBuild): void {
    const id = this.id!;
    this.builds.set(id, build);
    this.host.equip(id, build);
  }

  private rows(): Row[] {
    const tab = this.tabs()[this.tab].id;
    const id = this.id;
    if (tab === "tires") return [this.tiresRow(id ? this.builds.of(id) : STOCK_BUILD)];
    if (tab === "repair" || !id)
      return [this.repairRow(id ? this.builds.of(id) : STOCK_BUILD)];
    const build = this.builds.of(id);
    if (isPart(tab)) {
      const level = build[tab];
      return partStages(id, tab).map((s, i): Row => {
        const fitted = i < level;
        const top = i === level - 1;
        const next = i === level;
        const back = resale(s.price);
        return {
          name: `STAGE ${i + 1}  ${s.name}`,
          detail: top
            ? `${partValue(tab, s.value)} · 80% back if you take it off`
            : partValue(tab, s.value),
          tag: top
            ? `+${formatCash(back)}`
            : fitted
              ? "FITTED"
              : next
                ? formatCash(s.price)
                : "LOCKED",
          tagClass: top
            ? "refund"
            : fitted
              ? "fitted"
              : next
                ? "price"
                : "locked",
          price: next ? s.price : undefined,
          // The top stage previews the car without it, so the stats show what you lose
          preview: { ...build, [tab]: top ? i : Math.max(level, i + 1) },
          confirm: () => {
            if (top) {
              this.giveBack(back);
              this.fit({ ...build, [tab]: i });
              this.host.garage({ kind: "remove", part: tab });
              this.say(
                `${PART_INFO[tab].label} stage ${i + 1} removed, ${formatCash(back)} back`,
                "good",
              );
              return;
            }
            if (fitted)
              return this.say(`Take stage ${level} off first`, "warn");
            if (!next) return this.say(`Fit stage ${level + 1} first`, "warn");
            if (!this.charge(s.price)) return;
            this.fit({ ...build, [tab]: i + 1 });
            this.host.garage({
              kind: "fit",
              part: tab,
              top: i === partStages(id, tab).length - 1,
            });
            this.say(`${PART_INFO[tab].label} stage ${i + 1} fitted`, "good");
            this.row = Math.min(i + 1, partStages(id, tab).length - 1);
          },
        };
      });
    }
    if (tab === "burnout") {
      const on = build.burnout;
      const price = burnoutPrice(id);
      const back = resale(price);
      return [
        {
          name: "BURNOUT LAUNCH",
          detail: on
            ? "Hold Shift: the clutch slips, the tires spin, and the car launches harder. Once they grip it is just the throttle. 80% back to take it off"
            : "Hold Shift to launch. The clutch slips and the driven wheels spin, then it drives like the throttle once they grip",
          tag: on ? `+${formatCash(back)}` : formatCash(price),
          tagClass: on ? "refund" : "price",
          price: on ? undefined : price,
          preview: { ...build, burnout: !on },
          confirm: () => {
            if (on) {
              this.giveBack(back);
              this.fit({ ...build, burnout: false });
              this.host.garage({ kind: "burnout", on: false });
              this.say(`Burnout taken off, ${formatCash(back)} back`, "good");
              return;
            }
            if (!this.charge(price)) return;
            this.fit({ ...build, burnout: true });
            this.host.garage({ kind: "burnout", on: true });
            this.say("Burnout fitted. Hold Shift to launch", "good");
          },
        },
      ];
    }
    if (tab === "wheels") {
      return WHEELS.map((w): Row => {
        const on = build.wheels === w.id;
        return {
          name: w.name,
          detail: "Fitted and balanced while you wait",
          tag: on ? "FITTED" : "FREE",
          tagClass: on ? "fitted" : "free",
          preview: { ...build, wheels: w.id },
          confirm: () => {
            if (on) return this.say("Already on the car", "warn");
            this.fit({ ...build, wheels: w.id });
            this.host.garage({ kind: "wheels" });
            this.say(`${w.name} rims fitted`, "good");
          },
        };
      });
    }
    if (tab === "paint") {
      const factory = FLEET[id].look.color;
      return PAINTS.map((p): Row => {
        const on = build.paint === p.color;
        return {
          name: p.name,
          detail:
            p.color === null
              ? "The color it left the factory in"
              : "Full respray",
          tag: on ? "ON THE CAR" : "FREE",
          tagClass: on ? "fitted" : "free",
          swatch: css(p.color ?? factory),
          preview: { ...build, paint: p.color },
          confirm: () => {
            if (on) return this.say("No change", "warn");
            this.fit({ ...build, paint: p.color });
            this.host.garage({ kind: "paint", fit: true });
            this.say(`Painted ${p.name.toLowerCase()}`, "good");
          },
        };
      });
    }
    return CHARMS.map((c): Row => {
      const on = build.charm === c.id;
      const owned = this.builds.owns(c.id);
      return {
        name: `${c.name}  ${c.jp}`,
        detail: "Hangs from the rearview mirror",
        tag: on ? "HANGING" : owned ? "OWNED" : formatCash(c.price),
        tagClass: on ? "fitted" : owned ? "owned" : "price",
        price: owned ? undefined : c.price,
        preview: { ...build, charm: c.id },
        confirm: () => {
          if (on) return this.say("Already hanging there", "warn");
          if (!owned) {
            if (!this.charge(c.price)) return;
            this.builds.buyCharm(c.id);
          }
          this.fit({ ...build, charm: c.id });
          this.host.garage({ kind: "charm", id: c.id, fit: true });
          this.say(`${c.name} hung on the mirror`, "good");
        },
      };
    });
  }

  /** The winter set: free, and the end of the drive. */
  private tiresRow(build: CarBuild): Row {
    const offer = this.stop ? this.host.winterTires(this.stop) : null;
    if (offer === "fitted")
      return {
        name: "WINTER TIRES",
        detail: "On the car. Legal until April.",
        tag: "FITTED",
        tagClass: "fitted",
        preview: build,
        confirm: () => this.say("Already on", "warn"),
      };
    if (offer === "storage")
      return {
        name: "WINTER TIRES",
        detail: "Still in storage on Ottawa: bring them here first.",
        tag: "IN STORAGE",
        tagClass: "locked",
        preview: build,
        confirm: () => this.say("Pick them up from storage first", "warn"),
      };
    return {
      name: "INSTALL WINTER TIRES",
      detail: "Off with the summer set, on with the winter tires from your trunk.",
      tag: "FREE",
      tagClass: "free",
      preview: build,
      confirm: () => {
        const fitted = this.host.installWinterTires();
        if (fitted === null) return;
        this.cues = TIRE_CUES.map((c) => ({ at: this.t + c.at, step: c.step }));
        this.say(
          `Winter tires on in ${formatClock(fitted.elapsed)}. You're legal! Prize: +${formatCash(fitted.reward)}`,
          "good",
        );
      },
    };
  }

  private repairRow(build: CarBuild): Row {
    const dmg = Math.min(1, this.host.car().phys.state.damage);
    const quote = this.host.repairQuote();
    return {
      name: quote > 0 ? "FULL REPAIR" : "NO DAMAGE",
      detail:
        quote > 0
          ? `Bodywork ${Math.round(dmg * 100)}% damaged`
          : "Your car is in perfect shape",
      tag: quote > 0 ? formatCash(quote) : "OK",
      tagClass: quote > 0 ? "price" : "fitted",
      price: quote > 0 ? quote : undefined,
      preview: build,
      confirm: () => {
        if (quote <= 0) return this.say("Nothing to fix", "warn");
        if (!this.charge(quote)) return;
        this.host.repair();
        this.host.garage({ kind: "repair" });
        this.say("Good as new", "good");
      },
    };
  }

  /** Redraw the menu (only when something on it changed). */
  private render(): void {
    const tab = this.tabs()[this.tab];
    const rows = this.rows();
    const cash = this.host.cash();
    const id = this.id;
    const build = id ? this.builds.of(id) : null;
    const key = `${this.tab}|${this.row}|${this.focus}|${this.status}|${cash}|${JSON.stringify(build)}|${this.host.repairQuote()}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.el.station.textContent = this.stop?.name ?? "";
    this.el.cash.textContent = formatCash(cash);
    this.el.tabs.innerHTML = this.tabs()
      .map((t, i) => {
        const cls = `ps-tab${i === this.tab ? " on" : ""}${i === this.tab && this.focus === "tabs" ? " focus" : ""}`;
        return `<div class="${cls}" data-tab="${i}"><span class="lbl">${t.label}</span><span class="val">${this.tabValue(t.id, build)}</span></div>`;
      })
      .join("");
    this.el.title.textContent = tab.label;
    this.el.jp.textContent = tab.jp;
    this.el.car.textContent = this.host.car().phys.spec.name.toUpperCase();
    this.el.note.textContent = id ? this.note(tab.id, build!) : "";
    this.el.rows.innerHTML = rows
      .map((r, i) => {
        const cls = `ps-row${i === this.row && this.focus === "rows" ? " focus" : ""}`;
        const short = r.price !== undefined && r.price > cash ? " short" : "";
        const swatch = r.swatch
          ? `<i class="swatch" style="background:${r.swatch}"></i>`
          : "";
        return `<div class="${cls}" data-row="${i}"><div class="top">${swatch}<span class="nm">${r.name}</span><span class="tag ${r.tagClass}${short}">${r.tag}</span></div><div class="detail">${r.detail}</div></div>`;
      })
      .join("");
    this.el.rows
      .querySelector(".ps-row.focus")
      ?.scrollIntoView({ block: "nearest" });
    this.el.status.textContent = this.status;
    this.el.status.className = `ps-status ${this.statusTone}`;
    this.el.stats.innerHTML =
      id && build
        ? this.stats(
            id,
            build,
            this.focus === "rows" ? (rows[this.row]?.preview ?? build) : build,
          )
        : "";
    this.el.foot.innerHTML =
      this.focus === "tabs"
        ? "<span><kbd>▲ ▼</kbd> choose</span><span><kbd>ENTER</kbd> open</span><span><kbd>ESC</kbd> back to the road</span>"
        : "<span><kbd>▲ ▼</kbd> choose</span><span><kbd>ENTER</kbd> buy / remove</span><span><kbd>ESC</kbd> back</span>";
  }

  /** What the tab list shows beside each tab: stage pips, damage, what's fitted. */
  private tabValue(tab: Tab, build: CarBuild | null): string {
    if (tab === "tires") {
      const offer = this.stop ? this.host.winterTires(this.stop) : null;
      return offer === "fitted" ? "WINTER" : '<b class="warn">SUMMER</b>';
    }
    if (tab === "repair") {
      const dmg = Math.round(Math.min(1, this.host.car().phys.state.damage) * 100);
      return dmg > 0 ? `<b class="warn">${dmg}%</b>` : "OK";
    }
    if (!build || !this.id) return "";
    if (tab === "burnout") return build.burnout ? "ON" : "—";
    if (isPart(tab)) {
      const n = partStages(this.id, tab).length;
      return Array.from(
        { length: n },
        (_, i) => `<i class="pip${i < build[tab] ? " on" : ""}"></i>`,
      ).join("");
    }
    if (tab === "paint")
      return `<i class="swatch" style="background:${css(build.paint ?? FLEET[this.id].look.color)}"></i>`;
    return "";
  }

  private note(tab: Tab, build: CarBuild): string {
    const id = this.id!;
    if (tab === "tires") return "";
    if (tab === "burnout")
      return "This car only. It is still fitted when you come back to it.";
    if (tab === "engine") return engineNote(id);
    if (isPart(tab))
      return build[tab] >= partStages(id, tab).length
        ? "Every stage fitted."
        : "";
    if (tab === "wheels" || tab === "paint")
      return "Free of charge: on the house.";
    if (tab === "charm") return "Buy a charm once and hang it in any car.";
    return "";
  }

  /** Spec readout: the car as it is, and what the highlighted part would change. */
  private stats(id: FleetId, build: CarBuild, preview: CarBuild): string {
    const now = tunedSpec(FLEET[id].spec, id, build);
    const next = tunedSpec(FLEET[id].spec, id, preview);
    const grip = (s: CarSpec) => (s.gripFront + s.gripRear) / 2;
    const lines: [string, number, number, (v: number) => string, boolean][] = [
      ["POWER", peakPs(now), peakPs(next), (v) => `${v} PS`, true],
      ["TORQUE", now.peakTorque, next.peakTorque, (v) => `${v} Nm`, true],
      [
        "TOP SPEED",
        topSpeedKmh(now),
        topSpeedKmh(next),
        (v) => `${v} km/h`,
        true,
      ],
      ["WEIGHT", now.mass, next.mass, (v) => `${v} kg`, false],
      ["GRIP", grip(now), grip(next), (v) => v.toFixed(2), true],
      [
        "BRAKES",
        now.brakeForce,
        next.brakeForce,
        (v) => `${(v / 1000).toFixed(1)} kN`,
        true,
      ],
    ];
    const burn =
      build.burnout === preview.burnout
        ? ""
        : `<div class="ps-stat"><span>BURNOUT</span><span>${build.burnout ? "ON" : "OFF"}<em class="${preview.burnout ? "up" : "down"}">▶ ${preview.burnout ? "ON" : "OFF"}</em></span></div>`;
    return (
      lines
        .map(([label, a, b, fmt, more]) => {
          const diff = Math.abs(b - a) > 1e-6;
          const better = diff && b > a === more;
          const after = diff
            ? `<em class="${better ? "up" : "down"}">▶ ${fmt(b)}</em>`
            : "";
          return `<div class="ps-stat"><span>${label}</span><span>${fmt(a)}${after}</span></div>`;
        })
        .join("") + burn
    );
  }
}

function partValue(kind: PartKind, v: number): string {
  if (kind === "engine") return `${v} Nm peak torque`;
  if (kind === "weight") return `${v} kg`;
  if (kind === "handling")
    return `+${v.toFixed(2)} tire grip, quicker steering`;
  return `${(v / 1000).toFixed(1)} kN braking`;
}
