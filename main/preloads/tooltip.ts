import { contextBridge, ipcRenderer } from "electron";
import IpcConstants from "../../models/IpcConstants";
import { UserConfig } from "../../models/UserConfig";

// The Window.electron type is declared once in ./main.ts (as the superset
// of both preloads' APIs); this window only exposes the subset below

contextBridge.exposeInMainWorld("electron", {
  receive: (channel: string, listener: any) => {
    ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  getUserConfig: () => {
    return ipcRenderer.invoke(IpcConstants.GetUserConfig);
  },
  onConfigChanged: (callback: (config: UserConfig) => void) => {
    ipcRenderer.on(
      IpcConstants.TooltipConfigChanged,
      (_event, config: UserConfig) => {
        callback(config);
      }
    );
  },
});
