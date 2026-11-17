import * as THREE from 'three';

/** Canvas textures for the pit garage interior (`PitGarage.ts`). */
const FONT = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', 'Meiryo', sans-serif";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Deterministic noise so the room looks the same every visit. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Sealed shop concrete: speckles, trowel marks and old oil stains. Tiles. */
export function concreteTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const r = rand(7);
  g.fillStyle = '#4a4946';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 55 + r() * 50;
    g.fillStyle = `rgba(${v},${v},${v - 4},${0.08 + r() * 0.12})`;
    g.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 7; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 20 + r() * 60;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(20,18,16,0.45)');
    grad.addColorStop(1, 'rgba(20,18,16,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.strokeStyle = 'rgba(30,30,30,0.35)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(512, 256);
  g.moveTo(256, 0);
  g.lineTo(256, 512);
  g.stroke();
  return texture(c, true);
}

/** Corrugated steel wall panels, pale workshop green. Tiles across. */
export function corrugatedTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const grad = g.createLinearGradient(0, 0, 32, 0);
  grad.addColorStop(0, '#7f8c86');
  grad.addColorStop(0.5, '#a6b2ab');
  grad.addColorStop(1, '#7f8c86');
  g.fillStyle = grad;
  for (let x = 0; x < 256; x += 32) {
    g.save();
    g.translate(x, 0);
    g.fillRect(0, 0, 32, 256);
    g.restore();
  }
  const r = rand(3);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(90,60,30,${0.05 + r() * 0.1})`;
    g.fillRect(r() * 256, r() * 256, 2 + r() * 6, 10 + r() * 50);
  }
  return texture(c, true);
}

/** Pegboard over the bench, hung with spanners, hammers and screwdrivers (outlines painted behind each). */
export function pegboardTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#b48a58';
  g.fillRect(0, 0, 1024, 512);
  g.fillStyle = 'rgba(40,24,10,0.55)';
  for (let y = 16; y < 512; y += 32) for (let x = 16; x < 1024; x += 32) g.fillRect(x - 3, y - 3, 6, 6);
  const tool = (draw: () => void) => {
    g.save();
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 10;
    g.globalAlpha = 0.35;
    draw();
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = '#4d5157';
    draw();
    g.fill();
    g.restore();
  };
  // Spanners, small to large
  for (let i = 0; i < 8; i++) {
    const x = 70 + i * 52;
    const len = 120 + i * 18;
    tool(() => {
      g.beginPath();
      g.roundRect(x - 7, 70, 14, len, 6);
      g.arc(x, 70, 16 + i, 0, Math.PI * 2);
      g.arc(x, 70 + len, 14 + i, 0, Math.PI * 2);
    });
  }
  // Hammers
  for (let i = 0; i < 2; i++) {
    const x = 560 + i * 90;
    tool(() => {
      g.beginPath();
      g.roundRect(x - 8, 110, 16, 220, 6);
      g.roundRect(x - 44, 90, 88, 38, 8);
    });
  }
  // Screwdrivers
  const handles = ['#c8281e', '#e0b020', '#2456b8', '#c8281e', '#1d5a38'];
  handles.forEach((col, i) => {
    const x = 780 + i * 40;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x - 5, 80, 14, 230);
    g.fillStyle = '#9aa0a8';
    g.fillRect(x - 3, 170, 6, 140);
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(x - 11, 80, 22, 92, 8);
    g.fill();
  });
  // Pliers and a tape measure along the bottom
  tool(() => {
    g.beginPath();
    g.ellipse(160, 420, 70, 26, 0.2, 0, Math.PI * 2);
  });
  g.fillStyle = '#e0b020';
  g.beginPath();
  g.arc(420, 420, 44, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1a1a';
  g.beginPath();
  g.arc(420, 420, 16, 0, Math.PI * 2);
  g.fill();
  return texture(c);
}

/** Sign over the workshop door. One room for every garage, so it stays generic; the station name is on the menu. */
export function signTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const glow = (text: string, font: string, color: string, x: number, y: number) => {
    g.font = font;
    g.shadowColor = color;
    g.shadowBlur = 24;
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.shadowBlur = 6;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.55;
    g.fillText(text, x, y);
    g.globalAlpha = 1;
  };
  const big = `bold 96px ${FONT}`;
  const mid = `bold 64px ${FONT}`;
  glow('PNEUS', big, '#ff3a2a', 512, 88);
  glow('GARAGE', mid, '#ffb43e', 512, 178);
  return texture(c);
}

/** The night street seen through the open door: towers, lit windows, neon signs, the wet road. */
export function streetTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 512);
  const sky = g.createLinearGradient(0, 0, 0, 380);
  sky.addColorStop(0, '#05030f');
  sky.addColorStop(0.7, '#1a0c34');
  sky.addColorStop(1, '#3a1650');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1024, 512);
  const r = rand(11);
  // Buildings across the street
  let x = -20;
  while (x < 1024) {
    const w = 90 + r() * 140;
    const top = 40 + r() * 160;
    g.fillStyle = `rgb(${12 + r() * 10},${10 + r() * 8},${22 + r() * 14})`;
    g.fillRect(x, top, w - 6, 380 - top);
    for (let wy = top + 14; wy < 360; wy += 20) {
      for (let wx = x + 10; wx < x + w - 18; wx += 16) {
        if (r() < 0.45) continue;
        g.fillStyle = r() < 0.7 ? `rgba(255,${190 + r() * 50},${110 + r() * 60},${0.35 + r() * 0.4})` : 'rgba(140,200,255,0.35)';
        g.fillRect(wx, wy, 8, 11);
      }
    }
    x += w;
  }
  // Neon signs
  const neon = (text: string, x0: number, y0: number, color: string, size: number, vertical = false) => {
    g.save();
    g.font = `bold ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 22;
    g.fillStyle = color;
    if (vertical) [...text].forEach((ch, i) => g.fillText(ch, x0, y0 + i * size * 1.05));
    else g.fillText(text, x0, y0);
    g.restore();
  };
  neon('IGA', 150, 200, '#ff2a2a', 52);
  neon('TIM HORTONS', 430, 155, '#ff3b3b', 28);
  neon('PROVIGO', 680, 220, '#ffd000', 32);
  neon('POUTINE', 920, 170, '#ffe14a', 26);
  // Wet street and the reflections in it
  const road = g.createLinearGradient(0, 380, 0, 512);
  road.addColorStop(0, '#120a1c');
  road.addColorStop(1, '#05040a');
  g.fillStyle = road;
  g.fillRect(0, 380, 1024, 132);
  const streak = (x0: number, color: string) => {
    const s = g.createLinearGradient(0, 384, 0, 512);
    s.addColorStop(0, color);
    s.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = s;
    g.fillRect(x0 - 18, 384, 36, 128);
  };
  streak(160, 'rgba(255,62,165,0.35)');
  streak(420, 'rgba(62,242,255,0.3)');
  streak(640, 'rgba(255,180,62,0.3)');
  g.fillStyle = 'rgba(255,220,120,0.6)';
  for (let i = 0; i < 8; i++) g.fillRect(40 + i * 130, 446, 60, 4);
  return texture(c);
}

/** Workshop posters: a tire brand and the house motor oil. */
export function posterTexture(kind: 'tires' | 'oil'): THREE.CanvasTexture {
  const [c, g] = canvas(256, 360);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (kind === 'tires') {
    g.fillStyle = '#111014';
    g.fillRect(0, 0, 256, 360);
    g.strokeStyle = '#2a2a2e';
    g.lineWidth = 30;
    g.beginPath();
    g.arc(128, 150, 80, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#9aa0a8';
    g.beginPath();
    g.arc(128, 150, 52, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd21e';
    g.font = `bold 40px ${FONT}`;
    g.fillText('RYUSEI', 128, 282);
    g.font = `bold 26px ${FONT}`;
    g.fillText('流星タイヤ', 128, 322);
  } else {
    g.fillStyle = '#d8301c';
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = '#f4f2ee';
    g.fillRect(16, 16, 224, 328);
    g.fillStyle = '#d8301c';
    g.font = `bold 54px ${FONT}`;
    g.fillText('NEO', 128, 76);
    g.fillText('OIL', 128, 132);
    g.fillStyle = '#14141a';
    g.beginPath();
    g.roundRect(84, 168, 88, 118, 10);
    g.fill();
    g.fillStyle = '#f2a21c';
    g.fillRect(84, 206, 88, 30);
    g.fillStyle = '#14141a';
    g.font = `bold 22px ${FONT}`;
    g.fillText('MOTOR OIL', 128, 316);
  }
  return texture(c);
}

/** Laptop screen glow. */
export function screenTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 128, 80);
  grd.addColorStop(0, '#2a3f7a');
  grd.addColorStop(1, '#6a3a8a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 80);
  g.fillStyle = 'rgba(255, 255, 255, 0.75)';
  for (let y = 12; y < 70; y += 9) g.fillRect(12, y, 40 + ((y * 13) % 60), 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
