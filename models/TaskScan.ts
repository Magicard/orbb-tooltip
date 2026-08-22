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

// A step of a task no catalog knows, read straight off its detail pane
export type ScannedTaskObjective = {
  text: string;
  count?: number;
  total?: number;
  done: boolean;
};

// Where a row sat on the screen, so the lines under a task can be tied to it
type Placed = { top: number; left: number; right: number };

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
  // Operational tasks expire; this is when, in wall-clock ms
  expiresAt?: number;
  // Their steps, which only the screen can tell us
  objectives?: ScannedTaskObjective[];
  // Which trader gave it, worked out from the rows around it
  traderId?: string;
  // The row had every column the screen has, so its name was taken as read
  // rather than put through the "does this look like a name" rules (see
  // cleanUnknownName); remembered so prune judges it the same way
  wellFormed?: boolean;
};

// Passes an unknown name must be read in before it is shown
const UNKNOWN_CONFIRMATIONS = 2;
// How long a row thrown away by hand stays thrown away - about one rotation
const DISMISSAL_MS = 24 * 3600 * 1000;
// A session has to have read something this many times before one sighting of
// anything else counts as suspiciously few
const SESSION_READS_TO_JUDGE = 4;
// Two passes closer together than this are treated as the same reading
const CONFIRMATION_GAP_MS = 900;
// One bar for believing a row the catalog cannot explain, used to show it, to
// announce it and to count it as new.
//
// A row the game itself laid out as a task row - a location column, a status
// and a progress bar, or the countdown only Operational tasks carry, or a card
// under the trader's OPERATIONAL TASKS heading - is believed the first time it
// is read. The two-read rule is for rows we are not sure are rows at all: OCR
// debris out of a description or a half-drawn screen, which almost never comes
// back the same way twice. It cannot be asked of a well-formed row, because a
// scan session only re-reads the screen when it changes, so a task sitting
// still on the Tasks screen is read exactly once and would never qualify.
function isBelieved(task: {
  seen?: number;
  wellFormed?: boolean;
}): boolean {
  return task.wellFormed === true || (task.seen ?? 1) >= UNKNOWN_CONFIRMATIONS;
}

// Bumped when stored readings stop being trustworthy (see load). v2 masked
// the app's own overlay out of the scan; v3 is when that masking actually
// reached the helper (the exclusion rects were being dropped on the way).
// v4 drops the steps v3 gave a rotating task, which were whatever lines sat
// under it rather than the task's own; v5 drops the rotating tasks themselves,
// which before it could be minted from a misread on any screen.
const SCAN_STORE_VERSION = 5;

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

const STATUS_PATTERN = /^(activ\w*|comple\w*|finish\w*|lock\w*|fail\w*|avail\w*|done)$/i;
// The exact status words the trader's task list ends a row with ("active!"
// reads as "activel", "Finished!" as "Finishedl"); a looser match would turn
// objective sentences that happen to end in "complex" or "lockers" into
// phantom tasks
const TRADER_STATUS_PATTERN = /^(activ\w{0,2}|finish\w{0,3}|completed|locked|failed|available)$/i;
// A trader-list row is a short name plus its status
const TRADER_ROW_MAX_TOKENS = 10;
// How much debris can follow the status word: a misread progress bar, a row
// icon, a countdown the clock parser could not make sense of
const TRADER_ROW_DEBRIS = 3;
// What the game shows in the location column of a task with no map
const ANY_LOCATION = "Any location";
const PERCENT_PATTERN = /^(\d{1,3})\s*%$/;
const COUNT_PATTERN = /^(\d{1,4})\s*\/\s*(\d{1,4})$/;
// The clock half of an Operational task's countdown: "23:42:12", "02:05", or
// the same thing with the colons lost in the read ("004857")
const CLOCK_PATTERN = /^(?:(\d{1,2}):(\d{2})(?::(\d{2}))?|(\d{2})(\d{2})(\d{2}))$/;
// The "1 day(s)" in front of it, and the pieces OCR breaks that into
const DAY_WORD = /^days?\(?s?\)?\.?$|^\(?s\)?$/i;
// How far in front of the clock that prefix can start
const DAY_PREFIX_WORDS = 3;
// Longer than the game ever counts down for, so anything above it is a misread
const MAX_COUNTDOWN_MS = 8 * 24 * 3600 * 1000;

function clockMs(text: string): number | null {
  const m = CLOCK_PATTERN.exec(text.trim());
  if (!m) return null;
  const [, a, b, c, hh, mm, ss] = m;
  // Two colon-separated fields are minutes:seconds, three are hours:minutes:
  // seconds, and a run of six digits is always all three
  const hours = Number(hh ?? (c ? a : "0"));
  const minutes = Number(mm ?? (c ? b : a));
  const seconds = Number(ss ?? c ?? b);
  // Out-of-range fields mean this is some other number that happens to be six
  // digits long, not a clock
  if (minutes > 59 || seconds > 59 || hours > 23) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

// Objective text is a sentence; a change line only has room for the start
function shorten(text: string, max = 44): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

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
  // Rows the player threw away by hand, and when that stops applying
  private dismissed = new Map<string, number>();
  // How many passes of the running scan session read each task, and which
  // tasks already existed when it started (see endSession)
  private sessionReads = new Map<string, number>();
  private sessionKnown: Set<string> | null = null;
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
  // Operational ones - excluding readings we do not trust yet
  getUnknownTasks(): ScannedTask[] {
    return [...this.tasks.values()].filter((t) => !t.taskId && isBelieved(t));
  }

  // Throw a reading away because the player says it is not a task. It has to
  // be remembered as thrown away, or the next pass over the same screen reads
  // it straight back in - but only for a day, because a rotating task can
  // genuinely come back under the name of one that was garbage yesterday.
  forget(key: string): boolean {
    const task = this.tasks.get(key);
    if (!task) return false;
    this.tasks.delete(key);
    this.dismissed.set(key, Date.now() + DISMISSAL_MS);
    log.info(`Tasks screen scan: "${task.name}" thrown away by hand`);
    this.save();
    return true;
  }

  // A scan session is about to start reading the screen over and over
  beginSession(): void {
    this.sessionReads.clear();
    this.sessionKnown = new Set(this.tasks.keys());
  }

  // The session is over, so every reading it was going to make, it has made.
  // A rotating task the whole session saw exactly once, while reading plenty
  // else over and over, is a misread of something that was there all along -
  // the real rows come back pass after pass. Tasks that predate the session
  // are left alone: this only judges what the session itself brought in.
  endSession(): void {
    const known = this.sessionKnown;
    this.sessionKnown = null;
    if (!known) return;
    const busiest = Math.max(0, ...this.sessionReads.values());
    if (busiest < SESSION_READS_TO_JUDGE) return;
    let dropped = false;
    for (const [key, reads] of this.sessionReads) {
      const task = this.tasks.get(key);
      if (!task || task.taskId || reads > 1 || known.has(key)) continue;
      log.info(`Tasks screen scan: "${task.name}" was read once in ${busiest} passes - dropping it`);
      this.tasks.delete(key);
      dropped = true;
    }
    this.sessionReads.clear();
    if (dropped) this.save();
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

  // The game itself says this task is finished and waiting to be handed in
  // (the trader's list shows "Finished!" and lights up its COMPLETE button)
  readyFor(taskId: string): boolean {
    return /^finish/i.test(this.tasks.get(`id:${taskId}`)?.status ?? "");
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
    const { rows: shaped, table } = shapeRows(words);
    const rows = shaped.map((row) => row.words);
    // The open task's own steps are the rows between these two headings; the
    // trader's chatter above them and the task list in the other pane are not
    const objectivesHeading = words.find((w) => /^objective/i.test(w.text));
    const rewardsHeading = objectivesHeading
      ? words.find(
          (w) =>
            /^rewards?$/i.test(w.text) &&
            w.top > objectivesHeading.top &&
            Math.abs(w.left - objectivesHeading.left) < 40
        )
      : undefined;
    // A trader's list ends with an OPERATIONAL TASKS section. The cards under
    // it are the rotating ones, whose names are short and generic enough
    // ("Elimination") that nothing else about the row would give them away.
    const operationalHeading = words.find((w) => /^operationa?l?$/i.test(w.text));
    const objectivePane = objectivesHeading
      ? {
          top: objectivesHeading.top,
          bottom: rewardsHeading ? rewardsHeading.top : Infinity,
          left: objectivesHeading.left - 20,
        }
      : null;
    const now = Date.now();
    const index = buildNameIndex(catalog);
    // Objective rows of the task open on the screen: text, whether the
    // game's completion tick follows it, the counter if it has one, and
    // where the row sat, so it can be tied to the task it belongs to
    const objectiveRows: (Placed & ScannedTaskObjective)[] = [];
    // Where each task row stored in this pass sat
    const taskRowsAt: (Placed & { key: string })[] = [];
    // Every row this pass read as a task, held back until the end: whether a
    // row may bring a rotating task into being depends on what else was on
    // the screen with it
    const readings: {
      resolved: { taskId: string | null; name: string };
      place: Placed;
      location: string;
      status: string;
      percent?: number;
      wellFormed: boolean;
      underOperational: boolean;
      inTable: boolean;
      countdown: Countdown | null;
    }[] = [];
    const placeOf = (row: Word[]): Placed => {
      const { top, left, right } = rowBounds(row);
      return { top, left, right };
    };
    // Keyed by the sorted word set so a map name the game wrapped onto two
    // lines ("Streets of" / "Tarkov", read back as "Streets Tarkov of") is
    // still recognised; the value is the name to display
    const locations = new Map<string, string>();
    for (const m of [ANY_LOCATION, ...mapNames]) locations.set(wordSetKey(m), m);
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

    for (const { words: row, countdown } of shaped) {
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
            objectiveRows.push({ ...placeOf(row), text, done: count >= total, count, total });
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
          objectiveRows.push({ ...placeOf(row), text, done: ticked || banded });
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
      const place = placeOf(row);
      const inTable =
        table !== null &&
        place.top > table.top &&
        place.left >= table.left &&
        place.right <= table.right;
      const underOperational =
        operationalHeading !== undefined &&
        place.top > operationalHeading.top &&
        Math.abs(place.left - operationalHeading.left) < SECTION_COLUMN_PX;
      const read = stripLeadingChrome(texts.slice(0, nameEnd)).join(" ").trim();
      if (read.length < 3) continue;

      // A map name at the end of the name column is a wrapped location that
      // leaked in - unless the row already found its own location, in which
      // case it is part of the name ("Eliminate Scavs on Lighthouse")
      // A row with a location and either a progress bar (the character's
      // Tasks screen) or an exact status word (a trader's page, which has no
      // progress column) is a task row by its shape alone, and so is one
      // carrying a countdown, which only Operational tasks have
      const wellFormed =
        countdown !== null ||
        underOperational ||
        (location !== "" && (percent !== undefined || traderTail !== null));
      const resolved = resolveTaskName(
        index,
        catalog,
        read,
        // A location that was read cleanly is already off the name
        location ? new Set<string>() : mapWords,
        wellFormed
      );
      if (!resolved) continue;
      // A location is a column of the table, never the name of a task
      if (!resolved.taskId && locations.has(wordSetKey(resolved.name))) continue;
      readings.push({
        resolved,
        place,
        location,
        status,
        percent,
        wellFormed,
        underOperational,
        inTable,
        countdown,
      });
    }

    // The game's STORY and SIDE tabs list nothing but tasks the catalog knows,
    // so a row there that matched nothing is a misread - of a neighbouring row,
    // or of a line out of the open task's description - and must not become a
    // rotating task. Three things say otherwise: the row sits under a trader's
    // OPERATIONAL TASKS heading, it carries the countdown only rotating tasks
    // have, or nothing on the whole screen matched the catalog, which is what
    // the OPERATIONAL tab looks like.
    const catalogRows = readings.filter((r) => r.resolved.taskId).length;
    // Most of the screen being rows the catalog cannot explain, rather than
    // none of it, so that one rotating task whose name happens to look like a
    // real one does not shut the whole tab out. It only speaks for the
    // character's OPERATIONAL tab, which is a table with labelled columns - a
    // trader's page is two panes of prose and has its own heading to go by.
    const rotatingScreen = catalogRows < readings.length - catalogRows;
    const operational = (reading: (typeof readings)[number]) =>
      reading.underOperational ||
      reading.countdown !== null ||
      // A row of that table either falls inside the labelled columns or at
      // least filled in a location, which a card in a trader's list - the
      // other place an unmatched row can come from - never does
      (rotatingScreen && (reading.inTable || reading.location !== ""));
    // Rows that may bring one into being go first, so that a second reading of
    // the same task - a trader's detail header, which knows its map, while the
    // card in the list does not - recognises it and fills in what it knows
    const ordered = [
      ...readings.filter((r) => r.resolved.taskId || operational(r)),
      ...readings.filter((r) => !r.resolved.taskId && !operational(r)),
    ];

    for (const reading of ordered) {
      const { resolved, place, location, status, percent, wellFormed, countdown } = reading;
      // Not a screen that mints rotating tasks - but a row can still update
      // one we already have
      if (!resolved.taskId && !operational(reading) && !this.knowsUnknown(resolved.name)) {
        continue;
      }
      if (!resolved.taskId && this.isDismissed(unknownKey(resolved.name, location))) continue;
      const key = resolved.taskId
        ? `id:${resolved.taskId}`
        : this.keyForUnknown(resolved.name, location);
      const previous = this.tasks.get(key);
      const seen =
        previous && now - previous.at >= CONFIRMATION_GAP_MS
          ? (previous.seen ?? 1) + 1
          : previous?.seen ?? 1;
      // A screen without a progress bar must not forget a percent we have
      const nextPercent = percent ?? previous?.percent;
      // Reading a quest we already knew about is not a discovery - the game's
      // log has been telling us about it all along. Only a task no catalog
      // knows (a rotating Operational one) is new, and only once a second
      // read confirms it, which is the same bar the panel uses to show it.
      const believable = { seen, wellFormed: wellFormed || previous?.wellFormed };
      const newlyBelievable =
        !resolved.taskId && isBelieved(believable) && !(previous && isBelieved(previous));
      if (newlyBelievable) {
        newTasks++;
        updates++;
        changes.push(`New task: ${resolved.name}`);
      } else if (!previous) {
        // Stored, but nothing to report yet
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
        // A trader's list has no location column, so a reading from there
        // must not blank the map another screen already told us
        location: location || previous?.location || "",
        at: now,
        seen,
        wellFormed: believable.wellFormed,
        traderId: previous?.traderId,
        objectives: previous?.objectives,
        // Only the rotating tasks expire
        expiresAt:
          countdown && !resolved.taskId ? now + countdown.ms : previous?.expiresAt,
      });
      taskRowsAt.push({ ...place, key });
      if (this.sessionKnown) this.sessionReads.set(key, (this.sessionReads.get(key) ?? 0) + 1);
      taskRows++;
    }

    const claimed = this.attributeToTasks(
      // A step of the open task sits between the Objective(s) and Rewards
      // headings and starts at the same margin. Everything else on those
      // lines is the trader's chatter or the task list in the other pane.
      objectivePane
        ? objectiveRows.filter(
            (o) =>
              o.top > objectivePane.top &&
              o.top < objectivePane.bottom &&
              o.left >= objectivePane.left
          )
        : [],
      taskRowsAt,
      catalog,
      changes
    );
    updates += claimed.updates;
    const ticked = this.applyObjectiveRows(
      // Steps a task the catalog does not know has already claimed
      objectiveRows.filter((row) => !claimed.rows.has(row)),
      catalog,
      activeTaskIds,
      now,
      changes
    );
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
  // Did the player throw this reading away recently?
  private isDismissed(key: string): boolean {
    const until = this.dismissed.get(key);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.dismissed.delete(key);
    return false;
  }

  // Is there already a rotating task by this name, wherever it is done?
  private knowsUnknown(name: string): boolean {
    const prefix = `${normalizeName(name)}@`;
    return [...this.tasks.keys()].some((key) => key.startsWith(prefix));
  }

  // A task no catalog knows is identified by its name and where it is done,
  // but not every screen has a location column: a trader's list shows the
  // name alone. Rather than store that as a second task, reuse the entry we
  // already have, and let a reading that does know the location fill it in.
  private keyForUnknown(name: string, location: string): string {
    const wanted = unknownKey(name, location);
    if (this.tasks.has(wanted)) return wanted;
    const prefix = `${normalizeName(name)}@`;
    const sameName = [...this.tasks.keys()].filter((k) => k.startsWith(prefix));
    if (location === "") {
      // No location to go on: only safe when there is one candidate
      return sameName.length === 1 ? sameName[0] : wanted;
    }
    const bare = this.tasks.get(prefix);
    if (bare) {
      this.tasks.delete(prefix);
      this.tasks.set(wanted, { ...bare, key: wanted, location });
    }
    return wanted;
  }

  // Everything the catalog cannot tell us about a task has to be read off
  // the screen and tied to the row it sits under: which trader gave it, how
  // long it has left, and what its steps are.
  private attributeToTasks(
    objectiveRows: (Placed & ScannedTaskObjective)[],
    taskRowsAt: (Placed & { key: string })[],
    catalog: CatalogTask[],
    changes: string[]
  ): { updates: number; rows: Set<Placed & ScannedTaskObjective> } {
    const rows = new Set<Placed & ScannedTaskObjective>();
    let updates = 0;
    if (taskRowsAt.length === 0) return { updates, rows };

    // A line belongs to the nearest task row above it that covers most of its
    // width. Height alone is not enough: a trader's page puts their task list
    // down the left and the open task's detail down the right, so rows of the
    // list sit between a task's own header and its own steps. Nor is a sliver
    // of overlap: a row from the other pane that picked up a stray word can
    // reach into this one, and only the pane that contains the whole line is
    // really the one it belongs to.
    const ownerOf = (line: Placed): ScannedTask | undefined => {
      let best: (typeof taskRowsAt)[number] | null = null;
      for (const row of taskRowsAt) {
        if (row.top > line.top) continue;
        const shared = Math.min(row.right, line.right) - Math.max(row.left, line.left);
        if (shared < (line.right - line.left) * PANE_COVERAGE) continue;
        if (!best || row.top > best.top) best = row;
      }
      return best ? this.tasks.get(best.key) : undefined;
    };

    // A task no catalog knows still belongs to a trader, and the screen only
    // says which by drawing their portrait - which OCR cannot read. Both of
    // the game's task lists are grouped by trader though (the character's
    // Tasks screen sorts by it, a trader's own page lists only their tasks),
    // so the identified rows around an Operational one name its trader.
    const traderOf = new Map(catalog.map((t) => [t.id, t.traderId]));
    const column = [...taskRowsAt].sort((a, b) => a.top - b.top);
    const known = column.map((row) => {
      const taskId = this.tasks.get(row.key)?.taskId;
      return (taskId && traderOf.get(taskId)) || null;
    });
    column.forEach((row, i) => {
      const task = this.tasks.get(row.key);
      if (!task || task.taskId) return;
      const above = known.slice(0, i).reverse().find(Boolean) ?? null;
      const below = known.slice(i + 1).find(Boolean) ?? null;
      // Between two traders it is anyone's guess, so say nothing
      const trader = above && below ? (above === below ? above : null) : above ?? below;
      if (trader) task.traderId = trader;
    });

    // Steps of a task no catalog knows can only come from its detail pane
    const byTask = new Map<ScannedTask, ScannedTaskObjective[]>();
    for (const line of objectiveRows) {
      const task = ownerOf(line);
      if (!task || task.taskId) continue;
      rows.add(line);
      const list = byTask.get(task) ?? [];
      list.push({ text: line.text, count: line.count, total: line.total, done: line.done });
      byTask.set(task, list);
    }
    for (const [task, list] of byTask) {
      const before = task.objectives;
      task.objectives = list;
      // Nothing to announce the first time we see them: the task itself was
      // the news. After that, only the steps that actually moved.
      if (!before) continue;
      for (const step of list) {
        const was = before.find((o) => o.text === step.text);
        if (was && was.done === step.done && was.count === step.count) continue;
        updates++;
        const counter = step.total !== undefined ? ` ${step.count ?? 0}/${step.total}` : "";
        changes.push(`${task.name}: ${shorten(step.text)}${counter}${step.done ? " ✓" : ""}`);
      }
    }
    return { updates, rows };
  }

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
    for (const m of [ANY_LOCATION, ...mapNames]) locations.set(wordSetKey(m), m);
    let changed = false;
    for (const [key, task] of [...this.tasks.entries()]) {
      const resolved = resolveTaskName(
        index,
        catalog,
        task.name,
        task.location ? new Set<string>() : mapWords,
        task.wellFormed ?? (task.location !== "" && task.percent !== undefined)
      );
      const wanted = resolved
        ? resolved.taskId
          ? `id:${resolved.taskId}`
          : unknownKey(resolved.name, task.location)
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
    if (this.reconcile()) changed = true;
    if (changed) this.save();
  }

  // Every reading of a rotating task we hold, judged against the others. A
  // scan sees the same list many times over, so a name that is only ever a
  // piece of a fuller one - "vansfer" beside "Find and transfer" - is that
  // task read badly, not a second task. Whatever the bad reading learned goes
  // to the good one before it is dropped.
  private reconcile(): boolean {
    const unknown = [...this.tasks.values()].filter((t) => !t.taskId);
    if (unknown.length < 2) return false;
    let changed = false;
    for (const reading of unknown) {
      const better = unknown.find(
        (other) => other !== reading && this.tasks.has(other.key) && isMisreadOf(reading.name, other.name)
      );
      if (!better) continue;
      log.info(`Tasks screen scan: "${reading.name}" is "${better.name}" read badly - dropping it`);
      better.objectives = better.objectives ?? reading.objectives;
      better.expiresAt = better.expiresAt ?? reading.expiresAt;
      better.percent = better.percent ?? reading.percent;
      better.traderId = better.traderId ?? reading.traderId;
      better.seen = Math.max(better.seen ?? 1, reading.seen ?? 1);
      this.tasks.delete(reading.key);
      changed = true;
    }
    return changed;
  }

  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      // Everything read before v2 could have come from the app's own quest
      // panel being on screen during a full-screen scan (it was not masked),
      // so those percents and ticks are not evidence about the game
      // v2 masked the app's own overlay out of the scan and v3 is when that
      // masking actually worked, so anything older could be the panel reading
      // itself rather than the game
      if ((data.version ?? 1) < 3) {
        log.info("Discarding Tasks-screen data from before overlay masking");
        this.lastScanAt = 0;
        this.lastScanCount = 0;
        return;
      }
      for (const t of data.tasks ?? []) {
        // Rotating tasks stored before v5 could have been minted from a
        // misread of any screen, and their steps from whatever sat under them.
        // Both are cheap to read again, so neither is worth carrying over.
        if (!t.taskId && (data.version ?? 1) < 5) continue;
        this.tasks.set(t.key, t);
      }
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
      for (const [k, until] of Object.entries(data.dismissed ?? {})) {
        if (typeof until === "number" && until > Date.now()) this.dismissed.set(k, until);
      }
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
          dismissed: Object.fromEntries(this.dismissed),
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
// A word that is one of a row's own columns rather than the start of another
// pane: the progress percentage, the Operational countdown, an icon
const COUNTDOWN_TOKEN = /^\d{1,2}:\d{2}(:\d{2})?$|^\d{6}$/;
// A gap this wide is the edge of a pane rather than the gutter between two
// columns of the same row
const PANE_GAP_PX = 100;
// Lines this close together are the stacked cells of one row, not two rows.
// The game's task rows are around 100px apart and their cells sit on baselines
// within 20px of each other.
const CARD_LINE_PX = 20;
// The words the character's Tasks screen labels its columns with
const TABLE_HEADINGS = ["task", "location", "status"];
// How far outside the labelled columns a row of that table may still reach
const TABLE_MARGIN_PX = 40;
// How much of a line a task row has to cover before it can own it
const PANE_COVERAGE = 0.5;
// How far a card can sit from a section heading and still be under it
const SECTION_COLUMN_PX = 80;

function rowBounds(row: Word[]): { top: number; left: number; right: number; centre: number } {
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let centre = 0;
  for (const w of row) {
    top = Math.min(top, w.top);
    left = Math.min(left, w.left);
    right = Math.max(right, w.left + w.width);
    centre += (w.top + w.height / 2) / row.length;
  }
  return { top, left, right, centre };
}

// OCR reads straight across the screen, but the game draws panes side by side:
// on a trader's page their task list runs down the left while the open task's
// detail runs down the right, and one line of pixels crosses both. A task row
// that swallowed a sentence from the other pane matches nothing, and the
// sentence is lost with it. Split after a status word when what follows starts
// a long way to the right and is not this row's own progress column.
function splitAcrossPanes(row: Word[]): Word[][] {
  for (let i = 0; i < row.length - 1; i++) {
    if (!TRADER_STATUS_PATTERN.test(row[i].text)) continue;
    if (row[i + 1].left - (row[i].left + row[i].width) < PANE_GAP_PX) continue;
    const rest = row.slice(i + 1);
    const ownColumns = rest.every(
      (w) => PERCENT_PATTERN.test(w.text) || COUNTDOWN_TOKEN.test(w.text) || STRAY_TOKEN.test(w.text)
    );
    if (ownColumns) continue;
    return [row.slice(0, i + 1), ...splitAcrossPanes(rest)];
  }
  return [row];
}

// A row of the game's task list with its countdown lifted out of it. The
// countdown is a cell of its own drawn under the status, and OCR hands it back
// on its own line, so it is taken off here and remembered for the row rather
// than left among the row's words where it would sit between the name and the
// location once the lines are put back together.
type Countdown = { ms: number; left: number; right: number; top: number; centre: number };
type ShapedRow = { words: Word[]; countdown: Countdown | null };

function takeCountdown(row: Word[]): ShapedRow {
  for (let i = 0; i < row.length; i++) {
    const clock = clockMs(row[i].text);
    if (clock === null) continue;
    // "1 day(s)" sits in front of the clock as its own words, and OCR splits
    // the brackets off often enough that the whole prefix has to be walked
    // back over rather than matched in one go - miss it and a task with a day
    // left on it reads as the minutes alone
    let start = i;
    let days = 0;
    let sawDayWord = false;
    for (let back = i - 1; back >= 0 && i - back <= DAY_PREFIX_WORDS; back--) {
      if (DAY_WORD.test(row[back].text)) {
        sawDayWord = true;
        start = back;
        continue;
      }
      if (sawDayWord && /^\d{1,2}$/.test(row[back].text)) {
        days = Number(row[back].text);
        start = back;
      }
      break;
    }
    const ms = days * 24 * 3600 * 1000 + clock;
    if (ms <= 0 || ms > MAX_COUNTDOWN_MS) continue;
    const taken = row.slice(start, i + 1);
    const where = rowBounds(taken);
    return {
      words: [...row.slice(0, start), ...row.slice(i + 1)],
      countdown: { ms, left: where.left, right: where.right, top: where.top, centre: where.centre },
    };
  }
  return { words: row, countdown: null };
}

// The character's Tasks screen labels its columns. That header says how wide
// one row of the table is, so cells sitting far apart across it can still be
// put back together; without it (a trader's page, which is two panes side by
// side) only a column gutter's worth of space is allowed.
type TaskTable = { left: number; right: number; top: number };

function findTable(rows: Word[][]): TaskTable | null {
  for (const row of rows) {
    const texts = row.map((w) => w.text.toLowerCase());
    if (!TABLE_HEADINGS.every((heading) => texts.includes(heading))) continue;
    const { left, right, top } = rowBounds(row);
    return { left: left - TABLE_MARGIN_PX, right: right + TABLE_MARGIN_PX, top };
  }
  return null;
}

// The other half of the pane problem: a row of the game's task list is taller
// than a line of text, and its cells sit on different baselines - a trader's
// list puts the status above the name, and the character's Tasks screen puts
// the countdown under it. OCR hands each baseline back as its own row, and none
// of them is a task row on its own.
//
// Words are taken one at a time, nearest first, and only while they are within
// a column gutter of the row being built. A line that reaches into the next
// pane (the stash grid to the right of the Tasks screen) gives up the words it
// shares with this row and keeps the rest as a row of its own.
// Where a line's real words sit, ignoring the icons the game draws in the
// margin, which would otherwise stretch it across half the screen
function coreOf(words: Word[]): { left: number; right: number } {
  const core = words.filter((w) => !STRAY_TOKEN.test(w.text));
  return rowBounds(core.length > 0 ? core : words);
}

function overlaps(a: { left: number; right: number }, b: { left: number; right: number }): boolean {
  return a.right >= b.left && b.right >= a.left;
}

// Where a line sits, which for a line that was nothing but a countdown is
// where that countdown sat
function lineBounds(row: ShapedRow): { top: number; left: number; right: number; centre: number } {
  return row.words.length > 0 ? rowBounds(row.words) : (row.countdown as Countdown);
}

function mergeCardLines(rows: ShapedRow[], table: TaskTable | null): ShapedRow[] {
  const out: ShapedRow[] = [];
  let current: ShapedRow | null = null;
  let lastCentre = -Infinity;
  const ordered = [...rows]
    .filter((row) => row.words.length > 0 || row.countdown !== null)
    .sort((a, b) => lineBounds(a).centre - lineBounds(b).centre);
  for (const row of ordered) {
    const here = lineBounds(row);
    if (!current || here.centre - lastCentre > CARD_LINE_PX) {
      current = { words: [...row.words], countdown: row.countdown };
      out.push(current);
      lastCentre = here.centre;
      continue;
    }
    let { left, right } = lineBounds(current);
    // Anything within a column gutter of the row so far belongs to it. Inside
    // the labelled table the whole width is one row, so the gap between the
    // task's name and its location column - which is far wider than a gutter -
    // is no reason to leave them apart.
    const belongs = (from: number, to: number) =>
      Math.max(0, left - to, from - right) <= PANE_GAP_PX ||
      (table !== null &&
        here.top > table.top &&
        Math.min(left, from) >= table.left &&
        Math.max(right, to) <= table.right);
    const rest = [...row.words];
    const taken: Word[] = [];
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = rest.length - 1; i >= 0; i--) {
        const w = rest[i];
        if (!belongs(w.left, w.left + w.width)) continue;
        left = Math.min(left, w.left);
        right = Math.max(right, w.left + w.width);
        taken.push(...rest.splice(i, 1));
        grew = true;
      }
    }
    const clock = row.countdown;
    const keepsClock = clock !== null && belongs(clock.left, clock.right);
    if (taken.length > 0 || keepsClock) {
      // Cells of one row sit in columns of their own, so putting them in
      // reading order means sorting by x. A name too long for its column is
      // different: it wraps under itself, and its second line has to stay
      // behind the first rather than be threaded into it by position.
      const wrapped = overlaps(coreOf(current.words), coreOf(taken));
      current.words.push(...taken);
      if (!wrapped) current.words.sort((a, b) => a.left - b.left);
      if (keepsClock) current.countdown = current.countdown ?? clock;
      lastCentre = here.centre;
    }
    if (rest.length > 0 || (!keepsClock && clock !== null)) {
      out.push({ words: rest, countdown: keepsClock ? null : clock });
      if (taken.length === 0 && !keepsClock) {
        current = out[out.length - 1];
        lastCentre = here.centre;
      }
    }
  }
  return out.filter((row) => row.words.length > 0);
}

function shapeRows(words: Word[]): { rows: ShapedRow[]; table: TaskTable | null } {
  const rows = groupRows(words);
  const table = findTable(rows);
  return { rows: mergeCardLines(rows.flatMap(splitAcrossPanes).map(takeCountdown), table), table };
}

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
  // The status is the last thing the row says, give or take the debris a
  // progress bar and a row icon leave behind
  const buttons = texts.length - stripLeadingChrome(texts).length;
  for (let tail = texts.length; tail > 2 && texts.length - tail <= TRADER_ROW_DEBRIS; tail--) {
    if (!TRADER_STATUS_PATTERN.test(texts[tail - 1])) continue;
    // The COMPLETE / REPLACE buttons in front of an open task's title are not
    // part of how long the row is; the cap is there to keep sentences out
    return tail - buttons <= TRADER_ROW_MAX_TOKENS ? tail : null;
  }
  return null;
}

// "activel", "active!", "Active" are all the same status
function statusKind(status: string): string {
  const m = /^(activ|comple|finish|lock|fail|avail|done)/i.exec(status);
  return m ? m[1].toLowerCase() : status.toLowerCase();
}

function stripTrailingCount(text: string): string {
  return text.replace(/\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/, "").trim();
}

// Two Operational tasks can share a name ("Exit the location" on Customs and
// on Shoreline are different dailies), so where it is done is part of what
// identifies it
function unknownKey(name: string, location: string): string {
  return `${normalizeName(name)}@${normalizeName(location)}`;
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
  for (const m of [ANY_LOCATION, ...mapNames]) {
    for (const w of normalizeName(m).split(" ")) if (w) words.add(w);
  }
  return words;
}

// A location the game wrapped onto two lines can leak into the name column
// with a word missing ("Secret Message Streets of"); drop up to three
// trailing map-name words
// Words that are in the map vocabulary without being any particular place.
// "Exit the location" is a whole task name, not a name with a map stuck on
// the end, so a run of these alone is never a leaked location column.
const GENERIC_LOCATION_WORDS = new Set([...normalizeName(ANY_LOCATION).split(" "), "the", "of", "and"]);

function stripTrailingMapWords(tokens: string[], mapWords: Set<string>): string[] {
  const out = [...tokens];
  let dropped = 0;
  let named = false;
  while (out.length > 1 && dropped < 3 && mapWords.has(normalizeName(out[out.length - 1]))) {
    if (!GENERIC_LOCATION_WORDS.has(normalizeName(out[out.length - 1]))) named = true;
    out.pop();
    dropped++;
  }
  return named ? out : [...tokens];
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
    const extraWords = wordCount - name.split(" ").length;
    // A catalog name at the very start followed by a few words of debris (a
    // misread location), or at the very end behind a few words of screen
    // furniture ("COMPLETE 9 Dragnet" is the Complete button, a counter and
    // the task's own title), is that task. Buried in the middle it has to be
    // long enough not to match inside unrelated text ("Debut", "Setup").
    const atEdge =
      (wanted.startsWith(` ${name} `) || wanted.endsWith(` ${name} `)) && extraWords <= 3;
    if (!atEdge && (name.length < 9 || !wanted.includes(` ${name} `))) continue;
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

// Buttons and counters the game draws in the same horizontal band as a task
// title (the trader screen puts its COMPLETE button to the left of the name),
// which OCR hands us as leading words of the name
const UI_CHROME_WORDS = /^(complete|completed|replace|back|transition|visit)$/i;

// How far into a row a button can sit and still be chrome rather than a name
const CHROME_SEARCH_TOKENS = 4;

function stripLeadingChrome(tokens: string[]): string[] {
  // Everything up to the last button goes, not just the words we recognise:
  // OCR breaks a button into pieces ("COMPLETE" comes back as "COMP Sone"),
  // and those pieces sit between the buttons and the title
  let last = -1;
  for (let i = 0; i < Math.min(tokens.length - 1, CHROME_SEARCH_TOKENS); i++) {
    if (UI_CHROME_WORDS.test(tokens[i])) last = i;
  }
  if (last < 0) return [...tokens];
  const out = tokens.slice(last + 1);
  // A button is often followed by its own counter ("COMPLETE 9")
  while (out.length > 1 && /^\d{1,3}$/.test(out[0])) out.shift();
  return out;
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
// wellFormed = the row had a recognised location, a status and a percent, so
// it is a task row by construction. The rules below exist to reject rows that
// are really description text or OCR debris; a complete row does not need
// them, and applying them anyway threw away real dailies whose names are one
// word ("Elimination") or use words no catalog task happens to contain.
function cleanUnknownName(
  read: string,
  catalog: CatalogTask[],
  mapWords: Set<string> = new Set(),
  wellFormed = false
): string | null {
  const tokens = stripTrailingMapWords(read.trim().split(/\s+/).filter(Boolean), mapWords);
  // The row icon comes back as a letter or two in front of the name ("Sj Exit
  // the location"), which is not junk by shape - it just is not a word
  const leadingJunk = (token: string) =>
    token !== "A" &&
    (JUNK_WORD.test(token) || (token.length <= 2 && !SHORT_WORDS.has(token.toLowerCase())));
  while (tokens.length > 1 && leadingJunk(tokens[0])) tokens.shift();
  while (tokens.length && /[^A-Za-z0-9'\u2019.!?-]/.test(tokens[tokens.length - 1])) tokens.pop();
  const name = tokens.join(" ");
  const letters = (name.match(/[A-Za-z]/g) ?? []).length;
  const properWords = tokens.filter((t) => /^[A-Za-z'\u2019-]{2,}$/.test(t)).length;
  if (letters < 4 || properWords < 1) return null;
  if (!wellFormed && (tokens.length < 2 || properWords < 2 || letters < 8)) return null;
  if (letters / Math.max(1, name.replace(/\s/g, "").length) < 0.8) return null;
  if (!NAME_CHARS.test(name)) return null;
  const debris = tokens.filter(
    (t) => t.length <= 2 && !SHORT_WORDS.has(t.toLowerCase())
  ).length;
  if (debris >= 2) return null;
  if (!wellFormed) {
    // Nearly every word of a real name is game English; one misread word in
    // three ("Dandies DUreets Tarkov") is a misread row, not a new task
    const vocabulary = catalogVocabulary(catalog);
    const longWords = normalizeName(name).split(" ").filter((w) => w.length >= 3);
    const known = longWords.filter((w) => vocabulary.has(w)).length;
    if (longWords.length > 0 && (known < 2 || known / longWords.length < 0.75)) return null;
  }
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
  mapWords: Set<string> = new Set(),
  wellFormed = false
): { taskId: string | null; name: string } | null {
  const taskId = matchTask(index, catalog, read, mapWords);
  if (taskId) {
    const name = catalog.find((t) => t.id === taskId)?.name ?? read;
    return { taskId, name };
  }
  const name = cleanUnknownName(read, catalog, mapWords, wellFormed);
  return name ? { taskId: null, name } : null;
}

// How far a piece of a name may be from the words it was read off. OCR loses
// the front of a word about as often as it garbles one letter, so this is not
// as tight as a spelling check would be.
const MISREAD_DISTANCE = 2;
// Below this, too many unrelated short names are within reach of each other
const MISREAD_MIN_LETTERS = 5;

// Is `name` a worse reading of some run of words out of `better`?
function isMisreadOf(name: string, better: string): boolean {
  const piece = normalizeName(name);
  const whole = normalizeName(better);
  if (piece.length < MISREAD_MIN_LETTERS || piece.length >= whole.length) return false;
  // A run of its words, exactly
  if (` ${whole} `.includes(` ${piece} `)) return true;
  // ... or near enough that OCR could have made one from the other
  const words = whole.split(" ");
  for (let from = 0; from < words.length; from++) {
    for (let to = from + 1; to <= words.length; to++) {
      const run = words.slice(from, to).join(" ");
      if (Math.abs(run.length - piece.length) > MISREAD_DISTANCE) continue;
      if (levenshtein(piece, run) <= MISREAD_DISTANCE) return true;
    }
  }
  return false;
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
