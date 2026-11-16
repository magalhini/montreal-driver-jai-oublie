import type { CharmId, PartKind } from '../vehicles/Tuning';
import { GARAGE_SOUNDS, type Cue } from './GarageSamples';
import type { Mixer } from './Mixer';
import { LoopLayer, type SampleBank } from './Samples';

/** Something the player did on the pit shop menu that the crew answers with a sound. */
export type GarageEvent =
  /** ENTER on the ENGINE tab: the hood comes up. */
  | { kind: 'hood' }
  | { kind: 'fit'; part: PartKind; top: boolean }
  | { kind: 'remove'; part: PartKind }
  | { kind: 'burnout'; on: boolean }
  | { kind: 'wheels' }
  | { kind: 'paint'; fit: boolean }
  | { kind: 'charm'; id: CharmId; fit: boolean }
  | { kind: 'repair' }
  | { kind: 'pay' }
  | { kind: 'refund' }
  | { kind: 'leave' };

type Sound = keyof typeof GARAGE_SOUNDS;
type CueOf<S extends Sound> = keyof (typeof GARAGE_SOUNDS)[S]['cues'];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** Mirror charms by sound: suzu bells on the hanging ones, a squeak on the toys, the duck, the dice cup. */
const CHARM_CUES: Record<CharmId, CueOf<'charm'> | null> = {
  omamori: 'suzuShake',
  teru: 'suzuShake2',
  daruma: 'suzuShake3',
  panda: 'squeak',
  shiba: 'squeak',
  neko: 'squeak',
  duck: 'duck',
  dice: 'dice2',
  none: null,
};

/** When the kneeling mechanic's impact wrench is buzzing (matches the arm animation in `PitGarage.place`). */
const wrenchOn = (t: number) => Math.sin(t * 1.6) > 0;
/** The walker's loop (`PitGarage.animateCrew`): typing on the laptop, a trip to the tool chest at 10.4-12.6 s. */
const WALK_LOOP = 18;
const walkPhase = (t: number) => (t - 6.8) % WALK_LOOP;
const typing = (lp: number) => lp < 8 || lp >= 15;

/**
 * The NEO OIL pit garage's sound (`GarageSamples.ts`): a recorded workshop bed and one-shots cut from
 * recordings, on the music bus like the café (the city outside is muffled behind the door). `update`
 * follows the cutscene clock (`PitShop.scene`): the crew's choreography in `PitGarage` (rummaging at the
 * bench, the impact wrench's bursts, the laptop, the walker fetching tools, the creeper's ratchet) and some
 * shop life (the compressor topping off). `event` answers the menu: previews, fits, the till, leaving.
 */
export class GarageAudio {
  /** Everything in the garage, faded in during the scene. */
  private readonly amb: GainNode;
  private readonly room: LoopLayer;
  private last = -1;
  private wrenchWas = false;
  private wrenchN = 0;
  private typeAt = 0;
  private walkWas = 0;
  private ratchetAt = 0;
  private compAt = 0;

  constructor(
    private readonly mx: Mixer,
    private readonly bank: SampleBank,
  ) {
    const cat = mx.catGain('life', mx.music);
    cat.connect(mx.gain(mx.roomSend, 0.6));
    this.amb = mx.gain(cat, 0);
    this.room = new LoopLayer(bank, 'garageRoom', this.amb);
  }

  /** `scene`: seconds since the car arrived (cutscene, then the menu), or null outside the garage. */
  update(scene: number | null): void {
    const t = this.mx.now;
    const inside = scene !== null;
    this.amb.gain.setTargetAtTime(inside ? 1 : 0, t, inside ? 0.4 : 0.3);
    this.room.set(inside ? 0.45 : 0, t, 0.3);
    if (scene === null) {
      this.last = -1;
      return;
    }
    const s = scene;
    // Fresh scene, or the cutscene skipped (the clock jumps to the end): no catching up on missed cues
    const jump = this.last < 0 || s - this.last > 1;
    if (jump) {
      this.wrenchWas = wrenchOn(s);
      this.wrenchN = 0;
      this.typeAt = Math.max(s, 6.8);
      this.walkWas = walkPhase(s);
      this.ratchetAt = s + rnd(1.5, 5);
      this.compAt = s + rnd(25, 70);
      if (this.last < 0) this.bank.get('garageRoom');
    }
    const crossed = (at: number) => !jump && this.last < at && s >= at;
    // Arrival: the wrench mechanic digs in the bench, a hose comes off as the car stops, the gun comes out
    if (crossed(0.9)) this.play('tools', 'rummage', 0.3);
    if (crossed(2.1)) this.play('tools', 'dig', 0.3);
    if (crossed(3.5)) this.play('airHiss', 'pffft', 0.22);
    if (crossed(4.4)) this.play('tools', 'clank', 0.25);
    if (crossed(6.2)) this.play('tools', 'clank2', 0.18);
    // Impact wrench on the wheel nuts, in time with the kneeling mechanic's arm (he is down by 5 s, mid-burst)
    const on = wrenchOn(s);
    if ((s > 5 && on && !this.wrenchWas) || (crossed(5) && on)) {
      const cue: CueOf<'impactWrench'>[] = ['short', 'medium', 'short2', 'long2', 'short', 'medium'];
      this.play('impactWrench', cue[this.wrenchN++ % cue.length], 0.3);
    }
    this.wrenchWas = on;
    // The walker: typing on the laptop, now and then a trip to the tool chest
    if (s >= 6.8) {
      const lp = walkPhase(s);
      if (typing(lp)) {
        if (s >= this.typeAt) {
          this.play('typing', 'typing', 0.2);
          this.typeAt = s + 3.9;
        }
      } else this.typeAt = s;
      const walked = (at: number) => this.walkWas < at && lp >= at;
      if (walked(10.5)) this.play('tools', 'rummage2', 0.3);
      if (walked(11.5)) this.play('tools', pick(['drawer', 'drawer2', 'drawer3']), 0.3);
      if (walked(12.3)) this.play('tools', pick(['clank', 'drop3']), 0.22);
      this.walkWas = lp;
    }
    // The creeper under the car, working a hand ratchet
    if (s >= 7.2 && s >= this.ratchetAt) {
      this.play('ratchet', pick(['one', 'one2', 'one3', 'quick4', 'run', 'run2']), 0.18);
      this.ratchetAt = s + rnd(5, 12);
    }
    // Shop life: the compressor kicks on every minute or two
    if (s >= this.compAt) {
      this.play('compressor', 'onOff', 0.22);
      this.compAt = s + rnd(60, 120);
    }
    this.last = s;
  }

  /** The crew answers the menu. */
  event(ev: GarageEvent): void {
    switch (ev.kind) {
      case 'hood':
        this.play('hood', 'open', 0.4);
        return;
      case 'fit':
        this.fit(ev.part, ev.top);
        return;
      case 'remove':
        // Off it comes: a run on the ratchet and the part dropped on the floor
        this.play('ratchet', 'run', 0.3, 0.1);
        this.play('tools', pick(['drop', 'drop2', 'drop4']), 0.35, 1.9);
        return;
      case 'burnout':
        this.play('airRatchet', ev.on ? 'a' : 'b', 0.3, 0.1);
        if (ev.on) this.play('hood', 'close', 0.35, 2.6);
        return;
      case 'wheels':
        this.play('airHiss', 'valve', 0.22, 0.05);
        this.play('impactWrench', 'long', 0.32, 0.4);
        return;
      case 'paint':
        if (ev.fit) {
          this.play('sprayPaint', 'shakeSpray', 0.3);
          this.play('sprayPaint', 'spray2', 0.3, 2.2);
        } else this.play('sprayPaint', 'spray', 0.2);
        return;
      case 'charm': {
        const cue = CHARM_CUES[ev.id];
        if (!cue) {
          if (ev.fit) this.play('tools', 'clank2', 0.2);
          return;
        }
        // Hung for good: the full shake of the bells, the dice rattled in the cup
        this.play('charm', ev.fit ? (cue === 'dice2' ? 'dice' : cue.startsWith('suzu') ? 'suzu' : cue) : cue, ev.fit ? 0.35 : 0.28);
        return;
      }
      case 'repair':
        this.play('hammer', pick(['hits', 'hits2', 'hits3']), 0.3, 0.1);
        this.play('airHiss', 'pffft', 0.22, 2.3);
        return;
      case 'pay':
        this.play('register', 'open', 0.3);
        return;
      case 'refund':
        this.play('register', 'open', 0.3);
        this.play('register', 'close', 0.3, 2.6);
        return;
      case 'leave':
        this.play('door', 'latch', 0.3);
        return;
    }
  }

  /** A performance part going on: each tab has its own tools. */
  private fit(part: PartKind, top: boolean): void {
    switch (part) {
      case 'engine':
        if (top) {
          // The race build: a bead welded in, the hood slammed shut
          this.play('welding', 'tack', 0.3, 0.2);
          this.play('welding', 'run', 0.3, 1.8);
          this.play('hood', 'slam', 0.35, 5.0);
        } else {
          this.play('ratchet', 'run2', 0.3, 0.1);
          this.play('ratchet', 'torque', 0.2, 1.5);
        }
        return;
      case 'weight':
        // Panels and trim out, the cage tacked in on the top stage
        this.play('drill', 'drill', 0.3, 0.1);
        this.play('tools', pick(['drop', 'drop2']), 0.3, 1.6);
        if (top) this.play('welding', 'tack', 0.3, 2.8);
        return;
      case 'handling':
        // The car goes up on the jack for the suspension
        this.play('jack', 'pump4', 0.3, 0.1);
        this.play('ratchet', 'quick4', 0.28, 3.6);
        return;
      case 'brakes':
        this.play('airHiss', 'valve', 0.22, 0.05);
        this.play('airRatchet', pick(['c', 'd']), 0.3, 0.4);
        this.play('airRatchet', 'b', 0.3, 2.0);
        return;
    }
  }

  /** One burst cut from a recording, `delay` seconds from now. */
  private play<S extends Sound>(sound: S, cue: CueOf<S>, level: number, delay = 0): void {
    const buf = this.bank.get(GARAGE_SOUNDS[sound].id);
    if (!buf) return;
    const [start, len] = (GARAGE_SOUNDS[sound].cues as Record<string, Cue>)[cue as string];
    const mx = this.mx;
    const src = mx.ctx.createBufferSource();
    src.buffer = buf;
    const g = mx.gain(this.amb, level);
    src.connect(g);
    src.start(mx.now + 0.02 + delay, start, len);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
  }
}
