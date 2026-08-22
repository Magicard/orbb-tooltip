import Item from "./models/Item";

export function isDev() {
  return process.env["WEBPACK_SERVE"] === "true";
}

export function numberWithCommas(x: number | null | undefined) {
  if (x === undefined || x === null) {
    return x;
  }

  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// What an item is worth on the flea market: the 24-hour average, which is
// the fairest single number for a price that can swing by a factor of two in
// a day. (`latest` - the cheapest offer tarkov.dev last saw - is the
// fallback, and is what you would have to undercut to sell instantly.)
export function fleaPrice(item: {
  availableOnFleaMarket: boolean;
  prices: { avgDay: number; latest: number };
}): number {
  if (!item.availableOnFleaMarket) return 0;
  return item.prices.avgDay || item.prices.latest || 0;
}

export function getItemsPricePerSlot(item: Item): number {
  const fleaPricePerSlot = Math.ceil(fleaPrice(item) / item.slots);
  let price = fleaPricePerSlot;

  const traderPricePerSlot = item?.prices?.trader?.price > 0 ? Math.ceil(item.prices.trader.price / item.slots) : 0;

  if (!item.availableOnFleaMarket || traderPricePerSlot > price) {
    price = traderPricePerSlot;
  }

  return price;
}

export function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}
