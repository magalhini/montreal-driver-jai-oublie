import * as THREE from 'three';
import { Rng } from '../core/Rng';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Grayscale puddle/noise map used as roughness on wet asphalt. */
export function puddleTexture(): THREE.Texture {
  const [c, g] = canvas(512, 512);
  const rng = new Rng(7);
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(rng.range(110, 190));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rng.range(0, 512), rng.range(0, 512), rng.range(1, 3), rng.range(1, 3));
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, 512);
    const y = rng.range(0, 512);
    const r = rng.range(20, 70);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(10,10,10,0.95)');
    grd.addColorStop(0.7, 'rgba(30,30,30,0.6)');
    grd.addColorStop(1, 'rgba(60,60,60,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, r, r * rng.range(0.4, 1), rng.range(0, 3), 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function tileTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#6a6a74';
  g.fillRect(0, 0, 256, 256);
  const rng = new Rng(3);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = Math.floor(rng.range(92, 118));
      g.fillStyle = `rgb(${v},${v},${v + 8})`;
      g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Mown lawn: mottled greens with blade speckle (shrine park, IMPROVEMENTS #20). */
export function grassTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const rng = new Rng(21);
  g.fillStyle = '#3c5a30';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    const x = rng.range(0, 256);
    const y = rng.range(0, 256);
    const r = rng.range(14, 46);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = rng.chance(0.5) ? '74,104,52' : '44,70,38';
    grd.addColorStop(0, `rgba(${tone},0.55)`);
    grd.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = grd;
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
  }
  for (let i = 0; i < 5000; i++) {
    const v = rng.range(0.7, 1.35);
    g.fillStyle = `rgb(${Math.round(64 * v)},${Math.round(98 * v)},${Math.round(48 * v)})`;
    g.fillRect(rng.range(0, 256), rng.range(0, 256), 1, rng.range(1, 3));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft radial blob (white center to transparent). */
export function glowTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowCache: THREE.Texture | null = null;
export function sharedGlow(): THREE.Texture {
  return (glowCache ??= glowTexture());
}

/** Value noise on a wrapping lattice of `cells` (tileable), smoothstep interpolation. */
function tileNoise(rng: Rng, cells: number): (u: number, v: number) => number {
  const g = new Float32Array(cells * cells).map(() => rng.next());
  const at = (i: number, j: number) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const i = Math.floor(x);
    const j = Math.floor(y);
    let fx = x - i;
    let fy = y - j;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Tileable asphalt: albedo (grain, aggregate, repair patches, cracks) and a matching normal map. */
export function asphaltTextures(size = 1024): { map: THREE.Texture; normalMap: THREE.Texture } {
  const rng = new Rng(1234);
  const n1 = tileNoise(rng, 8);
  const n2 = tileNoise(rng, 32);
  const n3 = tileNoise(rng, 128);
  const height = new Float32Array(size * size);
  const tone = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const grain = rng.next();
      const stone = grain > 0.93 ? 0.5 : 0;
      const k = y * size + x;
      tone[k] = 0.42 + 0.22 * n1(u, v) + 0.12 * n2(u, v) + 0.14 * (grain - 0.5) + stone * 0.35;
      height[k] = 0.5 * n3(u, v) + 0.35 * grain + stone;
    }
  }
  // Repair patches: smoother, darker rectangles with a seam
  for (let p = 0; p < 5; p++) {
    const w = Math.floor(rng.range(0.12, 0.35) * size);
    const h = Math.floor(rng.range(0.08, 0.25) * size);
    const x0 = Math.floor(rng.next() * size);
    const y0 = Math.floor(rng.next() * size);
    const d = rng.range(-0.18, -0.06);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = ((y0 + y) % size) * size + ((x0 + x) % size);
        const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
        tone[k] += edge ? -0.25 : d;
        height[k] = edge ? 0.05 : height[k] * 0.4 + 0.3;
      }
    }
  }
  // Cracks: wandering thin grooves
  for (let c = 0; c < 26; c++) {
    let x = rng.next() * size;
    let y = rng.next() * size;
    let a = rng.next() * Math.PI * 2;
    const len = rng.range(40, 260);
    for (let s = 0; s < len; s++) {
      a += rng.range(-0.35, 0.35);
      x += Math.cos(a);
      y += Math.sin(a);
      const k = ((Math.floor(y) % size) + size) % size * size + (((Math.floor(x) % size) + size) % size);
      tone[k] -= 0.3;
      height[k] = 0;
    }
  }
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const [cn, gn] = canvas(size, size);
  const nimg = gn.createImageData(size, size);
  // Normals from a softened height field: per-texel grain made the wet road sparkle like static up close
  const soft = new Float32Array(size * size);
  const raw = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      soft[y * size + x] = (4 * raw(x, y) + raw(x + 1, y) + raw(x - 1, y) + raw(x, y + 1) + raw(x, y - 1)) / 8;
    }
  }
  const H = (x: number, y: number) => soft[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const t = Math.max(0, Math.min(1, tone[k]));
      img.data[k * 4] = t * 120;
      img.data[k * 4 + 1] = t * 120;
      img.data[k * 4 + 2] = t * 128;
      img.data[k * 4 + 3] = 255;
      const dx = (H(x + 1, y) - H(x - 1, y)) * 1.6;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 1.6;
      const l = Math.hypot(dx, dy, 1);
      nimg.data[k * 4] = (-dx / l * 0.5 + 0.5) * 255;
      nimg.data[k * 4 + 1] = (-dy / l * 0.5 + 0.5) * 255;
      nimg.data[k * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
      nimg.data[k * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  gn.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(cn);
  normalMap.colorSpace = THREE.NoColorSpace;
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, normalMap };
}

/** Paving: square tiles with grout and per-tile tone, plus a normal map for the grout grooves. */
export function pavingTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const size = 512;
  const rng = new Rng(5);
  const [c, g] = canvas(size, size);
  const [cn, gn] = canvas(size, size);
  const img = g.createImageData(size, size);
  const nimg = gn.createImageData(size, size);
  const tiles = 4; // per texture (0.5 m tiles at 2 m per repeat)
  const tileTone = Array.from({ length: tiles * tiles }, () => rng.range(0.82, 1.1));
  const n = tileNoise(rng, 64);
  const groove = (x: number, y: number) => {
    const tx = (x / size) * tiles;
    const ty = (y / size) * tiles;
    const fx = Math.min(tx - Math.floor(tx), Math.ceil(tx) - tx);
    const fy = Math.min(ty - Math.floor(ty), Math.ceil(ty) - ty);
    return Math.min(1, Math.min(fx, fy) * 40);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const ti = Math.floor((x / size) * tiles) + Math.floor((y / size) * tiles) * tiles;
      const gr = groove(x, y);
      const t = (0.55 + 0.12 * n(x / size, y / size) + 0.06 * (rng.next() - 0.5)) * tileTone[ti] * (0.55 + 0.45 * gr);
      img.data[k * 4] = t * 150;
      img.data[k * 4 + 1] = t * 148;
      img.data[k * 4 + 2] = t * 158;
      img.data[k * 4 + 3] = 255;
      const dx = (groove(x + 1, y) - groove(x - 1, y)) * 2;
      const dy = (groove(x, y + 1) - groove(x, y - 1)) * 2;
      const l = Math.hypot(dx, dy, 1);
      nimg.data[k * 4] = (-dx / l * 0.5 + 0.5) * 255;
      nimg.data[k * 4 + 1] = (-dy / l * 0.5 + 0.5) * 255;
      nimg.data[k * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
      nimg.data[k * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  gn.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(cn);
  normalMap.colorSpace = THREE.NoColorSpace;
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, normalMap };
}

/** Tileable ripple normal map for water (scrolled over time). */
export function waterNormalTexture(size = 512): THREE.Texture {
  const rng = new Rng(77);
  const a = tileNoise(rng, 16);
  const b = tileNoise(rng, 48);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = a(x / size, y / size) * 0.7 + b(x / size, y / size) * 0.3;
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const H = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const dx = (H(x + 1, y) - H(x - 1, y)) * 18;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 18;
      const l = Math.hypot(dx, dy, 1);
      img.data[k * 4] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[k * 4 + 1] = (-dy / l * 0.5 + 0.5) * 255;
      img.data[k * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[k * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Stone blocks for quay walls and bridge parapets. */
export function stoneTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const rng = new Rng(31);
  g.fillStyle = '#2a2830';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 32 : 0;
    for (let col = -1; col < 5; col++) {
      const v = Math.floor(rng.range(70, 110));
      g.fillStyle = `rgb(${v},${v - 4},${v + 6})`;
      g.fillRect(col * 64 + off + 2, row * 32 + 2, 60, 28);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
