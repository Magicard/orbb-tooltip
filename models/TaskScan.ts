import fs from "fs";
import path from "path";
import log from "electron-log";
import MiniSearch from "minisearch";
import type { CatalogObjective, CatalogTask } from "./TaskData";

// Reads the game's Tasks screen from an on-demand full-screen OCR (see
// ocr_cpp "SCAN"): task rows ("<name>  <location>  active  60%") and, for
// the selected task, objective rows ("Eliminate Scavs ...  3/5"). This is
// the only source for progress counts the trackers don't know, and for the
// rotating Operational (daily/weekly) tasks that no catalog lists.

export type ScannedTask = {
  key: string; // normalized name
  name: string; // as read from the screen
  taskId: string | null; // catalog match, if any
  percent?: number; // absent when the screen showed no progress bar
  status: string;
  location: string;
  at: number;
  // How many separate scan passes read this same name. A task no catalog
  // knows (a rotating Operational one) is only believed once it has been
  // read the same way twice, which OCR garbage almost never manages
  seen?: number;
};

// Passes an unknown name must be read in before it is shown
const UNKNOWN_CONFIRMATIONS = 2;
// Two passes closer together than this are treated as the same reading
const CONFIRMATION_GAP_MS = 900;
// Bumped when stored readings stop being trustworthy (see load). v2 masked
// the app's own overlay out of the scan; v3 is when that masking actually
// reached the helper (the exclusion rects were being dropped on the way).
const SCAN_STORE_VERSION = 3;

export type ScannedObjective = {
  key: string; // normalized objective text
  text: string;
  count: number;
  total: number;
  at: number;
};

// Whether an objective row of a task showed the game's completion tick
export type ScannedObjectiveState = {
  key: string; // "<taskId>|<normalized objective text>"
  taskId: string;
  objectiveId?: string;
  text: string;
  done: boolean;
  // How many separate reads have seen this objective ticked. Showing it as
  // done locally on the first sighting is free to undo; writing it to
  // someone's tracker is not, so that waits for a second look.
  doneSeen: number;
  // Counter shown on the row ("3/5"), when it has one
  count?: number;
  total?: number;
  at: number;
};

// A stray token OCR makes of the icons around an objective row: no real
// letters in it, or a short run of capitals
const STRAY_TOKEN = /^[^A-Za-z0-9]*.?[^A-Za-z0-9]*$|^[A-Z]{1,2}$/;

type Word = {
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
  // Tick-coloured pixels just right of the word (ocr_cpp annotates full
  // screen scans with this); the Tasks screen draws a cyan tick after a
  // completed objective
  ticks: number;
  // Percentage of this word's row band painted the "objective done" blue
  doneBand: number;
};

// Enough tick-coloured pixels to be the glyph rather than noise
const TICK_PIXELS = 25;
// A row band this blue is a completed objective, tick seen or not
const DONE_BAND_PERCENT = 55;

// In-raid notification toasts (bottom-right), e.g.
//   "Subtask completed: Eagle Eye"
//   "Task The Cult is ready to be completed"
export type ToastEvent = {
  kind: "subtask" | "ready" | "failed";
  name: string;
  taskId: string | null;
  at: number;
};

export type ToastState = { ready: boolean; subtasks: number; at: number };

const TOAST_PATTERNS: { kind: ToastEvent["kind"]; pattern: RegExp }[] = [
  { kind: "subtask", pattern: /subtask\s+comp\w*[:;.]?\s*(.+)$/i },
  { kind: "ready", pattern: /task\s+(.+?)\s+is\s+ready\s+to\s+be\s+comp/i },
  { kind: "failed", pattern: /task\s+(.+?)\s+(?:has\s+)?failed/i },
];

const STATUS_PATTERN = /^(activ\w*|comple\w*|lock\w*|fail\w*|avail\w*|done)$/i;
// The exact status words the trader's task list ends a row with ("active!"
// reads as "activel"); a looser match would turn objective sentences that
// happen to end in "complex" or "lockers" into phantom tasks
const TRADER_STATUS_PATTERN = /^(activ\w{0,2}|completed|locked|failed|available)$/i;
// A trader-list row is a short name plus its status
const TRADER_ROW_MAX_TOKENS = 8;
const PERCENT_PATTERN = /^(\d{1,3})\s*%$/;
const COUNT_PATTERN = /^(\d{1,4})\s*\/\s*(\d{1,4})$/;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\[.*?\]/g, "") // "[Season PvP]" suffixes
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export default class TaskScan {
  private tasks = new Map<string, ScannedTask>();
  private objectives = new Map<string, ScannedObjective>();
  private objectiveStates = new Map<string, ScannedObjectiveState>();
  private file: string | null = null;
  private lastScanAt = 0;
  private lastScanCount = 0;
  // Latest in-raid toast state per task (keyed by task id, or normalized
  // name for tasks no catalog knows)
  private toasts = new Map<string, ToastState>();
  private recentToastKeys = new Map<string, number>();

  constructor(userDataPath?: string) {
    if (userDataPath) {
      this.file = path.join(userDataPath, "task-scan.json");
      this.load();
    }
  }

  getTasks(): Map<string, ScannedTask> {
    return this.tasks;
  }

  // Tasks read off the screen that no catalog knows - the rotating
  // Operational ones - excluding single reads, which are usually OCR noise
  getUnknownTasks(): ScannedTask[] {
    return [...this.tasks.values()].filter(
      (t) => !t.taskId && (t.seen ?? 1) >= UNKNOWN_CONFIRMATIONS
    );
  }

  getLastScan(): { at: number; count: number } {
    return { at: this.lastScanAt, count: this.lastScanCount };
  }

  toastFor(taskId: string | null, name: string): ToastState | undefined {
    return (
      (taskId ? this.toasts.get(taskId) : undefined) ??
      this.toasts.get(normalizeName(name))
    );
  }

  // Parse a bottom-right region scan for notification toasts; returns the
  // events that are new (the same toast stays on screen for a while)
  applyToastTsv(
    tsv: string,
    catalog: CatalogTask[],
    knownNames: string[] = []
  ): ToastEvent[] {
    const rows = groupRows(parseTsv(tsv));
    const now = Date.now();
    const events: ToastEvent[] = [];
    for (const row of rows) {
      const text = row.map((w) => w.text).join(" ");
      for (const { kind, pattern } of TOAST_PATTERNS) {
        const m = pattern.exec(text);
        if (!m) continue;
        const rawName = m[1].replace(/[^\w\s'\-:.]+$/g, "").trim();
        if (rawName.length < 3) break;
        const taskId = matchTask(buildNameIndex(catalog), catalog, rawName);
        const name =
          (taskId && catalog.find((t) => t.id === taskId)?.name) ||
          knownNames.find((n) => normalizeName(n) === normalizeName(rawName)) ||
          rawName;
        const dedupeKey = `${kind}|${normalizeName(name)}`;
        const last = this.recentToastKeys.get(dedupeKey) ?? 0;
        if (now - last < 90 * 1000) break; // still the same toast
        this.recentToastKeys.set(dedupeKey, now);

        const key = taskId ?? normalizeName(name);
        const state = this.toasts.get(key) ?? { ready: false, subtasks: 0, at: now };
        if (kind === "ready") state.ready = true;
        if (kind === "subtask") state.subtasks += 1;
        if (kind === "failed") state.ready = false;
        state.at = now;
        this.toasts.set(key, state);
        events.push({ kind, name, taskId, at: now });
        break;
      }
    }
    if (events.length) {
      log.info(
        "In-raid toast: " +
          events.map((e) => `${e.kind} ${e.name}`).join(", ")
      );
      this.save();
    }
    return events;
  }

  // The screen has not changed since the last read. That is not a second
  // sighting - a row misread once would be "confirmed" by simply standing
  // still - so nothing is re-counted; we only note that what we know is
  // still current, which keeps the "scanned just now" line honest.
  confirmLastRead(): void {
    if (!this.lastScanAt) return;
    this.lastScanAt = Date.now();
  }

  // Objective states written at or after a moment (what a scan pass found)
  statesSince(at: number): ScannedObjectiveState[] {
    return [...this.objectiveStates.values()].filter((s) => s.at >= at);
  }

  stateFor(taskId: string, objectiveText: string): ScannedObjectiveState | undefined {
    return this.objectiveStates.get(`${taskId}|${normalizeName(objectiveText)}`);
  }

  percentFor(taskId: string): number | undefined {
    // Matched tasks are stored under their id, so this is a direct lookup
    return this.tasks.get(`id:${taskId}`)?.percent;
  }

  // Scanned objective counts, matched by text (OCR-tolerant contains)
  countFor(objectiveText: string): { count: number; total: number } | undefined {
    const wanted = normalizeName(objectiveText);
    if (!wanted) return undefined;
    for (const o of this.objectives.values()) {
      if (o.key === wanted) return { count: o.count, total: o.total };
    }
    // Tolerate OCR dropping/garbling a few characters: compare the first
    // 40 normalized characters
    const head = wanted.slice(0, 40);
    for (const o of this.objectives.values()) {
      if (o.key.slice(0, 40) === head) return { count: o.count, total: o.total };
    }
    return undefined;
  }

  // Parse a TSV page and merge what it finds. Returns how many task rows
  // were recognised.
  apply(
    tsv: string,
    catalog: CatalogTask[],
    mapNames: string[],
    activeTaskIds: Iterable<string> = []
  ): {
    tasks: number;
    objectives: number;
    updates: number;
    newTasks: number;
    // One line per real change, ready to show ("Break the Deal 19% -> 75%")
    changes: string[];
  } {
    const words = parseTsv(tsv);
    const rows = groupRows(words);
    const now = Date.now();
    const index = buildNameIndex(catalog);
    // Objective rows of the task open on the screen: text, whether the
    // game's completion tick follows it, and the counter if it has one
    const objectiveRows: { text: string; done: boolean; count?: number; total?: number }[] = [];
    // Keyed by the sorted word set so a map name the game wrapped onto two
    // lines ("Streets of" / "Tarkov", read back as "Streets Tarkov of") is
    // still recognised; the value is the name to display
    const locations = new Map<string, string>();
    for (const m of ["Any location", ...mapNames]) locations.set(wordSetKey(m), m);
    const mapWords = mapVocabulary(mapNames);

    this.prune(catalog, mapNames);

    let taskRows = 0;
    let objectiveCount = 0;
    // Things this pass actually changed: new or changed task rows, changed
    // counters, objective ticks - what the player wants to hear about
    let updates = 0;
    let newTasks = 0;
    const changes: string[] = [];

    // Where the Tasks screen's location column starts, learned from the
    // rows whose map name read cleanly in this pass. Rows whose location
    // was misread ("DUreets Tarkov ur") then lose those words from the name
    // by position instead of by spelling.
    let locationColumnX: number | null = null;
    for (const row of rows) {
      const texts = row.map((w) => w.text);
      if (!texts.some((t) => PERCENT_PATTERN.test(t))) continue;
      const statusIdx = texts.findIndex((t) => STATUS_PATTERN.test(t));
      if (statusIdx < 2) continue;
      for (let start = statusIdx - 1; start >= Math.max(1, statusIdx - 3); start--) {
        if (locations.has(wordSetKey(texts.slice(start, statusIdx).join(" ")))) {
          const x = row[start].left;
          locationColumnX = locationColumnX === null ? x : Math.min(locationColumnX, x);
          break;
        }
      }
    }

    for (const row of rows) {
      const texts = row.map((w) => w.text);
      const joined = texts.join(" ");

      // ---- objective row: "... 3/5" (or "3 / 5" split into words) ----
      let countMatch: RegExpExecArray | null = null;
      for (const tail of [1, 2, 3]) {
        const candidate = texts.slice(-tail).join("").replace(/\s+/g, "");
        countMatch = COUNT_PATTERN.exec(candidate);
        if (countMatch) break;
      }
      if (countMatch && row.length > 3) {
        const count = Number(countMatch[1]);
        const total = Number(countMatch[2]);
        if (total > 0 && count <= total) {
          const text = stripStrayTokens(stripTrailingCount(joined).split(/\s+/)).join(" ");
          const key = normalizeName(text);
          // Rows that swallowed a neighbour (a status word or percent in
          // the middle) are not objectives; the text-keyed map is only a
          // fallback for countFor and its churn is not an "update"
          const merged = texts.slice(0, -1).some((t) => PERCENT_PATTERN.test(t) || STATUS_PATTERN.test(t));
          if (key.length >= 8 && !merged) {
            this.objectives.set(key, { key, text, count, total, at: now });
            objectiveRows.push({ text, done: count >= total, count, total });
            objectiveCount++;
            continue;
          }
        }
      }

      // ---- objective row without a counter: "<text>" or "<text> [tick]" ----
      if (
        row.length >= 4 &&
        !texts.some((t) => PERCENT_PATTERN.test(t)) &&
        traderRowTail(texts) === null
      ) {
        // The row starts with an icon and may end with the tick itself,
        // both of which OCR turns into a stray short token
        const trimmed = stripStrayTokens(row, (w) => w.text);
        const text = trimmed.map((w) => w.text).join(" ");
        if (normalizeName(text).length >= 12) {
          const tail = trimmed[trimmed.length - 1];
          const ticked = row.slice(row.indexOf(tail)).some((w) => w.ticks >= TICK_PIXELS);
          // Most of the row's band being blue means the game struck it out
          // as done, even when the tick glyph itself was missed
          const banded =
            trimmed.filter((w) => w.doneBand >= DONE_BAND_PERCENT).length > trimmed.length / 2;
          objectiveRows.push({ text, done: ticked || banded });
        }
      }

      // ---- task row: "<name> <location> <status> <percent>" (character
      // Tasks screen) or "<name> [location] <status>" (trader's task list,
      // which shows no progress bar) ----
      let percentIdx = texts.findIndex((t) => PERCENT_PATTERN.test(t));
      let percent: number | undefined;
      const traderTail = traderRowTail(texts);
      if (percentIdx >= 2) {
        percent = Number(PERCENT_PATTERN.exec(texts[percentIdx])![1]);
        if (!(percent >= 0 && percent <= 100)) continue;
      } else if (percentIdx < 0 && traderTail !== null) {
        percentIdx = traderTail;
      } else {
        continue;
      }
      // Last status word before the percent column
      let statusIdx = -1;
      for (let i = percentIdx - 1; i >= 1; i--) {
        if (STATUS_PATTERN.test(texts[i])) {
          statusIdx = i;
          break;
        }
      }
      if (statusIdx < 1) continue;
      const status = texts[statusIdx];

      // Location is the longest trailing run of words before the status
      // that forms a known map name / "Any location"
      let location = "";
      let nameEnd = statusIdx;
      // Narrowest match first so "[Season PvP] Any location" keeps the tag
      // with the task name. Only the character's Tasks screen (the one with
      // a progress bar) has a location column; on the trader's list the word
      // before the status is the end of the name, so only an exact map name
      // counts there ("Big Customer" must not become "Big" on Customs)
      for (let start = statusIdx - 1; start >= Math.max(1, statusIdx - 4); start--) {
        const found = lookupLocation(locations, texts.slice(start, statusIdx).join(" "), percent !== undefined);
        if (found) {
          location = found;
          nameEnd = start;
          break;
        }
      }
      if (!location && percent !== undefined && locationColumnX !== null) {
        // Whatever sits in the location column is the location, however
        // badly it read; it is not part of the name
        const firstInColumn = row.findIndex((w, i) => i >= 1 && i < statusIdx && w.left >= locationColumnX - 12);
        if (firstInColumn >= 1) nameEnd = Math.min(nameEnd, firstInColumn);
      }
      const read = texts.slice(0, nameEnd).join(" ").trim();
      if (read.length < 3) continue;

      // A map name at the end of the name column is a wrapped location that
      // leaked in - unless the row already found its own location, in which
      // case it is part of the name ("Eliminate Scavs on Lighthouse")
      const resolved = resolveTaskName(
        index,
        catalog,
        read,
        location ? new Set<string>() : mapWords
      );
      if (!resolved) continue;
      const key = resolved.taskId ? `id:${resolved.taskId}` : normalizeName(resolved.name);
      const previous = this.tasks.get(key);
      const seen =
        previous && now - previous.at >= CONFIRMATION_GAP_MS
          ? (previous.seen ?? 1) + 1
          : previous?.seen ?? 1;
      // A screen without a progress bar must not forget a percent we have
      const nextPercent = percent ?? previous?.percent;
      if (!previous) {
        // Reading a quest we already knew about is not a discovery - the
        // game's log has been telling us about it all along. Only a task no
        // catalog knows (a rotating Operational one) is actually new.
        if (!resolved.taskId) {
          newTasks++;
          updates++;
          changes.push(`New task: ${resolved.name}`);
        }
      } else if (previous.percent !== nextPercent) {
        updates++;
        changes.push(
          `${resolved.name} ${previous.percent ?? "?"}% → ${nextPercent ?? "?"}%`
        );
      } else if (statusKind(previous.status) !== statusKind(status)) {
        updates++;
        changes.push(`${resolved.name} is now ${status.toLowerCase()}`);
      }
      this.tasks.set(key, {
        key,
        name: resolved.name,
        taskId: resolved.taskId,
        percent: nextPercent,
        status,
        location,
        at: now,
        seen,
      });
      taskRows++;
    }

    const ticked = this.applyObjectiveRows(objectiveRows, catalog, activeTaskIds, now, changes);
    updates += ticked;

    if (taskRows > 0 || objectiveCount > 0 || ticked > 0) {
      this.lastScanAt = now;
      // Everything read during this scan session, not just the last pass
      this.lastScanCount = [...this.tasks.values()].filter((t) => now - t.at < 90 * 1000).length;
      this.save();
    }
    log.info(
      `Tasks screen scan: ${taskRows} task rows, ${objectiveCount} counters, ${ticked} objective states`
    );
    return { tasks: taskRows, objectives: objectiveCount + ticked, updates, newTasks, changes };
  }

  // The objective rows on screen all belong to the one task that is open,
  // so find the active task whose objectives they match best and record
  // each matched row's done / not-done state for it
  private applyObjectiveRows(
    rows: { text: string; done: boolean; count?: number; total?: number }[],
    catalog: CatalogTask[],
    activeTaskIds: Iterable<string>,
    now: number,
    changes: string[]
  ): number {
    if (rows.length === 0) return 0;
    const active = new Set(activeTaskIds);
    for (const t of this.tasks.values()) {
      if (t.taskId && /^activ/i.test(t.status)) active.add(t.taskId);
    }
    const keys = rows.map((r) => normalizeName(r.text));

    let best: { task: CatalogTask; matches: Map<number, CatalogObjective> } | null = null;
    for (const task of catalog) {
      if (!active.has(task.id) || task.objectives.length === 0) continue;
      const matches = new Map<number, CatalogObjective>();
      for (const objective of task.objectives) {
        const wanted = normalizeName(objective.text);
        const allowed = Math.max(2, Math.floor(wanted.length * 0.15));
        const i = keys.findIndex(
          (k, idx) =>
            !matches.has(idx) &&
            Math.abs(k.length - wanted.length) <= allowed &&
            (k === wanted || levenshtein(k, wanted) <= allowed)
        );
        if (i >= 0) matches.set(i, objective);
      }
      if (matches.size === 0) continue;
      if (
        !best ||
        matches.size > best.matches.size ||
        (matches.size === best.matches.size &&
          task.objectives.length === rows.length &&
          best.task.objectives.length !== rows.length)
      ) {
        best = { task, matches };
      }
    }
    // One matched row could be a coincidence between tasks that share an
    // objective text; two or more pin the task down
    if (!best || (best.matches.size < 2 && best.task.objectives.length > 1)) return 0;

    let changed = 0;
    // Rows written this pass, whether or not they were worth reporting
    let stored = 0;
    for (const [i, objective] of best.matches) {
      const key = `${best.task.id}|${normalizeName(objective.text)}`;
      const row = rows[i];
      const previous = this.objectiveStates.get(key);
      // A tick the OCR misses on one pass does not undo one it saw before,
      // and a counter only climbs - otherwise every wobble is an "update"
      const done = row.done || previous?.done === true;
      // Only this read counts towards corroboration - a sticky `done`
      // carried over from an earlier pass is not a fresh sighting
      const doneSeen = (previous?.doneSeen ?? 0) + (row.done ? 1 : 0);
      const count =
        row.count !== undefined && previous?.count !== undefined && row.total === previous.total
          ? Math.max(row.count, previous.count)
          : row.count ?? previous?.count;
      const total = row.total ?? previous?.total;
      if (
        previous &&
        previous.done === done &&
        previous.doneSeen === doneSeen &&
        previous.count === count &&
        previous.total === total
      ) {
        continue;
      }
      this.objectiveStates.set(key, {
        key,
        taskId: best.task.id,
        objectiveId: objective.id,
        text: objective.text,
        done,
        doneSeen,
        count,
        total,
        at: now,
      });
      stored++;

      // News is a tick appearing or a counter moving. Seeing a row for the
      // first time, still unfinished, is worth storing but is not an update.
      const short = objective.text.length > 44 ? `${objective.text.slice(0, 44)}...` : objective.text;
      if (done && !previous?.done) {
        changes.push(`${best.task.name}: ${short} ✓`);
      } else if (total !== undefined && count !== undefined && count !== previous?.count) {
        changes.push(`${best.task.name}: ${short} ${count}/${total}`);
      } else {
        continue;
      }
      changed++;
    }
    if (changed) {
      log.info(
        `Tasks screen: ${best.task.name} - ` +
          [...best.matches.entries()]
            .map(
              ([i, o]) =>
                `${rows[i].done ? "[x]" : "[ ]"} ${o.text.slice(0, 40)}` +
                (rows[i].total ? ` ${rows[i].count}/${rows[i].total}` : "")
            )
            .join(", ")
      );
    }
    if (stored > 0) this.save();
    return changed;
  }

  // Re-check everything stored against the catalog: rows read with icon
  // junk before the matcher tolerated it get their real task, partial reads
  // are dropped, and duplicates of one task collapse onto its id key
  prune(catalog: CatalogTask[], mapNames: string[] = []): void {
    if (this.tasks.size === 0 || catalog.length === 0) return;
    const index = buildNameIndex(catalog);
    const mapWords = mapVocabulary(mapNames);
    const locations = new Map<string, string>();
    for (const m of ["Any location", ...mapNames]) locations.set(wordSetKey(m), m);
    let changed = false;
    for (const [key, task] of [...this.tasks.entries()]) {
      const resolved = resolveTaskName(
        index,
        catalog,
        task.name,
        task.location ? new Set<string>() : mapWords
      );
      const wanted = resolved
        ? resolved.taskId
          ? `id:${resolved.taskId}`
          : normalizeName(resolved.name)
        : null;
      const location = locations.get(wordSetKey(task.location)) ?? task.location;
      if (resolved && wanted === key && resolved.name === task.name && location === task.location) {
        continue;
      }
      changed = true;
      this.tasks.delete(key);
      if (!resolved || !wanted) continue;
      const existing = this.tasks.get(wanted);
      if (existing && existing.at >= task.at) continue;
      this.tasks.set(wanted, {
        ...task,
        key: wanted,
        name: resolved.name,
        taskId: resolved.taskId,
        location,
        seen: Math.max(task.seen ?? 1, existing?.seen ?? 1),
      });
    }
    if (changed) this.save();
  }

  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      // Everything read before v2 could have come from the app's own quest
      // panel being on screen during a full-screen scan (it was not masked),
      // so those percents and ticks are not evidence about the game
      if ((data.version ?? 1) < SCAN_STORE_VERSION) {
        log.info("Discarding Tasks-screen data from before overlay masking");
        this.lastScanAt = 0;
        this.lastScanCount = 0;
        return;
      }
      for (const t of data.tasks ?? []) this.tasks.set(t.key, t);
      for (const o of data.objectives ?? []) {
        // Drop rows saved before merged-row detection (a status word or
        // percent inside the objective text means two rows were read as one)
        if (/(^|\s)(activ|comple|lock|fail|avail)\w*(\s|$)|\d{1,3}\s*%/i.test(o.text)) continue;
        this.objectives.set(o.key, o);
      }
      for (const o of data.objectiveStates ?? []) {
        this.objectiveStates.set(o.key, { ...o, doneSeen: o.doneSeen ?? (o.done ? 1 : 0) });
      }
      for (const [k, v] of Object.entries(data.toasts ?? {})) this.toasts.set(k, v as ToastState);
      this.lastScanAt = data.lastScanAt ?? 0;
      this.lastScanCount = data.lastScanCount ?? 0;
    } catch (error) {
      log.warn("Failed to load task scan data:", error);
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.writeFileSync(
        this.file,
        JSON.stringify({
          version: SCAN_STORE_VERSION,
          tasks: [...this.tasks.values()],
          objectives: [...this.objectives.values()],
          objectiveStates: [...this.objectiveStates.values()],
          toasts: Object.fromEntries(this.toasts),
          lastScanAt: this.lastScanAt,
          lastScanCount: this.lastScanCount,
        })
      );
    } catch (error) {
      log.warn("Failed to save task scan data:", error);
    }
  }
}

// ---- helpers ---------------------------------------------------------------

function parseTsv(tsv: string): Word[] {
  const words: Word[] = [];
  for (const line of tsv.split(/\r?\n/)) {
    const cols = line.split("\t");
    if (cols.length < 12 || cols[0] !== "5") continue; // level 5 = word
    const text = cols[11].trim();
    const conf = Number(cols[10]);
    if (!text || conf < 30) continue;
    words.push({
      left: Number(cols[6]),
      top: Number(cols[7]),
      width: Number(cols[8]),
      height: Number(cols[9]),
      text,
      ticks: Number(cols[12] ?? 0) || 0,
      doneBand: Number(cols[13] ?? 0) || 0,
    });
  }
  return words;
}

// Group words into visual rows by vertical overlap, left to right
function groupRows(words: Word[]): Word[][] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: Word[][] = [];
  for (const w of sorted) {
    const centre = w.top + w.height / 2;
    const row = rows.find((r) => {
      const first = r[0];
      const rowCentre = first.top + first.height / 2;
      return Math.abs(rowCentre - centre) <= Math.max(first.height, w.height) * 0.6;
    });
    if (row) row.push(w);
    else rows.push([w]);
  }
  for (const r of rows) r.sort((a, b) => a.left - b.left);
  return rows;
}

// Drop stray icon / tick tokens from both ends of a row (never below three
// tokens, so a short real name survives)
function stripStrayTokens<T>(tokens: T[], text: (t: T) => string = (t) => String(t)): T[] {
  const out = [...tokens];
  while (out.length > 3 && STRAY_TOKEN.test(text(out[0]))) out.shift();
  while (out.length > 3 && STRAY_TOKEN.test(text(out[out.length - 1]))) out.pop();
  return out;
}

// "<name> [location] <status> [countdown / stray icon]" as the trader's task
// list shows it - short, and ending in one of the exact status words.
// Operational rows end with a countdown and a trader's task header with a
// loyalty icon read as a stray letter, so both are trimmed first. Returns
// the index just past the status word, or null if this is not such a row.
function traderRowTail(texts: string[]): number | null {
  let tail = texts.length;
  while (
    tail > 2 &&
    (/^\d{1,2}:\d{2}(:\d{2})?$/.test(texts[tail - 1]) || STRAY_TOKEN.test(texts[tail - 1]))
  ) {
    tail--;
  }
  const isTraderRow =
    tail >= 2 && tail <= TRADER_ROW_MAX_TOKENS && TRADER_STATUS_PATTERN.test(texts[tail - 1]);
  return isTraderRow ? tail : null;
}

// "activel", "active!", "Active" are all the same status
function statusKind(status: string): string {
  const m = /^(activ|comple|lock|fail|avail|done)/i.exec(status);
  return m ? m[1].toLowerCase() : status.toLowerCase();
}

function stripTrailingCount(text: string): string {
  return text.replace(/\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/, "").trim();
}

// Normalized words in sorted order, so word order does not matter
function wordSetKey(text: string): string {
  return normalizeName(text).split(" ").filter(Boolean).sort().join(" ");
}

// A map name / "Any location", tolerating a couple of OCR slips ("Any
// locati", "Shoreine")
function lookupLocation(locations: Map<string, string>, text: string, fuzzy = true): string | undefined {
  const key = wordSetKey(text);
  if (!key) return undefined;
  const exact = locations.get(key);
  if (exact || !fuzzy) return exact;
  for (const [candidate, name] of locations) {
    if (Math.abs(candidate.length - key.length) <= 2 && levenshtein(candidate, key) <= 2) return name;
  }
  return undefined;
}

// Every word that appears in a map name ("streets", "of", "tarkov", ...)
function mapVocabulary(mapNames: string[]): Set<string> {
  const words = new Set<string>();
  for (const m of ["Any location", ...mapNames]) {
    for (const w of normalizeName(m).split(" ")) if (w) words.add(w);
  }
  return words;
}

// A location the game wrapped onto two lines can leak into the name column
// with a word missing ("Secret Message Streets of"); drop up to three
// trailing map-name words
function stripTrailingMapWords(tokens: string[], mapWords: Set<string>): string[] {
  const out = [...tokens];
  let dropped = 0;
  while (out.length > 1 && dropped < 3 && mapWords.has(normalizeName(out[out.length - 1]))) {
    out.pop();
    dropped++;
  }
  return out;
}

const indexCache = new WeakMap<CatalogTask[], MiniSearch>();

function buildNameIndex(catalog: CatalogTask[]): MiniSearch {
  const cached = indexCache.get(catalog);
  if (cached) return cached;
  const index = new MiniSearch({
    fields: ["name"],
    storeFields: ["name"],
    searchOptions: { fuzzy: 0.25, prefix: true },
  });
  index.addAll(catalog.map((t) => ({ id: t.id, name: t.name })));
  indexCache.set(catalog, index);
  return index;
}

// A catalog task whose name is the text as read, give or take a couple of
// OCR slips. Strict on purpose: an unknown task like "Balancing - Part 1"
// must never be mistaken for another "... - Part 1" quest
function matchExact(index: MiniSearch, catalog: CatalogTask[], read: string): string | null {
  const wanted = normalizeName(read);
  if (wanted.length < 3) return null;
  const exact = catalog.find((t) => normalizeName(t.name) === wanted);
  if (exact) return exact.id;
  const hits = index.search(wanted);
  for (const hit of hits.slice(0, 3)) {
    const name = normalizeName(String(hit.name));
    const allowed = Math.max(2, Math.floor(wanted.length * 0.15));
    if (levenshtein(wanted, name) <= allowed) return String(hit.id);
  }
  return null;
}

// Longest catalog name that appears whole inside the text as read (or that
// the text is a whole part of), which is how a garbled prefix ("Ne a ie | - |
// The Tarkov Shooter") or a location that leaked in ("Rough Tarkov Any
// location") still resolves to its real quest
function matchContained(catalog: CatalogTask[], read: string): string | null {
  const wanted = ` ${normalizeName(read)} `;
  if (wanted.length < 10) return null;
  const wordCount = wanted.trim().split(" ").length;
  let best: { id: string; length: number } | null = null;
  for (const task of catalog) {
    const name = normalizeName(task.name);
    if (name.length < 5) continue;
    // The name column comes first on the Tasks screen, so a catalog name
    // at the very start followed by a few words of debris (a misread
    // location) is that task; buried deeper it needs to be long enough not
    // to match inside unrelated text ("Debut", "Setup")
    const atStart = wanted.startsWith(` ${name} `) && wordCount - name.split(" ").length <= 3;
    if (!atStart && (name.length < 9 || !wanted.includes(` ${name} `))) continue;
    if (!best || name.length > best.length) best = { id: task.id, length: name.length };
  }
  return best?.id ?? null;
}

// The Tasks screen prefixes every name with the trader / task-type icons,
// which OCR reads as stray letters ("BE Ice Cream Cones", "KA ® Secret
// Message", "le B Bad Habit"). Match the text as read first, then with up to
// three leading and one trailing word dropped, as long as what is left is
// most of the text (so a genuinely unknown name cannot shrink into a
// catalog one)
function matchTask(
  index: MiniSearch,
  catalog: CatalogTask[],
  read: string,
  mapWords: Set<string> = new Set()
): string | null {
  const tokens = read.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const core = stripTrailingMapWords(tokens, mapWords);
  // As read first (quest names can end in map words: "Revision - Streets
  // of Tarkov"), then without a leaked location
  for (const words of core.length === tokens.length ? [tokens] : [tokens, core]) {
    const fullLength = normalizeName(words.join(" ")).length;
    for (let lead = 0; lead <= Math.min(3, words.length - 1); lead++) {
      for (let trail = 0; trail <= 1; trail++) {
        if (lead + trail >= words.length) continue;
        const candidate = words.slice(lead, words.length - trail).join(" ");
        if (lead + trail > 0 && normalizeName(candidate).length < fullLength * 0.6) continue;
        const id = matchExact(index, catalog, candidate);
        if (id) return id;
      }
    }
  }
  return matchContained(catalog, read);
}

// A leading word that is icon junk rather than part of a name: has digits or
// symbols in it, is a short run of capitals ("BE", "KA", "F"), or starts in
// lower case (names are title-cased)
const JUNK_WORD = /[^A-Za-z'\u2019-]|^[A-Z]{1,3}$|^[a-z]/;

// Characters that appear in real quest names; anything else (pipes, "=",
// stray symbols) means the row was misread rather than unknown
const NAME_CHARS = /^[A-Za-z0-9 '\u2019\u2013\u2014:,.!?()&/+-]+$/;
// Short tokens that do occur in real names; any other 1-2 character token is
// OCR debris ("Ne a ie | - | The Tarkov fe")
const SHORT_WORDS = new Set([
  "a", "an", "of", "to", "in", "on", "at", "is", "it", "no", "up", "so", "my",
  "we", "us", "i", "the", "and", "for", "by", "or", "vs", "pt",
]);

// Names no catalog knows (the rotating Operational tasks) are only kept
// when they still look like a name once the icon junk is stripped: two or
// more real words, nearly all letters, and not a fragment of a catalog
// name, which would be a partial read of a known quest rather than a new one
function cleanUnknownName(
  read: string,
  catalog: CatalogTask[],
  mapWords: Set<string> = new Set()
): string | null {
  const tokens = stripTrailingMapWords(read.trim().split(/\s+/).filter(Boolean), mapWords);
  while (tokens.length && tokens[0] !== "A" && JUNK_WORD.test(tokens[0])) tokens.shift();
  while (tokens.length && /[^A-Za-z0-9'\u2019.!?-]/.test(tokens[tokens.length - 1])) tokens.pop();
  const name = tokens.join(" ");
  const letters = (name.match(/[A-Za-z]/g) ?? []).length;
  const properWords = tokens.filter((t) => /^[A-Za-z'\u2019-]{2,}$/.test(t)).length;
  if (tokens.length < 2 || properWords < 2 || letters < 8) return null;
  if (letters / Math.max(1, name.replace(/\s/g, "").length) < 0.8) return null;
  if (!NAME_CHARS.test(name)) return null;
  const debris = tokens.filter(
    (t) => t.length <= 2 && !SHORT_WORDS.has(t.toLowerCase())
  ).length;
  if (debris >= 2) return null;
  const vocabulary = catalogVocabulary(catalog);
  const longWords = normalizeName(name).split(" ").filter((w) => w.length >= 3);
  const known = longWords.filter((w) => vocabulary.has(w)).length;
  // Nearly every word of a real name is game English; one misread word in
  // three ("Dandies DUreets Tarkov") is a misread row, not a new task
  if (longWords.length > 0 && (known < 2 || known / longWords.length < 0.75)) return null;
  const wanted = ` ${normalizeName(name)} `;
  const fragment = catalog.some((t) => {
    const full = ` ${normalizeName(t.name)} `;
    return full !== wanted && full.includes(wanted);
  });
  return fragment ? null : name;
}

// Every word (3+ letters) the catalog uses in task names and objectives:
// the game's English. Unknown names made mostly of words outside it are
// OCR debris, not a task nobody has catalogued.
const vocabularyCache = new WeakMap<CatalogTask[], Set<string>>();
function catalogVocabulary(catalog: CatalogTask[]): Set<string> {
  const cached = vocabularyCache.get(catalog);
  if (cached) return cached;
  const words = new Set<string>();
  for (const task of catalog) {
    for (const text of [task.name, ...task.objectives.map((o) => o.text)]) {
      for (const w of normalizeName(text).split(" ")) if (w.length >= 3) words.add(w);
    }
  }
  vocabularyCache.set(catalog, words);
  return words;
}

// Catalog task + display name for a task row as read off the screen, or the
// cleaned-up unknown name, or null when the row is not worth keeping
function resolveTaskName(
  index: MiniSearch,
  catalog: CatalogTask[],
  read: string,
  mapWords: Set<string> = new Set()
): { taskId: string | null; name: string } | null {
  const taskId = matchTask(index, catalog, read, mapWords);
  if (taskId) {
    const name = catalog.find((t) => t.id === taskId)?.name ?? read;
    return { taskId, name };
  }
  const name = cleanUnknownName(read, catalog, mapWords);
  return name ? { taskId: null, name } : null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}
