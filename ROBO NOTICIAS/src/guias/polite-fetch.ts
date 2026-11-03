import { createHash } from "node:crypto";
import { ACCEPT, USER_AGENT } from "../collect/index.js";
import { isChallenge } from "../pautas.js";
import type { GuideDb, PageRow } from "./db.js";
import { PAGE_TEXT_MAX, PAGE_TEXT_VERSION, pageText } from "./page-text.js";

/**
 * The guide robot's only way to read a web page: cache first (7 days, in the GuideDb `pages` table),
 * robots.txt per host, a minimum interval per host, one retry on 429, and challenge pages reported as such
 * (never worked around). The text is the guide extractor's (`pageText`: tables kept, no 20,000-char cap); a page
 * cached by an older extractor gets its text remade from the stored HTML, without a new request.
 */

export type PoliteResult = {
  status: "ok" | "blocked" | "challenge" | "error";
  text?: string;
  html?: string;
  finalUrl: string;
  reason?: string;
  /** The text stopped at `PAGE_TEXT_MAX` (the page is longer). */
  truncated?: boolean;
};

export type PoliteState = {
  lastRequestAt: Map<string, number>;
  robots: Map<string, RobotsRules>;
};

export const createPoliteState = (): PoliteState => ({ lastRequestAt: new Map(), robots: new Map() });
const defaultState = createPoliteState();

export type PoliteOptions = {
  /** Where fetched pages are cached and kept for the later steps. Without it nothing is stored. */
  db?: GuideDb;
  fetchFn?: typeof fetch;
  /** Host intervals and the robots cache; shared across calls by default. */
  state?: PoliteState;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const CACHE_MS = 7 * 86_400_000;
const DEFAULT_GAP_MS = 2_000;
const HOST_GAP_MS: Record<string, number> = { "steamcommunity.com": 5_000 };
const RETRY_AFTER_CAP_MS = 120_000;
const DEFAULT_RETRY_MS = 5_000;
const TIMEOUT_MS = 20_000;

// ---------- robots.txt ----------

type Rule = { allow: boolean; pattern: string };
type RobotsRules = Rule[];

/** The rules that apply to us: those of our own group when there is one, otherwise those of `*`. */
export function parseRobots(txt: string): RobotsRules {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && USER_AGENT.toLowerCase().startsWith(a)));
  const chosen = mine.length > 0 ? mine : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Longest matching pattern wins; Allow wins a tie; no match means allowed. */
export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(pathAndQuery)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best?.allow ?? true;
}

// ---------- fetch ----------

function retryAfterMs(header: string | null): number {
  if (header === null) return DEFAULT_RETRY_MS;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.min(Number(value) * 1000, RETRY_AFTER_CAP_MS);
  const date = Date.parse(value);
  return Number.isNaN(date) ? DEFAULT_RETRY_MS : Math.min(Math.max(date - Date.now(), 0), RETRY_AFTER_CAP_MS);
}

type Resolved = {
  db?: GuideDb;
  state: PoliteState;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** One GET honoring the host interval. */
  get: (u: URL, accept?: string) => Promise<Response>;
};

function resolveOptions(opts: PoliteOptions): Resolved {
  const fetchFn = opts.fetchFn ?? fetch;
  const state = opts.state ?? defaultState;
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  async function get(u: URL, accept = ACCEPT): Promise<Response> {
    const gap = HOST_GAP_MS[u.hostname] ?? DEFAULT_GAP_MS;
    const last = state.lastRequestAt.get(u.hostname);
    if (last !== undefined) {
      const wait = last + gap - now().getTime();
      if (wait > 0) await sleep(wait);
    }
    state.lastRequestAt.set(u.hostname, now().getTime());
    return fetchFn(u.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
  return { db: opts.db, state, now, sleep, get };
}

/** robots.txt allows the url (rules cached per host in the state). */
async function allowed(target: URL, r: Resolved): Promise<boolean> {
  let rules = r.state.robots.get(target.host);
  if (!rules) {
    rules = await loadRobots(target, r.db, r.now, (u) => r.get(u));
    r.state.robots.set(target.host, rules);
  }
  return robotsAllows(rules, `${target.pathname}${target.search}`);
}

/** The GET, retried once after a 429 (Retry-After honored, capped). */
async function getWithRetry(target: URL, r: Resolved, accept?: string): Promise<Response> {
  let response = await r.get(target, accept);
  if (response.status === 429) {
    const wait = retryAfterMs(response.headers.get("Retry-After"));
    void response.body?.cancel().catch(() => {});
    await r.sleep(wait);
    response = await r.get(target, accept);
  }
  return response;
}

export async function politeFetch(url: string, opts: PoliteOptions = {}): Promise<PoliteResult> {
  const r = resolveOptions(opts);
  const { db, now } = r;

  if (!URL.canParse(url)) return { status: "error", finalUrl: url, reason: "invalid URL" };
  const target = new URL(url);

  const cached = db?.getPage(url);
  if (db && cached && cached.status === "ok" && now().getTime() - Date.parse(cached.fetched_at) < CACHE_MS) {
    if (cached.text_version !== PAGE_TEXT_VERSION && cached.html) return retext(db, { ...cached, html: cached.html });
    // Only a text near the cap can have been cut: then the HTML says whether it was.
    const truncated = (cached.text?.length ?? 0) >= PAGE_TEXT_MAX * 0.9 && cached.html ? pageText(cached.html).truncated : false;
    return { status: "ok", text: cached.text ?? undefined, html: cached.html ?? undefined, finalUrl: cached.final_url, truncated };
  }

  try {
    if (!(await allowed(target, r))) return { status: "blocked", finalUrl: url, reason: "robots.txt" };

    const response = await getWithRetry(target, r);

    const html = await response.text();
    const finalUrl = response.url || url;
    if (isChallenge(html)) return { status: "challenge", finalUrl, reason: "bot-protection page" };
    if (!response.ok) return { status: "error", finalUrl, reason: `HTTP ${response.status}` };

    const { text, truncated } = pageText(html);
    db?.savePage({ url, fetchedAt: now(), status: "ok", finalUrl, text, html, contentHash: hashOf(text), textVersion: PAGE_TEXT_VERSION });
    return { status: "ok", text, html, finalUrl, truncated };
  } catch (error) {
    return { status: "error", finalUrl: url, reason: error instanceof Error ? error.message : String(error) };
  }
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

/** A cached page whose text came from an older extractor: the text is remade from its HTML (cache age kept). */
function retext(db: GuideDb, row: PageRow & { html: string }): PoliteResult {
  const { text, truncated } = pageText(row.html);
  db.savePage({
    url: row.url,
    fetchedAt: new Date(row.fetched_at),
    status: row.status,
    finalUrl: row.final_url,
    text,
    html: row.html,
    contentHash: hashOf(text),
    textVersion: PAGE_TEXT_VERSION,
  });
  return { status: "ok", text, html: row.html, finalUrl: row.final_url, truncated };
}

const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_ACCEPT = "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8";

/**
 * Bytes of an image under the same rules as the pages (robots.txt, host interval, one retry on 429). Null when
 * it is not allowed, fails, is not an image (a challenge page is HTML) or is over 15 MB. Never cached.
 */
export async function politeFetchImage(url: string, opts: PoliteOptions = {}): Promise<Buffer | null> {
  const r = resolveOptions(opts);
  if (!URL.canParse(url)) return null;
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") return null;
  try {
    if (!(await allowed(target, r))) return null;
    const response = await getWithRetry(target, r, IMAGE_ACCEPT);
    const type = response.headers.get("Content-Type") ?? "";
    const length = Number(response.headers.get("Content-Length") ?? 0);
    if (!response.ok || !type.startsWith("image/") || length > IMAGE_MAX_BYTES) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= IMAGE_MAX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** robots.txt of a host, from the page cache when fresh; missing or unreadable means everything allowed. */
async function loadRobots(
  target: URL,
  db: GuideDb | undefined,
  now: () => Date,
  get: (u: URL) => Promise<Response>,
): Promise<RobotsRules> {
  const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;
  const cached = db?.getPage(robotsUrl);
  if (cached && now().getTime() - Date.parse(cached.fetched_at) < CACHE_MS) return parseRobots(cached.text ?? "");
  let txt = "";
  try {
    const response = await get(new URL(robotsUrl));
    if (response.ok) txt = await response.text();
    else void response.body?.cancel().catch(() => {});
  } catch {
    // Unreachable robots.txt: treated as absent.
  }
  db?.savePage({ url: robotsUrl, fetchedAt: now(), status: "robots", finalUrl: robotsUrl, text: txt });
  return parseRobots(txt);
}
