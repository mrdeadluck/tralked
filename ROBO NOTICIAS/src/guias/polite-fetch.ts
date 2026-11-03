import { createHash } from "node:crypto";
import { ACCEPT, extractText, USER_AGENT } from "../collect/index.js";
import { isChallenge } from "../pautas.js";
import type { GuideDb } from "./db.js";

/**
 * The guide robot's only way to read a web page: cache first (7 days, in the GuideDb `pages` table),
 * robots.txt per host, a minimum interval per host, one retry on 429, and challenge pages reported as such
 * (never worked around).
 */

export type PoliteResult = {
  status: "ok" | "blocked" | "challenge" | "error";
  text?: string;
  html?: string;
  finalUrl: string;
  reason?: string;
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

export async function politeFetch(url: string, opts: PoliteOptions = {}): Promise<PoliteResult> {
  const { db } = opts;
  const fetchFn = opts.fetchFn ?? fetch;
  const state = opts.state ?? defaultState;
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  if (!URL.canParse(url)) return { status: "error", finalUrl: url, reason: "invalid URL" };
  const target = new URL(url);

  const cached = db?.getPage(url);
  if (cached && cached.status === "ok" && now().getTime() - Date.parse(cached.fetched_at) < CACHE_MS) {
    return { status: "ok", text: cached.text ?? undefined, html: cached.html ?? undefined, finalUrl: cached.final_url };
  }

  /** One GET honoring the host interval. */
  async function get(u: URL): Promise<Response> {
    const gap = HOST_GAP_MS[u.hostname] ?? DEFAULT_GAP_MS;
    const last = state.lastRequestAt.get(u.hostname);
    if (last !== undefined) {
      const wait = last + gap - now().getTime();
      if (wait > 0) await sleep(wait);
    }
    state.lastRequestAt.set(u.hostname, now().getTime());
    return fetchFn(u.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  try {
    let rules = state.robots.get(target.host);
    if (!rules) {
      rules = await loadRobots(target, db, now, get);
      state.robots.set(target.host, rules);
    }
    if (!robotsAllows(rules, `${target.pathname}${target.search}`)) {
      return { status: "blocked", finalUrl: url, reason: "robots.txt" };
    }

    let response = await get(target);
    if (response.status === 429) {
      const wait = retryAfterMs(response.headers.get("Retry-After"));
      void response.body?.cancel().catch(() => {});
      await sleep(wait);
      response = await get(target);
    }

    const html = await response.text();
    const finalUrl = response.url || url;
    if (isChallenge(html)) return { status: "challenge", finalUrl, reason: "bot-protection page" };
    if (!response.ok) return { status: "error", finalUrl, reason: `HTTP ${response.status}` };

    const text = extractText(html, finalUrl)?.text ?? "";
    db?.savePage({
      url,
      fetchedAt: now(),
      status: "ok",
      finalUrl,
      text,
      html,
      contentHash: createHash("sha256").update(text).digest("hex"),
    });
    return { status: "ok", text, html, finalUrl };
  } catch (error) {
    return { status: "error", finalUrl: url, reason: error instanceof Error ? error.message : String(error) };
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
