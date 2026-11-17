import type { PoliceSystem } from '../ai/PoliceAI';
import { clamp, damp, dist, fwd, lerp } from '../core/math';
import type { Gps } from '../gameplay/Gps';
import type { ViewSystem, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import type { CityModel } from '../world/RoadGraph';
import { MAP_INK, MapTransform, copColor, drawArrow, drawBase, drawBlip, drawDispatch, drawMetro, drawPin, drawStreetLabels, formatDistance, strokeRoute, type Px } from './MapDraw';
import { metroSites } from '../world/MetroEntrances';
import { streetLabels, type MapImage, type StreetLabel } from './MapImage';
import './map.css';

/** Meters from the view center to the rim: stopped, and at `RANGE_SPEED` and above. */
const RANGE_MIN = 140;
const RANGE_MAX = 260;
const RANGE_SPEED = 38;
/** At speed the view center moves this fraction of the range ahead of the car (more road ahead). */
const LEAD = 0.3;

/**
 * Corner radar (Canvas 2D): the pre-rendered city rotated to the camera's heading, zooming out with speed,
 * with the GPS route, target pin (pinned to the rim when off-radar), dispatch icon, police blips (flashing
 * and rim-pinned while in pursuit) and the player arrow. The distance to the target sits under the radar.
 */
export class Minimap implements ViewSystem {
  visible = true;
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly distEl: HTMLElement;
  private readonly t = new MapTransform();
  private range = RANGE_MIN;
  private lead = 0;
  private dpr = 1;
  private size = 0;
  private shownDist = '';
  private readonly q: Px = { x: 0, y: 0 };
  private readonly streets: StreetLabel[];


  constructor(
    parent: HTMLElement,
    private readonly img: MapImage,
    private readonly city: CityModel,
    private readonly gps: Gps,
    private readonly player: Car,
    private readonly police: PoliceSystem,
    /** Yaw of the screen's up direction projected on the ground (the camera heading). */
    private readonly heading: () => number,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'minimap';
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    this.distEl = document.createElement('div');
    this.distEl.className = 'minimap-dist';
    this.root.appendChild(this.distEl);
    parent.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d')!;
    this.streets = streetLabels(city);
  }

  sync(alpha: number, frameDt: number): void {
    this.root.classList.toggle('hidden', !this.visible);
    if (!this.visible) return;
    this.resize();
    const { ctx, t, q, size, dpr } = this;
    const R = size / 2;
    const p = this.player.interpPos(alpha);

    const speed = Math.abs(this.player.speed);
    const k = damp(2.2, frameDt);
    this.range += (lerp(RANGE_MIN, RANGE_MAX, clamp(speed / RANGE_SPEED, 0, 1)) - this.range) * k;
    this.lead += (clamp(speed / 25, 0, 1) * LEAD - this.lead) * k;
    const h = this.heading();
    const f = fwd(h);
    const ahead = this.lead * this.range;
    t.set(p.x + f.x * ahead, p.z + f.z * ahead, R / this.range, h - Math.PI, R, R);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#06040e';
    ctx.fillRect(0, 0, size, size);
    drawBase(ctx, t, this.img);
    const route = this.gps.route;
    if (route) strokeRoute(ctx, t, route.points, 3.2 * dpr);
    // The boulevards in reach, named once each where they pass closest to the middle
    drawStreetLabels(ctx, t, this.streets, { size: 13 * dpr, near: { x: R, y: R }, range: R * 0.72, placed: [] });
    ctx.restore();

    const now = performance.now();
    const rim = R - 7 * dpr;
    // Métro entrances in reach (no rim pins: they aren't somewhere you need to go)
    for (const m of metroSites(this.city)) if (this.place(m.pos, rim)) drawMetro(ctx, q.x, q.y, 9 * dpr);
    // Precinct (always shown), then patrol cops (only inside the radar), pursuers (pinned to the rim)
    const station = this.city.features.station;
    if (station) drawDispatch(ctx, q.x, q.y, (this.place(station.dispatch, rim) ? 13 : 9) * dpr, station.color, station.glyph);
    for (const cop of this.police.cops.values()) {
      const pursuit = cop.state === 'pursuit';
      const inside = this.place(cop.car.interpPos(alpha), rim);
      if (!inside && !pursuit) continue;
      drawBlip(ctx, q.x, q.y, (pursuit ? (inside ? 4.8 : 3.8) : 3.2) * dpr, copColor(pursuit, now), pursuit);
    }
    const target = this.gps.target;
    if (this.gps.waypoint && this.gps.waypoint !== target && this.place(this.gps.waypoint, rim)) drawPin(ctx, q.x, q.y, 5 * dpr, MAP_INK.waypoint);
    if (target) {
      const inside = this.place(target, rim);
      const suspect = target === this.gps.destination && this.gps.destName === 'SUSPECT';
      const color = suspect ? copColor(true, now) : target === this.gps.destination ? MAP_INK.destination : MAP_INK.waypoint;
      drawPin(ctx, q.x, q.y, (inside ? 7 : 5.5) * dpr, color);
    }
    t.toScreen(p, q);
    drawArrow(ctx, q.x, q.y, t.angleOf(this.player.interpYaw(alpha)), 15 * dpr);
    this.drawNorth(R);
    this.updateDistance(target, p);
  }

  /** Projects a world point into `q`, pinned to the rim radius if outside. Returns true if inside. */
  private place(p: Vec2, rim: number): boolean {
    const q = this.t.toScreen(p, this.q);
    const R = this.size / 2;
    const dx = q.x - R;
    const dy = q.y - R;
    const d = Math.hypot(dx, dy);
    if (d <= rim) return true;
    q.x = R + (dx / d) * rim;
    q.y = R + (dy / d) * rim;
    return false;
  }

  private drawNorth(R: number): void {
    const { ctx, dpr } = this;
    const a = this.t.rot; // canvas direction of world north (-z)
    const r = R - 9 * dpr;
    const x = R + Math.sin(a) * r;
    const y = R - Math.cos(a) * r;
    ctx.beginPath();
    ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 4, 24, 0.85)';
    ctx.fill();
    ctx.font = `${Math.round(8 * dpr)}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = MAP_INK.waypoint;
    ctx.fillText('N', x + 0.5 * dpr, y + 0.5 * dpr);
  }

  private updateDistance(target: Vec2 | null, p: Vec2): void {
    let text = '';
    if (target) {
      const m = this.gps.route ? this.gps.remaining : dist(p, target);
      const name = target === this.gps.destination ? this.gps.destName : 'WAYPOINT';
      text = `${name} ${formatDistance(m)}`;
    }
    if (text === this.shownDist) return;
    this.shownDist = text;
    this.distEl.textContent = text;
    this.distEl.classList.toggle('show', text !== '');
    this.distEl.classList.toggle('dest', !!target && target === this.gps.destination);
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(this.root.clientWidth * dpr);
    if (size === this.size && dpr === this.dpr) return;
    this.dpr = dpr;
    this.size = size;
    this.canvas.width = this.canvas.height = size;
  }
}
