// Where TarkovTracker lives, and how we introduce ourselves to it. Both the
// read side (TaskData) and the write side (TrackerSync) go through here, so
// the host list and its ordering rule exist once.
//
// The api.tarkovtracker.org gateway is primary and tarkovtracker.org serves
// the same routes during its deprecation window. tarkovtracker.io is the
// legacy site with its own accounts and token format; tokens created there
// only work against it, so it is tried last and existing users are not
// locked out.
export const TRACKER_API_BASES = [
  "https://api.tarkovtracker.org/api/v2",
  "https://tarkovtracker.org/api/v2",
  "https://tarkovtracker.io/api/v2",
];

export const LEGACY_TRACKER_HOST = "tarkovtracker.io";

// The gateway rejects requests whose User-Agent is shorter than 5 characters,
// and Electron's main-process fetch sends just "node"
export const TRACKER_USER_AGENT =
  "orbb-tooltip/1.0 (+https://github.com/Magicard/orbb-tooltip)";

export const TRACKER_TIMEOUT_MS = 15 * 1000;

export function trackerUrls(route: string): string[] {
  return TRACKER_API_BASES.map((base) => base + route);
}
