import Item, { ItemTask } from "./Item";
import MiniSearch, { SearchResult } from "minisearch";
import TarkovMarketItem from "./TarkovMarketItem";
import TaskData, { TrackerProgress, QuestEventMap } from "./TaskData";
import {
  fetchTarkovDevJson,
  TarkovDevTranslationsResponse,
} from "./tarkovDevApi";
import log from "electron-log";
import { GameMode } from "./UserConfig";

// Item data comes from the flat-file JSON API that powers tarkov.dev
// itself. The old GraphQL API (api.tarkov.dev/graphql) has been
// unavailable since 2026-07; the maintainers point consumers here instead:
// https://github.com/the-hideout/tarkov-api/issues/474

type TarkovDevTraderOffer = {
  trader: string;
  price: number;
  priceRUB: number;
  currency: string;
};

type TarkovDevItem = {
  id: string;
  name: string;
  shortName: string;
  width: number;
  height: number;
  avg24hPrice: number | null;
  lastLowPrice: number | null;
  iconLink: string;
  types: string[];
  sellToTrader: TarkovDevTraderOffer[];
};

type TarkovDevItemsResponse = {
  data: {
    items: Record<string, TarkovDevItem>;
  };
};

type TarkovDevTradersResponse = {
  data: Record<string, { id: string; name: string }>;
};

export default class Items {
  items: Item[];
  searchIndex: MiniSearch;
  taskData: TaskData = new TaskData();
  // Accepted / handed-in quests from the game's logs, when available
  private questEvents: QuestEventMap | null = null;
  private lastGameMode: GameMode = "regular";
  // Incremented on every fetch so a slow, older request can never
  // overwrite the results of a newer one (e.g. PvE toggle vs 15-min timer)
  private fetchGeneration = 0;

  constructor() {
    this.items = [];
  }

  async fetchItems(
    apiKey?: string,
    gameMode: GameMode = "regular",
    tarkovTrackerApiToken?: string
  ): Promise<void> {
    const tarkovMarketApiKey = apiKey || "";
    const generation = ++this.fetchGeneration;
    this.lastGameMode = gameMode;

    // Quest/hideout requirements load in parallel with the items and are
    // attached afterwards; failures there never block price data
    const itemTasksPromise = this.getItemTasksMap(
      gameMode,
      tarkovTrackerApiToken
    );

    try {
      if (tarkovMarketApiKey.trim() !== "") {
        console.log("Using Tarkov Market API key for item fetch");

        const res = await fetch(
          "https://api.tarkov-market.app/api/v1/items/all",
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "x-api-key": tarkovMarketApiKey,
            },
          }
        );

        if (!(res.status == 200 || res.status == 204)) {
          throw new Error("Failed to fetch items");
        }

        const data: TarkovMarketItem[] = await res.json();
        const formattedData: Item[] = data.map((item: TarkovMarketItem) => {
          return {
            id: item.uid,
            bsgId: item.bsgId,
            name: item.name,
            shortName: item.shortName,
            availableOnFleaMarket: !item.bannedOnFlea,
            slots: item.slots,
            prices: {
              latest: item.price,
              avgDay: item.avg24hPrice,
              avgWeek: item.avg7daysPrice,
              trader: {
                name: item.traderName,
                price: item.traderPriceRub,
              },
            },
            tasks: [] as ItemTask[],
            icon: item.icon,
          };
        });

        if (generation !== this.fetchGeneration) return;
        this.items = formattedData;
      } else {
        console.log("No API key provided, fetching items from tarkov.dev");
        const itemsFromApi = await this.getItemsPromise(gameMode);
        console.log(itemsFromApi.length + " items fetched from API");
        if (generation !== this.fetchGeneration) return;
        this.items = itemsFromApi;
      }
      // Not awaited: a slow TarkovTracker call must not delay price data
      void this.attachItemTasks(itemTasksPromise, generation);
    } catch (error) {
      console.error("Failed to fetch items:", error);

      // If Tarkov Market API fails and we have an API key, don't fall back
      // If we don't have an API key, we already tried Tarkov.dev above
      if (tarkovMarketApiKey.trim() === "") {
        throw new Error("Failed to fetch items from API");
      }

      // Try Tarkov.dev as fallback when API key fails
      try {
        console.log("Falling back to tarkov.dev API");
        const itemsFromApi = await this.getItemsPromise(gameMode);
        console.log(itemsFromApi.length + " items fetched from API");
        if (generation !== this.fetchGeneration) return;
        this.items = itemsFromApi;
        void this.attachItemTasks(itemTasksPromise, generation);
      } catch (fallbackError) {
        console.error(
          "Failed to fetch items from tarkov.dev API:",
          fallbackError
        );
        throw new Error("Failed to fetch items from API");
      }
    }
  }

  async getItemsPromise(gameMode: GameMode = "regular"): Promise<Item[]> {

    const [itemsResponse, itemTranslations, traderNamesById] =
      await Promise.all([
        fetchTarkovDevJson<TarkovDevItemsResponse>(`/${gameMode}/items`),
        fetchTarkovDevJson<TarkovDevTranslationsResponse>(`/${gameMode}/items_en`),
        this.getTraderNames(gameMode),
      ]);

    if (!itemsResponse?.data?.items) {
      throw new Error(
        "Unexpected response shape from tarkov.dev items endpoint"
      );
    }

    const itemNames = itemTranslations?.data ?? {};

    const formattedData: Item[] = Object.values(itemsResponse.data.items).map(
      (item: TarkovDevItem) => {
        // Highest RUB-equivalent trader sell offer, mirroring the old
        // "best non-flea vendor" logic from the GraphQL API
        const bestTraderOffer = (item.sellToTrader ?? [])
          .map((offer) => ({
            name: traderNamesById[offer.trader],
            price: offer.priceRUB ?? 0,
          }))
          .filter((offer) => offer.name)
          .sort((a, b) => b.price - a.price)[0] ?? {
          name: "N/A",
          price: 0,
        };

        return {
          id: item.id,
          name: itemNames[`${item.id} Name`] ?? item.name,
          shortName: itemNames[`${item.id} ShortName`] ?? item.shortName,
          // The old GraphQL API only listed a "Flea Market" vendor when the
          // item was not flea-banned AND had a real price, so keep both
          // conditions or items with no price data show a bogus 0 flea price
          availableOnFleaMarket:
            !(item.types ?? []).includes("noFlea") && item.lastLowPrice != null,
          prices: {
            // The cheapest offer tarkov.dev last saw, and the 24h average.
            // Collapsing both onto avg24hPrice (as the API migration did)
            // threw away the only "what it goes for right now" figure.
            latest: item.lastLowPrice ?? item.avg24hPrice ?? 0,
            avgDay: item.avg24hPrice ?? item.lastLowPrice ?? 0,
            trader: bestTraderOffer,
          },
          slots: item.width * item.height,
          tasks: [] as ItemTask[],
          icon: item.iconLink,
        };
      }
    );

    console.log(formattedData.length + " items loaded");
    return formattedData;
  }

  // Never rejects - quest/hideout data is an enhancement, not a dependency
  async getItemTasksMap(
    gameMode: string,
    tarkovTrackerApiToken?: string
  ): Promise<Map<string, ItemTask[]> | null> {
    try {
      const token = (tarkovTrackerApiToken ?? "").trim();
      const [sources, progress] = await Promise.all([
        this.taskData.loadSources(gameMode),
        token ? this.taskData.getProgress(token) : Promise.resolve(null),
      ]);
      return this.taskData.buildItemTaskMap(sources, progress, this.questEvents);
    } catch (error) {
      log.warn("Failed to load quest/hideout data:", error);
      return null;
    }
  }

  // Called when the log watcher learns about accepted/finished quests;
  // re-annotates the loaded items without any network traffic
  async setQuestEvents(questEvents: QuestEventMap | null): Promise<void> {
    this.questEvents = questEvents;
    if (this.items.length === 0) return;
    try {
      const sources = await this.taskData.loadSources(this.lastGameMode);
      const taskMap = this.taskData.buildItemTaskMap(
        sources,
        this.taskData.getLastProgress(),
        this.questEvents
      );
      for (const item of this.items) {
        item.tasks = taskMap.get(item.bsgId ?? item.id) ?? [];
      }
    } catch (error) {
      log.warn("Failed to re-annotate items with quest events:", error);
    }
  }

  // Re-pull TarkovTracker progress only (no price refetch) and re-annotate
  // the items; used right after a raid ends
  async refreshTrackerProgress(
    gameMode: GameMode,
    tarkovTrackerApiToken?: string
  ): Promise<TrackerProgress | null> {
    const token = (tarkovTrackerApiToken ?? "").trim();
    if (!token) return null;
    try {
      const [sources, progress] = await Promise.all([
        this.taskData.loadSources(gameMode),
        this.taskData.getProgress(token),
      ]);
      const taskMap = this.taskData.buildItemTaskMap(
        sources,
        progress,
        this.questEvents
      );
      for (const item of this.items) {
        item.tasks = taskMap.get(item.bsgId ?? item.id) ?? [];
      }
      return progress;
    } catch (error) {
      log.warn("Failed to refresh TarkovTracker progress:", error);
      return null;
    }
  }

  async attachItemTasks(
    itemTasksPromise: Promise<Map<string, ItemTask[]> | null>,
    generation: number
  ): Promise<void> {
    const taskMap = await itemTasksPromise;
    if (!taskMap || generation !== this.fetchGeneration) return;

    for (const item of this.items) {
      item.tasks = taskMap.get(item.bsgId ?? item.id) ?? [];
    }
  }

  async getTraderNames(gameMode: string): Promise<Record<string, string>> {
    const traderNamesById: Record<string, string> = {};

    // Trader names are display-only; if this fails, still serve item prices
    // (trader offers fall back to "N/A") rather than failing the whole fetch
    try {
      const [tradersResponse, traderTranslations] = await Promise.all([
        fetchTarkovDevJson<TarkovDevTradersResponse>(`/${gameMode}/traders`),
        fetchTarkovDevJson<TarkovDevTranslationsResponse>(
          `/${gameMode}/traders_en`
        ),
      ]);

      const translated = traderTranslations?.data ?? {};

      for (const trader of Object.values(tradersResponse?.data ?? {})) {
        if (trader?.id) {
          // trader.name holds a translation key like "<id> Nickname"
          traderNamesById[trader.id] = translated[trader.name];
        }
      }
    } catch (error) {
      console.error("Failed to fetch trader names, continuing without:", error);
    }

    return traderNamesById;
  }

  initializeSearchIndex(): void {
    if (!this.itemsAreLoaded()) {
      throw new Error(
        "Can't create search index for items, no items have been loaded"
      );
    }

    this.searchIndex = new MiniSearch({
      fields: ["name", "shortName"], // fields to index for full-text search
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
        boost: {
          shortName: 1.5,
        },
      },
    });

    this.searchIndex.addAll(this.items);
  }

  search(searchQuery: string, lowestAcceptableScore = 0): Item {
    const searchResults = this.searchIndex.search(searchQuery);

    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    const topResult: SearchResult = searchResults[0];
    const item = this.getItemById(topResult.id);

    console.log(
      `Search for "${searchQuery}" returned top result: "${item.name}" with score ${topResult.score} with a max score of ${lowestAcceptableScore}`
    );
    if (
      topResult.score <= lowestAcceptableScore &&
      searchQuery.trim().toLowerCase() !== item.name.trim().toLowerCase()
    ) {
      return null;
    }

    return item;
  }

  getItemById(id: string): Item {
    if (!this.itemsAreLoaded()) {
      throw new Error("Can't get items, no items have been loaded");
    }

    const itemsMatchedByFilter: Item[] = this.items.filter(
      (item) => item.id === id
    );

    if (itemsMatchedByFilter.length === 0) {
      return null;
    }

    return itemsMatchedByFilter[0];
  }

  itemsAreLoaded(): boolean {
    if (!this.items || this.items.length === 0) {
      return false;
    }

    return true;
  }
}
