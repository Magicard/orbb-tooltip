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
  setPanelInteractive: (enabled: boolean) => {
    ipcRenderer.send(IpcConstants.QuestPanelInteractive, enabled);
  },
  setPanelBounds: (
    patch: { y?: number; height?: number; width?: number },
    commit: boolean
  ) => {
    ipcRenderer.send(IpcConstants.QuestPanelSetBounds, patch, commit);
  },
  selectPanelMap: (mapNameId: string | null) => {
    ipcRenderer.send(IpcConstants.QuestPanelSelectMap, mapNameId);
  },
  setPanelOpacity: (opacity: number, commit = true) => {
    ipcRenderer.send(IpcConstants.QuestPanelOpacity, opacity, commit);
  },
  closePanel: () => {
    ipcRenderer.send(IpcConstants.QuestPanelClose);
  },
  toggleMap: () => {
    ipcRenderer.send(IpcConstants.QuestPanelToggleMap);
  },
  toggleScan: () => {
    ipcRenderer.send(IpcConstants.QuestPanelToggleScan);
  },
  requestScanStatus: () => {
    ipcRenderer.send(IpcConstants.QuestPanelScanStatusRequest);
  },
});
