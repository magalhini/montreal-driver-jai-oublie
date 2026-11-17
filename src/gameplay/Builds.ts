import { FLEET, type FleetId } from '../vehicles/Fleet';
import { CHARMS, PAINTS, STOCK_BUILD, WHEELS, type CarBuild, type CharmId, type PartKind } from '../vehicles/Tuning';
import { defaultStore, type KeyValueStore } from './Economy';

const BUILDS_KEY = 'neonDriver.builds';
/** Car ids from older saves. */
const LEGACY_IDS: Record<string, FleetId> = { kaze: 'karola' };

interface Saved {
  cars: Partial<Record<FleetId, CarBuild>>;
  /** Charms bought at the pit garage: once bought, any car can hang them. */
  charms: CharmId[];
}

const FREE_CHARMS: CharmId[] = CHARMS.filter((c) => c.price === 0).map((c) => c.id);

/**
 * What the pit garage has done to the player's car (parts, burnout, rims, paint, charm) and the charms the player
 * owns, saved to `localStorage` on every change.
 */
export class Builds {
  private data: Saved;

  constructor(private store: KeyValueStore | null = defaultStore()) {
    this.data = this.load();
  }

  /** This car's build (a copy: change it through `set`). */
  of(id: FleetId): CarBuild {
    return { ...STOCK_BUILD, ...this.data.cars[id] };
  }

  set(id: FleetId, build: CarBuild): void {
    this.data.cars[id] = { ...build };
    this.save();
  }

  level(id: FleetId, kind: PartKind): number {
    return this.of(id)[kind];
  }

  owns(charm: CharmId): boolean {
    return this.data.charms.includes(charm);
  }

  buyCharm(charm: CharmId): void {
    if (this.owns(charm)) return;
    this.data.charms.push(charm);
    this.save();
  }

  /** Back to stock (debug). */
  reset(): void {
    this.data = { cars: {}, charms: [...FREE_CHARMS] };
    this.save();
  }

  private load(): Saved {
    const fresh: Saved = { cars: {}, charms: [...FREE_CHARMS] };
    try {
      const raw = this.store?.getItem(BUILDS_KEY);
      if (!raw) return fresh;
      const v = JSON.parse(raw) as Partial<Saved>;
      const cars: Saved['cars'] = {};
      // Saves from when there were more cars keep only the one that still exists (the Kaze is now the Karola)
      for (const [saved, b] of Object.entries(v.cars ?? {})) {
        const id = LEGACY_IDS[saved] ?? saved;
        if (id in FLEET) cars[id as FleetId] = sanitize(b);
      }
      const charms = (v.charms ?? []).filter((c) => CHARMS.some((k) => k.id === c));
      return { cars, charms: [...new Set([...FREE_CHARMS, ...charms])] };
    } catch {
      return fresh;
    }
  }

  private save(): void {
    try {
      this.store?.setItem(BUILDS_KEY, JSON.stringify(this.data));
    } catch {
      // quota / disabled storage: the build lasts for this session
    }
  }
}

/** Old or hand-edited saves: unknown rims, paints or charms fall back to stock. */
function sanitize(b: Partial<CarBuild>): CarBuild {
  const level = (n: unknown) => (typeof n === 'number' && n >= 0 ? Math.min(3, Math.floor(n)) : 0);
  return {
    engine: level(b.engine),
    weight: level(b.weight),
    handling: level(b.handling),
    brakes: level(b.brakes),
    wheels: WHEELS.some((w) => w.id === b.wheels) ? b.wheels! : 'stock',
    paint: PAINTS.some((p) => p.color === b.paint) ? b.paint! : null,
    charm: CHARMS.some((c) => c.id === b.charm) ? b.charm! : 'cone',
    burnout: b.burnout === true,
  };
}
