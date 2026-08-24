export default class Item {
  id: string;
  name: string;
  shortName: string;
  availableOnFleaMarket: boolean;
  prices: ItemPrices;
  slots: number;
  tasks: ItemTask[];
  icon: string;
  // BSG/tarkov.dev item id; differs from id only on the Tarkov Market
  // path (whose uid is its own scheme). Used to look up quest/hideout data
  bsgId?: string;
  // Character level the flea market gates this item behind, when it gates
  // it at all ("Trading items of this type becomes available at level 25")
  fleaUnlockLevel?: number;
}

type ItemPrices = {
  latest: number;
  avgDay: number;
  avgWeek?: number;
  trader: TraderPrice;
};

type TraderPrice = {
  name: string;
  price: number;
};

export type ItemTask = {
  task: string;
  count: number;
  inRaid: boolean;
  // "task" (quest) or "hideout" (station upgrade); older data had neither
  kind?: "task" | "hideout";
  // Set when TarkovTracker progress is linked: done = already completed,
  // active = requirement is currently doable, locked = future content
  status?: "done" | "active" | "locked";
};

export class ClientItem extends Item {
  count: number;
  mostRecentlyAddedItem: boolean;

  constructor(item: Item) {
    super();
    this.availableOnFleaMarket = item.availableOnFleaMarket;
    this.id = item.id;
    this.name = item.name;
    this.prices = item.prices;
    this.shortName = item.shortName;
    this.slots = item.slots;
    this.tasks = item.tasks;
    this.count = 1;
    this.mostRecentlyAddedItem = false;
    this.icon = item.icon;
    this.fleaUnlockLevel = item.fleaUnlockLevel;
  }
}
