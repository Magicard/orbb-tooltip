import { BrowserWindow, screen } from "electron";
import IpcConstants from "./IpcConstants";

export type QuestScanStatus = {
  active: boolean;
  secondsLeft: number;
  passes: number;
  tasks: number;
};
import { QuestPanelData } from "./TaskData";

declare const QUEST_PANEL_WINDOW_WEBPACK_ENTRY: string;
declare const QUEST_PANEL_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;
const SLIDE_MS = 260;

export type QuestPanelBounds = { y: number; height: number; width: number };

export type QuestPanelBoundsInfo = QuestPanelBounds & {
  minY: number;
  maxY: number;
  minHeight: number;
  maxHeight: number;
  minWidth: number;
  maxWidth: number;
};

// Questie-style quest list floating at the right edge of the screen. Hidden
// (not just off-screen) when closed so it costs nothing while you play;
// click-through unless the cursor hovers it, never takes focus. Can be
// dragged up/down and resized vertically from the page (transparent
// windows cannot use native resizing), and remembers both.
export default class QuestPanelWindow extends BrowserWindow {
  private panelVisible: boolean;
  private hideTimer: NodeJS.Timeout | null;
  private lastData: QuestPanelData | null;
  private panelY: number;
  private panelHeight: number;
  private panelWidth: number;
  // Called with true/false when the panel becomes visible/hidden
  private interactive: boolean;
  public onVisibilityChange: ((visible: boolean) => void) | null;

  constructor(saved?: Partial<QuestPanelBounds>) {
    const workArea = screen.getPrimaryDisplay().workArea;
    const defaultHeight = Math.round(workArea.height * 0.6);
    const width = QuestPanelWindow.clamp(
      saved?.width ?? DEFAULT_WIDTH,
      MIN_WIDTH,
      workArea.width
    );
    const height = QuestPanelWindow.clamp(
      saved?.height ?? defaultHeight,
      MIN_HEIGHT,
      workArea.height
    );
    const y = QuestPanelWindow.clamp(
      saved?.y ?? workArea.y + Math.round(workArea.height * 0.15),
      workArea.y,
      workArea.y + workArea.height - height
    );

    super({
      frame: false,
      transparent: true,
      x: workArea.x + workArea.width - width,
      y,
      width,
      height,
      backgroundColor: "#00000000",
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: QUEST_PANEL_WINDOW_PRELOAD_WEBPACK_ENTRY,
      },
    });

    this.panelVisible = false;
    this.interactive = false;
    this.hideTimer = null;
    this.lastData = null;
    this.panelY = y;
    this.panelHeight = height;
    this.panelWidth = width;
    this.onVisibilityChange = null;

    // Click-through, but forward mouse moves so the page can tell when the
    // cursor is over it and ask to become interactive (see setInteractive)
    this.setIgnoreMouseEvents(true, { forward: true });
    this.setAlwaysOnTop(true, "screen-saver");
    this.loadURL(QUEST_PANEL_WINDOW_WEBPACK_ENTRY);
  }

  static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  isPanelVisible(): boolean {
    return this.panelVisible;
  }

  getPanelBounds(): QuestPanelBounds {
    return { y: this.panelY, height: this.panelHeight, width: this.panelWidth };
  }

  // While the cursor hovers the panel it takes mouse input so the wheel
  // scrolls the list and the handles work; otherwise everything passes
  // through to the game
  setInteractive(enabled: boolean): void {
    if (this.isDestroyed()) return;
    this.interactive = enabled && this.panelVisible;
    this.setIgnoreMouseEvents(!this.interactive, { forward: true });
  }

  // Click-through windows learn the cursor is over them from mouse moves
  // Electron forwards via a low-level hook - which Windows silently drops
  // if the app is ever slow. Dropping and re-arming forwarding reinstalls
  // it; index.ts does this for every overlay window every few seconds.
  // "drop" then "arm" must run on all windows in that order, because the
  // hook is shared and only reinstalled once no window is forwarding.
  forwardingCycle(phase: "drop" | "arm"): void {
    if (this.isDestroyed() || !this.panelVisible || this.interactive) return;
    if (phase === "drop") this.setIgnoreMouseEvents(true);
    else this.setIgnoreMouseEvents(true, { forward: true });
  }

  // Move (y) and/or resize (width/height), clamped to the primary work area;
  // the panel always hugs the right edge
  applyPanelBounds(patch: Partial<QuestPanelBounds>): QuestPanelBoundsInfo {
    const workArea = screen.getPrimaryDisplay().workArea;
    const width = QuestPanelWindow.clamp(
      patch.width ?? this.panelWidth,
      MIN_WIDTH,
      workArea.width
    );
    const height = QuestPanelWindow.clamp(
      patch.height ?? this.panelHeight,
      MIN_HEIGHT,
      workArea.height
    );
    const y = QuestPanelWindow.clamp(
      patch.y ?? this.panelY,
      workArea.y,
      workArea.y + workArea.height - height
    );
    this.panelY = y;
    this.panelHeight = height;
    this.panelWidth = width;
    if (!this.isDestroyed()) {
      this.setBounds({
        x: workArea.x + workArea.width - width,
        y,
        width,
        height,
      });
    }
    const info = this.boundsInfo();
    if (!this.isDestroyed()) {
      this.webContents.send(IpcConstants.QuestPanelBounds, info);
    }
    return info;
  }

  private boundsInfo(): QuestPanelBoundsInfo {
    const workArea = screen.getPrimaryDisplay().workArea;
    return {
      y: this.panelY,
      height: this.panelHeight,
      width: this.panelWidth,
      minY: workArea.y,
      maxY: workArea.y + workArea.height - this.panelHeight,
      minHeight: MIN_HEIGHT,
      maxHeight: workArea.height,
      minWidth: MIN_WIDTH,
      maxWidth: workArea.width,
    };
  }

  sendData(data: QuestPanelData): void {
    this.lastData = data;
    if (!this.isDestroyed()) {
      this.webContents.send(IpcConstants.QuestPanelData, data);
    }
  }

  showPanel(): void {
    if (this.isDestroyed()) return;
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    // Re-dock to the right edge in case resolution/scaling changed
    this.applyPanelBounds({});
    this.panelVisible = true;
    if (this.lastData) {
      this.webContents.send(IpcConstants.QuestPanelData, this.lastData);
    }
    this.showInactive(); // never steal focus from the game
    this.setAlwaysOnTop(true, "screen-saver");
    this.webContents.send(IpcConstants.QuestPanelVisibility, true);
    // Ctrl+wheel scrolling is provided by the OCR helper's hook; the main
    // process enables it while the panel is visible (see index.ts)
    this.onVisibilityChange?.(true);
  }

  // Progress of a Tasks-screen scan session (shown in the panel footer)
  sendScanStatus(status: QuestScanStatus): void {
    if (!this.isDestroyed()) {
      this.webContents.send(IpcConstants.QuestPanelScanStatus, status);
    }
  }

  scrollBy(delta: number): void {
    if (this.isDestroyed() || !this.panelVisible) return;
    this.webContents.send(IpcConstants.QuestPanelScroll, delta);
  }

  hidePanel(): void {
    if (this.isDestroyed()) return;
    this.panelVisible = false;
    this.onVisibilityChange?.(false);
    this.interactive = false;
    this.setIgnoreMouseEvents(true, { forward: true });
    this.webContents.send(IpcConstants.QuestPanelVisibility, false);
    // Let the slide-out animation play, then drop the window entirely
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.isDestroyed()) this.hide();
    }, SLIDE_MS + 40);
  }

  destroyPanel(): void {
    this.onVisibilityChange?.(false);
    if (!this.isDestroyed()) this.destroy();
  }

  toggle(): void {
    if (this.panelVisible) {
      this.hidePanel();
    } else {
      this.showPanel();
    }
  }
}
