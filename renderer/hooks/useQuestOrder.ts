import React, { createContext, useCallback, useRef, useState } from "react";
import type { QuestPanelQuest } from "../../models/TaskData";

// The order the player dragged their quests into, kept between sessions.
// A quest card is both a button and a drag handle: press and release without
// moving and it collapses, press and move and it reorders. The move and
// release handlers live on the window, so a drag survives the pointer
// leaving the card.

const ORDER_KEY = "orbb.questPanel.order";
const QUEST_ATTR = "[data-quest-id]";
// How far the pointer must travel before a press counts as a drag rather
// than a click
const DRAG_THRESHOLD_PX = 4;

function loadOrder(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export type DragApi = {
  draggingId: string | null;
  // Spread onto a quest card: makes the whole card draggable while leaving
  // its click (collapse) and middle-click (wiki) behaviour intact
  cardProps: (questId: string) => {
    onPointerDown: (e: React.PointerEvent) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
};

export const DragContext = createContext<DragApi | null>(null);

export function useQuestOrder(): {
  applyOrder: (quests: QuestPanelQuest[]) => QuestPanelQuest[];
  dragApi: DragApi;
} {
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const draggingRef = useRef<string | null>(null);
  // A drag just finished, so the click it produced is not a collapse
  const draggedRef = useRef(false);

  // Cards keep the order the player gave them. A quest that has never been
  // dragged keeps the place the list gave it, just after the last dragged
  // one above it - putting them all at the end instead would shuffle the
  // whole list the moment a single quest had been moved.
  const applyOrder = useCallback(
    (quests: QuestPanelQuest[]): QuestPanelQuest[] => {
      if (order.length === 0) return quests;
      const rank = new Map(order.map((id, i) => [id, i]));
      let previous = -1;
      const placed = quests.map((quest, i) => {
        const known = rank.get(quest.id);
        if (known !== undefined) previous = known;
        return { quest, at: known ?? previous + 0.5, i };
      });
      placed.sort((a, b) => a.at - b.at || a.i - b.i);
      return placed.map((p) => p.quest);
    },
    [order]
  );

  const beginDrag = useCallback((questId: string) => {
    draggingRef.current = questId;
    setDraggingId(questId);
    // Every card on screen has to be in the list before the drag starts:
    // reordering works by moving ids within it, so a quest missing from it
    // could be picked up but never actually go anywhere. Ones we have never
    // seen are slotted in where they currently sit, and ids we know but
    // cannot see (another map, a filtered-out quest) are left alone.
    const onScreen = [...document.querySelectorAll<HTMLElement>(QUEST_ATTR)]
      .map((el) => el.dataset.questId ?? "")
      .filter(Boolean);
    const next = [...orderRef.current];
    onScreen.forEach((id, i) => {
      if (next.includes(id)) return;
      let after = -1;
      for (let j = i - 1; j >= 0 && after < 0; j--) after = next.indexOf(onScreen[j]);
      next.splice(after + 1, 0, id);
    });
    if (next.length === orderRef.current.length) return;
    orderRef.current = next;
    setOrder(next);
  }, []);

  const cardProps = useCallback(
    (questId: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        draggedRef.current = false;
        const from = { x: e.clientX, y: e.clientY };

        // A quest can only be dragged within its own list; the sections are
        // separate lists and dropping into another one is not a thing
        const section = (e.target as HTMLElement).closest?.("[data-section]") ?? null;
        let lastY = from.y;
        const onMove = (move: PointerEvent) => {
          if (!draggingRef.current) {
            const far =
              Math.abs(move.clientX - from.x) > DRAG_THRESHOLD_PX ||
              Math.abs(move.clientY - from.y) > DRAG_THRESHOLD_PX;
            if (!far) return;
            beginDrag(questId);
          }
          const dragged = draggingRef.current;
          if (!dragged) return;
          const overEl = document
            .elementFromPoint(move.clientX, move.clientY)
            ?.closest<HTMLElement>(QUEST_ATTR);
          const over = overEl?.dataset.questId;
          const goingDown = move.clientY > lastY;
          if (Math.abs(move.clientY - lastY) >= 1) lastY = move.clientY;
          if (!overEl || !over || over === dragged) return;
          if (section && overEl.closest("[data-section]") !== section) return;

          // Swap only once the pointer is past the middle of the card it is
          // over, in the direction of travel. Swapping on mere overlap moves
          // the list out from under the cursor, which then lands on another
          // card and swaps again - the jumping you get with short cards.
          const box = overEl.getBoundingClientRect();
          const middle = box.top + box.height / 2;
          if (goingDown ? move.clientY < middle : move.clientY > middle) return;

          const next = [...orderRef.current];
          const at = next.indexOf(dragged);
          const to = next.indexOf(over);
          if (at < 0 || to < 0) return;
          next.splice(to, 0, ...next.splice(at, 1));
          orderRef.current = next;
          setOrder(next);
        };

        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          if (!draggingRef.current) return; // a plain click: let it through
          draggingRef.current = null;
          draggedRef.current = true;
          setDraggingId(null);
          localStorage.setItem(ORDER_KEY, JSON.stringify(orderRef.current));
          // The click this release produces is swallowed below - but only if
          // it lands on a card at all. Released over a gap there is no click
          // to swallow, and the flag would eat the next real one.
          setTimeout(() => {
            draggedRef.current = false;
          }, 0);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (!draggedRef.current) return;
        // The click that ends a drag must not collapse the card
        draggedRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
    [beginDrag]
  );

  return { applyOrder, dragApi: { draggingId, cardProps } };
}
