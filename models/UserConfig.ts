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
  usePveMode?: boolean;
  showTotalPrice?: boolean;
};
