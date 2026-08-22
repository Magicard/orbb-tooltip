import { BrowserWindow } from "electron";

// Overlay windows are click-through until the main process decides the
// cursor is over them (it polls the cursor rather than trusting window hover
// events, which Windows delivers unreliably to click-through windows - see
// the overlay poll in main/index.ts). Both overlays share that one rule and
// the flag tracking it through this helper.
export default class ClickThrough {
  private interactive = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly isShown: () => boolean
  ) {}

  set(enabled: boolean): void {
    if (this.window.isDestroyed()) return;
    const next = enabled && this.isShown();
    if (next === this.interactive) return;
    this.interactive = next;
    this.window.setIgnoreMouseEvents(!next);
  }

  get(): boolean {
    return this.interactive;
  }

  // Back to click-through, whatever we thought before (window hidden)
  reset(): void {
    this.interactive = false;
    if (!this.window.isDestroyed()) this.window.setIgnoreMouseEvents(true);
  }
}
