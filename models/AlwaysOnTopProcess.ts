import { BrowserWindow } from "electron";
import TooltipWindow from "./TooltipWindow";

// Keeps the price-list window above the game. Upstream shelled out to
// setalwaysontop.exe, which located the windows by their (hardcoded) titles
// and called SetWindowPos(HWND_TOPMOST) - exactly what Electron's own
// setAlwaysOnTop does, without depending on window titles.
//
// The tooltip overlay is always on top regardless (see TooltipWindow);
// this only applies the user's "Always on top" setting to the main window.
export default class AlwaysOnTopProcess {
  initialize(): void {
    this.apply(true);
  }

  disable(): void {
    this.apply(false);
  }

  private apply(enabled: boolean): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win instanceof TooltipWindow) continue;
      win.setAlwaysOnTop(enabled, "screen-saver");
    }
    console.log(
      enabled ? "Main window set as top most" : "Main window no longer top most"
    );
  }
}
