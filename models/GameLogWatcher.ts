import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import log from "electron-log";

// Watches Escape from Tarkov's own log files (the same ones TarkovMonitor
// reads) to learn, cheaply and without touching the game:
//   - which game mode the client is in (Session mode: PvpSeason / Pve / ...)
//   - when a raid is created and on which map (Location: bigmap)
//   - when the raid actually starts (GameStarted)
//   - when it is over (the client re-selects the profile back in the menu)
//   - whether it was a PMC or Scav raid (raid profile id vs PMC profile id)
//
// Cost: one fs.stat every POLL_MS on the newest application log, reading only
// the bytes appended since the previous poll.

export const DEFAULT_EFT_LOGS_PATH =
  "C:\\Battlestate Games\\Escape from Tarkov\\Logs";

const POLL_MS = 2000;
const FOLDER_RESCAN_MS = 15000;

export type RaidKind = "pmc" | "scav" | "unknown";

// Quest lifecycle as the game itself reports it in push-notifications logs:
// the trader "chat message" types the client receives when you accept,
// fail or hand in a quest (same mechanism TarkovMonitor relies on)
export type QuestEventStatus = "started" | "failed" | "finished";
export type QuestEvent = { status: QuestEventStatus; at: string };

const MESSAGE_TYPE_TO_STATUS: Record<number, QuestEventStatus> = {
  10: "started",
  11: "failed",
  12: "finished",
};

export type GameState = {
  sessionMode: string | null; // raw value, e.g. "PvpSeason", "Pve", "Regular"
  mapNameId: string | null; // tarkov.dev map nameId, e.g. "bigmap"
  inRaid: boolean;
  raidKind: RaidKind;
  online: boolean;
  raidStartedAt: number | null;
};

export default class GameLogWatcher extends EventEmitter {
  private logsRoot: string;
  private currentFile: string | null = null;
  private offset = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private rescanTimer: NodeJS.Timeout | null = null;
  private pmcProfileId: string | null = null;
  private pendingRaidProfileId: string | null = null;
  private partialLine = "";
  // Per-task latest quest event, built from every session's notifications
  // log at startup and kept current from the live one
  private questEvents = new Map<string, QuestEvent>();
  private currentNotificationsFile: string | null = null;
  private notificationsSize = -1;
  private historyLoaded = false;

  public state: GameState = {
    sessionMode: null,
    mapNameId: null,
    inRaid: false,
    raidKind: "unknown",
    online: false,
    raidStartedAt: null,
  };

  constructor(logsRoot?: string) {
    super();
    this.logsRoot = logsRoot || DEFAULT_EFT_LOGS_PATH;
  }

  start(): void {
    this.stop();
    this.loadQuestEventHistory();
    this.pickNewestLog(true);
    this.pollTimer = setInterval(() => {
      this.poll();
      this.pollNotifications();
    }, POLL_MS);
    this.rescanTimer = setInterval(
      () => this.pickNewestLog(false),
      FOLDER_RESCAN_MS
    );
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    this.pollTimer = null;
    this.rescanTimer = null;
  }

  setLogsRoot(logsRoot: string): void {
    const next = logsRoot || DEFAULT_EFT_LOGS_PATH;
    if (next === this.logsRoot) return;
    this.logsRoot = next;
    this.currentFile = null;
    this.offset = 0;
    this.currentNotificationsFile = null;
    this.notificationsSize = -1;
    this.questEvents.clear();
    this.historyLoaded = false;
    if (this.pollTimer) {
      this.loadQuestEventHistory();
      this.pickNewestLog(true);
    }
  }

  // Latest known event per task id (accepted / failed / handed in)
  getQuestEvents(): Map<string, QuestEvent> {
    return this.questEvents;
  }

  hasQuestHistory(): boolean {
    return this.questEvents.size > 0;
  }

  // Read every session's notifications log once; they are tiny (a few KB)
  private loadQuestEventHistory(): void {
    if (this.historyLoaded) return;
    this.historyLoaded = true;
    try {
      if (!fs.existsSync(this.logsRoot)) return;
      const folders = fs
        .readdirSync(this.logsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("log_"))
        .map((d) => ({ name: d.name, time: GameLogWatcher.folderTime(d.name) }))
        .sort((a, b) => a.time - b.time);
      let files = 0;
      for (const folder of folders) {
        const dir = path.join(this.logsRoot, folder.name);
        for (const file of fs.readdirSync(dir)) {
          if (!/push-notifications(_\d+)?\.log$/i.test(file) && !/^notifications(_\d+)?\.log$/i.test(file)) {
            continue;
          }
          this.applyNotificationsText(fs.readFileSync(path.join(dir, file), "utf8"));
          files++;
        }
      }
      log.info(
        `Quest history from ${files} EFT notification logs: ${this.questEvents.size} tasks seen`
      );
    } catch (error) {
      log.warn("Failed to read EFT quest history:", error);
    }
  }

  // Re-parse the live notifications log whenever it grows (it stays small)
  private pollNotifications(): void {
    if (!this.currentFile) return;
    try {
      const dir = path.dirname(this.currentFile);
      if (!this.currentNotificationsFile || !fs.existsSync(this.currentNotificationsFile)) {
        const file = fs
          .readdirSync(dir)
          .find((f) => /push-notifications(_\d+)?\.log$/i.test(f) || /^notifications(_\d+)?\.log$/i.test(f));
        this.currentNotificationsFile = file ? path.join(dir, file) : null;
        // History load already covered the existing content
        this.notificationsSize = this.currentNotificationsFile
          ? fs.statSync(this.currentNotificationsFile).size
          : -1;
        return;
      }
      const size = fs.statSync(this.currentNotificationsFile).size;
      if (size === this.notificationsSize) return;
      this.notificationsSize = size;
      const before = this.questEvents.size;
      const changed = this.applyNotificationsText(
        fs.readFileSync(this.currentNotificationsFile, "utf8")
      );
      if (changed || this.questEvents.size !== before) {
        this.emit("quest-events", this.questEvents);
      }
    } catch (error) {
      log.warn("Failed to read EFT notifications log:", error);
    }
  }

  // Returns true if any task's latest event changed
  private applyNotificationsText(text: string): boolean {
    let changed = false;
    const pattern =
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\|[^\n]*Got notification \| ChatMessageReceived\r?\n(\{[\s\S]*?\n\})/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      try {
        const payload = JSON.parse(match[2]);
        const type = Number(payload?.message?.type);
        const status = MESSAGE_TYPE_TO_STATUS[type];
        const templateId: string = payload?.message?.templateId ?? "";
        const taskId = templateId.split(" ")[0];
        if (!status || !/^[a-f0-9]{24}$/i.test(taskId)) continue;
        const at = match[1];
        const previous = this.questEvents.get(taskId);
        // Files and blocks are processed chronologically; the latest wins
        if (!previous || previous.at <= at) {
          if (!previous || previous.status !== status) changed = true;
          this.questEvents.set(taskId, { status, at });
        }
      } catch {
        // Malformed block (file being written) - skip it
      }
    }
    return changed;
  }

  // The game creates a new log_<timestamp> folder per launch; follow the newest
  private pickNewestLog(initial: boolean): void {
    try {
      if (!fs.existsSync(this.logsRoot)) {
        if (initial) log.info(`EFT logs folder not found: ${this.logsRoot}`);
        return;
      }
      // Folder names look like log_2026.08.21_2-23-55_<version>; the hour
      // is not zero-padded, so sort on the parsed timestamp, not the text
      const folders = fs
        .readdirSync(this.logsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("log_"))
        .map((d) => ({ name: d.name, time: GameLogWatcher.folderTime(d.name) }))
        .sort((a, b) => a.time - b.time);
      if (folders.length === 0) return;

      const newest = path.join(
        this.logsRoot,
        folders[folders.length - 1].name
      );
      const appLog = fs
        .readdirSync(newest)
        .find((f) => /application(_\d+)?\.log$/i.test(f));
      if (!appLog) return;

      const file = path.join(newest, appLog);
      if (file === this.currentFile) return;

      // New session: reset state and replay the whole file once so we know
      // the current situation even if the app started mid-raid
      this.currentFile = file;
      this.offset = 0;
      this.partialLine = "";
      this.currentNotificationsFile = null;
      this.notificationsSize = -1;
      this.pendingRaidProfileId = null;
      this.pmcProfileId = null;
      this.setState({
        sessionMode: null,
        mapNameId: null,
        inRaid: false,
        raidKind: "unknown",
        online: false,
        raidStartedAt: null,
      });
      log.info(`Watching EFT log: ${file}`);
      this.poll();
    } catch (error) {
      log.warn("Failed to scan EFT logs folder:", error);
    }
  }

  static folderTime(name: string): number {
    const m =
      /log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{1,2})-(\d{1,2})/.exec(name);
    if (!m) return 0;
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    ).getTime();
  }

  private poll(): void {
    if (!this.currentFile) return;
    try {
      const size = fs.statSync(this.currentFile).size;
      if (size < this.offset) {
        // Truncated/rotated - start over on this file
        this.offset = 0;
        this.partialLine = "";
      }
      if (size === this.offset) return;

      const fd = fs.openSync(this.currentFile, "r");
      try {
        const length = size - this.offset;
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, this.offset);
        this.offset = size;
        const text = this.partialLine + buffer.toString("utf8");
        const lines = text.split(/\r?\n/);
        this.partialLine = lines.pop() ?? "";
        for (const line of lines) this.handleLine(line);
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      log.warn("Failed to read EFT log:", error);
    }
  }

  private handleLine(line: string): void {
    if (!line) return;

    if (line.includes("Session mode: ")) {
      const mode = /Session mode: (\S+)/.exec(line)?.[1] ?? null;
      if (mode && mode !== this.state.sessionMode) {
        this.setState({ sessionMode: mode });
        this.emit("session-mode", mode);
      }
      return;
    }

    // The profile the player selected in the menu is their PMC; a raid
    // created for a different profile id is a Scav run
    const profileMatch =
      /(?:SelectedProfile|SelectProfile|PrepareSelectedProfileLocally|CompleteSelectedProfile) ProfileId:(\w+)/.exec(
        line
      );
    if (profileMatch) {
      this.pmcProfileId = profileMatch[1];
      if (this.state.inRaid) {
        this.setState({ inRaid: false, raidStartedAt: null });
        this.emit("raid-ended", { ...this.state });
      }
      return;
    }

    if (line.includes("TRACE-NetworkGameCreate profileStatus")) {
      const mapNameId = /Location: ([^,\s]+)/.exec(line)?.[1] ?? null;
      const raidProfileId = /Profileid: (\w+)/.exec(line)?.[1] ?? null;
      const online = line.includes("RaidMode: Online");
      this.pendingRaidProfileId = raidProfileId;
      const raidKind: RaidKind =
        raidProfileId && this.pmcProfileId
          ? raidProfileId === this.pmcProfileId
            ? "pmc"
            : "scav"
          : "unknown";
      this.setState({ mapNameId, online, raidKind });
      this.emit("raid-created", { ...this.state });
      return;
    }

    if (line.includes("application|GameStarted")) {
      this.setState({ inRaid: true, raidStartedAt: Date.now() });
      this.emit("raid-started", { ...this.state });
      return;
    }

    if (
      line.includes("Network game matching aborted") ||
      line.includes("Network game matching cancelled")
    ) {
      this.pendingRaidProfileId = null;
      this.setState({ inRaid: false, raidStartedAt: null });
      return;
    }
  }

  private setState(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    this.emit("state", { ...this.state });
  }
}
