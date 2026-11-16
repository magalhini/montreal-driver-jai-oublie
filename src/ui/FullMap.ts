import type { PoliceSystem } from '../ai/PoliceAI';
import { clamp } from '../core/math';
import type { Input } from '../core/Input';
import type { Gps } from '../gameplay/Gps';
import type { Car } from '../vehicles/Car';
import type { CityModel } from '../world/RoadGraph';
import { MAP_INK, MapTransform, copColor, drawArrow, drawBase, drawBlip, drawDispatch, drawPin, drawStreetLabels, formatDistance, strokeRoute, type Px } from './MapDraw';
import { mapLabels, streetLabels, type MapImage, type MapLabel, type StreetLabel } from './MapImage';
import './map.css';

/** Max zoom (CSS px per meter); min is "whole city fits". */
const ZOOM_MAX = 3;
/** Keyboard pan speed (CSS px per second). */
const PAN_SPEED = 700;
/** Clicking within this many CSS px of the waypoint removes it. */
const PICK_RADIUS = 14;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const HELP = [
  ['CLICK', 'set waypoint'],
  ['RIGHT CLICK', 'clear'],
  ['DRAG / WASD', 'pan'],
  ['WHEEL / + -', 'zoom'],
  ['SPACE', 'find car'],
  ['M / ESC', 'close'],
];

/**
 * Full-screen map (M): pan (drag, WASD / arrows), zoom (wheel around the cursor, + / -), district and landmark
 * labels, dispatch icon, police, GPS route. Clicking sets a waypoint (snapped to the nearest road) and routes
 * to it, replacing the path already on the map; clicking it again or right-clicking clears it. The game is
 * paused while it is open (main.ts).
 */
export class FullMap {
  open = false;
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly infoEl: HTMLElement;
  private readonly labels: MapLabel[];
  private readonly streets: StreetLabel[];
  private readonly landmarksFirst: MapLabel[];
  private readonly t = new MapTransform();
  private readonly q: Px = { x: 0, y: 0 };
  private cx = 0;
  private cz = 0;
  private zoom = 1;
  private dpr = 1;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private keyZoom = 0;

  constructor(
    parent: HTMLElement,
    private readonly img: MapImage,
    private readonly city: CityModel,
    private readonly gps: Gps,
    private readonly player: Car,
    private readonly police: PoliceSystem,
    private readonly input: Input,
  ) {
    this.labels = mapLabels(city);
    this.streets = streetLabels(city);
    this.landmarksFirst = [...this.labels.filter((l) => l.kind === 'landmark'), ...this.labels.filter((l) => l.kind === 'district')];
    this.root = document.createElement('div');
    this.root.className = 'fullmap';
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    const head = document.createElement('div');
    head.className = 'fullmap-head';
    head.innerHTML = '<span class="title">MAP <small>CARTE</small></span>';
    this.infoEl = document.createElement('span');
    this.infoEl.className = 'info';
    head.appendChild(this.infoEl);
    this.root.appendChild(head);
    const help = document.createElement('div');
    help.className = 'fullmap-help';
    help.innerHTML = HELP.map(([k, v]) => `<span><kbd>${k}</kbd> ${v}</span>`).join('');
    this.root.appendChild(help);
    const legend = document.createElement('div');
    legend.className = 'fullmap-legend';
    legend.innerHTML = [
      ['you', 'player'],
      ['route', 'route'],
      ['waypoint', 'waypoint'],
      ['station', 'police station'],
      ['alley', 'alley / underpass'],
      ['police', 'police'],
    ]
      .map(([cls, text]) => `<span><i class="${cls}"></i>${text}</span>`)
      .join('');
    this.root.appendChild(legend);
    parent.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d')!;
    this.bindMouse();
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.keyZoom = 1;
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.keyZoom = -1;
    });
    window.addEventListener('keyup', (e) => {
      if (['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(e.code)) this.keyZoom = 0;
    });
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.root.classList.toggle('show', open);
    this.drag = null;
    this.keyZoom = 0;
    if (open) {
      this.resize();
      this.zoom = this.fitZoom();
      const b = this.city.bounds;
      this.cx = (b.minX + b.maxX) / 2;
      this.cz = (b.minZ + b.maxZ) / 2;
    }
  }

  /** Call every render frame (keyboard pan / zoom and drawing while open). */
  update(dt: number): void {
    if (!this.open) return;
    this.resize();
    const inp = this.input;
    // Steer / throttle / brake axes: WASD and arrows, or a gamepad's stick and triggers
    const px = inp.steerAxis;
    const pz = inp.brakeAxis - inp.throttleAxis;
    this.cx += (px * PAN_SPEED * dt) / this.zoom;
    this.cz += (pz * PAN_SPEED * dt) / this.zoom;
    if (this.keyZoom) this.zoomAt(Math.exp(this.keyZoom * 2.2 * dt), this.canvas.width / 2, this.canvas.height / 2);
    if (inp.pressed('handbrake')) {
      this.cx = this.player.pos.x;
      this.cz = this.player.pos.z;
      this.zoom = Math.max(this.zoom, 1.6);
    }
    this.clampView();
    this.draw();
  }

  private draw(): void {
    const { ctx, t, q, dpr } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    t.set(this.cx, this.cz, this.zoom * dpr, 0, w / 2, h / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05030b';
    ctx.fillRect(0, 0, w, h);
    drawBase(ctx, t, this.img);
    this.drawLabels();
    const route = this.gps.route;
    if (route) strokeRoute(ctx, t, route.points, 4 * dpr);

    const station = this.city.features.station;
    if (station) {
      t.toScreen(station.dispatch, q);
      drawDispatch(ctx, q.x, q.y, 20 * dpr, station.color, station.glyph);
      this.text('POLICE', q.x, q.y + 20 * dpr, 8, station.color, station.jp);
    }
    const now = performance.now();
    for (const cop of this.police.cops.values()) {
      const pursuit = cop.state === 'pursuit';
      t.toScreen(cop.car.pos, q);
      drawBlip(ctx, q.x, q.y, (pursuit ? 5.5 : 3.5) * dpr, copColor(pursuit, now), pursuit);
    }
    if (this.gps.destination) {
      t.toScreen(this.gps.destination, q);
      const suspect = this.gps.destName === 'SUSPECT';
      drawPin(ctx, q.x, q.y, 10 * dpr, suspect ? copColor(true, now) : MAP_INK.destination);
    }
    if (this.gps.waypoint) {
      t.toScreen(this.gps.waypoint, q);
      drawPin(ctx, q.x, q.y, 10 * dpr, MAP_INK.waypoint);
    }
    t.toScreen(this.player.pos, q);
    const pulse = (now / 900) % 1;
    ctx.beginPath();
    ctx.arc(q.x, q.y, (10 + pulse * 22) * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * (1 - pulse)})`;
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    drawArrow(ctx, q.x, q.y, t.angleOf(this.player.yaw), 20 * dpr);
    this.drawScaleBar();
    this.updateInfo();
  }

  /** Greedy placement: the icons' labels first, then the rest by priority; overlapping labels wait for more zoom. */
  private drawLabels(): void {
    const { t, q, zoom, dpr } = this;
    const placed: Box[] = [];
    if (this.city.features.station) {
      t.toScreen(this.city.features.station.dispatch, q);
      placed.push({ x0: q.x - 48 * dpr, y0: q.y - 13 * dpr, x1: q.x + 48 * dpr, y1: q.y + 38 * dpr });
    }
    // Zoomed out the district names win; zoomed in the specific landmarks do
    const order = zoom > 1.2 ? this.landmarksFirst : this.labels;
    for (const l of order) {
      t.toScreen(l.pos, q);
      const district = l.kind === 'district';
      const size = district ? clamp(9 * zoom, 9, 15) : 8;
      const box = this.labelBox(l.text, l.sub, q.x, q.y, size);
      if (placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
      placed.push(box);
      this.text(l.text, q.x, q.y, size, district ? 'rgba(255, 255, 255, 0.82)' : 'rgba(62, 242, 255, 0.85)', l.sub);
    }
    // Boulevard names along their roads, in the gaps the place names left
    drawStreetLabels(this.ctx, t, this.streets, { size: clamp(11 * zoom, 14, 22) * dpr, spacing: 520 * dpr, placed });
  }

  private labelBox(s: string, sub: string | undefined, x: number, y: number, size: number): Box {
    const { ctx, dpr } = this;
    const px = size * dpr;
    ctx.font = `${Math.round(px)}px 'Press Start 2P', monospace`;
    let w = ctx.measureText(s).width;
    if (sub) {
      ctx.font = `${Math.round(px * 1.35)}px 'VT323', sans-serif`;
      w = Math.max(w, ctx.measureText(sub).width);
    }
    const pad = 4 * dpr;
    return { x0: x - w / 2 - pad, x1: x + w / 2 + pad, y0: y - px * 0.6 - pad, y1: y + px * (sub ? 2 : 0.6) + pad };
  }

  /** Centered label with a dark halo; `size` in CSS px. Optional second line in a smaller font. */
  private text(s: string, x: number, y: number, size: number, color: string, sub?: string): void {
    const { ctx, dpr } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `${Math.round(size * dpr)}px 'Press Start 2P', monospace`;
    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = 'rgba(5, 3, 12, 0.85)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
    if (sub) {
      const y2 = y + size * dpr * 1.25;
      ctx.font = `${Math.round(size * 1.35 * dpr)}px 'VT323', sans-serif`;
      ctx.strokeText(sub, x, y2);
      ctx.globalAlpha = 0.75;
      ctx.fillText(sub, x, y2);
    }
    ctx.restore();
  }

  private drawScaleBar(): void {
    const { ctx, dpr } = this;
    const ppm = this.zoom; // CSS px per meter
    const len = [25, 50, 100, 200, 500].find((m) => m * ppm >= 70) ?? 500;
    const x = 28 * dpr;
    const y = this.canvas.height - 64 * dpr;
    const wpx = len * ppm * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(x, y, wpx, 2 * dpr);
    ctx.fillRect(x, y - 6 * dpr, 2 * dpr, 8 * dpr);
    ctx.fillRect(x + wpx - 2 * dpr, y - 6 * dpr, 2 * dpr, 8 * dpr);
    this.text(`${len} m`, x + wpx / 2, y - 12 * dpr, 7, 'rgba(255, 255, 255, 0.85)');
    this.drawCompass(this.canvas.width - 48 * dpr, 92 * dpr);
  }

  private drawCompass(x: number, y: number): void {
    const { ctx, dpr } = this;
    const r = 18 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 4, 24, 0.8)';
    ctx.fill();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = 'rgba(180, 92, 255, 0.7)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.8);
    ctx.lineTo(x + r * 0.32, y);
    ctx.lineTo(x - r * 0.32, y);
    ctx.closePath();
    ctx.fillStyle = MAP_INK.waypoint;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.8);
    ctx.lineTo(x + r * 0.32, y);
    ctx.lineTo(x - r * 0.32, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fill();
    this.text('N', x, y - r - 9 * dpr, 8, MAP_INK.waypoint);
  }

  private updateInfo(): void {
    const target = this.gps.target;
    let html = 'No waypoint: click a street to set one';
    if (target) {
      const m = this.gps.route?.length ?? Math.hypot(target.x - this.player.pos.x, target.z - this.player.pos.z);
      const kind = target === this.gps.destination ? (this.gps.destName === 'SUSPECT' ? 'SUSPECT' : 'DESTINATION') : 'WAYPOINT';
      html = `${kind} <b>${formatDistance(m)}</b>`;
    }
    if (this.infoEl.innerHTML !== html) this.infoEl.innerHTML = html;
  }

  private bindMouse(): void {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false };
    });
    window.addEventListener('mousemove', (e) => {
      const d = this.drag;
      if (!d || !this.open) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (!d.moved) return;
      this.cx = d.cx - dx / this.zoom;
      this.cz = d.cz - dy / this.zoom;
      this.root.classList.add('dragging');
    });
    window.addEventListener('mouseup', (e) => {
      const d = this.drag;
      this.drag = null;
      this.root.classList.remove('dragging');
      if (!d || d.moved || !this.open) return;
      this.click(e.clientX, e.clientY);
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.open) this.gps.setWaypoint(null);
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        this.zoomAt(Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr);
      },
      { passive: false },
    );
  }

  private click(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    const x = (clientX - r.left) * this.dpr;
    const y = (clientY - r.top) * this.dpr;
    const wp = this.gps.waypoint;
    if (wp) {
      const s = this.t.toScreen(wp, this.q);
      if (Math.hypot(s.x - x, s.y - y) < PICK_RADIUS * this.dpr) {
        this.gps.setWaypoint(null);
        return;
      }
    }
    this.gps.setWaypoint(this.t.toWorld(x, y));
  }

  /** Zoom by `factor` keeping the world point under canvas pixel (x, y) fixed. */
  private zoomAt(factor: number, x: number, y: number): void {
    const setView = () => this.t.set(this.cx, this.cz, this.zoom * this.dpr, 0, this.canvas.width / 2, this.canvas.height / 2);
    setView();
    const before = this.t.toWorld(x, y);
    this.zoom = clamp(this.zoom * factor, this.fitZoom() * 0.9, ZOOM_MAX);
    setView();
    const after = this.t.toWorld(x, y);
    this.cx += before.x - after.x;
    this.cz += before.z - after.z;
    this.clampView();
  }

  private fitZoom(): number {
    const b = this.city.bounds;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    return Math.min(w / (b.maxX - b.minX), (h - 110) / (b.maxZ - b.minZ)) * 0.94;
  }

  private clampView(): void {
    const b = this.city.bounds;
    this.cx = clamp(this.cx, b.minX, b.maxX);
    this.cz = clamp(this.cz, b.minZ, b.maxZ);
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (w === this.canvas.width && h === this.canvas.height && dpr === this.dpr) return;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
  }
}
