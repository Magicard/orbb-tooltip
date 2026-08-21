import { hookstate } from "@hookstate/core";
import Item from "../../models/Item";
import IpcConstants from "../../models/IpcConstants";

// Wrapped in an object: hookstate's typing of a bare `Item | null` state
// collapses to `never`, which is why this used to be type-suppressed
export const TOOLTIP_ITEM = hookstate<{ item: Item | null }>({ item: null });

export async function setTooltipItem(item: Item | null) {
  TOOLTIP_ITEM.set({ item });
}

window.electron.receive(
  IpcConstants.NewTooltipItem,
  (_event: unknown, newItem: Item | null) => {
    setTooltipItem(newItem);
  }
);
