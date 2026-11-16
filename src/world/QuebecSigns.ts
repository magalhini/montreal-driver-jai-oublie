import * as THREE from 'three';
import type { StreetName } from '../types';

/**
 * Canvas textures for Montreal's street signs (PRD 3, 5.8): the black-on-white speed plate, the ARRÊT
 * octagon and its all-way plaque, white street blades with the red rosette, and stacked parking plates.
 * French copy, the shapes in `inspo/`, no scanned artwork.
 */
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const RED = '#c8102e';
const INK = '#141414';
const WHITE = '#f4f4f0';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Text squeezed to fit `maxW` (signs keep their size, the type narrows). */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxW: number, weight = 'bold'): void {
  g.font = `${weight} ${size}px ${SANS}`;
  const w = g.measureText(text).width;
  if (w <= maxW) {
    g.fillText(text, x, y);
    return;
  }
  g.save();
  g.translate(x, y);
  g.scale(maxW / w, 1);
  g.fillText(text, 0, 0);
  g.restore();
}

/** Speed plate, 0.6 x 0.75 m: white, black border, the limit in black, km/h under it. */
export function speedPlateTexture(kmh: number): THREE.Texture {
  return canvasTex(256, 320, (g) => {
    g.fillStyle = WHITE;
    g.fillRect(0, 0, 256, 320);
    g.strokeStyle = INK;
    g.lineWidth = 10;
    g.strokeRect(14, 14, 228, 292);
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, String(kmh), 128, 150, 150, 200);
    fitText(g, 'km/h', 128, 258, 44, 160);
  });
}

/** Regular octagon edge to edge across the canvas, flat on top (matches `octagonGeometry`). */
function octagonPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/** ARRÊT: red octagon, white rim, white capitals. */
export function arretTexture(): THREE.Texture {
  return canvasTex(256, 256, (g) => {
    // Radii are to the corners: the flats sit 127 and 116 px from the middle (the geometry fills the square)
    const k = 1 / Math.cos(Math.PI / 8);
    octagonPath(g, 128, 128, 127 * k);
    g.fillStyle = WHITE;
    g.fill();
    octagonPath(g, 128, 128, 116 * k);
    g.fillStyle = RED;
    g.fill();
    g.fillStyle = WHITE;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, 'ARRÊT', 128, 134, 70, 196);
  });
}

/** The all-way plaque: four small octagons round a crossing, on white. */
export function allWayTexture(): THREE.Texture {
  return canvasTex(192, 128, (g) => {
    g.fillStyle = WHITE;
    g.fillRect(0, 0, 192, 128);
    g.strokeStyle = INK;
    g.lineWidth = 6;
    g.strokeRect(5, 5, 182, 118);
    g.fillStyle = INK;
    g.fillRect(90, 18, 12, 92);
    g.fillRect(46, 58, 100, 12);
    for (const [x, y] of [
      [96, 26],
      [96, 102],
      [52, 64],
      [140, 64],
    ]) {
      octagonPath(g, x, y, 17);
      g.fillStyle = RED;
      g.fill();
    }
  });
}

/** Octagon in the XY plane, 1 m edge to edge, flat on top, with UVs over its bounding square. */
export function octagonGeometry(): THREE.BufferGeometry {
  // Circumradius so the flats are 1 m apart
  const g = new THREE.CircleGeometry(0.5 / Math.cos(Math.PI / 8), 8, Math.PI / 8);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + 0.5, pos.getY(i) + 0.5);
  return g;
}

/** The red rosette from the city's flag, simplified: four round lobes about a cross. */
function rosette(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.fillStyle = RED;
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    g.beginPath();
    g.arc(cx + dx * r * 0.52, cy + dy * r * 0.52, r * 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = WHITE;
  g.fillRect(cx - r * 0.07, cy - r * 0.95, r * 0.14, r * 1.9);
  g.fillRect(cx - r * 0.95, cy - r * 0.07, r * 1.9, r * 0.14);
}

/** Blade cells in the atlas: 512 x 128 px each, two per row. */
const BLADE_W = 512;
const BLADE_H = 128;

/** All street blades on one atlas; `uv(i)` is the cell of name i as [u0, v0, u1, v1]. */
export interface BladeAtlas {
  texture: THREE.Texture;
  uv(i: number): [number, number, number, number];
}

/** White blades, black type: the small generic word over the name, the rosette on the right. */
export function bladeAtlas(names: StreetName[]): BladeAtlas {
  const rows = Math.max(1, Math.ceil(names.length / 2));
  const W = BLADE_W * 2;
  const H = BLADE_H * rows;
  const texture = canvasTex(W, H, (g) => {
    names.forEach((n, i) => {
      const x0 = (i % 2) * BLADE_W;
      const y0 = Math.floor(i / 2) * BLADE_H;
      g.fillStyle = WHITE;
      g.fillRect(x0, y0, BLADE_W, BLADE_H);
      g.strokeStyle = INK;
      g.lineWidth = 5;
      g.strokeRect(x0 + 6, y0 + 6, BLADE_W - 12, BLADE_H - 12);
      g.fillStyle = INK;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      fitText(g, n.generic, x0 + 24, y0 + 42, 26, 200, '500');
      fitText(g, n.name, x0 + 24, y0 + 104, 58, BLADE_W - 150);
      rosette(g, x0 + BLADE_W - 62, y0 + BLADE_H / 2, 34);
    });
  });
  return {
    texture,
    uv: (i) => {
      const u0 = (i % 2) / 2;
      const r = Math.floor(i / 2);
      return [u0, 1 - (r + 1) / rows, u0 + 0.5, 1 - r / rows];
    },
  };
}

/** Parking plate kinds on the curbs of the residential streets (dressing only: PRD 8, no parking rules). */
export const PLATE_KINDS = 5;

/**
 * Parking plates, 128 x 192 px each in a row: no parking on the cleaning day, a paid 2 h zone, the permit
 * zone, the winter overnight ban, and an arrow plate.
 */
export function parkingAtlas(): THREE.Texture {
  return canvasTex(128 * PLATE_KINDS, 192, (g) => {
    const plate = (k: number, draw: (x: number) => void) => {
      const x = k * 128;
      g.fillStyle = WHITE;
      g.fillRect(x, 0, 128, 192);
      g.strokeStyle = INK;
      g.lineWidth = 4;
      g.strokeRect(x + 4, 4, 120, 184);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      draw(x);
    };
    const noP = (x: number, y: number) => {
      g.fillStyle = INK;
      g.font = `bold 64px ${SANS}`;
      g.fillText('P', x + 64, y + 2);
      g.strokeStyle = RED;
      g.lineWidth = 9;
      g.beginPath();
      g.arc(x + 64, y, 38, 0, Math.PI * 2);
      g.moveTo(x + 64 - 27, y + 27);
      g.lineTo(x + 64 + 27, y - 27);
      g.stroke();
    };
    const lines = (x: number, y: number, rows: string[], size = 19) => {
      g.fillStyle = INK;
      rows.forEach((t, i) => fitText(g, t, x + 64, y + i * (size + 6), size, 110));
    };
    plate(0, (x) => {
      noP(x, 56);
      lines(x, 116, ['MARDI', '9h - 10h', '1 AVRIL AU 1 DÉC.']);
    });
    plate(1, (x) => {
      g.fillStyle = '#1f7a3a';
      g.font = `bold 72px ${SANS}`;
      g.fillText('P', x + 64, 56);
      lines(x, 112, ['2 h', '9h - 21h', 'LUN. AU SAM.']);
    });
    plate(2, (x) => {
      noP(x, 56);
      lines(x, 116, ['EXCEPTÉ', 'DÉTENTEURS', 'PERMIS 128']);
    });
    plate(3, (x) => {
      noP(x, 56);
      lines(x, 116, ['23h - 7h', '1 DÉC.', 'AU 1 AVRIL']);
    });
    plate(4, (x) => {
      g.fillStyle = INK;
      g.beginPath();
      g.moveTo(x + 18, 96);
      g.lineTo(x + 58, 60);
      g.lineTo(x + 58, 82);
      g.lineTo(x + 110, 82);
      g.lineTo(x + 110, 110);
      g.lineTo(x + 58, 110);
      g.lineTo(x + 58, 132);
      g.closePath();
      g.fill();
    });
  });
}
