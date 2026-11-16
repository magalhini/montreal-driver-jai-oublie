import * as THREE from 'three';
import { Debug } from '../core/Debug';
import { fwd } from '../core/math';
import type { Rng } from '../core/Rng';
import type { ViewSystem, Vec2 } from '../types';
import type { Car } from '../vehicles/Car';
import type { CityModel } from '../world/RoadGraph';
import type { Pathfinder, Route } from './Pathfinding';

const MAX_SEGS = 96;
const RIBBON_W = 1.6;
const Y = 0.25;
const REPLAN = 0.5;

/**
 * Debug draw for the pathfinder. With the debug panel open, click the ground to set the goal
 * (route from the player, re-planned every 0.5 s) or, with "from player" off, click start then goal.
 */
export class RouteDebugView implements ViewSystem {
  readonly settings = { show: true, fromPlayer: true };
  route: Route | null = null;
  lastMs = 0;
  private start: Vec2 | null = null;
  private goal: Vec2 | null = null;
  private pickStart = true;
  private timer = 0;
  private readonly ribbon: THREE.Mesh;
  private readonly startPole: THREE.Mesh;
  private readonly goalPole: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(
    private readonly finder: Pathfinder,
    private readonly city: CityModel,
    private readonly player: Car,
    private readonly rng: Rng,
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    canvas: HTMLCanvasElement,
  ) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SEGS * 6 * 3), 3));
    const mat = (color: number) =>
      new THREE.MeshBasicMaterial({
        color,
        toneMapped: false,
        fog: false,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });
    this.ribbon = new THREE.Mesh(geo, mat(0x22ffee));
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 10;
    const pole = new THREE.CylinderGeometry(0.6, 0.6, 30, 8).translate(0, 15, 0);
    this.startPole = new THREE.Mesh(pole, mat(0x44ff66));
    this.goalPole = new THREE.Mesh(pole, mat(0xff33cc));
    for (const m of [this.ribbon, this.startPole, this.goalPole]) {
      m.visible = false;
      scene.add(m);
    }

    let down = { x: 0, y: 0 };
    canvas.addEventListener('mousedown', (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('mouseup', (e) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this.click(e, canvas);
    });

    const f = Debug.addFolder('Pathfinding');
    f.add(this.settings, 'show');
    f.add(this.settings, 'fromPlayer').name('from player');
    f.add(this, 'randomRoute').name('random route');
    f.add(this, 'clear');
    Debug.watch('route', () =>
      this.route
        ? `${this.route.length.toFixed(0)} m  ${this.route.nodes.length} nodes  ${this.route.cost.toFixed(0)} s  ` +
          `${this.lastMs.toFixed(3)} ms  (${this.finder.expanded} expanded)`
        : this.goal ? 'no route' : 'click ground to route',
    );
  }

  randomRoute(): void {
    this.settings.fromPlayer = false;
    Debug.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    const pick = () => this.finder.snap(this.rng.pick(this.city.lanes).start).pos;
    this.start = pick();
    this.goal = pick();
    this.replan();
  }

  clear(): void {
    this.start = this.goal = this.route = null;
    this.pickStart = true;
  }

  sync(_alpha: number, frameDt: number): void {
    const on = this.settings.show && Debug.visible;
    if (on && this.settings.fromPlayer && this.goal) {
      this.timer -= frameDt;
      if (this.timer <= 0) this.replan();
    }
    const r = on ? this.route : null;
    this.ribbon.visible = !!r;
    this.startPole.visible = !!r;
    this.goalPole.visible = on && !!this.goal;
    if (this.goal) this.goalPole.position.set(this.goal.x, 0, this.goal.z);
    if (r) {
      const p0 = r.points[0];
      this.startPole.position.set(p0.x, 0, p0.z);
    }
  }

  private click(e: MouseEvent, canvas: HTMLCanvasElement): void {
    if (!Debug.visible || !this.settings.show) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return;
    const p = { x: hit.x, z: hit.z };
    if (this.settings.fromPlayer || !this.pickStart) this.goal = p;
    else this.start = p;
    if (!this.settings.fromPlayer) this.pickStart = !this.pickStart;
    if (this.settings.fromPlayer || this.pickStart) this.replan();
  }

  private replan(): void {
    this.timer = REPLAN;
    if (this.settings.fromPlayer) this.start = this.player.pos;
    if (!this.start || !this.goal) return;
    const heading = this.settings.fromPlayer ? this.playerHeading() : undefined;
    const t0 = performance.now();
    this.route = this.finder.findRoute(this.start, this.goal, { heading });
    this.lastMs = performance.now() - t0;
    if (this.route) this.writeRibbon(this.route.points);
  }

  private playerHeading(): Vec2 {
    const v = this.player.vel;
    return Math.hypot(v.x, v.z) > 1 ? v : fwd(this.player.yaw);
  }

  private writeRibbon(pts: Vec2[]): void {
    const attr = this.ribbon.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    const segs = Math.min(MAX_SEGS, pts.length - 1);
    let k = 0;
    for (let i = 0; i < segs; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      // Extend each segment by half the width so corners join.
      const dx = ((q.x - p.x) / l) * RIBBON_W * 0.5;
      const dz = ((q.z - p.z) / l) * RIBBON_W * 0.5;
      const corners = [
        [p.x - dx + dz, p.z - dz - dx],
        [p.x - dx - dz, p.z - dz + dx],
        [q.x + dx - dz, q.z + dz + dx],
        [q.x + dx + dz, q.z + dz - dx],
      ];
      for (const c of [0, 1, 2, 0, 2, 3]) {
        a[k++] = corners[c][0];
        a[k++] = Y;
        a[k++] = corners[c][1];
      }
    }
    attr.needsUpdate = true;
    this.ribbon.geometry.setDrawRange(0, segs * 6);
  }
}
