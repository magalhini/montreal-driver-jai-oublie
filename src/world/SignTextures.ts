import * as THREE from 'three';

/** Canvas textures for lit building signs (the yard HQ, the precinct): name boards, the lit lobby seen through its glass, arrows. */
export const SIGN_FONT =
  "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', 'Meiryo', sans-serif";
const FONT = "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif";
const SANS = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', sans-serif";

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** Neon lettering on a dark board: one or two lines, fitted to the width. `vertical` stacks the characters. */
export function neonTexture(lines: string[], color: string, w: number, h: number, vertical = false): THREE.Texture {
  const W = vertical ? 256 : 1024;
  const H = Math.round((W * h) / w);
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#07050c';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = color;
    g.lineWidth = vertical ? 8 : 10;
    g.shadowColor = color;
    g.shadowBlur = 22;
    g.strokeRect(12, 12, W - 24, H - 24);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const glyph = (text: string, x: number, y: number, size: number, font: string) => {
      g.font = `bold ${size}px ${font}`;
      g.fillStyle = color;
      g.shadowBlur = 24;
      g.fillText(text, x, y);
      g.shadowBlur = 0;
      g.globalAlpha = 0.65;
      g.fillStyle = '#fff';
      g.fillText(text, x, y);
      g.globalAlpha = 1;
    };
    if (vertical) {
      const chars = [...lines[0]];
      const step = (H - 60) / chars.length;
      chars.forEach((ch, i) => glyph(ch, W / 2, 30 + step * (i + 0.5), Math.min(W * 0.62, step * 0.86), SANS));
      return;
    }
    const sizes = lines.length > 1 ? [0.46, 0.26] : [0.62];
    const ys = lines.length > 1 ? [0.38, 0.76] : [0.54];
    lines.forEach((text, i) => {
      let size = H * sizes[i];
      g.font = `bold ${size}px ${i === 0 ? FONT : SANS}`;
      while (g.measureText(text).width > W * 0.86 && size > 16) g.font = `bold ${(size -= 4)}px ${i === 0 ? FONT : SANS}`;
      glyph(text, W / 2, H * ys[i], size, i === 0 ? FONT : SANS);
    });
  });
}

/** Lobby seen through the glass: warm light, chandeliers, columns, mullions, a revolving door in the middle. */
export function lobbyTexture(accent: string): THREE.Texture {
  return canvasTexture(1280, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#ffe2b0');
    grad.addColorStop(0.55, '#d8955a');
    grad.addColorStop(1, '#6a3618');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1280, 256);
    for (let x = 80; x < 1280; x += 160) {
      const c = g.createRadialGradient(x, 46, 4, x, 46, 70);
      c.addColorStop(0, 'rgba(255,255,240,1)');
      c.addColorStop(0.25, 'rgba(255,230,170,0.7)');
      c.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = c;
      g.fillRect(x - 80, 0, 160, 140);
    }
    g.fillStyle = 'rgba(70,34,14,0.55)';
    for (let x = 0; x < 1280; x += 160) g.fillRect(x + 150, 0, 20, 256);
    g.fillStyle = 'rgba(40,22,12,0.6)';
    g.fillRect(250, 170, 260, 50);
    g.fillRect(770, 170, 260, 50);
    g.fillStyle = '#1a1410';
    for (let x = 0; x <= 1280; x += 80) g.fillRect(x - 3, 0, 6, 256);
    g.fillRect(0, 0, 1280, 10);
    g.fillRect(0, 96, 1280, 5);
    g.fillStyle = 'rgba(20,14,10,0.8)';
    g.beginPath();
    g.ellipse(640, 176, 78, 80, 0, Math.PI, 0);
    g.fillRect(562, 176, 156, 80);
    g.fill();
    g.strokeStyle = accent;
    g.lineWidth = 6;
    g.strokeRect(556, 92, 168, 164);
    g.fillStyle = 'rgba(255,220,160,0.5)';
    g.fillRect(636, 100, 8, 156);
  });
}

/** Arrow pointing up the texture, with IN / OUT under it. */
export function arrowTexture(label: string): THREE.Texture {
  return canvasTexture(128, 256, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.moveTo(64, 12);
    g.lineTo(118, 80);
    g.lineTo(84, 80);
    g.lineTo(84, 150);
    g.lineTo(44, 150);
    g.lineTo(44, 80);
    g.lineTo(10, 80);
    g.closePath();
    g.fill();
    g.font = `bold 52px ${SANS}`;
    g.textAlign = 'center';
    g.fillText(label, 64, 210);
  });
}

/** Lit board: lines of text, or one vertical line of stacked characters. */
export function signTexture(lines: { text: string; size: number }[], color: string, w: number, h: number, vertical = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#07040c';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  if (vertical) {
    const chars = [...lines[0].text];
    const size = Math.min(w * 0.72, (h - 40) / chars.length);
    g.font = `bold ${size}px ${SIGN_FONT}`;
    chars.forEach((ch, i) => g.fillText(ch, w / 2, h / 2 + (i - (chars.length - 1) / 2) * size * 1.05));
  } else {
    const total = lines.reduce((s, l) => s + l.size * 1.15, 0);
    let y = h / 2 - total / 2;
    for (const l of lines) {
      g.font = `bold ${l.size}px ${SIGN_FONT}`;
      y += (l.size * 1.15) / 2;
      g.fillText(l.text, w / 2, y);
      y += (l.size * 1.15) / 2;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
