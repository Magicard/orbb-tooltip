# FleaTooltip (revived fork)

In-game price-checker overlay for Escape from Tarkov. Hover an item in your stash or inventory and a tooltip shows its current flea market and trader prices — no alt-tabbing.

This is a fork of [sammereye/flea-tooltip](https://github.com/sammereye/flea-tooltip). The upstream app (and the installer from fleatooltip.com) stopped working in July 2026 when the tarkov.dev GraphQL API went offline — it would crash on startup with `Cannot read properties of undefined (reading 'items')` while "Fetching Item Prices from Database".

## What this fork changes

- **Switched the price source** from the defunct `api.tarkov.dev/graphql` endpoint to the flat-file JSON API at `json.tarkov.dev` — the same data source the tarkov.dev website itself uses (see [the-hideout/tarkov-api#474](https://github.com/the-hideout/tarkov-api/issues/474)). PvP and PvE price modes both still work.
- **No more startup crash when the API is down.** Fetch failures now surface as an error state in the app instead of killing the main process, and the 15-minute background refresh keeps the last good prices if a refetch fails.
- **Removed the deprecated `request` package** in favor of native `fetch`, with a request timeout.
- **Screen-center cursor check no longer assumes 1440p** — it now uses your actual display size, and tooltip positioning handles multi-monitor/mixed-DPI setups.
- **Vendored the OCR runtime DLLs** (Tesseract, Leptonica, image codecs — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Upstream's repo never included them, so a fresh clone couldn't produce a working build.
- **The app retries on startup** if the price API is temporarily down (once a minute), and a failed PvE/PvP mode switch reverts the toggle instead of silently serving the other mode's prices.
- **Live quest & hideout requirements** replace upstream's hardcoded (and long-stale) quest list: tooltips show how many of an item each quest turn-in or hideout upgrade needs, matched by item id against current game data and refreshed with prices.
- **TarkovTracker sync (optional):** paste a free API token from [tarkovtracker.org/settings](https://tarkovtracker.org/settings) into the app's settings and tooltips become progress-aware — requirements you can work on right now show green, ones locked behind later quests are dimmed "(later)", and ones you've already completed disappear.
- **Dark tooltip** instead of the white box.

Everything else — the OCR scanning, tooltip overlay, price list window, hotkeys, Tarkov Market API key support — is unchanged from upstream.

## How it works

1. A bundled C++ helper (`ocr_cpp.exe`, using Tesseract OCR) watches the screen region around your mouse for the game's item-tooltip border color, and OCRs the item name.
2. The Electron main process matches that name against an in-memory fuzzy search index (MiniSearch) of all ~5,300 Tarkov items.
3. Prices come from `json.tarkov.dev` (refreshed every 15 minutes), or from the [Tarkov Market](https://tarkov-market.com/) API if you supply an API key in settings.
4. A transparent always-on-top Electron window draws the price tooltip next to your cursor.

The app only reads pixels from your screen and posts nothing to the game — but as with any overlay/OCR tool, use it at your own risk with regard to BSG's terms of service.

## Running locally

Requires Node.js 18+ on Windows (the OCR helpers are prebuilt Windows executables), and the [Microsoft Visual C++ Redistributable x64](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) (already installed on most machines).

```
npm install
npm start
```

## Building a distributable

```
npm run package
```

produces the app in `out/FleaTooltip-win32-x64/`. Press **F6** in-app the first time to calibrate scanning for your screen.

## Hotkeys

| Key | Action |
| --- | --- |
| F1 | Toggle the price list window |
| F2 | Delete lowest-value scanned item |
| F3 | Delete last scanned item |
| F4 | Increment last scanned item count |
| F6 | Screen calibration |
| F12 | Dev tools |
