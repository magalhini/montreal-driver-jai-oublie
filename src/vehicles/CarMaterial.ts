import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Materials: one draw call per body. A per-vertex `matId` attribute tells the
// shared paint material which surfaces are glass, chrome, matte trim or lit.
// ---------------------------------------------------------------------------

export const PAINT = 0; // uses the material's own roughness / metalness
export const GLASS = 1;
export const CHROME = 2;
export const MATTE = 3; // rubber, plastic trim, plates, wheel wells
export const GLOW = 4; // matte + faint self-illumination (lit plates, amber reflectors)
export const LAMP = 5; // matte + strong self-illumination (taxi roof sign)

/** MeshStandardMaterial that reads vertex colors plus the `matId` attribute written by CarModel. */
export function carMaterial(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ ...params, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float matId;\nvarying float vMatId;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMatId = matId;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMatId;').replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
      if (vMatId > 0.5) {
        if (vMatId < 1.5) { roughnessFactor = 0.12; metalnessFactor = 0.55; }
        else if (vMatId < 2.5) { roughnessFactor = 0.2; metalnessFactor = 1.0; }
        else { roughnessFactor = 0.75; metalnessFactor = 0.0; }
      }`,
    );
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      if (vMatId > 3.5) totalEmissiveRadiance += diffuseColor.rgb * (vMatId > 4.5 ? 2.2 : 0.55);`,
    );
  };
  m.customProgramCacheKey = () => 'car-matid';
  return m;
}

// Colors (linear)
export const rgb = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
export const GLASS_C = rgb(0.1, 0.12, 0.16);
export const CHROME_C = rgb(0.8, 0.8, 0.84);
export const BLACK = rgb(0.02, 0.02, 0.024);
export const TRIM = rgb(0.035, 0.035, 0.04);
/** SPVM stripe and badge. A flat blue, not a scanned crest (PRD 5.6). */
export const SPVM_BLUE = rgb(0.012, 0.1, 0.5);
export const WHITE = rgb(0.86, 0.86, 0.88);
export const PLATE_WHITE = rgb(0.8, 0.81, 0.76);
export const PLATE_KEI = rgb(0.85, 0.66, 0.08);
export const PLATE_TAXI = rgb(0.06, 0.24, 0.12);
export const PLATE_INK = rgb(0.05, 0.16, 0.08);
export const AMBER = rgb(0.85, 0.35, 0.03);
export const REFLECTOR = rgb(0.16, 0.012, 0.01);
export const GOLD = rgb(0.9, 0.62, 0.2);
export const TAXI_LIGHT = rgb(1, 0.72, 0.32);
export const TIRE = rgb(0.03, 0.03, 0.032);
export const DISH = rgb(0.42, 0.43, 0.46);
