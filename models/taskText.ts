// How a task or objective's wording is reduced before anything is compared to
// anything else. Lives on its own because both the scanner (which runs in the
// main process and reads files) and the panel data (which the renderer bundles)
// need it, and the renderer cannot pull in anything that touches Node.

// Normalized words in sorted order, so word order does not matter
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\[.*?\]/g, "") // "[Season PvP]" suffixes
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
