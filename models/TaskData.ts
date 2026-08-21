import log from "electron-log";
import { ItemTask } from "./Item";
import {
  fetchTarkovDevJson,
  TarkovDevTranslationsResponse,
} from "./tarkovDevApi";
import type TaskScan from "./TaskScan";

// Roubles, dollars, euros - hideout upgrades and a few quests list these as
// "item requirements" but showing them on a currency's tooltip is nonsense
const CURRENCY_ITEM_IDS = new Set([
  "5449016a4bdc2d6f028b456f",
  "5696686a4bdc2da3298b456a",
  "569668774bdc2da2298b4568",
]);

// TarkovTracker progress API. The api.tarkovtracker.org gateway is primary
// and tarkovtracker.org serves the same route during its deprecation
// window. tarkovtracker.io is the legacy site with its own accounts and
// token format; tokens created there only work against it, so it is tried
// last so existing users are not locked out.
const TRACKER_PROGRESS_URLS = [
  "https://api.tarkovtracker.org/api/v2/progress",
  "https://tarkovtracker.org/api/v2/progress",
  "https://tarkovtracker.io/api/v2/progress",
];
const LEGACY_TRACKER_HOST = "tarkovtracker.io";

// The gateway rejects requests whose User-Agent is shorter than 5 chars,
// and Electron's main-process fetch sends just "node"
const TRACKER_USER_AGENT =
  "orbb-tooltip/1.0 (+https://github.com/Magicard/orbb-tooltip)";

const TRACKER_TIMEOUT_MS = 15 * 1000;

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
  objectives: CatalogObjective[];
};

export type GameMap = { id: string; nameId: string; name: string };

// Quest lifecycle read from the game's own logs (see GameLogWatcher)
export type QuestEventMap = Map<
  string,
  { status: "started" | "failed" | "finished" }
>;

export type QuestPanelObjective = {
  id: string;
  text: string;
  done: boolean;
  count: number;
  total: number;
  optional: boolean;
  here: boolean; // applies to the current map
  anywhere: boolean; // no map restriction
};

export type QuestPanelQuest = {
  id: string;
  name: string;
  trader: string;
  kappa: boolean;
  objectives: QuestPanelObjective[];
  // Overall progress read from the in-game Tasks screen, if scanned
  percent?: number;
  // From in-raid notifications: all objectives done / N subtasks done
  ready?: boolean;
  subtasksDone?: number;
};

// A task the game lists but no catalog knows (Operational daily/weekly
// tasks), known only from scanning the Tasks screen
export type QuestPanelOperational = {
  name: string;
  percent: number;
  location: string;
};

export type QuestPanelData = {
  hasProgress: boolean;
  // All maps, for the map picker
  maps: { nameId: string; name: string }[];
  mapNameId: string | null;
  // True when the user picked a map instead of following the raid
  mapOverride: boolean;
  // True when the list comes from quests you actually accepted in-game
  // (read from the game's logs) rather than from computed availability
  fromGameLogs: boolean;
  mapName: string | null;
  inRaid: boolean;
  raidKind: "pmc" | "scav" | "unknown";
  // Quests with something to do on the current map
  here: QuestPanelQuest[];
  // Quests whose remaining objectives can be done on any map
  anywhere: QuestPanelQuest[];
  // Out of raid: how many active quests have objectives on each map
  perMap: { mapName: string; quests: number }[];
  operational: QuestPanelOperational[];
  scanned: { at: number; count: number } | null;
  // An image exists in the maps folder for this map (shows the Map button)
  hasMapImage?: boolean;
  updatedAt: number;
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

    const rawTasks = tasksResponse?.data?.tasks ?? [];
    const tasks = Array.isArray(rawTasks) ? rawTasks : Object.values(rawTasks);
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
        const tasksProgress = Array.isArray(data?.tasksProgress)
          ? data.tasksProgress
          : Object.values(data?.tasksProgress ?? {});
        for (const entry of tasksProgress as any[]) {
          if (entry?.id == null) continue;
          const id = String(entry.id);
          if (entry.complete === true) completedTaskIds.add(id);
          if (entry.failed === true) failedTaskIds.add(id);
          if (entry.invalid === true) invalidTaskIds.add(id);
        }

        const completedHideoutLevelIds = new Set<string>();
        const hideoutProgress = Array.isArray(data?.hideoutModulesProgress)
          ? data.hideoutModulesProgress
          : Object.values(data?.hideoutModulesProgress ?? {});
        for (const entry of hideoutProgress as any[]) {
          if (entry?.id != null && entry.complete === true) {
            completedHideoutLevelIds.add(String(entry.id));
          }
        }

        const objectiveProgress = new Map<
          string,
          { complete: boolean; count: number }
        >();
        const objectivesProgress = Array.isArray(data?.taskObjectivesProgress)
          ? data.taskObjectivesProgress
          : Object.values(data?.taskObjectivesProgress ?? {});
        for (const entry of objectivesProgress as any[]) {
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
    const rawTasks = tasksResponse?.data?.tasks ?? [];
    const tasks = Array.isArray(rawTasks) ? rawTasks : Object.values(rawTasks);

    const catalog: CatalogTask[] = tasks.map((task: any) => ({
      id: task.id,
      name: names[task.name] ?? task.name,
      traderId: task.trader ?? "",
      mapId: task.map ?? null,
      kappaRequired: task.kappaRequired === true,
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
    const raw = mapsResponse?.data?.maps ?? [];
    const list = Array.isArray(raw) ? raw : Object.values(raw);
    const maps: GameMap[] = list.map((m: any) => ({
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
    } catch (error) {
      log.warn("Failed to load trader names for quest panel:", error);
    }
    this.traderNamesByGameMode.set(gameMode, names);
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
    scan?: TaskScan | null
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

    const useLogs = !!questEvents && questEvents.size > 0;
    const empty: QuestPanelData = {
      hasProgress: !!progress || useLogs,
      fromGameLogs: useLogs,
      maps: maps
        .map((m) => ({ nameId: m.nameId, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      mapNameId: currentMap?.nameId ?? null,
      mapOverride: false,
      mapName: currentMap?.name ?? null,
      inRaid: state.inRaid,
      raidKind: state.raidKind,
      here: [],
      anywhere: [],
      perMap: [],
      operational: scan
        ? scan
            .getUnknownTasks()
            .filter((t) => t.percent < 100 && !/comple|done|fail/i.test(t.status))
            .map((t) => ({ name: t.name, percent: t.percent, location: t.location }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
      scanned: scan && scan.getLastScan().at ? scan.getLastScan() : null,
      updatedAt: Date.now(),
    };
    if (!progress && !useLogs) return empty;

    // Preferred: the quests you accepted in-game and have not handed in or
    // failed (from the game's own notifications). Fallback: what the task
    // graph says is unlocked, which over-counts storyline-gated quests.
    const active = useLogs
      ? catalog.filter((task) => {
          const ev = questEvents!.get(task.id);
          if (!ev || ev.status !== "started") return false;
          if (progress?.completedTaskIds.has(task.id)) return false;
          if (progress?.failedTaskIds.has(task.id)) return false;
          return true;
        })
      : catalog.filter((task) => this.taskStatus(task, progress!) === "active");
    const objectiveState = (id: string) => progress?.objectiveProgress.get(id);

    const toPanelQuest = (
      task: CatalogTask,
      objectiveFilter: (o: CatalogObjective) => boolean
    ): QuestPanelQuest | null => {
      const toast = scan?.toastFor(task.id, task.name);
      const objectives: QuestPanelObjective[] = task.objectives
        .filter(objectiveFilter)
        .map((o) => {
          const p = objectiveState(o.id);
          // Progress read off the Tasks screen for this row; a "find" objective
          // also counts what its "hand over" twin has already received
          const state = scan?.stateFor(task.id, o.text);
          const twin =
            o.type === "findItem"
              ? task.objectives.find((s) => s.type === "giveItem" && s.count === o.count)
              : undefined;
          const twinState = twin ? scan?.stateFor(task.id, twin.text) : undefined;
          const scannedCount = state?.total ? state.count ?? 0 : scan?.countFor(o.text)?.count ?? 0;
          const twinCount = twinState?.total ? twinState.count ?? 0 : 0;
          const scannedDone = state?.done === true || twinState?.done === true;
          const trackerCount = Math.min(p?.count ?? 0, o.count);
          const count = Math.min(o.count, Math.max(trackerCount, scannedCount, twinCount));
          return {
            id: o.id,
            text: o.text,
            done: p?.complete === true || scannedDone || (o.count > 0 && count >= o.count),
            count,
            total: o.count,
            optional: o.optional,
            here: currentMap ? o.mapIds.includes(currentMap.id) : false,
            anywhere: o.mapIds.length === 0,
          };
        });
      if (objectives.length === 0) return null;
      // Keep fully-done quests visible while they are "ready to be
      // completed" (hand-in pending), drop them otherwise
      if (objectives.every((o) => o.done) && !toast?.ready) return null;
      // Unfinished first, then done ones as feedback
      objectives.sort((a, b) => Number(a.done) - Number(b.done));
      const percent = scan?.percentFor(task.id);
      if (toast?.ready) {
        for (const o of objectives) {
          o.done = true;
          o.count = o.total;
        }
      } else if (toast && toast.subtasks > 0 && objectives.length === 1) {
        objectives[0].done = true;
        objectives[0].count = objectives[0].total;
      }
      // A single-objective quest's percent is its counter
      if (
        percent !== undefined &&
        objectives.length === 1 &&
        objectives[0].count === 0 &&
        objectives[0].total > 1
      ) {
        objectives[0].count = Math.min(
          objectives[0].total,
          Math.round((percent / 100) * objectives[0].total)
        );
      }
      return {
        id: task.id,
        name: task.name,
        trader: traderNames[task.traderId] ?? "",
        kappa: task.kappaRequired,
        objectives,
        percent,
        ready: toast?.ready || undefined,
        subtasksDone: toast?.subtasks || undefined,
      };
    };

    const here: QuestPanelQuest[] = [];
    const anywhere: QuestPanelQuest[] = [];
    const perMapCounts = new Map<string, number>();

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
        if (q && q.objectives.some((o) => o.here && !o.done)) {
          here.push(q);
          continue;
        }
      }
      const anyQ = toPanelQuest(
        task,
        (o) => inRaid(o) && o.mapIds.length === 0
      );
      if (anyQ) anywhere.push(anyQ);

      // Per-map summary for the out-of-raid view
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

    const byName = (a: QuestPanelQuest, b: QuestPanelQuest) =>
      a.trader.localeCompare(b.trader) || a.name.localeCompare(b.name);
    here.sort(byName);
    anywhere.sort(byName);

    return {
      ...empty,
      here,
      anywhere,
      perMap: [...perMapCounts.entries()]
        .map(([mapName, quests]) => ({ mapName, quests }))
        .sort(
          (a, b) => b.quests - a.quests || a.mapName.localeCompare(b.mapName)
        ),
    };
  }
}
