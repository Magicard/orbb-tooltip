import React, { useEffect, useRef, useState } from "react";
import IpcConstants from "../../models/IpcConstants";
import type { MapWindowData, MapWindowBounds } from "../../models/MapWindow";

// Floating map viewer. Wheel zooms around the cursor, drag pans, the top
// bar moves the window and the bottom-right corner resizes it. The window
// is click-through until hovered (same scheme as the quest panel).

type Drag =
  | { kind: "move"; startX: number; startY: number; winX: number; winY: number }
  | { kind: "resize"; startX: number; startY: number; width: number; height: number }
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

export function MapView() {
  const [data, setData] = useState<MapWindowData | null>(null);
  const [visible, setVisible] = useState(false);
  // Shares the quest panel's opacity slider
  const [opacity, setOpacity] = useState(0.95);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitted, setFitted] = useState<string | null>(null);
  const boundsRef = useRef<MapWindowBounds | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    window.electron.receive(IpcConstants.MapWindowData, (_e: unknown, next: MapWindowData) => setData(next));
    window.electron.receive(IpcConstants.MapWindowVisibility, (_e: unknown, next: boolean) => setVisible(next));
    window.electron.receive(IpcConstants.MapWindowBounds, (_e: unknown, next: MapWindowBounds) => {
      boundsRef.current = next;
    });
    window.electron.receive(IpcConstants.MapWindowOpacity, (_e: unknown, next: number) => {
      if (typeof next === "number" && next >= 0.3 && next <= 1) setOpacity(next);
    });
    window.electron
      .getUserConfig()
      .then((config) => {
        const saved = config?.questPanelOpacity;
        if (typeof saved === "number" && saved >= 0.3 && saved <= 1) setOpacity(saved);
      })
      .catch(() => undefined);
  }, []);

  // Fit the image to the viewport when a new map loads
  const fitImage = () => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image || !image.naturalWidth) return;
    const scale = Math.min(
      viewport.clientWidth / image.naturalWidth,
      viewport.clientHeight / image.naturalHeight
    );
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    setZoom(z);
    setPan({
      x: (viewport.clientWidth - image.naturalWidth * z) / 2,
      y: (viewport.clientHeight - image.naturalHeight * z) / 2,
    });
    setFitted(data?.imageUrl ?? null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    const ratio = next / zoom;
    // Keep the point under the cursor fixed
    setPan({ x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio });
    setZoom(next);
  };

  const startDrag = (drag: Drag) => (e: React.PointerEvent) => {
    dragRef.current = drag;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onDragMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.screenX - drag.startX;
    const dy = e.screenY - drag.startY;
    if (drag.kind === "move") {
      window.electron.setMapBounds({ x: drag.winX + dx, y: drag.winY + dy }, false);
    } else if (drag.kind === "resize") {
      window.electron.setMapBounds({ width: drag.width + dx, height: drag.height + dy }, false);
    } else {
      setPan({ x: drag.panX + dx, y: drag.panY + dy });
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (drag.kind !== "pan") window.electron.setMapBounds({}, true);
  };

  const bounds = () => boundsRef.current ?? { x: 0, y: 0, width: 800, height: 600 };

  return (
    <div
      className="relative h-full w-full flex flex-col rounded-lg border border-stone-700 bg-stone-900 text-stone-200 font-['Bender'] tracking-wide overflow-hidden transition-opacity duration-150"
      style={{ opacity: visible ? opacity : 0 }}
    >
      {/* TITLE BAR (drag to move) */}
      <div
        className="shrink-0 h-7 flex items-center gap-2 px-2 cursor-grab active:cursor-grabbing select-none bg-stone-800/80 border-b border-stone-700"
        onPointerDown={(e) =>
          startDrag({ kind: "move", startX: e.screenX, startY: e.screenY, winX: bounds().x, winY: bounds().y })(e)
        }
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="text-[10px] text-stone-500 tracking-[3px]">••••</span>
        <span className="text-sm font-black text-white">{data?.mapName ?? "Map"}</span>
        <span className="ml-auto text-[11px] text-stone-500 tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          className="text-[11px] text-stone-400 hover:text-white px-1"
          title="Fit to window"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={fitImage}
        >
          fit
        </button>
        <button
          className="text-sm text-stone-400 hover:text-white px-1 leading-none"
          title="Close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => window.electron.closeMap()}
        >
          ×
        </button>
      </div>

      {/* VIEWPORT */}
      <div
        ref={viewportRef}
        className="relative flex-1 min-h-0 overflow-hidden cursor-move bg-[#141210]"
        onWheel={onWheel}
        onPointerDown={(e) =>
          startDrag({ kind: "pan", startX: e.screenX, startY: e.screenY, panX: pan.x, panY: pan.y })(e)
        }
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={fitImage}
      >
        {data?.imageUrl ? (
          <img
            ref={imageRef}
            src={data.imageUrl}
            alt={data.mapName ?? "map"}
            draggable={false}
            onLoad={() => {
              if (fitted !== data.imageUrl) fitImage();
            }}
            className="absolute top-0 left-0 max-w-none select-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              imageRendering: zoom > 2 ? "pixelated" : "auto",
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-stone-400 px-6">
            {data?.mapName
              ? `No image for ${data.mapName} yet - add maps/${(data.mapNameId ?? "").toLowerCase()}.png`
              : "Open the quest panel and pick a map"}
          </div>
        )}
      </div>

      {/* RESIZE GRIP */}
      <div
        className="absolute right-0 bottom-0 w-5 h-5 cursor-nwse-resize flex items-end justify-end p-0.5 text-stone-600 hover:text-stone-300 select-none"
        title="Drag to resize"
        onPointerDown={(e) =>
          startDrag({ kind: "resize", startX: e.screenX, startY: e.screenY, width: bounds().width, height: bounds().height })(e)
        }
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <circle cx="8" cy="8" r="1" />
          <circle cx="5" cy="8" r="1" />
          <circle cx="8" cy="5" r="1" />
          <circle cx="2" cy="8" r="1" />
          <circle cx="5" cy="5" r="1" />
          <circle cx="8" cy="2" r="1" />
        </svg>
      </div>
    </div>
  );
}
