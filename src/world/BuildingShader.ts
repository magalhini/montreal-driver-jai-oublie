/**
 * Facade shader chunks for the building instances (`BuildingFactory`). Windows, shopfronts and doors come
 * from object-space coordinates (`position`, `objectNormal`, instance scale), so they follow a rotated
 * instance (T39); only the roof grime reads world xz.
 *
 * `uDay` (0 night, 1 the winter afternoon) turns most windows into dark glass that reflects the sky, drops
 * the Japanese shop dressing (glyph sign bands, noren), and `uWindows` scales everything the facades emit.
 * `aMat` lays brick (1) or dressed stone (2) coursing over the wall color.
 */
export const VERT_HEAD = /* glsl */ `
attribute vec4 aParams;
attribute vec2 aExtra;
attribute float aMat;
varying float vMat;
varying vec3 vWP;
varying vec3 vObjN;
varying vec3 vFac;
varying vec4 vParams;
varying float vFront;
`;
export const VERT_BODY = /* glsl */ `
#include <project_vertex>
{
  vec4 wpN = vec4(transformed, 1.0);
  vec3 sc = vec3(1.0);
  #ifdef USE_INSTANCING
  wpN = instanceMatrix * wpN;
  sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  #endif
  wpN = modelMatrix * wpN;
  vWP = wpN.xyz;
  vObjN = objectNormal;
  bool sideX = abs(objectNormal.x) > 0.5;
  // Facade coordinates: u along the facade (m), v up from the ground floor (m), facade length
  vFac = vec3(sideX ? (position.z + 0.5) * sc.z : (position.x + 0.5) * sc.x, position.y * sc.y - aExtra.x, sideX ? sc.z : sc.x);
  vParams = aParams;
  vMat = aMat;
  // Street-facing facade? (bit mask N=1 S=2 E=4 W=8)
  float bit = sideX ? (objectNormal.x > 0.0 ? 4.0 : 8.0) : (objectNormal.z > 0.0 ? 2.0 : 1.0);
  vFront = mod(floor(aExtra.y / bit), 2.0);
}
`;
export const FRAG_HEAD = /* glsl */ `
varying vec3 vWP;
varying vec3 vObjN;
varying vec3 vFac;
varying vec4 vParams;
varying float vFront;
varying float vMat;
uniform float uTime;
uniform float uDay;
uniform float uWindows;
float bh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Living windows: about one in eight flips on / off now and then, each on its own slow clock
float alive(float on, vec2 cell, float seed) {
  float h = bh(cell * 1.31 + seed * 2.7);
  if (h > 0.125) return on;
  float period = 40.0 + 140.0 * bh(cell + seed * 5.3);
  float epoch = floor((uTime + h * 977.0) / period);
  return step(0.5, bh(vec2(epoch, h * 113.0)));
}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), f.x), mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Anti-aliased box inside a cell; fw = screen derivative of the continuous cell coordinate
float cellBox(vec2 f, vec2 lo, vec2 hi, vec2 fw) {
  vec2 a = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
  return a.x * a.y;
}
// By day most rooms are dark behind the glass: keep about one window in six lit
float dayOn(float on, vec2 cell, float seed) {
  return mix(on, on * step(0.83, bh(cell * 0.71 + seed * 1.9)), uDay);
}
// Brick (vMat 1, half-bond, ~24 x 7.7 cm) or dressed stone (vMat 2, ashlar courses) over the wall color.
// Joints fade to the average tone where they would shimmer.
vec3 masonry(vec3 col, float u, float v, float seed) {
  if (vMat < 0.5) return col;
  bool brick = vMat < 1.5;
  vec2 size = brick ? vec2(0.24, 0.077) : vec2(1.15, 0.56);
  float row = v / size.y;
  float rid = floor(row);
  float x = u / size.x + 0.5 * mod(rid, 2.0);
  vec2 g = vec2(x, row);
  vec2 fw = fwidth(g);
  float far = smoothstep(0.22, 0.55, max(fw.x, fw.y));
  vec2 j = brick ? vec2(0.045, 0.13) : vec2(0.012, 0.025);
  float joint = 1.0 - cellBox(fract(g), j, 1.0 - j, fw);
  float unit = bh(vec2(floor(x), rid) + seed);
  vec3 face = col * (brick ? 0.8 + 0.4 * unit : 0.93 + 0.14 * unit);
  vec3 mortar = brick ? vec3(0.2, 0.19, 0.175) : col * 0.7;
  return mix(mix(face, mortar, joint), mix(col, mortar, brick ? 0.15 : 0.04), far);
}
vec3 homeLight(float h) {
  if (h < 0.55) return vec3(1.0, 0.66, 0.36);
  if (h < 0.75) return vec3(1.0, 0.8, 0.55);
  if (h < 0.87) return vec3(0.75, 0.85, 1.0);
  if (h < 0.94) return vec3(1.0, 0.45, 0.6);
  return vec3(0.55, 1.0, 0.75);
}
vec3 shopLight(float h) {
  if (h < 0.3) return vec3(1.0, 0.9, 0.75);
  if (h < 0.5) return vec3(1.0, 0.55, 0.3);
  if (h < 0.65) return vec3(0.6, 0.85, 1.0);
  if (h < 0.8) return vec3(1.0, 0.4, 0.75);
  if (h < 0.9) return vec3(0.4, 1.0, 0.9);
  return vec3(1.0, 0.95, 0.5);
}
`;
export const FRAG_BODY = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 n = normalize(vObjN);
  float litP = vParams.x;
  float style = vParams.y;
  float seed = vParams.z;
  vec3 emit = vec3(0.0);
  float glass = 0.0;
  if (abs(n.y) < 0.5) {
    float u = vFac.x;
    float v = vFac.y;
    float L = vFac.z;
    // Weathered concrete / panels, darker toward the street
    float grime = 0.8 + 0.3 * vnoise(vec2(u * 0.3 + seed, v * 0.09)) + 0.08 * vnoise(vec2(u * 2.1, v * 1.7));
    diffuseColor.rgb *= grime * mix(0.7, 1.0, smoothstep(0.0, 7.0, v));
    diffuseColor.rgb = masonry(diffuseColor.rgb, u, v, seed);
    vec3 dark = vec3(0.012, 0.016, 0.026);

    if (style < 0.5) {
      // Office tower: curtain wall, whole floors lit. vParams.w picks the bay rhythm.
      float var = floor(vParams.w + 0.5);
      float bayM = var < 0.5 ? 1.9 : var < 1.5 ? 2.75 : var < 2.5 ? 1.28 : 2.15;
      float floorH = var > 2.5 ? 4.65 : var > 1.5 ? 3.3 : 3.7;
      float cw = L / max(1.0, floor(L / bayM + 0.5));
      float gf = 4.6;
      if (v < gf) {
        // Lobby: tall glass bays between dark mullions, a frosted transom, a stone fascia with a lit reveal.
        // Inside (faked): downlights, a bright ceiling, reception desks and planters as silhouettes.
        float bay = cw * 2.0;
        float gx = u / bay;
        float fx = fract(gx);
        float bayId = floor(gx);
        vec2 fw = vec2(fwidth(gx), fwidth(v));
        float glassA = cellBox(vec2(fx, v), vec2(0.035, 0.1), vec2(0.965, 3.5), fw);
        float transom = cellBox(vec2(fx, v), vec2(0.035, 3.62), vec2(0.965, 4.0), fw);
        float reveal = vFront * (smoothstep(4.24, 4.27, v) - smoothstep(4.31, 4.34, v));
        float lit = step(0.22, bh(vec2(bayId, seed)));
        vec3 lobby = mix(vec3(1.0, 0.84, 0.62), vec3(0.82, 0.9, 1.0), step(0.72, bh(vec2(seed, 3.0))));
        float spot = 1.0 - smoothstep(0.0, 0.55, length(vec2((fract(u / 2.4) - 0.5) * 2.4, (v - 3.35) * 2.2)));
        float pool = 1.0 - smoothstep(0.0, 0.9, length(vec2((fract(u / 2.4) - 0.5) * 2.4, (v - 0.2) * 3.0)));
        float shade = 0.018 + 0.06 * smoothstep(0.6, 3.4, v) + 0.5 * spot * spot + 0.07 * pool;
        float dx = fract(u / 7.0);
        float desk = cellBox(vec2(dx, v), vec2(0.32, 0.0), vec2(0.68, 1.05), vec2(fwidth(u / 7.0), fw.y)) * step(0.55, bh(vec2(floor(u / 7.0), seed + 2.0)));
        float plant = (1.0 - smoothstep(0.75, 1.0, length(vec2((fx - 0.12) * bay / 0.42, (v - 1.0) / 0.95)))) * step(0.6, bh(vec2(bayId, seed + 7.0)));
        float nb = max(1.0, floor(L / bay + 0.5));
        float isDoor = vFront * (1.0 - step(0.5, abs(bayId - floor(nb * 0.5))));
        float split = isDoor * (1.0 - step(0.02, abs(fx - 0.5))) * step(v, 2.7);
        float head = isDoor * cellBox(vec2(fx, v), vec2(0.0, 2.68), vec2(1.0, 2.76), fw);
        float bar = isDoor * cellBox(vec2(abs(fx - 0.5), v), vec2(0.06, 1.0), vec2(0.36, 1.05), fw);
        vec3 inside = lobby * shade * (1.0 - desk * 0.88) * (1.0 - plant * 0.85);
        emit += glassA * lit * inside * (1.0 - split) * (1.0 - head) * (1.0 - bar * 0.9);
        emit += transom * lit * lobby * 0.16;
        emit += reveal * lobby * 0.9;
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.45, dark, max(glassA, transom));
        glass = max(glassA, transom);
      } else {
        vec2 g = vec2(u / cw, (v - gf) / floorH);
        vec2 fw = fwidth(g);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float far = smoothstep(0.2, 0.55, max(fw.x, fw.y));
        // var 0/1: the original punched window. 2: tall strips. 3: a deep horizontal spandrel.
        vec2 glo = var > 2.5 ? vec2(0.04, 0.42) : var > 1.5 ? vec2(0.22, 0.08) : vec2(0.06, 0.27);
        vec2 ghi = var > 2.5 ? vec2(0.96, 0.9) : var > 1.5 ? vec2(0.78, 0.97) : vec2(0.94, 0.95);
        float w = mix(cellBox(f, glo, ghi, fw), var > 2.5 ? 0.48 : 0.62, far);
        float fl = bh(vec2(cell.y, seed * 1.37));
        float floorOn = step(1.0 - litP * 0.6, fl);
        float h = bh(cell + seed);
        float on = floorOn > 0.5 ? step(0.15, h) : step(1.0 - litP * 0.25, h);
        on = mix(dayOn(alive(on, cell, seed), cell, seed), litP * mix(0.6, 0.1, uDay), far);
        float hue = bh(vec2(cell.y * 3.1, seed));
        vec3 lc = hue < 0.45 ? vec3(0.62, 0.78, 1.0) : hue < 0.8 ? vec3(1.0, 0.8, 0.55) : vec3(0.7, 1.0, 0.8);
        // Ceiling-lit rooms: bright top, desks and partitions darken the lower part
        float grad = 0.35 + 0.55 * smoothstep(0.35, 0.95, f.y);
        float desks = (1.0 - far) * (1.0 - smoothstep(0.5, 0.56, f.y)) * step(0.45, bh(vec2(floor(u / 0.9), cell.y + seed)));
        float strip = cellBox(f, vec2(0.06, 0.88), vec2(0.94, 0.92), fw) * (1.0 - far);
        float flick = 0.92 + 0.08 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
        emit += w * on * lc * (0.34 * grad * (1.0 - desks * 0.7) + strip * 0.45) * flick;
        float spandrel = (1.0 - far) * (1.0 - w) * (1.0 - step(glo.y, f.y));
        diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 + spandrel * 0.5), dark, w * (1.0 - on));
        glass = w * (1.0 - on * 0.6);
      }
    } else if (style < 1.5) {
      // Shotengai shops: shopfronts / shutters at street level, small lit windows above
      if (v < 3.3) {
        if (vFront > 0.5) {
          float sw = L / max(1.0, floor(L / 4.5 + 0.5));
          vec2 g = vec2(u / sw, v / 3.3);
          vec2 fw = fwidth(g);
          vec2 f = fract(g);
          float h = bh(vec2(floor(g.x), seed));
          float front = cellBox(f, vec2(0.04, 0.03), vec2(0.96, 0.84), fw);
          if (h > 0.22) {
            vec3 sc = mix(shopLight(bh(vec2(floor(g.x) * 1.7, seed))), vec3(1.0, 0.92, 0.8), 0.35);
            // Interior: shelves and goods, a door with a frame on one side
            float shelves = step(0.3, v) * step(v, 2.0) * (0.75 + 0.25 * smoothstep(0.2, 0.5, abs(fract(v / 0.45) - 0.5)));
            float goods = 0.8 + 0.2 * vnoise(vec2(u * 3.0, v * 2.2));
            float doorX = bh(vec2(floor(g.x), seed + 9.0)) < 0.5 ? 0.22 : 0.78;
            float door = 1.0 - step(0.13, abs(f.x - doorX));
            float frame = (1.0 - step(0.012, abs(abs(f.x - doorX) - 0.13))) * step(f.y, 0.8);
            float inner = (0.5 + 0.5 * f.y) * mix(1.0, shelves * goods, 1.0 - door);
            // Noren over some doors: dyed cloth in strips, glowing from the shop light behind
            float hasNoren = step(0.62, bh(vec2(floor(g.x), seed + 4.0))) * (1.0 - uDay);
            float noren = hasNoren * door * step(0.52, f.y) * step(f.y, 0.83) * step(fract((f.x - doorX) * sw / 0.32 + 0.5), 0.9);
            vec3 cloth = bh(vec2(floor(g.x), seed + 6.0)) < 0.5 ? vec3(0.08, 0.12, 0.45) : vec3(0.6, 0.06, 0.06);
            emit += front * sc * 0.22 * inner * (1.0 - frame * 0.8) * (1.0 - noren);
            emit += noren * (cloth * 0.6 + sc * 0.05);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05), front);
            glass = front * 0.4 * (1.0 - noren);
            // Lit sign band (kanban) above the shopfront: the shop's color, a row of light glyphs in the middle
            float band = cellBox(f, vec2(0.02, 0.865), vec2(0.98, 0.985), fw);
            vec3 kc = shopLight(bh(vec2(floor(g.x) * 3.3, seed + 1.0)));
            float gc = f.x * sw / 0.4;
            float glyph = step(0.3, bh(vec2(floor(gc), floor(g.x) + seed))) * cellBox(vec2(fract(gc), (f.y - 0.865) / 0.12), vec2(0.14, 0.2), vec2(0.86, 0.82), vec2(fwidth(gc), fw.y / 0.12));
            float text = step(0.22, f.x) * step(f.x, 0.78);
            // By day the band is a painted fascia: no lit glyphs
            emit += band * (kc * 0.22 + glyph * text * mix(vec3(1.0), kc, 0.3) * 0.55 * (1.0 - uDay));
            diffuseColor.rgb = mix(diffuseColor.rgb, kc * mix(0.2, 0.32, uDay), band);
          } else {
            float rib = 0.75 + 0.25 * sin(v * 52.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.23, 0.25) * rib, front);
            roughnessFactor = mix(roughnessFactor, 0.45, front);
            metalnessFactor = mix(metalnessFactor, 0.6, front);
          }
          diffuseColor.rgb *= 1.0 - 0.6 * cellBox(f, vec2(0.0, 0.86), vec2(1.0, 1.0), fw);
        } else {
          diffuseColor.rgb *= 0.65;
        }
      } else {
        float cw = L / max(1.0, floor(L / 2.4 + 0.5));
        vec2 g = vec2(u / cw, (v - 3.3) / 3.0);
        vec2 fw = fwidth(g);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float w = vFront > 0.5 ? cellBox(f, vec2(0.14, 0.3), vec2(0.86, 0.85), fw) : cellBox(f, vec2(0.32, 0.4), vec2(0.68, 0.8), fw);
        float h = bh(cell + seed);
        float on = dayOn(alive(step(1.0 - litP, h), cell, seed), cell, seed);
        float mull = (1.0 - step(0.015, abs(f.x - 0.5))) + (1.0 - step(0.015, abs(f.y - 0.68)));
        vec3 lc = mix(shopLight(bh(cell.yx * 1.3 + seed)), vec3(1.0, 0.75, 0.5), 0.5);
        emit += w * on * lc * (0.16 + 0.2 * f.y) * (1.0 - min(1.0, mull));
        diffuseColor.rgb = mix(diffuseColor.rgb, dark, w * (1.0 - on));
        glass = w * (1.0 - on);
      }
    } else if (style < 2.5) {
      // Harbor warehouse: corrugated walls, roller doors, high sodium-lit strip windows
      float rib = vMat > 0.5 ? 0.0 : sin(u * 6.2832 / 0.42);
      diffuseColor.rgb *= 0.86 + 0.14 * rib;
      roughnessFactor = mix(roughnessFactor, 0.5, 0.5 + 0.5 * rib);
      float dw = L / max(1.0, floor(L / 13.0 + 0.5));
      vec2 g = vec2(u / dw, v);
      vec2 fw = fwidth(g);
      vec2 f = vec2(fract(g.x), v);
      float door = vFront * cellBox(f, vec2(0.3, -1.0), vec2(0.7, 4.6), fw);
      float slat = 0.8 + 0.2 * sin(v * 40.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.22, 0.24) * slat, door);
      float lamp = vFront * cellBox(f, vec2(0.47, 4.9), vec2(0.53, 5.15), fw);
      emit += lamp * vec3(1.0, 0.6, 0.25) * 3.0;
      float sh = bh(vec2(floor(u / 3.0), seed));
      float strip = cellBox(vec2(fract(u / 3.0), v), vec2(0.1, 6.2), vec2(0.9, 7.0), vec2(fwidth(u / 3.0), fwidth(v)));
      emit += strip * step(1.0 - litP, sh) * vec3(1.0, 0.62, 0.28) * 0.6;
      diffuseColor.rgb = mix(diffuseColor.rgb, dark, strip);
    } else if (style < 3.5) {
      // Apartments ("mansion"): balcony doors on street faces, small windows on the sides
      float gf = 3.2;
      if (v < gf) {
        // Street level, per ~6 m bay: a lit entrance hall, a garage shutter or a frosted window
        float sw = L / max(1.0, floor(L / 6.0 + 0.5));
        float cid = floor(u / sw);
        vec2 fm = vec2(fract(u / sw) * sw, v);
        vec2 fwm = vec2(fwidth(u), fwidth(v));
        float kind = bh(vec2(cid, seed + 5.0));
        float c = sw * 0.5;
        diffuseColor.rgb *= 0.75;
        if (vFront > 0.5 && kind < 0.42) {
          float door = cellBox(fm, vec2(c - 0.95, 0.02), vec2(c + 0.95, 2.4), fwm);
          float sideW = cellBox(fm, vec2(c + 1.15, 0.85), vec2(c + 2.1, 2.3), fwm);
          float split = 1.0 - step(0.025, abs(fm.x - c));
          vec2 mb = vec2((fm.x - c - 1.15) / 0.19, (v - 0.85) / 0.16);
          float boxes = sideW * cellBox(fract(mb), vec2(0.1, 0.12), vec2(0.9, 0.88), fwidth(mb));
          vec3 warm = vec3(1.0, 0.84, 0.62);
          float hall = 0.05 + 0.15 * smoothstep(0.0, 2.4, v) + 0.25 * (1.0 - smoothstep(0.0, 0.7, length(vec2(fm.x - c, (v - 2.35) * 2.0))));
          emit += door * warm * hall * (1.0 - split);
          emit += sideW * warm * (0.03 + 0.08 * (1.0 - boxes));
          float plate = cellBox(fm, vec2(c - 0.55, 2.62), vec2(c + 0.55, 2.86), fwm);
          emit += plate * vec3(0.9, 0.95, 1.0) * 0.45;
          diffuseColor.rgb = mix(diffuseColor.rgb, dark, max(door, sideW));
          glass = door;
        } else if (vFront > 0.5 && kind < 0.66) {
          float sh = cellBox(fm, vec2(0.45, 0.0), vec2(sw - 0.45, 2.5), fwm);
          float rib = 0.78 + 0.22 * sin(v * 48.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.21, 0.23) * rib, sh);
          metalnessFactor = mix(metalnessFactor, 0.55, sh);
          roughnessFactor = mix(roughnessFactor, 0.45, sh);
        } else {
          float win = cellBox(fm, vec2(c - 0.8, 1.25), vec2(c + 0.8, 2.25), fwm);
          float on = dayOn(step(0.45, bh(vec2(cid, seed + 8.0))), vec2(cid, 1.0), seed);
          float bars = vFront * (1.0 - step(0.03, abs(fract((fm.x - c) / 0.2) - 0.5) - 0.44));
          emit += win * on * homeLight(bh(vec2(cid, seed))) * 0.09 * (1.0 - bars * 0.7);
          diffuseColor.rgb = mix(diffuseColor.rgb, dark, win * (1.0 - on));
        }
      } else {
        float cw = L / max(1.0, floor(L / 3.4 + 0.5));
        vec2 g = vec2(u / cw, (v - gf) / 2.9);
        vec2 fw = fwidth(g);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float far = smoothstep(0.2, 0.55, max(fw.x, fw.y));
        float w = vFront > 0.5 ? cellBox(f, vec2(0.1, 0.06), vec2(0.9, 0.86), fw) : cellBox(f, vec2(0.34, 0.42), vec2(0.66, 0.82), fw);
        w = mix(w, vFront > 0.5 ? 0.55 : 0.12, far);
        float h = bh(cell + seed);
        float on = mix(dayOn(alive(step(1.0 - litP, h), cell, seed), cell, seed), litP * mix(0.5, 0.08, uDay), far);
        vec3 lc = homeLight(bh(cell.yx * 1.7 + seed * 0.37));
        // Curtains (most windows): folds, tinted fabric, sometimes half open
        float cv = bh(cell + seed * 3.1);
        float split = bh(cell * 2.3 + seed);
        float curtain = (1.0 - far) * (cv < 0.35 ? 1.0 : cv < 0.75 ? (split < 0.5 ? step(f.x, 0.3 + split) : step(split - 0.2, f.x)) : 0.0);
        vec3 fabric = mix(vec3(1.0, 0.9, 0.7), homeLight(bh(cell * 5.1 + seed)), 0.5);
        vec3 cc = fabric * lc * 0.2 * (0.8 + 0.2 * sin(f.x * 70.0));
        float isTv = step(0.95, bh(cell * 0.7 + seed));
        float tv = 0.6 + 0.4 * sin(uTime * 9.0 + h * 50.0) * sin(uTime * 3.3 + h * 20.0);
        vec3 room = mix(lc * (0.18 + 0.2 * smoothstep(0.2, 1.0, f.y)), vec3(0.35, 0.5, 1.0) * 0.3 * tv, isTv);
        float mull = (1.0 - far) * (1.0 - step(0.012, abs(f.x - 0.5)));
        emit += w * on * mix(room, cc, curtain) * (1.0 - mull);
        float slab = (1.0 - far) * (1.0 - cellBox(f, vec2(-1.0, 0.0), vec2(2.0, 0.94), fw)) * 0.4;
        diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 + slab), dark, w * (1.0 - on));
        glass = w * (1.0 - on);
      }
    } else {
      // Shibuya media block: floor-to-ceiling retail, then full-width billboard bands up the shaft
      float baseH = 7.4;
      if (v < baseH) {
        float bay = L / max(1.0, floor(L / 7.0 + 0.5));
        vec2 g = vec2(u / bay, v / baseH);
        vec2 fw = fwidth(g);
        vec2 f = fract(g);
        float pane = cellBox(f, vec2(0.025, 0.015), vec2(0.975, 0.92), fw);
        float mull = 1.0 - step(0.01, abs(f.x - 0.5));
        float id = floor(g.x);
        vec3 glow = mix(vec3(1.0, 0.35, 0.7), vec3(0.25, 0.7, 1.0), step(0.5, bh(vec2(id, seed))));
        float up = 0.25 + 0.75 * smoothstep(0.0, 0.8, f.y);
        emit += pane * glow * up * 0.7 * (1.0 - mull);
        float nb = max(1.0, floor(L / bay + 0.5));
        float isDoor = vFront * (1.0 - step(0.5, abs(id - floor(nb * 0.5))));
        float door = isDoor * cellBox(f, vec2(0.3, 0.0), vec2(0.7, 0.48), fw);
        emit *= 1.0 - door * 0.35;
        emit += door * vec3(1.0, 0.92, 0.75) * 0.22;
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.3, dark, pane);
        glass = pane;
      } else {
        float fh = 3.15;
        float cw = L / max(1.0, floor(L / 1.5 + 0.5));
        float phase = floor(bh(vec2(seed, 2.0)) * 5.0);
        vec2 g = vec2(u / cw, (v - baseH) / fh);
        vec2 fw = fwidth(g);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float isBand = step(3.5, mod(cell.y + phase, 5.0));
        vec3 bandCol = mix(vec3(1.0, 0.12, 0.42), vec3(0.1, 0.65, 1.0), step(0.5, bh(vec2(cell.y, seed))));
        bandCol = mix(bandCol, vec3(1.0, 0.7, 0.15), step(0.7, bh(vec2(cell.y + 4.0, seed + 1.0))));
        float pulse = 0.72 + 0.28 * sin(uTime * 1.15 + cell.y * 0.7);
        float sweep = smoothstep(0.18, 0.0, abs(fract(f.x * 0.12 + uTime * 0.06 + cell.y * 0.01) - 0.5));
        float band = isBand * cellBox(f, vec2(0.015, 0.1), vec2(0.985, 0.9), fw);
        emit += band * bandCol * (0.85 * pulse + 0.45 * sweep);
        float far = smoothstep(0.22, 0.6, max(fw.x, fw.y));
        float win = mix(cellBox(f, vec2(0.12, 0.16), vec2(0.88, 0.86), fw), 0.45, far) * (1.0 - isBand);
        float hh = bh(cell + seed);
        float on = mix(dayOn(alive(step(0.18, hh), cell, seed), cell, seed), mix(0.7, 0.12, uDay), far);
        emit += win * on * vec3(0.62, 0.8, 1.0) * (0.18 + 0.28 * f.y);
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.55, dark, max(win * (1.0 - on), band));
        glass = max(win * (1.0 - on * 0.45), band * 0.25);
      }
    }
  } else {
    // Roofs: gravel / tar with stains
    diffuseColor.rgb *= 0.55 + 0.25 * vnoise(vWP.xz * 0.35) + 0.1 * vnoise(vWP.xz * 3.0);
  }
  totalEmissiveRadiance += emit * uWindows;
  // Glass: by day it is mostly sky reflection
  roughnessFactor = mix(roughnessFactor, mix(0.2, 0.1, uDay), glass);
  metalnessFactor = mix(metalnessFactor, mix(0.12, 0.6, uDay), glass);
}
`;
