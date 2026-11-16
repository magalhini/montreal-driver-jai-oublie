import * as THREE from 'three';

/**
 * Low-poly people for the coffee shop cutscene (IMPROVEMENTS #25): capsule limbs on a joint hierarchy
 * (hips -> torso -> head / shoulders -> elbows, hips -> knees) so they can sit, reach and turn their heads.
 * Local frame: +z is where the person faces, y up, origin on the floor between the feet.
 */
export interface PersonLook {
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
  /** Barista apron color. */
  apron?: number;
  hairStyle: 'short' | 'bob' | 'bun' | 'cap';
  /** Bomber jacket (stand collar, ribbed waistband and cuffs) with racing stripes in this color down the sleeves. */
  accent?: number;
  /** Glasses. */
  glasses?: boolean;
}

export interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Object3D;
}

export interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
}

/** Arm pose: shoulder raise forward (rad, + = up / forward), shoulder spread (+ = out), elbow bend (+ = bend). */
export interface ArmPose {
  raise: number;
  spread: number;
  bend: number;
}

const mats = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number, rough = 0.75): THREE.MeshStandardMaterial {
  const key = color * 10 + Math.round(rough * 9);
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    mats.set(key, m);
  }
  return m;
}

/** Knit rib: the garment's color, a little darker and duller. */
function ribMat(color: number): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color).multiplyScalar(0.62);
  const m = mat(c.getHex(), 0.95);
  m.side = THREE.DoubleSide;
  return m;
}

const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);
const GEO = {
  torso: capsule(0.16, 0.3),
  head: new THREE.SphereGeometry(0.105, 18, 14),
  hair: new THREE.SphereGeometry(0.115, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
  bob: new THREE.CylinderGeometry(0.122, 0.13, 0.17, 18, 1, true),
  bun: new THREE.SphereGeometry(0.055, 12, 10),
  cap: new THREE.CylinderGeometry(0.118, 0.118, 0.07, 18),
  brim: new THREE.BoxGeometry(0.2, 0.012, 0.1),
  neck: new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10),
  upper: capsule(0.052, 0.22),
  fore: capsule(0.045, 0.2),
  hand: new THREE.SphereGeometry(0.045, 10, 8),
  thigh: capsule(0.07, 0.32),
  shin: capsule(0.056, 0.34),
  foot: new THREE.BoxGeometry(0.1, 0.07, 0.24),
  apron: new THREE.BoxGeometry(0.34, 0.62, 0.02),
  collar: new THREE.CylinderGeometry(0.086, 0.102, 0.085, 20, 1, true),
  waist: new THREE.TorusGeometry(0.152, 0.024, 8, 24),
  cuff: new THREE.CylinderGeometry(0.05, 0.05, 0.055, 12),
  stripe: new THREE.BoxGeometry(1, 1, 1),
  lens: new THREE.TorusGeometry(0.028, 0.006, 6, 14),
  eye: new THREE.SphereGeometry(0.012, 6, 6),
};

/** Elbow below the shoulder, hand below the elbow (the arm's two bones). */
const ELBOW_Y = -0.29;
const HAND_Y = -0.27;
const REACH = new THREE.Vector3();

/** Hip height standing; seated on a 0.46 m chair the hips sit at the seat. */
export const HIP = 0.88;

export class Person {
  readonly root = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly head = new THREE.Group();
  readonly armL: Arm;
  readonly armR: Arm;
  readonly legL: Leg;
  readonly legR: Leg;
  /** Free animation phase. */
  phase = Math.random() * 10;

  constructor(readonly look: PersonLook) {
    this.root.add(this.hips);
    this.hips.position.y = HIP;
    this.hips.add(this.torso);
    const torso = new THREE.Mesh(GEO.torso, mat(look.top));
    torso.scale.set(1.12, 1, 0.72);
    torso.position.y = 0.3;
    this.torso.add(torso);
    if (look.apron !== undefined) {
      const apron = new THREE.Mesh(GEO.apron, mat(look.apron, 0.9));
      apron.position.set(0, 0.12, 0.125);
      this.torso.add(apron);
    }
    if (look.accent !== undefined) {
      // Bomber jacket: a stand collar around the neck and a ribbed waistband, a shade darker than the jacket
      const rib = ribMat(look.top);
      const collar = new THREE.Mesh(GEO.collar, rib);
      collar.scale.set(1.12, 1, 0.9);
      collar.position.y = 0.6;
      this.torso.add(collar);
      const waist = new THREE.Mesh(GEO.waist, rib);
      waist.rotation.x = Math.PI / 2;
      waist.scale.set(1.12, 0.74, 1);
      waist.position.y = 0.09;
      this.torso.add(waist);
    }
    const neck = new THREE.Mesh(GEO.neck, mat(look.skin, 0.6));
    neck.position.y = 0.6;
    this.torso.add(neck);
    this.torso.add(this.head);
    this.head.position.y = 0.72;
    this.buildHead(look);
    this.armL = this.arm(1, look);
    this.armR = this.arm(-1, look);
    this.legL = this.leg(1, look);
    this.legR = this.leg(-1, look);
  }

  private buildHead(look: PersonLook): void {
    const h = this.head;
    const face = new THREE.Mesh(GEO.head, mat(look.skin, 0.6));
    face.scale.set(0.92, 1.06, 0.98);
    h.add(face);
    const hairM = mat(look.hair, 0.85);
    const top = new THREE.Mesh(GEO.hair, hairM);
    top.position.set(0, 0.012, -0.012);
    top.rotation.x = -0.18;
    h.add(top);
    if (look.hairStyle === 'bob') {
      const bob = new THREE.Mesh(GEO.bob, hairM);
      bob.position.set(0, -0.02, -0.025);
      h.add(bob);
    } else if (look.hairStyle === 'bun') {
      const bun = new THREE.Mesh(GEO.bun, hairM);
      bun.position.set(0, 0.06, -0.11);
      h.add(bun);
    } else if (look.hairStyle === 'cap') {
      const cap = new THREE.Mesh(GEO.cap, mat(look.apron ?? look.accent ?? 0x222222, 0.8));
      cap.position.y = 0.07;
      h.add(cap);
      const brim = new THREE.Mesh(GEO.brim, cap.material);
      brim.position.set(0, 0.04, 0.12);
      h.add(brim);
    }
    const eyeM = mat(0x16100c, 0.4);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(GEO.eye, eyeM);
      e.position.set(s * 0.036, 0.012, 0.094);
      h.add(e);
      if (look.glasses) {
        const lens = new THREE.Mesh(GEO.lens, mat(0x202020, 0.3));
        lens.position.set(s * 0.038, 0.012, 0.104);
        h.add(lens);
      }
    }
  }

  private arm(side: number, look: PersonLook): Arm {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.21, 0.5, 0);
    this.torso.add(shoulder);
    const upper = new THREE.Mesh(GEO.upper, mat(look.top));
    upper.position.y = -0.14;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = ELBOW_Y;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(GEO.fore, mat(look.top));
    fore.position.y = -0.12;
    elbow.add(fore);
    const hand = new THREE.Mesh(GEO.hand, mat(look.skin, 0.6));
    hand.position.y = HAND_Y;
    elbow.add(hand);
    if (look.accent !== undefined) {
      // Ribbed cuff, and a thin racing stripe down the outside of the sleeve
      const cuff = new THREE.Mesh(GEO.cuff, ribMat(look.top));
      cuff.position.y = -0.215;
      elbow.add(cuff);
      const stripeM = mat(look.accent, 0.5);
      const s1 = new THREE.Mesh(GEO.stripe, stripeM);
      s1.scale.set(0.012, 0.27, 0.024);
      s1.position.set(side * 0.051, -0.14, 0);
      shoulder.add(s1);
      const s2 = new THREE.Mesh(GEO.stripe, stripeM);
      s2.scale.set(0.012, 0.17, 0.022);
      s2.position.set(side * 0.045, -0.1, 0);
      elbow.add(s2);
    }
    return { shoulder, elbow, hand };
  }

  private leg(side: number, look: PersonLook): Leg {
    const hip = new THREE.Group();
    hip.position.set(side * 0.09, 0, 0);
    this.hips.add(hip);
    const thigh = new THREE.Mesh(GEO.thigh, mat(look.bottom));
    thigh.position.y = -0.21;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);
    const shin = new THREE.Mesh(GEO.shin, mat(look.bottom));
    shin.position.y = -0.2;
    knee.add(shin);
    const foot = new THREE.Mesh(GEO.foot, mat(look.shoes, 0.5));
    foot.position.set(0, -0.42, 0.05);
    knee.add(foot);
    return { hip, knee };
  }

  /** Sit on a seat this high (the root stays on the floor under the hips). */
  sit(seat = 0.46): void {
    this.hips.position.y = seat + 0.04;
    for (const l of [this.legL, this.legR]) {
      l.hip.rotation.x = -Math.PI / 2 + 0.08;
      l.knee.rotation.x = Math.PI / 2 - 0.08;
    }
    this.legL.hip.rotation.z = -0.05;
    this.legR.hip.rotation.z = 0.05;
  }

  /** Pose an arm (L / R mirror the spread). */
  pose(arm: Arm, p: ArmPose, side: 1 | -1): void {
    arm.shoulder.rotation.set(-p.raise, 0, side * p.spread);
    arm.elbow.rotation.set(-p.bend, 0, 0);
  }

  /**
   * The arm pose that puts the hand on `target` (world), as near as the arm reaches (two-bone IK in the
   * torso's frame). World matrices must be current. Blend it with `lerpPose`, apply it with `pose`.
   */
  reach(arm: Arm, side: 1 | -1, target: THREE.Vector3): ArmPose {
    const L1 = -ELBOW_Y;
    const L2 = -HAND_Y;
    const p = this.torso.worldToLocal(REACH.copy(target)).sub(arm.shoulder.position);
    const d = Math.min(L1 + L2 - 0.001, Math.max(L1 - L2 + 0.01, p.length()));
    const bend = Math.acos(Math.min(1, Math.max(-1, (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2))));
    // The hand in the shoulder's frame before it turns: down the arm and forward by the bend
    const py = -L1 - L2 * Math.cos(bend);
    const pz = L2 * Math.sin(bend);
    p.setLength(d);
    // The shoulder spreads (z) to line up x, then raises (x) to swing y / z onto the target
    const phi = Math.asin(Math.min(1, Math.max(-1, -p.x / py)));
    const alpha = Math.atan2(p.z, p.y) - Math.atan2(pz, py * Math.cos(phi));
    return { raise: -alpha, spread: phi * side, bend };
  }

  /** Idle breathing and a little sway. */
  breathe(t: number, amount = 1): void {
    const b = Math.sin((t + this.phase) * 1.7);
    this.torso.scale.set(1 + 0.012 * b * amount, 1 + 0.008 * b * amount, 1);
    this.torso.rotation.z = Math.sin((t + this.phase) * 0.45) * 0.015 * amount;
  }

  /** Walking stride (0 = standing). */
  stride(t: number, k: number): void {
    const s = Math.sin(t * 7) * 0.45 * k;
    this.legL.hip.rotation.x = s;
    this.legR.hip.rotation.x = -s;
    this.legL.knee.rotation.x = Math.max(0, -s) * 1.1;
    this.legR.knee.rotation.x = Math.max(0, s) * 1.1;
    this.hips.position.y = HIP + Math.abs(Math.cos(t * 7)) * 0.025 * k;
  }
}

export const lerpPose = (a: ArmPose, b: ArmPose, t: number): ArmPose => ({
  raise: a.raise + (b.raise - a.raise) * t,
  spread: a.spread + (b.spread - a.spread) * t,
  bend: a.bend + (b.bend - a.bend) * t,
});

export const POSE = {
  down: { raise: 0.05, spread: 0.08, bend: 0.15 },
  table: { raise: 0.6, spread: 0.12, bend: 1.12 },
  work: { raise: 0.95, spread: 0.05, bend: 1.25 },
  high: { raise: 1.35, spread: 0.0, bend: 1.0 },
  read: { raise: 1.0, spread: 0.32, bend: 1.55 },
  sip: { raise: 0.75, spread: -0.05, bend: 2.25 },
  type: { raise: 0.62, spread: 0.18, bend: 1.2 },
  wave: { raise: 0.6, spread: 0.35, bend: 1.7 },
} satisfies Record<string, ArmPose>;
