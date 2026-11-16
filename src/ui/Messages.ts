import type { Events } from '../core/Events';

const MAX_VISIBLE = 5;
const LIFETIME_MS = 3500;
const FADE_MS = 600;

/** Neon message feed driven by `message` events. Repeated text refreshes instead of stacking. */
export class Messages {
  private feed: HTMLElement;

  constructor(root: HTMLElement, events: Events) {
    this.feed = document.createElement('div');
    this.feed.className = 'msg-feed';
    root.appendChild(this.feed);
    events.on('message', (e) => this.show(e.text, e.tone, e.seconds));
  }

  show(text: string, tone: string, seconds?: number): void {
    for (const m of Array.from(this.feed.children) as HTMLElement[]) {
      if (m.textContent === text && !m.classList.contains('fade')) m.remove();
    }
    const m = document.createElement('div');
    m.className = `msg ${tone}`;
    m.textContent = text;
    this.feed.appendChild(m);
    while (this.feed.children.length > MAX_VISIBLE) this.feed.firstElementChild!.remove();
    setTimeout(() => {
      m.classList.add('fade');
      setTimeout(() => m.remove(), FADE_MS);
    }, seconds !== undefined ? seconds * 1000 : LIFETIME_MS);
  }
}
