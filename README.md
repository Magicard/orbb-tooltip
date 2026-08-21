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
4. Leave TarkovMonitor running while you play. ORBB ToolTip re-reads your progress every 15 minutes (or instantly when you press ✓ again).

---

## Hotkeys

| Key | What it does |
| --- | --- |
| **F1** | Show / hide the ORBB window |
| **F2** | Remove the lowest-value item from the loot list |
| **F3** | Remove the last scanned item |
| **F4** | Add one to the last scanned item's count |
| **F6** | Screen calibration |
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

No. Measured idle while the game runs: the whole thing uses about **3% of one CPU core** and ~450 MB of RAM (Electron's floor). The scanner polls your cursor every 25 ms and backs off to 100 ms when nothing's happening, so it's effectively asleep during raids.

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
