import * as THREE from "three";
import type { CityModel } from "./RoadGraph";
import { buildingBase } from "./BuildingDetails";
import { frameOf } from "./BuildingFrame";
import { openingTop } from "./Interiors";
import { hasMetro } from "./MetroEntrances";
import type { Building, Facing } from "../types";

/**
 * Storefront boards (PRD 11B): IGA, Provigo, Starbucks, Tim Hortons, and a poutine counter.
 * Words and flat colors, not traced logos. One board on some street faces in the old city,
 * downtown, and the side streets.
 */

const FONT = '"Arial Black", "Arial Bold", Arial, sans-serif';

interface Brand {
  id: string;
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

const fill = (
  g: CanvasRenderingContext2D,
  color: string,
  w: number,
  h: number,
) => {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
};

const label = (
  g: CanvasRenderingContext2D,
  text: string,
  color: string,
  w: number,
  y: number,
  size: number,
) => {
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let s = size;
  g.font = `700 ${s}px ${FONT}`;
  while (g.measureText(text).width > w * 0.86 && s > 18)
    g.font = `700 ${(s -= 4)}px ${FONT}`;
  g.fillText(text, w / 2, y);
};

const BRANDS: Brand[] = [
  {
    id: "iga",
    draw: (g, w, h) => {
      fill(g, "#e10600", w, h);
      g.fillStyle = "#fff";
      g.fillRect(18, 18, w - 36, h - 36);
      label(g, "IGA", "#e10600", w, h * 0.52, h * 0.62);
    },
  },
  {
    id: "provigo",
    draw: (g, w, h) => {
      fill(g, "#f5c518", w, h);
      g.fillStyle = "#c8102e";
      g.fillRect(0, 0, w, 14);
      g.fillRect(0, h - 14, w, 14);
      label(g, "Provigo", "#c8102e", w, h * 0.54, h * 0.5);
    },
  },
  {
    id: "starbucks",
    draw: (g, w, h) => {
      fill(g, "#00704a", w, h);
      g.strokeStyle = "#fff";
      g.lineWidth = 8;
      g.strokeRect(16, 16, w - 32, h - 32);
      label(g, "STARBUCKS", "#ffffff", w, h * 0.52, h * 0.42);
    },
  },
  {
    id: "bagels",
    draw: (g, w, h) => {
      fill(g, "#f5c518", w, h);
      g.strokeStyle = "#fff";
      g.lineWidth = 8;
      g.strokeRect(16, 16, w - 32, h - 32);
      label(g, "BAGELS", "#ffffff", w, h * 0.52, h * 0.42);
    },
  },
  {
    id: "quebecor",
    draw: (g, w, h) => {
      fill(g, "#4169E1", w, h);
      g.strokeStyle = "#fff";
      g.lineWidth = 8;
      g.strokeRect(16, 16, w - 32, h - 32);
      label(g, "QUEBECOR", "#ffffff", w, h * 0.52, h * 0.42);
    },
  },
  {
    id: "tims",
    draw: (g, w, h) => {
      fill(g, "#c8102e", w, h);
      g.fillStyle = "#fff";
      g.fillRect(0, h * 0.62, w, h * 0.38);
      label(g, "TIM", "#ffffff", w, h * 0.34, h * 0.4);
      label(g, "HORTONS", "#c8102e", w, h * 0.8, h * 0.28);
    },
  },
  {
    id: "aircanada",
    draw: (g, w, h) => {
      fill(g, "#c8102e", w, h);
      g.fillStyle = "#fff";
      g.fillRect(0, h * 0.62, w, h * 0.38);
      label(g, "AIR", "#ffffff", w, h * 0.34, h * 0.4);
      label(g, "CANADA", "#c8102e", w, h * 0.8, h * 0.28);
    },
  },
  {
    id: "poutine",
    draw: (g, w, h) => {
      fill(g, "#1c140c", w, h);
      g.fillStyle = "#f0b429";
      g.fillRect(0, 0, 16, h);
      g.fillRect(w - 16, 0, 16, h);
      label(g, "POUTINE", "#f0b429", w, h * 0.46, h * 0.46);
      label(g, "CHAUD", "#f4efe6", w, h * 0.78, h * 0.2);
    },
  },
];

function texture(brand: Brand): THREE.CanvasTexture {
  const w = 1024;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  brand.draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function hash(n: number): number {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

const RATE: Partial<Record<Building["district"], number>> = {
  oldtown: 0.55,
  downtown: 0.32,
  residential: 0.14,
};

/** Hang the boards. Static meshes; the city tiler picks them up with the rest of the block. */
export function buildShopSigns(city: CityModel, scene: THREE.Scene): void {
  const geo = new THREE.PlaneGeometry(1, 1);
  const maps = BRANDS.map(texture);
  // A little self-light so a red board still reads under the flat winter sky, without glowing like neon.
  const mats = maps.map(
    (map) =>
      new THREE.MeshStandardMaterial({
        map,
        roughness: 0.62,
        metalness: 0.02,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: map,
        emissiveIntensity: 0.18,
      }),
  );
  const group = new THREE.Group();
  group.name = "shop-signs";

  for (const b of city.buildings) {
    const rate = RATE[b.district];
    if (!rate || b.landmark || b.custom || b.height < 6) continue;
    const frame = frameOf(b);
    const floor = buildingBase(b).floor;
    for (const f of b.faces) {
      const face = frame.faceOf(f);
      if (face.width < 7 || hasMetro(city, b, f as Facing)) continue;
      const roll = hash(b.seed * 19.7 + f.charCodeAt(0) * 13.1);
      if (roll > rate) continue;
      const brand = Math.floor(
        hash(b.seed * 3.1 + f.charCodeAt(0) * 9.4) * BRANDS.length,
      );
      const width = Math.min(5.6, Math.max(3.1, face.width * 0.46));
      const height = 0.78;
      const room = Math.max(0, face.width - width - 0.8);
      const slide = (hash(b.seed * 7.2 + f.charCodeAt(0)) - 0.5) * room;
      const out = 0.07;
      const x = face.center.x + face.along.x * slide + face.normal.x * out;
      const z = face.center.z + face.along.z * slide + face.normal.z * out;
      const span = f === "N" || f === "S";
      const s0 = (span ? x : z) - width / 2;
      if (openingTop(b, f as Facing, s0, s0 + width) !== null) continue;
      const mesh = new THREE.Mesh(geo, mats[brand]);
      mesh.scale.set(width, height, 1);
      mesh.position.set(x, floor + 2.72, z);
      mesh.rotation.y = Math.atan2(face.normal.x, face.normal.z);
      group.add(mesh);
    }
  }
  scene.add(group);
}
