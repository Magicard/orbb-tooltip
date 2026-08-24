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
  shell,
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
  GameMode,
} from "../models/UserConfig";
import QuestPanelWindow from "../models/QuestPanelWindow";
import GameLogWatcher from "../models/GameLogWatcher";
import TaskScan from "../models/TaskScan";
import MapWindow from "../models/MapWindow";
import TrackerSync from "../models/TrackerSync";
import { OPERATIONAL_ID_PREFIX, type QuestChange } from "../models/TaskData";
import { ammoChartUrl } from "../models/ammoCharts";
import koffi from "koffi";

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

  // F6 - Screen Calibration (the Calibrate button in the app runs the same
  // steps, see RequestScreenCalibration)
  screenCalibrationStep = () => {
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
  };
  if (userConfig.enableScreenCalibration !== false) {
    // Default to true if not set
    globalShortcut.register("F6", () => screenCalibrationStep?.());
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
// Runs one step of the screen calibration (F6 / the Calibrate button in the app)
let screenCalibrationStep: (() => void) | null = null;
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
  let questPanelRefreshHotkey: string | null = null;
  let questPanelPushTimer: NodeJS.Timeout | null = null;
  // Map the user picked in the panel; cleared when a new raid starts
  let questPanelMapOverride: string | null = null;
  let taskScan: TaskScan | null = null;
  // Everything learned about quests lately, newest first, whatever told us:
  // the Tasks-screen scanner, the game's log, an in-raid toast, the tracker
  const recentChanges: QuestChange[] = [];
  // Task names by id, so log events can be reported by name
  const questCatalogNames = new Map<string, string>();

  // ---- TarkovTracker as the shared source of truth -------------------
  // Out of raid the tracker is polled (and pulled on demand when the panel
  // opens), so anything TarkovMonitor - or you on another device - marked
  // there lands here too. In raid we leave the network alone.
  // Set once the quest panel exists; refreshes whatever is on screen
  let requestPanelRefresh: (() => void) | null = null;
  const TRACKER_POLL_MS = 3 * 60 * 1000;
  const TRACKER_MIN_GAP_MS = 45 * 1000;
  let trackerPollTimer: NodeJS.Timeout | null = null;
  let lastTrackerPullAt = 0;
  let trackerPullInFlight: Promise<void> | null = null;

  const pullTrackerProgress = (reason: string, force = false): Promise<void> => {
    const config = getUserConfigData();
    const token = config.tarkovTrackerApiToken?.trim();
    if (!items || !token) return Promise.resolve();
    if (!force && Date.now() - lastTrackerPullAt < TRACKER_MIN_GAP_MS) return Promise.resolve();
    if (trackerPullInFlight) return trackerPullInFlight;
    lastTrackerPullAt = Date.now();
    const before = items.taskData.getLastProgress();
    const previousDone = new Set(before?.completedTaskIds ?? []);
    const knownBefore = !!before;
    trackerPullInFlight = items
      .refreshTrackerProgress(getGameMode(config), token)
      .then((progress) => {
        if (!progress) return;
        // Only report what is new to us, and only once we had something to
        // compare against (the first pull is not "news")
        if (knownBefore) {
          const fresh = [...progress.completedTaskIds].filter(
            (id) =>
              !previousDone.has(id) &&
              // Not something the game's log already told us about (it says
              // "handed in" for the same event, minutes earlier)
              gameLog?.getQuestEvents().get(id)?.status !== "finished"
          );
          noteChanges(
            // Named, so several completions cannot collapse into one line
            fresh.map((id) => `${questCatalogNames.get(id) ?? `Quest ${id.slice(0, 6)}`} completed`),
            "tracker"
          );
        }
        log.info(`TarkovTracker progress pulled (${reason})`);
        requestPanelRefresh?.();
      })
      .catch((error) => log.warn(`TarkovTracker pull failed (${reason}):`, error))
      .finally(() => {
        trackerPullInFlight = null;
      });
    return trackerPullInFlight;
  };

  // An overlay must really be on top the moment it opens. (The helper looks
  // after itself: its close handler respawns it, a watchdog kills it if it
  // goes quiet, and its heartbeat re-asserts the wheel hook.)
  const raiseOverlays = (): void => {
    for (const win of [questPanel, mapWindow]) {
      if (!win || win.isDestroyed() || !win.isVisible()) continue;
      win.setAlwaysOnTop(true, "screen-saver");
    }
  };

  const startTrackerPolling = (): void => {
    if (trackerPollTimer) return;
    trackerPollTimer = setInterval(() => {
      if (gameLog?.state.inRaid) return; // busy playing; the log covers us
      void pullTrackerProgress("poll");
    }, TRACKER_POLL_MS);
  };
  const MAX_RECENT_CHANGES = 40;
  const noteChanges = (texts: string[], source: QuestChange["source"]): void => {
    if (texts.length === 0) return;
    const at = Date.now();
    for (const text of texts) {
      // The same fact arriving twice in a row (a re-read, a re-emitted log
      // line) is not news
      if (recentChanges.some((c) => c.text === text && at - c.at < 60 * 1000)) continue;
      recentChanges.unshift({ at, text, source });
    }
    recentChanges.splice(MAX_RECENT_CHANGES);
    for (const text of texts) log.info(`Quest change (${source}): ${text}`);
  };
  let trackerSync: TrackerSync | null = null;

  // Pushes progress to TarkovTracker unless the token / setting say no.
  // Configured once here and again only when those settings change.
  const getTrackerSync = (): TrackerSync => {
    if (!trackerSync) {
      trackerSync = new TrackerSync(app.getPath("userData"));
      const config = getUserConfigData();
      trackerSync.configure(config.tarkovTrackerApiToken ?? null, config.syncToTracker !== false);
    }
    return trackerSync;
  };

  // Game mode a TarkovTracker token was minted for, from its prefix
  const tokenGameMode = (token: string | undefined): GameMode | null =>
    token?.startsWith("SZN_") ? "pvp-season" : token?.startsWith("PVE_") ? "pve" : token?.startsWith("PVP_") ? "regular" : null;
  // Game mode the game itself says it is in (from its log), when known
  const sessionGameMode = (): GameMode | null => {
    const mode = gameLog?.state.sessionMode?.toLowerCase() ?? "";
    return mode.includes("season") ? "pvp-season" : mode.includes("pve") ? "pve" : mode ? "regular" : null;
  };
  let pushBlockReason: string | null = null;
  // Only push when the game, the app's game mode and the token all agree -
  // progress from one wipe or mode must never land on another profile
  const canPushToTracker = (): boolean => {
    const config = getUserConfigData();
    const appMode = getGameMode(config);
    const tokenMode = tokenGameMode(config.tarkovTrackerApiToken);
    const liveMode = sessionGameMode();
    let reason: string | null = null;
    if (tokenMode && tokenMode !== appMode) reason = `token is for ${tokenMode}, app is set to ${appMode}`;
    else if (liveMode && liveMode !== appMode) reason = `game is in ${liveMode}, app is set to ${appMode}`;
    if (reason !== pushBlockReason) {
      pushBlockReason = reason;
      if (reason) log.warn(`TarkovTracker sync paused: ${reason}`);
    }
    return reason === null;
  };

  // What the tracker already knows, so nothing it has is sent again
  const trackerHasTask = (taskId: string, state: "completed" | "failed"): boolean => {
    const progress = items.taskData.getLastProgress();
    if (!progress) return false;
    return state === "completed"
      ? progress.completedTaskIds.has(taskId)
      : progress.failedTaskIds.has(taskId);
  };
  const trackerObjective = (objectiveId: string) =>
    items.taskData.getLastProgress()?.objectiveProgress.get(objectiveId);

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
    requestPanelRefresh = () => pushQuestPanelData();

    function pushProfileInfo() {
      const progress = items?.taskData.getLastProgress();
      void mainWindow.then((win) => {
        if (win.isDestroyed()) return;
        win.webContents.send(IpcConstants.ProfileInfo, {
          displayName: progress?.displayName ?? null,
          playerLevel: progress?.playerLevel ?? null,
          pmcFaction: progress?.pmcFaction ?? null,
        });
      });
    }

    function pushQuestPanelData() {
      pushProfileInfo();
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
            taskScan,
            recentChanges
          );
          data.mapOverride = !!questPanelMapOverride;
          for (const q of [...data.here, ...data.anywhere]) questCatalogNames.set(q.id, q.name);
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

    // Ctrl and the panel key together: put the overlays back in order without
    // restarting. Windows drops the low-level wheel hook from time to time,
    // and a window that missed its way out of click-through stays dead until
    // something tells it otherwise. Nothing here throws anything away, so it
    // is safe to lean on whenever the panel stops answering.
    function refreshOverlays() {
      for (const win of [questPanel, mapWindow]) {
        if (!win || win.isDestroyed()) continue;
        // Hand the window back to the hover poll, which decides again within
        // a tenth of a second
        win.setInteractive(false);
        if (win.isVisible()) win.setAlwaysOnTop(true, "screen-saver");
      }
      ocr?.setWheelHookEnabled(questPanel?.isPanelVisible() === true);
      pushQuestPanelData();
      log.info("Overlays refreshed by hotkey");
    }

    function registerQuestPanelHotkey(accelerator: string) {
      for (const registered of [questPanelHotkey, questPanelRefreshHotkey]) {
        if (registered) globalShortcut.unregister(registered);
      }
      questPanelHotkey = null;
      questPanelRefreshHotkey = null;
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
      const refresh = `CommandOrControl+${wanted}`;
      try {
        if (globalShortcut.register(refresh, refreshOverlays)) {
          questPanelRefreshHotkey = refresh;
        } else {
          log.warn(`Overlay refresh hotkey "${refresh}" could not be registered`);
        }
      } catch (error) {
        log.warn(`Invalid overlay refresh hotkey "${refresh}":`, error);
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
      // Quest states as they stood at the previous emission: only what
      // changes from here on is live play - the history replayed from old
      // log folders (other wipes, other modes) is never pushed anywhere
      let lastQuestStates: Map<string, string> | null = null;
      gameLog.on("quest-events", () => {
        const events = gameLog!.getQuestEvents();
        void items.setQuestEvents(events);
        // Only what changed since the last emission is live play; the first
        // read replays every log folder on disk
        const justHappened = lastQuestStates
          ? [...events].filter(([id, e]) => lastQuestStates?.get(id) !== e.status)
          : [];
        // The logs are the truth for hand-ins and failures: tell the tracker
        // about the ones it does not have yet
        if (items.taskData.getLastProgress() && canPushToTracker()) {
          const sync = getTrackerSync();
          for (const [taskId, event] of justHappened) {
            const state =
              event.status === "finished" ? "completed" : event.status === "failed" ? "failed" : null;
            if (state && !trackerHasTask(taskId, state)) sync.queueTask(taskId, state);
          }
        }
        noteChanges(
          justHappened.map(([taskId, event]) => {
            const name = questCatalogNames.get(taskId) ?? "A quest";
            return event.status === "finished"
              ? `${name} handed in`
              : event.status === "failed"
                ? `${name} failed`
                : `${name} accepted`;
          }),
          "game"
        );
        lastQuestStates = new Map([...events].map(([id, e]) => [id, e.status]));
        pushQuestPanelData();
      });
      gameLog.on("raid-ended", () => {
        pushQuestPanelData();
        // TarkovMonitor needs a moment to push the raid's results to
        // TarkovTracker; then pull them so tooltips and the panel update
        // without waiting for the idle poll. Through the shared gate, so it
        // cannot race another pull or double up with one.
        setTimeout(() => void pullTrackerProgress("raid ended", true), 20 * 1000);
      });
      gameLog.start();
      void items.setQuestEvents(gameLog.getQuestEvents());
    }

    // One OCR pass over the game's Tasks screen; merges task progress,
    // objective counts and operational tasks into the panel
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

    // force = read the screen even if it looks unchanged (first pass of a
    // session: the helper's baseline may be from a previous session)
    // Bumped whenever a session starts, so a read still in flight when one
    // ends can tell that it belongs to a session nobody is watching any more
    let scanGeneration = 0;

    async function scanTasksScreenOnce(force = false, generation = scanGeneration): Promise<number> {
      if (!ocr || scanInProgress) return 0;
      scanInProgress = true;
      try {
        const config = getUserConfigData();
        const mode = getGameMode(config);
        const [tsv, catalog, maps] = await Promise.all([
          // Our own panel and map are blacked out: without this the scanner
          // reads its own output back as if it were the game (a quest row it
          // drew keeps re-confirming whatever it already believed)
          ocr.requestScreenScan(undefined, undefined, overlayRects(), !force),
          items.taskData.loadTaskCatalog(mode),
          items.taskData.loadMaps(mode),
        ]);
        if (!taskScan) taskScan = new TaskScan(app.getPath("userData"));
        if (tsv.trim() === "UNCHANGED") {
          // Same screen as the last read: what it showed is confirmed
          taskScan.confirmLastRead();
          return -1;
        }
        // The session was stopped while this read was in the helper. Applying
        // it now would slip rows in behind endSession's back, where nothing
        // is left to judge them.
        if (generation !== scanGeneration) return 0;
        const passStartedAt = Date.now();
        const activeIds = [...(gameLog?.getQuestEvents() ?? new Map()).entries()]
          .filter(([, e]) => e.status === "started")
          .map(([id]) => id);
        const result = taskScan.apply(
          tsv,
          catalog,
          maps.map((m) => m.name),
          activeIds
        );
        // Hand what this pass read to TarkovTracker, but nothing on a
        // single sighting: the tracker only moves forward, so a completion
        // needs two reads of the tick and a counter two reads of the same
        // value before either is written.
        const sync = getTrackerSync();
        for (const state of canPushToTracker() ? taskScan.statesSince(passStartedAt) : []) {
          if (!state.objectiveId) continue;
          const known = trackerObjective(state.objectiveId);
          const corroborated = state.done && state.doneSeen >= OCR_WRITE_CONFIRMATIONS;
          sync.queueObjective(state.objectiveId, {
            state: corroborated && !known?.complete ? "completed" : undefined,
            count:
              typeof state.count === "number" &&
              (state.countSeen ?? 0) >= OCR_WRITE_CONFIRMATIONS &&
              state.count > (known?.count ?? 0)
                ? state.count
                : undefined,
          });
        }
        scanSessionUpdates += result.updates;
        scanSessionNewTasks += result.newTasks;
        noteChanges(result.changes, "scan");
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
    // A scan session runs passes back to back (the helper skips the OCR
    // while the screen has not changed, so idling on the Tasks screen is
    // free) until it is toggled off, it has seen no task rows for a while,
    // or this much time has passed
    const SCAN_SESSION_MS = 3 * 60 * 1000;
    // The wait *between* passes. A pass that read something means you are
    // navigating, so the next one starts straight away; otherwise we idle at
    // the slower rate, where each check is only the ~70ms "has the screen
    // changed" test.
    const SCAN_SESSION_BUSY_MS = 60;
    const SCAN_SESSION_IDLE_MS = 200;
    // How often a pass reads the screen properly rather than asking whether it
    // has changed. A screen that is sitting still is skipped by the cheap test
    // for ever, so without this the Tasks screen is read exactly once a
    // session - and one reading is one roll of the dice. OCR is not the same
    // twice over: a counter the progress bar swallowed on one read comes back
    // on the next, and a rotating task needs a second sighting before anything
    // is announced. Out of a raid nothing else wants the CPU, so we pay for it.
    const SCAN_FORCED_EVERY = 3;
    // Stop after this many reads that found no task rows at all - so a
    // hotkey press on a raid screen (every frame different, every pass a
    // full OCR) gives up quickly - but never before the player has had time
    // to reach the Tasks screen. Higher than it looks because forced reads
    // count where a skipped frame did not.
    const SCAN_SESSION_MAX_EMPTY_PASSES = 8;
    // Reads that must agree before an OCR-derived completion is written to
    // TarkovTracker (the panel shows it after the first)
    const OCR_WRITE_CONFIRMATIONS = 2;
    const SCAN_SESSION_GRACE_MS = 40 * 1000;
    // The scan hotkey / panel chip toggles the session
    function toggleScanSession() {
      if (scanSessionTimer) stopScanSession("stopped");
      else startScanSession();
    }

    // The one way a session ends, whether you toggled it off or it ran out
    function stopScanSession(why: "stopped" | "ended") {
      if (scanSessionTimer) clearTimeout(scanSessionTimer);
      scanSessionTimer = null;
      scanSessionUntil = 0;
      scanSessionEndedAt = Date.now();
      // The map was put away for the scan, so it goes back up
      if (mapHiddenForScan) {
        mapHiddenForScan = false;
        if (mapWindow && !mapWindow.isDestroyed()) mapWindow.showMap();
      }
      getTrackerSync().release();
      // Now that every pass is in, throw out the rows only one of them saw
      taskScan?.endSession();
      log.info(`Tasks screen scan session ${why}: ${scanSessionUpdates} update(s)`);
      sendScanStatus(false);
      pushQuestPanelData();
    }

    let scanSessionUpdates = 0;
    // The map was up when a scan started, so it goes back up afterwards
    let mapHiddenForScan = false;
    let scanSessionNewTasks = 0;
    let scanSessionEndedAt: number | null = null;
    function sendScanStatus(active: boolean) {
      questPanel?.sendScanStatus({
        active,
        secondsLeft: active
          ? Math.max(0, Math.round((scanSessionUntil - Date.now()) / 1000))
          : 0,
        tasks: taskScan ? taskScan.getLastScan().count : 0,
        updates: scanSessionUpdates,
        newTasks: scanSessionNewTasks,
        endedAt: scanSessionEndedAt,
      });
    }

    function startScanSession() {
      scanSessionUntil = Date.now() + SCAN_SESSION_MS;
      scanSessionEmptyRuns = 0;
      // The panel is where the session's progress shows, so make sure it
      // is on screen: the key press is acknowledged the moment it happens.
      // It is a thin strip at the right edge, clear of the task list.
      if (questPanel && !questPanel.isPanelVisible()) questPanel.showPanel();
      // The map is not: it can cover most of the screen, and our own windows
      // are masked out of the scan, so leaving it up would black out the
      // task list we are trying to read. Put it away and bring it back after.
      if (mapWindow?.isMapVisible()) {
        mapHiddenForScan = true;
        mapWindow.hideMap();
        log.info("Map hidden while the Tasks screen is being read");
      }
      if (scanSessionTimer) {
        sendScanStatus(true);
        return; // already running - just extended
      }
      // Everything this session learns goes to TarkovTracker in one round
      // when it finishes, rather than a trickle of writes while you scroll
      getTrackerSync().hold();
      scanGeneration++;
      taskScan?.beginSession();
      scanSessionUpdates = 0;
      scanSessionNewTasks = 0;
      scanSessionEndedAt = null;
      log.info("Tasks screen scan session started");
      sendScanStatus(true);
      let lastPassFound = 1;
      const startedAt = Date.now();
      let everFound = false;
      // Every attempt, including the ones the screen-changed test waves away
      let attempts = 0;
      const tick = async () => {
        // In a raid the game needs its frames more than we do, so only the
        // first pass is read in full there
        const forceRead = gameLog?.state.inRaid
          ? attempts === 0
          : attempts % SCAN_FORCED_EVERY === 0;
        attempts++;
        const found = await scanTasksScreenOnce(forceRead, scanGeneration);
        // -1 = screen unchanged: nothing new to learn; it only counts as an
        // empty pass when the last real read was empty too (the player has
        // left the Tasks screen and is sitting still somewhere else)
        if (found >= 0) {
          lastPassFound = found;
          scanSessionEmptyRuns = found > 0 ? 0 : scanSessionEmptyRuns + 1;
          if (found > 0) everFound = true;
        } else if (lastPassFound === 0) {
          scanSessionEmptyRuns++;
        }
        // Give up early only once the player has had a chance to open the
        // Tasks screen, or as soon as it goes quiet after finding something
        const impatient = everFound || Date.now() - startedAt >= SCAN_SESSION_GRACE_MS;
        const done =
          Date.now() >= scanSessionUntil ||
          (impatient && scanSessionEmptyRuns >= SCAN_SESSION_MAX_EMPTY_PASSES);
        if (done) {
          stopScanSession("ended");
          return;
        }
        sendScanStatus(true);
        // found > 0 = rows were read this pass; -1 = screen unchanged
        scanSessionTimer = setTimeout(
          tick,
          found > 0 ? SCAN_SESSION_BUSY_MS : SCAN_SESSION_IDLE_MS
        );
      };
      scanSessionTimer = setTimeout(tick, 0);
    }


    // In-raid notification toasts (bottom-right of the screen): read every
    // 2s while in a PMC raid; the helper keeps only the bright pixels of the
    // strip and skips OCR entirely while nothing bright is there
    // The game shows a notification for roughly 2.5s. Sampling faster than
    // that guarantees at least one look while it is up, with room to spare
    // for a slow frame - and a look is cheap (~60ms) because the helper
    // throws away everything but the bright pixels before deciding to OCR.
    const TOAST_INTERVAL_MS = 1500;
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
          noteChanges(
            events.map((e) =>
              e.kind === "ready"
                ? `${e.name} is ready to hand in`
                : e.kind === "failed"
                  ? `${e.name} failed`
                  : `${e.name}: subtask done`
            ),
            "raid"
          );
          const sync = getTrackerSync();
          for (const event of canPushToTracker() ? events : []) {
            if (event.kind !== "ready" || !event.taskId) continue;
            // Only for a quest the logs confirm is active: a misread toast
            // must not complete objectives on the tracker
            if (gameLog?.getQuestEvents().get(event.taskId)?.status !== "started") continue;
            const task = catalog.find((t) => t.id === event.taskId);
            // "Ready" means the required objectives are done; optional ones
            // may well not be
            for (const objective of (task?.objectives ?? []).filter((o) => !o.optional)) {
              if (!trackerObjective(objective.id)?.complete) {
                sync.queueObjective(objective.id, { state: "completed" });
              }
            }
          }
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
        mapWindow.onVisibilityChange = (visible) => {
          if (visible) raiseOverlays();
        };
      }

      // Ctrl+wheel (hooked in the OCR helper) scrolls the panel while open;
      // the map window closes and reopens together with the panel
      questPanel.onVisibilityChange = (visible) => {
        ocr?.setWheelHookEnabled(visible);
        // Opening the panel is a good moment to check our own plumbing and
        // catch up with the tracker
        if (visible) {
          raiseOverlays();
          if (!gameLog?.state.inRaid) void pullTrackerProgress("panel opened");
        }
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
      startTrackerPolling();
      if (ocr) {
        ocr.onWheel = (delta) => questPanel?.scrollBy(delta);
      }
      registerQuestPanelHotkey(
        config.questPanelHotkey ?? DEFAULT_QUEST_PANEL_HOTKEY
      );
      pushQuestPanelData();
    }

    function destroyQuestPanel() {
      for (const registered of [questPanelHotkey, questPanelRefreshHotkey]) {
        if (registered) globalShortcut.unregister(registered);
      }
      questPanelHotkey = null;
      questPanelRefreshHotkey = null;
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

    // Overlay windows are clickable exactly while the cursor is over them.
    // Decided here from the cursor position rather than from the renderer's
    // mouseenter / mouseleave, which Windows + Electron's click-through
    // forwarding deliver unreliably (a missed leave left the panel either
    // stuck clickable or stuck click-through with hover styles still
    // lighting up). A press in progress keeps the window interactive so a
    // drag can run past its edge.
    //
    // While the game owns the mouse there is nothing to hover with and taking
    // it would cost the player their aim - but that is not the whole of a
    // raid: open the inventory on Tab and the game hands a cursor back, and
    // the panel should work there like anywhere else. Windows knows which of
    // the two it is, so ask it rather than reading anything into the raid.
    const overlayUser32 = koffi.load("user32.dll");
    const GetAsyncKeyState = overlayUser32.func("short GetAsyncKeyState(int vKey)");
    // Nameless on purpose: koffi's type names are global to the process and
    // the OCR helper has already claimed POINT
    const CURSORINFO = koffi.struct({
      cbSize: "uint32",
      flags: "uint32",
      hCursor: "void *",
      ptScreenPos: koffi.struct({ x: "long", y: "long" }),
    });
    const GetCursorInfo = overlayUser32.func("__stdcall", "GetCursorInfo", "bool", [
      koffi.inout(koffi.pointer(CURSORINFO)),
    ]);
    // CURSOR_SHOWING
    const CURSOR_ON_SCREEN = 0x01;
    const cursorOnScreen = (): boolean => {
      const info: { cbSize: number; flags: number; hCursor: unknown; ptScreenPos: { x: number; y: number } } = {
        cbSize: koffi.sizeof(CURSORINFO),
        flags: 0,
        hCursor: null,
        ptScreenPos: { x: 0, y: 0 },
      };
      // If the call fails, assume there is one: the worst that costs is a
      // hoverable panel, where the other way round is a dead one
      return !GetCursorInfo(info) || (info.flags & CURSOR_ON_SCREEN) !== 0;
    };
    const OVERLAY_HOVER_POLL_MS = 100;
    // Ctrl and the middle button over an item opens its calibre's ammo chart.
    // Read by polling rather than by hooking the button: GetAsyncKeyState's
    // low bit says whether it went down since we last asked, so nothing has to
    // sit in the way of the game's own input to catch it.
    const VK_MIDDLE_BUTTON = 0x04;
    const WENT_DOWN_SINCE_LAST_ASKED = 0x0001;
    const HELD_NOW = 0x8000;
    let middleWasDown = false;
    const pollAmmoChartClick = (): void => {
      const middle = GetAsyncKeyState(VK_MIDDLE_BUTTON);
      const down = (middle & HELD_NOW) !== 0 || (middle & WENT_DOWN_SINCE_LAST_ASKED) !== 0;
      const pressed = down && !middleWasDown;
      middleWasDown = (middle & HELD_NOW) !== 0;
      if (!pressed || (GetAsyncKeyState(0x11) & HELD_NOW) === 0) return;
      const item = ocr?.getHoveredItem();
      if (!item) return;
      const url = ammoChartUrl(item.name);
      if (!url) return;
      log.info(`Opening the ammo chart for ${item.name}: ${url}`);
      void shell.openExternal(url);
    };

    setInterval(() => {
      pollAmmoChartClick();
      const overlays = [questPanel, mapWindow].filter(
        (w): w is NonNullable<typeof w> => !!w && !w.isDestroyed() && w.isVisible()
      );
      if (overlays.length === 0) return;
      const cursor = screen.getCursorScreenPoint();
      const buttonDown = (GetAsyncKeyState(0x01) & 0x8000) !== 0;
      // Aiming down a sight, not sitting in the inventory
      const gameHasTheMouse = !!gameLog?.state.inRaid && !cursorOnScreen();
      for (const w of overlays) {
        const b = w.getBounds();
        const inside =
          cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
        w.setInteractive(!gameHasTheMouse && (inside || (buttonDown && w.isInteractive())));
      }
    }, OVERLAY_HOVER_POLL_MS);

    // Quest panel buttons
    ipcMain.on(IpcConstants.QuestPanelToggleScan, () => toggleScanSession());
    // Right-click throws a scanned task away. Only the rotating ones: a quest
    // the catalog knows comes from your own logs and would be back a second
    // later, so there is nothing to throw away.
    ipcMain.on(IpcConstants.QuestPanelForgetTask, (_event, questId: string) => {
      if (typeof questId !== "string" || !questId.startsWith(OPERATIONAL_ID_PREFIX)) return;
      if (taskScan?.forget(questId.slice(OPERATIONAL_ID_PREFIX.length))) pushQuestPanelData();
    });
    ipcMain.on(IpcConstants.RequestScreenCalibration, () => screenCalibrationStep?.());

    // Middle-click on a quest opens its wiki page in the default browser;
    // only wiki pages, nothing else a renderer might ask for
    ipcMain.on(IpcConstants.OpenExternal, (_event, url: string) => {
      if (
        typeof url === "string" &&
        /^https:\/\/escapefromtarkov\.fandom\.com\/wiki\/[^\s]+$/.test(url)
      ) {
        void shell.openExternal(url);
      }
    });
    ipcMain.on(IpcConstants.QuestPanelScanStatusRequest, () =>
      sendScanStatus(!!scanSessionTimer)
    );
    ipcMain.on(IpcConstants.QuestPanelClose, () => questPanel?.hidePanel());
    ipcMain.on(IpcConstants.QuestPanelToggleMap, () => {
      mapWindow?.toggle();
      if (mapWindow?.isMapVisible()) pushQuestPanelData();
    });

    // Map window
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
        const tokenChanged =
          (userConfig.tarkovTrackerApiToken ?? "") !== (previous.tarkovTrackerApiToken ?? "");
        if (tokenChanged || (userConfig.syncToTracker !== false) !== (previous.syncToTracker !== false)) {
          getTrackerSync().configure(
            userConfig.tarkovTrackerApiToken ?? null,
            userConfig.syncToTracker !== false
          );
        }
        if (tokenChanged && items) {
          // The "does the tracker already have this" checks must answer for
          // the new account before anything is pushed to it. Through the
          // same gate as the poll, so an in-flight pull for the old token
          // cannot land last and win.
          void pullTrackerProgress("token changed", true);
        }

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
