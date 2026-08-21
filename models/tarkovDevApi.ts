// Shared helper for the json.tarkov.dev flat-file API (see README)
const TARKOV_DEV_JSON_API = "https://json.tarkov.dev";

const FETCH_TIMEOUT_MS = 90 * 1000;

export type TarkovDevTranslationsResponse = {
  data: Record<string, string>;
};

export async function fetchTarkovDevJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${TARKOV_DEV_JSON_API}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(
        `tarkov.dev request for ${path} failed: ${res.status} ${res.statusText}`
      );
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}
