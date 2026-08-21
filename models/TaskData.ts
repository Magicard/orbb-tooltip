import log from "electron-log";
import { ItemTask } from "./Item";
import {
  fetchTarkovDevJson,
  TarkovDevTranslationsResponse,
} from "./tarkovDevApi";

// Roubles, dollars, euros - hideout upgrades and a few quests list these as
// "item requirements" but showing them on a currency's tooltip is nonsense
const CURRENCY_ITEM_IDS = new Set([
  "5449016a4bdc2d6f028b456f",
  "5696686a4bdc2da3298b456a",
  "569668774bdc2da2298b4568",
]);

// TarkovTracker progress API. The api.tarkovtracker.org gateway is primary;
// tarkovtracker.org serves the same route during its deprecation window.
// (tarkovtracker.io is the retired backend and rejects current tokens.)
const TRACKER_PROGRESS_URLS = [
  "https://api.tarkovtracker.org/api/v2/progress",
  "https://tarkovtracker.org/api/v2/progress",
];

// The gateway rejects requests whose User-Agent is shorter than 5 chars,
// and Electron's main-process fetch sends just "node"
const TRACKER_USER_AGENT =
  "flea-tooltip/1.0 (+https://github.com/Magicard/flea-tooltip)";

const TRACKER_TIMEOUT_MS = 15 * 1000;

type TarkovDevObjective = {
  id: string;
  type: string;
  count?: number;
  optional?: boolean;
  items?: string[];
  foundInRaid?: boolean;
};

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

// One task or hideout upgrade that consumes items
export type RequirementSource = {
  id: string;
  kind: "task" | "hideout";
  name: string;
  minPlayerLevel: number;
  // "Any" (or undefined) means both factions; otherwise "BEAR" / "USEC"
  factionName?: string;
  // Prerequisite tasks and the status(es) they must be in to unlock this one
  prerequisites: { taskId: string; statuses: string[] }[];
  stationId?: string;
  level?: number;
  // Other stations' levels that must be built first ("<stationId>-<level>")
  gateLevelIds: string[];
  items: { itemId: string; count: number; foundInRaid: boolean }[];
};

export type TrackerProgress = {
  completedTaskIds: Set<string>;
  failedTaskIds: Set<string>;
  // Tasks TarkovTracker has written off for this player (wrong faction,
  // closed quest branch, ...) - treated like completed, i.e. hidden
  invalidTaskIds: Set<string>;
  completedHideoutLevelIds: Set<string>;
  playerLevel: number;
  pmcFaction?: string;
  displayName?: string;
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
        // Hand-over and plant objectives are what consume inventory items.
        // Multi-item lists are "any of" choices (e.g. any stimulant) - too
        // noisy to show on every eligible item's tooltip; currency
        // hand-overs (e.g. "pay 100k roubles") are excluded like hideout costs
        if (
          (objective.type === "giveItem" || objective.type === "plantItem") &&
          !objective.optional &&
          objective.items?.length === 1 &&
          !CURRENCY_ITEM_IDS.has(objective.items[0])
        ) {
          items.push({
            itemId: objective.items[0],
            count: objective.count ?? 1,
            foundInRaid: objective.foundInRaid ?? false,
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
          log.warn(`TarkovTracker token rejected (${res.status})`);
          return { status: "unauthorized" };
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

        const progress: TrackerProgress = {
          completedTaskIds,
          failedTaskIds,
          invalidTaskIds,
          completedHideoutLevelIds,
          playerLevel:
            typeof data?.playerLevel === "number" ? data.playerLevel : 1,
          pmcFaction:
            typeof data?.pmcFaction === "string" ? data.pmcFaction : undefined,
          displayName:
            typeof data?.displayName === "string"
              ? data.displayName
              : undefined,
        };
        this.lastProgress = progress;
        return { status: "ok", progress };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
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
    };
  }

  // Build itemId -> ItemTask[] from the given sources, with per-entry
  // status when TarkovTracker progress is available
  buildItemTaskMap(
    sources: RequirementSource[],
    progress: TrackerProgress | null
  ): Map<string, ItemTask[]> {
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

      if (progress) {
        if (source.kind === "task") {
          status = this.taskStatus(source, progress);
        } else if (hideoutProgressUsable) {
          status = this.hideoutStatus(source, progress);
        }
      }

      for (const requirement of source.items) {
        const entry: ItemTask = {
          task: source.name,
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

  private taskStatus(
    source: RequirementSource,
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
}
