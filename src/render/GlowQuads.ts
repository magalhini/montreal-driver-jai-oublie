import * as THREE from 'three';
import { sharedGlow } from '../world/textures';

/**
 * One draw call of additive glow halos, refilled every frame. Quads face local +Z and are one-sided,
 * so a lamp only glows toward the direction it points (signals toward their traffic, headlights forward).
 */
export class GlowQuads {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;

  constructor(scene: THREE.Scene, max: number, fog = true) {
    const mat = new THREE.MeshBasicMaterial({
      map: sharedGlow(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  begin(): void {
    this.n = 0;
  }

  push(matrix: THREE.Matrix4, color: THREE.Color): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.mesh.setMatrixAt(this.n, matrix);
    this.mesh.setColorAt(this.n, color);
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
