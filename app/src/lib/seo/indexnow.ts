import { after } from "next/server";
import { env } from "@/lib/env";

/*
 * IndexNow (indexnow.org): tells Bing (and Yandex, Seznam, Naver) that a URL was published,
 * changed or removed, so it is recrawled in minutes instead of days. Bing's index feeds ChatGPT
 * search and Copilot answers, so this is how a fresh article reaches them. Google does not take
 * IndexNow; it reads the sitemaps.
 *
 * The key is public by design: search engines check it at INDEXNOW_KEY_PATH on this host before
 * trusting a submission, and it can only vouch for this host's URLs.
 */

export const INDEXNOW_KEY = "3fb0966843f9800a64bd56935cc7a5a3";
/** Served by app/3fb0966843f9800a64bd56935cc7a5a3.txt/route.ts. */
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 10_000;

export type IndexNowPayload = { host: string; key: string; keyLocation: string; urlList: string[] };

/** Pure: the POST body for site `paths` on `base` (duplicates dropped, at most 10,000 URLs). */
export function indexNowPayload(paths: readonly string[], base: string): IndexNowPayload {
  const origin = new URL(base);
  return {
    host: origin.host,
    key: INDEXNOW_KEY,
    keyLocation: new URL(INDEXNOW_KEY_PATH, origin).toString(),
    urlList: [...new Set(paths.map((path) => new URL(path, origin).toString()))].slice(0, 10_000),
  };
}

type EnvSource = Partial<Record<"NODE_ENV" | "VERCEL_ENV", string | undefined>>;

/** Only the production site submits: never tests, local runs or Vercel previews. */
export function indexNowEnabled(base: string, source: EnvSource = process.env): boolean {
  if (source.NODE_ENV !== "production") return false;
  if (source.VERCEL_ENV && source.VERCEL_ENV !== "production") return false;
  const { hostname, protocol } = new URL(base);
  return protocol === "https:" && hostname !== "localhost" && !hostname.endsWith(".vercel.app");
}

/** Submits now; returns the HTTP status (200/202 = accepted) or null when it could not be sent. */
export async function submitIndexNow(
  paths: readonly string[],
  base: string = env.APP_URL,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  if (paths.length === 0) return null;
  try {
    const response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(indexNowPayload(paths, base)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 400) console.warn(`[indexnow] ${response.status} for ${paths.join(", ")}`);
    return response.status;
  } catch (error) {
    console.warn("[indexnow] not sent:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * After the response is sent (never delays the request, never fails it): submits `paths` when this
 * is the production site. Call it where an article is published, edited or taken down.
 */
export function scheduleIndexNow(paths: readonly string[]): void {
  if (paths.length === 0 || !indexNowEnabled(env.APP_URL)) return;
  const send = () => submitIndexNow(paths).then(() => undefined);
  try {
    after(send);
  } catch {
    // Outside a request (a script): send it right away, without waiting.
    void send();
  }
}
