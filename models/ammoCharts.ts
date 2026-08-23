// Ctrl+middle-click an item and its calibre's ammo chart opens on eft-ammo.com.
//
// The site keys its pages off a slug that is nearly, but not quite, the calibre
// as written ("5.45x39 mm" is "5.45x39-mm" while "9x19mm" is "9x19mm"), so the
// slugs are listed rather than derived.
//
// The calibre itself is read out of the item's name, which carries it for both
// of the things worth charting: a round is called "5.45x39mm PS gs" and the
// magazine that holds it "AK-74 5.45x39 6L23 30-round magazine". Nothing else
// we hold about an item says what it is chambered for.

const AMMO_CHART_BASE = "https://eft-ammo.com/c/ammunition-";

// A bore as the game writes it: "5.45x39" in a magazine's name, "5.45x39mm" in
// a round's, and with a letter or two run straight on for the ones the game
// spells that way - "9x18PM", "7.62x54R".
const bore = (pattern: string) =>
  new RegExp(`\\b${pattern}(?:\\s*mm)?[a-z]{0,2}\\b`, "i");

// Each calibre and the slug its page uses, with the other name it goes by
// where it has one. Longest bores first, so "12.7x55" is never found as the
// "7x55" inside it.
const CALIBRES: { slug: string; match: RegExp; alias?: RegExp }[] = [
  { slug: ".338-lapua-magnum", match: /\.338\s*(?:lapua|lm)\b/i },
  { slug: ".308-marlin-express", match: /\.308\s*marlin\b/i },
  { slug: ".300-blk", match: /\.300\s*(?:blackout|blk)\b/i },
  { slug: ".357-magnum", match: /\.357\b/i },
  { slug: ".50-bmg", match: /\.50\s*bmg\b/i, alias: bore("12\\.7x108") },
  { slug: ".50", match: /\.50\s*ae\b/i },
  { slug: ".45", match: /\.45\s*acp\b/i },
  { slug: ".366", match: /\.366\b/i },
  { slug: "12.7x55-mm", match: bore("12\\.7x55") },
  { slug: "9.3x64-mm", match: bore("9\\.3x64") },
  { slug: "7.62x54r", match: bore("7\\.62x54") },
  { slug: "7.62x51-mm", match: bore("7\\.62x51") },
  { slug: "7.62x39-mm", match: bore("7\\.62x39") },
  { slug: "7.62x25mm", match: bore("7\\.62x25") },
  { slug: "6.8x51mm", match: bore("6\\.8x51"), alias: /\.277\s*fury\b/i },
  { slug: "5.56x45-mm", match: bore("5\\.56x45"), alias: /\.223\b|\bstanag\b/i },
  { slug: "5.45x39-mm", match: bore("5\\.45x39") },
  { slug: "5.7x28-mm", match: bore("5\\.7x28") },
  { slug: "4.6x30-mm", match: bore("4\\.6x30") },
  { slug: "23x75-mm", match: bore("23x75") },
  { slug: "9x39mm", match: bore("9x39") },
  { slug: "9x21mm", match: bore("9x21") },
  { slug: "9x19mm", match: bore("9x19"), alias: /\bparabellum\b/i },
  { slug: "9x18mm", match: bore("9x18"), alias: /\bmakarov\b/i },
  { slug: "20-gauge", match: /\b20\/70\b|\b20\s*gauge\b|\b20\s*ga\b/i },
];

// Shotgun shells are one calibre to the game and two pages to the site
const SHOTGUN = /\b12\/70\b|\b12\s*gauge\b|\b12\s*ga?\b/i;
const SHOTGUN_SHOT = "12-gauge-shot";
const SHOTGUN_SLUGS = "12-gauge-slugs";
const SLUG_ROUND = /\bslug\b/i;

// The chart for whatever this item is chambered for, or null if it is not the
// sort of thing a chart covers
export function ammoChartUrl(itemName: string): string | null {
  if (SHOTGUN.test(itemName)) {
    return AMMO_CHART_BASE + (SLUG_ROUND.test(itemName) ? SHOTGUN_SLUGS : SHOTGUN_SHOT);
  }
  const found = CALIBRES.find(
    (calibre) => calibre.match.test(itemName) || calibre.alias?.test(itemName) === true
  );
  return found ? AMMO_CHART_BASE + found.slug : null;
}
