import log from "electron-log";
import { ItemTask } from "./Item";
import {
  fetchTarkovDevJson,
  TarkovDevTranslationsResponse,
} from "./tarkovDevApi";
import { normalizeName } from "./taskText";
import type TaskScan from "./TaskScan";

// Roubles, dollars, euros - hideout upgrades and a few quests list these as
// "item requirements" but showing them on a currency's tooltip is nonsense
const CURRENCY_ITEM_IDS = new Set([
  "5449016a4bdc2d6f028b456f",
  "5696686a4bdc2da3298b456a",
  "569668774bdc2da2298b4568",
]);

import {
  LEGACY_TRACKER_HOST,
  TRACKER_TIMEOUT_MS,
  TRACKER_USER_AGENT,
  TRACKER_API_BASES,
} from "./trackerApi";

const TRACKER_PROGRESS_URLS = TRACKER_API_BASES.map((base) => `${base}/progress`);

// json.tarkov.dev serves some collections as a keyed object rather than an array
const asList = <T,>(value: unknown): T[] =>
  (Array.isArray(value) ? value : Object.values(value ?? {})) as T[];

type TarkovDevObjective = {
  id: string;
  type: string;
  count?: number;
  optional?: boolean;
  // giveItem/plantItem: accepted items ("any of" when more than one)
  items?: string[];
  // buildWeapon: the base weapon to modify
  item?: string;
  foundInRaid?: boolean;
};

// "Any of" hand-in lists larger than this (e.g. "any 15 headgear items")
// are only shown for quests you have actually accepted; for every other
// quest they would tag dozens of items with noise
const MAX_ANY_OF_ITEMS = 5;

type TarkovDevTask = {
  id: string;
  name: string;
  minPlayerLevel?: number;
  factionName?: string;
  taskRequirements?: { task: string; status?: string[] }[];
  objectives?: TarkovDevObjective[];
};

type TarkovDevTasksResponse = {
  data: {
    tasks: TarkovDevTask[] | Record<string, TarkovDevTask>;
  };
};

type TarkovDevHideoutLevel = {
  id: string;
  level: number;
  stationLevelRequirements?: { station: string; level: number }[];
  itemRequirements?: {
    item: string;
    count: number;
    attributes?: { foundInRaid?: boolean };
  }[];
};

type TarkovDevHideoutStation = {
  id: string;
  name: string;
  levels?: TarkovDevHideoutLevel[];
};

type TarkovDevHideoutResponse = {
  data: Record<string, TarkovDevHideoutStation>;
};

// Objective types that are actually done inside a raid. Hand-overs, trader
// standing, "complete task X" etc. happen in the menu and only add noise to
// an in-raid quest list (the tooltip covers hand-over items already)
const IN_RAID_OBJECTIVE_TYPES = new Set([
  "shoot",
  "extract",
  "findItem",
  "findQuestItem",
  "plantItem",
  "plantQuestItem",
  "mark",
  "visit",
  "useItem",
]);

// Objectives listing this many maps or more are "any location" in practice
const ANYWHERE_MAP_COUNT = 8;

// What is needed to decide whether a task is done / doable / locked
export type TaskMeta = {
  id: string;
  minPlayerLevel: number;
  // "Any" (or undefined) means both factions; otherwise "BEAR" / "USEC"
  factionName?: string;
  // Prerequisite tasks and the status(es) they must be in to unlock this one
  prerequisites: { taskId: string; statuses: string[] }[];
};

// A quest with all of its objectives, for the in-raid quest panel
export type CatalogObjective = {
  id: string;
  type: string;
  text: string;
  mapIds: string[]; // empty = anywhere
  count: number;
  optional: boolean;
};

export type CatalogTask = TaskMeta & {
  name: string;
  traderId: string;
  mapId: string | null;
  kappaRequired: boolean;
  wikiLink: string | null;
  objectives: CatalogObjective[];
};

// The community wiki page for a task: tarkov.dev's link when it has one,
// otherwise the page the wiki would use for that name
export function taskWikiUrl(name: string, wikiLink?: string | null): string {
  if (wikiLink && /^https:\/\/escapefromtarkov\.fandom\.com\//.test(wikiLink)) return wikiLink;
  const page = name.trim().replace(/\s+/g, "_");
  return `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(page).replace(/%2F/g, "/")}`;
}

export type GameMap = { id: string; nameId: string; name: string };

// Quest lifecycle read from the game's own logs (see GameLogWatcher)
export type QuestEventMap = Map<
  string,
  { status: "started" | "failed" | "finished" }
>;

export type QuestPanelObjective = {
  id: string;
  // Its place in the task's own list, so finished steps stay where the game
  // shows them instead of being pushed to the bottom
  order: number;
  text: string;
  done: boolean;
  count: number;
  total: number;
  optional: boolean;
  here: boolean; // applies to the current map
  anywhere: boolean; // no map restriction
  // Something done in a raid (as opposed to handing items over etc.)
  inRaid: boolean;
};

export type QuestPanelQuest = {
  id: string;
  name: string;
  trader: string;
  kappa: boolean;
  // Community wiki page (middle-click a quest to open it)
  wiki: string;
  // Every objective of the quest, all maps and kinds (the "done" toggle
  // lists these; `objectives` is the subset this list is about)
  allObjectives: QuestPanelObjective[];
  // Everything this list is about is done, but the quest is still open
  doneHere?: boolean;
  // Every objective of the whole quest is done as far as we know
  allDone?: boolean;
  objectives: QuestPanelObjective[];
  // Overall progress read from the in-game Tasks screen, if scanned
  percent?: number;
  // When a rotating Operational task runs out, in wall-clock ms
  expiresAt?: number;
  // The game said so itself: all objectives done, waiting to be handed in
  ready?: boolean;
};

// How good a reason we have for believing an objective is done. When the game
// disagrees with us, the cheapest beliefs are the ones to give up.
const EVIDENCE = { none: 0, tickOnce: 1, tickTwice: 2, tracker: 3 };
// Ticks seen in this many separate reads count as corroborated
const OCR_TICK_CORROBORATED = 2;
// The game floors the percentage it draws, so two of three reads as 66%
const BAR_ROUNDING = 2;

// The weakest reason behind a step the game shows as one line
function reasonFor(step: QuestPanelObjective[], evidence: Map<string, number>): number {
  return Math.min(...step.map((o) => evidence.get(o.id) ?? 0));
}

// What marks a panel quest as one only the scanner knows about, so the panel
// and the main process agree on which cards can be thrown away
export const OPERATIONAL_ID_PREFIX = "operational:";

// One thing that changed about a quest, and where we learned it
export type QuestChange = {
  at: number;
  text: string;
  source: "scan" | "game" | "raid" | "tracker";
};

export type QuestPanelData = {
  hasProgress: boolean;
  // All maps, for the map picker
  maps: { nameId: string; name: string }[];
  mapNameId: string | null;
  // True when the user picked a map instead of following the raid
  mapOverride: boolean;
  mapName: string | null;
  inRaid: boolean;
  raidKind: "pmc" | "scav" | "unknown";
  // Quests with something to do on the current map
  here: QuestPanelQuest[];
  // Quests whose remaining objectives can be done on any map
  anywhere: QuestPanelQuest[];
  // Out of raid: how many active quests have objectives on each map
  perMap: { mapName: string; quests: number }[];
  scanned: { at: number; count: number } | null;
  // Most recent quest changes from any source, newest first
  changes: QuestChange[];
  // An image exists in the maps folder for this map (shows the Map button)
  hasMapImage?: boolean;
};

// One task or hideout upgrade that consumes items
export type RequirementSource = TaskMeta & {
  kind: "task" | "hideout";
  name: string;
  stationId?: string;
  level?: number;
  // Other stations' levels that must be built first ("<stationId>-<level>")
  gateLevelIds: string[];
  items: {
    itemId: string;
    count: number;
    foundInRaid: boolean;
    // Size of the "any of" list this item belongs to (1 = specific item)
    anyOf: number;
  }[];
};

export type TrackerProgress = {
  completedTaskIds: Set<string>;
  failedTaskIds: Set<string>;
  // Tasks TarkovTracker has written off for this player (wrong faction,
  // closed quest branch, ...) - treated like completed, i.e. hidden
  invalidTaskIds: Set<string>;
  completedHideoutLevelIds: Set<string>;
  // Per-objective progress from TarkovTracker (objective id -> state)
  objectiveProgress: Map<string, { complete: boolean; count: number }>;
  playerLevel: number;
  pmcFaction?: string;
  displayName?: string;
  // True when served by the legacy tarkovtracker.io backend
  legacyHost?: boolean;
};

export type TrackerFetchResult =
  | { status: "ok"; progress: TrackerProgress }
  | { status: "unauthorized" }
  | { status: "unavailable" };

export type TrackerValidationResult = {
  ok: boolean;
  displayName?: string;
  playerLevel?: number;
  tokenGameMode?: "pvp" | "pve" | "season" | "unknown";
  legacyHost?: boolean;
  // "unauthorized" = bad token, "unavailable" = TarkovTracker unreachable
  error?: "empty" | "unauthorized" | "unavailable";
};

export function tokenGameMode(
  token: string
): "pvp" | "pve" | "season" | "unknown" {
  if (token.startsWith("PVP_")) return "pvp";
  if (token.startsWith("PVE_")) return "pve";
  if (token.startsWith("SZN_")) return "season";
  return "unknown";
}

export default class TaskData {
  // Per-game-mode cache of quest/hideout definitions (they change per wipe,
  // not per hour, so they are fetched once per app session and mode)
  private sourcesByGameMode = new Map<string, RequirementSource[]>();
  // Last good TarkovTracker progress, reused if a refresh fails
  private lastProgress: TrackerProgress | null = null;
  private catalogByGameMode = new Map<string, CatalogTask[]>();
  private mapsByGameMode = new Map<string, GameMap[]>();
  private traderNamesByGameMode = new Map<string, Record<string, string>>();

  getLastProgress(): TrackerProgress | null {
    return this.lastProgress;
  }

  // Returns the sources for a game mode, fetching them on first use
  async loadSources(gameMode: string): Promise<RequirementSource[]> {
    const cached = this.sourcesByGameMode.get(gameMode);
    if (cached) {
      return cached;
    }

    const [tasksResponse, taskNames, hideoutResponse, hideoutNames] =
      await Promise.all([
        fetchTarkovDevJson<TarkovDevTasksResponse>(`/${gameMode}/tasks`),
        fetchTarkovDevJson<TarkovDevTranslationsResponse>(
          `/${gameMode}/tasks_en`
        ),
        fetchTarkovDevJson<TarkovDevHideoutResponse>(`/${gameMode}/hideout`),
        fetchTarkovDevJson<TarkovDevTranslationsResponse>(
          `/${gameMode}/hideout_en`
        ),
      ]);

    const sources: RequirementSource[] = [];

    const tasks = asList<TarkovDevTask>(tasksResponse?.data?.tasks);
    for (const task of tasks) {
      const items: RequirementSource["items"] = [];
      for (const objective of task.objectives ?? []) {
        if (objective.optional) continue;

        // Hand-over and plant objectives consume inventory items. Short
        // "any of" lists are shown (tagged), huge ones are skipped; currency
        // hand-overs (e.g. "pay 100k roubles") are excluded like hideout costs
        if (objective.type === "giveItem" || objective.type === "plantItem") {
          const accepted = (objective.items ?? []).filter(
            (id) => !CURRENCY_ITEM_IDS.has(id)
          );
          if (accepted.length === 0) continue;
          for (const itemId of accepted) {
            items.push({
              itemId,
              count: objective.count ?? 1,
              foundInRaid: objective.foundInRaid ?? false,
              anyOf: accepted.length,
            });
          }
        }

        // Gunsmith-style "modify this weapon" objectives - the game marks
        // the base weapon as quest-needed, so show it too
        if (objective.type === "buildWeapon" && objective.item) {
          items.push({
            itemId: objective.item,
            count: objective.count ?? 1,
            foundInRaid: false,
            anyOf: 1,
          });
        }
      }

      if (items.length === 0) continue;

      sources.push({
        id: task.id,
        kind: "task",
        name: taskNames?.data?.[task.name] ?? task.name,
        minPlayerLevel: task.minPlayerLevel ?? 1,
        factionName: task.factionName,
        prerequisites: (task.taskRequirements ?? [])
          .filter((r) => r.task)
          .map((r) => ({
            taskId: r.task,
            statuses: r.status?.length ? r.status : ["complete"],
          })),
        gateLevelIds: [],
        items,
      });
    }

    for (const station of Object.values(hideoutResponse?.data ?? {})) {
      const stationName = hideoutNames?.data?.[station.name] ?? station.name;
      for (const level of station.levels ?? []) {
        const items: RequirementSource["items"] = [];
        for (const requirement of level.itemRequirements ?? []) {
          if (!requirement.item || CURRENCY_ITEM_IDS.has(requirement.item)) {
            continue;
          }
          items.push({
            itemId: requirement.item,
            count: requirement.count ?? 1,
            foundInRaid: requirement.attributes?.foundInRaid ?? false,
            anyOf: 1,
          });
        }

        if (items.length === 0) continue;

        sources.push({
          id: level.id,
          kind: "hideout",
          name: `${stationName} ${level.level}`,
          minPlayerLevel: 1,
          prerequisites: [],
          stationId: station.id,
          level: level.level,
          gateLevelIds: (level.stationLevelRequirements ?? [])
            .filter((r) => r.station)
            .map((r) => `${r.station}-${r.level}`),
          items,
        });
      }
    }

    this.sourcesByGameMode.set(gameMode, sources);
    log.info(
      `Loaded ${sources.length} item-requirement sources (tasks + hideout) for ${gameMode}`
    );
    return sources;
  }

  async fetchTrackerProgress(token: string): Promise<TrackerFetchResult> {
    let lastError: unknown = null;
    let rejectedSomewhere = false;

    for (const url of TRACKER_PROGRESS_URLS) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TRACKER_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": TRACKER_USER_AGENT,
          },
          signal: controller.signal,
        });

        if (res.status === 401 || res.status === 403) {
          // A token minted on one host is rejected by the others; keep going
          rejectedSomewhere = true;
          continue;
        }

        if (!res.ok) {
          throw new Error(`TarkovTracker returned ${res.status}`);
        }

        const payload: any = await res.json();
        const data = payload?.data ?? payload;

        const completedTaskIds = new Set<string>();
        const failedTaskIds = new Set<string>();
        const invalidTaskIds = new Set<string>();
        for (const entry of asList<any>(data?.tasksProgress)) {
          if (entry?.id == null) continue;
          const id = String(entry.id);
          if (entry.complete === true) completedTaskIds.add(id);
          if (entry.failed === true) failedTaskIds.add(id);
          if (entry.invalid === true) invalidTaskIds.add(id);
        }

        const completedHideoutLevelIds = new Set<string>();
        for (const entry of asList<any>(data?.hideoutModulesProgress)) {
          if (entry?.id != null && entry.complete === true) {
            completedHideoutLevelIds.add(String(entry.id));
          }
        }

        const objectiveProgress = new Map<
          string,
          { complete: boolean; count: number }
        >();
        for (const entry of asList<any>(data?.taskObjectivesProgress)) {
          if (entry?.id == null) continue;
          objectiveProgress.set(String(entry.id), {
            complete: entry.complete === true,
            count: typeof entry.count === "number" ? entry.count : 0,
          });
        }

        const progress: TrackerProgress = {
          completedTaskIds,
          failedTaskIds,
          invalidTaskIds,
          completedHideoutLevelIds,
          objectiveProgress,
          playerLevel:
            typeof data?.playerLevel === "number" ? data.playerLevel : 1,
          pmcFaction:
            typeof data?.pmcFaction === "string" ? data.pmcFaction : undefined,
          displayName:
            typeof data?.displayName === "string"
              ? data.displayName
              : undefined,
          legacyHost: url.includes(LEGACY_TRACKER_HOST),
        };
        this.lastProgress = progress;
        return { status: "ok", progress };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (rejectedSomewhere) {
      log.warn("TarkovTracker token rejected by every host");
      return { status: "unauthorized" };
    }
    log.warn("TarkovTracker unreachable:", lastError);
    return { status: "unavailable" };
  }

  // Progress for the periodic refresh: falls back to the last good result
  // when TarkovTracker is temporarily unreachable
  async getProgress(token: string): Promise<TrackerProgress | null> {
    const result = await this.fetchTrackerProgress(token);
    if (result.status === "ok") return result.progress;
    if (result.status === "unavailable" && this.lastProgress) {
      log.info("Using last known TarkovTracker progress");
      return this.lastProgress;
    }
    return null;
  }

  async validateToken(token: string): Promise<TrackerValidationResult> {
    const trimmed = token.trim();
    if (!trimmed) {
      return { ok: false, error: "empty" };
    }

    const result = await this.fetchTrackerProgress(trimmed);
    if (result.status !== "ok") {
      return { ok: false, error: result.status };
    }

    return {
      ok: true,
      displayName: result.progress.displayName,
      playerLevel: result.progress.playerLevel,
      tokenGameMode: tokenGameMode(trimmed),
      legacyHost: result.progress.legacyHost,
    };
  }

  // Build itemId -> ItemTask[] from the given sources, with per-entry
  // status when TarkovTracker progress is available
  buildItemTaskMap(
    sources: RequirementSource[],
    progress: TrackerProgress | null,
    questEvents?: QuestEventMap | null
  ): Map<string, ItemTask[]> {
    const useLogs = !!questEvents && questEvents.size > 0;
    const map = new Map<string, ItemTask[]>();

    // Only trust hideout progress if its ids line up with tarkov.dev level
    // ids - otherwise a different id scheme would misreport built modules
    // as locked
    const knownLevelIds = new Set(
      sources.filter((s) => s.kind === "hideout").map((s) => s.id)
    );
    const hideoutProgressUsable =
      progress != null &&
      progress.completedHideoutLevelIds.size > 0 &&
      [...progress.completedHideoutLevelIds].some((id) =>
        knownLevelIds.has(id)
      );

    for (const source of sources) {
      let status: ItemTask["status"];

      if (source.kind === "task") {
        if (useLogs) {
          status = this.taskStatusFromLogs(source.id, questEvents!, progress);
        } else if (progress) {
          status = this.taskStatus(source, progress);
        }
      } else if (progress && hideoutProgressUsable) {
        status = this.hideoutStatus(source, progress);
      }

      for (const requirement of source.items) {
        // Broad "any of" lists only matter once you hold the quest
        if (requirement.anyOf > MAX_ANY_OF_ITEMS && status !== "active") {
          continue;
        }
        const entry: ItemTask = {
          task:
            requirement.anyOf > 1
              ? `${source.name} (any of ${requirement.anyOf})`
              : source.name,
          count: requirement.count,
          inRaid: requirement.foundInRaid,
          kind: source.kind,
          status,
        };

        const existing = map.get(requirement.itemId);
        if (!existing) {
          map.set(requirement.itemId, [entry]);
        } else if (
          // BEAR/USEC variants of a quest share a name; without progress
          // data both would show, so collapse identical rows
          !existing.some(
            (e) =>
              e.task === entry.task &&
              e.count === entry.count &&
              e.inRaid === entry.inRaid &&
              e.status === entry.status
          )
        ) {
          existing.push(entry);
        }
      }
    }

    // Most relevant first: needed-now, then unknown, then locked, then done
    const rank: Record<string, number> = {
      active: 0,
      undefined: 1,
      locked: 2,
      done: 3,
    };
    for (const entries of map.values()) {
      entries.sort(
        (a, b) => rank[String(a.status)] - rank[String(b.status)]
      );
    }

    return map;
  }

  // When the game's logs are available they are the ground truth for which
  // quests you hold: accepted = active, handed in = done, never accepted =
  // not yet available to you (the task graph over-counts storyline gates)
  private taskStatusFromLogs(
    taskId: string,
    questEvents: QuestEventMap,
    progress: TrackerProgress | null
  ): ItemTask["status"] {
    if (progress?.completedTaskIds.has(taskId)) return "done";
    const event = questEvents.get(taskId);
    if (event?.status === "finished") return "done";
    if (event?.status === "started") return "active";
    return "locked";
  }

  private taskStatus(
    source: TaskMeta,
    progress: TrackerProgress
  ): ItemTask["status"] {
    if (
      progress.completedTaskIds.has(source.id) ||
      progress.invalidTaskIds.has(source.id)
    ) {
      return "done";
    }

    // The other faction's variant of a quest can never be taken
    if (
      progress.pmcFaction &&
      source.factionName &&
      source.factionName !== "Any" &&
      source.factionName.toUpperCase() !== progress.pmcFaction.toUpperCase()
    ) {
      return "done";
    }

    if (source.minPlayerLevel > progress.playerLevel) {
      return "locked";
    }

    const prerequisitesMet = source.prerequisites.every((prerequisite) =>
      prerequisite.statuses.some((wanted) => {
        const completed = progress.completedTaskIds.has(prerequisite.taskId);
        const failed = progress.failedTaskIds.has(prerequisite.taskId);
        if (wanted === "complete") return completed;
        if (wanted === "failed") return failed;
        if (wanted === "active") return !completed && !failed;
        return false;
      })
    );

    return prerequisitesMet ? "active" : "locked";
  }

  private hideoutStatus(
    source: RequirementSource,
    progress: TrackerProgress
  ): ItemTask["status"] {
    const built = progress.completedHideoutLevelIds;

    if (built.has(source.id)) {
      return "done";
    }

    const previousLevelBuilt =
      source.level === 1 ||
      built.has(`${source.stationId}-${(source.level ?? 1) - 1}`);
    const gatesBuilt = source.gateLevelIds.every((id) => built.has(id));

    return previousLevelBuilt && gatesBuilt ? "active" : "locked";
  }

  // Every quest with every objective (cached per game mode); used by the
  // in-raid quest panel. Separate from loadSources, which only keeps the
  // item hand-ins the tooltip needs.
  async loadTaskCatalog(gameMode: string): Promise<CatalogTask[]> {
    const cached = this.catalogByGameMode.get(gameMode);
    if (cached) return cached;

    const [tasksResponse, taskNames] = await Promise.all([
      fetchTarkovDevJson<TarkovDevTasksResponse>(`/${gameMode}/tasks`),
      fetchTarkovDevJson<TarkovDevTranslationsResponse>(
        `/${gameMode}/tasks_en`
      ),
    ]);
    const names = taskNames?.data ?? {};
    const tasks = asList<any>(tasksResponse?.data?.tasks);

    const catalog: CatalogTask[] = tasks.map((task: any) => ({
      id: task.id,
      name: names[task.name] ?? task.name,
      traderId: task.trader ?? "",
      mapId: task.map ?? null,
      kappaRequired: task.kappaRequired === true,
      wikiLink: typeof task.wikiLink === "string" ? task.wikiLink : null,
      minPlayerLevel: task.minPlayerLevel ?? 1,
      factionName: task.factionName,
      prerequisites: (task.taskRequirements ?? [])
        .filter((r: any) => r.task)
        .map((r: any) => ({
          taskId: r.task,
          statuses: r.status?.length ? r.status : ["complete"],
        })),
      objectives: (task.objectives ?? []).map((o: any) => ({
        id: o.id,
        type: o.type,
        text: names[o.description] ?? o.description ?? o.type,
        // The game says "Any location" but the data lists every regular map
        // (11 of 17 for "Eliminate Scavs with a bolt-action rifle"); a list
        // that long means anywhere
        mapIds:
          Array.isArray(o.maps) && o.maps.length < ANYWHERE_MAP_COUNT
            ? o.maps
            : [],
        count: typeof o.count === "number" ? o.count : 1,
        optional: o.optional === true,
      })),
    }));

    this.catalogByGameMode.set(gameMode, catalog);
    log.info(`Loaded quest catalog: ${catalog.length} tasks for ${gameMode}`);
    return catalog;
  }

  async loadMaps(gameMode: string): Promise<GameMap[]> {
    const cached = this.mapsByGameMode.get(gameMode);
    if (cached) return cached;

    const [mapsResponse, mapNames] = await Promise.all([
      fetchTarkovDevJson<{ data: { maps: any[] | Record<string, any> } }>(
        `/${gameMode}/maps`
      ),
      fetchTarkovDevJson<TarkovDevTranslationsResponse>(`/${gameMode}/maps_en`),
    ]);
    const maps: GameMap[] = asList<any>(mapsResponse?.data?.maps).map((m: any) => ({
      id: m.id,
      nameId: m.nameId,
      name: mapNames?.data?.[m.name] ?? m.name,
    }));
    this.mapsByGameMode.set(gameMode, maps);
    return maps;
  }

  async loadTraderNames(gameMode: string): Promise<Record<string, string>> {
    const cached = this.traderNamesByGameMode.get(gameMode);
    if (cached) return cached;
    const names: Record<string, string> = {};
    try {
      const [traders, translations] = await Promise.all([
        fetchTarkovDevJson<{ data: Record<string, { id: string; name: string }> }>(
          `/${gameMode}/traders`
        ),
        fetchTarkovDevJson<TarkovDevTranslationsResponse>(
          `/${gameMode}/traders_en`
        ),
      ]);
      for (const trader of Object.values(traders?.data ?? {})) {
        if (trader?.id) names[trader.id] = translations?.data?.[trader.name];
      }
      // Only a successful read is worth remembering; caching a failure would
      // blank every trader name for the rest of the session
      this.traderNamesByGameMode.set(gameMode, names);
    } catch (error) {
      log.warn("Failed to load trader names for quest panel:", error);
    }
    return names;
  }

  // Build what the quest panel shows for the current map / raid state
  async buildQuestPanelData(
    gameMode: string,
    progress: TrackerProgress | null,
    state: {
      mapNameId: string | null;
      inRaid: boolean;
      raidKind: "pmc" | "scav" | "unknown";
    },
    questEvents?: QuestEventMap | null,
    scan?: TaskScan | null,
    changes: QuestChange[] = []
  ): Promise<QuestPanelData> {
    const [catalog, maps, traderNames] = await Promise.all([
      this.loadTaskCatalog(gameMode),
      this.loadMaps(gameMode),
      this.loadTraderNames(gameMode),
    ]);

    const wanted = state.mapNameId?.toLowerCase();
    const currentMap = wanted
      ? maps.find((m) => m.nameId.toLowerCase() === wanted) ?? null
      : null;
    const mapNameById = new Map(maps.map((m) => [m.id, m.name]));

    // Rows scanned off the Tasks screen are re-checked against the catalog
    // so icon-junk reads and partial names never linger as "Operational"
    scan?.prune(catalog, maps.map((m) => m.name));

    // Operational (daily/weekly) tasks: no catalog has ever heard of them, so
    // their name, map, steps and time left all come off the screen. They go in
    // the same lists as everything else - on their map, or under Anywhere.
    const dailyHere: QuestPanelQuest[] = [];
    const dailyAnywhere: QuestPanelQuest[] = [];
    const dailyPerMap = new Map<string, number>();
    for (const daily of scan?.getUnknownTasks() ?? []) {
      if ((daily.percent ?? 0) >= 100 || /comple|done|fail/i.test(daily.status)) continue;
      // Rotated out while you were away; the game replaced it hours ago
      if (daily.expiresAt !== undefined && daily.expiresAt < Date.now()) continue;
      const map = maps.find((m) => m.name === daily.location);
      if (map && currentMap && map.id !== currentMap.id) continue;
      if (map && !currentMap) {
        dailyPerMap.set(map.name, (dailyPerMap.get(map.name) ?? 0) + 1);
        continue;
      }
      const objectives: QuestPanelObjective[] = (daily.objectives ?? []).map((o, order) => ({
        id: `${daily.key}#${order}`,
        order,
        text: o.text,
        done: o.done,
        count: o.count ?? (o.done ? 1 : 0),
        total: o.total ?? 1,
        optional: false,
        here: !!map,
        anywhere: !map,
        inRaid: true,
      }));
      const quest: QuestPanelQuest = {
        id: `${OPERATIONAL_ID_PREFIX}${daily.key}`,
        name: daily.name,
        trader: traderNames[daily.traderId ?? ""] ?? "",
        kappa: false,
        wiki: taskWikiUrl(daily.name),
        objectives,
        allObjectives: objectives,
        percent: daily.percent,
        expiresAt: daily.expiresAt,
        allDone: (objectives.length > 0 && objectives.every((o) => o.done)) || undefined,
      };
      (map ? dailyHere : dailyAnywhere).push(quest);
    }

    // Out of raid, the map picker shows how much each map is worth going to
    const toPerMap = (counts: Map<string, number>) =>
      [...counts.entries()]
        .map(([mapName, quests]) => ({ mapName, quests }))
        .sort((a, b) => b.quests - a.quests || a.mapName.localeCompare(b.mapName));

    const useLogs = !!questEvents && questEvents.size > 0;
    const empty: QuestPanelData = {
      hasProgress:
        !!progress || useLogs || dailyHere.length + dailyAnywhere.length + dailyPerMap.size > 0,
      maps: maps
        .map((m) => ({ nameId: m.nameId, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      mapNameId: currentMap?.nameId ?? null,
      mapOverride: false,
      mapName: currentMap?.name ?? null,
      inRaid: state.inRaid,
      raidKind: state.raidKind,
      here: dailyHere,
      anywhere: dailyAnywhere,
      perMap: toPerMap(dailyPerMap),
      scanned: scan && scan.getLastScan().at ? scan.getLastScan() : null,
      changes,
    };
    if (!progress && !useLogs) return empty;

    // Preferred: the quests you accepted in-game and have not handed in or
    // failed (from the game's own notifications). Fallback: what the task
    // graph says is unlocked, which over-counts storyline-gated quests.
    const active = catalog.filter((task) =>
      useLogs
        ? this.taskStatusFromLogs(task.id, questEvents!, progress) === "active" &&
          !progress?.failedTaskIds.has(task.id)
        : this.taskStatus(task, progress!) === "active"
    );
    const objectiveState = (id: string) => progress?.objectiveProgress.get(id);

    // Counters the scan could not pin to a task are keyed by their wording
    // alone, so they may only be used where that wording belongs to one task.
    // "Survive and extract from the location" is the wording of a dozen of
    // them, and lending one task's counter to another ticks off work nobody
    // has done.
    const sharedWording = new Set<string>();
    const seenWording = new Set<string>();
    for (const task of catalog) {
      for (const wording of new Set(task.objectives.map((o) => normalizeName(o.text)))) {
        if (seenWording.has(wording)) sharedWording.add(wording);
        seenWording.add(wording);
      }
    }

    const toPanelQuest = (
      task: CatalogTask,
      objectiveFilter: (o: CatalogObjective) => boolean
    ): QuestPanelQuest | null => {
      const toast = scan?.toastFor(task.id, task.name);
      // The game's own verdict, read off the trader's task list
      const readyOnScreen = scan?.readyFor(task.id) === true;
      // How good our reason is for believing each objective is done, so that
      // when the game contradicts us we know which belief to give up first
      const evidence = new Map<string, number>();
      const allObjectives: QuestPanelObjective[] = task.objectives
        .map((o, order) => {
          const p = objectiveState(o.id);
          // Progress read off the Tasks screen for this row; a "find" objective
          // also counts what its "hand over" twin has already received
          const state = scan?.stateFor(task.id, o.text);
          // Only when the task has a single hand-over objective: tasks like
          // Aid Stations list one identical "Hand over the item" per key, the
          // game shows a single ticked row for it, and pairing that with
          // every key would mark them all done
          const giveItems = task.objectives.filter((s) => s.type === "giveItem");
          const twin =
            o.type === "findItem" && giveItems.length === 1 && giveItems[0].count === o.count
              ? giveItems[0]
              : undefined;
          const twinState = twin ? scan?.stateFor(task.id, twin.text) : undefined;
          const looseCount = sharedWording.has(normalizeName(o.text))
            ? undefined
            : scan?.countFor(o.text)?.count;
          const scannedCount = state?.total ? state.count ?? 0 : looseCount ?? 0;
          const twinCount = twinState?.total ? twinState.count ?? 0 : 0;
          const scannedDone = state?.done === true || twinState?.done === true;
          const trackerCount = Math.min(p?.count ?? 0, o.count);
          const count = Math.min(o.count, Math.max(trackerCount, scannedCount, twinCount));
          const seenTicked = Math.max(state?.doneSeen ?? 0, twinState?.doneSeen ?? 0);
          evidence.set(
            o.id,
            p?.complete === true
              ? EVIDENCE.tracker
              : seenTicked >= OCR_TICK_CORROBORATED
                ? EVIDENCE.tickTwice
                : scannedDone || (o.count > 0 && count >= o.count)
                  ? EVIDENCE.tickOnce
                  : EVIDENCE.none
          );
          return {
            id: o.id,
            order,
            text: o.text,
            done: p?.complete === true || scannedDone || (o.count > 0 && count >= o.count),
            count,
            total: o.count,
            optional: o.optional,
            here: currentMap ? o.mapIds.includes(currentMap.id) : false,
            inRaid: IN_RAID_OBJECTIVE_TYPES.has(o.type),
            anywhere: o.mapIds.length === 0,
          };
        });
      const wanted = new Set(task.objectives.filter(objectiveFilter).map((o) => o.id));
      const objectives = allObjectives.filter((o) => wanted.has(o.id));
      if (objectives.length === 0) return null;
      // ---- what is actually done, from the steadiest source down ----
      //
      // Four things tell us about a quest and they do not always agree, so
      // they are read in order of how much they know. The game stating the
      // whole task is finished beats its progress bar; the bar - the game's
      // own count of how far along the task is - beats a tick we read off one
      // row; and a "subtask completed" notification, which never says which
      // subtask it means, is the last word rather than the first.
      const percent = scan?.percentFor(task.id);
      const required = allObjectives.filter((o) => !o.optional);
      // The bar has to be read against the same list the game is describing,
      // and the game counts one step per distinct wording: Aid Stations shows
      // a single "Hand over the item" where the catalog holds one per key.
      const steps = new Map<string, QuestPanelObjective[]>();
      for (const objective of required) {
        steps.set(objective.text, [...(steps.get(objective.text) ?? []), objective]);
      }
      const grouped = [...steps.values()];
      // The most steps the bar can be describing. Rounding is generous by a
      // couple of points because the game floors what it draws (two of three
      // reads as 66%), and a lone step's bar is its counter - three kills out
      // of five is 60% and nothing about it is finished.
      const barAllows =
        percent === undefined || grouped.length === 0
          ? null
          : Math.floor(((percent + BAR_ROUNDING) * grouped.length) / 100);
      const doneCount = () => grouped.filter((step) => step.every((o) => o.done)).length;

      // 1. The game says the whole task is done: a "ready to be completed"
      //    notification, "Finished!" on the trader's list, or a full bar -
      //    which is the same statement in the game's own arithmetic
      const saidFinished = toast?.ready === true || readyOnScreen || percent === 100;
      if (saidFinished) {
        for (const objective of allObjectives) {
          if (objective.optional) continue;
          objective.done = true;
          objective.count = objective.total;
        }
      } else {
        // 2. The bar caps what we may believe. Where we think more is done
        //    than it allows, the weakest-evidenced ticks come off first.
        if (barAllows !== null) {
          const believed = grouped
            .filter((step) => step.every((o) => o.done))
            .sort((a, b) => reasonFor(a, evidence) - reasonFor(b, evidence));
          // A percent read off the screen once is no reason to un-complete
          // what the tracker holds as a fact, however stale the bar is
          const givable = believed.filter(
            (step) => reasonFor(step, evidence) < EVIDENCE.tracker
          ).length;
          const over = Math.min(givable, Math.max(0, believed.length - barAllows));
          for (const step of believed.slice(0, over)) {
            for (const objective of step) {
              objective.done = false;
              objective.count = Math.min(objective.count, Math.max(0, objective.total - 1));
            }
          }
        }

        // 3. "Subtask completed" says something advanced but never what, so it
        //    is only worth pinning on one objective when the rest of the quest
        //    leaves no doubt - and never on the last one outstanding: finishing
        //    a task brings its own notification, and this is not it.
        const open = required.filter((o) => !o.done && o.inRaid);
        const onThisMap = state.inRaid
          ? open.filter((o) => currentMap && o.here && !o.anywhere)
          : [];
        const room = barAllows === null || doneCount() < barAllows;
        if (toast && toast.subtasks > 0 && room && open.length > 1 && onThisMap.length === 1) {
          onThisMap[0].done = true;
          onThisMap[0].count = onThisMap[0].total;
        }
      }

      // An accepted quest is never dropped because we believe its work is
      // done - that belief can be wrong (a misread tick) and the player still
      // has to hand it in. It stays, flagged, sorted last. Judged last of all,
      // once every source above has had its say.
      const doneHere = objectives.every((o) => o.done);
      const allDone = allObjectives.every((o) => o.done);

      // A single-objective quest's percent is its counter - an estimate, so
      // it may fill the bar but never complete the objective on its own.
      // Judged over the whole quest: on a two-objective quest showing one per
      // map, the bar is the average of both and says nothing about either.
      if (
        percent !== undefined &&
        grouped.length === 1 &&
        objectives.length === 1 &&
        objectives[0].count === 0 &&
        objectives[0].total > 1
      ) {
        objectives[0].count = Math.min(
          objectives[0].total - (objectives[0].done ? 0 : 1),
          Math.round((percent / 100) * objectives[0].total)
        );
      }
      return {
        id: task.id,
        name: task.name,
        trader: traderNames[task.traderId] ?? "",
        kappa: task.kappaRequired,
        wiki: taskWikiUrl(task.name, task.wikiLink),
        objectives,
        // The game shows one row per distinct wording (Aid Stations has four
        // identical "Hand over the item" entries), so list it that way too
        allObjectives: allObjectives.filter(
          (o, i, list) => list.findIndex((x) => x.text === o.text) === i
        ),
        doneHere: doneHere || undefined,
        allDone: allDone || undefined,
        // Saying DONE beside a bar reading 50% tells the player two different
        // things. Only ever corrects a bar we read; never invents one.
        percent: percent !== undefined && (allDone || saidFinished) ? 100 : percent,
        ready: saidFinished || undefined,
      };
    };

    const here: QuestPanelQuest[] = [...dailyHere];
    const anywhere: QuestPanelQuest[] = [...dailyAnywhere];
    const perMapCounts = new Map(dailyPerMap);

    const inRaid = (o: CatalogObjective) => IN_RAID_OBJECTIVE_TYPES.has(o.type);

    for (const task of active) {
      if (currentMap) {
        // Objectives doable on this map (map-specific here, or anywhere)
        const q = toPanelQuest(
          task,
          (o) =>
            inRaid(o) &&
            (o.mapIds.includes(currentMap.id) || o.mapIds.length === 0)
        );
        if (q && q.objectives.some((o) => o.here)) {
          here.push(q);
          continue;
        }
      }
      const anyQ = toPanelQuest(
        task,
        (o) => inRaid(o) && o.mapIds.length === 0
      );
      if (anyQ) anywhere.push(anyQ);

      // Per-map summary, drawn only when no map is selected
      if (!currentMap) {
        const mapsTouched = new Set<string>();
        for (const o of task.objectives) {
          if (!inRaid(o)) continue;
          const p = objectiveState(o.id);
          if (p?.complete) continue;
          for (const id of o.mapIds) mapsTouched.add(id);
        }
        for (const id of mapsTouched) {
          const name = mapNameById.get(id);
          if (name) perMapCounts.set(name, (perMapCounts.get(name) ?? 0) + 1);
        }
      }
    }

    const byName = (a: QuestPanelQuest, b: QuestPanelQuest) =>
      Number(!!a.doneHere) - Number(!!b.doneHere) ||
      a.trader.localeCompare(b.trader) ||
      a.name.localeCompare(b.name);
    here.sort(byName);
    anywhere.sort(byName);

    return {
      ...empty,
      here,
      anywhere,
      perMap: toPerMap(perMapCounts),
    };
  }
}
