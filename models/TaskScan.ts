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
  percent: number;
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
  text: string;
  done: boolean;
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
};

// Enough tick-coloured pixels to be the glyph rather than noise
const TICK_PIXELS = 25;

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

  getObjectives(): Map<string, ScannedObjective> {
    return this.objectives;
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

  // Completion read off the Tasks screen for one objective of a task:
  // true / false when its row was seen, undefined when it never was
  doneFor(taskId: string, objectiveText: string): boolean | undefined {
    return this.stateFor(taskId, objectiveText)?.done;
  }

  stateFor(taskId: string, objectiveText: string): ScannedObjectiveState | undefined {
    return this.objectiveStates.get(`${taskId}|${normalizeName(objectiveText)}`);
  }

  percentFor(taskId: string): number | undefined {
    for (const t of this.tasks.values()) {
      if (t.taskId === taskId) return t.percent;
    }
    return undefined;
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
  ): { tasks: number; objectives: number } {
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
          if (key.length >= 8) {
            this.objectives.set(key, { key, text, count, total, at: now });
            objectiveRows.push({ text, done: count >= total, count, total });
            objectiveCount++;
            continue;
          }
        }
      }

      // ---- objective row without a counter: "<text>" or "<text> [tick]" ----
      if (row.length >= 4 && !texts.some((t) => PERCENT_PATTERN.test(t))) {
        // The row starts with an icon and may end with the tick itself,
        // both of which OCR turns into a stray short token
        const trimmed = stripStrayTokens(row, (w) => w.text);
        const text = trimmed.map((w) => w.text).join(" ");
        if (normalizeName(text).length >= 12) {
          const tail = trimmed[trimmed.length - 1];
          const ticked = row.slice(row.indexOf(tail)).some((w) => w.ticks >= TICK_PIXELS);
          objectiveRows.push({ text, done: ticked });
        }
      }

      // ---- task row: "<name> <location> <status> <percent>" ----
      const percentIdx = texts.findIndex((t) => PERCENT_PATTERN.test(t));
      if (percentIdx < 2) continue;
      const statusIdx = texts
        .slice(0, percentIdx)
        .map((t, i) => (STATUS_PATTERN.test(t) ? i : -1))
        .filter((i) => i >= 0)
        .pop();
      if (statusIdx === undefined || statusIdx < 1) continue;

      const percent = Number(PERCENT_PATTERN.exec(texts[percentIdx])![1]);
      if (!(percent >= 0 && percent <= 100)) continue;
      const status = texts[statusIdx];

      // Location is the longest trailing run of words before the status
      // that forms a known map name / "Any location"
      let location = "";
      let nameEnd = statusIdx;
      // Narrowest match first so "[Season PvP] Any location" keeps the tag
      // with the task name
      for (let start = statusIdx - 1; start >= Math.max(0, statusIdx - 4); start--) {
        const found = locations.get(wordSetKey(texts.slice(start, statusIdx).join(" ")));
        if (found) {
          location = found;
          nameEnd = start;
          break;
        }
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
      this.tasks.set(key, {
        key,
        name: resolved.name,
        taskId: resolved.taskId,
        percent,
        status,
        location,
        at: now,
        seen,
      });
      taskRows++;
    }

    const ticked = this.applyObjectiveRows(objectiveRows, catalog, activeTaskIds, now);

    if (taskRows > 0 || objectiveCount > 0 || ticked > 0) {
      this.lastScanAt = now;
      // Everything read during this scan session, not just the last pass
      this.lastScanCount = [...this.tasks.values()].filter((t) => now - t.at < 90 * 1000).length;
      this.save();
    }
    log.info(
      `Tasks screen scan: ${taskRows} task rows, ${objectiveCount} counters, ${ticked} objective states`
    );
    return { tasks: taskRows, objectives: objectiveCount + ticked };
  }

  // The objective rows on screen all belong to the one task that is open,
  // so find the active task whose objectives they match best and record
  // each matched row's done / not-done state for it
  private applyObjectiveRows(
    rows: { text: string; done: boolean; count?: number; total?: number }[],
    catalog: CatalogTask[],
    activeTaskIds: Iterable<string>,
    now: number
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
    for (const [i, objective] of best.matches) {
      const key = `${best.task.id}|${normalizeName(objective.text)}`;
      const row = rows[i];
      const previous = this.objectiveStates.get(key);
      if (
        previous &&
        previous.done === row.done &&
        previous.count === row.count &&
        previous.total === row.total
      ) {
        continue;
      }
      this.objectiveStates.set(key, {
        key,
        taskId: best.task.id,
        text: objective.text,
        done: row.done,
        count: row.count,
        total: row.total,
        at: now,
      });
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
      for (const t of data.tasks ?? []) this.tasks.set(t.key, t);
      for (const o of data.objectives ?? []) this.objectives.set(o.key, o);
      for (const o of data.objectiveStates ?? []) this.objectiveStates.set(o.key, o);
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

function stripTrailingCount(text: string): string {
  return text.replace(/\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/, "").trim();
}

// Normalized words in sorted order, so word order does not matter
function wordSetKey(text: string): string {
  return normalizeName(text).split(" ").filter(Boolean).sort().join(" ");
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
  let best: { id: string; length: number } | null = null;
  for (const task of catalog) {
    const name = normalizeName(task.name);
    // Short names ("Debut", "Setup") would match inside all sorts of text
    if (name.length < 9) continue;
    if (!wanted.includes(` ${name} `)) continue;
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
  const wanted = ` ${normalizeName(name)} `;
  const fragment = catalog.some((t) => {
    const full = ` ${normalizeName(t.name)} `;
    return full !== wanted && full.includes(wanted);
  });
  return fragment ? null : name;
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
