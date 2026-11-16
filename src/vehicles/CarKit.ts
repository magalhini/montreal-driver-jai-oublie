import * as THREE from 'three';
import { mirrorX } from './CarGeometry';
import { PAINT } from './CarMaterial';

/** Vertex tint: a fixed color, or a multiple of the paint color. */
export type Tint = THREE.Color | number;
export interface Look {
  t: Tint;
  m: number;
}
export const look = (t: Tint, m = PAINT): Look => ({ t, m });
export type LookFn = (c: THREE.Vector3, n: THREE.Vector3, cap: boolean) => Look;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Vector3();

/** Accumulates non-indexed triangles with tint + material id per vertex. */
export class Kit {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly pk: number[] = [];
  readonly mat: number[] = [];

  add(g: THREE.BufferGeometry, l: Look | LookFn, cap?: Uint8Array): void {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i += 3) {
      let lk: Look;
      if (typeof l === 'function') {
        _a.fromBufferAttribute(p, i);
        _b.fromBufferAttribute(p, i + 1);
        _c.fromBufferAttribute(p, i + 2);
        _m.copy(_a).add(_b).add(_c).divideScalar(3);
        _b.sub(_a);
        _c.sub(_a);
        _n.crossVectors(_b, _c).normalize();
        lk = l(_m, _n, cap ? cap[i / 3] === 1 : false);
      } else lk = l;
      for (let k = i; k < i + 3; k++) {
        this.pos.push(p.getX(k), p.getY(k), p.getZ(k));
        this.nrm.push(n.getX(k), n.getY(k), n.getZ(k));
        if (typeof lk.t === 'number') this.col.push(0, 0, 0), this.pk.push(lk.t);
        else this.col.push(lk.t.r, lk.t.g, lk.t.b), this.pk.push(0);
        this.mat.push(lk.m);
      }
    }
  }

  /** Adds a geometry plus its mirror image across x = 0. */
  both(g: THREE.BufferGeometry, l: Look): void {
    this.add(g, l);
    this.add(mirrorX(g), l);
  }
}

export interface Base {
  pos: THREE.BufferAttribute;
  nrm: THREE.BufferAttribute;
  mat: THREE.BufferAttribute;
  col: Float32Array;
  pk: Float32Array;
}

export function bake(k: Kit): Base {
  return {
    pos: new THREE.Float32BufferAttribute(k.pos, 3),
    nrm: new THREE.Float32BufferAttribute(k.nrm, 3),
    mat: new THREE.Float32BufferAttribute(k.mat, 1),
    col: new Float32Array(k.col),
    pk: new Float32Array(k.pk),
  };
}

/** Geometry for one paint color; position / normal / matId buffers are shared between colors. */
export function paintBase(b: Base, paint: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', b.pos);
  g.setAttribute('normal', b.nrm);
  g.setAttribute('matId', b.mat);
  const col = new Float32Array(b.col.length);
  for (let i = 0; i < b.pk.length; i++) {
    const k = b.pk[i];
    col[i * 3] = k > 0 ? paint.r * k : b.col[i * 3];
    col[i * 3 + 1] = k > 0 ? paint.g * k : b.col[i * 3 + 1];
    col[i * 3 + 2] = k > 0 ? paint.b * k : b.col[i * 3 + 2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** Strips everything but positions and normals (lamp meshes use unlit materials). */
export function lensGeo(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const P: number[] = [];
  const N: number[] = [];
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      P.push(p.getX(i), p.getY(i), p.getZ(i));
      N.push(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.computeBoundingSphere();
  return g;
}
