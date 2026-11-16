import type { GameEvent } from '../types';

type EventOf<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;
type Handler<T extends GameEvent['type']> = (e: EventOf<T>) => void;

export class Events {
  private handlers = new Map<string, Set<(e: GameEvent) => void>>();

  on<T extends GameEvent['type']>(type: T, fn: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const h = fn as (e: GameEvent) => void;
    set.add(h);
    return () => set!.delete(h);
  }

  emit(e: GameEvent): void {
    const set = this.handlers.get(e.type);
    if (set) for (const h of set) h(e);
  }

  message(text: string, tone: EventOf<'message'>['tone'] = 'info', seconds?: number): void {
    this.emit({ type: 'message', text, tone, seconds });
  }
}
