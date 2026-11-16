import type { Vec2 } from '../types';
import type { MapImage } from './MapImage';

export const MAP_INK = {
  route: '#3ef2ff',
  waypoint: '#ff3ea5',
  destination: '#ffb43e',
  player: '#ffffff',
  patrol: '#5b8cff',
  sirenRed: '#ff2e4a',
  sirenBlue: '#3e7bff',
};

export interface Px {
  x: number;
  y: number;
}

/**
 * World (x, z) to canvas pixels: offset from the view center, rotate by `rot`, scale, move to the screen
 * center. rot 0 = north (-z) up; for a heading-up map use `rot = heading - PI`.
 */
export class MapTransform {
  cx = 0;
  cz = 0;
  scale = 1;
  rot = 0;
  sx = 0;
  sy = 0;
  private c = 1;
  private s = 0;

  set(cx: number, cz: number, scale: number, rot: number, sx: number, sy: number): void {
    this.cx = cx;
    this.cz = cz;
    this.scale = scale;
    this.rot = rot;
    this.sx = sx;
    this.sy = sy;
    this.c = Math.cos(rot) * scale;
    this.s = Math.sin(rot) * scale;
  }

  toScreen(p: Vec2, out: Px = { x: 0, y: 0 }): Px {
    const dx = p.x - this.cx;
    const dz = p.z - this.cz;
    out.x = this.c * dx - this.s * dz + this.sx;
    out.y = this.s * dx + this.c * dz + this.sy;
    return out;
  }

  toWorld(x: number, y: number): Vec2 {
    const dx = x - this.sx;
    const dy = y - this.sy;
    const k = 1 / (this.scale * this.scale);
    return { x: this.cx + (this.c * dx + this.s * dy) * k, z: this.cz + (-this.s * dx + this.c * dy) * k };
  }

  /** Canvas angle (0 = up, clockwise) of a world yaw. */
  angleOf(yaw: number): number {
    return Math.PI - yaw + this.rot;
  }

  /** Makes canvas drawing commands take world (x, z) coordinates. */
  apply(ctx: CanvasRenderingContext2D): void {
    const { c, s } = this;
    ctx.setTransform(c, s, -s, c, this.sx - (c * this.cx - s * this.cz), this.sy - (s * this.cx + c * this.cz));
  }
}

export function drawBase(ctx: CanvasRenderingContext2D, t: MapTransform, img: MapImage): void {
  ctx.save();
  t.apply(ctx);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img.canvas, img.x0, img.z0, img.width, img.height);
  ctx.restore();
}

/** Neon polyline (glow + core), `width` in canvas pixels. */
export function strokeRoute(ctx: CanvasRenderingContext2D, t: MapTransform, pts: Vec2[], width: number, color = MAP_INK.route): void {
  if (pts.length < 2) return;
  const q: Px = { x: 0, y: 0 };
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    t.toScreen(pts[i], q);
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = width * 2.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Car arrow pointing at canvas angle `angle` (0 = up), `size` = length in pixels. */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, color = MAP_INK.player): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.6);
  ctx.lineTo(size * 0.42, size * 0.45);
  ctx.lineTo(0, size * 0.22);
  ctx.lineTo(-size * 0.42, size * 0.45);
  ctx.closePath();
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.strokeStyle = '#0a0418';
  ctx.stroke();
  ctx.restore();
}

/** Diamond marker with a glow (waypoint / destination). */
export function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, 0);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.7, 0);
  ctx.closePath();
  ctx.shadowColor = color;
  ctx.shadowBlur = size;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, size * 0.18);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.restore();
}

export function drawBlip(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, glow = true): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.shadowColor = color;
  ctx.shadowBlur = glow ? r * 2 : 0;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;
}

/** A site's icon: a box in its color with its glyph (the precinct). */
export function drawDispatch(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, glyph: string): void {
  const h = size / 2;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.6;
  ctx.fillStyle = '#1a0f02';
  ctx.fillRect(x - h, y - h, size, size);
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, size * 0.1);
  ctx.strokeStyle = color;
  ctx.strokeRect(x - h, y - h, size, size);
  ctx.fillStyle = color;
  ctx.font = `${Math.round(size * 0.72)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, x, y + size * 0.04);
  ctx.restore();
}

/** Police blip color: flashing red / blue in pursuit, steady blue on patrol. */
export function copColor(pursuit: boolean, timeMs: number): string {
  if (!pursuit) return MAP_INK.patrol;
  return Math.floor(timeMs / 160) % 2 ? MAP_INK.sirenRed : MAP_INK.sirenBlue;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Screen box of a placed label (canvas pixels), for overlap tests. */
export interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Boulevard names drawn along their roads, kept upright, with a dark halo. Labels go at `spacing` pixel
 * intervals along each run (or, with `near`, once per run at the point closest to it, within `range` px), and
 * skip any spot whose box overlaps one in `placed` (which they add to). `size` in canvas pixels.
 */
export function drawStreetLabels(
  ctx: CanvasRenderingContext2D,
  t: MapTransform,
  labels: { text: string; a: Vec2; b: Vec2 }[],
  opts: { size: number; spacing?: number; near?: { x: number; y: number }; range?: number; placed: LabelBox[] },
): void {
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${Math.round(opts.size)}px 'VT323', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, opts.size * 0.22);
  for (const l of labels) {
    t.toScreen(l.a, a);
    t.toScreen(l.b, b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const w = ctx.measureText(l.text).width;
    if (len < w * 1.3) continue;
    let ang = Math.atan2(dy, dx);
    if (ang > Math.PI / 2) ang -= Math.PI;
    else if (ang < -Math.PI / 2) ang += Math.PI;
    const spots: number[] = [];
    if (opts.near) {
      // The point of the run closest to `near`, kept off the run's ends
      const k = ((opts.near.x - a.x) * dx + (opts.near.y - a.y) * dy) / (len * len);
      const s = Math.min(Math.max(k, w / 2 / len), 1 - w / 2 / len);
      const px = a.x + dx * s - opts.near.x;
      const py = a.y + dy * s - opts.near.y;
      if (Math.hypot(px, py) <= (opts.range ?? Infinity)) spots.push(s);
    } else {
      const n = Math.max(1, Math.floor(len / (opts.spacing ?? 400)));
      for (let i = 0; i < n; i++) spots.push((i + 0.5) / n);
    }
    const hw = (Math.abs(Math.cos(ang)) * w + Math.abs(Math.sin(ang)) * opts.size) / 2 + 3;
    const hh = (Math.abs(Math.sin(ang)) * w + Math.abs(Math.cos(ang)) * opts.size) / 2 + 3;
    const lo = w / 2 / len;
    // Each spot slides along the run (up to a fifth of the spacing either way) to find a free place
    const slide = opts.near ? [0] : [0, 0.08, -0.08, 0.16, -0.16].map((k) => k / spots.length);
    for (const s0 of spots) {
      let box: LabelBox | null = null;
      let x = 0;
      let y = 0;
      for (const ds of slide) {
        const s = Math.min(Math.max(s0 + ds, lo), 1 - lo);
        x = a.x + dx * s;
        y = a.y + dy * s;
        const b0 = { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh };
        if (!opts.placed.some((p) => p.x0 < b0.x1 && b0.x0 < p.x1 && p.y0 < b0.y1 && b0.y0 < p.y1)) {
          box = b0;
          break;
        }
      }
      if (!box) continue;
      opts.placed.push(box);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.strokeStyle = 'rgba(5, 3, 12, 0.85)';
      ctx.strokeText(l.text, 0, 0);
      ctx.fillStyle = 'rgba(255, 236, 200, 0.92)';
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}
