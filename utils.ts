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

export function getItemsPricePerSlot(item: Item): number {
  const fleaPricePerSlot = Math.ceil(
    item.prices.avgDay > item.prices.latest
      ? item.prices.latest / item.slots
      : item.prices.avgDay / item.slots
  );
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
