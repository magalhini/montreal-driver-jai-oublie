import { CONFIG } from '../config';
import { clamp } from '../core/math';

/** The subset of `localStorage` the economy needs (injectable for tests / other platforms). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const CASH_KEY = 'neonDriver.cash';
export const CURRENCY = '¥';

/** `¥12,300` */
export const formatCash = (amount: number): string => `${CURRENCY}${Math.round(amount).toLocaleString('en-US')}`;

export function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage disabled (privacy mode, sandboxed iframe)
  }
}

/** Fine for getting busted at a given heat (0..1), rounded to 100 yen. */
export function bustFine(heat: number): number {
  return Math.round((CONFIG.FINE_BASE + CONFIG.FINE_PER_HEAT * clamp(heat, 0, 1)) / 100) * 100;
}

/**
 * The player's wallet, in yen, saved to `localStorage` on every change. Systems call `earn` / `charge`
 * directly (nothing else touches cash); the HUD reads `cash`.
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
