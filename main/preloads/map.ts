import { contextBridge, ipcRenderer } from "electron";
import IpcConstants from "../../models/IpcConstants";

// The Window.electron type is declared once in ./main.ts (as the superset
// of all preloads' APIs); this window only exposes the subset below
contextBridge.exposeInMainWorld("electron", {
  receive: (channel: string, listener: any) => {
    ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  getUserConfig: () => {
    return ipcRenderer.invoke(IpcConstants.GetUserConfig);
  },
  setMapBounds: (
    patch: { x?: number; y?: number; width?: number; height?: number },
    commit: boolean
  ) => {
    ipcRenderer.send(IpcConstants.MapWindowSetBounds, patch, commit);
  },
  closeMap: () => {
    ipcRenderer.send(IpcConstants.MapWindowClose);
  },
});
