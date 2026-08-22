import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import IpcConstants from "../../models/IpcConstants";
import { DragContext, useQuestOrder } from "../hooks/useQuestOrder";
import type {
  QuestPanelData,
  QuestPanelQuest,
  QuestPanelObjective,
} from "../../models/TaskData";
import type { QuestPanelBounds, QuestScanStatus } from "../../models/QuestPanelWindow";

// Slide-in quest tracker (think Questie for Tarkov). The main process sends
// the data; this window only draws it. It is click-through except while the
// cursor hovers it, when it takes the mouse: wheel scrolls the list, the top
// strip drags the panel up/down, the bottom-left corner resizes it, the map
// label opens a map picker and clicking a quest collapses it.

type Drag = {
  kind: "move" | "resize";
  startScreenX: number;
  startScreenY: number;
  startY: number;
  startHeight: number;
  startWidth: number;
};

const COLLAPSED_KEY = "orbb.questPanel.collapsed";
const SHOW_DONE_KEY = "orbb.questPanel.showDone";
type SectionKey = "map" | "anywhere";
// Where a change came from, at a glance
const CHANGE_MARKS = { scan: "\u25ce", game: "\u25cf", raid: "\u25b8", tracker: "\u21ba" } as const;
const CHANGE_COLOURS = {
  scan: "text-amber-500",
  game: "text-green-500",
  raid: "text-sky-400",
  tracker: "text-stone-500",
} as const;
const CHANGE_SOURCES = {
  scan: "Read off the Tasks screen",
  game: "From the game's own log",
  raid: "From an in-raid notification",
  tracker: "From TarkovTracker",
} as const;
// Whether finished objectives are listed (dimmed) or hidden
const ShowDoneContext = createContext(false);

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function QuestPanel() {
  const [data, setData] = useState<QuestPanelData | null>(null);
  const [visible, setVisible] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [showDone, setShowDone] = useState<boolean>(() => localStorage.getItem(SHOW_DONE_KEY) === "1");
  const [changesOpen, setChangesOpen] = useState(false);
  // Which section the list is showing at its top, so the one sticky bar can
  // name it - the map picker while you are in the map's quests, then
  // ANYWHERE, then OPERATIONAL. The done toggle rides along on its right.
  const [section, setSection] = useState<SectionKey>("map");
  const onListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const underBar = list.getBoundingClientRect().top + 26;
    let current: SectionKey = "map";
    for (const marker of list.querySelectorAll<HTMLElement>("[data-section]")) {
      if (marker.getBoundingClientRect().top <= underBar) {
        current = (marker.dataset.section as SectionKey) ?? current;
      }
    }
    setSection(current);
  };
  // Drag-to-reorder plus the saved order applied to a list
  const { applyOrder, dragApi } = useQuestOrder();
  const toggleShowDone = () => {
    setShowDone((previous) => {
      localStorage.setItem(SHOW_DONE_KEY, previous ? "0" : "1");
      return !previous;
    });
  };
  const [opacity, setOpacity] = useState(0.95);
  const [scanStatus, setScanStatus] = useState<QuestScanStatus | null>(null);
  const boundsRef = useRef<QuestPanelBounds | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.electron.receive(
      IpcConstants.QuestPanelData,
      (_event: unknown, next: QuestPanelData) => setData(next)
    );
    window.electron.receive(
      IpcConstants.QuestPanelVisibility,
      (_event: unknown, next: boolean) => {
        setVisible(next);
        if (!next) setPickerOpen(false);
      }
    );
    window.electron.receive(
      IpcConstants.QuestPanelBounds,
      (_event: unknown, next: QuestPanelBounds) => {
        boundsRef.current = next;
      }
    );
    window.electron.requestScanStatus();
    window.electron.receive(
      IpcConstants.QuestPanelScanStatus,
      (_event: unknown, status: QuestScanStatus) => setScanStatus(status)
    );
    window.electron
      .getUserConfig()
      .then((config) => {
        const saved = config?.questPanelOpacity;
        if (typeof saved === "number" && saved >= 0.3 && saved <= 1) {
          setOpacity(saved);
        }
      })
      .catch(() => undefined);
    // Wheel events relayed from the main process while the game hides the
    // cursor (see WheelHook); positive delta = wheel up
    // Ctrl+wheel from the helper: notches add to a target and the list
    // eases toward it every frame, so quick spins feel immediate yet not
    // jumpy (the browser's own smooth scroll restarts on every notch and
    // crawls)
    let target: number | null = null;
    let raf = 0;
    const step = () => {
      const list = listRef.current;
      if (!list || target === null) return;
      // The list can shrink mid-animation: keep the target reachable
      target = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, target));
      const remaining = target - list.scrollTop;
      if (Math.abs(remaining) < 1) {
        list.scrollTop = target;
        target = null;
        return;
      }
      const before = list.scrollTop;
      list.scrollTop += remaining * 0.45;
      if (list.scrollTop === before) {
        // Pinned by the browser: nothing more to do
        target = null;
        return;
      }
      raf = requestAnimationFrame(step);
    };
    window.electron.receive(
      IpcConstants.QuestPanelScroll,
      (_event: unknown, delta: number) => {
        const list = listRef.current;
        if (!list) return;
        const max = list.scrollHeight - list.clientHeight;
        const from = target ?? list.scrollTop;
        // One notch (120) moves about one quest card
        target = Math.max(0, Math.min(max, from - delta * 1.1));
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(step);
      }
    );
  }, []);

  const toggleCollapsed = (questId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(questId)) next.delete(questId);
      else next.add(questId);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const startDrag = (kind: Drag["kind"]) => (e: React.PointerEvent) => {
    const bounds = boundsRef.current;
    if (!bounds) return;
    dragRef.current = {
      kind,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startY: bounds.y,
      startHeight: bounds.height,
      startWidth: bounds.width,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onDragMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = e.screenY - drag.startScreenY;
    if (drag.kind === "move") {
      window.electron.setPanelBounds({ y: drag.startY + dy }, false);
    } else {
      // Bottom-left corner: dragging left widens (the panel hugs the right
      // edge), dragging down makes it taller
      const dx = drag.startScreenX - e.screenX;
      window.electron.setPanelBounds(
        { width: drag.startWidth + dx, height: drag.startHeight + dy },
        false
      );
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    // Persist the final position/size
    window.electron.setPanelBounds({}, true);
  };

  const scavWarning = data?.inRaid && data.raidKind === "scav";
  const mapLabel = data?.mapName
    ? data.mapOverride
      ? data.mapName
      : data.inRaid
        ? `On ${data.mapName}`
        : `Last raid: ${data.mapName}`
    : "Pick a map";

  const newTasks = scanStatus?.newTasks ? `${scanStatus.newTasks} new` : null;
  const scanner = scanStatus?.active
    ? {
        label: "Scanning",
        tone: "",
        title: undefined as string | undefined,
        detail: [`${scanStatus.tasks} tasks`, newTasks, plural(scanStatus.updates, "update"), `${scanStatus.secondsLeft}s`]
          .filter(Boolean)
          .join(" · "),
      }
    : scanStatus?.endedAt
      ? {
          label: "Scanner off",
          tone: scanStatus.updates > 0 ? "text-green-400" : "text-stone-500",
          title: "What the last scan changed" as string | undefined,
          detail: `last scan: ${[`${scanStatus.tasks} tasks`, newTasks, plural(scanStatus.updates, "update")]
            .filter(Boolean)
            .join(", ")}`,
        }
      : {
          label: "Scanner off",
          tone: "text-stone-600",
          title: undefined as string | undefined,
          detail: "open Tasks, click here",
        };

  return (
    <ShowDoneContext.Provider value={showDone}>
    <DragContext.Provider value={dragApi}>
    <div
      className={`group relative h-full w-full flex flex-col rounded-l-lg border border-stone-700 text-stone-200 font-['Bender'] tracking-wide transition-transform duration-[260ms] ease-out overflow-hidden ${
        visible ? "translate-x-0" : "translate-x-full"
      }`}
      style={{ backgroundColor: `rgba(28, 25, 23, ${opacity})` }}
    >
      {/* DRAG HANDLE */}
      <div
        className="shrink-0 h-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-stone-600 hover:text-stone-400 select-none"
        title="Drag to move"
        onPointerDown={startDrag("move")}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="text-[10px] leading-none tracking-[3px]">••••</span>
      </div>

      {/* TOP-LEFT BUTTONS */}
      <div className="absolute top-0.5 left-1.5 flex items-center gap-1">
        <button
          className="h-4 px-1.5 rounded text-[11px] leading-none text-stone-400 hover:text-white hover:bg-stone-700/70"
          title="Close the quest panel"
          onClick={() => window.electron.closePanel()}
        >
          ×
        </button>
        {data?.hasMapImage && (
          <button
            className="h-4 px-1.5 rounded text-[10px] uppercase tracking-wider leading-none text-stone-400 hover:text-white hover:bg-stone-700/70"
            title="Show / hide the map"
            onClick={() => window.electron.toggleMap()}
          >
            Map
          </button>
        )}
      </div>

      {/* OPACITY (top-right, shows on hover) */}
      <input
        type="range"
        min={0.3}
        max={1}
        step={0.05}
        value={opacity}
        title="Panel opacity"
        onChange={(e) => {
          const next = Number(e.target.value);
          setOpacity(next);
          window.electron.setPanelOpacity(next, false);
        }}
        onPointerUp={() => window.electron.setPanelOpacity(opacity, true)}
        onKeyUp={() => window.electron.setPanelOpacity(opacity, true)}
        className="orbb-slider absolute top-[8px] right-2.5 w-12 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      />

      {/* SCANNER STATE (always visible; click to start / stop) */}
      <div className="shrink-0 px-1.5 pb-1">
        <button
          className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider ${
            scanStatus?.active
              ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
              : "border-stone-700 bg-stone-800/50 text-stone-500 hover:text-stone-300 hover:border-stone-600"
          }`}
          title={
            scanStatus?.active
              ? "Reading the game's Tasks screen - click to stop"
              : "Read your progress off the game's Tasks screen"
          }
          onClick={() => window.electron.toggleScan()}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
              scanStatus?.active ? "bg-amber-400 animate-pulse" : "bg-stone-600"
            }`}
          />
          <span>{scanner.label}</span>
          <span
            className={`ml-auto tabular-nums normal-case tracking-normal ${scanner.tone}`}
            title={scanner.title}
          >
            {scanner.detail}
          </span>
        </button>
      </div>

      {scavWarning && (
        <div className="shrink-0 px-3 pb-1 text-[11px] text-amber-400" style={{ opacity }}>
          Scav raid - quest progress doesn't count
        </div>
      )}

      {/* LIST (dims with the slider along with the background) */}
      <div
        ref={listRef}
        onScroll={onListScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-3 [scrollbar-width:thin] [scrollbar-color:#57534e_transparent]"
        style={{ opacity }}
      >
        {data?.hasProgress && (
          <div className="sticky top-0 z-20 -mx-3 px-3 pt-1 pb-1 bg-[#1c1917] flex items-baseline gap-1.5">
            {section === "map" ? (
              <button
                className="text-[11px] uppercase tracking-widest text-stone-400 hover:text-white font-bold flex items-center gap-1.5"
                onClick={() => setPickerOpen((open) => !open)}
                title="Choose a map"
              >
                <span>{mapLabel}</span>
                {data.here.length > 0 && <span className="text-stone-600">{data.here.length}</span>}
                <span className="text-stone-500 text-[9px]">{pickerOpen ? "▲" : "▼"}</span>
              </button>
            ) : (
              <span className="text-[11px] uppercase tracking-widest text-stone-500 font-bold">
                Anywhere
                <span className="ml-1.5 text-stone-600">{data.anywhere.length}</span>
              </span>
            )}
            <button
              className={`ml-auto text-[11px] uppercase tracking-widest font-bold flex items-center gap-1 shrink-0 ${
                showDone ? "text-green-400 hover:text-green-300" : "text-stone-500 hover:text-stone-300"
              }`}
              onClick={toggleShowDone}
              title={showDone ? "Hide finished objectives" : "Show finished objectives"}
            >
              <span className="font-mono text-[11px]">✓</span>
              done
            </button>
          </div>
        )}

        {!data && <Hint>Loading quests...</Hint>}

        {data && !data.hasProgress && (
          <Hint>
            No quest data yet. Connect TarkovTracker in ORBB settings, or make
            sure the EFT logs folder setting points at your game's Logs
            directory.
          </Hint>
        )}

        {data && data.hasProgress && (
          <div data-section="map">

            {pickerOpen && (
              <div className="mb-2 rounded bg-stone-800 border border-stone-700 p-1 grid grid-cols-2 gap-0.5 text-sm">
                <button
                  className={`text-left px-2 py-0.5 rounded hover:bg-stone-700 ${
                    !data.mapOverride ? "text-green-400" : "text-stone-300"
                  }`}
                  onClick={() => {
                    window.electron.selectPanelMap(null);
                    setPickerOpen(false);
                  }}
                >
                  Follow my raid
                </button>
                {data.maps.map((m) => (
                  <button
                    key={m.nameId}
                    className={`text-left px-2 py-0.5 rounded hover:bg-stone-700 ${
                      data.mapOverride && m.nameId === data.mapNameId
                        ? "text-green-400"
                        : "text-stone-300"
                    }`}
                    onClick={() => {
                      window.electron.selectPanelMap(m.nameId);
                      setPickerOpen(false);
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}

            {data.mapName ? (
              <QuestList
                quests={applyOrder(data.here)}
                emptyText="Nothing to do here - enjoy the raid"
                collapsed={collapsed}
                onToggle={toggleCollapsed}
              />
            ) : (
              data.perMap.length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm px-1">
                  {data.perMap.map((m) => {
                    const map = data.maps.find((x) => x.name === m.mapName);
                    return (
                      <button
                        key={m.mapName}
                        className="flex justify-between text-left hover:text-white"
                        onClick={() =>
                          map && window.electron.selectPanelMap(map.nameId)
                        }
                      >
                        <span className="text-stone-300">{m.mapName}</span>
                        <span className="text-stone-500 tabular-nums">
                          {m.quests}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </div>
        )}

        {data && data.hasProgress && data.anywhere.length > 0 && (
          <div data-section="anywhere">
            <SectionTitle>
              Anywhere
              <span className="ml-1.5 text-stone-600">{data.anywhere.length}</span>
            </SectionTitle>
            <QuestList
              quests={applyOrder(data.anywhere)}
              emptyText=""
              collapsed={collapsed}
              onToggle={toggleCollapsed}
            />
          </div>
        )}

        {scanStatus?.active ? (
          <div className="text-[11px] text-amber-400 px-1 pt-1">
            Scroll and click through your tasks - what is on screen is what gets read.
          </div>
        ) : (
          data && (
            <div className="text-[11px] text-stone-500 px-1 pt-1">
              {data.scanned
                ? `Tasks screen scanned ${timeAgo(data.scanned.at)} (${data.scanned.count} tasks). `
                : "Open the game's Tasks screen and press ], then scroll and click through your tasks for ~45s. "}
            </div>
          )
        )}

        {/* WHAT CHANGED - from scans, the game's log and in-raid toasts */}
        {data && data.changes.length > 0 && (
          <div className="px-1 pb-1 space-y-0.5">
            {(changesOpen ? data.changes : data.changes.slice(0, 3)).map((c) => (
              <div key={`${c.at}-${c.text}`} className="text-[11px] leading-snug flex gap-1.5">
                <span className={`shrink-0 ${CHANGE_COLOURS[c.source]}`} title={CHANGE_SOURCES[c.source]}>
                  {CHANGE_MARKS[c.source]}
                </span>
                <span className="text-stone-400 min-w-0">{c.text}</span>
                <span className="ml-auto shrink-0 text-stone-600 tabular-nums">{timeAgo(c.at)}</span>
              </div>
            ))}
            {data.changes.length > 3 && (
              <button
                className="text-[10px] uppercase tracking-widest text-stone-600 hover:text-stone-400"
                onClick={() => setChangesOpen((open) => !open)}
              >
                {changesOpen ? "show less" : `show all ${data.changes.length}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* RESIZE GRIP (bottom-left corner: width + height) */}
      <div
        className="absolute left-0 bottom-0 w-5 h-5 cursor-nesw-resize flex items-end justify-start p-0.5 text-stone-600 hover:text-stone-300 select-none"
        title="Drag to resize"
        onPointerDown={startDrag("resize")}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <circle cx="2" cy="8" r="1" />
          <circle cx="5" cy="8" r="1" />
          <circle cx="2" cy="5" r="1" />
          <circle cx="8" cy="8" r="1" />
          <circle cx="5" cy="5" r="1" />
          <circle cx="2" cy="2" r="1" />
        </svg>
      </div>
    </div>
    </DragContext.Provider>
    </ShowDoneContext.Provider>
  );
}

// Middle-click opens a quest's wiki page, wherever it is drawn
function wikiProps(url: string) {
  return {
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button === 1) e.preventDefault(); // no autoscroll cursor
    },
    onAuxClick: (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        window.electron.openExternal(url);
      }
    },
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function timeAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-stone-400 px-1 py-2">{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-widest text-stone-500 font-bold mb-1 pt-1">
      {children}
    </div>
  );
}

function QuestList({
  quests,
  emptyText,
  collapsed,
  onToggle,
}: {
  quests: QuestPanelQuest[];
  emptyText: string;
  collapsed: Set<string>;
  onToggle: (questId: string) => void;
}) {
  if (quests.length === 0) {
    return emptyText ? <Hint>{emptyText}</Hint> : null;
  }
  return (
    <div className="space-y-1.5">
      {quests.map((q) => (
        <Quest
          key={q.id}
          quest={q}
          collapsed={collapsed.has(q.id)}
          onToggle={() => onToggle(q.id)}
        />
      ))}
    </div>
  );
}

function Quest({
  quest,
  collapsed,
  onToggle,
}: {
  quest: QuestPanelQuest;
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Finished objectives are hidden unless the "done" toggle is on. With it
  // on we also surface finished work from the rest of the quest (other maps,
  // hand-ins) - but only finished work: an outstanding hand-over step is not
  // part of this list and must not appear just because you asked to see what
  // is done.
  const showDone = useContext(ShowDoneContext);
  const visibleObjectives = (
    showDone
      ? [
          ...quest.objectives,
          ...quest.allObjectives.filter(
            (o) => o.done && !quest.objectives.some((shown) => shown.id === o.id)
          ),
        ]
      : quest.objectives.filter((o) => !o.done)
  ).sort((a, b) => a.order - b.order);
  // Every subtask done but not handed in yet (the logs would have removed
  // it otherwise): a green title and a DONE badge. Its objectives are all
  // finished, so they show only with the "done" toggle on - which is the
  // moment you want to see what led us to believe it.
  const finished = !!(quest.ready || quest.allDone);
  const drag = useContext(DragContext);
  return (
    <div
      data-quest-id={quest.id}
      // Click collapses, press and move reorders (see useQuestOrder)
      {...drag?.cardProps(quest.id)}
      {...wikiProps(quest.wiki)}
      className={`group/quest relative rounded bg-stone-800/70 px-2.5 py-1.5 select-none ${
        drag?.draggingId === quest.id
          ? "opacity-60 ring-1 ring-stone-500 cursor-grabbing"
          : "active:cursor-grabbing"
      }`}
    >
      <button
        className="w-full flex items-baseline gap-2 whitespace-nowrap overflow-hidden text-left"
        onClick={onToggle}
        title={quest.name}
      >
        <span className={`text-[15px] font-black truncate ${finished ? "text-green-400" : "text-white"}`}>
          {quest.name}
        </span>
        {quest.kappa && (
          <span
            className="text-[10px] font-bold text-amber-300 border border-amber-400/60 rounded px-1 leading-4"
            title="Required for Kappa"
          >
            K
          </span>
        )}
        <span className="ml-auto text-[11px] text-stone-500 shrink-0">
          {finished && (
            <span className="text-green-400 font-bold mr-1.5" title="Every objective is done - hand it in">DONE</span>
          )}
          {!finished && quest.doneHere && (
            <span className="text-green-500/80 font-bold mr-1.5" title="Nothing left to do on this list">DONE HERE</span>
          )}
          {!finished && quest.subtasksDone && (
            <span className="text-green-400 mr-1.5" title="Subtask completed this raid">
              ✓{quest.subtasksDone}
            </span>
          )}
          {quest.expiresAt !== undefined && <TimeLeft at={quest.expiresAt} />}
          {quest.percent !== undefined && (
            <span className="text-stone-300 tabular-nums mr-1.5">
              {quest.percent}%
            </span>
          )}
          {quest.trader}
        </span>
      </button>
      {!collapsed && visibleObjectives.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {visibleObjectives.map((o) => (
            <Objective key={o.id} objective={o} />
          ))}
        </div>
      )}
    </div>
  );
}

// How long a rotating Operational task has left, counted down live
function TimeLeft({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30 * 1000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.floor((at - Date.now()) / 60000);
  if (minutes < 0) return <span className="text-red-400 mr-1.5">expired</span>;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const left = days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  return (
    <span
      className={`tabular-nums mr-1.5 ${hours < 3 ? "text-amber-400" : "text-stone-400"}`}
      title="Time left before this task rotates out"
    >
      {left}
    </span>
  );
}

function Objective({ objective: o }: { objective: QuestPanelObjective }) {
  // White = still to do; finished ones (only listed with the "done" toggle
  // on) sit back in a darker grey
  const color = o.done ? "text-stone-500" : "text-stone-200";
  return (
    <div className={`flex items-start gap-1.5 text-[13px] leading-snug ${color}`}>
      <span className="mt-[3px] shrink-0 font-mono text-[11px]">
        {o.done ? "✓" : "○"}
      </span>
      <span className="min-w-0">
        {o.text}
        {o.optional && <span className="text-stone-500"> (optional)</span>}
      </span>
      {!o.done && o.total > 1 && (
        <span className="ml-auto shrink-0 text-stone-400 text-xs tabular-nums">
          {o.count}/{o.total}
        </span>
      )}
    </div>
  );
}
