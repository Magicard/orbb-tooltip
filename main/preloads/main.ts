import { contextBridge, ipcRenderer } from "electron";
import IpcConstants from "../../models/IpcConstants";
import { UserConfig } from "../../models/UserConfig";
import type { TrackerValidationResult } from "../../models/TaskData";

declare global {
  interface Window {
    electron: {
      receive: (channel: string, listener: any) => void;
      enableTooltips: () => void;
      getUserConfig: () => Promise<UserConfig>;
      setUserConfig: (config: UserConfig) => Promise<boolean>;
      toggleTooltips: (enabled: boolean) => Promise<boolean>;
      toggleFrameless: (enabled: boolean) => Promise<boolean>;
      toggleAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
      getAllItems: () => Promise<any[]>;
      validateApiKey: (apiKey: string) => Promise<boolean>;
      validateTarkovTrackerToken: (
        token: string
      ) => Promise<TrackerValidationResult>;
      refetchItems: () => Promise<boolean>;
      toggleMainWindow: (enabled: boolean) => Promise<boolean>;
      toggleDeleteLowestItem: (enabled: boolean) => Promise<boolean>;
      toggleDeleteLastItem: (enabled: boolean) => Promise<boolean>;
      toggleIncrementLastItem: (enabled: boolean) => Promise<boolean>;
      toggleScreenCalibration: (enabled: boolean) => Promise<boolean>;
      // Exposed by the tooltip window's preload only (see ./tooltip.ts)
      onConfigChanged: (callback: (config: UserConfig) => void) => void;
      reportTooltipSize: (size: { width: number; height: number }) => void;
      // Exposed by the quest panel preload only (see ./questpanel.ts)
      setPanelInteractive: (enabled: boolean) => void;
      setPanelBounds: (
        patch: { y?: number; height?: number; width?: number },
        commit: boolean
      ) => void;
      selectPanelMap: (mapNameId: string | null) => void;
      setPanelOpacity: (opacity: number, commit?: boolean) => void;
      closePanel: () => void;
      toggleMap: () => void;
      toggleScan: () => void;
      requestScanStatus: () => void;
      // Exposed by the map window preload only (see ./map.ts)
      setMapInteractive: (enabled: boolean) => void;
      setMapBounds: (
        patch: { x?: number; y?: number; width?: number; height?: number },
        commit: boolean
      ) => void;
      closeMap: () => void;
    };
  }
}

contextBridge.exposeInMainWorld("electron", {
  receive: (channel: string, listener: any) => {
    ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  enableTooltips: () => {
    ipcRenderer.send(IpcConstants.EnableTooltips);
  },
  getUserConfig: () => {
    return ipcRenderer.invoke(IpcConstants.GetUserConfig);
  },
  setUserConfig: (config: UserConfig) => {
    return ipcRenderer.invoke(IpcConstants.SetUserConfig, config);
  },
  toggleTooltips: (enabled: boolean) => {
    return ipcRenderer.invoke(IpcConstants.ToggleTooltips, enabled);
  },
  toggleFrameless: (enabled: boolean) => {
    return ipcRenderer.invoke(IpcConstants.ToggleFrameless, enabled);
  },
  toggleAlwaysOnTop: (enabled: boolean) => {
    return ipcRenderer.invoke(IpcConstants.ToggleAlwaysOnTop, enabled);
  },
  getAllItems: () => {
    return ipcRenderer.invoke(IpcConstants.GetAllItems);
  },
  validateApiKey: (apiKey: string) => {
    return ipcRenderer.invoke(IpcConstants.ValidateApiKey, apiKey);
  },
  validateTarkovTrackerToken: (token: string) => {
    return ipcRenderer.invoke(IpcConstants.ValidateTarkovTrackerToken, token);
  },
  refetchItems: () => {
    return ipcRenderer.invoke(IpcConstants.RefetchItems);
  },
  toggleMainWindow: (enabled: boolean) => {
    return ipcRenderer.invoke(IpcConstants.ToggleMainWindow, enabled);
  },
  toggleDeleteLowestItem: (enabled: boolean) => {
    return ipcRenderer.invoke(IpcConstants.ToggleDeleteLowestItem, enabled);
  },
  toggleDeleteLastItem: (enabled: boolean) => {
    return ipcRenderer.invoke(IpcConstants.ToggleDeleteLastItem, enabled);
  },
  toggleIncrementLastItem: (enabled: boolean) => {
    return ipcRenderer.invoke(IpcConstants.ToggleIncrementLastItem, enabled);
  },
  toggleScreenCalibration: (enabled: boolean) => {
    return ipcRenderer.invoke(IpcConstants.ToggleScreenCalibration, enabled);
  },
});
