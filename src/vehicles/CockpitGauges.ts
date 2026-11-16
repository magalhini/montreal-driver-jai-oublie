import * as THREE from 'three';

/** Needle sweep: 0 points down-left, full scale down-right (270 degrees clockwise). */
export const SWEEP_START = (135 * Math.PI) / 180;
export const SWEEP = (270 * Math.PI) / 180;
export const SPEEDO_MAX = 240; // km/h
export const TACH_MAX = 9000; // rpm

/** Canvas size per meter of cluster face. */
const PX = 2560;
export const CLUSTER_W = 0.44;
export const CLUSTER_H = 0.165;
/** Dial centers on the cluster face (m, from its center; +x is the viewer's right) and radius. */
export const DIAL_X = 0.097;
export const DIAL_R = 0.071;

const INK = '#e4f7ff';
const GLOW = '#3fd4ff';
const RED = '#ff3a2e';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Point on a dial at fraction t of the sweep (canvas coordinates, y down). */
function polar(cx: number, cy: number, r: number, t: number): [number, number] {
  const a = SWEEP_START - t * SWEEP;
  return [cx - Math.sin(a) * r, cy - Math.cos(a) * r];
}

function dial(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, max: number, step: number, label: number, redFrom: number, unit: string, scale = 1): void {
  // Bezel and face
  const ring = g.createLinearGradient(cx, cy - r, cx, cy + r);
  ring.addColorStop(0, '#5a5d66');
  ring.addColorStop(0.5, '#1b1c20');
  ring.addColorStop(1, '#3a3c42');
  g.fillStyle = ring;
  g.beginPath();
  g.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#030305';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();

  // Red zone arc
  if (redFrom < max) {
    g.strokeStyle = RED;
    g.lineWidth = r * 0.07;
    g.beginPath();
    const a0 = -Math.PI / 2 - (SWEEP_START - (redFrom / max) * SWEEP);
    const a1 = -Math.PI / 2 - (SWEEP_START - SWEEP);
    g.arc(cx, cy, r * 0.86, a0, a1);
    g.stroke();
  }

  g.shadowColor = GLOW;
  g.shadowBlur = r * 0.06;
  for (let v = 0; v <= max + 1e-6; v += step / 2) {
    const t = v / max;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    const [x0, y0] = polar(cx, cy, r * (major ? 0.78 : 0.84), t);
    const [x1, y1] = polar(cx, cy, r * 0.92, t);
    g.strokeStyle = v >= redFrom ? RED : INK;
    g.lineWidth = r * (major ? 0.035 : 0.018);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    if (major && Math.abs(v / label - Math.round(v / label)) < 1e-6) {
      const [tx, ty] = polar(cx, cy, r * 0.6, t);
      g.fillStyle = v >= redFrom ? RED : INK;
      g.font = `bold ${Math.round(r * 0.2)}px Helvetica, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(Math.round(v / scale)), tx, ty);
    }
  }
  g.shadowBlur = 0;
  g.fillStyle = '#9fb4bd';
  g.font = `${Math.round(r * 0.11)}px Helvetica, Arial, sans-serif`;
  g.textAlign = 'center';
  g.fillText(unit, cx, cy + r * 0.38);
}

/** Tachometer (left) and speedometer (right) behind the wheel, backlit for night driving. */
export function clusterTexture(redline: number): THREE.CanvasTexture {
  const W = Math.round(CLUSTER_W * PX);
  const H = Math.round(CLUSTER_H * PX);
  const [c, g] = canvas(W, H);
  g.fillStyle = '#060608';
  g.fillRect(0, 0, W, H);
  const r = DIAL_R * PX;
  const cy = H / 2;
  dial(g, W / 2 - DIAL_X * PX, cy, r, TACH_MAX, 1000, 1000, redline, 'x1000 r/min', 1000);
  dial(g, W / 2 + DIAL_X * PX, cy, r, SPEEDO_MAX, 20, 40, Infinity, 'km/h');

  // Odometer window under the speedometer
  const ox = W / 2 + DIAL_X * PX;
  const oy = cy + r * 0.62;
  g.fillStyle = '#000';
  g.fillRect(ox - r * 0.3, oy - r * 0.08, r * 0.6, r * 0.16);
  g.fillStyle = '#d8d2c0';
  g.font = `${Math.round(r * 0.12)}px Menlo, Consolas, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('0 4 2 8 1 7', ox, oy + 1);

  // Warning lamps between the dials (dark until something is wrong)
  const lamps = ['#3a1010', '#3a2a08', '#0c2a12', '#3a1010'];
  lamps.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(W / 2, cy - r * 0.6 + i * r * 0.4, r * 0.07, 0, Math.PI * 2);
    g.fill();
  });
  return texture(c);
}

/** Car stereo display (vacuum-fluorescent green), redrawn when the clock changes. */
export class RadioDisplay {
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private shown = '';

  constructor() {
    const [c, g] = canvas(512, 128);
    this.g = g;
    this.texture = texture(c);
    this.update();
  }

  update(): void {
    const d = new Date();
    const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (clock === this.shown) return;
    this.shown = clock;
    const g = this.g;
    g.fillStyle = '#020806';
    g.fillRect(0, 0, 512, 128);
    g.shadowColor = '#4dffb0';
    g.shadowBlur = 14;
    g.fillStyle = '#8dffd0';
    g.textBaseline = 'middle';
    g.font = 'bold 54px Menlo, Consolas, monospace';
    g.textAlign = 'left';
    g.fillText('FM 81.3', 26, 66);
    g.textAlign = 'right';
    g.fillText(clock, 486, 66);
    g.shadowBlur = 0;
    this.texture.needsUpdate = true;
  }
}
