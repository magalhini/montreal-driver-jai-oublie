import * as THREE from 'three';
import { CONFIG, KMH } from '../config';
import type { Vec2 } from '../types';
import type { CityModel } from './RoadGraph';
import { RoadSignPosts, type SignPost } from './RoadSignPosts';
import { inDriveway } from './StreetProps';

/**
 * Speed limits you can see: the number painted on each lane just past every junction (Japanese style,
 * stretched along the lane) and a round regulatory sign on the curb side at the start of each block.
 * Speeding is an offense, so the city should say what the limit is (the HUD repeats it).
 */
const LIMITS = [CONFIG.STREET_LIMIT_KMH, CONFIG.AVENUE_LIMIT_KMH];
const FONT = "'Helvetica Neue', Arial, sans-serif";

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

/** White painted numerals, tall and narrow (they're read at a grazing angle), a little worn. */
function paintTexture(kmh: number): THREE.Texture {
  return canvasTex(128, 320, (g) => {
    g.clearRect(0, 0, 128, 320);
    g.save();
    g.scale(1, 2.6);
    g.fillStyle = '#ffffff';
    g.font = `bold 92px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(kmh), 64, 62);
    g.restore();
    // wear
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(0, 0, 0, ${Math.random() * 0.6})`;
      g.fillRect(Math.random() * 128, Math.random() * 320, 1 + Math.random() * 4, 1 + Math.random() * 3);
    }
  });
}

/** Round sign: white face, red ring, blue numerals. */
function signTexture(kmh: number): THREE.Texture {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#c8202a';
    g.beginPath();
    g.arc(128, 128, 126, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f4f4f2';
    g.beginPath();
    g.arc(128, 128, 98, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a3a9a';
    g.font = `bold 112px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(kmh), 128, 136);
  });
}

/**
 * Paints the lane numerals (static: added to `scene`) and places the curb signs. The signs are breakaway posts
 * whose meshes change after building, so they come back as `RoadSignPosts` and must stay out of `StaticTiles`.
 */
export function buildRoadSigns(city: CityModel, scene: THREE.Scene): RoadSignPosts {
  const t = city.terrain;
  const paint: THREE.Matrix4[][] = LIMITS.map(() => []);
  const posts: SignPost[] = [];
  const breakAt = CONFIG.SIGN_BREAK_KMH * KMH;
  const LW = CONFIG.LANE_WIDTH;
  const up = new THREE.Vector3(0, 1, 0);
  const g: Vec2 = { x: 0, z: 0 };

  for (const e of city.edges) {
    const which = LIMITS.findIndex((k) => Math.abs(k * KMH - e.speedLimit) < 0.1);
    if (which < 0) continue;
    const hw = e.width / 2;
    const med = e.avenue ? 0.25 : 0;
    for (const id of [...e.lanesAB, ...e.lanesBA]) {
      const lane = city.lanes[id];
      if (lane.length < 30) continue;
      const d = lane.dir;
      const left: Vec2 = { x: d.z, z: -d.x };
      // Painted numerals a few meters past the junction, along the lane
      const at = 6.5;
      const p = { x: lane.start.x + d.x * at, z: lane.start.z + d.z * at };
      t.gradient(p.x, p.z, g);
      const fwd = new THREE.Vector3(d.x, g.x * d.x + g.z * d.z, d.z).normalize();
      const right = new THREE.Vector3(-d.z, -(g.x * d.z) + g.z * d.x, d.x).normalize();
      const nrm = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const m = new THREE.Matrix4().makeBasis(right.multiplyScalar(1.5), fwd.multiplyScalar(3.8), nrm);
      m.setPosition(p.x, t.heightAt(p.x, p.z) + 0.03, p.z);
      paint[which].push(m);
      // One sign per direction, on the curb side, at the start of the block
      if (lane.index !== 0) continue;
      const off = med + LW * (lane.index + 0.5);
      for (const along of [11, 16, 21]) {
        const q = { x: lane.start.x + d.x * along + left.x * (hw + 0.45 - off), z: lane.start.z + d.z * along + left.z * (hw + 0.45 - off) };
        if (inDriveway(city, q, 0.8)) continue;
        const y = t.surfaceY(q.x, q.z);
        // The face looks back at the oncoming driver (+Z of lookAt(eye, target) points from target to eye)
        const face = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(d.x, 0, d.z), up);
        posts.push({
          center: new THREE.Vector3(q.x, y + 1.375, q.z),
          rot: new THREE.Quaternion().setFromRotationMatrix(face),
          kind: which,
          collider: { minX: q.x - 0.08, maxX: q.x + 0.08, minZ: q.z - 0.08, maxZ: q.z + 0.08, breakAt },
        });
        break;
      }
    }
  }

  const quad = new THREE.PlaneGeometry(1, 1);
  LIMITS.forEach((kmh, i) => {
    if (!paint[i].length) return;
    const pm = new THREE.MeshStandardMaterial({ map: paintTexture(kmh), transparent: true, depthWrite: false, roughness: 0.55, color: 0xd8d8d8, polygonOffset: true, polygonOffsetFactor: -3 });
    const im = new THREE.InstancedMesh(quad, pm, paint[i].length);
    paint[i].forEach((mm, k) => im.setMatrixAt(k, mm));
    im.renderOrder = 1;
    scene.add(im);
  });
  const faces = LIMITS.map((kmh) => {
    const tex = signTexture(kmh);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
  });
  return new RoadSignPosts(posts, faces, t);
}
