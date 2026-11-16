import * as THREE from 'three';
import { fwd, leftOf } from '../core/math';
import type { Vec2 } from '../types';
import type { Car } from './Car';

const MAX_SKID = 3000;
const MAX_PARTICLES = 700;
/** Skid mark darkness for a full slide; light slips leave fainter marks. */
const SKID_ALPHA = 0.62;
/** Exhaust pops (backfires) are drawn for cars this close to the focus (m). */
const POP_RANGE = 70;

/** Per-car memory for the exhaust: last throttle and gear, and a pending burst of pops after a lift. */
interface Exhaust {
  throttle: number;
  gear: number;
  pops: number;
  next: number;
  /** Seconds the throttle has been held wide open (a lift only crackles after a proper pull). */
  pull: number;
}

class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX_PARTICLES * 3);
  private vel = new Float32Array(MAX_PARTICLES * 3);
  private size = new Float32Array(MAX_PARTICLES);
  private alpha = new Float32Array(MAX_PARTICLES);
  private color = new Float32Array(MAX_PARTICLES * 3);
  private life = new Float32Array(MAX_PARTICLES);
  private maxLife = new Float32Array(MAX_PARTICLES);
  private grow = new Float32Array(MAX_PARTICLES);
  private gravity = new Float32Array(MAX_PARTICLES);
  private opacity = new Float32Array(MAX_PARTICLES);
  private next = 0;
  private geo = new THREE.BufferGeometry();
  readonly uniforms = { uScale: { value: 600 } };

  constructor(additive: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        uniform float uScale;
        varying float vA; varying vec3 vC;
        void main() {
          vA = aAlpha; vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying vec3 vC;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float a = vA * smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(pow(vC, vec3(2.2)), a); // authored in sRGB, the frame is linear
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, r: number, g: number, b: number, grow: number, gravity = 0, opacity = 0.55): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.color.set([r, g, b], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.gravity[i] = gravity;
    this.opacity[i] = opacity;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.gravity[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const damp = Math.exp(-1.6 * dt);
      this.vel[k] *= damp;
      this.vel[k + 2] *= damp;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.max(0, t) * this.opacity[i];
    }
    for (const name of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.getAttribute(name).needsUpdate = true;
  }
}

/** Skid marks, tire smoke, sparks and engine damage smoke. */
export class Effects {
  private skidPos = new Float32Array(MAX_SKID * 6 * 3);
  private skidCol = new Float32Array(MAX_SKID * 6 * 4);
  private skidGeo = new THREE.BufferGeometry();
  private skidNext = 0;
  /** Last skid point per wheel, keyed car id * 4 + wheel. */
  private lastWheel = new Map<number, Vec2>();
  private exhaust = new Map<number, Exhaust>();
  private lastAlpha = new Map<number, number>();
  private smoke = new Particles(false);
  private sparks = new Particles(true);
  private acc = 0;
  /** Road wetness 0..1 (set from the weather): fast cars throw up spray. */
  wet = 0;

  constructor(scene: THREE.Scene) {
    this.skidGeo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3).setUsage(THREE.DynamicDrawUsage));
    // RGBA vertex colors: the alpha carries how hard the tire was sliding (faint scuffs to black bars)
    this.skidGeo.setAttribute('color', new THREE.BufferAttribute(this.skidCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.skidGeo.setDrawRange(0, 0);
    const skid = new THREE.Mesh(
      this.skidGeo,
      new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    skid.frustumCulled = false;
    scene.add(skid, this.smoke.points, this.sparks.points);
  }

  setViewportHeight(h: number, fov: number): void {
    const s = h / 2 / Math.tan(((fov * Math.PI) / 180) / 2);
    this.smoke.uniforms.uScale.value = s;
    this.sparks.uniforms.uScale.value = s;
  }

  /** Ground height for marks and particles (set to the city terrain). */
  heightAt: (x: number, z: number) => number = () => 0;

  private addSkid(a: Vec2, b: Vec2, alphaA: number, alphaB: number, halfWidth: number): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.05 || l > 3) return;
    const nx = (-dz / l) * halfWidth;
    const nz = (dx / l) * halfWidth;
    const ya = this.heightAt(a.x, a.z) + 0.03;
    const yb = this.heightAt(b.x, b.z) + 0.03;
    const i = this.skidNext * 18;
    this.skidPos.set(
      [a.x - nx, ya, a.z - nz, b.x - nx, yb, b.z - nz, b.x + nx, yb, b.z + nz, a.x - nx, ya, a.z - nz, b.x + nx, yb, b.z + nz, a.x + nx, ya, a.z + nz],
      i,
    );
    const c = this.skidNext * 24;
    const order = [alphaA, alphaB, alphaB, alphaA, alphaB, alphaA];
    for (let v = 0; v < 6; v++) this.skidCol[c + v * 4 + 3] = order[v];
    // Upload only the quad just written (the buffer is 3000 quads)
    const pos = this.skidGeo.getAttribute('position') as THREE.BufferAttribute;
    pos.addUpdateRange(i, 18);
    pos.needsUpdate = true;
    const col = this.skidGeo.getAttribute('color') as THREE.BufferAttribute;
    col.addUpdateRange(c, 24);
    col.needsUpdate = true;
    this.skidNext = (this.skidNext + 1) % MAX_SKID;
    this.skidGeo.setDrawRange(0, Math.max(this.skidGeo.drawRange.count, this.skidNext * 6));
  }

  /**
   * Exhaust pops: lifting off after a hard pull at high revs crackles a few times, a full-throttle upshift barks
   * once and the rev limiter spits now and then. Little flame bursts (additive, so they bloom) out of the tail pipe.
   */
  private exhaustFx(car: Car, dt: number): void {
    const s = car.phys.state;
    const sp = car.phys.spec;
    let e = this.exhaust.get(car.id);
    if (!e) {
      e = { throttle: 0, gear: s.gear, pops: 0, next: 0, pull: 0 };
      this.exhaust.set(car.id, e);
    }
    const thr = car.input.throttle;
    const revs = s.rpm / sp.redline;
    e.pull = thr > 0.85 && s.speed > 3 ? e.pull + dt : 0;
    if (e.throttle > 0.7 && thr < 0.1 && revs > 0.62 && s.speed > 6) e.pops = Math.max(e.pops, 2 + Math.floor(Math.random() * 4 * revs));
    if (s.gear > e.gear && e.gear >= 1 && thr > 0.8 && Math.random() < 0.7) this.pop(car, 1.15);
    if (revs > 0.985 && thr > 0.8 && Math.random() < dt * 5) this.pop(car, 0.8);
    e.throttle = thr;
    e.gear = s.gear;
    if (e.pops > 0) {
      e.next -= dt;
      if (e.next <= 0) {
        this.pop(car, 0.6 + Math.random() * 0.6);
        e.pops--;
        e.next = 0.05 + Math.random() * 0.13;
      }
    }
  }

  private pop(car: Car, power: number): void {
    const s = car.phys.state;
    const f = fwd(s.yaw);
    const l = leftOf(s.yaw);
    const back = car.phys.spec.halfLength + 0.08;
    // Tail pipe under the right rear corner (left-hand traffic cars pipe out on the kerb side)
    const x = s.pos.x - f.x * back - l.x * 0.42;
    const z = s.pos.z - f.z * back - l.z * 0.42;
    const y = s.y + 0.3;
    const n = 3 + Math.floor(power * 4);
    for (let k = 0; k < n; k++) {
      const kick = (2.5 + Math.random() * 4) * power;
      const hot = Math.random();
      this.sparks.emit(
        x, y, z,
        s.vel.x - f.x * kick + (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.3) * 0.8,
        s.vel.z - f.z * kick + (Math.random() - 0.5) * 1.2,
        (0.16 + Math.random() * 0.16) * power,
        0.07 + Math.random() * 0.09,
        // white-blue core, orange flame
        hot < 0.3 ? 1.6 : 2.4, hot < 0.3 ? 1.7 : 0.9 + hot * 0.5, hot < 0.3 ? 2.6 : 0.15,
        0.9, 0, 0.95,
      );
    }
  }

  /** White water thrown up where a car hits the water. */
  splash(p: Vec2, y: number): void {
    for (let k = 0; k < 70; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 4;
      this.smoke.emit(p.x + Math.cos(a) * r * 0.4, y + 0.2, p.z + Math.sin(a) * r * 0.4, Math.cos(a) * r, 3 + Math.random() * 6, Math.sin(a) * r, 0.5 + Math.random() * 0.5, 0.9 + Math.random() * 0.6, 0.75, 0.85, 0.95, 1.5, 9.8);
    }
  }

  /** Fireball at a wreck. `power` is about 0.4..1.6; `dir` is the blast's favored direction on the ground. */
  explosion(p: Vec2, y: number, power: number, dir: Vec2): void {
    const sparks = Math.min(48, Math.floor(16 + power * 18));
    for (let k = 0; k < sparks; k++) {
      const a = Math.random() * Math.PI * 2;
      const kick = (0.35 + Math.random()) * (5 + power * 7);
      const hot = Math.random();
      this.sparks.emit(
        p.x, y + Math.random() * 0.5, p.z,
        Math.cos(a) * kick + dir.x * (3 + power * 3),
        (2 + Math.random() * 6) * (0.55 + power * 0.35),
        Math.sin(a) * kick + dir.z * (3 + power * 3),
        0.16 + Math.random() * 0.22,
        1.15 + Math.random() * 0.9,
        1, 0.32 + hot * 0.6, 0.08 + hot * 0.15,
        -0.04, 5, 0.95,
      );
    }
    const smoke = Math.min(22, Math.floor(8 + power * 8));
    for (let k = 0; k < smoke; k++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit(
        p.x + Math.cos(a) * 0.35, y + 0.3, p.z + Math.sin(a) * 0.35,
        Math.cos(a) * 1.6 + dir.x * 1.8, 1.6 + Math.random() * 2.4, Math.sin(a) * 1.6 + dir.z * 1.8,
        0.7 + Math.random() * 0.7, 2.1 + Math.random() * 1.3,
        0.16, 0.12, 0.1, 2.1, 1.2, 0.42,
      );
    }
  }

  /** One puff of smoke at (x, y, z) rising at `rise` m/s; `shade` 0 is black, 1 white (the broken-down car's bonnet). */
  puff(x: number, y: number, z: number, size: number, life: number, shade: number, rise: number): void {
    this.smoke.emit(x, y, z, (Math.random() - 0.5) * 0.9, rise, (Math.random() - 0.5) * 0.9, size, life, shade, shade, shade * 1.05, 2.4, 0, 0.7);
  }

  sparksAt(p: Vec2, intensity: number, y = this.heightAt(p.x, p.z) + 0.6): void {
    const n = Math.min(40, Math.floor(intensity * 30));
    for (let k = 0; k < n; k++) {
      this.sparks.emit(p.x, y, p.z, (Math.random() - 0.5) * 12, Math.random() * 5 + 1, (Math.random() - 0.5) * 12, 0.12, 0.5 + Math.random() * 0.4, 4, 2.2, 0.6, -0.1, 14);
    }
  }

  update(cars: Car[], focus: Vec2, dt: number): void {
    this.acc += dt;
    const emitSmoke = this.acc > 1 / 40;
    if (emitSmoke) this.acc = 0;
    for (const car of cars) {
      if (car.removed) continue;
      if (Math.abs(car.pos.x - focus.x) > 120 || Math.abs(car.pos.z - focus.z) > 120) continue;
      const s = car.phys.state;
      const speed = car.speed;
      const f = fwd(s.yaw);
      const l = leftOf(s.yaw);
      const sp = car.phys.spec;
      const onGround = !s.airborne && s.water < 0.3;
      const rearSkid = onGround && ((s.slipRear > 0.2 && speed > 3) || (car.phys.rearLocked && speed > 2) || car.phys.wheelspin);
      const frontSkid = onGround && s.slipFront > 0.32 && speed > 4;
      // How dark the marks are: slip past the threshold, spinning or locked wheels; fainter on a wet road
      const wetFade = 1 - 0.55 * this.wet;
      const rearA = rearSkid
        ? SKID_ALPHA * wetFade * Math.min(1, 0.3 + (s.slipRear - 0.2) * 2.2 + (car.phys.wheelspin ? 0.55 : 0) + (car.phys.rearLocked ? 0.6 : 0))
        : 0;
      const frontA = frontSkid ? SKID_ALPHA * wetFade * Math.min(1, 0.3 + (s.slipFront - 0.32) * 2.5) : 0;
      const track = sp.halfWidth - 0.12;
      const tread = sp.halfWidth > 0.95 ? 0.14 : 0.11;
      if ((car.kind === 'player' || car.siren) && Math.abs(car.pos.x - focus.x) + Math.abs(car.pos.z - focus.z) < POP_RANGE) this.exhaustFx(car, dt);
      for (let w = 0; w < 4; w++) {
        const rear = w < 2;
        const along = rear ? -sp.cgToRear : sp.cgToFront;
        const side = w % 2 === 0 ? track : -track;
        const skid = rear ? rearSkid : frontSkid;
        const key = car.id * 4 + w;
        if (skid) {
          const p = { x: s.pos.x + f.x * along + l.x * side, z: s.pos.z + f.z * along + l.z * side };
          const alpha = rear ? rearA : frontA;
          const last = this.lastWheel.get(key);
          // marks fade in and out at their ends instead of starting as hard-edged bars
          if (last) this.addSkid(last, p, this.lastAlpha.get(key) ?? 0, alpha, tread);
          this.lastWheel.set(key, p);
          this.lastAlpha.set(key, last ? alpha : 0);
          if (emitSmoke && rear) {
            const intensity = Math.min(1, s.slipRear * 1.5 + (car.phys.wheelspin ? 0.5 : 0) + (car.input.burnout && car.phys.wheelspin ? 0.45 : 0));
            this.smoke.emit(p.x, s.y + 0.3, p.z, (Math.random() - 0.5) * 1.5 - s.vel.x * 0.1, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5 - s.vel.z * 0.1, 0.9, 1.6 * intensity + 0.4, 0.75, 0.72, 0.8, 2.6);
          }
        } else if (this.lastWheel.delete(key)) this.lastAlpha.delete(key);
      }
      // Spray off wet roads, one puff from a rear wheel per tick (cheap enough for the whole street)
      if (emitSmoke && onGround && this.wet > 0.15 && speed > 7 && Math.random() < this.wet * Math.min(1, (speed - 7) / 18) * 0.7) {
        const side = Math.random() < 0.5 ? 0.72 : -0.72;
        const px = s.pos.x - f.x * sp.cgToRear + l.x * side;
        const pz = s.pos.z - f.z * sp.cgToRear + l.z * side;
        this.smoke.emit(px, s.y + 0.15, pz, -s.vel.x * 0.15 + (Math.random() - 0.5), 0.5 + Math.random() * 0.6, -s.vel.z * 0.15 + (Math.random() - 0.5), 0.3, 0.35 + Math.random() * 0.25, 0.62, 0.64, 0.72, 1.3, 2.5, 0.07);
      }
      if (emitSmoke && s.damage > 0.55 && Math.random() < s.damage) {
        const p = { x: s.pos.x + f.x * 1.6, z: s.pos.z + f.z * 1.6 };
        const shade = s.damage > 0.85 ? 0.08 : 0.35;
        this.smoke.emit(p.x, s.y + 1.0, p.z, (Math.random() - 0.5) * 0.6, 1.5, (Math.random() - 0.5) * 0.6, 0.6, 1.4, shade, shade, shade, 1.8);
      }
    }
    // Wheels of despawned cars that were mid-skid, exhaust memory of cops that went home
    if (this.lastWheel.size > 400) {
      this.lastWheel.clear();
      this.lastAlpha.clear();
    }
    if (this.exhaust.size > 40) this.exhaust.clear();
    this.smoke.update(dt);
    this.sparks.update(dt);
  }
}
