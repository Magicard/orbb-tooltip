import React, { useState, useEffect } from "react";
import {
  UserConfig,
  GameMode,
  GAME_MODE_LABELS,
} from "../../models/UserConfig";

interface SettingsProps {
  onClose: () => void;
  soundEnabled: boolean;
  onSoundEnabledChange: (enabled: boolean) => void;
  soundVolume: number;
  onSoundVolumeChange: (volume: number) => void;
  enableTooltips: boolean;
  onEnableTooltipsChange: (enabled: boolean) => void;
  isFrameless: boolean;
  onIsFramelessChange: (enabled: boolean) => void;
  enableAlwaysOnTop: boolean;
  onEnableAlwaysOnTopChange: (enabled: boolean) => void;
  tarkovMarketApiKey: string;
  onTarkovMarketApiKeyChange: (apiKey: string) => void;
  tarkovTrackerApiToken: string;
  onTarkovTrackerApiTokenChange: (token: string) => void;
  lowestAcceptableScore: number;
  onLowestAcceptableScoreChange: (score: number) => void;
  borderColorRed: number;
  onBorderColorRedChange: (red: number) => void;
  borderColorGreen: number;
  onBorderColorGreenChange: (green: number) => void;
  borderColorBlue: number;
  onBorderColorBlueChange: (blue: number) => void;
  enableMainWindowToggle: boolean;
  onEnableMainWindowToggleChange: (enabled: boolean) => void;
  enableDeleteLowestItem: boolean;
  onEnableDeleteLowestItemChange: (enabled: boolean) => void;
  enableDeleteLastItem: boolean;
  onEnableDeleteLastItemChange: (enabled: boolean) => void;
  enableIncrementLastItem: boolean;
  onEnableIncrementLastItemChange: (enabled: boolean) => void;
  enableScreenCalibration: boolean;
  onEnableScreenCalibrationChange: (enabled: boolean) => void;
  gameMode: GameMode;
  onGameModeChange: (mode: GameMode) => void;
  showPerSlotPrice: boolean;
  onShowPerSlotPriceChange: (enabled: boolean) => void;
  enableQuestPanel: boolean;
  onEnableQuestPanelChange: (enabled: boolean) => void;
  questPanelHotkey: string;
  onQuestPanelHotkeyChange: (hotkey: string) => void;
  eftLogsPath: string;
  onEftLogsPathChange: (path: string) => void;
  questScanHotkey: string;
  onQuestScanHotkeyChange: (hotkey: string) => void;
  mapHotkey: string;
  onMapHotkeyChange: (hotkey: string) => void;
}

export default function Settings({
  onClose,
  soundEnabled,
  onSoundEnabledChange,
  soundVolume,
  onSoundVolumeChange,
  enableTooltips,
  onEnableTooltipsChange,
  isFrameless,
  onIsFramelessChange,
  enableAlwaysOnTop,
  onEnableAlwaysOnTopChange,
  tarkovMarketApiKey,
  onTarkovMarketApiKeyChange,
  tarkovTrackerApiToken,
  onTarkovTrackerApiTokenChange,
  lowestAcceptableScore,
  onLowestAcceptableScoreChange,
  borderColorRed,
  onBorderColorRedChange,
  borderColorGreen,
  onBorderColorGreenChange,
  borderColorBlue,
  onBorderColorBlueChange,
  enableMainWindowToggle,
  onEnableMainWindowToggleChange,
  enableDeleteLowestItem,
  onEnableDeleteLowestItemChange,
  enableDeleteLastItem,
  onEnableDeleteLastItemChange,
  enableIncrementLastItem,
  onEnableIncrementLastItemChange,
  enableScreenCalibration,
  onEnableScreenCalibrationChange,
  gameMode,
  onGameModeChange,
  showPerSlotPrice,
  onShowPerSlotPriceChange,
  enableQuestPanel,
  onEnableQuestPanelChange,
  questPanelHotkey,
  onQuestPanelHotkeyChange,
  eftLogsPath,
  onEftLogsPathChange,
  questScanHotkey,
  onQuestScanHotkeyChange,
  mapHotkey,
  onMapHotkeyChange,
}: SettingsProps) {
  const [localSoundEnabled, setLocalSoundEnabled] = useState(soundEnabled);
  const [localSoundVolume, setLocalSoundVolume] = useState(soundVolume);
  const [localEnableTooltips, setLocalEnableTooltips] =
    useState(enableTooltips);
  const [localIsFrameless, setLocalIsFrameless] = useState(isFrameless);
  const [localEnableAlwaysOnTop, setLocalEnableAlwaysOnTop] =
    useState(enableAlwaysOnTop);
  const [localTarkovMarketApiKey, setLocalTarkovMarketApiKey] =
    useState(tarkovMarketApiKey);
  const [localTarkovTrackerApiToken, setLocalTarkovTrackerApiToken] = useState(
    tarkovTrackerApiToken
  );
  const [localLowestAcceptableScore, setLocalLowestAcceptableScore] =
    useState(lowestAcceptableScore);
  const [localBorderColorRed, setLocalBorderColorRed] = useState(borderColorRed);
  const [localBorderColorGreen, setLocalBorderColorGreen] = useState(borderColorGreen);
  const [localBorderColorBlue, setLocalBorderColorBlue] = useState(borderColorBlue);
  const [localEnableMainWindowToggle, setLocalEnableMainWindowToggle] =
    useState(enableMainWindowToggle);
  const [localEnableDeleteLowestItem, setLocalEnableDeleteLowestItem] =
    useState(enableDeleteLowestItem);
  const [localEnableDeleteLastItem, setLocalEnableDeleteLastItem] =
    useState(enableDeleteLastItem);
  const [localEnableIncrementLastItem, setLocalEnableIncrementLastItem] =
    useState(enableIncrementLastItem);
  const [localEnableScreenCalibration, setLocalEnableScreenCalibration] =
    useState(enableScreenCalibration);
  const [localGameMode, setLocalGameMode] = useState<GameMode>(gameMode);
  const [localShowPerSlotPrice, setLocalShowPerSlotPrice] = useState(showPerSlotPrice);
  const [localEnableQuestPanel, setLocalEnableQuestPanel] = useState(enableQuestPanel);
  const [localQuestPanelHotkey, setLocalQuestPanelHotkey] = useState(questPanelHotkey);
  const [localEftLogsPath, setLocalEftLogsPath] = useState(eftLogsPath);
  const [localQuestScanHotkey, setLocalQuestScanHotkey] = useState(questScanHotkey);
  const [localMapHotkey, setLocalMapHotkey] = useState(mapHotkey);
  const [syncToTracker, setSyncToTracker] = useState(true);
  useEffect(() => {
    window.electron
      .getUserConfig()
      .then((config) => setSyncToTracker(config?.syncToTracker !== false))
      .catch(() => undefined);
  }, []);
  const [isValidatingApiKey, setIsValidatingApiKey] = useState(false);
  const [apiKeyValidationMessage, setApiKeyValidationMessage] = useState("");
  const [isValidatingTrackerToken, setIsValidatingTrackerToken] =
    useState(false);
  const [trackerTokenMessage, setTrackerTokenMessage] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setLocalSoundEnabled(soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    setLocalSoundVolume(soundVolume);
  }, [soundVolume]);

  useEffect(() => {
    setLocalEnableTooltips(enableTooltips);
  }, [enableTooltips]);

  useEffect(() => {
    setLocalIsFrameless(isFrameless);
  }, [isFrameless]);

  useEffect(() => {
    setLocalEnableAlwaysOnTop(enableAlwaysOnTop);
  }, [enableAlwaysOnTop]);

  useEffect(() => {
    setLocalTarkovMarketApiKey(tarkovMarketApiKey);
  }, [tarkovMarketApiKey]);

  useEffect(() => {
    setLocalTarkovTrackerApiToken(tarkovTrackerApiToken);
  }, [tarkovTrackerApiToken]);

  useEffect(() => {
    setLocalLowestAcceptableScore(lowestAcceptableScore);
  }, [lowestAcceptableScore]);

  useEffect(() => {
    setLocalBorderColorRed(borderColorRed);
  }, [borderColorRed]);

  useEffect(() => {
    setLocalBorderColorGreen(borderColorGreen);
  }, [borderColorGreen]);

  useEffect(() => {
    setLocalBorderColorBlue(borderColorBlue);
  }, [borderColorBlue]);

  useEffect(() => {
    setLocalEnableMainWindowToggle(enableMainWindowToggle);
  }, [enableMainWindowToggle]);

  useEffect(() => {
    setLocalEnableDeleteLowestItem(enableDeleteLowestItem);
  }, [enableDeleteLowestItem]);

  useEffect(() => {
    setLocalEnableDeleteLastItem(enableDeleteLastItem);
  }, [enableDeleteLastItem]);

  useEffect(() => {
    setLocalEnableIncrementLastItem(enableIncrementLastItem);
  }, [enableIncrementLastItem]);

  useEffect(() => {
    setLocalEnableScreenCalibration(enableScreenCalibration);
  }, [enableScreenCalibration]);

  useEffect(() => {
    setLocalGameMode(gameMode);
  }, [gameMode]);

  useEffect(() => {
    setLocalShowPerSlotPrice(showPerSlotPrice);
  }, [showPerSlotPrice]);

  useEffect(() => {
    setLocalEnableQuestPanel(enableQuestPanel);
  }, [enableQuestPanel]);

  useEffect(() => {
    setLocalQuestPanelHotkey(questPanelHotkey);
  }, [questPanelHotkey]);

  useEffect(() => {
    setLocalEftLogsPath(eftLogsPath);
  }, [eftLogsPath]);

  useEffect(() => {
    setLocalQuestScanHotkey(questScanHotkey);
  }, [questScanHotkey]);

  useEffect(() => {
    setLocalMapHotkey(mapHotkey);
  }, [mapHotkey]);

  const handleSoundToggle = async (enabled: boolean) => {
    setLocalSoundEnabled(enabled);
    onSoundEnabledChange(enabled);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.soundEnabled = enabled;
      await window.electron.setUserConfig(config);
    } catch (error) {
      console.error("Failed to save user config:", error);
    }
  };

  const handleVolumeChange = async (volume: number) => {
    // Clamp volume between 0 and 1
    const clampedVolume = Math.max(0, Math.min(1, volume));
    setLocalSoundVolume(clampedVolume);
    onSoundVolumeChange(clampedVolume);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.soundVolume = clampedVolume;
      await window.electron.setUserConfig(config);
    } catch (error) {
      console.error("Failed to save user config:", error);
    }
  };

  const handleTooltipsToggle = async (enabled: boolean) => {
    setLocalEnableTooltips(enabled);
    onEnableTooltipsChange(enabled);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.enableTooltips = enabled;
      await window.electron.setUserConfig(config);

      // Immediately toggle tooltips
      await window.electron.toggleTooltips(enabled);
    } catch (error) {
      console.error("Failed to save user config or toggle tooltips:", error);
    }
  };

  const handleFramelessToggle = async (enabled: boolean) => {
    setLocalIsFrameless(enabled);
    onIsFramelessChange(enabled);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.isFrameless = enabled;
      await window.electron.setUserConfig(config);

      // Immediately toggle frameless mode
      await window.electron.toggleFrameless(enabled);
    } catch (error) {
      console.error(
        "Failed to save user config or toggle frameless mode:",
        error
      );
    }
  };

  const handleAlwaysOnTopToggle = async (enabled: boolean) => {
    setLocalEnableAlwaysOnTop(enabled);
    onEnableAlwaysOnTopChange(enabled);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.enableAlwaysOnTop = enabled;
      await window.electron.setUserConfig(config);

      // Immediately toggle always on top
      await window.electron.toggleAlwaysOnTop(enabled);
    } catch (error) {
      console.error(
        "Failed to save user config or toggle always on top:",
        error
      );
    }
  };

  const handleApiKeyValidation = async () => {
    if (!localTarkovMarketApiKey.trim()) {
      setApiKeyValidationMessage("Please enter an API key");
      return;
    }

    setIsValidatingApiKey(true);
    setApiKeyValidationMessage("");

    try {
      const isValid = await window.electron.validateApiKey(localTarkovMarketApiKey.trim());

      if (isValid) {
        // Save to user config
        const config: UserConfig = await window.electron.getUserConfig();
        config.tarkovMarketApiKey = localTarkovMarketApiKey.trim();
        await window.electron.setUserConfig(config);

        // Update parent state
        onTarkovMarketApiKeyChange(localTarkovMarketApiKey.trim());

        // Refetch items with new API key
        await window.electron.refetchItems();

        setApiKeyValidationMessage("✓ API key validated and items updated!");
      } else {
        setApiKeyValidationMessage("✗ Invalid API key");
      }
    } catch (error) {
      console.error("API key validation failed:", error);
      setApiKeyValidationMessage("✗ Validation failed - please try again");
    } finally {
      setIsValidatingApiKey(false);
    }
  };

  const handleApiKeyClear = async () => {
    setLocalTarkovMarketApiKey("");
    onTarkovMarketApiKeyChange("");

    try {
      // Save empty API key to user config
      const config: UserConfig = await window.electron.getUserConfig();
      config.tarkovMarketApiKey = "";
      await window.electron.setUserConfig(config);

      // Refetch items using fallback API
      await window.electron.refetchItems();

      setApiKeyValidationMessage("✓ API key cleared - using Tarkov.dev fallback");
    } catch (error) {
      console.error("Failed to clear API key:", error);
      setApiKeyValidationMessage("✗ Failed to clear API key");
    }
  };

  const handleLowestAcceptableScoreChange = async (score: number) => {
    setLocalLowestAcceptableScore(score);
    onLowestAcceptableScoreChange(score);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.lowestAcceptableScore = score;
      await window.electron.setUserConfig(config);
    } catch (error) {
      console.error("Failed to save user config:", error);
    }
  };

  const handleBorderColorRedChange = async (red: number) => {
    // Clamp value between 0 and 255
    const clampedRed = Math.max(0, Math.min(255, red));
    setLocalBorderColorRed(clampedRed);
    onBorderColorRedChange(clampedRed);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.borderColorRed = clampedRed;
      await window.electron.setUserConfig(config);
    } catch (error) {
      console.error("Failed to save user config:", error);
    }
  };

  const handleBorderColorGreenChange = async (green: number) => {
    // Clamp value between 0 and 255
    const clampedGreen = Math.max(0, Math.min(255, green));
    setLocalBorderColorGreen(clampedGreen);
    onBorderColorGreenChange(clampedGreen);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.borderColorGreen = clampedGreen;
      await window.electron.setUserConfig(config);
    } catch (error) {
      console.error("Failed to save user config:", error);
    }
  };

  const handleBorderColorBlueChange = async (blue: number) => {
    // Clamp value between 0 and 255
    const clampedBlue = Math.max(0, Math.min(255, blue));
    setLocalBorderColorBlue(clampedBlue);
    onBorderColorBlueChange(clampedBlue);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.borderColorBlue = clampedBlue;
      await window.electron.setUserConfig(config);
    } catch (error) {
      console.error("Failed to save user config:", error);
    }
  };

  const handleMainWindowToggle = async (enabled: boolean) => {
    setLocalEnableMainWindowToggle(enabled);
    onEnableMainWindowToggleChange(enabled);

    // Save to user config and toggle hotkey
    try {
      await window.electron.toggleMainWindow(enabled);
    } catch (error) {
      console.error("Failed to toggle main window hotkey:", error);
    }
  };

  const handleDeleteLowestItemToggle = async (enabled: boolean) => {
    setLocalEnableDeleteLowestItem(enabled);
    onEnableDeleteLowestItemChange(enabled);

    // Save to user config and toggle hotkey
    try {
      await window.electron.toggleDeleteLowestItem(enabled);
    } catch (error) {
      console.error("Failed to toggle delete lowest item hotkey:", error);
    }
  };

  const handleDeleteLastItemToggle = async (enabled: boolean) => {
    setLocalEnableDeleteLastItem(enabled);
    onEnableDeleteLastItemChange(enabled);

    // Save to user config and toggle hotkey
    try {
      await window.electron.toggleDeleteLastItem(enabled);
    } catch (error) {
      console.error("Failed to toggle delete last item hotkey:", error);
    }
  };

  const handleIncrementLastItemToggle = async (enabled: boolean) => {
    setLocalEnableIncrementLastItem(enabled);
    onEnableIncrementLastItemChange(enabled);

    // Save to user config and toggle hotkey
    try {
      await window.electron.toggleIncrementLastItem(enabled);
    } catch (error) {
      console.error("Failed to toggle increment last item hotkey:", error);
    }
  };

  const handleScreenCalibrationToggle = async (enabled: boolean) => {
    setLocalEnableScreenCalibration(enabled);
    onEnableScreenCalibrationChange(enabled);

    // Save to user config and toggle hotkey
    try {
      await window.electron.toggleScreenCalibration(enabled);
    } catch (error) {
      console.error("Failed to toggle screen calibration hotkey:", error);
    }
  };

  const handleTrackerTokenConnect = async () => {
    const token = localTarkovTrackerApiToken.trim();
    if (!token) {
      setTrackerTokenMessage("✗ Please enter a token");
      return;
    }

    setIsValidatingTrackerToken(true);
    setTrackerTokenMessage("");

    try {
      const result = await window.electron.validateTarkovTrackerToken(token);
      if (result?.ok) {
        const config: UserConfig = await window.electron.getUserConfig();
        config.tarkovTrackerApiToken = token;
        await window.electron.setUserConfig(config);
        onTarkovTrackerApiTokenChange(token);
        const refetched = await window.electron.refetchItems();

        const who = result.displayName ? ` as ${result.displayName}` : "";
        const level = result.playerLevel
          ? ` (Level ${result.playerLevel})`
          : "";
        let hint = "";
        const tokenMode: GameMode | null =
          result.tokenGameMode === "pve"
            ? "pve"
            : result.tokenGameMode === "season"
              ? "pvp-season"
              : result.tokenGameMode === "pvp"
                ? "regular"
                : null;
        if (tokenMode && tokenMode !== localGameMode) {
          hint = ` — this is a ${GAME_MODE_LABELS[tokenMode]} token: set Game Mode below to ${GAME_MODE_LABELS[tokenMode]} for matching prices`;
        }
        if (result.legacyHost) {
          hint +=
            " — legacy tarkovtracker.io token; tarkovtracker.org is the maintained site";
        }
        if (!refetched) {
          hint += " — price refresh failed, will retry automatically";
        }
        setTrackerTokenMessage(`✓ Connected${who}${level}${hint}`);
      } else if (result?.error === "unavailable") {
        setTrackerTokenMessage(
          "✗ TarkovTracker is unreachable right now — check your connection or try again later"
        );
      } else {
        setTrackerTokenMessage(
          "✗ Token rejected — copy a fresh one from tarkovtracker.org settings"
        );
      }
    } catch (error) {
      console.error("TarkovTracker token validation failed:", error);
      setTrackerTokenMessage("✗ Validation failed, please try again");
    } finally {
      setIsValidatingTrackerToken(false);
    }
  };

  const handleTrackerTokenClear = async () => {
    setLocalTarkovTrackerApiToken("");
    onTarkovTrackerApiTokenChange("");
    setTrackerTokenMessage("");

    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.tarkovTrackerApiToken = "";
      await window.electron.setUserConfig(config);
      const refetched = await window.electron.refetchItems();
      setTrackerTokenMessage(
        refetched
          ? "✓ Disconnected — quest info shown without your progress"
          : "✓ Disconnected — price refresh failed, will retry automatically"
      );
    } catch (error) {
      console.error("Failed to clear TarkovTracker token:", error);
      setTrackerTokenMessage("✗ Failed to clear token");
    }
  };

  const handleGameModeChange = async (mode: GameMode) => {
    const previousMode = localGameMode;
    if (mode === previousMode) return;
    setLocalGameMode(mode);
    onGameModeChange(mode);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.gameMode = mode;
      config.usePveMode = mode === "pve";
      await window.electron.setUserConfig(config);

      // Refetch items for the new mode; revert the selection if the refetch
      // fails so we never silently serve another mode's prices
      const refetched = await window.electron.refetchItems();
      if (!refetched) {
        throw new Error("Refetch with new game mode failed");
      }
    } catch (error) {
      console.error("Failed to save user config or refetch items:", error);
      setLocalGameMode(previousMode);
      onGameModeChange(previousMode);
      try {
        const config: UserConfig = await window.electron.getUserConfig();
        config.gameMode = previousMode;
        config.usePveMode = previousMode === "pve";
        await window.electron.setUserConfig(config);
      } catch (revertError) {
        console.error("Failed to revert game mode config:", revertError);
      }
    }
  };

  const saveQuestPanelConfig = async (patch: Partial<UserConfig>) => {
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      Object.assign(config, patch);
      await window.electron.setUserConfig(config);
    } catch (error) {
      console.error("Failed to save quest panel settings:", error);
    }
  };

  const handleQuestPanelToggle = async (enabled: boolean) => {
    setLocalEnableQuestPanel(enabled);
    onEnableQuestPanelChange(enabled);
    await saveQuestPanelConfig({ enableQuestPanel: enabled });
  };

  const commitQuestPanelHotkey = async () => {
    const hotkey = localQuestPanelHotkey.trim() || "'";
    setLocalQuestPanelHotkey(hotkey);
    onQuestPanelHotkeyChange(hotkey);
    await saveQuestPanelConfig({ questPanelHotkey: hotkey });
  };

  const commitQuestScanHotkey = async () => {
    const hotkey = localQuestScanHotkey.trim() || "]";
    setLocalQuestScanHotkey(hotkey);
    onQuestScanHotkeyChange(hotkey);
    await saveQuestPanelConfig({ questScanHotkey: hotkey });
  };

  const commitMapHotkey = async () => {
    const hotkey = localMapHotkey.trim() || "[";
    setLocalMapHotkey(hotkey);
    onMapHotkeyChange(hotkey);
    await saveQuestPanelConfig({ mapHotkey: hotkey });
  };

  const commitEftLogsPath = async () => {
    const path = localEftLogsPath.trim();
    onEftLogsPathChange(path);
    await saveQuestPanelConfig({ eftLogsPath: path });
  };

  const handleShowPerSlotPriceToggle = async (enabled: boolean) => {
    setLocalShowPerSlotPrice(enabled);
    onShowPerSlotPriceChange(enabled);

    // Save to user config
    try {
      const config: UserConfig = await window.electron.getUserConfig();
      config.showPerSlotPrice = enabled;
      await window.electron.setUserConfig(config);
    } catch (error) {
      console.error("Failed to save user config:", error);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/95 z-50 flex justify-center overflow-y-auto max-h-screen py-4 font-['Bender'] tracking-wide [scrollbar-width:thin] [scrollbar-color:#57534e_transparent]">
      <div className="bg-stone-800/70 border border-stone-700 rounded-lg p-4 max-w-md w-full mx-4 h-fit">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-[11px] uppercase tracking-widest text-stone-400 font-bold">Settings</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHelp(x => !x)}
              className={showHelp ? "bg-stone-50 hover:bg-stone-100 transition-colors p-1 rounded-md" : "bg-stone-800 hover:bg-stone-900 transition-colors p-1 rounded-md"}
              aria-label="Help"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" className={showHelp ? "size-6 fill-stone-800" : "size-6 fill-stone-50"}>
                <path d="M224 224C224 171 267 128 320 128C373 128 416 171 416 224C416 266.7 388.1 302.9 349.5 315.4C321.1 324.6 288 350.7 288 392L288 416C288 433.7 302.3 448 320 448C337.7 448 352 433.7 352 416L352 392C352 390.3 352.6 387.9 355.5 384.7C358.5 381.4 363.4 378.2 369.2 376.3C433.5 355.6 480 295.3 480 224C480 135.6 408.4 64 320 64C231.6 64 160 135.6 160 224C160 241.7 174.3 256 192 256C209.7 256 224 241.7 224 224zM320 576C342.1 576 360 558.1 360 536C360 513.9 342.1 496 320 496C297.9 496 280 513.9 280 536C280 558.1 297.9 576 320 576z"/>
              </svg>
            </button>
            <button
              onClick={onClose}
              className="text-white hover:text-stone-300 transition-colors"
              aria-label="Close settings"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        {/* Help Modal */}
      {showHelp ? (
        <div className="text-white space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">Keyboard Shortcuts</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="font-bold">F1</span>
                <span>Toggle main window visibility</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">F2</span>
                <span>Delete lowest value item</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">F3</span>
                <span>Delete last scanned item</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">F4</span>
                <span>Add +1 to last scanned item count</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">F6</span>
                <span>Start scanning calibration</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">Need help?</h3>
            <p className="text-sm text-stone-300">
              For help or more info about the project, see <a href="https://github.com/Magicard/orbb-tooltip" target="_blank" rel="noreferrer" className="text-green-500 hover:text-green-600">github.com/Magicard/orbb-tooltip</a>
            </p>
          </div>

          <div className="border-t border-stone-600 pt-4">
            <p className="text-sm text-stone-400 text-center">
              Made by Sammer
            </p>
          </div>
        </div> ) : (
          <div className="text-white space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label
                  htmlFor="sound-toggle"
                  className="text-sm font-medium cursor-pointer"
                >
                  Sound Effects
                </label>
                <p className="text-xs text-stone-400">
                  Play a sound when items are scanned
                </p>
              </div>
              <button
                id="sound-toggle"
                onClick={() => handleSoundToggle(!localSoundEnabled)}
                className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                  localSoundEnabled ? "bg-green-500" : "bg-stone-600"
                }`}
                role="switch"
                aria-checked={localSoundEnabled}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    localSoundEnabled ? "translate-x-[22px]" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Volume Slider */}
            {localSoundEnabled && (
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="volume-slider"
                    className="text-sm font-medium"
                  >
                    Volume
                  </label>
                  <span className="text-sm text-stone-400">
                    {Math.round(localSoundVolume * 100)}%
                  </span>
                </div>
                <input
                  id="volume-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={localSoundVolume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                  style={{
                    background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                      localSoundVolume * 100
                    }%, #404040 ${localSoundVolume * 100}%, #404040 100%)`,
                  }}
                />
              </div>
            )}

            {/* Enable Tooltips Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label
                  htmlFor="tooltips-toggle"
                  className="text-sm font-medium cursor-pointer"
                >
                  Enable Tooltips
                </label>
                <p className="text-xs text-stone-400">
                  Show item price tooltips when hovering over items in-game
                </p>
              </div>
              <button
                id="tooltips-toggle"
                onClick={() => handleTooltipsToggle(!localEnableTooltips)}
                className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                  localEnableTooltips ? "bg-green-500" : "bg-stone-600"
                }`}
                role="switch"
                aria-checked={localEnableTooltips}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    localEnableTooltips ? "translate-x-[22px]" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Frameless Mode Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label
                  htmlFor="frameless-toggle"
                  className="text-sm font-medium cursor-pointer"
                >
                  Frameless Mode
                </label>
                <p className="text-xs text-stone-400">
                  Hide the window frame and title bar
                </p>
              </div>
              <button
                id="frameless-toggle"
                onClick={() => handleFramelessToggle(!localIsFrameless)}
                className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                  localIsFrameless ? "bg-green-500" : "bg-stone-600"
                }`}
                role="switch"
                aria-checked={localIsFrameless}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    localIsFrameless ? "translate-x-[22px]" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Always On Top Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label
                  htmlFor="alwaysontop-toggle"
                  className="text-sm font-medium cursor-pointer"
                >
                  Always On Top
                </label>
                <p className="text-xs text-stone-400">
                  Keep the application window above all other windows. Toggle off and on to force refresh.
                </p>
              </div>
              <button
                id="alwaysontop-toggle"
                onClick={() => handleAlwaysOnTopToggle(!localEnableAlwaysOnTop)}
                className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                  localEnableAlwaysOnTop ? "bg-green-500" : "bg-stone-600"
                }`}
                role="switch"
                aria-checked={localEnableAlwaysOnTop}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    localEnableAlwaysOnTop ? "translate-x-[22px]" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Tarkov Market API Key */}
            <div className="space-y-2">
              <div>
                <label
                  htmlFor="api-key-input"
                  className="text-sm font-medium"
                >
                  Tarkov Market API Key
                </label>
                <p className="text-xs text-stone-400">
                  Enter your Tarkov Market API key (optional)
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  id="api-key-input"
                  type="password"
                  value={localTarkovMarketApiKey}
                  onChange={(e) => setLocalTarkovMarketApiKey(e.target.value)}
                  placeholder="Enter API key..."
                  className="flex-1 px-3 w-[105px] py-1 bg-stone-700 border border-stone-600 rounded-md text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <button
                  onClick={handleApiKeyValidation}
                  disabled={isValidatingApiKey}
                  className={`px-4 py-1 rounded-md font-medium transition-colors ${
                    isValidatingApiKey
                      ? "bg-stone-600 text-stone-400 cursor-not-allowed"
                      : "bg-green-500 hover:bg-green-600 text-white"
                  }`}
                >
                  {isValidatingApiKey ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="size-5 animate-spin fill-white"><path opacity=".4" fill="currentColor" d="M0 256c0 141.4 114.6 256 256 256 107.8 0 200-66.6 237.8-160.9-6.6 16.4-25.2 24.4-41.6 17.8s-24.4-25.2-17.8-41.7C406.1 398 336.9 448 256 448 150 448 64 362 64 256S150 64 256 64c9.3 0 18.5 .7 27.5 1.9-17.5-2.5-29.6-18.7-27.1-36.2 2.5-17.2 18.2-29.3 35.4-27.3-11.7-1.6-23.6-2.5-35.8-2.5-141.4 0-256 114.6-256 256z"/><path fill="currentColor" d="M256.3 29.7c2.5-17.5 18.7-29.6 36.2-27.1 124.1 17.8 219.5 124.4 219.5 253.4 0 33.5-6.5 65.6-18.2 95.1-6.6 16.4-25.2 24.4-41.6 17.8s-24.4-25.2-17.8-41.6c8.8-22 13.7-46 13.7-71.3 0-96.7-71.5-176.7-164.5-190.1-17.5-2.5-29.6-18.7-27.1-36.2z"/></svg>
                  ) : <svg xmlns="http://www.w3.org/2000/svg" className="size-5 fill-white" viewBox="0 0 640 640"><path d="M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z"/></svg>}
                </button>
                <button
                  onClick={handleApiKeyClear}
                  className="px-4 py-1 rounded-md font-medium transition-colors bg-red-500 hover:bg-red-600 text-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" className="size-5 fill-white"><path d="M210.5 480L333.5 480L398.8 414.7L225.3 241.2L98.6 367.9L210.6 479.9zM256 544L210.5 544C193.5 544 177.2 537.3 165.2 525.3L49 409C38.1 398.1 32 383.4 32 368C32 352.6 38.1 337.9 49 327L295 81C305.9 70.1 320.6 64 336 64C351.4 64 366.1 70.1 377 81L559 263C569.9 273.9 576 288.6 576 304C576 319.4 569.9 334.1 559 345L424 480L544 480C561.7 480 576 494.3 576 512C576 529.7 561.7 544 544 544L256 544z"/></svg>
                </button>
              </div>
              {apiKeyValidationMessage && (
                <p className={`text-sm ${
                  apiKeyValidationMessage.includes("✓")
                    ? "text-green-400"
                    : "text-red-400"
                }`}>
                  {apiKeyValidationMessage}
                </p>
              )}
            </div>

            {/* TarkovTracker Sync */}
            <div className="space-y-2">
              <div>
                <label
                  htmlFor="tracker-token-input"
                  className="text-sm font-medium"
                >
                  TarkovTracker Sync
                </label>
                <p className="text-xs text-stone-400">
                  Tooltips show whether an item is needed for your current
                  quests or future ones. Create a free API token at{" "}
                  <a
                    href="https://tarkovtracker.org/settings"
                    target="_blank"
                    rel="noreferrer"
                    className="text-green-500 hover:text-green-600"
                  >
                    tarkovtracker.org/settings
                  </a>{" "}
                  and paste it here.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  id="tracker-token-input"
                  type="password"
                  value={localTarkovTrackerApiToken}
                  onChange={(e) => setLocalTarkovTrackerApiToken(e.target.value)}
                  placeholder="Paste TarkovTracker token..."
                  className="flex-1 px-3 w-[105px] py-1 bg-stone-700 border border-stone-600 rounded-md text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <button
                  onClick={handleTrackerTokenConnect}
                  disabled={isValidatingTrackerToken}
                  className={`px-4 py-1 rounded-md font-medium transition-colors ${
                    isValidatingTrackerToken
                      ? "bg-stone-600 text-stone-400 cursor-not-allowed"
                      : "bg-green-500 hover:bg-green-600 text-white"
                  }`}
                >
                  {isValidatingTrackerToken ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="size-5 animate-spin fill-white"><path opacity=".4" fill="currentColor" d="M0 256c0 141.4 114.6 256 256 256 107.8 0 200-66.6 237.8-160.9-6.6 16.4-25.2 24.4-41.6 17.8s-24.4-25.2-17.8-41.7C406.1 398 336.9 448 256 448 150 448 64 362 64 256S150 64 256 64c9.3 0 18.5 .7 27.5 1.9-17.5-2.5-29.6-18.7-27.1-36.2 2.5-17.2 18.2-29.3 35.4-27.3-11.7-1.6-23.6-2.5-35.8-2.5-141.4 0-256 114.6-256 256z"/><path fill="currentColor" d="M256.3 29.7c2.5-17.5 18.7-29.6 36.2-27.1 124.1 17.8 219.5 124.4 219.5 253.4 0 33.5-6.5 65.6-18.2 95.1-6.6 16.4-25.2 24.4-41.6 17.8s-24.4-25.2-17.8-41.6c8.8-22 13.7-46 13.7-71.3 0-96.7-71.5-176.7-164.5-190.1-17.5-2.5-29.6-18.7-27.1-36.2z"/></svg>
                  ) : <svg xmlns="http://www.w3.org/2000/svg" className="size-5 fill-white" viewBox="0 0 640 640"><path d="M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z"/></svg>}
                </button>
                <button
                  onClick={handleTrackerTokenClear}
                  disabled={isValidatingTrackerToken}
                  className={`px-4 py-1 rounded-md font-medium transition-colors ${
                    isValidatingTrackerToken
                      ? "bg-stone-600 text-stone-400 cursor-not-allowed"
                      : "bg-red-500 hover:bg-red-600 text-white"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" className="size-5 fill-white"><path d="M210.5 480L333.5 480L398.8 414.7L225.3 241.2L98.6 367.9L210.6 479.9zM256 544L210.5 544C193.5 544 177.2 537.3 165.2 525.3L49 409C38.1 398.1 32 383.4 32 368C32 352.6 38.1 337.9 49 327L295 81C305.9 70.1 320.6 64 336 64C351.4 64 366.1 70.1 377 81L559 263C569.9 273.9 576 288.6 576 304C576 319.4 569.9 334.1 559 345L424 480L544 480C561.7 480 576 494.3 576 512C576 529.7 561.7 544 544 544L256 544z"/></svg>
                </button>
              </div>
              {trackerTokenMessage && (
                <p className={`text-sm ${
                  trackerTokenMessage.includes("✓")
                    ? "text-green-400"
                    : "text-red-400"
                }`}>
                  {trackerTokenMessage}
                </p>
              )}
            </div>

            {/* Push progress to TarkovTracker */}
            <div className="flex items-center justify-between">
              <div>
                <label htmlFor="sync-to-tracker-toggle" className="text-sm font-medium cursor-pointer">
                  Push Progress to TarkovTracker
                </label>
                <p className="text-xs text-stone-400">
                  Hand-ins from the game's logs and progress read off the Tasks screen are sent to
                  your tracker (needs a token with the WP permission). Only new progress is ever sent.
                </p>
              </div>
              <button
                id="sync-to-tracker-toggle"
                onClick={() => {
                  const next = !syncToTracker;
                  setSyncToTracker(next);
                  void saveQuestPanelConfig({ syncToTracker: next });
                }}
                className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                  syncToTracker ? "bg-green-500" : "bg-stone-600"
                }`}
                role="switch"
                aria-checked={syncToTracker}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    syncToTracker ? "translate-x-[22px]" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Game Mode */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-sm font-medium">Game Mode</span>
                <p className="text-xs text-stone-400">
                  Which flea market to price from: regular PvP, the seasonal PvP wipe, or PvE (tarkov.dev data only)
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label="Game mode"
                className="inline-flex shrink-0 rounded-md overflow-hidden border border-stone-600"
              >
                {(Object.keys(GAME_MODE_LABELS) as GameMode[]).map((mode) => (
                  <button
                    key={mode}
                    role="radio"
                    aria-checked={localGameMode === mode}
                    onClick={() => handleGameModeChange(mode)}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      localGameMode === mode
                        ? "bg-green-500 text-white"
                        : "bg-stone-700 text-stone-300 hover:bg-stone-600"
                    }`}
                  >
                    {GAME_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>

            {/* Quest Panel */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label
                    htmlFor="questpanel-toggle"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Quest Panel
                  </label>
                  <p className="text-xs text-stone-400">
                    Press the hotkey in raid to slide in your active quests for the current map (needs TarkovTracker)
                  </p>
                </div>
                <button
                  id="questpanel-toggle"
                  onClick={() => handleQuestPanelToggle(!localEnableQuestPanel)}
                  className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                    localEnableQuestPanel ? "bg-green-500" : "bg-stone-600"
                  }`}
                  role="switch"
                  aria-checked={localEnableQuestPanel}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      localEnableQuestPanel ? "translate-x-[22px]" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              <div className="flex gap-2 items-center">
                <label htmlFor="questpanel-hotkey" className="text-xs text-stone-400 w-24 shrink-0">
                  Hotkey
                </label>
                <input
                  id="questpanel-hotkey"
                  type="text"
                  value={localQuestPanelHotkey}
                  onChange={(e) => setLocalQuestPanelHotkey(e.target.value)}
                  onBlur={commitQuestPanelHotkey}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  placeholder="'"
                  className="w-24 px-3 py-1 bg-stone-700 border border-stone-600 rounded-md text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <span className="text-xs text-stone-500">e.g. ' or # or F8</span>
              </div>
              <div className="flex gap-2 items-center">
                <label htmlFor="questscan-hotkey" className="text-xs text-stone-400 w-24 shrink-0">
                  Scan hotkey
                </label>
                <input
                  id="questscan-hotkey"
                  type="text"
                  value={localQuestScanHotkey}
                  onChange={(e) => setLocalQuestScanHotkey(e.target.value)}
                  onBlur={commitQuestScanHotkey}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  placeholder="]"
                  className="w-24 px-3 py-1 bg-stone-700 border border-stone-600 rounded-md text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <span className="text-xs text-stone-500">press it on the game's Tasks screen to read progress</span>
              </div>
              <div className="flex gap-2 items-center">
                <label htmlFor="map-hotkey" className="text-xs text-stone-400 w-24 shrink-0">
                  Map hotkey
                </label>
                <input
                  id="map-hotkey"
                  type="text"
                  value={localMapHotkey}
                  onChange={(e) => setLocalMapHotkey(e.target.value)}
                  onBlur={commitMapHotkey}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  placeholder="["
                  className="w-24 px-3 py-1 bg-stone-700 border border-stone-600 rounded-md text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <span className="text-xs text-stone-500">show / hide the map window (also the Map button on the panel)</span>
              </div>
              <div className="flex gap-2 items-center">
                <label htmlFor="eft-logs-path" className="text-xs text-stone-400 w-24 shrink-0">
                  EFT logs folder
                </label>
                <input
                  id="eft-logs-path"
                  type="text"
                  value={localEftLogsPath}
                  onChange={(e) => setLocalEftLogsPath(e.target.value)}
                  onBlur={commitEftLogsPath}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  placeholder="C:\\Battlestate Games\\Escape from Tarkov\\Logs"
                  className="flex-1 px-3 py-1 bg-stone-700 border border-stone-600 rounded-md text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Show Total Price Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label
                  htmlFor="show-per-slot-price-toggle"
                  className="text-sm font-medium cursor-pointer"
                >
                  Show Price Per Slot
                </label>
                <p className="text-xs text-stone-400">
                  Tooltips always show what the whole item sells for; this adds the value per inventory slot for items bigger than 1x1
                </p>
              </div>
              <button
                id="show-per-slot-price-toggle"
                onClick={() => handleShowPerSlotPriceToggle(!localShowPerSlotPrice)}
                className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                  localShowPerSlotPrice ? "bg-green-500" : "bg-stone-600"
                }`}
                role="switch"
                aria-checked={localShowPerSlotPrice}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    localShowPerSlotPrice ? "translate-x-[22px]" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Lowest Acceptable Score Slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="score-slider"
                  className="text-sm font-medium"
                >
                  Search Sensitivity
                </label>
                <span className="text-sm text-stone-400">
                  {localLowestAcceptableScore}
                </span>
              </div>
              <p className="text-xs text-stone-400">
                Lower = more results (potentially wrong), Higher = more accurate results (fewer matches)
              </p>
              <input
                id="score-slider"
                type="range"
                min="5"
                max="200"
                step="1"
                value={localLowestAcceptableScore}
                onChange={(e) => handleLowestAcceptableScoreChange(parseInt(e.target.value))}
                className="w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                style={{
                  background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                    localLowestAcceptableScore / 2
                  }%, #404040 ${localLowestAcceptableScore / 2}%, #404040 100%)`,
                }}
              />
            </div>

            {/* Border Color RGB Inputs */}
            <div className="space-y-1">
              <label className="text-sm font-medium">
                Border Color Override
              </label>
              <p className="text-xs text-stone-400">
                Override the default border color used for scanning (RGB values 0-255, <span className="font-bold">requires restart</span>)
              </p>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <label htmlFor="border-red" className="block text-sm text-stone-300">
                    Red
                  </label>
                  <input
                    id="border-red"
                    type="number"
                    min="0"
                    max="255"
                    value={localBorderColorRed}
                    onChange={(e) => handleBorderColorRedChange(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-stone-700 border border-stone-600 rounded-md text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="border-green" className="block text-sm text-stone-300">
                    Green
                  </label>
                  <input
                    id="border-green"
                    type="number"
                    min="0"
                    max="255"
                    value={localBorderColorGreen}
                    onChange={(e) => handleBorderColorGreenChange(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-stone-700 border border-stone-600 rounded-md text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div className="flex-1">
                <label htmlFor="border-blue" className="block text-sm text-stone-300">
                    Blue
                  </label>
                  <input
                    id="border-blue"
                    type="number"
                    min="0"
                    max="255"
                    value={localBorderColorBlue}
                    onChange={(e) => handleBorderColorBlueChange(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-stone-700 border border-stone-600 rounded-md text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Hotkey Toggles */}
            <div className="space-y-3">
              {/* Main Window Toggle (F1) */}
              <div className="flex items-center justify-between">
                <div>
                  <label
                    htmlFor="mainwindow-toggle"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Main Window Toggle (F1)
                  </label>
                  <p className="text-xs text-stone-400">
                    Toggle main window visibility
                  </p>
                </div>
                <button
                  id="mainwindow-toggle"
                  onClick={() => handleMainWindowToggle(!localEnableMainWindowToggle)}
                  className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                    localEnableMainWindowToggle ? "bg-green-500" : "bg-stone-600"
                  }`}
                  role="switch"
                  aria-checked={localEnableMainWindowToggle}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      localEnableMainWindowToggle ? "translate-x-[22px]" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Delete Lowest Item (F2) */}
              <div className="flex items-center justify-between">
                <div>
                  <label
                    htmlFor="deletelowest-toggle"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Delete Lowest Item (F2)
                  </label>
                  <p className="text-xs text-stone-400">
                    Delete the lowest value item from the list
                  </p>
                </div>
                <button
                  id="deletelowest-toggle"
                  onClick={() => handleDeleteLowestItemToggle(!localEnableDeleteLowestItem)}
                  className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                    localEnableDeleteLowestItem ? "bg-green-500" : "bg-stone-600"
                  }`}
                  role="switch"
                  aria-checked={localEnableDeleteLowestItem}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      localEnableDeleteLowestItem ? "translate-x-[22px]" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Delete Last Item (F3) */}
              <div className="flex items-center justify-between">
                <div>
                  <label
                    htmlFor="deletelast-toggle"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Delete Last Item (F3)
                  </label>
                  <p className="text-xs text-stone-400">
                    Delete the most recently scanned item
                  </p>
                </div>
                <button
                  id="deletelast-toggle"
                  onClick={() => handleDeleteLastItemToggle(!localEnableDeleteLastItem)}
                  className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                    localEnableDeleteLastItem ? "bg-green-500" : "bg-stone-600"
                  }`}
                  role="switch"
                  aria-checked={localEnableDeleteLastItem}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      localEnableDeleteLastItem ? "translate-x-[22px]" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Increment Last Item (F4) */}
              <div className="flex items-center justify-between">
                <div>
                  <label
                    htmlFor="incrementlast-toggle"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Increment Last Item (F4)
                  </label>
                  <p className="text-xs text-stone-400">
                    Add +1 to the most recently scanned item count
                  </p>
                </div>
                <button
                  id="incrementlast-toggle"
                  onClick={() => handleIncrementLastItemToggle(!localEnableIncrementLastItem)}
                  className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                    localEnableIncrementLastItem ? "bg-green-500" : "bg-stone-600"
                  }`}
                  role="switch"
                  aria-checked={localEnableIncrementLastItem}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      localEnableIncrementLastItem ? "translate-x-[22px]" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Screen Calibration (F6) */}
              <div className="flex items-center justify-between">
                <div>
                  <label
                    htmlFor="screencalibration-toggle"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Screen Calibration (F6)
                  </label>
                  <p className="text-xs text-stone-400">
                    Start the scanning calibration process
                  </p>
                </div>
                <button
                  id="screencalibration-toggle"
                  onClick={() => handleScreenCalibrationToggle(!localEnableScreenCalibration)}
                  className={`relative inline-flex h-5 w-10 min-w-10 items-center rounded-full transition-colors ${
                    localEnableScreenCalibration ? "bg-green-500" : "bg-stone-600"
                  }`}
                  role="switch"
                  aria-checked={localEnableScreenCalibration}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      localEnableScreenCalibration ? "translate-x-[22px]" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
