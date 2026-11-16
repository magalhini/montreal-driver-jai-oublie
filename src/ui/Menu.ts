import { CONFIG } from '../config';
import { formatCash } from '../gameplay/Economy';
import { MAPS } from '../maps/catalog';
import { VERSION } from '../version';
import './menu.css';

export type PlayMode = 'free';

/** What the menus can do to the game (implemented in main.ts). */
export interface MenuHost {
  cash(): number;
  /** Start a driving session. */
  start(mode: PlayMode): void;
  resume(): void;
  quit(): void;
  /** Mode of the running session (pause screen). */
  mode(): PlayMode;
  /** Menu feedback sounds (T34). */
  sound?(kind: 'move' | 'ok' | 'back'): void;
  /** Volume sliders for the AUDIO page (T34). */
  volumes?: VolumeHost;
  /** On/off picture options for the GRAPHICS page. */
  graphics?: GraphicsHost;
  /** The traffic level (the difficulty): index into `levels`. */
  traffic?: TrafficHost;
}

export interface TrafficHost {
  levels: readonly { name: string; hint: string }[];
  get(): number;
  set(level: number): void;
}

/** Volume sliders, 0..1 each. */
export interface VolumeHost {
  sliders: { key: string; label: string; hint: string }[];
  get(key: string): number;
  set(key: string, v: number): void;
}

/** Picture toggles, on or off. */
export interface GraphicsHost {
  options: readonly { key: string; label: string; hint: string }[];
  get(key: string): boolean;
  set(key: string, on: boolean): void;
}

export interface Item {
  label: string;
  /** Rich content shown instead of `label` (sliders, toggles). */
  html?: string;
  hint: string;
  /** Shown, but confirming it does nothing. */
  disabled?: boolean;
  run: () => void;
  /** Sliders: left / right (keys, d-pad, stick, the arrow buttons in the item) step the value. */
  adjust?: (dir: -1 | 1) => void;
}

export interface Page {
  heading: string;
  sub?: string;
  body?: string;
  items: Item[];
  /** Esc / P / gamepad B; nothing on the title page. */
  back?: () => void;
}

const MODE_NAME: Record<PlayMode, string> = { free: 'FREE ROAM' };

const KEYBOARD: [string, string][] = [
  ['W S / ↑ ↓', 'throttle / brake, reverse'],
  ['A D / ◀ ▶', 'steer'],
  ['SPACE', 'handbrake'],
  ['SHIFT', 'burnout launch (hold, if fitted)'],
  ['H', 'horn'],
  ['Q E', 'turn signals'],
  ['L', 'speed limiter'],
  ['K', 'headlights'],
  ['I', 'engine on / off (park)'],
  ['C', 'camera'],
  ['R', 'look back (hold)'],
  ['M', 'map'],
  ['F', 'skip the garage intro'],
  ['P / ESC', 'pause'],
  ['~', 'debug panel'],
];
const GAMEPAD: [string, string][] = [
  ['RT / LT', 'throttle / brake'],
  ['L STICK', 'steer'],
  ['A', 'handbrake'],
  ['LB', 'burnout launch (hold, if fitted)'],
  ['B', 'horn'],
  ['D-PAD ◀ ▶', 'turn signals'],
  ['D-PAD ↑', 'speed limiter'],
  ['D-PAD ↓', 'headlights'],
  ['L3', 'engine on / off (park)'],
  ['Y', 'camera'],
  ['RB', 'look back (hold)'],
  ['VIEW', 'map'],
  ['X', 'skip the garage intro'],
  ['START', 'pause'],
];

const keyList = (title: string, rows: [string, string][]) =>
  `<div class="menu-keys"><div class="menu-keys-title">${title}</div>${rows.map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>`;
const CONTROLS_HTML = `<div class="menu-controls">${keyList('KEYBOARD', KEYBOARD)}${keyList('GAMEPAD', GAMEPAD)}</div>`;

/** QUICK TUTORIAL: the basics, one card per topic. */
const TUTORIAL: [string, string[]][] = [
  [
    'FREE ROAM',
    [
      'Drive downtown at your own pace, but the police are still watching.',
      'When a police cruiser is nearby: keep to the speed limit, stay off the sidewalk and give pedestrians room.',
      'Tip: press <kbd>L</kbd> to turn on the speed limiter.',
    ],
  ],
  [
    'CONTROLS',
    [
      '<kbd>W A S D</kbd> drive &nbsp; <kbd>SPACE</kbd> handbrake',
      '<kbd>M</kbd> city map: click a destination on it and the GPS routes you there',
      '<kbd>L</kbd> speed limiter &nbsp; <kbd>C</kbd> change camera',
      '<kbd>Q</kbd> <kbd>E</kbd> blinkers',
    ],
  ],
  [
    'GARAGES',
    [
      'Stop under a garage canopy (GARAGE on the map) to repair your car.',
    ],
  ],
];
const TUTORIAL_HTML = `<div class="menu-tutorial">${TUTORIAL.map(
  ([title, lines]) => `<div class="menu-tut-card"><div class="menu-keys-title">${title}</div><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>`,
).join('')}</div>`;

function activePad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  return Array.from(pads).find((p): p is Gamepad => !!p && p.connected) ?? null;
}

function padButtons(pad: Gamepad): Set<number> {
  const s = new Set<number>();
  pad.buttons.forEach((b, i) => b.pressed && s.add(i));
  return s;
}

/** Left stick menu repeat: first delay, then interval (s). */
const STICK_DELAY = 0.35;
const STICK_REPEAT = 0.14;

/**
 * Title screen (Free Roam, controls help) and pause menu (resume, controls, quit to title).
 * Keyboard (arrows / WS, Enter / Space), mouse and gamepad (d-pad / stick, A, B) navigate; Esc / P / Start
 * go back through `back()`, called by main.ts so the pause key has a single owner.
 */
export class Menu {
  private readonly root: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private page: Page | null = null;
  private pageCls = '';
  private sel = 0;
  private padPrev = new Set<number>();
  private stickDir = 0;
  private stickT = 0;
  private stickXDir = 0;
  private stickXT = 0;

  constructor(
    parent: HTMLElement,
    private readonly host: MenuHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <div class="menu-logo"><div class="word">MONTREAL</div><div class="word driver">DRIVER</div></div>
      <div class="menu-head"></div><div class="menu-sub"></div><div class="menu-body"></div>
      <div class="menu-list"></div><div class="menu-hint"></div>
      <div class="menu-foot"><span><kbd>↑ ↓</kbd> select</span><span><kbd>ENTER</kbd> confirm</span><span><kbd>ESC</kbd> back</span></div>
      <div class="menu-version">${VERSION}</div>`;
    const q = (c: string) => this.root.querySelector<HTMLElement>(c)!;
    this.headEl = q('.menu-head');
    this.subEl = q('.menu-sub');
    this.bodyEl = q('.menu-body');
    this.listEl = q('.menu-list');
    this.hintEl = q('.menu-hint');
    parent.appendChild(this.root);
    this.syncLook();
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get open(): boolean {
    return this.page !== null;
  }

  /** True while the title screen (not the pause menu) is up. */
  get onTitle(): boolean {
    return this.open && this.root.classList.contains('title');
  }

  showTitle(): void {
    this.setClass('title');
    this.show(this.titlePage());
  }

  showPause(): void {
    this.setClass('pause');
    this.show(this.pausePage());
  }

  hide(): void {
    this.page = null;
    this.setClass('');
    this.root.classList.remove('show', 'vol-page', 'gfx-page', 'tut-page');
  }

  /** Esc / P / Start / gamepad B. */
  back(): void {
    if (!this.page?.back) return;
    this.host.sound?.('back');
    this.page.back();
  }

  /** Call once per render frame (gamepad navigation). */
  update(dt: number): void {
    if (!this.open) return;
    const pad = activePad();
    if (!pad) return;
    const now = padButtons(pad);
    const hit = (i: number) => now.has(i) && !this.padPrev.has(i);
    this.padPrev = now;
    if (hit(12)) this.move(-1);
    if (hit(13)) this.move(1);
    if (hit(14)) this.adjust(-1);
    if (hit(15)) this.adjust(1);
    if (hit(0)) this.activate(this.sel);
    else if (hit(1)) this.back();

    const ay = pad.axes[1] ?? 0;
    const dir = ay < -0.5 ? -1 : ay > 0.5 ? 1 : 0;
    if (dir !== this.stickDir) {
      this.stickDir = dir;
      this.stickT = STICK_DELAY;
      if (dir) this.move(dir);
    } else if (dir && (this.stickT -= dt) <= 0) {
      this.stickT = STICK_REPEAT;
      this.move(dir);
    }
    const ax = pad.axes[0] ?? 0;
    const xd = ax < -0.5 ? -1 : ax > 0.5 ? 1 : 0;
    if (xd !== this.stickXDir) {
      this.stickXDir = xd;
      this.stickXT = STICK_DELAY;
      if (xd) this.adjust(xd);
    } else if (xd && (this.stickXT -= dt) <= 0) {
      this.stickXT = STICK_REPEAT;
      this.adjust(xd);
    }
  }

  private titlePage(): Page {
    return {
      heading: '',
      sub: MAPS[CONFIG.MAP].sub,
      items: [
        { label: 'FREE ROAM', hint: `Drive downtown Montreal. Garages, police, traffic. Wallet ${formatCash(this.host.cash())}`, run: () => this.host.start('free') },
        ...this.trafficItem(),
        { label: 'QUICK TUTORIAL', hint: 'How the city works, in one minute', run: () => this.tutorial(this.host.traffic ? 2 : 1) },
        { label: 'CONTROLS', hint: 'Keyboard and gamepad', run: () => this.controls(() => this.showTitle(), this.host.traffic ? 3 : 2) },
        ...this.audioItem(() => this.showTitle(), this.host.traffic ? 4 : 3),
        ...this.graphicsItem(() => this.showTitle(), this.host.traffic ? 5 : 4),
      ],
    };
  }

  /** TRAFFIC ◀ level ▶: how busy the streets are, i.e. the difficulty. Takes effect right away. */
  private trafficItem(): Item[] {
    const t = this.host.traffic;
    if (!t) return [];
    const n = t.levels.length;
    const arrow = (dir: -1 | 1, c: string, on: boolean) => `<b data-adj="${dir}"${on ? '' : ' style="visibility:hidden"'}>${c}</b>`;
    const item: Item = { label: 'TRAFFIC', hint: '', run: () => step(1, true), adjust: (dir) => step(dir, false) };
    const render = () => {
      const i = t.get();
      item.html = `TRAFFIC<span class="city-name">${arrow(-1, '◀', i > 0)}${t.levels[i].name}${arrow(1, '▶', i < n - 1)}</span>`;
      item.hint = `Difficulty: ${t.levels[i].hint}. ◀ ▶ to change`;
    };
    // ◀ ▶ stop at the ends; Enter / click cycles round
    const step = (dir: -1 | 1, wrap: boolean) => {
      const i = wrap ? (t.get() + dir + n) % n : Math.min(n - 1, Math.max(0, t.get() + dir));
      if (i === t.get()) return;
      t.set(i);
      render();
      this.renderList();
    };
    render();
    return [item];
  }

  private pausePage(): Page {
    return {
      heading: 'PAUSED',
      sub: `${MODE_NAME[this.host.mode()]} · ${formatCash(this.host.cash())}`,
      items: [
        { label: 'RESUME', hint: '', run: () => this.host.resume() },
        ...this.trafficItem(),
        { label: 'CONTROLS', hint: 'Keyboard and gamepad', run: () => this.controls(() => this.showPause(), this.host.traffic ? 2 : 1) },
        ...this.audioItem(() => this.showPause(), this.host.traffic ? 3 : 2),
        ...this.graphicsItem(() => this.showPause(), this.host.traffic ? 4 : 3),
        { label: 'QUIT TO TITLE', hint: 'Your cash and car upgrades are saved', run: () => this.host.quit() },
      ],
      back: () => this.host.resume(),
    };
  }

  /** Controls help; going back returns to `from` with item `index` selected. */
  private controls(from: () => void, index: number): void {
    const back = () => (from(), this.select(index));
    this.show({ heading: 'CONTROLS', body: CONTROLS_HTML, items: [{ label: 'BACK', hint: '', run: back }], back });
  }

  /** Quick tutorial; going back returns to the title with item `index` selected. */
  private tutorial(index: number): void {
    const back = () => (this.showTitle(), this.select(index));
    this.show({ heading: 'QUICK TUTORIAL', body: TUTORIAL_HTML, items: [{ label: 'BACK', hint: '', run: back }], back });
    this.root.classList.add('tut-page');
  }

  /** The AUDIO entry (if the host has volumes); its page returns to `from` with item `index` selected. */
  private audioItem(from: () => void, index: number): Item[] {
    const v = this.host.volumes;
    if (!v) return [];
    return [{ label: 'AUDIO', hint: 'Volume', run: () => this.audio(v, from, index) }];
  }

  private audio(v: VolumeHost, from: () => void, index: number): void {
    const back = () => (from(), this.select(index));
    const bar = (x: number) => {
      const n = Math.round(x * 10);
      return `<span class="vol-bar"><b data-adj="-1">◀</b><i>${'▮'.repeat(n)}<s>${'▮'.repeat(10 - n)}</s></i><b data-adj="1">▶</b></span>`;
    };
    const items: Item[] = v.sliders.map((sl) => {
      const item: Item = {
        label: sl.label,
        hint: sl.hint,
        html: '',
        run: () => item.adjust!(1),
        adjust: (dir) => {
          v.set(sl.key, Math.min(1, Math.max(0, v.get(sl.key) + dir * 0.1)));
          item.html = `<span class="vol-label">${sl.label}</span>${bar(v.get(sl.key))}<span class="vol-pct">${Math.round(v.get(sl.key) * 100)}%</span>`;
          this.renderList();
        },
      };
      item.html = `<span class="vol-label">${sl.label}</span>${bar(v.get(sl.key))}<span class="vol-pct">${Math.round(v.get(sl.key) * 100)}%</span>`;
      return item;
    });
    items.push({ label: 'BACK', hint: '', run: back });
    this.show({ heading: 'AUDIO', sub: '◀ ▶ to change', items, back });
    this.listEl.classList.add('vol-list');
    this.root.classList.add('vol-page');
  }

  /** The GRAPHICS entry; its page returns to `from` with item `index` selected. */
  private graphicsItem(from: () => void, index: number): Item[] {
    const g = this.host.graphics;
    if (!g) return [];
    return [{ label: 'GRAPHICS', hint: 'Scanlines, glow, the retro look', run: () => this.graphics(g, from, index) }];
  }

  private graphics(g: GraphicsHost, from: () => void, index: number): void {
    const back = () => (from(), this.select(index));
    const mark = (on: boolean) =>
      `<span class="city-name"><b data-adj="-1">◀</b><em class="${on ? '' : 'off'}">${on ? 'ON' : 'OFF'}</em><b data-adj="1">▶</b></span>`;
    const items: Item[] = g.options.map((opt) => {
      let item: Item;
      const apply = (on: boolean) => {
        if (g.get(opt.key) === on) return;
        g.set(opt.key, on);
        item.html = `${opt.label}${mark(on)}`;
        this.renderList();
        this.syncLook();
      };
      item = {
        label: opt.label,
        hint: opt.hint,
        html: `${opt.label}${mark(g.get(opt.key))}`,
        run: () => {
          apply(!g.get(opt.key));
          this.host.sound?.('move');
        },
        adjust: (dir) => apply(dir > 0),
      };
      return item;
    });
    items.push({ label: 'BACK', hint: '', run: back });
    this.show({ heading: 'GRAPHICS', sub: '◀ ▶ to toggle', items, back });
    this.root.classList.add('gfx-page');
  }

  /** Title-screen scanlines follow the SCANLINES toggle (the city itself is the post pass). */
  private syncLook(): void {
    const on = this.host.graphics?.get('scanlines') ?? true;
    this.root.classList.toggle('scanlines', on);
  }

  /** Step the selected slider (no-op on other items). */
  private adjust(dir: -1 | 1): void {
    const it = this.page?.items[this.sel];
    if (!it?.adjust) return;
    it.adjust(dir);
    this.host.sound?.('move');
  }

  /** Screen style class: 'title', 'pause' or a `showPage` class ('' for none). */
  private setClass(cls: string): void {
    if (this.pageCls) this.root.classList.remove(this.pageCls);
    if (cls) this.root.classList.add(cls);
    this.pageCls = cls;
  }

  private show(page: Page): void {
    if (!this.page) {
      // Buttons already down when a menu opens (Start, a held handbrake) are not presses
      const pad = activePad();
      this.padPrev = pad ? padButtons(pad) : new Set();
      this.stickDir = 0;
    }
    this.page = page;
    this.root.classList.add('show');
    this.root.classList.toggle('has-body', !!page.body);
    this.headEl.textContent = page.heading;
    this.subEl.textContent = page.sub ?? '';
    this.bodyEl.innerHTML = page.body ?? '';
    this.listEl.classList.remove('vol-list');
    this.root.classList.remove('vol-page', 'gfx-page', 'tut-page');
    this.syncLook();
    this.sel = 0;
    this.renderList();
  }

  /** (Re)build the item list of the current page, keeping the selection. */
  private renderList(): void {
    const page = this.page;
    if (!page) return;
    this.listEl.innerHTML = '';
    page.items.forEach((it, i) => {
      const e = document.createElement('div');
      e.className = 'menu-item';
      if (it.disabled) e.classList.add('locked');
      if (it.html) e.innerHTML = it.html;
      else e.textContent = it.label;
      e.addEventListener('mouseenter', () => this.select(i));
      e.addEventListener('click', (ev) => {
        const adj = (ev.target as HTMLElement).closest<HTMLElement>('[data-adj]');
        if (adj && it.adjust) {
          this.select(i);
          this.adjust(Number(adj.dataset.adj) as -1 | 1);
        } else this.activate(i);
      });
      this.listEl.appendChild(e);
    });
    this.select(this.sel);
  }

  private select(i: number): void {
    if (!this.page) return;
    const n = this.page.items.length;
    this.sel = ((i % n) + n) % n;
    Array.from(this.listEl.children).forEach((e, k) => e.classList.toggle('sel', k === this.sel));
    this.hintEl.textContent = this.page.items[this.sel].hint;
    this.reveal();
  }

  /** Keep the selected row inside a scrolling list (taller than a short screen). */
  private reveal(): void {
    const el = this.listEl.children[this.sel] as HTMLElement | undefined;
    if (!el) return;
    const list = this.listEl.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (box.top < list.top) this.listEl.scrollTop -= list.top - box.top;
    else if (box.bottom > list.bottom) this.listEl.scrollTop += box.bottom - list.bottom;
  }

  private move(d: number): void {
    this.select(this.sel + d);
    this.host.sound?.('move');
  }

  private activate(i: number): void {
    const it = this.page?.items[i];
    if (!it) return;
    if (it.disabled) {
      this.host.sound?.('back');
      return;
    }
    if (!it.adjust) this.host.sound?.('ok');
    it.run();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open) return;
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.move(-1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.move(1);
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        if (!e.repeat) this.activate(this.sel);
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.adjust(-1);
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.adjust(1);
        break;
      case 'Backspace':
        this.back();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
