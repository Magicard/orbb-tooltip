import { app } from "electron";
import fs from "fs";
import { UserConfig } from "../../models/UserConfig";

export function getUserConfigData(): UserConfig {
  const userDataPath = app.getPath("userData");

  if (userConfigFileDoesNotExist(userDataPath)) {
    createUserConfigFile(userDataPath);
  }

  const fileData = fs.readFileSync(`${userDataPath}/user-config.json`, {
    encoding: "utf-8",
  });
  const userConfig: UserConfig = JSON.parse(fileData);
  return userConfig;
}

export function setUserConfigData(userConfig: UserConfig): void {
  const userDataPath = app.getPath("userData");
  if (userConfigFileDoesNotExist(userDataPath)) {
    createUserConfigFile(userDataPath);
  }

  const userData = JSON.stringify(userConfig);
  fs.writeFileSync(`${userDataPath}/user-config.json`, userData);
}

function userConfigFileDoesNotExist(userDataPath: string): boolean {
  return !fs.existsSync(`${userDataPath}/user-config.json`);
}

function createUserConfigFile(userDataPath: string): void {
  const newUserConfig: UserConfig = {
    mainWindow: {
      width: 600,
      height: 400,
      x: null,
      y: null,
    },
    soundEnabled: false,
    soundVolume: 1.0,
    enableTooltips: false,
    isFrameless: false,
    enableAlwaysOnTop: false,
    tarkovMarketApiKey: "",
    tarkovTrackerApiToken: "",
    borderColorRed: 82,
    borderColorGreen: 89,
    borderColorBlue: 90,
    enableMainWindowToggle: true,
    enableDeleteLowestItem: true,
    enableDeleteLastItem: true,
    enableIncrementLastItem: true,
    enableScreenCalibration: true,
    usePveMode: false,
    gameMode: "regular",
    showPerSlotPrice: true,
    enableQuestPanel: true,
    questPanelHotkey: "'",
    eftLogsPath: "",
    questScanHotkey: "]",
    mapHotkey: "[",
  };

  fs.writeFileSync(
    `${userDataPath}/user-config.json`,
    JSON.stringify(newUserConfig)
  );
}
