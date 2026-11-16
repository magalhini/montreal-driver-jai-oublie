import * as THREE from 'three';

/**
 * Spatial tiling of the static city (IMPROVEMENTS #20). The world views build each kind of thing as one mesh
 * for the whole city (an InstancedMesh of every building, one merged road surface...), which is cheap in draw
 * calls but can never be frustum culled: its bounds are the whole city. After the static scene is built,
 * `split` cuts the big ones into square tiles (sharing geometry buffers and materials, so GPU memory barely
 * grows), and `update` hides tiles beyond the fog every frame; three.js frustum culls the rest.
 *
 * Only meshes with nothing that changes per instance after building may be split (callers pass the objects
 * built in the static phase); materials are shared, so uniform / color animation keeps working.
 */
export interface TileOptions {
  /** Tile edge (m). Bigger = fewer draw calls, coarser culling. */
  tile: number;
  /** Meshes with fewer triangles than this stay whole (not worth the extra draw calls). */
  minTris: number;
  /** Hide anything whose bounding sphere is entirely farther than this from the camera (m). */
  cullDistance: number;
  /**
   * Instanced props this small (typical instance radius, m) or smaller are hidden past `propDistance`: trees,
   * lanterns, rooftop units are a few pixels deep in the fog there. Bigger things fade towards `cullDistance`.
   */
  propRadius: number;
  propDistance: number;
}

/**
 * Measured on the 13 x 13 city (IMPROVEMENTS #20): ~2.1M triangles a frame untiled, 0.5-1.0M with these, for
 * ~300-400 draw calls instead of ~160 (bigger tiles cull less, smaller ones cost more calls than they save).
 * The fog (FogExp2 0.0032) hides 97% at 600 m, 64% at 320 m.
 */
export const TILES: TileOptions = { tile: 250, minTris: 6000, cullDistance: 640, propRadius: 3, propDistance: 320 };

interface Entry {
  obj: THREE.Mesh;
  center: THREE.Vector3;
  radius: number;
  far: number;
}

const triCount = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;

export class StaticTiles {
  private entries: Entry[] = [];
  /** Stats for the debug overlay. */
  readonly stats = { split: 0, tiles: 0, kept: 0, visible: 0 };

  constructor(private readonly opts: TileOptions = { ...TILES }) {}

  /** Live tuning (debug panel): scale every cull distance, 1 = as built. */
  distanceScale = 1;

  /** Tile the large meshes among `objects` (direct children of a scene / group with identity transforms). */
  split(objects: THREE.Object3D[]): void {
    for (const o of objects) {
      if (!(o instanceof THREE.Mesh) || !o.parent || !o.frustumCulled) continue;
      o.updateMatrix();
      if (!o.matrix.equals(IDENTITY) || Array.isArray(o.material)) {
        this.track(o);
        continue;
      }
      const far = o instanceof THREE.InstancedMesh ? this.farFor(o) : this.opts.cullDistance;
      const parts = o instanceof THREE.InstancedMesh ? this.splitInstanced(o) : this.splitMerged(o);
      if (!parts) {
        this.track(o, far);
        this.stats.kept++;
        continue;
      }
      const parent = o.parent;
      parent.remove(o);
      for (const p of parts) {
        copyLook(o, p);
        parent.add(p);
        this.track(p, far);
      }
      this.stats.split++;
      this.stats.tiles += parts.length;
    }
  }

  /** Distance cull against the camera (frustum culling is three.js's job). */
  update(camera: THREE.Camera): void {
    const c = camera.getWorldPosition(TMP);
    let n = 0;
    for (const e of this.entries) {
      const d = Math.hypot(e.center.x - c.x, e.center.z - c.z) - e.radius;
      e.obj.visible = d < e.far * this.distanceScale;
      if (e.obj.visible) n++;
    }
    this.stats.visible = n;
  }

  private track(obj: THREE.Mesh, far = this.opts.cullDistance): void {
    if (obj instanceof THREE.InstancedMesh) obj.computeBoundingSphere();
    else if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
    // The bounds are in the mesh's own frame: move them to the world (signs, piers... are placed by transform)
    obj.updateMatrixWorld();
    const s = (obj instanceof THREE.InstancedMesh ? obj.boundingSphere! : obj.geometry.boundingSphere!).clone().applyMatrix4(obj.matrixWorld);
    // A sphere around the whole city is never culled: skip the bookkeeping
    if (s.radius > far * 2) return;
    this.entries.push({ obj, center: s.center, radius: s.radius, far });
  }

  /** Cull distance by typical (median) instance size: small props go first. */
  private farFor(im: THREE.InstancedMesh): number {
    const g = im.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const r0 = g.boundingSphere!.radius;
    const m = im.instanceMatrix.array;
    const step = Math.max(1, Math.floor(im.count / 64));
    const rs: number[] = [];
    for (let i = 0; i < im.count; i += step) {
      const o = i * 16;
      const sx = Math.hypot(m[o], m[o + 1], m[o + 2]);
      const sy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
      const sz = Math.hypot(m[o + 8], m[o + 9], m[o + 10]);
      rs.push(r0 * Math.max(sx, sy, sz));
    }
    rs.sort((a, b) => a - b);
    const r = rs[rs.length >> 1] ?? 0;
    const { propRadius, propDistance, cullDistance } = this.opts;
    const t = Math.min(1, Math.max(0, (r - propRadius) / (propRadius * 2)));
    return propDistance + (cullDistance - propDistance) * t;
  }

  private key(x: number, z: number): string {
    const t = this.opts.tile;
    return `${Math.floor(x / t)},${Math.floor(z / t)}`;
  }

  /** One InstancedMesh per tile (by instance position), or null if it isn't worth it. */
  private splitInstanced(im: THREE.InstancedMesh): THREE.InstancedMesh[] | null {
    if (triCount(im.geometry) * im.count < this.opts.minTris) return null;
    const m = im.instanceMatrix.array;
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < im.count; i++) {
      const k = this.key(m[i * 16 + 12], m[i * 16 + 14]);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(i);
    }
    if (buckets.size < 2) return null;
    const src = im.geometry;
    const out: THREE.InstancedMesh[] = [];
    for (const ids of buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.index = src.index;
      for (const [name, attr] of Object.entries(src.attributes)) {
        g.setAttribute(name, attr instanceof THREE.InstancedBufferAttribute ? subset(attr, ids) : attr);
      }
      g.boundingBox = src.boundingBox ?? (src.computeBoundingBox(), src.boundingBox);
      g.boundingSphere = src.boundingSphere ?? (src.computeBoundingSphere(), src.boundingSphere);
      const t = new THREE.InstancedMesh(g, im.material, ids.length);
      t.instanceMatrix.copyArray(subset(im.instanceMatrix, ids).array);
      if (im.instanceColor) t.instanceColor = subset(im.instanceColor, ids) as THREE.InstancedBufferAttribute;
      t.computeBoundingSphere();
      out.push(t);
    }
    return out;
  }

  /** One Mesh per tile (by triangle centroid) sharing the vertex buffers, each with its own index. */
  private splitMerged(mesh: THREE.Mesh): THREE.Mesh[] | null {
    const src = mesh.geometry;
    const pos = src.attributes.position;
    if (!pos || triCount(src) < this.opts.minTris || src.groups.length > 1 || Object.keys(src.morphAttributes).length) return null;
    const idx = src.index;
    const tris = triCount(src);
    const vert = (k: number) => (idx ? idx.getX(k) : k);
    const buckets = new Map<string, number[]>();
    for (let t = 0; t < tris; t++) {
      const a = vert(t * 3);
      const b = vert(t * 3 + 1);
      const c = vert(t * 3 + 2);
      const k = this.key((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3);
      let list = buckets.get(k);
      if (!list) buckets.set(k, (list = []));
      list.push(a, b, c);
    }
    if (buckets.size < 2) return null;
    const big = pos.count > 65535;
    const out: THREE.Mesh[] = [];
    for (const list of buckets.values()) {
      const g = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
      g.setIndex(new THREE.BufferAttribute(big ? new Uint32Array(list) : new Uint16Array(list), 1));
      // computeBoundingSphere / Box would walk every vertex of the shared buffer: bound the indexed ones only
      const box = new THREE.Box3();
      for (const v of list) box.expandByPoint(V.fromBufferAttribute(pos, v));
      g.boundingBox = box;
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      g.boundingSphere = sphere;
      out.push(new THREE.Mesh(g, mesh.material));
    }
    return out;
  }
}

const IDENTITY = new THREE.Matrix4();
const TMP = new THREE.Vector3();
const V = new THREE.Vector3();

/** The items `ids` of a per-instance attribute, as a new attribute. */
function subset(attr: THREE.BufferAttribute, ids: number[]): THREE.InstancedBufferAttribute {
  const n = attr.itemSize;
  const src = attr.array as Float32Array;
  const arr = new (src.constructor as Float32ArrayConstructor)(ids.length * n);
  ids.forEach((id, i) => arr.set(src.subarray(id * n, id * n + n), i * n));
  const meshPerAttribute = attr instanceof THREE.InstancedBufferAttribute ? attr.meshPerAttribute : 1;
  return new THREE.InstancedBufferAttribute(arr, n, attr.normalized, meshPerAttribute);
}

/** Carry over everything about how the original drew. */
function copyLook(from: THREE.Mesh, to: THREE.Mesh): void {
  to.name = from.name;
  to.renderOrder = from.renderOrder;
  to.layers.mask = from.layers.mask;
  to.castShadow = from.castShadow;
  to.receiveShadow = from.receiveShadow;
  to.visible = from.visible;
  to.userData = from.userData;
  to.onBeforeRender = from.onBeforeRender;
  to.onAfterRender = from.onAfterRender;
}
