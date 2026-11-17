import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Building, Facing, Vec2 } from '../types';
import { buildingBase } from './BuildingDetails';
import { frameOf } from './BuildingFrame';
import { inDriveway } from './Features';
import { openingTop } from './Interiors';
import type { CityModel } from './RoadGraph';

/**
 * Stations of the STM metro, at the grid junction nearest each real entrance (`layout.ts` indexes: columns
 * west to east from Guy, rows mountain to river from Sherbrooke).
 */
const STATIONS: { name: string; i: number; j: number }[] = [
  { name: 'Guy-Concordia', i: 0, j: 1 },
  { name: 'Peel', i: 4, j: 1 },
  { name: 'McGill', i: 6, j: 1 },
  { name: 'Place-des-Arts', i: 12, j: 1 },
  { name: 'Saint-Laurent', i: 13, j: 1 },
  { name: 'Berri-UQAM', i: 17, j: 2 },
  { name: "Lucien-L'Allier", i: 1, j: 5 },
  { name: 'Bonaventure', i: 4, j: 5 },
  { name: 'Square-Victoria', i: 9, j: 6 },
  { name: "Place-d'Armes", i: 12, j: 6 },
  { name: 'Champ-de-Mars', i: 15, j: 6 },
];

/** Pavilion size (m) and where it sits on the facade. */
const ENTRANCE = {
  width: 6,
  height: 3,
  /** How far the pavilion stands out of the facade onto the sidewalk. */
  out: 0.75,
  /** Canopy over the sidewalk: how far out, how high, how thick. */
  canopyOut: 2.5,
  canopyY: 3.05,
  canopyT: 0.4,
  /** Pavilion center from the facade's corner end. */
  fromCorner: 4.5,
  /** The facade must be this wide to take it. */
  minFace: 9,
  /** Nearest building corner to the junction (m): farther and the station is skipped. */
  maxCorner: 34,
};

/** One entrance: on facade `face` of `building`, centered at `pos` on it. */
export interface MetroSite {
  name: string;
  building: Building;
  face: Facing;
  /** Pavilion center on the facade line. */
  pos: Vec2;
  /** Out of the facade, toward the street. */
  normal: Vec2;
  /** Along the facade, toward the junction corner (the side the blade sign hangs on). */
  toCorner: Vec2;
  floor: number;
}

const cache = new WeakMap<CityModel, MetroSite[]>();

/** Where the metro entrances go (cached per city): the facade nearest each station's junction that can take one. */
export function metroSites(city: CityModel): MetroSite[] {
  const hit = cache.get(city);
  if (hit) return hit;
  const out: MetroSite[] = [];
  const used = new Set<Building>();
  const E = ENTRANCE;
  for (const st of STATIONS) {
    if (st.i >= city.nx || st.j >= city.nz) continue;
    const node = city.nodeAt(st.i, st.j).pos;
    let best: MetroSite | null = null;
    let bestD = E.maxCorner;
    for (const b of city.buildings) {
      if (used.has(b) || b.landmark || b.custom || b.height < 6) continue;
      // Cheap reject: the building is nowhere near this junction
      if (b.maxX < node.x - 60 || b.minX > node.x + 60 || b.maxZ < node.z - 60 || b.minZ > node.z + 60) continue;
      const frame = frameOf(b);
      for (const f of b.faces) {
        const face = frame.faceOf(f);
        if (face.width < E.minFace) continue;
        // The junction is in front of this facade, across one street (not behind the building)
        const ahead = (node.x - face.center.x) * face.normal.x + (node.z - face.center.z) * face.normal.z;
        if (ahead < 2 || ahead > CONFIG.SIDEWALK + 16) continue;
        const half = face.width / 2;
        const ends = [1, -1].map((s) => ({ s, p: { x: face.center.x + face.along.x * half * s, z: face.center.z + face.along.z * half * s } }));
        const end = ends.reduce((a, e) => (Math.hypot(e.p.x - node.x, e.p.z - node.z) < Math.hypot(a.p.x - node.x, a.p.z - node.z) ? e : a));
        const d = Math.hypot(end.p.x - node.x, end.p.z - node.z);
        if (d >= bestD) continue;
        const toCorner = { x: face.along.x * end.s, z: face.along.z * end.s };
        const pos = { x: end.p.x - toCorner.x * E.fromCorner, z: end.p.z - toCorner.z * E.fromCorner };
        // Clear of garage doors in the facade and curb cuts in the sidewalk in front of it
        const span = f === 'N' || f === 'S' ? pos.x : pos.z;
        if (openingTop(b, f, span - E.width / 2, span + E.width / 2) !== null) continue;
        const front = { x: pos.x + face.normal.x * 2, z: pos.z + face.normal.z * 2 };
        if (inDriveway(city.features, front, 1.5)) continue;
        bestD = d;
        best = { name: st.name, building: b, face: f, pos, normal: { ...face.normal }, toCorner, floor: buildingBase(b).floor };
      }
    }
    if (best) {
      used.add(best.building);
      out.push(best);
    }
  }
  cache.set(city, out);
  return out;
}

/** True when this facade carries a metro entrance (the shop boards keep off it). */
export function hasMetro(city: CityModel, b: Building, f: Facing): boolean {
  return metroSites(city).some((s) => s.building === b && s.face === f);
}

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

/** The STM sign: a white ring and down arrow on blue, MÉTRO in white on a black band, in a steel frame. */
function signTexture(): THREE.Texture {
  return canvasTexture(256, 320, (g) => {
    g.fillStyle = '#c9ccd0';
    g.fillRect(0, 0, 256, 320);
    g.fillStyle = '#0d47a6';
    g.fillRect(8, 8, 240, 224);
    g.fillStyle = '#0b0b0d';
    g.fillRect(8, 232, 240, 80);
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineWidth = 20;
    g.beginPath();
    g.arc(128, 120, 80, 0, Math.PI * 2);
    g.stroke();
    // The arrow: a shaft into a wide V, its point near the bottom of the ring
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    g.lineWidth = 22;
    g.beginPath();
    g.moveTo(128, 50);
    g.lineTo(128, 168);
    g.stroke();
    g.beginPath();
    g.moveTo(74, 118);
    g.lineTo(128, 172);
    g.lineTo(182, 118);
    g.stroke();
    g.font = 'bold 58px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('MÉTRO', 128, 274);
  });
}

/** The station's name in dark letters along the canopy's concrete edge. */
function nameTexture(name: string): THREE.Texture {
  return canvasTexture(512, 48, (g) => {
    g.fillStyle = '#b4afa6';
    g.fillRect(0, 0, 512, 48);
    g.fillStyle = '#26272b';
    let size = 34;
    g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    const text = name.toUpperCase();
    while (size > 18 && g.measureText(text).width > 470) g.font = `bold ${--size}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 26);
  });
}

/**
 * Metro entrances (PRD 4.4 dressing): a low concrete pavilion stepped out of a corner building, glass doors,
 * a heavy canopy over the sidewalk with the station's name on its edge, and the blue MÉTRO blade sign hung off
 * the canopy's corner end, square to the street so it reads from down the block. Static; no colliders (the
 * pavilion stands out of the facade less than a meter, the canopy is overhead).
 */
export function buildMetroEntrances(city: CityModel, scene: THREE.Scene): void {
  const sites = metroSites(city);
  if (!sites.length) return;
  const E = ENTRANCE;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb4afa6, roughness: 0.92, metalness: 0 });
  const under = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.95 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a33, roughness: 0.12, metalness: 0.65, emissive: 0x0a1418 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.4, metalness: 0.7 });
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture(), color: new THREE.Color(1.15, 1.15, 1.15), toneMapped: false });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.7, 1.45), toneMapped: false });
  const group = new THREE.Group();
  group.name = 'metro-entrances';
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  for (const s of sites) {
    const g = new THREE.Group();
    g.position.set(s.pos.x, s.floor, s.pos.z);
    g.rotation.y = Math.atan2(s.normal.x, s.normal.z);
    // Local +x in world: which way is the corner?
    const lx = { x: Math.cos(g.rotation.y), z: -Math.sin(g.rotation.y) };
    const side = lx.x * s.toCorner.x + lx.z * s.toCorner.z >= 0 ? 1 : -1;

    // Pavilion, a little into the building and out onto the walk
    box(E.width, E.height, E.out + 0.3, 0, E.height / 2, (E.out - 0.3) / 2, concrete, g);
    // Glass front: three doors between steel mullions, a push bar on each
    const gw = E.width - 1.4;
    const gh = 2.35;
    const front = E.out + 0.001;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), glass);
    pane.position.set(0, gh / 2 + 0.05, front);
    g.add(pane);
    for (let k = 0; k <= 3; k++) box(0.07, gh, 0.06, -gw / 2 + (k * gw) / 3, gh / 2 + 0.05, front + 0.02, steel, g);
    box(gw, 0.08, 0.06, 0, gh + 0.05, front + 0.02, steel, g);
    for (let k = 0; k < 3; k++) box(gw / 3 - 0.5, 0.04, 0.05, -gw / 2 + ((k + 0.5) * gw) / 3, 1.05, front + 0.06, steel, g);

    // Canopy: heavy concrete slab, dark underside, two lamps, the name on its street edge
    const cy = E.canopyY + E.canopyT / 2;
    const cw = E.width + 0.8;
    box(cw, E.canopyT, E.canopyOut, 0, cy, E.canopyOut / 2, concrete, g);
    const soffit = new THREE.Mesh(new THREE.PlaneGeometry(cw - 0.1, E.canopyOut - 0.1), under);
    soffit.rotation.x = Math.PI / 2;
    soffit.position.set(0, E.canopyY - 0.005, E.canopyOut / 2);
    g.add(soffit);
    for (const x of [-1.6, 1.6]) box(0.5, 0.04, 0.25, x, E.canopyY - 0.03, E.canopyOut * 0.55, lamp, g);
    const name = new THREE.Mesh(new THREE.PlaneGeometry(cw - 0.6, E.canopyT * 0.75), new THREE.MeshStandardMaterial({ map: nameTexture(s.name), roughness: 0.9 }));
    name.position.set(0, cy, E.canopyOut + 0.005);
    g.add(name);

    // Blade sign off the canopy's corner end, square to the street, a steel arm into the slab
    const sx = side * (cw / 2 + 0.85);
    const sy = E.canopyY + 0.05;
    const sz = E.canopyOut - 0.7;
    box(0.85, 0.08, 0.08, side * (cw / 2 + 0.4), E.canopyY + 0.35, sz, steel, g);
    box(0.06, 1.62, 1.32, sx, sy, sz, steel, g);
    for (const flip of [1, -1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 1.56), signMat);
      sign.position.set(sx + flip * 0.032, sy, sz);
      sign.rotation.y = (flip * Math.PI) / 2;
      g.add(sign);
    }
    group.add(g);
  }
  scene.add(group);
}
