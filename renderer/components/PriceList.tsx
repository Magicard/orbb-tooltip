import { useEffect, useRef, useState, useReducer, useMemo } from "react";
import {
  IN_SCREEN_CONFIG,
  NO_SCANNING_CONFIG_FOUND,
  PRICE_LIST,
  removeItemFromPriceList,
  SCREEN_CONFIG_STEP,
  ITEM_DATABASE_STATUS,
  TRIGGER_SOUND_ON_SCAN_BIT,
  TRIGGER_SOUND_ON_UP_BIT,
  TRIGGER_SOUND_ON_EXISTS_BIT,
} from "../state/priceList";
import { ImmutableObject, useHookstate } from "@hookstate/core";
import {
  classNames,
  getItemsPricePerSlot,
  numberWithCommas,
} from "../../utils";
import { ClientItem } from "../../models/Item";
import MostRecentItem from "../components/MostRecentItem";
import NumberFlow, { useCanAnimate } from "@number-flow/react";
import ScannedSound from "../assets/item-scanned.wav";
import UppedSound from "../assets/item-upped.wav";
import ItemExistsSound from "../assets/item-exists.wav";
import Settings from "./Settings";
import {
  GameMode,
  getGameMode,
  DEFAULT_QUEST_PANEL_HOTKEY,
  DEFAULT_QUEST_SCAN_HOTKEY,
  DEFAULT_MAP_HOTKEY,
} from "../../models/UserConfig";

export default function PriceList() {
  const priceListHook = useHookstate(PRICE_LIST);
  const inScreenConfigHook = useHookstate(IN_SCREEN_CONFIG);
  const screenConfigStepHook = useHookstate(SCREEN_CONFIG_STEP);
  const itemsDatabaseStatusHook = useHookstate(ITEM_DATABASE_STATUS);
  const noScanningConfigFoundHook = useHookstate(NO_SCANNING_CONFIG_FOUND);
  const triggerSoundOnScanBitHook = useHookstate(TRIGGER_SOUND_ON_SCAN_BIT);
  const triggerSoundOnUpBitHook = useHookstate(TRIGGER_SOUND_ON_UP_BIT);
  const priceList = priceListHook.get();
  const inScreenConfig = inScreenConfigHook.get();
  const screenConfigStep: 0 | 1 | 2 | 3 | 4 = screenConfigStepHook.get();
  const itemsDatabaseStatus: -1 | 0 | 1 = itemsDatabaseStatusHook.get();
  const noScanningConfigFound = noScanningConfigFoundHook.get();
  const triggerSoundOnScanBit = triggerSoundOnScanBitHook.get();
  const triggerSoundOnUpBit = triggerSoundOnUpBitHook.get();
  const triggerSoundOnExistsBitHook = useHookstate(TRIGGER_SOUND_ON_EXISTS_BIT);
  const triggerSoundOnExistsBit = triggerSoundOnExistsBitHook.get();

  const itemScannedAudioRef = useRef<HTMLAudioElement>(null);
  const itemUppedAudioRef = useRef<HTMLAudioElement>(null);
  const itemExistsAudioRef = useRef<HTMLAudioElement>(null);
  const previousSoundOnScanBitRef = useRef<boolean>(false);
  const previousSoundOnUpBitRef = useRef<boolean>(false);
  const previousSoundOnExistsBitRef = useRef<boolean>(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const totalValueRef = useRef<HTMLDivElement>(null);
  const [totalGridPosition, setTotalGridPosition] = useState<{
    columnStart: number;
    rowStart: number;
  }>({ columnStart: 1, rowStart: 1 });
  const [showSettings, setShowSettings] = useState(false);
  const [numCols, setNumCols] = useState(1);
  const [numRows, setNumRows] = useState(1);
  const [shouldShowOverflow, setShouldShowOverflow] = useState(false);
  const [itemsToShow, setItemsToShow] = useState(0);
  const [availableCells, setAvailableCells] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(1.0);
  const [lowestAcceptableScore, setLowestAcceptableScore] = useState(50);
  const [enableTooltips, setEnableTooltips] = useState(false);
  const [isFrameless, setIsFrameless] = useState(false);
  const [enableAlwaysOnTop, setEnableAlwaysOnTop] = useState(false);
  const [tarkovMarketApiKey, setTarkovMarketApiKey] = useState("");
  const [tarkovTrackerApiToken, setTarkovTrackerApiToken] = useState("");
  const [borderColorRed, setBorderColorRed] = useState(82);
  const [borderColorGreen, setBorderColorGreen] = useState(89);
  const [borderColorBlue, setBorderColorBlue] = useState(90);
  const [enableMainWindowToggle, setEnableMainWindowToggle] = useState(true);
  const [enableDeleteLowestItem, setEnableDeleteLowestItem] = useState(true);
  const [enableDeleteLastItem, setEnableDeleteLastItem] = useState(true);
  const [enableIncrementLastItem, setEnableIncrementLastItem] = useState(true);
  const [enableScreenCalibration, setEnableScreenCalibration] = useState(true);
  const [gameMode, setGameMode] = useState<GameMode>("regular");
  const [showPerSlotPrice, setShowPerSlotPrice] = useState(true);
  const [enableQuestPanel, setEnableQuestPanel] = useState(true);
  const [questPanelHotkey, setQuestPanelHotkey] = useState(DEFAULT_QUEST_PANEL_HOTKEY);
  const [eftLogsPath, setEftLogsPath] = useState("");
  const [questScanHotkey, setQuestScanHotkey] = useState(DEFAULT_QUEST_SCAN_HOTKEY);
  const [mapHotkey, setMapHotkey] = useState(DEFAULT_MAP_HOTKEY);

  // Reducer for calculating total loot value
  type TotalLootValueState = number;
  type TotalLootValueAction = {
    type: "CALCULATE";
    priceList: typeof priceList;
  };

  function totalLootValueReducer(
    state: TotalLootValueState,
    action: TotalLootValueAction
  ): TotalLootValueState {
    if (action.type === "CALCULATE") {
      if (!action.priceList) {
        return 0;
      }
      return [...action.priceList].reduce((total, item) => {
        if (!item) return total;
        const count = item.count > 0 ? item.count : 1;
        const price = getItemsPricePerSlot(item as ClientItem) * item.slots;
        return count * price + total;
      }, 0);
    }
    return state;
  }

  const [totalLootValue, dispatchTotalLootValue] = useReducer(
    totalLootValueReducer,
    0
  );

  // Recalculate total loot value when priceList changes
  useEffect(() => {
    if (priceList) {
      dispatchTotalLootValue({ type: "CALCULATE", priceList });
    }
  }, [priceList]);

  useCanAnimate({ respectMotionPreference: false });

  // Load user config on mount
  useEffect(() => {
    const loadUserConfig = async () => {
      try {
        const config = await window.electron.getUserConfig();
        setSoundEnabled(config.soundEnabled ?? true);
        setSoundVolume(config.soundVolume ?? 1.0);
        setEnableTooltips(config.enableTooltips ?? false);
        setIsFrameless(config.isFrameless ?? false);
        setEnableAlwaysOnTop(config.enableAlwaysOnTop ?? false);
        setTarkovMarketApiKey(config.tarkovMarketApiKey ?? "");
        setTarkovTrackerApiToken(config.tarkovTrackerApiToken ?? "");
        setLowestAcceptableScore(config.lowestAcceptableScore ?? 50);
        setBorderColorRed(config.borderColorRed ?? 82);
        setBorderColorGreen(config.borderColorGreen ?? 89);
        setBorderColorBlue(config.borderColorBlue ?? 90);
        setEnableMainWindowToggle(config.enableMainWindowToggle ?? true);
        setEnableDeleteLowestItem(config.enableDeleteLowestItem ?? true);
        setEnableDeleteLastItem(config.enableDeleteLastItem ?? true);
        setEnableIncrementLastItem(config.enableIncrementLastItem ?? true);
        setEnableScreenCalibration(config.enableScreenCalibration ?? true);
        setGameMode(getGameMode(config));
        setShowPerSlotPrice(config.showPerSlotPrice ?? true);
        setEnableQuestPanel(config.enableQuestPanel ?? true);
        setQuestPanelHotkey(config.questPanelHotkey ?? DEFAULT_QUEST_PANEL_HOTKEY);
        setEftLogsPath(config.eftLogsPath ?? "");
        setQuestScanHotkey(config.questScanHotkey ?? DEFAULT_QUEST_SCAN_HOTKEY);
        setMapHotkey(config.mapHotkey ?? DEFAULT_MAP_HOTKEY);
        // Apply volume to audio element - use setTimeout to defer until refs are ready
        const interval = setInterval(() => {
          if (itemScannedAudioRef.current && itemUppedAudioRef.current && itemExistsAudioRef.current) {
            itemScannedAudioRef.current.volume = config.soundVolume ?? 1.0;
            itemUppedAudioRef.current.volume = config.soundVolume ?? 1.0;
            itemExistsAudioRef.current.volume = config.soundVolume ?? 1.0;
          }
        }, 4666);

        return () => clearInterval(interval);
      } catch (error) {
        console.error("Failed to load user config:", error);
      }
    };
    loadUserConfig();
  }, []);

  // Update audio volume when soundVolume changes
  useEffect(() => {
    if (itemScannedAudioRef.current && itemUppedAudioRef.current && itemExistsAudioRef.current) {
      itemScannedAudioRef.current.volume = soundVolume;
      itemUppedAudioRef.current.volume = soundVolume;
      itemExistsAudioRef.current.volume = soundVolume;
    }
  }, [soundVolume]);

  // Play sound when a new item is added
  useEffect(() => {
    // Play sound if a new item was added (bit flipped) and sound is enabled
    if (
      previousSoundOnScanBitRef.current != triggerSoundOnScanBit &&
      soundEnabled
    ) {
      itemScannedAudioRef.current?.play().catch((error) => {
        // Handle autoplay restrictions gracefully
        console.log("Could not play sound:", error);
      });
    }

    // Update the previous length for next comparison
    previousSoundOnScanBitRef.current = triggerSoundOnScanBit;
  }, [triggerSoundOnScanBit, soundEnabled]);
  
  useEffect(() => {
    // Play sound if a item had quantity added (bit flipped) and sound is enabled
    if (
      previousSoundOnUpBitRef.current != triggerSoundOnUpBit &&
      soundEnabled
    ) {
      itemUppedAudioRef.current?.play().catch((error) => {
        // Handle autoplay restrictions gracefully
        console.log("Could not play sound:", error);
      });
    }

    // Update the previous length for next comparison
    previousSoundOnUpBitRef.current = triggerSoundOnUpBit;
  }, [triggerSoundOnUpBit, soundEnabled]);

  // Play sound when an item already exists in the list
  useEffect(() => {
    // Play sound if an item already existed (bit flipped) and sound is enabled
    if (
      previousSoundOnExistsBitRef.current != triggerSoundOnExistsBit &&
      soundEnabled
    ) {
      itemExistsAudioRef.current?.play().catch((error) => {
        // Handle autoplay restrictions gracefully
        console.log("Could not play exists sound:", error);
      });
    }

    previousSoundOnExistsBitRef.current = triggerSoundOnExistsBit;
  }, [triggerSoundOnExistsBit, soundEnabled]);

  const priceListSorted = useMemo(() => {
    return [...priceList].sort(
      (item1, item2) =>
        getItemsPricePerSlot(item2 as ClientItem) -
        getItemsPricePerSlot(item1 as ClientItem)
    );
  }, [priceList]);
  

  // Calculate grid dimensions and position Total Value in bottom right
  useEffect(() => {
    const calculateGridPosition = () => {
      if (!gridRef.current) return;

      if (totalValueRef.current) {
        totalValueRef.current.style.display = "none";
      }

      const gridElement = gridRef.current;
      const gridWidth = gridElement.clientWidth;
      const gridHeight = gridElement.clientHeight;
      const minColumnWidth = 70; // Minimum 70px per column
      const minRowHeight = 30; // Minimum 30px per row

      // Calculate number of columns and rows based on minimum sizes
      // With minmax, grid will create as many tracks as fit with minimum size
      const calculatedCols = Math.floor(gridWidth / minColumnWidth) || 1;
      const calculatedRows = Math.floor(gridHeight / minRowHeight) || 1;

      setNumCols(calculatedCols);
      setNumRows(calculatedRows);


      const totalGridCells = numCols * numRows;
            const totalOccupiedCells = 5; // Total spans 2x2 = 4 cells
            const availableCells = totalGridCells - totalOccupiedCells;

            const shouldShowOverflow = priceListSorted.length > availableCells;
            const itemsToShow = shouldShowOverflow ? availableCells - 1 : availableCells; // -2 for overflow indicator

            setShouldShowOverflow(shouldShowOverflow);
            setItemsToShow(itemsToShow);
            setAvailableCells(availableCells);

      // Position Total Value in bottom right (spans 2 columns and 2 rows)
      // Start at second-to-last column/row so it spans to the last
      const columnStart = Math.max(1, calculatedCols - 1);
      const rowStart = Math.max(1, numRows - 1);

      // Only produce a new state object when the position actually changed.
      // A fresh object every run forced a re-render, which re-ran this effect,
      // which produced another fresh object... pegging a CPU core forever.
      setTotalGridPosition((previous) =>
        previous.columnStart === columnStart && previous.rowStart === rowStart
          ? previous
          : { columnStart, rowStart }
      );

      if (totalValueRef.current) {
        totalValueRef.current.style.display = "flex";
      }
    };

    // Calculate on mount and when price list changes (with small delay for DOM update)
    const timeoutId = setTimeout(calculateGridPosition, 0);

    // Use ResizeObserver for accurate grid dimension tracking
    if (!gridRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      calculateGridPosition();
    });

    resizeObserver.observe(gridRef.current);

    // Also listen to window resize as fallback
    window.addEventListener("resize", calculateGridPosition);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", calculateGridPosition);
    };
  }, [priceList]);

  if (noScanningConfigFound) {
    return (
      <div className="flex flex-col h-full justify-center items-center text-center">
        <h2 className="text-base font-bold mb-2">
          Initial Screen Calibration Needed
        </h2>
        <p className="text-sm">
          Please press F6 to start the screen scanning configuration process.
          This is a simple 30 second process to calibrate the OCR for your
          screen.
        </p>
      </div>
    );
  }

  if (itemsDatabaseStatus === 0) {
    return (
      <div className="flex flex-col h-full justify-center items-center text-center">
        <h2 className="text-base font-bold mb-2">
          Fetching Item Prices from Database
        </h2>
        <div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            className="size-6 animate-spin"
          >
            <path opacity=".4" fill="currentColor" d="" />
            <path
              fill="currentColor"
              d="M457 372c11.5 6.6 26.3 2.7 31.8-9.3 14.9-32.5 23.2-68.6 23.2-106.7 0-133.3-101.9-242.8-232-254.9-13.2-1.2-24 9.6-24 22.9s10.8 23.9 24 25.4c103.6 11.9 184 99.9 184 206.6 0 29.3-6.1 57.3-17 82.6-5.3 12.2-1.5 26.8 10 33.5z"
            />
          </svg>
        </div>
      </div>
    );
  }

  if (itemsDatabaseStatus === -1) {
    return (
      <div className="flex flex-col h-full justify-center items-center text-center">
        <h2 className="text-base font-bold mb-2">
          Fetching Items from Database Failed
        </h2>
        <p className="text-sm">
          Please try restarting the application and trying again or try again
          later.
        </p>
      </div>
    );
  }

  if (inScreenConfig) {
    if (screenConfigStep === 1) {
      return (
        <div className="flex flex-col h-full justify-center items-center text-center">
          <h2 className="text-base font-bold mb-2">
            Screen Configuration Initializing
          </h2>
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 512 512"
              className="size-6 animate-spin"
            >
              <path opacity=".4" fill="currentColor" d="" />
              <path
                fill="currentColor"
                d="M457 372c11.5 6.6 26.3 2.7 31.8-9.3 14.9-32.5 23.2-68.6 23.2-106.7 0-133.3-101.9-242.8-232-254.9-13.2-1.2-24 9.6-24 22.9s10.8 23.9 24 25.4c103.6 11.9 184 99.9 184 206.6 0 29.3-6.1 57.3-17 82.6-5.3 12.2-1.5 26.8 10 33.5z"
              />
            </svg>
          </div>
        </div>
      );
    } else if (screenConfigStep === 2) {
      return (
        <div className="flex flex-col h-full justify-center items-center text-center">
          <h2 className="text-base font-bold mb-1">
            Screen Configuration Started
          </h2>
          <p className="text-sm">
            Please hover over any item with the item's tooltip visible as shown
            below then press F6.
          </p>
          <img
            src={
              "data:image/png;base64,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"
            }
            className="mt-1 w-40 h-auto"
          />
        </div>
      );
    } else if (screenConfigStep === 3) {
      return (
        <div className="flex flex-col h-full justify-center items-center text-center">
          <h2 className="text-base font-bold mb-2">
            Scanning Single Row Dimensions
          </h2>
          <p className="text-sm text-red-500 font-bold mb-2">
            DON'T MOVE YOUR MOUSE
          </p>
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 512 512"
              className="size-6 animate-spin"
            >
              <path opacity=".4" fill="currentColor" d="" />
              <path
                fill="currentColor"
                d="M457 372c11.5 6.6 26.3 2.7 31.8-9.3 14.9-32.5 23.2-68.6 23.2-106.7 0-133.3-101.9-242.8-232-254.9-13.2-1.2-24 9.6-24 22.9s10.8 23.9 24 25.4c103.6 11.9 184 99.9 184 206.6 0 29.3-6.1 57.3-17 82.6-5.3 12.2-1.5 26.8 10 33.5z"
              />
            </svg>
          </div>
        </div>
      );
    } else if (screenConfigStep === 4) {
      return (
        <div className="flex flex-col h-full justify-center items-center text-center">
          <h2 className="text-base font-bold mb-2">Configuration Complete</h2>
          <p className="text-sm text-red-500 font-bold mb-2">
            PLEASE RESTART THIS APPLICATION TO SAVE CHANGES
          </p>
          <p className="text-sm">
            If you are still running into issues, open an issue on GitHub
            (Settings &gt; help).
          </p>
        </div>
      );
    }
  }

  if (priceList) {
    return (
      <div className="tracking-wide flex flex-col h-full">
        <audio ref={itemScannedAudioRef} id="item-added-sound" src={ScannedSound} />
        <audio ref={itemUppedAudioRef} id="item-upped-sound" src={UppedSound} />
        <audio ref={itemExistsAudioRef} id="item-exists-sound" src={ItemExistsSound} />
        {showSettings && (
          <Settings
            onClose={() => setShowSettings(false)}
            soundEnabled={soundEnabled}
            onSoundEnabledChange={setSoundEnabled}
            soundVolume={soundVolume}
            onSoundVolumeChange={setSoundVolume}
            enableTooltips={enableTooltips}
            onEnableTooltipsChange={setEnableTooltips}
            isFrameless={isFrameless}
            onIsFramelessChange={setIsFrameless}
            enableAlwaysOnTop={enableAlwaysOnTop}
            onEnableAlwaysOnTopChange={setEnableAlwaysOnTop}
            tarkovMarketApiKey={tarkovMarketApiKey}
            onTarkovMarketApiKeyChange={setTarkovMarketApiKey}
            tarkovTrackerApiToken={tarkovTrackerApiToken}
            onTarkovTrackerApiTokenChange={setTarkovTrackerApiToken}
            lowestAcceptableScore={lowestAcceptableScore}
            onLowestAcceptableScoreChange={setLowestAcceptableScore}
            borderColorRed={borderColorRed}
            onBorderColorRedChange={setBorderColorRed}
            borderColorGreen={borderColorGreen}
            onBorderColorGreenChange={setBorderColorGreen}
            borderColorBlue={borderColorBlue}
            onBorderColorBlueChange={setBorderColorBlue}
            enableMainWindowToggle={enableMainWindowToggle}
            onEnableMainWindowToggleChange={setEnableMainWindowToggle}
            enableDeleteLowestItem={enableDeleteLowestItem}
            onEnableDeleteLowestItemChange={setEnableDeleteLowestItem}
            enableDeleteLastItem={enableDeleteLastItem}
            onEnableDeleteLastItemChange={setEnableDeleteLastItem}
            enableIncrementLastItem={enableIncrementLastItem}
            onEnableIncrementLastItemChange={setEnableIncrementLastItem}
            enableScreenCalibration={enableScreenCalibration}
            onEnableScreenCalibrationChange={setEnableScreenCalibration}
            gameMode={gameMode}
            onGameModeChange={setGameMode}
            showPerSlotPrice={showPerSlotPrice}
            onShowPerSlotPriceChange={setShowPerSlotPrice}
            enableQuestPanel={enableQuestPanel}
            onEnableQuestPanelChange={setEnableQuestPanel}
            questPanelHotkey={questPanelHotkey}
            onQuestPanelHotkeyChange={setQuestPanelHotkey}
            eftLogsPath={eftLogsPath}
            onEftLogsPathChange={setEftLogsPath}
            questScanHotkey={questScanHotkey}
            onQuestScanHotkeyChange={setQuestScanHotkey}
            mapHotkey={mapHotkey}
            onMapHotkeyChange={setMapHotkey}
          />
        )}
        <div
          ref={gridRef}
          className="grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] grid-rows-[repeat(auto-fill,minmax(30px,1fr))] font-medium tracking-wide text-base mt-1 w-full grid-flow-col grow max-h-[91vh]"
        >
          {/* Settings button in top right */}
          <div className="flex items-center justify-end" style={{
            gridColumnStart: numCols,
            gridRowStart: 1,
          }}>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center hover:bg-white/20 transition-colors bg-[#444444] w-fit p-2.5 rounded"
              
              aria-label="Open settings"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
            {isFrameless ? (
              <div className="draggable relative flex items-center justify-center fill-white overflow-hidden">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" className="h-5 w-5 text-white"><path d="M96 160C96 142.3 110.3 128 128 128L512 128C529.7 128 544 142.3 544 160C544 177.7 529.7 192 512 192L128 192C110.3 192 96 177.7 96 160zM96 320C96 302.3 110.3 288 128 288L512 288C529.7 288 544 302.3 544 320C544 337.7 529.7 352 512 352L128 352C110.3 352 96 337.7 96 320zM544 480C544 497.7 529.7 512 512 512L128 512C110.3 512 96 497.7 96 480C96 462.3 110.3 448 128 448L512 448C529.7 448 544 462.3 544 480z"/></svg>
              </div>
            ) : null }
          </div>
          {/* Calculate visible cells: numCols * numRows - 4 (for Total which spans 2x2, but effectively takes 4 cells) */}
          {shouldShowOverflow && (
                  <div className="flex items-center max-w-full max-h-full overflow-hidden tracking-[-0.1px] odd:bg-white/10">
                    <div className="relative flex items-center gap-1 w-full h-full">
                      <div>
                        <div className="px-2 font-bold cursor-pointer text-[11px] -mt-[3px] whitespace-nowrap">
                          {priceListSorted.length - itemsToShow} items abv
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {priceListSorted.slice(shouldShowOverflow ? -itemsToShow : -availableCells).map((item, i, arr) => (
                  <PriceListGridRow
                    key={item.id}
                    item={item}
                    lastItem={i === arr.length - 1}
                  />
                ))}
          <div
            className="flex flex-col h-full justify-end items-end col-span-2 row-span-2 pl-2 select-none"
            style={{
              gridColumnStart: totalGridPosition.columnStart,
              gridRowStart: totalGridPosition.rowStart,
            }}
            ref={totalValueRef}
          >
            <div className="max-w-[140px] w-[140px]">
              <span className="uppercase text-xs font-bold">Total</span>
              <h2 className="flex justify-center flex-col bg-white text-stone-900 px-2 rounded h-7 w-full font-['Bender']">
                <div className="flex items-end gap-0.5">
                  <span className="font-['Nunito'] text-sm mb-1 font-black">
                    ₽
                  </span>
                  <span className="text-xl font-black tracking-wider">
                    <NumberFlow value={totalLootValue} />
                  </span>
                </div>
              </h2>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <div></div>;
}

function PriceListGridRow({
  item,
  lastItem,
}: {
  item: ImmutableObject<ClientItem>;
  lastItem: boolean;
}) {
  return (
    <div className="flex items-center max-w-full max-h-full overflow-hidden tracking-[-0.1px] odd:bg-white/10 select-none">
      {/* <div className="h-9 w-9 flex items-center justify-center mr-1">
        <img
          src={item.icon}
          className="inline max-w-full max-h-full object-contain object-center"
        />
      </div> */}
      <div className="relative flex items-center gap-1 w-full h-full">
        <div>
          <div
            className={classNames(
              "px-2 font-bold cursor-pointer text-[11px] -mt-[3px] whitespace-nowrap",
              lastItem && item.mostRecentlyAddedItem
                ? "text-purple-500"
                : item.mostRecentlyAddedItem
                ? "text-green-500"
                : lastItem
                ? "text-red-500"
                : ""
            )}
            onClick={() => {
              removeItemFromPriceList(item as ClientItem);
            }}
          >
            {item.shortName}
          </div>
          <div
            className="px-0.5 cursor-pointer -mt-[12px] -mb-0.5 whitespace-nowrap h-[25px]"
            onClick={() => {
              removeItemFromPriceList(item as ClientItem);
            }}
          >
            <span className="text-[11px]">
              <span className="mr-1"></span>
              <span className="font-['Nunito'] mr-px text-[9px]">₽</span>
              {numberWithCommas(getItemsPricePerSlot(item as ClientItem))}
            </span>

            {item.slots > 1 && (
              <span className="ml-1 text-[8px] tracking-tight">per</span>
            )}

            {item.count > 1 && (
              <span className="ml-1 text-[8px] tracking-tight">
                x {item.count}
              </span>
            )}
          </div>
        </div>
        {/* {item.mostRecentlyAddedItem ? (
          <>
            <div className="flex items-center justify-around text-xs w-8 h-5 rounded bg-stone-600 font-bold">
              <span className="ml-0.5">F3</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 640 640"
                className="fill-white"
                width={12}
                height={12}
              >
                <path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z" />
              </svg>
            </div>
            <div className="flex items-center justify-center text-xs w-8 h-5 mr-2 rounded text-white font-bold">
              <span>F4</span>
              <span className="ml-px">+</span>
            </div>
          </>
        ) : lastItem ? (
          <div className="flex items-center justify-around text-xs w-8 h-5 mr-2 rounded bg-stone-600 font-bold">
            <span className="ml-0.5">F2</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 640 640"
              className="fill-white"
              width={12}
              height={12}
            >
              <path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z" />
            </svg>
          </div>
        ) : null} */}
      </div>
    </div>
  );
}
