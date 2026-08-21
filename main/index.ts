import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  protocol,
  screen,
  session,
  Tray,
} from "electron";
import { pathToFileURL } from "url";
import { openMainWindow } from "./services/windows";
import Items from "../models/Items";
import TooltipWindow from "../models/TooltipWindow";
import OCRProcess from "../models/OCRProcess";
import AlwaysOnTopProcess from "../models/AlwaysOnTopProcess";
import path from "path";
import IpcConstants from "../models/IpcConstants";
import log from "electron-log/main";
import { isDev } from "../utils";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import fs from "fs";
import { getUserConfigData, setUserConfigData } from "./services/config";
import {
  UserConfig,
  getGameMode,
  DEFAULT_QUEST_PANEL_HOTKEY,
  DEFAULT_QUEST_SCAN_HOTKEY,
  DEFAULT_MAP_HOTKEY,
} from "../models/UserConfig";
import QuestPanelWindow from "../models/QuestPanelWindow";
import GameLogWatcher from "../models/GameLogWatcher";
import TaskScan from "../models/TaskScan";
import MapWindow from "../models/MapWindow";

// Hotkey registration functions
function registerHotkeys(userConfig: UserConfig) {
  // F1 - Main Window Toggle
  if (userConfig.enableMainWindowToggle !== false) {
    // Default to true if not set
    globalShortcut.register("F1", () => {
      console.log("Toggling main window visibility");
      console.log(BrowserWindow.getAllWindows()[0].isVisible());
      if (BrowserWindow.getAllWindows()[0].isVisible()) {
        BrowserWindow.getAllWindows()[0].hide();
      } else {
        BrowserWindow.getAllWindows()[0].show();
      }
    });
  }

  // F2 - Delete Lowest Item
  if (userConfig.enableDeleteLowestItem !== false) {
    // Default to true if not set
    globalShortcut.register("F2", () => {
      BrowserWindow.getAllWindows()[0].webContents.send(
        IpcConstants.DeleteItem
      );
    });
  }

  // F3 - Delete Last Item
  if (userConfig.enableDeleteLastItem !== false) {
    // Default to true if not set
    globalShortcut.register("F3", () => {
      BrowserWindow.getAllWindows()[0].webContents.send(
        IpcConstants.DeleteLastItem
      );
    });
  }

  // F4 - Increment Last Item
  if (userConfig.enableIncrementLastItem !== false) {
    // Default to true if not set
    globalShortcut.register("F4", () => {
      BrowserWindow.getAllWindows()[0].webContents.send(
        IpcConstants.AddToItemCount
      );
    });
  }

  // F6 - Screen Calibration
  if (userConfig.enableScreenCalibration !== false) {
    // Default to true if not set
    globalShortcut.register("F6", () => {
      console.log("On step ", screenConfigureStep);
      if (!BrowserWindow.getAllWindows()[0].isVisible()) {
        BrowserWindow.getAllWindows()[0].show();
      }

      if (screenConfigureStep === 0) {
        const startTime = Date.now();
        const redValue = userConfig.borderColorRed ?? 82;
        const greenValue = userConfig.borderColorGreen ?? 89;
        const blueValue = userConfig.borderColorBlue ?? 90;
        console.log(
          "Starting screen configure with values:",
          redValue,
          greenValue,
          blueValue
        );
        BrowserWindow.getAllWindows()[0].webContents.send(
          IpcConstants.StartScreenConfigure
        );
        BrowserWindow.getAllWindows()[0].webContents.send(
          IpcConstants.DisableScreenConfigureNeeded
        );
        screenConfigureStep = 1;
        // Get RGB border color values from config

        screenConfigureProcess = isDev()
          ? spawn(
              path.join(app.getAppPath(), "/lib/ocr/configure_screen.exe"),
              [redValue.toString(), greenValue.toString(), blueValue.toString()]
              // {
              //   detached: true,
              //   shell: true,
              // }
            )
          : spawn(
              path.join(process.resourcesPath, "/ocr/configure_screen.exe"),
              [redValue.toString(), greenValue.toString(), blueValue.toString()]
            );

        screenConfigureProcess.stdout.setEncoding("utf-8");
        screenConfigureProcess.stdout.on("data", function (data) {
          console.log("Screen configure stderr data:", data.toString());
          isDev()
            ? console.log("stderr: " + data)
            : log.error("stderr: " + data);

          if (
            data.toString().includes("Searching") &&
            screenConfigureStep === 3
          ) {
            screenConfigureStep = 4;
            BrowserWindow.getAllWindows()[0].webContents.send(
              IpcConstants.ScreenConfigureScanningSingleRow
            );
          }

          if (
            data.toString().includes("RESULT||") &&
            screenConfigureStep === 4
          ) {
            screenConfigureStep = 5;
            BrowserWindow.getAllWindows()[0].webContents.send(
              IpcConstants.ScreenConfigureScanComplete
            );

            const configData = data
              .toString()
              .replace("RESULT||", "")
              .split("||");
            const offsetX = configData[0];
            const offsetY = configData[1];
            const formattedConfigData = {
              offsetX: parseInt(offsetX),
              offsetY: parseInt(offsetY),
            };

            fs.writeFileSync(
              isDev()
                ? path.join(app.getAppPath(), "/lib/ocr/scanningConfig.json")
                : path.join(process.resourcesPath, "/ocr/scanningConfig.json"),
              JSON.stringify(formattedConfigData)
            );
          }
        });

        screenConfigureProcess.on("close", function (code) {
          console.log("Screen configure process closed with code:", code);
          if (screenConfigureStep !== 5) {
            BrowserWindow.getAllWindows()[0].webContents.send(
              IpcConstants.EndScreenConfigure
            );
          }
          screenConfigureStep = 0;
          screenConfigureProcess = null;
        });

        if (typeof screenConfigureProcess.pid !== "number") {
          console.error("Error: Failed to spawn subprocess. PID is undefined.");
          BrowserWindow.getAllWindows()[0].webContents.send(
            IpcConstants.ScreenConfigureFailed
          );
          // Throw an error or handle the failure
        } else {
          console.log(
            `Spawned subprocess correctly with PID: ${screenConfigureProcess.pid}`
          );

          const timeToWait = 1000 - (Date.now() - startTime);

          setTimeout(
            () => {
              console.log("Screen configure step 1 complete");
              screenConfigureStep = 2;
              BrowserWindow.getAllWindows()[0].webContents.send(
                IpcConstants.ScreenConfigureStarted
              );
            },
            timeToWait > 0 ? timeToWait : 0
          );
        }
      }

      if (screenConfigureStep === 2 && screenConfigureProcess) {
        console.log("Advancing to step 3, searching for single row dimensions");
        screenConfigureStep = 3;
        screenConfigureProcess.stdin.write("NEXT\n");
      }
    });
  }

  // F12 - Dev Tools (always registered)
  globalShortcut.register("F12", () => {
    BrowserWindow.getAllWindows()[0].webContents.openDevTools();
  });
}

function unregisterHotkeys() {
  globalShortcut.unregister("F1");
  globalShortcut.unregister("F2");
  globalShortcut.unregister("F3");
  globalShortcut.unregister("F4");
  globalShortcut.unregister("F6");
  // Keep F12 registered for dev tools
}

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Global variables for screen configuration
let screenConfigureStep: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 = 0;
let screenConfigureProcess: ChildProcessWithoutNullStreams | null = null;

try {
  // This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Webpack
  // plugin that tells the Electron app where to look for the Webpack-bundled app code (depending on
  // whether you're running in development or production).
  let items: Items;
  let tooltipWindow: TooltipWindow | null = null;
  let ocr: OCRProcess | null = null;
  let questPanel: QuestPanelWindow | null = null;
  let gameLog: GameLogWatcher | null = null;
  let questPanelHotkey: string | null = null;
  let questPanelPushTimer: NodeJS.Timeout | null = null;
  // Map the user picked in the panel; cleared when a new raid starts
  let questPanelMapOverride: string | null = null;
  let taskScan: TaskScan | null = null;
  let questScanHotkey: string | null = null;
  let scanInProgress = false;
  let scanSessionUntil = 0;
  let scanSessionTimer: NodeJS.Timeout | null = null;
  let scanSessionEmptyRuns = 0;
  let toastTimer: NodeJS.Timeout | null = null;
  let toastDumpRequested = false;
  let toastLastDumpAt = 0;
  let mapWindow: MapWindow | null = null;
  let mapHotkey: string | null = null;
  // The map was open when the quest panel closed, so it comes back with it
  let mapOpenWithPanel = false;

  const getMapsDir = (): string =>
    isDev()
      ? path.join(app.getAppPath(), "maps")
      : path.join(process.resourcesPath, "maps");

  // Other file names accepted for a map besides its tarkov.dev nameId
  const MAP_FILE_ALIASES: Record<string, string[]> = {
    bigmap: ["customs"],
    factory4_day: ["factory", "factoryday", "factory_day"],
    factory4_night: ["factory", "factorynight", "factory_night"],
    rezervbase: ["reserve"],
    tarkovstreets: ["streets", "streetsoftarkov"],
    sandbox: ["groundzero"],
    sandbox_high: ["groundzero", "groundzerohigh"],
    laboratory: ["labs", "lab", "thelab"],
  };
  const mapFileKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

  // Image file for a map: named after its nameId ("bigmap.png"), its
  // display name ("customs.png", "ground zero.jpg") or a common alias
  const findMapImage = (mapNameId: string | null, mapName: string | null): string | null => {
    if (!mapNameId) return null;
    try {
      const wanted = new Set(
        [mapNameId, mapName ?? "", ...(MAP_FILE_ALIASES[mapNameId.toLowerCase()] ?? [])]
          .filter(Boolean)
          .map(mapFileKey)
      );
      const files = fs.readdirSync(getMapsDir()).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
      const file =
        files.find((f) => mapFileKey(f.replace(/\.[^.]+$/, "")) === mapFileKey(mapNameId)) ??
        files.find((f) => wanted.has(mapFileKey(f.replace(/\.[^.]+$/, ""))));
      return file ? `orbbmap://map/${encodeURIComponent(file)}` : null;
    } catch {
      return null;
    }
  };

  log.initialize();

  // Map images are served from the maps folder through a custom scheme so
  // both the dev server (http) and packaged (file) renderers can load them
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "orbbmap",
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);

  // Handle creating/removing shortcuts on Windows when installing/uninstalling.
  if (require("electron-squirrel-startup")) {
    app.quit();
  }

  // Better performance when a menu is not needed
  // Menu.setApplicationMenu(null);

  app.on("ready", async () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src *; img-src * data: blob: orbbmap:; style-src * 'unsafe-inline'; font-src * data:; media-src *; object-src *;",
          ],
        },
      });
    });

    // orbbmap://map/<file> -> <maps folder>/<file>
    protocol.handle("orbbmap", (request) => {
      const name = decodeURIComponent(new URL(request.url).pathname).replace(
        /^\/+/,
        ""
      );
      if (!/^[\w .()-]+\.(png|jpe?g|webp)$/i.test(name)) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(path.join(getMapsDir(), name)).toString());
    });

    log.info(
      "OPENING MAIN WINDOW",
      MAIN_WINDOW_WEBPACK_ENTRY,
      MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY
    );
    const mainWindow = openMainWindow(
      MAIN_WINDOW_WEBPACK_ENTRY,
      MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY
    );

    const userConfig = getUserConfigData();

    // (await mainWindow).setIgnoreMouseEvents(true);
    (await mainWindow).on("close", () => {
      app.quit();
    });

    // openMainWindow resolves after the page has loaded, so waiting for
    // ready-to-show here would usually miss the event - apply directly
    if (userConfig.enableAlwaysOnTop) {
      new AlwaysOnTopProcess().initialize();
    }

    // ---- In-raid quest panel -------------------------------------------
    // Debounced: several log events can arrive within the same second
    function pushQuestPanelData() {
      if (!questPanel || !gameLog || !items) return;
      if (questPanelPushTimer) clearTimeout(questPanelPushTimer);
      questPanelPushTimer = setTimeout(async () => {
        questPanelPushTimer = null;
        try {
          const config = getUserConfigData();
          const state = gameLog!.state;
          const data = await items.taskData.buildQuestPanelData(
            getGameMode(config),
            items.taskData.getLastProgress(),
            {
              ...state,
              mapNameId: questPanelMapOverride ?? state.mapNameId,
              // A picked map is browsing, not the raid you are in
              inRaid: questPanelMapOverride ? false : state.inRaid,
            },
            gameLog!.getQuestEvents(),
            taskScan
          );
          data.mapOverride = !!questPanelMapOverride;
          const imageUrl = findMapImage(data.mapNameId, data.mapName);
          data.hasMapImage = !!imageUrl;
          questPanel?.sendData(data);
          mapWindow?.sendData({
            mapNameId: data.mapNameId,
            mapName: data.mapName,
            imageUrl,
          });
        } catch (error) {
          log.warn("Failed to build quest panel data:", error);
        }
      }, 300);
    }

    function registerQuestPanelHotkey(accelerator: string) {
      if (questPanelHotkey) {
        globalShortcut.unregister(questPanelHotkey);
        questPanelHotkey = null;
      }
      const wanted = accelerator?.trim() || DEFAULT_QUEST_PANEL_HOTKEY;
      try {
        const ok = globalShortcut.register(wanted, () => {
          if (!questPanel || questPanel.isDestroyed()) return;
          questPanel.toggle();
          if (questPanel.isPanelVisible()) pushQuestPanelData();
        });
        if (ok) {
          questPanelHotkey = wanted;
        } else {
          log.warn(`Quest panel hotkey "${wanted}" could not be registered`);
        }
      } catch (error) {
        log.warn(`Invalid quest panel hotkey "${wanted}":`, error);
      }
    }

    // The log watcher feeds both the quest panel and the item tooltips, so
    // it runs whenever items are loaded, independent of the panel setting
    function ensureGameLogWatcher() {
      if (gameLog) return;
      const config = getUserConfigData();
      gameLog = new GameLogWatcher(config.eftLogsPath);
      gameLog.on("session-mode", (mode: string) =>
        log.info(`EFT session mode: ${mode}`)
      );
      gameLog.on("raid-created", () => {
        questPanelMapOverride = null;
        pushQuestPanelData();
      });
      gameLog.on("raid-started", pushQuestPanelData);
      // Accepting / handing in a quest in the menu shows up immediately,
      // in the panel and in item tooltips
      gameLog.on("quest-events", () => {
        void items.setQuestEvents(gameLog!.getQuestEvents());
        pushQuestPanelData();
      });
      gameLog.on("raid-ended", () => {
        pushQuestPanelData();
        // TarkovMonitor needs a moment to push the raid's results to
        // TarkovTracker; then pull them so tooltips and the panel update
        // without waiting for the 15-minute timer
        setTimeout(async () => {
          const current = getUserConfigData();
          await items.refreshTrackerProgress(
            getGameMode(current),
            current.tarkovTrackerApiToken
          );
          pushQuestPanelData();
        }, 20 * 1000);
      });
      gameLog.start();
      void items.setQuestEvents(gameLog.getQuestEvents());
    }

    // One OCR pass over the game's Tasks screen; merges task progress,
    // objective counts and operational tasks into the panel
    async function scanTasksScreenOnce(): Promise<number> {
      if (!ocr || scanInProgress) return 0;
      scanInProgress = true;
      try {
        const config = getUserConfigData();
        const mode = getGameMode(config);
        const [tsv, catalog, maps] = await Promise.all([
          ocr.requestScreenScan(),
          items.taskData.loadTaskCatalog(mode),
          items.taskData.loadMaps(mode),
        ]);
        if (!taskScan) taskScan = new TaskScan(app.getPath("userData"));
        const activeIds = [...(gameLog?.getQuestEvents() ?? new Map()).entries()]
          .filter(([, e]) => e.status === "started")
          .map(([id]) => id);
        const result = taskScan.apply(
          tsv,
          catalog,
          maps.map((m) => m.name),
          activeIds
        );
        pushQuestPanelData();
        return result.tasks + result.objectives;
      } catch (error) {
        log.warn("Tasks screen scan failed:", error);
        return 0;
      } finally {
        scanInProgress = false;
      }
    }

    // The scan hotkey starts a catch-up session: while the Tasks screen is
    // open, keep reading it every couple of seconds as the player scrolls
    // and clicks through their list (no input is ever sent to the game)
    const SCAN_SESSION_MS = 45 * 1000;
    let scanSessionPasses = 0;
    const SCAN_SESSION_INTERVAL_MS = 2000;
    // The scan hotkey / panel chip toggles the session
    function toggleScanSession() {
      if (scanSessionTimer) stopScanSession();
      else startScanSession();
    }

    function stopScanSession() {
      if (scanSessionTimer) clearTimeout(scanSessionTimer);
      scanSessionTimer = null;
      scanSessionUntil = 0;
      log.info("Tasks screen scan session stopped");
      sendScanStatus(false);
      pushQuestPanelData();
    }

    function sendScanStatus(active: boolean) {
      questPanel?.sendScanStatus({
        active,
        secondsLeft: active
          ? Math.max(0, Math.round((scanSessionUntil - Date.now()) / 1000))
          : 0,
        passes: scanSessionPasses,
        tasks: taskScan ? taskScan.getLastScan().count : 0,
      });
    }

    function startScanSession() {
      scanSessionUntil = Date.now() + SCAN_SESSION_MS;
      scanSessionEmptyRuns = 0;
      // The panel is where the session's progress shows, so make sure it
      // is on screen: the key press is acknowledged the moment it happens
      if (questPanel && !questPanel.isPanelVisible()) questPanel.showPanel();
      if (scanSessionTimer) {
        sendScanStatus(true);
        return; // already running - just extended
      }
      scanSessionPasses = 0;
      log.info("Tasks screen scan session started");
      sendScanStatus(true);
      const tick = async () => {
        const found = await scanTasksScreenOnce();
        scanSessionPasses++;
        scanSessionEmptyRuns = found > 0 ? 0 : scanSessionEmptyRuns + 1;
        const done =
          Date.now() >= scanSessionUntil || scanSessionEmptyRuns >= 4;
        if (done) {
          scanSessionTimer = null;
          log.info("Tasks screen scan session ended");
          sendScanStatus(false);
          pushQuestPanelData();
          return;
        }
        sendScanStatus(true);
        scanSessionTimer = setTimeout(tick, SCAN_SESSION_INTERVAL_MS);
      };
      scanSessionTimer = setTimeout(tick, 0);
    }

    // Screen-pixel rectangles of our own overlay windows, so the toast OCR
    // never reads the quest panel / map text as a notification
    function overlayRects(): { x: number; y: number; width: number; height: number }[] {
      const scale = screen.getPrimaryDisplay().scaleFactor;
      const rects = [];
      for (const win of [questPanel, mapWindow]) {
        if (!win || win.isDestroyed() || !win.isVisible()) continue;
        const b = win.getBounds();
        rects.push({
          x: b.x * scale,
          y: b.y * scale,
          width: b.width * scale,
          height: b.height * scale,
        });
      }
      return rects;
    }

    // In-raid notification toasts (bottom-right of the screen): read every
    // 2s while in a PMC raid; the helper keeps only the bright pixels of the
    // strip and skips OCR entirely while nothing bright is there
    const TOAST_INTERVAL_MS = 2000;
    async function watchToasts() {
      if (!ocr || !gameLog || !gameLog.state.inRaid || scanInProgress) return;
      if (gameLog.state.raidKind === "scav") return;
      try {
        const display = screen.getPrimaryDisplay();
        const scale = display.scaleFactor;
        const width = display.size.width * scale;
        const height = display.size.height * scale;
        const region = {
          x: width * 0.55,
          y: height * 0.76,
          width: width * 0.45,
          height: height * 0.24,
        };
        // Diagnostic: when a scan contains toast-like words but nothing
        // parses, save the next capture so the misread can be examined
        const dumpPath = path.join(app.getPath("userData"), "toast-debug.png");
        const dumpNow = toastDumpRequested && Date.now() - toastLastDumpAt > 5 * 60 * 1000;
        const tsv = await ocr.requestScreenScan(
          region,
          dumpNow ? dumpPath : undefined,
          overlayRects()
        );
        if (dumpNow) {
          toastDumpRequested = false;
          toastLastDumpAt = Date.now();
          log.info(`Toast debug capture saved: ${dumpPath}`);
        }
        const config = getUserConfigData();
        const catalog = await items.taskData.loadTaskCatalog(getGameMode(config));
        if (!taskScan) taskScan = new TaskScan(app.getPath("userData"));
        const knownNames = [...taskScan.getTasks().values()].map((t) => t.name);
        const events = taskScan.applyToastTsv(tsv, catalog, knownNames);
        if (events.length) {
          pushQuestPanelData();
        } else if (/\b(task|subtask|completed|ready)\b/i.test(tsv)) {
          const words = tsv
            .split(/\r?\n/)
            .filter((l) => l.startsWith("5\t"))
            .map((l) => l.split("\t")[11])
            .join(" ");
          log.info(`Toast-like text without a match: ${words.slice(0, 200)}`);
          toastDumpRequested = true;
        }
      } catch (error) {
        log.warn("Toast scan failed:", error);
      }
    }

    function startToastWatcher() {
      if (toastTimer) return;
      toastTimer = setInterval(() => void watchToasts(), TOAST_INTERVAL_MS);
    }

    function registerMapHotkey(accelerator: string) {
      if (mapHotkey) {
        globalShortcut.unregister(mapHotkey);
        mapHotkey = null;
      }
      const wanted = accelerator?.trim() || DEFAULT_MAP_HOTKEY;
      try {
        if (globalShortcut.register(wanted, () => mapWindow?.toggle())) {
          mapHotkey = wanted;
        } else {
          log.warn(`Map hotkey "${wanted}" could not be registered`);
        }
      } catch (error) {
        log.warn(`Invalid map hotkey "${wanted}":`, error);
      }
    }

    function registerQuestScanHotkey(accelerator: string) {
      if (questScanHotkey) {
        globalShortcut.unregister(questScanHotkey);
        questScanHotkey = null;
      }
      const wanted = accelerator?.trim() || DEFAULT_QUEST_SCAN_HOTKEY;
      try {
        if (globalShortcut.register(wanted, () => toggleScanSession())) {
          questScanHotkey = wanted;
        } else {
          log.warn(`Task scan hotkey "${wanted}" could not be registered`);
        }
      } catch (error) {
        log.warn(`Invalid task scan hotkey "${wanted}":`, error);
      }
    }

    function initializeQuestPanel() {
      ensureGameLogWatcher();
      const config = getUserConfigData();
      if (!taskScan) taskScan = new TaskScan(app.getPath("userData"));
      registerQuestScanHotkey(config.questScanHotkey ?? DEFAULT_QUEST_SCAN_HOTKEY);
      startToastWatcher();
      if (config.enableQuestPanel === false) return;
      if (questPanel && !questPanel.isDestroyed()) return;

      questPanel = new QuestPanelWindow({
        y: config.questPanelY,
        height: config.questPanelHeight,
        width: config.questPanelWidth,
      });
      if (!mapWindow || mapWindow.isDestroyed()) {
        mapWindow = new MapWindow(config.mapWindowBounds);
      }

      // Ctrl+wheel (hooked in the OCR helper) scrolls the panel while open;
      // the map window closes and reopens together with the panel
      questPanel.onVisibilityChange = (visible) => {
        ocr?.setWheelHookEnabled(visible);
        if (!mapWindow || mapWindow.isDestroyed()) return;
        if (!visible) {
          mapOpenWithPanel = mapWindow.isMapVisible();
          if (mapOpenWithPanel) mapWindow.hideMap();
        } else if (mapOpenWithPanel) {
          mapOpenWithPanel = false;
          mapWindow.showMap();
          pushQuestPanelData();
        }
      };
      registerMapHotkey(config.mapHotkey ?? DEFAULT_MAP_HOTKEY);
      if (ocr) {
        ocr.onWheel = (delta) => questPanel?.scrollBy(delta);
      }
      registerQuestPanelHotkey(
        config.questPanelHotkey ?? DEFAULT_QUEST_PANEL_HOTKEY
      );
      pushQuestPanelData();
    }

    function destroyQuestPanel() {
      if (questPanelHotkey) {
        globalShortcut.unregister(questPanelHotkey);
        questPanelHotkey = null;
      }
      if (questScanHotkey) {
        globalShortcut.unregister(questScanHotkey);
        questScanHotkey = null;
      }
      if (mapHotkey) {
        globalShortcut.unregister(mapHotkey);
        mapHotkey = null;
      }
      if (mapWindow && !mapWindow.isDestroyed()) mapWindow.destroyMap();
      mapWindow = null;
      if (questPanel && !questPanel.isDestroyed()) questPanel.destroyPanel();
      questPanel = null;
    }

    // Function to initialize tooltips
    function initializeTooltips() {
      if (tooltipWindow && !tooltipWindow.isDestroyed()) {
        console.log("Tooltip window already exists");
        return;
      }

      if (!ocr) {
        console.error("Cannot initialize tooltips: OCR not initialized");
        return;
      }

      try {
        tooltipWindow = new TooltipWindow();
        tooltipWindow.setIgnoreMouseEvents(true);
        console.log("TOOLTIP WINDOW CREATED");

        // ready-to-show is unreliable for a 1x1 transparent window; the
        // page load event is what actually matters here
        tooltipWindow.webContents.once("did-finish-load", () => {
          console.log("TOOLTIP WINDOW LOADED");
          setTimeout(() => {
            const userConfig = getUserConfigData();
            if (userConfig.enableAlwaysOnTop) {
              new AlwaysOnTopProcess().initialize();
            }
            BrowserWindow.getAllWindows()[0]?.webContents.send(
              IpcConstants.TooltipsReady
            );
          }, 500);
        });

        ocr.tooltipWindow = tooltipWindow;
        console.log("Tooltips initialized successfully");
      } catch (error) {
        log.error("Failed to initialize tooltips:", error);
      }
    }

    // Function to destroy tooltips
    function destroyTooltips() {
      if (ocr) {
        ocr.tooltipWindow = null;
      }

      if (tooltipWindow && !tooltipWindow.isDestroyed()) {
        tooltipWindow.destroy();
        tooltipWindow = null;
        console.log("Tooltip window destroyed");
      }
    }

    items = new Items();
    const startItemsFetch = () => {
      const initialUserConfig = getUserConfigData();
      items
        .fetchItems(
          initialUserConfig.tarkovMarketApiKey,
          getGameMode(initialUserConfig),
          initialUserConfig.tarkovTrackerApiToken
        )
        .then(async () => {
          setInterval(
            () => {
              console.log("Refetching updated data");
              const userConfig = getUserConfigData();
              items
                .fetchItems(
                  userConfig.tarkovMarketApiKey,
                  getGameMode(userConfig),
                  userConfig.tarkovTrackerApiToken
                )
                .then(() => pushQuestPanelData())
                .catch((error) => {
                  // Keep serving the previously fetched prices if a refetch fails
                  log.warn("Periodic item refetch failed:", error);
                });
            },
            1000 * 60 * 15
          );

          // Initialize search index with retry logic
          const maxRetries = 100;
          const retryDelay = 400;
          let retryCount = 0;
          let searchIndexInitialized = false;

          while (!searchIndexInitialized && retryCount < maxRetries) {
            try {
              // Check if items are loaded before attempting initialization
              if (items.items.length === 0) {
                retryCount++;
                if (retryCount < maxRetries) {
                  await new Promise((resolve) =>
                    setTimeout(resolve, retryDelay)
                  );
                  continue;
                } else {
                  throw new Error(
                    "Items not loaded after maximum retries - cannot initialize search index"
                  );
                }
              }

              // Attempt to initialize search index
              items.initializeSearchIndex();

              // Verify search index was actually created
              if (items.searchIndex) {
                searchIndexInitialized = true;
                console.log("Item search index initialized successfully");
              } else {
                throw new Error(
                  "Search index initialization returned without creating index"
                );
              }
            } catch (error) {
              retryCount++;
              if (retryCount < maxRetries) {
                log.warn(
                  `Error initializing search index (attempt ${retryCount}/${maxRetries}), retrying in ${retryDelay}ms...`,
                  error
                );
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
              } else {
                log.error(
                  "Failed to initialize search index after maximum retries",
                  error
                );
                throw error;
              }
            }
          }

          ocr = new OCRProcess(items, BrowserWindow.getAllWindows()[0]);
          ocr.initialize();
          console.log("OCR PROCESS INITIALIZED");

          // Initialize tooltips if enabled in config
          if (userConfig.enableTooltips) {
            initializeTooltips();
          }

          initializeQuestPanel();

          BrowserWindow.getAllWindows()[0].webContents.send(
            IpcConstants.ItemsDatabaseReady
          );
        })
        .catch((error) => {
          console.log("FAILED TO FETCH ITEMS FROM API:", error);
          log.warn("Initial item fetch failed, retrying in 60 seconds", error);
          BrowserWindow.getAllWindows()[0]?.webContents.send(
            IpcConstants.ItemsDatabaseFailed
          );
          // The price API can be temporarily down (that is what killed the
          // app originally) - keep retrying instead of requiring a restart
          setTimeout(startItemsFetch, 60 * 1000);
        });
    };
    startItemsFetch();

    // FOR SOME REASON THESE BREAK THE APP WHEN PACKAGED |||||||||||||||||||||||||||||| WARNING
    // const tray = new Tray(path.join(app.getAppPath(), "/favicon.ico"));

    // const contextMenu = Menu.buildFromTemplate([
    //   {
    //     role: "about",
    //     label: "Tarkov Price Checker",
    //     icon: path.join(app.getAppPath(), "/favicon-16x16.png"),
    //     enabled: false,
    //   },
    //   {
    //     type: "separator",
    //   },
    //   {
    //     role: "quit",
    //     label: "Quit App",
    //   },
    // ]);

    // tray.setToolTip("Tarkov Price Checker");
    // tray.setContextMenu(contextMenu);

    // Register hotkeys based on user config
    const hotkeyUserConfig = getUserConfigData();
    registerHotkeys(hotkeyUserConfig);

    // The quest panel asks for mouse input only while the cursor hovers it
    ipcMain.on(
      IpcConstants.QuestPanelInteractive,
      (_event, enabled: boolean) => {
        questPanel?.setInteractive(enabled);
      }
    );

    // Dragging / resizing the quest panel; commit=true persists the result
    ipcMain.on(
      IpcConstants.QuestPanelSetBounds,
      (
        _event,
        patch: { y?: number; height?: number; width?: number },
        commit: boolean
      ) => {
        if (!questPanel || questPanel.isDestroyed()) return;
        const bounds = questPanel.applyPanelBounds(patch ?? {});
        if (commit) {
          const config = getUserConfigData();
          config.questPanelY = bounds.y;
          config.questPanelHeight = bounds.height;
          config.questPanelWidth = bounds.width;
          setUserConfigData(config);
        }
      }
    );

    // Quest panel background opacity, shared with the map window; previewed
    // while the slider moves and persisted when it is released
    ipcMain.on(
      IpcConstants.QuestPanelOpacity,
      (_event, opacity: number, commit = true) => {
        if (typeof opacity !== "number" || !(opacity >= 0.3 && opacity <= 1)) return;
        const rounded = Math.round(opacity * 100) / 100;
        mapWindow?.setOpacity(rounded);
        if (!commit) return;
        const config = getUserConfigData();
        config.questPanelOpacity = rounded;
        setUserConfigData(config);
      }
    );

    // Quest panel buttons
    ipcMain.on(IpcConstants.QuestPanelToggleScan, () => toggleScanSession());
    ipcMain.on(IpcConstants.QuestPanelScanStatusRequest, () =>
      sendScanStatus(!!scanSessionTimer)
    );
    ipcMain.on(IpcConstants.QuestPanelClose, () => questPanel?.hidePanel());
    ipcMain.on(IpcConstants.QuestPanelToggleMap, () => {
      mapWindow?.toggle();
      if (mapWindow?.isMapVisible()) pushQuestPanelData();
    });

    // Map window
    ipcMain.on(IpcConstants.MapWindowInteractive, (_event, enabled: boolean) => {
      mapWindow?.setInteractive(enabled);
    });
    ipcMain.on(IpcConstants.MapWindowClose, () => mapWindow?.hideMap());
    ipcMain.on(
      IpcConstants.MapWindowSetBounds,
      (
        _event,
        patch: { x?: number; y?: number; width?: number; height?: number },
        commit: boolean
      ) => {
        if (!mapWindow || mapWindow.isDestroyed()) return;
        const bounds = mapWindow.applyBounds(patch ?? {});
        if (commit) {
          const config = getUserConfigData();
          config.mapWindowBounds = bounds;
          setUserConfigData(config);
        }
      }
    );

    // Map picker in the quest panel (null = follow the current raid)
    ipcMain.on(
      IpcConstants.QuestPanelSelectMap,
      (_event, mapNameId: string | null) => {
        questPanelMapOverride = mapNameId || null;
        pushQuestPanelData();
      }
    );

    // The tooltip window reports its rendered size so it can be kept on-screen
    ipcMain.on(
      IpcConstants.TooltipSize,
      (_event, size: { width: number; height: number }) => {
        ocr?.onTooltipSize(size);
      }
    );

    // IPC handlers for user config
    ipcMain.handle(IpcConstants.GetUserConfig, () => {
      return getUserConfigData();
    });

    ipcMain.handle(IpcConstants.GetAllItems, () => {
      if (items && items.itemsAreLoaded()) {
        return items.items;
      }
      return [];
    });

    ipcMain.handle(
      IpcConstants.ValidateApiKey,
      async (_event, apiKey: string) => {
        try {
          const response = await fetch(
            "https://api.tarkov-market.app/api/v1/items/all",
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "x-api-key": apiKey,
              },
            }
          );

          return response.status === 200 || response.status === 204;
        } catch (error) {
          console.error("API key validation failed:", error);
          return false;
        }
      }
    );

    ipcMain.handle(IpcConstants.RefetchItems, async () => {
      try {
        if (items) {
          const userConfig = getUserConfigData();
          await items.fetchItems(
            userConfig.tarkovMarketApiKey,
            getGameMode(userConfig),
            userConfig.tarkovTrackerApiToken
          );
          pushQuestPanelData();
          return true;
        }
        return false;
      } catch (error) {
        console.error("Failed to refetch items:", error);
        return false;
      }
    });

    ipcMain.handle(
      IpcConstants.ValidateTarkovTrackerToken,
      async (_event, token: string) => {
        try {
          return await items.taskData.validateToken(token);
        } catch (error) {
          console.error("TarkovTracker token validation failed:", error);
          return { ok: false, error: "Validation failed" };
        }
      }
    );

    ipcMain.handle(
      IpcConstants.SetUserConfig,
      (_event, userConfig: UserConfig) => {
        const previous = getUserConfigData();
        setUserConfigData(userConfig);

        // Apply quest-panel settings live
        if (userConfig.enableQuestPanel === false) {
          destroyQuestPanel();
        } else if (items && ocr) {
          initializeQuestPanel();
          const hotkey =
            userConfig.questPanelHotkey ?? DEFAULT_QUEST_PANEL_HOTKEY;
          if (
            hotkey !== (previous.questPanelHotkey ?? DEFAULT_QUEST_PANEL_HOTKEY)
          ) {
            registerQuestPanelHotkey(hotkey);
          }
          const scanKey = userConfig.questScanHotkey ?? DEFAULT_QUEST_SCAN_HOTKEY;
          if (scanKey !== (previous.questScanHotkey ?? DEFAULT_QUEST_SCAN_HOTKEY)) {
            registerQuestScanHotkey(scanKey);
          }
          const mapKey = userConfig.mapHotkey ?? DEFAULT_MAP_HOTKEY;
          if (mapKey !== (previous.mapHotkey ?? DEFAULT_MAP_HOTKEY)) {
            registerMapHotkey(mapKey);
          }
        }
        if (
          gameLog &&
          (userConfig.eftLogsPath ?? "") !== (previous.eftLogsPath ?? "")
        ) {
          gameLog.setLogsRoot(userConfig.eftLogsPath ?? "");
        }

        // Notify tooltip window of config changes that affect it
        if (tooltipWindow && !tooltipWindow.isDestroyed()) {
          tooltipWindow.webContents.send(
            IpcConstants.TooltipConfigChanged,
            userConfig
          );
        }

        return true;
      }
    );

    // IPC handler to toggle tooltips
    ipcMain.handle(IpcConstants.ToggleTooltips, (_event, enabled: boolean) => {
      if (enabled) {
        initializeTooltips();
      } else {
        destroyTooltips();
      }
      return true;
    });

    // IPC handler to toggle frameless mode
    ipcMain.handle(
      IpcConstants.ToggleFrameless,
      async (_event, enabled: boolean) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          const win = windows[0];
          // Remove the close listener temporarily so the app doesn't quit
          win.removeAllListeners("close");

          win.close();

          setTimeout(async () => {
            // Re-open the main window. openMainWindow will create a new one since windows.length is now 0.
            // It will use the updated user config.
            const newWin = await openMainWindow(
              MAIN_WINDOW_WEBPACK_ENTRY,
              MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY
            );

            if (ocr) {
              ocr.setPriceListWindow(newWin);
            }

            if (items && items.itemsAreLoaded()) {
              newWin.webContents.send(IpcConstants.ItemsDatabaseReady);
            }

            if (getUserConfigData().enableAlwaysOnTop) {
              new AlwaysOnTopProcess().initialize();
            }

            newWin.on("close", () => {
              app.quit();
            });
          }, 1000);
        }
        return true;
      }
    );

    // IPC handler to toggle always on top
    ipcMain.handle(
      IpcConstants.ToggleAlwaysOnTop,
      async (_event, enabled: boolean) => {
        if (enabled) {
          new AlwaysOnTopProcess().initialize();
        } else {
          new AlwaysOnTopProcess().disable();
        }

        const userConfig: UserConfig = getUserConfigData();
        userConfig.enableAlwaysOnTop = enabled;
        setUserConfigData(userConfig);

        return true;
      }
    );

    // IPC handlers for hotkey toggles
    ipcMain.handle(
      IpcConstants.ToggleMainWindow,
      async (_event, enabled: boolean) => {
        if (enabled) {
          globalShortcut.register("F1", () => {
            console.log("Toggling main window visibility");
            if (BrowserWindow.getAllWindows()[0].isVisible()) {
              BrowserWindow.getAllWindows()[0].hide();
            } else {
              BrowserWindow.getAllWindows()[0].show();
            }
          });
        } else {
          globalShortcut.unregister("F1");
        }

        const userConfig: UserConfig = getUserConfigData();
        userConfig.enableMainWindowToggle = enabled;
        setUserConfigData(userConfig);

        return true;
      }
    );

    ipcMain.handle(
      IpcConstants.ToggleDeleteLowestItem,
      async (_event, enabled: boolean) => {
        if (enabled) {
          globalShortcut.register("F2", () => {
            BrowserWindow.getAllWindows()[0].webContents.send(
              IpcConstants.DeleteItem
            );
          });
        } else {
          globalShortcut.unregister("F2");
        }

        const userConfig: UserConfig = getUserConfigData();
        userConfig.enableDeleteLowestItem = enabled;
        setUserConfigData(userConfig);

        return true;
      }
    );

    ipcMain.handle(
      IpcConstants.ToggleDeleteLastItem,
      async (_event, enabled: boolean) => {
        if (enabled) {
          globalShortcut.register("F3", () => {
            BrowserWindow.getAllWindows()[0].webContents.send(
              IpcConstants.DeleteLastItem
            );
          });
        } else {
          globalShortcut.unregister("F3");
        }

        const userConfig: UserConfig = getUserConfigData();
        userConfig.enableDeleteLastItem = enabled;
        setUserConfigData(userConfig);

        return true;
      }
    );

    ipcMain.handle(
      IpcConstants.ToggleIncrementLastItem,
      async (_event, enabled: boolean) => {
        if (enabled) {
          globalShortcut.register("F4", () => {
            BrowserWindow.getAllWindows()[0].webContents.send(
              IpcConstants.AddToItemCount
            );
          });
        } else {
          globalShortcut.unregister("F4");
        }

        const userConfig: UserConfig = getUserConfigData();
        userConfig.enableIncrementLastItem = enabled;
        setUserConfigData(userConfig);

        return true;
      }
    );

    ipcMain.handle(
      IpcConstants.ToggleScreenCalibration,
      async (_event, enabled: boolean) => {
        if (enabled) {
          globalShortcut.register("F6", () => {
            console.log("On step ", screenConfigureStep);
            if (!BrowserWindow.getAllWindows()[0].isVisible()) {
              BrowserWindow.getAllWindows()[0].show();
            }

            if (screenConfigureStep === 0) {
              const startTime = Date.now();
              const userConfig = getUserConfigData();
              const redValue = userConfig.borderColorRed ?? 82;
              const greenValue = userConfig.borderColorGreen ?? 89;
              const blueValue = userConfig.borderColorBlue ?? 90;
              console.log(
                "Starting screen configure with values:",
                redValue,
                greenValue,
                blueValue
              );
              BrowserWindow.getAllWindows()[0].webContents.send(
                IpcConstants.StartScreenConfigure
              );
              BrowserWindow.getAllWindows()[0].webContents.send(
                IpcConstants.DisableScreenConfigureNeeded
              );
              screenConfigureStep = 1;
              // Get RGB border color values from config

              screenConfigureProcess = isDev()
                ? spawn(
                    path.join(
                      app.getAppPath(),
                      "/lib/ocr/configure_screen.exe"
                    ),
                    [
                      redValue.toString(),
                      greenValue.toString(),
                      blueValue.toString(),
                    ]
                    // {
                    //   detached: true,
                    //   shell: true,
                    // }
                  )
                : spawn(
                    path.join(
                      process.resourcesPath,
                      "/ocr/configure_screen.exe"
                    ),
                    [
                      redValue.toString(),
                      greenValue.toString(),
                      blueValue.toString(),
                    ]
                  );

              screenConfigureProcess.stdout.setEncoding("utf-8");
              screenConfigureProcess.stdout.on("data", function (data) {
                console.log("Screen configure stderr data:", data.toString());
                isDev()
                  ? console.log("stderr: " + data)
                  : log.error("stderr: " + data);

                if (
                  data.toString().includes("Searching") &&
                  screenConfigureStep === 3
                ) {
                  screenConfigureStep = 4;
                  BrowserWindow.getAllWindows()[0].webContents.send(
                    IpcConstants.ScreenConfigureScanningSingleRow
                  );
                }

                if (
                  data.toString().includes("RESULT||") &&
                  screenConfigureStep === 4
                ) {
                  screenConfigureStep = 5;
                  BrowserWindow.getAllWindows()[0].webContents.send(
                    IpcConstants.ScreenConfigureScanComplete
                  );

                  const configData = data
                    .toString()
                    .replace("RESULT||", "")
                    .split("||");
                  const offsetX = configData[0];
                  const offsetY = configData[1];
                  const formattedConfigData = {
                    offsetX: parseInt(offsetX),
                    offsetY: parseInt(offsetY),
                  };

                  fs.writeFileSync(
                    isDev()
                      ? path.join(
                          app.getAppPath(),
                          "/lib/ocr/scanningConfig.json"
                        )
                      : path.join(
                          process.resourcesPath,
                          "/ocr/scanningConfig.json"
                        ),
                    JSON.stringify(formattedConfigData)
                  );
                }
              });

              screenConfigureProcess.on("close", function (code) {
                console.log("Screen configure process closed with code:", code);
                if (screenConfigureStep !== 5) {
                  BrowserWindow.getAllWindows()[0].webContents.send(
                    IpcConstants.EndScreenConfigure
                  );
                }
                screenConfigureStep = 0;
                screenConfigureProcess = null;
              });

              if (typeof screenConfigureProcess.pid !== "number") {
                console.error(
                  "Error: Failed to spawn subprocess. PID is undefined."
                );
                BrowserWindow.getAllWindows()[0].webContents.send(
                  IpcConstants.ScreenConfigureFailed
                );
                // Throw an error or handle the failure
              } else {
                console.log(
                  `Spawned subprocess correctly with PID: ${screenConfigureProcess.pid}`
                );

                const timeToWait = 1000 - (Date.now() - startTime);

                setTimeout(
                  () => {
                    console.log("Screen configure step 1 complete");
                    screenConfigureStep = 2;
                    BrowserWindow.getAllWindows()[0].webContents.send(
                      IpcConstants.ScreenConfigureStarted
                    );
                  },
                  timeToWait > 0 ? timeToWait : 0
                );
              }
            }

            if (screenConfigureStep === 2 && screenConfigureProcess) {
              console.log(
                "Advancing to step 3, searching for single row dimensions"
              );
              screenConfigureStep = 3;
              screenConfigureProcess.stdin.write("NEXT\n");
            }
          });
        } else {
          globalShortcut.unregister("F6");
        }

        const userConfig: UserConfig = getUserConfigData();
        userConfig.enableScreenCalibration = enabled;
        setUserConfigData(userConfig);

        return true;
      }
    );

    // log.info("MEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEOW");
    // ipcMain.on(IpcConstants.EnableTooltips, async (event, ...args) => {
    //   const tooltipWindow = new TooltipWindow();
    //   tooltipWindow.on("ready-to-show", () => {
    //     setTimeout(() => {
    //       const alwaysOnTopProcess = new AlwaysOnTopProcess();
    //       alwaysOnTopProcess.initialize();
    //       ocr.tooltipWindow = tooltipWindow;
    //       BrowserWindow.getAllWindows()[0].webContents.send(
    //         IpcConstants.TooltipsReady
    //       );
    //     }, 1000);
    //   });
    // });
  });

  app.on("before-quit", () => {
    ocr?.shutdown();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // MAC
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // openMainWindow(MAIN_WINDOW_WEBPACK_ENTRY, MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY);
    }
  });
} catch (e) {
  log.error("Error in main process:", e);
}
