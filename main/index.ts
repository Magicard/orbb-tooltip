import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  session,
  Tray,
} from "electron";
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
import { UserConfig, getGameMode } from "../models/UserConfig";

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

  log.initialize();

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
            "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src *; img-src * data: blob:; style-src * 'unsafe-inline'; font-src * data:; media-src *; object-src *;",
          ],
        },
      });
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

    (await mainWindow).on("ready-to-show", () => {
      if (userConfig.enableAlwaysOnTop) {
        new AlwaysOnTopProcess().initialize();
      }
    });

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

        tooltipWindow.on("ready-to-show", () => {
          console.log("TOOLTIP WINDOW READY TO SHOW");
          setTimeout(() => {
            const userConfig = getUserConfigData();
            if (userConfig.enableAlwaysOnTop) {
              new AlwaysOnTopProcess().initialize();
            }
            BrowserWindow.getAllWindows()[0].webContents.send(
              IpcConstants.TooltipsReady
            );
          }, 1000);
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
        setInterval(() => {
          console.log("Refetching updated data");
          const userConfig = getUserConfigData();
          items
            .fetchItems(
              userConfig.tarkovMarketApiKey,
              getGameMode(userConfig),
              userConfig.tarkovTrackerApiToken
            )
            .catch((error) => {
              // Keep serving the previously fetched prices if a refetch fails
              log.warn("Periodic item refetch failed:", error);
            });
        }, 1000 * 60 * 15);

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
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
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
        setUserConfigData(userConfig);

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
