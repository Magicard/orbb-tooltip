import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import { TOOLTIP_ITEM } from "../state/tooltipItem";
import { useHookstate } from "@hookstate/core";
import { fleaPrice, numberWithCommas } from "../../utils";
import { ItemTask } from "../../models/Item";
import IpcConstants from "../../models/IpcConstants";
import {
  ARMOR_CLASSES,
  ammoStatsFor,
  gradeStyle,
  tierLabel,
} from "../../models/ammoEffectiveness";

// Quest/hideout requirements arrive on the item itself (Item.tasks),
// built in the main process from live json.tarkov.dev data and, when a
// TarkovTracker token is configured, annotated with the player's progress

const MAX_TASK_ROWS = 9;

export function Tooltip() {
  const tooltipItem = useHookstate(TOOLTIP_ITEM);
  const item = tooltipItem.get().item;
  const [showPerSlotPrice, setShowPerSlotPrice] = useState(true);
  // From TarkovTracker, when linked; null means "unknown", which never greys
  const [playerLevel, setPlayerLevel] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.electron.receive(
      IpcConstants.ProfileInfo,
      (_event: unknown, info: { playerLevel: number | null }) => {
        setPlayerLevel(info?.playerLevel ?? null);
      }
    );
  }, []);

  // Tell the main process how big the rendered tooltip really is so it can
  // keep it on-screen without guessing (runs after every visible change)
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (item && el) {
      window.electron.reportTooltipSize({
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
    }
  });

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await window.electron.getUserConfig();
        setShowPerSlotPrice(config.showPerSlotPrice ?? true);
      } catch (error) {
        console.error("Failed to load tooltip config:", error);
      }
    };
    loadConfig();

    // Listen for config changes
    const handleConfigChange = (config: any) => {
      setShowPerSlotPrice(config.showPerSlotPrice ?? true);
    };

    window.electron.onConfigChanged(handleConfigChange);

    // Cleanup
    return () => {
      // Note: electron.onConfigChanged doesn't provide a cleanup method,
      // but this is fine for a tooltip window lifecycle
    };
  }, []);

  // Completed requirements are hidden - the item no longer matters for them
  const itemTasks = useMemo(() => {
    return (item?.tasks ?? []).filter((task) => task.status !== "done");
  }, [item]);

  // Null for anything that is not ammo we hold a chart for; a bare map
  // lookup, cheaper than memoising it
  const ammo = item ? ammoStatsFor(item) : null;

  if (item) {
    const fleaPriceToUse = fleaPrice(item);
    const traderPrice = item?.prices?.trader?.price > 0 ? item.prices.trader.price : 0;
    // Per-slot value only matters for items bigger than one cell
    const perSlot = showPerSlotPrice && item.slots > 1;
    const fleaPricePerSlot = Math.ceil(fleaPriceToUse / item.slots);
    const traderPricePerSlot = Math.ceil(traderPrice / item.slots);

    const visibleTasks = itemTasks.slice(0, MAX_TASK_ROWS);
    const hiddenTaskCount = itemTasks.length - visibleTasks.length;
    // The flea gates some item types behind character level; a price the
    // character cannot trade at yet is still shown, but dimmed and marked
    const fleaLocked =
      playerLevel !== null &&
      item.fleaUnlockLevel !== undefined &&
      playerLevel < item.fleaUnlockLevel;

    // The measured element is the row, so the reported size covers both boxes
    return (
      <div ref={rootRef} className="flex items-start gap-1 w-fit h-fit">
        <div className="block items-center p-1.5 bg-stone-900/95 border border-stone-700 rounded h-fit w-fit text-sm text-stone-300 font-['Bender'] font-black tracking-wide overflow-y-hidden">
          {/* ITEM NAME */}
          <div className="w-fit whitespace-nowrap text-[15px] text-white">
            {item.shortName}
          </div>

          {/* FLEA MARKET: what the whole item is worth, then per slot */}
          <div className="whitespace-nowrap">
            {item.availableOnFleaMarket ? (
              fleaLocked ? (
                <span className="text-stone-500 tracking-wider">
                  <span className="font-['Nunito']">₽</span>
                  {numberWithCommas(fleaPriceToUse)}
                  <span className="ml-1 text-[12px]">
                    (lvl {item.fleaUnlockLevel})
                  </span>
                </span>
              ) : (
                <>
                  <span className="tracking-wider">
                    <span className="font-['Nunito']">₽</span>
                    {numberWithCommas(fleaPriceToUse)}
                  </span>
                  {perSlot && (
                    <span className="ml-1.5 text-[12px] text-stone-500 tracking-wider">
                      <span className="font-['Nunito']">₽</span>
                      {numberWithCommas(fleaPricePerSlot)}/slot
                    </span>
                  )}
                </>
              )
            ) : (
              <span className="text-stone-400">Unavailable on Flea</span>
            )}
          </div>

          {/* TRADER PRICE */}
          <div className="whitespace-nowrap">
            <span className="tracking-wider">
              <span className="font-['Nunito']">₽</span>
              {numberWithCommas(traderPrice)}
            </span>
            <span className="capitalize">
              <span className="mr-1"></span>(
              {item.prices?.trader?.name ?? "N/A"})
            </span>
            {perSlot && traderPrice > 0 && (
              <span className="ml-1.5 text-[12px] text-stone-500 tracking-wider">
                <span className="font-['Nunito']">₽</span>
                {numberWithCommas(traderPricePerSlot)}/slot
              </span>
            )}
          </div>

          {/* TASKS & HIDEOUT */}
          {visibleTasks.map((task, index) => (
            <TooltipTask key={index} task={task} />
          ))}
          {hiddenTaskCount > 0 && (
            <div className="whitespace-nowrap text-stone-500">
              +{hiddenTaskCount} more
            </div>
          )}
        </div>
        {ammo && <AmmoArmor ratings={ammo.classes} />}
        {ammo && (
          <AmmoDamage
            damage={ammo.damage}
            projectiles={ammo.projectiles}
            tier={ammo.damageTier}
          />
        )}
      </div>
    );
  }

  return <div></div>;
}

// How the round does against each armour class, 1 at the top through 6, in
// the same colours the chart these numbers come from uses
function AmmoArmor({ ratings }: { ratings: readonly number[] }) {
  return (
    <div className="p-1.5 bg-stone-900/95 border border-stone-700 rounded h-fit w-fit text-sm text-stone-300 font-['Bender'] font-black tracking-wide">
      <div className="whitespace-nowrap text-[11px] text-stone-500 leading-tight">
        ARMOR
      </div>
      {ARMOR_CLASSES.map((armorClass, index) => {
        const { bg, fg } = gradeStyle(ratings[index]);
        return (
          <div key={armorClass} className="flex items-center gap-1 mt-0.5">
            <span className="w-5 text-right text-[12px] text-stone-400">
              {armorClass}
            </span>
            <span
              className="w-4 text-center text-[12px] rounded-sm leading-tight"
              style={{ backgroundColor: bg, color: fg }}
            >
              {tierLabel(ratings[index])}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Buckshot and flechette are quoted the way the game quotes them, per pellet.
// The tier grades the whole shot against the rest of its calibre, so the
// hardest-hitting round a gun can fire reads S even if nothing it hits is
// wearing armour.
function AmmoDamage({
  damage,
  projectiles,
  tier,
}: {
  damage: number;
  projectiles: number;
  tier: number;
}) {
  const { bg, fg } = gradeStyle(tier);

  return (
    <div className="p-1.5 bg-stone-900/95 border border-stone-700 rounded h-fit w-fit text-sm text-stone-300 font-['Bender'] font-black tracking-wide">
      <div className="whitespace-nowrap text-[11px] text-stone-500 leading-tight">
        DMG
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className="whitespace-nowrap text-[15px] text-white leading-tight">
          {projectiles > 1 ? `${projectiles}×${damage}` : damage}
        </span>
        <span
          className="w-4 text-center text-[12px] rounded-sm leading-tight"
          style={{ backgroundColor: bg, color: fg }}
        >
          {tierLabel(tier)}
        </span>
      </div>
    </div>
  );
}

function TooltipTask({ task }: { task: ItemTask }) {
  // Progress-aware coloring (needs a TarkovTracker token, neutral without):
  // green = requirement is currently doable, dim = locked behind other
  // quests/levels ("done" entries are filtered out before rendering)
  const colorClass =
    task.status === "active"
      ? "text-green-400"
      : task.status === "locked"
        ? "text-stone-500"
        : "";

  return (
    <div className={`flex items-center whitespace-nowrap ${colorClass}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        {task.inRaid ? <polyline points="22 4 12 14.01 9 11.01" /> : null}
      </svg>
      <span className="mx-1">{task.count} - </span>
      <span className="capitalize">{task.task}</span>
      {task.status === "locked" && <span className="ml-1">(later)</span>}
    </div>
  );
}
