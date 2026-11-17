import { CONFIG } from '../config';
import { clamp } from '../core/math';

/** The subset of `localStorage` the economy needs (injectable for tests / other platforms). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Renamed when the economy was rebalanced (2 500 $ start), so old 50 000 $ wallets start over. */
const CASH_KEY = 'montrealDriver.cash';
/** Dollar sign. `formatCash` places it after the number (`1 250 $`). */
export const CURRENCY = '$';

const GAP = '\u202f';

/** `1 250 $` — narrow no-break spaces, dollar sign after the number. */
export const formatCash = (amount: number): string => {
  const n = Math.round(amount);
  const body = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, GAP);
  return `${n < 0 ? '-' : ''}${body} $`;
};

/** Bust fine in dollars (PRD 5.7): 75 $ plus 200 $ times heat, rounded to 5 $. */
export const FINE_TUNING = {
  base: 75,
  perHeat: 200,
  step: 5,
};

export function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage disabled (privacy mode, sandboxed iframe)
  }
}

/** Fine for getting busted at a given heat (0..1), in dollars, rounded to `FINE_TUNING.step`. */
export function bustFine(heat: number): number {
  const raw = FINE_TUNING.base + FINE_TUNING.perHeat * clamp(heat, 0, 1);
  const step = FINE_TUNING.step;
  return Math.round(raw / step) * step;
}

/**
 * The player's wallet, saved to `localStorage` on every change. Systems call `earn` / `charge`
 * directly (nothing else touches cash); the HUD, the garage and the bust screen read it through `formatCash`.
 */
export class Economy {
  private value: number;

  constructor(private store: KeyValueStore | null = defaultStore()) {
    this.value = this.load();
  }

  get cash(): number {
    return this.value;
  }
  /** Direct set (debug panel); clamped and saved. */
  set cash(v: number) {
    this.value = Math.max(0, Math.round(v));
    this.save();
  }

  earn(amount: number): void {
    if (amount > 0) this.cash = this.value + amount;
  }

  /** Take money, never below zero. Returns the amount actually taken. */
  charge(amount: number): number {
    const paid = Math.min(this.value, Math.max(0, Math.round(amount)));
    this.cash = this.value - paid;
    return paid;
  }

  /** Back to the starting cash (debug, new career). */
  reset(): void {
    this.cash = CONFIG.START_CASH;
  }

  private load(): number {
    try {
      const raw = this.store?.getItem(CASH_KEY);
      const v = raw == null || raw.trim() === '' ? NaN : Number(raw);
      return Number.isFinite(v) && v >= 0 ? Math.round(v) : CONFIG.START_CASH;
    } catch {
      return CONFIG.START_CASH;
    }
  }

  private save(): void {
    try {
      this.store?.setItem(CASH_KEY, String(this.value));
    } catch {
      // quota / disabled storage: keep playing with in-memory cash
    }
  }
}
