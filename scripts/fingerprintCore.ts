/**
 * City fingerprint (T36): hashes of a generated city, grouped so a regression points at the part that moved.
 * Groups hash what the game sees (positions, sampled lane lines, surfaces, heights), not how it is stored,
 * so changing the representation (polyline lanes, polygons) keeps the hash as long as the city is the same.
 * Loaded by `scripts/fingerprint.mjs` through Vite (no extra dependencies).
 */
import { CONFIG } from '../src/config';
import { mapDef } from '../src/maps';
import { resolveMap } from '../src/maps/catalog';
import { cumulative, pointAt } from '../src/world/Polyline';
import { surfaceAt } from '../src/world/Surfaces';

class Hash {
  private h = 0x811c9dc5;
  count = 0;
  add(v: unknown): void {
    const s = typeof v === 'number' ? num(v) : typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Number(num(x)) : x));
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i);
      this.h = Math.imul(this.h, 0x01000193) >>> 0;
    }
    this.h ^= 0x1f;
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
    this.count++;
  }
  get hex(): string {
    return this.h.toString(16).padStart(8, '0');
  }
}

/** Rounded to 1e-4, without "-0". */
function num(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return String(r === 0 ? 0 : r);
}

export function fingerprint(id: string): string[] {
  const map = resolveMap(id);
  if (!map || CONFIG.MAP !== map) throw new Error(`CONFIG.MAP is ${CONFIG.MAP}, expected ${map ?? id} (set NEON_MAP)`);
  const def = mapDef(map);
  const city = def.generate(def.seed);
  const groups: Record<string, Hash> = {};
  const g = (name: string) => (groups[name] ??= new Hash());

  for (const n of city.nodes) g('nodes').add([n.pos.x, n.pos.z, n.edges, n.signalized, n.control]);
  for (const e of city.edges) g('edges').add([e.a, e.b, e.lanesPerDir, e.width, e.speedLimit, e.length, e.avenue, e.lanesAB, e.lanesBA]);
  // Edge centerlines (T37), every 2 m
  for (const e of city.edges) {
    const cum = cumulative(e.pts);
    const L = cum[cum.length - 1];
    const steps = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k <= steps; k++) g('edgeLines').add(pointAt(e.pts, cum, (k / steps) * L));
  }
  // Lanes: points every 2 m along the lane's line from its start to the stop line
  for (const l of city.lanes) {
    const h = g('lanes');
    h.add([l.edgeId, l.from, l.to, l.index, l.length]);
    const steps = Math.max(1, Math.ceil(l.length / 2));
    for (let k = 0; k <= steps; k++) {
      const p = pointAt(l.pts, l.cum, (k / steps) * l.length);
      h.add([p.x, p.z]);
    }
  }
  for (const b of city.blocks) g('blocks').add([b.id, b.min, b.max, b.district]);
  for (const b of city.buildings) g('buildings').add(b);
  for (const w of city.walls) g('walls').add(w);
  g('features').add(city.features);
  g('misc').add([city.bounds, city.startPos, city.waterZ]);

  const o = city.bounds;
  for (let z = o.minZ; z <= o.maxZ; z += 4) for (let x = o.minX; x <= o.maxX; x += 4) g('surfaces').add(surfaceAt(city, { x, z }));
  const t = city.terrain;
  for (let z = o.minZ; z <= o.maxZ; z += 8) {
    for (let x = o.minX; x <= o.maxX; x += 8) {
      g('heights').add(t.heightAt(x, z));
      g('surfaceY').add(t.surfaceY(x, z));
      g('water').add(t.waterAt(x, z) ?? 'dry');
    }
  }

  return [`map ${map} seed ${def.seed}`, ...Object.entries(groups).map(([k, h]) => `${k.padEnd(10)} ${String(h.count).padStart(8)} ${h.hex}`)];
}
