// Regenerates models/ammoEffectiveness.generated.ts
//
//   node scripts/generate-ammo-effectiveness.mjs
//
// Ammo stats only change when the game patches, and the tooltip has to appear
// the instant the cursor lands on an item, so the table is baked into the
// build rather than fetched at runtime.
//
// The ratings are the community 0-6 effectiveness scale kept on the wiki's
// Ballistics page - the same numbers eft-ammo.com charts. tarkov.dev cannot
// supply them: its flat files carry no ballistics at all and its GraphQL API,
// the only place penetration values ever lived, has been down since 2026-07.
//
// The wiki names its rounds exactly as the game does, which is what lets each
// row be pinned to a BSG item id via the live catalogue.

import { writeFileSync } from "node:fs";

const WIKI_PAGE = "https://escapefromtarkov.fandom.com/wiki/Ballistics";
// The rendered page refuses non-browser clients; the MediaWiki API is the
// documented way in and hands back the same HTML as JSON
const WIKI_API =
  "https://escapefromtarkov.fandom.com/api.php?action=parse&page=Ballistics&prop=text&format=json";
// Which revision the numbers came from. Stamped into the generated file in
// place of the date it was scraped, so re-running against unchanged data
// produces an identical file and the scheduled refresh stays quiet.
const WIKI_REVISION =
  "https://escapefromtarkov.fandom.com/api.php?action=query&prop=revisions&titles=Ballistics&rvlimit=1&rvprop=ids|timestamp&format=json";
const CATALOGUE = "https://json.tarkov.dev/regular/items";
const NAMES = "https://json.tarkov.dev/regular/items_en";
const OUT = new URL("../models/ammoEffectiveness.generated.ts", import.meta.url);

const HEADERS = {
  "User-Agent":
    "ORBBToolTip ammo table generator (+https://github.com/Magicard/orbb-tooltip)",
};

// Below this the page has almost certainly been restructured, and shipping a
// half-empty table would look like ammo simply having no data
const MIN_EXPECTED = 175;

// Damage is graded against the hardest-hitting round of the same calibre,
// which is the only comparison that means anything: 40 damage is feeble for a
// rifle and respectable for a PDW. The best round of a calibre is always S.
// Measured against a share of that best rather than by rank, so a calibre
// whose rounds sit within a few damage of each other grades them all highly
// instead of inventing a spread that is not there.
const DAMAGE_BANDS = [
  [0.9, 6],
  [0.8, 5],
  [0.7, 4],
  [0.6, 3],
  [0.5, 2],
  [0.4, 1],
];

function damageGrade(share) {
  for (const [floor, grade] of DAMAGE_BANDS) if (share >= floor) return grade;
  return 0;
}

async function get(url, asJson) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return asJson ? res.json() : res.text();
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

const text = (html) =>
  decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Names differ only in punctuation and the optional "mm" between the two
// sources ("7.62x54mm R BT gzh" against "7.62x54R BT gzh")
const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/–/g, "-")
    // "mm" straight after the bore number, attached or spaced - a plain
    // \bmm\b never fires there because digits and letters share no boundary
    .replace(/(\d)\s*mm\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const num = (s) => {
  const m = /-?\d+(?:\.\d+)?/.exec(String(s).replace(/,/g, ""));
  return m ? Number(m[0]) : null;
};

// The columns are read by position, so before trusting them, prove the
// header still puts the name, damage and the six class columns where this
// script expects them. A reshuffled wiki table must fail loudly, not ship
// plausible wrong numbers. parseRows hands back every row on the page, so
// the header is found by content, not position.
function assertTableShape(rows) {
  const headerAt = rows.findIndex((row) => {
    const cells = row.map((c) => c.text.toLowerCase().replace(/\s+/g, ""));
    return (
      cells[0]?.startsWith("caliber") &&
      cells[1] === "name" &&
      cells[2] === "dmg" &&
      cells[3]?.startsWith("penetration")
    );
  });
  const classes = headerAt >= 0 ? rows[headerAt + 1] : undefined;
  const classesOk =
    classes?.length === 6 &&
    classes.map((c) => c.text.trim()).join(",") === "1,2,3,4,5,6";
  if (headerAt < 0 || !classesOk) {
    throw new Error(
      "The ammo table's header moved or its class columns are no longer 1-6 - refusing to read columns by position"
    );
  }
}

function parseRows(html) {
  // Footnote markers for subsonic and tracer rounds hang off the name as
  // <sup>, and would otherwise read as part of it
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<sup[\s\S]*?<\/sup>/gi, "");

  const rows = [];
  for (const [, body] of clean.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const [, attrs, inner] of body.matchAll(
      /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi
    )) {
      const title = /<a[^>]*\stitle="([^"]*)"/i.exec(inner);
      cells.push({
        text: text(inner),
        title: title ? decode(title[1]) : null,
        rowspan: Number(/rowspan="(\d+)"/i.exec(attrs)?.[1] ?? 1),
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// The Caliber column spans every round of that calibre, so all but the first
// row of each group arrives one cell short
function fillCaliber(rows) {
  const out = [];
  let carry = null;
  let left = 0;
  let dropped = 0;
  for (const row of rows) {
    if (left > 0 && row.length === 15) {
      out.push([carry, ...row]);
      left -= 1;
    } else if (row.length === 16) {
      carry = row[0];
      left = row[0].rowspan - 1;
      out.push(row);
    } else {
      dropped += 1;
    }
  }
  return { rows: out, dropped };
}

const [wikiPage, wikiInfo, catalogue, names] = await Promise.all([
  get(WIKI_API, true),
  get(WIKI_REVISION, true),
  get(CATALOGUE, true),
  get(NAMES, true),
]);

const revision = Object.values(wikiInfo?.query?.pages ?? {})[0]?.revisions?.[0];
if (!revision) throw new Error("Could not read the wiki page revision");
const editedOn = revision.timestamp.slice(0, 10);
const wikiHtml = wikiPage?.parse?.text?.["*"];
if (typeof wikiHtml !== "string") throw new Error("Unexpected shape from the wiki API");

const parsed = parseRows(wikiHtml);
assertTableShape(parsed);
const ammoTable = fillCaliber(parsed);

const rounds = [];
for (const cells of ammoTable.rows) {
  const classes = cells.slice(10, 16).map((c) => num(c.text));
  if (classes.some((v) => v === null || v < 0 || v > 6)) continue;
  // Arena-only rounds exist on no EFT item, and their page titles drop the
  // "(Arena)" their display name carries - never let one shadow a real round
  if (/\(\s*arena\s*\)/i.test(cells[1].text)) continue;
  const name = (cells[1].title ?? cells[1].text).trim();
  if (!name) continue;

  // Buckshot and flechette are written "8x50" - eight pellets doing 50 each
  const shot = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(cells[2].text.trim());
  const damage = shot ? Number(shot[2]) : num(cells[2].text);
  if (damage === null) continue;

  rounds.push({
    name,
    caliber: (cells[0].title ?? cells[0].text).trim(),
    classes,
    damage,
    projectiles: shot ? Number(shot[1]) : 1,
  });
}
if (!rounds.length) throw new Error("No ammo rows found - the wiki page changed shape");

// The catalogue stores a translation key in `name`; the readable name is in
// the separate locale file, exactly as Items.ts resolves it
const locale = names.data ?? {};
const ammoItems = [];
const byName = new Map();
for (const item of Object.values(catalogue.data.items)) {
  if (!item.types?.some((t) => t.toLowerCase() === "ammo")) continue;
  const readable = locale[item.name] ?? item.name;
  ammoItems.push({ id: item.id, name: readable });
  const key = normalize(readable);
  if (!byName.has(key)) byName.set(key, item.id);
}

const table = new Map();
const unmatched = [];
for (const round of rounds) {
  const id = byName.get(normalize(round.name));
  if (!id) {
    unmatched.push(round.name);
    continue;
  }
  const already = table.get(id);
  if (already) {
    console.warn(
      `WARNING: "${round.name}" and "${already.name}" resolve to the same item - keeping the first`
    );
    continue;
  }
  table.set(id, round);
}

// Graded over the rounds that ship, so the best one you can actually hover is
// the S and no phantom maximum sits above it.
//
// Shotgun calibres are split the way the charts split them: slugs against
// slugs, shot against shot. Grading a 220-damage slug against 8x50 Magnum
// buckshot's 400 calls it weak when it is one of the best slugs there is -
// nobody weighing up slugs is choosing against buckshot's whole spread.
const multiProjectile = new Set();
for (const round of table.values()) {
  if (round.projectiles > 1) multiProjectile.add(round.caliber);
}
const gradeGroup = (round) => {
  if (!multiProjectile.has(round.caliber)) return round.caliber;
  const slug = round.projectiles === 1 || /slug/i.test(round.name);
  return round.caliber + (slug ? "|slugs" : "|shot");
};
const byCaliber = new Map();
for (const round of table.values()) {
  const key = gradeGroup(round);
  const group = byCaliber.get(key);
  if (group) group.push(round);
  else byCaliber.set(key, [round]);
}
for (const group of byCaliber.values()) {
  const best = Math.max(...group.map((r) => r.damage * r.projectiles));
  for (const round of group) {
    round.damageTier =
      best > 0 ? damageGrade((round.damage * round.projectiles) / best) : 0;
  }
}

// The reverse direction: things you can hold that the chart says nothing
// about. Grenades and flares have no armour rating by their nature, but a
// gun round showing up here means the wiki has not covered that calibre yet
// and the tooltip will show no boxes for it.
const NOT_FIRED_FROM_A_GUN = /grenade|flare|smoke|rocket|stun|khattabka|ammo pack/i;
const uncovered = ammoItems.filter((item) => !table.has(item.id));
const gaps = uncovered.filter((item) => !NOT_FIRED_FROM_A_GUN.test(item.name));

console.log(`wiki rounds        ${rounds.length} (${ammoTable.dropped} non-data rows skipped)`);
console.log(`catalogue ammo     ${ammoItems.length}`);
console.log(`pinned to an item  ${table.size}`);
if (unmatched.length) {
  console.log(`no such item       ${unmatched.length}`);
  for (const name of unmatched) console.log(`   - ${name}`);
}
console.log(
  `no chart row       ${uncovered.length} (${uncovered.length - gaps.length} grenades, flares and the like, which have no armour rating)`
);
for (const item of gaps.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`   - ${item.name}`);
}
if (table.size < MIN_EXPECTED) {
  throw new Error(`Only ${table.size} rounds matched, expected at least ${MIN_EXPECTED}`);
}

const entries = [...table.entries()]
  .sort((a, b) => a[1].name.localeCompare(b[1].name))
  .map(
    ([id, r]) =>
      `  "${id}": { damage: ${r.damage}, projectiles: ${r.projectiles}, damageTier: ${r.damageTier}, classes: [${r.classes.join(", ")}] }, // ${r.name}`
  )
  .join("\n");

writeFileSync(
  OUT,
  `// GENERATED FILE - do not edit by hand.
// Regenerate after a game patch with: npm run generate:ammo
//
// Source: ${WIKI_PAGE}
// Wiki revision ${revision.revid}, last edited ${editedOn}
//
// What each round does, keyed by BSG item id:
//
//   damage       per projectile
//   projectiles  per shot; buckshot and flechette fire several
//   damageTier   0-6, how the whole shot compares with the hardest-hitting
//                round of the same calibre (6 = the best of them)
//   classes      0-6 against armour classes 1 to 6 on the community
//                effectiveness scale (0 = cannot penetrate in any reasonable
//                number of hits, 6 = penetrates over 80% of the time)

export type AmmoRow = {
  readonly damage: number;
  readonly projectiles: number;
  readonly damageTier: number;
  readonly classes: readonly [number, number, number, number, number, number];
};

export const AMMO_EFFECTIVENESS: Record<string, AmmoRow> = {
${entries}
};
`,
  "utf-8"
);

const staleDays = Math.floor(
  (Date.now() - Date.parse(revision.timestamp)) / 86_400_000
);
console.log(`\nwiki revision      ${revision.revid}`);
console.log(`last edited        ${editedOn} (${staleDays} days ago)`);
console.log(`wrote models/ammoEffectiveness.generated.ts`);
