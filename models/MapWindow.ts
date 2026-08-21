import { BrowserWindow, screen } from "electron";
import IpcConstants from "./IpcConstants";

declare const MAP_WINDOW_WEBPACK_ENTRY: string;
declare const MAP_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

export type MapWindowBounds = { x: number; y: number; width: number; height: number };

export type MapWindowData = {
  mapNameId: string | null;
  mapName: string | null;
  // orbbmap:// URL of the image, or null when no image file exists
  imageUrl: string | null;
};

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
// Renderer fade duration (see MapView); the native window is hidden only
// after it, so the last frame Windows keeps for the window is transparent
// and re-showing it cannot flash the old opaque map
const FADE_MS = 150;

// Floating map viewer toggled from the quest panel. Click-through until the
// cursor hovers it; then it can be dragged (top bar), resized (bottom-right
// corner), zoomed (wheel) and panned (drag the image). Hidden when closed.
export default class MapWindow extends BrowserWindow {
  private mapVisible: boolean;
  private bounds: MapWindowBounds;
  private lastData: MapWindowData | null;
  private hideTimer: NodeJS.Timeout | null;
  public onVisibilityChange: ((visible: boolean) => void) | null;

  constructor(saved?: Partial<MapWindowBounds>) {
    const workArea = screen.getPrimaryDisplay().workArea;
    const width = MapWindow.clamp(saved?.width ?? Math.round(workArea.width * 0.4), MIN_WIDTH, workArea.width);
    const height = MapWindow.clamp(saved?.height ?? Math.round(workArea.height * 0.5), MIN_HEIGHT, workArea.height);
    const x = MapWindow.clamp(saved?.x ?? workArea.x + 40, workArea.x, workArea.x + workArea.width - width);
    const y = MapWindow.clamp(saved?.y ?? workArea.y + 40, workArea.y, workArea.y + workArea.height - height);

    super({
      frame: false,
      transparent: true,
      x,
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
        preload: MAP_WINDOW_PRELOAD_WEBPACK_ENTRY,
      },
    });

    this.mapVisible = false;
    this.bounds = { x, y, width, height };
    this.lastData = null;
    this.hideTimer = null;
    this.onVisibilityChange = null;

    this.setIgnoreMouseEvents(true, { forward: true });
    this.setAlwaysOnTop(true, "screen-saver");
    this.loadURL(MAP_WINDOW_WEBPACK_ENTRY);
  }

  static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  isMapVisible(): boolean {
    return this.mapVisible;
  }

  getMapBounds(): MapWindowBounds {
    return { ...this.bounds };
  }

  setInteractive(enabled: boolean): void {
    if (this.isDestroyed()) return;
    this.setIgnoreMouseEvents(!enabled || !this.mapVisible, { forward: true });
  }

  sendData(data: MapWindowData): void {
    this.lastData = data;
    if (!this.isDestroyed()) {
      this.webContents.send(IpcConstants.MapWindowData, data);
    }
  }

  applyBounds(patch: Partial<MapWindowBounds>): MapWindowBounds {
    const workArea = screen.getPrimaryDisplay().workArea;
    const width = MapWindow.clamp(patch.width ?? this.bounds.width, MIN_WIDTH, workArea.width);
    const height = MapWindow.clamp(patch.height ?? this.bounds.height, MIN_HEIGHT, workArea.height);
    const x = MapWindow.clamp(patch.x ?? this.bounds.x, workArea.x, workArea.x + workArea.width - width);
    const y = MapWindow.clamp(patch.y ?? this.bounds.y, workArea.y, workArea.y + workArea.height - height);
    this.bounds = { x, y, width, height };
    if (!this.isDestroyed()) {
      this.setBounds(this.bounds);
      this.webContents.send(IpcConstants.MapWindowBounds, this.bounds);
    }
    return this.bounds;
  }

  showMap(): void {
    if (this.isDestroyed()) return;
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.mapVisible) return;
    this.applyBounds({});
    this.mapVisible = true;
    if (this.lastData) {
      this.webContents.send(IpcConstants.MapWindowData, this.lastData);
    }
    this.showInactive();
    this.setAlwaysOnTop(true, "screen-saver");
    this.webContents.send(IpcConstants.MapWindowVisibility, true);
    this.onVisibilityChange?.(true);
  }

  hideMap(): void {
    if (this.isDestroyed()) return;
    if (!this.mapVisible) return;
    this.mapVisible = false;
    this.setIgnoreMouseEvents(true, { forward: true });
    this.webContents.send(IpcConstants.MapWindowVisibility, false);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.isDestroyed()) this.hide();
    }, FADE_MS + 40);
    this.onVisibilityChange?.(false);
  }

  setOpacity(opacity: number): void {
    if (!this.isDestroyed()) {
      this.webContents.send(IpcConstants.MapWindowOpacity, opacity);
    }
  }

  toggle(): void {
    if (this.mapVisible) this.hideMap();
    else this.showMap();
  }

  destroyMap(): void {
    this.onVisibilityChange?.(false);
    if (!this.isDestroyed()) this.destroy();
  }
}
