export default class Item {
  id: string;
  name: string;
  shortName: string;
  availableOnFleaMarket: boolean;
  prices: ItemPrices;
  slots: number;
  tasks: ItemTask[];
  icon: string;
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
  }
}
