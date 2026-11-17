import * as THREE from 'three';

/** What the player's plates say. */
export const PLAYER_PLATE = 'POUT1NE';

/** Plate size on the body (m): the same outline the body's own plates have (`CarEnds`). */
export const PLATE_W = 0.33;
export const PLATE_H = 0.165;

const BLUE = '#1f3c88';
const INK = '#14275e';
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const cache = new Map<string, THREE.Material>();

/**
 * A Quebec plate, as the street sees them: white, "QUÉBEC" in blue across the top, the registration in dark
 * blue, "Je me souviens" under it. Words and shapes only, no scanned artwork. Rounded corners are cut out
 * (alpha), so it sits exactly over the body's plate.
 */
export function plateMaterial(text: string): THREE.Material {
  let m = cache.get(text);
  if (m) return m;
  const W = 512;
  const H = Math.round((W * PLATE_H) / PLATE_W);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#f4f4ef';
  g.beginPath();
  g.roundRect(0, 0, W, H, 20);
  g.fill();
  g.strokeStyle = 'rgba(31,60,136,0.55)';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(8, 8, W - 16, H - 16, 14);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fit = (s: string, y: number, size: number, maxW: number, color: string, style = 'bold') => {
    g.font = `${style} ${size}px ${FONT}`;
    const w = g.measureText(s).width;
    g.save();
    g.translate(W / 2, y);
    g.scale(Math.min(1, maxW / w), 1);
    g.fillStyle = color;
    g.fillText(s, 0, 0);
    g.restore();
  };
  fit('QUÉBEC', H * 0.17, 34, 220, BLUE, 'italic bold');
  // The registration: tall, a little condensed, the way the plate's own type is
  g.font = `bold ${Math.round(H * 0.56)}px ${FONT}`;
  const w = g.measureText(text).width;
  g.save();
  g.translate(W / 2, H * 0.55);
  g.scale(Math.min(0.82, (W * 0.86) / w), 1);
  g.fillStyle = INK;
  g.fillText(text, 0, 0);
  g.restore();
  fit('Je me souviens', H * 0.89, 26, 260, BLUE, 'italic');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0.05, alphaTest: 0.5 });
  cache.set(text, m);
  return m;
}
