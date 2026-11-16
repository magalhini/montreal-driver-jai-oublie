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
