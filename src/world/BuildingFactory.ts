import * as THREE from 'three';
import { Rng, hash01 } from '../core/Rng';
import type { AABB, Building, DistrictType, Facing } from '../types';
import { blinkAviation, buildBuildingDetails, buildingBase, insetFootprint, splitShaft } from './BuildingDetails';
import { frameOf, type Frame } from './BuildingFrame';
import { FRAG_BODY, FRAG_HEAD, VERT_BODY, VERT_HEAD } from './BuildingShader';
import { partFaces, subtractRect } from './Interiors';
import { LOOK } from '../render/Look';
import { snowMaterial } from './SnowCover';

const LIT: Record<DistrictType, number> = { downtown: 0.5, shotengai: 0.45, residential: 0.42, harbor: 0.25, depot: 0.6 };
/** Facade style ids used by the shader: 0 office, 1 shops, 2 warehouse, 3 apartments. Style 4 (media) is set per building. */
const STYLE: Record<DistrictType, number> = { downtown: 0, shotengai: 1, residential: 3, harbor: 2, depot: 1 };
/** A few facade families per district, so a block isn't one tint of the same concrete. */
const PALETTE: Record<DistrictType, [number, number, number][]> = {
  downtown: [
    [0.07, 0.086, 0.125],
    [0.045, 0.05, 0.068],
    [0.155, 0.13, 0.108],
    [0.12, 0.088, 0.07],
    [0.072, 0.112, 0.108],
    [0.1, 0.102, 0.118],
  ],
  shotengai: [
    [0.15, 0.09, 0.085],
    [0.11, 0.07, 0.09],
    [0.17, 0.11, 0.075],
    [0.09, 0.065, 0.08],
  ],
  residential: [
    [0.17, 0.15, 0.135],
    [0.15, 0.148, 0.145],
    [0.19, 0.155, 0.125],
    [0.14, 0.13, 0.125],
    [0.16, 0.14, 0.15],
  ],
  harbor: [[0.1, 0.12, 0.12]],
  depot: [[0.1, 0.1, 0.14]],
};
const FACE_BIT: Record<Facing, number> = { N: 1, S: 2, E: 4, W: 8 };

/** Wall finish by day (PRD 4.4): sRGB colors and the coursing the shader lays over them (0 none, 1 brick, 2 stone). */
type Finish = 'brick' | 'limestone' | 'darkStone' | 'glass' | 'metal';
const FINISH: Record<Finish, { mat: number; colors: [number, number, number][] }> = {
  brick: {
    mat: 1,
    colors: [
      [0.6, 0.31, 0.22],
      [0.53, 0.26, 0.19],
      [0.66, 0.38, 0.27],
      [0.47, 0.24, 0.19],
      [0.58, 0.35, 0.27],
    ],
  },
  limestone: {
    mat: 2,
    colors: [
      [0.72, 0.69, 0.62],
      [0.66, 0.64, 0.58],
      [0.78, 0.75, 0.68],
    ],
  },
  darkStone: {
    mat: 2,
    colors: [
      [0.36, 0.35, 0.34],
      [0.3, 0.3, 0.31],
      [0.42, 0.39, 0.35],
    ],
  },
  glass: {
    mat: 0,
    colors: [
      [0.3, 0.36, 0.42],
      [0.24, 0.29, 0.33],
      [0.36, 0.4, 0.42],
    ],
  },
  metal: {
    mat: 0,
    colors: [
      [0.46, 0.48, 0.49],
      [0.38, 0.4, 0.42],
    ],
  },
};
/** Old stone and brick downtown, orange-red brick along the side streets and in the old city, brick sheds at the port. */
const DAY_MIX: Record<DistrictType, [Finish, number][]> = {
  downtown: [
    ['limestone', 0.5],
    ['darkStone', 0.25],
    ['brick', 0.25],
  ],
  shotengai: [
    ['brick', 0.55],
    ['limestone', 0.35],
    ['darkStone', 0.1],
  ],
  residential: [
    ['brick', 0.72],
    ['limestone', 0.18],
    ['darkStone', 0.1],
  ],
  // Warehouses along the canal and the port: orange-red brick, some grey stone (PRD Phase 5)
  harbor: [
    ['brick', 0.78],
    ['darkStone', 0.12],
    ['limestone', 0.1],
  ],
  depot: [
    ['darkStone', 0.6],
    ['metal', 0.4],
  ],
};
/** Downtown walls above this (m over the ground floor) are curtain-wall glass; podiums and lower blocks are stone. */
const GLASS_MIN_HEIGHT = 45;

function pickFinish(district: DistrictType, h: number): Finish {
  let acc = 0;
  for (const [f, w] of DAY_MIX[district]) if (h < (acc += w)) return f;
  return DAY_MIX[district][0][0];
}

/** Snow cap on every roof, a little proud of the walls so the white lip reads from the street. */
const SNOW_CAP = { thickness: 0.22, overhang: 0.06 };

/** Podium, stepped shaft, and (for a notch) twin slabs with a crown bridge. */
function addTowerParts(parts: Part[], b: Building, frame: Frame | undefined, box: AABB, baseBottom: number, ground: number): void {
  const t = b.tower!;
  const push = (rect: AABB, y0: number, y1: number, sunk: number) => {
    if (y1 - y0 < 0.8 || rect.maxX - rect.minX < 1.5 || rect.maxZ - rect.minZ < 1.5) return;
    parts.push({ b, frame, minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ, y0, y1, sunk });
  };
  push(box, baseBottom, ground + t.podium, ground - baseBottom);
  const steps = [...(t.steps ?? [])].filter((s) => s.at > t.podium + 4 && s.at < b.height - 4).sort((a, c) => a.at - c.at);
  const tiers: { inset: number; y0: number; y1: number }[] = [];
  let inset = t.inset;
  let y0 = t.podium;
  for (const s of steps) {
    tiers.push({ inset, y0, y1: s.at });
    inset += s.inset;
    y0 = s.at;
  }
  tiers.push({ inset, y0, y1: b.height });
  tiers.forEach((tier, idx) => {
    const rect = insetFootprint(box, tier.inset);
    const split = t.notch ? splitShaft(rect, t.notch) : { slabs: [rect], slot: null };
    for (const s of split.slabs) push(s, ground + tier.y0, ground + tier.y1, -tier.y0);
    const slot = split.slot;
    if (slot && idx === tiers.length - 1 && tier.y1 - tier.y0 > 8) {
      const bh = Math.min(6.5, (tier.y1 - tier.y0) * 0.2);
      const alongX = slot.maxX - slot.minX < slot.maxZ - slot.minZ;
      const bridge = alongX
        ? { ...slot, minX: slot.minX + 0.06, maxX: slot.maxX - 0.06 }
        : { ...slot, minZ: slot.minZ + 0.06, maxZ: slot.maxZ - 0.06 };
      push(bridge, ground + tier.y1 - bh, ground + tier.y1, -(tier.y1 - bh));
    }
  });
}

export interface BuildingSet {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  update(time: number): void;
}

/** A box part of a building (towers have a podium and a slimmer shaft). */
interface Part {
  b: Building;
  /** Rotated buildings (T39): the part's min / max are in this local frame. */
  frame?: Frame;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y0: number;
  y1: number;
  /** Meters of this part below the building's ground floor (windows start at the ground floor). */
  sunk: number;
  /** Street faces of this part (default: the building's). */
  faces?: Facing[];
}

export function buildBuildings(all: Building[], scene: THREE.Scene): BuildingSet {
  // Landmarks with their own meshes (`LandmarkView`) are only colliders here
  const buildings = all.filter((b) => !b.custom);
  const parts: Part[] = [];
  for (const b of buildings) {
    const base = buildingBase(b);
    const ground = base.floor;
    if (b.cavity) {
      // Garage on the ground floor: the floors above span it, the rest of the ground floor wraps around it
      const top = b.cavity.floor + b.cavity.height;
      parts.push({ b, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, y0: top, y1: ground + b.height, sunk: ground - top });
      for (const r of subtractRect(b, b.cavity.box)) {
        parts.push({ b, minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, y0: base.bottom, y1: top, sunk: ground - base.bottom, faces: partFaces(b, r, 2.5) });
      }
    } else {
      // Rotated buildings are laid out in their local frame (cavities are axis-aligned only: sites use rect blocks)
      const frame = b.obb ? frameOf(b) : undefined;
      const box = frame ? { minX: -frame.hx, maxX: frame.hx, minZ: -frame.hz, maxZ: frame.hz } : b;
      if (b.tower) {
        addTowerParts(parts, b, frame, box, base.bottom, ground);
      } else {
        parts.push({ b, frame, minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ, y0: base.bottom, y1: ground + b.height, sunk: ground - base.bottom });
      }
    }
  }

  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const params = new Float32Array(parts.length * 4);
  const extra = new Float32Array(parts.length * 2);
  const mats = new Float32Array(parts.length);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.08 });
  const uTime = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uDay = { value: LOOK.day ? 1 : 0 };
    shader.uniforms.uWindows = { value: LOOK.windows };
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <project_vertex>', VERT_BODY);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace('#include <emissivemap_fragment>', FRAG_BODY);
  };
  const mesh = new THREE.InstancedMesh(geo, material, parts.length);
  const m = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  const c = new THREE.Color();
  const rng = new Rng(99);
  const tint = new Map<Building, [number, number]>();
  parts.forEach((p, i) => {
    const b = p.b;
    let t = tint.get(b);
    if (!t) {
      t = [rng.range(0.75, 1.35), rng.range(0.7, 1.25)];
      tint.set(b, t);
    }
    if (p.frame) {
      const at = p.frame.at((p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2);
      m.makeRotationY(p.frame.yaw).scale(sc.set(p.maxX - p.minX, p.y1 - p.y0, p.maxZ - p.minZ));
      m.setPosition(at.x, p.y0, at.z);
    } else {
      m.makeScale(p.maxX - p.minX, p.y1 - p.y0, p.maxZ - p.minZ);
      m.setPosition((p.minX + p.maxX) / 2, p.y0, (p.minZ + p.maxZ) / 2);
    }
    mesh.setMatrixAt(i, m);
    const look = b.facade;
    const floor = buildingBase(b).floor;
    const podium = !!(b.tower && p.y1 <= floor + b.tower.podium + 0.08);
    const retail = !!(b.scramble && podium);
    // Office curtain-wall rhythm (0 wide grid, 1 broader bays, 2 vertical strips, 3 deep spandrels)
    let rhythm = !look && b.district === 'downtown' ? Math.floor(hash01(b.seed, 8) * 4) : 0;
    let style = look?.style ?? STYLE[b.district];
    if (LOOK.day) {
      // Winter afternoon: walls are brick and stone; glass only on the tall downtown shafts. The media blocks'
      // billboard bands are a night look: by day they are plain glass towers.
      const glass = b.district === 'downtown' && !podium && (b.height >= GLASS_MIN_HEIGHT || !!b.scramble);
      const finish = FINISH[glass ? 'glass' : pickFinish(b.district, hash01(b.seed, 21))];
      const base = finish.colors[Math.floor(hash01(b.seed, 3) * finish.colors.length)];
      const k = 1 + (t[0] - 1.05) * 0.3;
      c.setRGB(base[0] * k, base[1] * k, base[2] * k, THREE.SRGBColorSpace);
      mats[i] = finish.mat;
      if (style === 4) style = 0;
      // Stone offices get punched windows, glass ones the strips and spandrels
      if (b.district === 'downtown' && !look) rhythm = glass ? 2 + (rhythm % 2) : rhythm % 2;
      if (b.scramble) rhythm = 2;
    } else {
      const pal = PALETTE[b.district];
      const base = retail ? [0.09, 0.055, 0.06] : (look?.color ?? pal[Math.floor(hash01(b.seed, 3) * pal.length)]);
      const k = look ? 1 : t[0];
      c.setRGB(base[0] * k, base[1] * k, base[2] * k);
    }
    mesh.setColorAt(i, c);
    params[i * 4] = retail ? 0.92 : look ? look.lit : LIT[b.district] * t[1];
    params[i * 4 + 1] = style;
    params[i * 4 + 2] = (b.seed % 1000) * 0.137;
    params[i * 4 + 3] = rhythm;
    extra[i * 2] = p.sunk;
    // Interior and skyline buildings have no street faces: give them all four
    extra[i * 2 + 1] = b.faces.length === 0 ? 15 : (p.faces ?? b.faces).reduce((s, f) => s + FACE_BIT[f], 0);
  });
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  geo.setAttribute('aExtra', new THREE.InstancedBufferAttribute(extra, 2));
  geo.setAttribute('aMat', new THREE.InstancedBufferAttribute(mats, 1));
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  if (LOOK.day) scene.add(snowCaps(parts));

  buildBuildingDetails(buildings, scene);

  return {
    mesh,
    material,
    update(time: number) {
      uTime.value = time;
      blinkAviation(time);
    },
  };
}

/** A thin white slab on top of every building part (towers: the podium roof and each setback too). */
function snowCaps(parts: Part[]): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const caps = new THREE.InstancedMesh(geo, snowMaterial(), parts.length);
  const m = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  const o = SNOW_CAP.overhang * 2;
  parts.forEach((p, i) => {
    sc.set(p.maxX - p.minX + o, SNOW_CAP.thickness, p.maxZ - p.minZ + o);
    if (p.frame) {
      const at = p.frame.at((p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2);
      m.makeRotationY(p.frame.yaw).scale(sc);
      m.setPosition(at.x, p.y1 - 0.02, at.z);
    } else {
      m.makeScale(sc.x, sc.y, sc.z);
      m.setPosition((p.minX + p.maxX) / 2, p.y1 - 0.02, (p.minZ + p.maxZ) / 2);
    }
    caps.setMatrixAt(i, m);
  });
  caps.instanceMatrix.needsUpdate = true;
  return caps;
}
