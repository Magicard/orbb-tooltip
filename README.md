<div align="center">

<img src="icon.png" alt="ORBB ToolTip" width="120">

# ORBB ToolTip

**Hover an item in Escape from Tarkov. See what it's worth and whether you need it. No alt-tabbing.**

<img src="docs/images/tooltip.png" alt="In-game tooltip for a PCB: flea price, trader price, a green quest you can do now, hideout upgrades, and a dimmed future quest" width="340">

<sub>Green = needed for a quest you can do <b>now</b> (✓ = must be found in raid) · white = hideout upgrades · grey "(later)" = locked behind other quests</sub>

</div>

---

## What it does

Hover over any item in your stash, inventory or a container and a small overlay appears next to your cursor with:

- **Flea market price** — per slot, and total if you want it
- **Best trader price** — and which trader
- **Quest & hideout needs** — "1 - Gunsmith - AKS-74U", "4 - Stash 2", with a check mark when it has to be *found in raid*
- **Your progress** *(optional)* — link TarkovTracker and requirements you can do **right now show green**, ones locked behind later quests are dimmed "(later)", and ones you've already finished disappear

Press **`'`** (apostrophe) in a raid and a **quest panel** slides in from the right — the quests you've accepted that have objectives on the map you're on, plus the ones you can do anywhere, with counts from TarkovTracker. Hold **Ctrl** and roll the wheel to scroll it from anywhere — even mid-raid while you keep moving; in menus it's click-through until you hover it, and then you can scroll it, set its opacity (slider top-right), drag it by the grip at the top, resize it from the bottom-left corner, click the map name to browse any map's quests, and click a quest to collapse it — it remembers all of that. It reads the game's own log files (the same thing TarkovMonitor does) to know which quests you've accepted or handed in, which map you loaded into, and when a raid ends — so your progress refreshes straight away.

<div align="center"><img src="docs/images/quest-panel.png" alt="Quest panel on Customs listing active quests with objectives on this map" width="360"></div>

The **Map** button at the top-left of the panel (or **`[`**) opens a floating **map window** for the map you're on: roll the wheel to zoom around the cursor, drag to pan, double-click or press *fit* to see the whole thing, drag the title bar to move it and the bottom-right corner to resize it — it remembers where you left it, and it closes and reopens together with the panel. Maps are plain images in the `maps` folder, named after the game's map id (`shoreline.png`, `bigmap.png` for Customs, `woods.png`…); Shoreline ships with the app, and [maps/README.md](maps/README.md) lists the names for the rest, so drop in whichever ones you like. The **×** next to it closes the panel.

It also keeps a running **loot total** of everything you've scanned, which is handy for deciding what's worth dragging out of a raid.

Prices come from [tarkov.dev](https://tarkov.dev) (community data, refreshed every 15 minutes) for **regular PvP, the seasonal PvP wipe, or PvE** — your pick. It only ever *reads pixels from your screen*; it never touches the game or its files.

> ORBB ToolTip is a fork of [sammereye/flea-tooltip](https://github.com/sammereye/flea-tooltip) (FleaTooltip), revived after its price source went offline in July 2026 and extended from there. As with any overlay, use it at your own discretion regarding BSG's terms of service.

---

## Setup in five minutes

### 1. Get the app

Download the latest build from the [Releases](https://github.com/Magicard/orbb-tooltip/releases) page and unzip it anywhere, or [build it yourself](#building-from-source). Run `ORBBToolTip.exe`.

> **Requirements:** Windows 10/11 and the [Microsoft Visual C++ Redistributable x64](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) (you almost certainly already have it).

### 2. Set Tarkov to Borderless

In Tarkov's graphics settings set **Screen mode → Borderless**. Overlays can't draw on top of exclusive fullscreen — this is the number one reason for "nothing shows up". If you have several monitors, keep the game on your **primary** one.

### 3. Turn on the overlay

Click the ⚙ gear in the top-right of the ORBB window and switch on **Enable Tooltips** and **Always On Top**.

<img src="docs/images/settings-general.png" alt="Settings: Enable Tooltips and Always On Top switched on" width="600">

### 4. Pick your game mode

Further down, choose the flea market you actually play on — **PvP**, **Season PvP** or **PvE**. Prices differ a lot between them.

<img src="docs/images/settings-gamemode.png" alt="Game mode selector" width="600">

### 5. Calibrate once (F6)

The scanner needs to learn where Tarkov draws its item tooltip on your resolution.

1. In Tarkov, open your **stash** and hover an item so the game's own little name-tooltip is showing.
2. Press **F6**. The ORBB window says *"Screen Configuration Started"*.
3. With the mouse still on that item (tooltip visible), press **F6 again** — then **don't move the mouse** while it scans.
4. When it says *"Configuration Complete"*, restart ORBB ToolTip.

That's it. Hover things and prices appear.

---

## Quest tracking with TarkovTracker *(optional, recommended)*

Out of the box, tooltips list every quest and hideout upgrade an item is used for. Link a free [TarkovTracker](https://tarkovtracker.org) account and they become *yours*: completed quests drop off, doable ones turn green, future ones dim.

### Create a token

1. Sign in at **[tarkovtracker.org](https://tarkovtracker.org)** and pick the same game mode you play (PvP / Seasonal PvP / PvE — progress is tracked per mode).
2. Go to **Settings → API Tokens → Create a token**. Give it **Get progression** *and* **Write progression** permission (the write permission is for TarkovMonitor below).
3. Copy it with the **copy button** — part of the displayed token is masked with asterisks, so don't select it by hand.

### Paste it into ORBB ToolTip

Open ⚙ → **TarkovTracker Sync**, paste the token and press ✓. It confirms *"Connected as &lt;name&gt; (Level N)"* and warns you if the token's mode doesn't match your Game Mode setting.

<img src="docs/images/settings-tracker.png" alt="TarkovTracker Sync settings with a connected token" width="600">

### Keep it in sync automatically with TarkovMonitor

TarkovTracker only knows what it's told. Rather than ticking off quests by hand, run **[TarkovMonitor](https://github.com/the-hideout/TarkovMonitor)** — a small companion app from the tarkov.dev team that reads the game's log files and marks quests complete on TarkovTracker as you play.

1. Download `TarkovMonitor.zip` from its [releases page](https://github.com/the-hideout/TarkovMonitor/releases), unzip and run it.
2. In its **Settings**, paste the same TarkovTracker token and click **Test Token**.
3. **Catch up on past progress:** still in Settings, scroll to *Initial Setup* → **Read Past Logs**, pick the breakpoint matching the start of your current wipe, and let it replay your logs. This back-fills everything you completed before installing it.
4. Leave TarkovMonitor running while you play. ORBB ToolTip re-reads your progress about 20 seconds after every raid ends (and every 15 minutes otherwise), so the quest panel and tooltips are current by the time you're back in your stash.

### Exact progress: scan the Tasks screen

Trackers only learn about *completed* objectives, so a kill counter sits at 0/5 until it's done. The game's own **Tasks** screen has the real numbers — open it and press **`]`** to start a ~45-second catch-up: ORBB keeps reading the screen every couple of seconds while **you scroll the list and click through your tasks**, picking up each task's percentage, the exact `3/5` counts of whichever task is selected, and the rotating **Operational** daily/weekly tasks that no database lists. It never sends input to the game. Everything is remembered between scans.

**In a raid**, the bottom-right notifications ("Subtask completed: Eagle Eye", "Task The Cult is ready to be completed") are read as they appear, so the panel shows **READY** or a ✓ the moment it happens — confirmed properly by TarkovTracker after the raid.

> **Where are my logs?** The quest panel reads Tarkov's logs from `C:\Battlestate Games\Escape from Tarkov\Logs` by default. If your game lives elsewhere, set the folder in ⚙ → Quest Panel.

---

## Hotkeys

| Key | What it does |
| --- | --- |
| **F1** | Show / hide the ORBB window |
| **F2** | Remove the lowest-value item from the loot list |
| **F3** | Remove the last scanned item |
| **F4** | Add one to the last scanned item's count |
| **F6** | Screen calibration |
| **`'`** | Slide the quest panel in / out (changeable in settings) |
| **`[`** | Show / hide the map window (changeable) |
| **`]`** | Read progress off the game's Tasks screen (changeable) |
| **F12** | Developer tools |

Each hotkey can be switched off in settings if it clashes with something.

---

## Troubleshooting

**Nothing appears when I hover.**
Borderless mode (step 2), tooltips enabled (step 3), calibration done (step 5) — in that order. Hover long enough for the *game's* tooltip to fully appear; that's what gets read.

**It works everywhere except near the right edge of the screen.**
Fixed in the current build — update. (The game shifts its tooltip left near the edge; older scanners only looked in one place.)

**Some items scan, some don't.**
The scanner finds the game's tooltip by its border colour. If BSG changes the UI, adjust the RGB border colour in settings (defaults: 82 / 89 / 90). Unmatched reads are written to the log file — find it via `%APPDATA%\tarkov-price-tooltip\logs\main.log` and open an issue with the line.

**"Token rejected".**
Make sure the token came from **tarkovtracker.org** (not the old tarkovtracker.io — those still work, but the site is legacy), was copied with the copy button, and has *Get progression* permission.

**"Fetching Items from Database Failed".**
tarkov.dev is temporarily unreachable. The app retries every minute on its own; nothing to do.

---

## Is it heavy?

No. Measured idle while the game runs: the whole thing uses about **2% of one CPU core** and ~500 MB of RAM (Electron's floor). The scanner polls your cursor every 25 ms and backs off to 100 ms when nothing's happening, the log watcher checks one file's size every 2 seconds, and the quest panel and map windows don't exist on screen until you open them. In a raid it also glances at the bottom-right corner every 2 seconds for the game's "Subtask completed" notifications, but it strips that strip down to its bright pixels first and skips OCR entirely when there's nothing there, so that costs well under 2% too.

---

## How it works

1. A small native helper (`ocr_cpp.exe`, Tesseract OCR) watches the screen around your cursor for the game's tooltip border and reads the item name.
2. The Electron main process matches that name against a fuzzy index of all ~5,300 items and looks up prices, quest and hideout requirements (from `json.tarkov.dev`) and your TarkovTracker progress.
3. A transparent always-on-top window draws the tooltip beside your cursor.

---

## Building from source

Requires Node.js 18+ on Windows.

```
npm install
npm start          # run in development
npm run package    # build out/ORBBToolTip-win32-x64/
```

Press F6 in-app afterwards to calibrate (repackaging resets the calibration file).

### Rebuilding the OCR scanner (optional)

`lib/ocr/ocr_cpp.exe` is prebuilt. To change it (`lib/ocr_cpp/ocr_cpp.cpp`) you need Visual Studio 2022 Build Tools with the C++ workload and [vcpkg](https://github.com/microsoft/vcpkg) with `tesseract:x64-windows` installed and `vcpkg integrate install` run. Then:

```
msbuild lib\ocr_cpp\ocr_cpp.vcxproj /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v143
```

The build drops the exe and its runtime DLLs into `lib/ocr/`.

---

## Credits & licenses

Original app by [sammereye](https://github.com/sammereye/flea-tooltip). Item, price, quest and hideout data by the [tarkov.dev](https://tarkov.dev) project; progress tracking by [TarkovTracker](https://tarkovtracker.org) and [TarkovMonitor](https://github.com/the-hideout/TarkovMonitor). OCR by [Tesseract](https://github.com/tesseract-ocr/tesseract). Bundled third-party libraries are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). MIT licensed.

Escape from Tarkov is a trademark of Battlestate Games. This is an unofficial fan project, not affiliated with or endorsed by BSG.
