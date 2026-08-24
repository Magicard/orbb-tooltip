// How well a round does against each armour class, for the second tooltip box.
//
// The game shows this on the inspect screen, but only for the item you have
// opened; the numbers here come from the community 0-6 scale on the wiki's
// Ballistics page and are baked into the build by
// scripts/generate-ammo-effectiveness.mjs.

import { AMMO_EFFECTIVENESS, AmmoRow } from "./ammoEffectiveness.generated";

export type { AmmoRow };

// Armour classes labelled the way the game labels them
export const ARMOR_CLASSES = ["I", "II", "III", "IV", "V", "VI"] as const;

// The wiki's own colour for each grade, so the box reads like the chart it
// came from. Bright orange needs dark text on it; the rest carry white.
const GRADE_STYLE: Record<number, { bg: string; fg: string }> = {
  0: { bg: "#b32425", fg: "#f5f5f4" },
  1: { bg: "#dd3333", fg: "#f5f5f4" },
  2: { bg: "#eb6c0d", fg: "#f5f5f4" },
  3: { bg: "#ac6600", fg: "#f5f5f4" },
  4: { bg: "#fb9c0e", fg: "#1c1917" },
  5: { bg: "#006400", fg: "#f5f5f4" },
  6: { bg: "#009900", fg: "#f5f5f4" },
};

const UNKNOWN_GRADE = { bg: "#44403c", fg: "#a8a29e" };

// The 0-6 scale as a tier letter, worst first. Seven grades and seven
// letters, so the tier is a straight relabelling with nothing merged.
const TIERS = ["F", "E", "D", "C", "B", "A", "S"];

export function tierLabel(grade: number): string {
  return TIERS[grade] ?? "?";
}

export function gradeStyle(grade: number): { bg: string; fg: string } {
  return GRADE_STYLE[grade] ?? UNKNOWN_GRADE;
}

// What the round does, or null if this is not ammo we hold a chart for
export function ammoStatsFor(item: {
  id: string;
  bsgId?: string;
}): AmmoRow | null {
  return AMMO_EFFECTIVENESS[item.bsgId ?? item.id] ?? null;
}
