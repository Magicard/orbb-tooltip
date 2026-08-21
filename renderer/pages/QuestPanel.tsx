import React, { useEffect, useRef, useState } from "react";
import IpcConstants from "../../models/IpcConstants";
import type {
  QuestPanelData,
  QuestPanelQuest,
  QuestPanelObjective,
} from "../../models/TaskData";

// Slide-in quest tracker (think Questie for Tarkov). The main process sends
// the data; this window only draws it. It is click-through except while the
// cursor hovers it, when it takes the mouse: wheel scrolls the list, the top
// strip drags the panel up/down, the bottom-left corner resizes it, the map
// label opens a map picker and clicking a quest collapses it.

type Bounds = {
  y: number;
  height: number;
  width: number;
  minY: number;
  maxY: number;
  minHeight: number;
  maxHeight: number;
  minWidth: number;
  maxWidth: number;
};

type Drag = {
  kind: "move" | "resize";
  startScreenX: number;
  startScreenY: number;
  startY: number;
  startHeight: number;
  startWidth: number;
};

const COLLAPSED_KEY = "orbb.questPanel.collapsed";

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
  const [opacity, setOpacity] = useState(0.95);
  const boundsRef = useRef<Bounds | null>(null);
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
      (_event: unknown, next: Bounds) => {
        boundsRef.current = next;
      }
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
    window.electron.receive(
      IpcConstants.QuestPanelScroll,
      (_event: unknown, delta: number) => {
        listRef.current?.scrollBy({ top: -delta, behavior: "auto" });
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

  return (
    <div
      className={`group relative h-full w-full flex flex-col rounded-l-lg border border-stone-700 text-stone-200 font-['Bender'] tracking-wide transition-transform duration-[260ms] ease-out overflow-hidden ${
        visible ? "translate-x-0" : "translate-x-full"
      }`}
      style={{ backgroundColor: `rgba(28, 25, 23, ${opacity})` }}
      onMouseEnter={() => window.electron.setPanelInteractive(true)}
      onMouseLeave={() => {
        if (!dragRef.current) window.electron.setPanelInteractive(false);
      }}
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

      {scavWarning && (
        <div className="shrink-0 px-3 pb-1 text-[11px] text-amber-400" style={{ opacity }}>
          Scav raid - quest progress doesn't count
        </div>
      )}

      {/* LIST (dims with the slider along with the background) */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-3 [scrollbar-width:thin] [scrollbar-color:#57534e_transparent]"
        style={{ opacity }}
      >
        {!data && <Hint>Loading quests...</Hint>}

        {data && !data.hasProgress && (
          <Hint>
            No quest data yet. Connect TarkovTracker in ORBB settings, or make
            sure the EFT logs folder setting points at your game's Logs
            directory.
          </Hint>
        )}

        {data && data.hasProgress && (
          <div>
            {/* MAP PICKER */}
            <button
              className="text-[11px] uppercase tracking-widest text-stone-400 hover:text-white font-bold mb-1 pt-1 flex items-center gap-1.5"
              onClick={() => setPickerOpen((open) => !open)}
              title="Choose a map"
            >
              <span>{mapLabel}</span>
              {data.here.length > 0 && (
                <span className="text-stone-600">{data.here.length}</span>
              )}
              <span className="text-stone-500 text-[9px]">
                {pickerOpen ? "▲" : "▼"}
              </span>
            </button>

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
                quests={data.here}
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
          <div>
            <SectionTitle>
              Anywhere
              <span className="ml-1.5 text-stone-600">
                {data.anywhere.length}
              </span>
            </SectionTitle>
            <QuestList
              quests={data.anywhere}
              emptyText=""
              collapsed={collapsed}
              onToggle={toggleCollapsed}
            />
          </div>
        )}

        {data && data.operational.length > 0 && (
          <div>
            <SectionTitle>
              Operational
              <span className="ml-1.5 text-stone-600">
                {data.operational.length}
              </span>
            </SectionTitle>
            <div className="space-y-1.5">
              {data.operational.map((t) => (
                <div
                  key={t.name}
                  className="rounded bg-stone-800/70 px-2.5 py-1.5 flex items-baseline gap-2 whitespace-nowrap overflow-hidden"
                >
                  <span className="text-[15px] font-black text-white truncate">
                    {t.name}
                  </span>
                  <span className="ml-auto text-[11px] text-stone-500 shrink-0">
                    {t.location}
                  </span>
                  <span className="text-xs text-stone-300 tabular-nums shrink-0">
                    {t.percent}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data && (
          <div className="text-[11px] text-stone-500 px-1 pt-1">
            {data.scanned
              ? `Tasks screen scanned ${timeAgo(data.scanned.at)} (${data.scanned.count} tasks). `
              : "Open the game's Tasks screen and press ], then scroll and click through your tasks for ~45s. "}
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
  );
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
  const remaining = quest.objectives.filter((o) => !o.done).length;
  return (
    <div className="rounded bg-stone-800/70 px-2.5 py-1.5">
      <button
        className="w-full flex items-baseline gap-2 whitespace-nowrap overflow-hidden text-left"
        onClick={onToggle}
        title={collapsed ? "Click to expand" : "Click to collapse"}
      >
        <span className="text-[15px] font-black text-white truncate">
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
          {collapsed && remaining > 0 && (
            <span className="text-stone-400 mr-1.5">{remaining} to do</span>
          )}
          {quest.ready && (
            <span className="text-green-400 font-bold mr-1.5">READY</span>
          )}
          {!quest.ready && quest.subtasksDone && (
            <span className="text-green-400 mr-1.5" title="Subtask completed this raid">
              ✓{quest.subtasksDone}
            </span>
          )}
          {quest.percent !== undefined && (
            <span className="text-stone-300 tabular-nums mr-1.5">
              {quest.percent}%
            </span>
          )}
          {quest.trader}
        </span>
      </button>
      {!collapsed && (
        <div className="mt-0.5 space-y-0.5">
          {quest.objectives.map((o) => (
            <Objective key={o.id} objective={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function Objective({ objective: o }: { objective: QuestPanelObjective }) {
  // White = still to do, green = done
  const color = o.done ? "text-green-500" : "text-stone-200";
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
