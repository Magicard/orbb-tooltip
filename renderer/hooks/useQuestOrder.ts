import React, { createContext, useCallback, useMemo, useRef, useState } from "react";
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

  // Cards keep the order the player gave them; anything new goes last
  const applyOrder = useCallback(
    (quests: QuestPanelQuest[]): QuestPanelQuest[] => {
      if (order.length === 0) return quests;
      const rank = new Map(order.map((id, i) => [id, i]));
      return [...quests].sort(
        (a, b) =>
          (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
    },
    [order]
  );

  const beginDrag = useCallback((questId: string) => {
    draggingRef.current = questId;
    setDraggingId(questId);
    // Seed from what is on screen so the first drag has something to
    // rearrange; after that we keep every id we have ever ordered
    if (orderRef.current.length === 0) {
      const onScreen = [...document.querySelectorAll<HTMLElement>(QUEST_ATTR)]
        .map((el) => el.dataset.questId ?? "")
        .filter(Boolean);
      orderRef.current = onScreen;
      setOrder(onScreen);
    }
  }, []);

  const cardProps = useCallback(
    (questId: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        draggedRef.current = false;
        const from = { x: e.clientX, y: e.clientY };

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

  // Stable identity, so a data push does not re-render every card
  const dragApi = useMemo<DragApi>(() => ({ draggingId, cardProps }), [draggingId, cardProps]);

  return { applyOrder, dragApi };
}
