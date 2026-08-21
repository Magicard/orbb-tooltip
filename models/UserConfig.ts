// json.tarkov.dev game modes: regular PvP, the seasonal PvP wipe, and PvE
export type GameMode = "regular" | "pvp-season" | "pve";

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  regular: "PvP",
  "pvp-season": "Season PvP",
  pve: "PvE",
};

// gameMode wins; usePveMode is the pre-seasonal setting kept for old configs
export function getGameMode(config: UserConfig | null | undefined): GameMode {
  if (config?.gameMode) return config.gameMode;
  return config?.usePveMode ? "pve" : "regular";
}

export type UserConfig = {
  mainWindow: {
    width: number;
    height: number;
    x: number | null;
    y: number | null;
  };
  soundEnabled?: boolean;
  soundVolume?: number; // 0.0 to 1.0
  enableTooltips?: boolean;
  isFrameless?: boolean;
  enableAlwaysOnTop?: boolean;
  tarkovMarketApiKey?: string;
  tarkovTrackerApiToken?: string;
  lowestAcceptableScore?: number;
  borderColorRed?: number; // 0-255
  borderColorGreen?: number; // 0-255
  borderColorBlue?: number; // 0-255
  enableMainWindowToggle?: boolean;
  enableDeleteLowestItem?: boolean;
  enableDeleteLastItem?: boolean;
  enableIncrementLastItem?: boolean;
  enableScreenCalibration?: boolean;
  usePveMode?: boolean; // superseded by gameMode, kept for old configs
  gameMode?: GameMode;
  showPerSlotPrice?: boolean; // also show the per-slot value for items bigger than 1x1
  // In-raid quest panel (Questie-style list toggled by a hotkey)
  enableQuestPanel?: boolean;
  questPanelHotkey?: string; // Electron accelerator, e.g. "'" or "#"
  eftLogsPath?: string; // empty = default install location
  questPanelY?: number; // remembered panel position (DIP)
  questPanelHeight?: number; // remembered panel height (DIP)
  questPanelWidth?: number; // remembered panel width (DIP)
  questPanelOpacity?: number; // 0.3 - 1, background opacity
  questScanHotkey?: string; // scan the in-game Tasks screen, default "]"
  mapHotkey?: string; // toggle the map window, default "["
  mapWindowBounds?: { x: number; y: number; width: number; height: number };
};

export const DEFAULT_QUEST_PANEL_HOTKEY = "'";
export const DEFAULT_QUEST_SCAN_HOTKEY = "]";
export const DEFAULT_MAP_HOTKEY = "[";
