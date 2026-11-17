import { DESTINATION_GARAGE } from '../world/PitStops';
import { MISSION_BRIEF } from '../gameplay/WinterTires';
import './briefing.css';

/**
 * The winter-tire card, up when that drive starts and before the car is released. Enter, the button, or
 * gamepad A starts the drive. Escape, the other button, or gamepad B goes back to the title.
 */
export class Briefing {
  private readonly root: HTMLElement;
  private choice: 'drive' | 'title' | null = null;
  private padA = false;
  private padB = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'briefing';
    this.root.innerHTML = `
      <div class="briefing-card">
        <div class="briefing-kicker">WINTER TIRES</div>
        <h1>December 1st</h1>
        <p class="briefing-where">${DESTINATION_GARAGE} is across town.</p>
        <p class="briefing-body"></p>
        <div class="briefing-actions">
          <button type="button" class="briefing-drive">DRIVE</button>
          <button type="button" class="briefing-back">TITLE</button>
        </div>
        <div class="briefing-hint"><kbd>ENTER</kbd> drive <kbd>ESC</kbd> title</div>
      </div>`;
    this.root.querySelector('.briefing-body')!.textContent = MISSION_BRIEF;
    this.root.querySelector('.briefing-drive')!.addEventListener('click', () => {
      this.choice = 'drive';
    });
    this.root.querySelector('.briefing-back')!.addEventListener('click', () => {
      this.choice = 'title';
    });
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.choice = 'drive';
      }
    });
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return this.root.classList.contains('show');
  }

  show(): void {
    this.choice = null;
    this.padA = false;
    this.padB = false;
    this.root.classList.add('show');
  }

  hide(): void {
    this.root.classList.remove('show');
    this.choice = null;
  }

  /**
   * Once per frame. `escape` is the Escape key this frame (not the pause key). Gamepad A confirms,
   * B returns to the title.
   */
  poll(escape: boolean): 'drive' | 'title' | null {
    if (!this.open) return null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    const a = !!pad?.buttons[0]?.pressed;
    const b = !!pad?.buttons[1]?.pressed;
    if (a && !this.padA) this.choice = 'drive';
    if (b && !this.padB) this.choice = 'title';
    this.padA = a;
    this.padB = b;
    if (escape) this.choice = 'title';
    const choice = this.choice;
    this.choice = null;
    return choice;
  }
}
