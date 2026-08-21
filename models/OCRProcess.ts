import { screen, app, BrowserWindow } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import TooltipWindow from "./TooltipWindow";
import Items from "./Items";
import IpcConstants from "./IpcConstants";
import path from "path";
import { isDev } from "../utils";
import koffi from "koffi";
import log from "electron-log";
import Item from "./Item";
import { getUserConfigData } from "../main/services/config";

export default class OCRProcess {
  constructor(items: Items, priceListWindow: BrowserWindow) {
    this.priceListWindow = priceListWindow;
    this.items = items;
    this.itemNamesLowerCaseList = this.items.items.map((item) =>
      item.name.toLowerCase()
    );
  }

  public tooltipWindow: TooltipWindow | null;
  protected priceListWindow: BrowserWindow;
  protected items: Items;
  protected itemNamesLowerCaseList: string[] = [];
  // Miss-log throttle: remember recently logged OCR strings so a name the
  // scanner keeps re-reading is written to the log once, not every frame
  protected recentMissLog = new Map<string, number>();
  // Cursor anchor (DIP) of the item currently shown, and the tooltip's last
  // reported rendered size - used to keep the tooltip on the display
  protected tooltipAnchor: { x: number; y: number } | null = null;
  protected tooltipSize = { width: 200, height: 80 };
  protected ocrProcess: ChildProcessWithoutNullStreams | null = null;
  // On-demand full-screen OCR (Tasks screen scan): output collected between
  // SCANRESULT_BEGIN / SCANRESULT_END markers
  protected scanBuffer: string | null = null;
  protected scanResolve: ((tsv: string) => void) | null = null;
  protected scanReject: ((error: Error) => void) | null = null;
  protected scanTimer: NodeJS.Timeout | null = null;
  protected user32: koffi.IKoffiLib;
  protected Point: koffi.IKoffiCType;

  public setPriceListWindow(priceListWindow: BrowserWindow): void {
    this.priceListWindow = priceListWindow;
  }

  getMousePos(): { x: number; y: number } | null {
    const GetCursorPos = this.user32.func(
      "int __stdcall GetCursorPos(_Out_ POINT *pos)"
    );

    // Get and show cursor position
    const pos = {};
    try {
      if (!GetCursorPos(pos)) throw new Error("Failed to get cursor position");
      return pos as { x: number; y: number };
    } catch (error) {
      console.error("Error getting cursor position:", error);
      return null;
    }
  }

  // Convert physical pixel coordinates to logical (DPI-scaled) coordinates for Electron
  getLogicalPosition(
    physicalX: number,
    physicalY: number
  ): { x: number; y: number } {
    // screenToDipPoint handles per-display origins and mixed scale factors
    // (Windows only, which is the only platform the OCR helpers run on)
    if (typeof screen.screenToDipPoint === "function") {
      const dipPoint = screen.screenToDipPoint({ x: physicalX, y: physicalY });
      return { x: Math.round(dipPoint.x), y: Math.round(dipPoint.y) };
    }

    // Fallback: naive scaling, only correct for a single display at (0,0)
    const display = screen.getDisplayNearestPoint({
      x: physicalX,
      y: physicalY,
    });
    const scaleFactor = display.scaleFactor;

    return {
      x: Math.round(physicalX / scaleFactor),
      y: Math.round(physicalY / scaleFactor),
    };
  }

  logMiss(text: string): void {
    const now = Date.now();
    const lastLogged = this.recentMissLog.get(text) ?? 0;
    if (now - lastLogged < 5 * 60 * 1000) return;

    this.recentMissLog.set(text, now);
    if (this.recentMissLog.size > 200) {
      // Drop the oldest entry; the map preserves insertion order
      const oldest = this.recentMissLog.keys().next().value;
      if (oldest !== undefined) this.recentMissLog.delete(oldest);
    }
    log.info(`OCR text did not match any item: "${text}"`);
  }

  // Place the tooltip beside the cursor, flipping to the other side when it
  // would run off the display. Uses the last rendered size reported by the
  // tooltip window (the window itself is a fixed transparent canvas)
  clampTooltipPosition(
    logicalPos: { x: number; y: number },
    size: { width: number; height: number }
  ): { x: number; y: number } {
    const offset = 13;
    const display = screen.getDisplayNearestPoint(logicalPos);
    const bounds = display.workArea ?? display.bounds;

    let x = logicalPos.x + offset;
    let y = logicalPos.y + offset;

    if (x + size.width > bounds.x + bounds.width) {
      x = Math.max(bounds.x, logicalPos.x - offset - size.width);
    }
    if (y + size.height > bounds.y + bounds.height) {
      y = Math.max(bounds.y, logicalPos.y - offset - size.height);
    }

    return { x: Math.round(x), y: Math.round(y) };
  }

  onTooltipSize(size: { width: number; height: number }): void {
    if (!size || !(size.width > 0) || !(size.height > 0)) return;
    this.tooltipSize = size;

    // Re-place the current tooltip now that its real size is known
    if (
      this.tooltipAnchor &&
      this.tooltipWindow &&
      !this.tooltipWindow.isDestroyed()
    ) {
      const pos = this.clampTooltipPosition(this.tooltipAnchor, size);
      const [currentX, currentY] = this.tooltipWindow.getPosition();
      if (pos.x !== currentX || pos.y !== currentY) {
        this.tooltipWindow.setPosition(pos.x, pos.y);
      }
    }
  }

  initialize(): void {
    this.user32 = koffi.load("user32.dll");
    this.Point = koffi.struct("POINT", {
      x: "long",
      y: "long",
    });

    // Get RGB border color values from config
    const userConfig = getUserConfigData();
    const redValue = userConfig.borderColorRed ?? 82;
    const greenValue = userConfig.borderColorGreen ?? 89;
    const blueValue = userConfig.borderColorBlue ?? 90;

    isDev()
      ? console.log(
          "Initializing OCR process with values:",
          redValue,
          greenValue,
          blueValue
        )
      : log.info("Initializing OCR process");

    // const ocrProcess = ;
    const ocrProcess = isDev()
      ? spawn(path.join(app.getAppPath(), "/lib/ocr/ocr_cpp.exe"), [
          redValue.toString(),
          greenValue.toString(),
          blueValue.toString(),
        ])
      : spawn(path.join(process.resourcesPath, "/ocr/ocr_cpp.exe"), [
          redValue.toString(),
          greenValue.toString(),
          blueValue.toString(),
        ]);

    this.ocrProcess = ocrProcess;
    ocrProcess.stdout.setEncoding("utf-8");
    ocrProcess.stdout.on("data", this.onNewData.bind(this));
    ocrProcess.stderr.on("data", function (data) {
      // Tesseract chatter from page scans (resolution estimate, diacritics)
      // is not an error
      if (/Estimating resolution|Detected \d+ diacritics/.test(String(data))) {
        return;
      }
      isDev() ? console.log("stderr: " + data) : log.error("stderr: " + data);
    });

    ocrProcess.on("close", function (code) {
      isDev()
        ? console.log("closing code: " + code)
        : log.info("closing code: " + code);
    });

    isDev()
      ? console.log("Successfully initialized OCR process")
      : log.info("Successfully initialized OCR process");
    return;
  }

  protected scanQueue: Promise<unknown> = Promise.resolve();
  // Ctrl+wheel events from the helper's low-level hook (see ocr_cpp)
  public onWheel: ((delta: number) => void) | null = null;

  // Enable/disable the helper's Ctrl+wheel hook (swallows those events)
  setWheelHookEnabled(enabled: boolean): void {
    if (!this.ocrProcess || this.ocrProcess.killed) return;
    this.ocrProcess.stdin.write(
      enabled ? "WHEELHOOK ON\n" : "WHEELHOOK OFF\n"
    );
  }

  // Ask the helper to OCR the whole screen (or a region, in physical
  // pixels); resolves with Tesseract TSV. Requests are serialised.
  requestScreenScan(
    region?: { x: number; y: number; width: number; height: number },
    dumpPath?: string,
    exclude: { x: number; y: number; width: number; height: number }[] = []
  ): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        if (!this.ocrProcess || this.ocrProcess.killed) {
          reject(new Error("OCR process not running"));
          return;
        }
        this.scanResolve = resolve;
        this.scanReject = reject;
        this.scanBuffer = "";
        this.scanTimer = setTimeout(() => this.finishScan(null), 20 * 1000);
        const command = region
          ? `SCANREGION ${Math.round(region.x)} ${Math.round(region.y)} ${Math.round(region.width)} ${Math.round(region.height)}` +
            exclude
              .map(
                (r) =>
                  ` EXCLUDE ${Math.round(r.x)} ${Math.round(r.y)} ${Math.round(r.width)} ${Math.round(r.height)}`
              )
              .join("") +
            (dumpPath ? ` DUMP ${dumpPath}` : "")
          : "SCAN";
        this.ocrProcess.stdin.write(command + "\n");
      });
    const next = this.scanQueue.then(run, run);
    this.scanQueue = next.catch(() => undefined);
    return next;
  }

  protected finishScan(tsv: string | null): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    const resolve = this.scanResolve;
    const reject = this.scanReject;
    this.scanResolve = null;
    this.scanReject = null;
    this.scanBuffer = null;
    if (tsv !== null) resolve?.(tsv);
    else reject?.(new Error("Screen scan timed out"));
  }

  onNewData(data: any): void {
    try {
      // Wheel events can be interleaved with anything else; pull them out
      if (this.scanBuffer === null && String(data).includes("WHEEL||")) {
        const text = String(data);
        const remaining: string[] = [];
        for (const line of text.split(/\r?\n/)) {
          const m = /^WHEEL\|\|(-?\d+)/.exec(line.trim());
          if (m) this.onWheel?.(Number(m[1]));
          else if (line.trim()) remaining.push(line);
        }
        if (remaining.length === 0) return;
        data = remaining.join("\n");
      }

      // Route scan output (which can arrive in several chunks) to the
      // pending request instead of the tooltip pipeline
      if (this.scanBuffer !== null) {
        this.scanBuffer += data.toString();
        const end = this.scanBuffer.indexOf("SCANRESULT_END");
        if (end < 0) return;
        const begin = this.scanBuffer.indexOf("SCANRESULT_BEGIN");
        const tsv =
          begin >= 0 && begin < end
            ? this.scanBuffer.slice(begin + "SCANRESULT_BEGIN".length, end)
            : "";
        const rest = this.scanBuffer
          .slice(end + "SCANRESULT_END".length)
          .trim();
        this.finishScan(tsv);
        if (rest) this.onNewData(rest);
        return;
      }

      if (data.includes("IGNORE||NO CONFIG FILE FOUND")) {
        this.priceListWindow.webContents.send(
          IpcConstants.ScreenConfigureNeeded
        );
        return;
      }

      const text = new String(data);
      const incomingData = text.toString().trim();
      if (incomingData === "MOUSEMOVE") {
        this.tooltipAnchor = null;
        if (this.tooltipWindow) {
          this.tooltipWindow.webContents.send(
            IpcConstants.NewTooltipItem,
            null
          );
          setTimeout(() => {
            this.tooltipWindow.setBounds({ width: 0, height: 0, x: 0, y: 0 });
          }, 30);
        }
      } else if (incomingData.includes("||")) {
        // eslint-disable-next-line no-control-regex
        const incomingDataCleanedUp = incomingData.replace(/[^\x00-\x7F]/g, "");
        let itemName = incomingDataCleanedUp.split("||")[0];

        // ocr_cpp emits "IGNORE||<reason>" control lines for non-item
        // reads - never treat those as an item name to search for
        if (itemName.trim().toUpperCase() === "IGNORE") {
          return;
        }
        const coords = incomingDataCleanedUp.split("||")[1];
        const x = parseInt(coords.split(",")[0]);
        const y = parseInt(coords.split(",")[1]);
        let item: Item | null = null;

        if (
          !itemName.toLowerCase().includes("thicc") &&
          !itemName.toLowerCase().includes("junk") &&
          !itemName.toLowerCase().includes("items case")
        ) {
          if (this.itemNamesLowerCaseList.includes(itemName.toLowerCase())) {
            item = this.items.items.find(
              (x) => x.name.toLowerCase() === itemName.toLowerCase()
            );
          } else {
            if (itemName.includes("WD-40 (1")) {
              itemName = "WD-40 (100ml)";
            } else if (itemName.includes("WD-40 (4")) {
              itemName = "WD-40 (400ml)";
            }

            if (itemName.toLowerCase().includes("kektape")) {
              itemName = "kektape";
            }

            if (itemName.toLowerCase().includes("pc cpi")) {
              itemName = "pc cpu";
            }

            if (itemName.toLowerCase().includes("mule")) {
              itemName = "M.U.L.E stimulant injector";
            }

            const allowedLowerScoreItems = [
              "magnet",
              "arena",
              "cult",
              "poste",
              "kektape",
              "military",
              "matche",
              "sewing",
              "key tool",
            ];

            if (this.items && this.items.search) {
              const userConfig = getUserConfigData();
              item = this.items.search(
                itemName,
                allowedLowerScoreItems.filter((i) =>
                  itemName.toLowerCase().includes(i)
                ).length > 0
                  ? 12
                  : userConfig.lowestAcceptableScore ?? 50
              );
            }
          }

          // Log misses so "hovered but nothing happened" is diagnosable
          // from the log file (raw OCR text vs. the item database)
          if (!item && itemName.trim().length >= 3) {
            this.logMiss(itemName.trim());
          }
        }

        if (item && item.name !== "T H I C C item case") {
          const mousePos = this.getMousePos();
          const electronMousePos = screen.getCursorScreenPoint();

          // Ignore reads while the cursor sits at the center of the screen
          // (the game snaps it there), regardless of display resolution.
          // Tolerance is ~10 physical px, so divide by the DIP scale factor
          const display = screen.getDisplayNearestPoint(electronMousePos);
          const centerX = display.bounds.x + display.bounds.width / 2;
          const centerY = display.bounds.y + display.bounds.height / 2;
          const tolerance = Math.max(2, 10 / display.scaleFactor);
          if (
            Math.abs(electronMousePos.x - centerX) < tolerance &&
            Math.abs(electronMousePos.y - centerY) < tolerance
          ) {
            return;
          }

          if (mousePos.x === x && mousePos.y === y) {
            if (
              !incomingData.includes("||MENU") &&
              this.priceListWindow.isVisible()
            ) {
              this.priceListWindow.webContents.send(
                IpcConstants.NewTooltipItem,
                item
              );
            }

            if (this.tooltipWindow) {
              this.tooltipWindow.webContents.send(
                IpcConstants.NewTooltipItem,
                item
              );
              setTimeout(() => {
                // Convert physical pixel coordinates to logical coordinates for proper 4K/high-DPI support
                const logicalPos = this.getLogicalPosition(
                  mousePos.x,
                  mousePos.y
                );
                this.tooltipAnchor = logicalPos;
                const tooltipPos = this.clampTooltipPosition(
                  logicalPos,
                  this.tooltipSize
                );
                this.tooltipWindow.setPosition(tooltipPos.x, tooltipPos.y);
                setTimeout(() => {
                  this.tooltipWindow.setBounds({ width: 500, height: 500 });
                }, 10);
              }, 5);
            }
          }
        }
      }
    } catch (error) {
      console.log(error);
    }
  }
}
