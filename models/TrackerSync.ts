import fs from "fs";
import path from "path";
import log from "electron-log";

// Pushes what this app learns about quest progress - task completions from
// the game's logs, objective completions and counters read off the Tasks
// screen - to TarkovTracker, so the tracker stays the one source of truth
// across devices. Writes cost the user daily quota there and need a token
// with the WP (write progress) permission, so: only changes are sent, task
// states go in one batch, and what was sent is remembered on disk.
//
// Never sends "uncompleted": a tick the OCR failed to see must not undo
// progress the tracker already has.

export type TrackerTaskState = "completed" | "failed";
export type TrackerObjectiveUpdate = { state?: "completed"; count?: number };

const TRACKER_API_BASES = [
  "https://api.tarkovtracker.org/api/v2",
  "https://tarkovtracker.org/api/v2",
  "https://tarkovtracker.io/api/v2",
];
const USER_AGENT = "orbb-tooltip/1.0 (+https://github.com/Magicard/orbb-tooltip)";
const FLUSH_DELAY_MS = 4000;
const TIMEOUT_MS = 15 * 1000;
const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;
const ERROR_BACKOFF_MS = 3 * 60 * 1000;

export type TrackerSyncStatus = {
  enabled: boolean;
  lastPushAt: number | null;
  lastError: string | null;
  pushedTasks: number;
  pushedObjectives: number;
};

export default class TrackerSync {
  private token: string | null = null;
  private enabled = true;
  private file: string | null = null;
  private pushedTasks = new Map<string, TrackerTaskState>();
  private pushedObjectives = new Map<string, TrackerObjectiveUpdate>();
  private pendingTasks = new Map<string, TrackerTaskState>();
  private pendingObjectives = new Map<string, TrackerObjectiveUpdate>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private base: string | null = null;
  private blockedUntil = 0;
  private lastError: string | null = null;
  private lastPushAt: number | null = null;
  // Token the remembered state belongs to (so a restart keeps it) and the
  // token every host refused writes for (so we stop asking until it changes)
  private stateToken: string | null = null;
  private rejectedToken: string | null = null;
  public onStatus: ((status: TrackerSyncStatus) => void) | null = null;

  constructor(userDataPath?: string) {
    if (userDataPath) {
      this.file = path.join(userDataPath, "tracker-sync.json");
      this.load();
    }
  }

  configure(token: string | null, enabled: boolean): void {
    this.token = token || null;
    if (this.token && this.stateToken !== this.token) {
      // A different account than the remembered state belongs to: nothing
      // sent so far applies to it (a restart with the same token keeps it)
      this.base = null;
      this.lastError = null;
      this.pushedTasks.clear();
      this.pushedObjectives.clear();
      this.stateToken = this.token;
      this.save();
    }
    // Writes refused for this token stay off until the token changes
    this.enabled = enabled && this.token !== this.rejectedToken;
    this.report();
  }

  status(): TrackerSyncStatus {
    return {
      enabled: this.enabled && !!this.token,
      lastPushAt: this.lastPushAt,
      lastError: this.lastError,
      pushedTasks: this.pushedTasks.size,
      pushedObjectives: this.pushedObjectives.size,
    };
  }

  queueTask(taskId: string, state: TrackerTaskState): void {
    if (!taskId || this.pushedTasks.get(taskId) === state) return;
    this.pendingTasks.set(taskId, state);
    this.schedule();
  }

  queueObjective(objectiveId: string, update: TrackerObjectiveUpdate): void {
    if (!objectiveId) return;
    const previous = this.pushedObjectives.get(objectiveId);
    const next: TrackerObjectiveUpdate = {};
    if (update.state === "completed" && previous?.state !== "completed") next.state = "completed";
    if (
      typeof update.count === "number" &&
      update.count > 0 &&
      update.count > (previous?.count ?? 0)
    ) {
      next.count = update.count;
    }
    if (next.state === undefined && next.count === undefined) return;
    const pending = this.pendingObjectives.get(objectiveId) ?? {};
    this.pendingObjectives.set(objectiveId, { ...pending, ...next });
    this.schedule();
  }

  private schedule(): void {
    if (!this.enabled || !this.token || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.enabled || !this.token) return;
    if (Date.now() < this.blockedUntil) return;
    if (this.pendingTasks.size === 0 && this.pendingObjectives.size === 0) return;
    this.flushing = true;
    try {
      const tasks = [...this.pendingTasks.entries()];
      const objectives = [...this.pendingObjectives.entries()];
      this.pendingTasks.clear();
      this.pendingObjectives.clear();

      if (tasks.length > 0) {
        const ok = await this.post(
          "/progress/tasks",
          tasks.map(([id, state]) => ({ id, state }))
        );
        if (ok) for (const [id, state] of tasks) this.pushedTasks.set(id, state);
        else for (const [id, state] of tasks) this.pendingTasks.set(id, state);
      }
      for (const [id, update] of objectives) {
        if (Date.now() < this.blockedUntil) {
          this.pendingObjectives.set(id, update);
          continue;
        }
        const ok = await this.post(`/progress/task/objective/${encodeURIComponent(id)}`, update);
        if (ok) {
          const previous = this.pushedObjectives.get(id) ?? {};
          this.pushedObjectives.set(id, { ...previous, ...update });
        } else {
          this.pendingObjectives.set(id, update);
        }
      }
      if (tasks.length > 0 || objectives.length > 0) {
        if (!this.lastError) {
          this.lastPushAt = Date.now();
          log.info(
            `TarkovTracker sync: sent ${tasks.length} task state(s), ${objectives.length} objective update(s)`
          );
        }
        this.save();
        this.report();
      }
    } finally {
      this.flushing = false;
      if (this.pendingTasks.size > 0 || this.pendingObjectives.size > 0) {
        // Something was held back (rate limit / transient error): retry later
        setTimeout(() => this.schedule(), Math.max(FLUSH_DELAY_MS, this.blockedUntil - Date.now()));
      }
    }
  }

  // POST to the first host that accepts the token; remembers that host
  private async post(route: string, body: unknown): Promise<boolean> {
    const bases = this.base ? [this.base] : TRACKER_API_BASES;
    let rejected = 0;
    for (const base of bases) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(base + route, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
            "User-Agent": USER_AGENT,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.status === 401 || res.status === 403) {
          rejected++;
          continue;
        }
        if (res.status === 429) {
          this.blockedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
          this.lastError = "TarkovTracker write quota reached - pausing sync for 15 minutes";
          log.warn(this.lastError);
          this.report();
          return false;
        }
        if (!res.ok) {
          this.blockedUntil = Date.now() + ERROR_BACKOFF_MS;
          this.lastError = `TarkovTracker returned ${res.status} for ${route} - retrying in a few minutes`;
          log.warn(this.lastError);
          this.report();
          return false;
        }
        this.base = base;
        this.lastError = null;
        return true;
      } catch (error) {
        this.blockedUntil = Date.now() + ERROR_BACKOFF_MS;
        this.lastError = `TarkovTracker unreachable: ${String((error as Error)?.message ?? error)}`;
        log.warn(this.lastError);
        this.report();
        return false;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (rejected > 0) {
      // Every host refused: the token has no write permission (or is for
      // another account). Stop trying until the token changes.
      this.enabled = false;
      this.rejectedToken = this.token;
      this.lastError =
        "TarkovTracker rejected the write - the API token needs the WP (write progress) permission";
      log.warn(this.lastError);
      this.report();
    }
    return false;
  }

  private report(): void {
    this.onStatus?.(this.status());
  }

  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const [id, state] of Object.entries(data.tasks ?? {})) {
        this.pushedTasks.set(id, state as TrackerTaskState);
      }
      for (const [id, update] of Object.entries(data.objectives ?? {})) {
        this.pushedObjectives.set(id, update as TrackerObjectiveUpdate);
      }
      this.base = typeof data.base === "string" ? data.base : null;
      this.lastPushAt = typeof data.lastPushAt === "number" ? data.lastPushAt : null;
      this.stateToken = typeof data.token === "string" ? data.token : null;
    } catch (error) {
      log.warn("Failed to load tracker sync state:", error);
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.writeFileSync(
        this.file,
        JSON.stringify({
          tasks: Object.fromEntries(this.pushedTasks),
          objectives: Object.fromEntries(this.pushedObjectives),
          base: this.base,
          lastPushAt: this.lastPushAt,
          token: this.stateToken,
        })
      );
    } catch (error) {
      log.warn("Failed to save tracker sync state:", error);
    }
  }
}
