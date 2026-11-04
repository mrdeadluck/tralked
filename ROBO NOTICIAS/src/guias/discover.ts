import { parseHTML } from "linkedom";
import { BudgetExceededError, isOutOfCredit } from "../ai/client.js";
import type { SearchHit } from "./websearch.js";
import type { FetchPage, SourceRef, SourceRole } from "./sources.js";

export const MAX_SEARCHES = 6;
export const STEAM_GUIDES_PICKED = 3;

export interface DiscoverDeps {
  fetchPage: FetchPage;
  search: (query: string) => Promise<SearchHit[]>;
  /** Called for each search that failed for a reason that does not stop discovery (the caller reports it). */
  onSearchFailure?: (query: string, error: unknown) => void;
}

/** Budget and credential errors must stop the run: swallowing them would look like "no sources found". */
function isFatalSearchError(err: unknown): boolean {
  // Out of credit: every other search fails the same way, and a discovery of failed searches must never be saved.
  if (err instanceof BudgetExceededError || isOutOfCredit(err)) return true;
  const e = err as { status?: number; name?: string } | null;
  return e?.status === 401 || e?.status === 403 || e?.name === "AuthenticationError" || e?.name === "PermissionDeniedError";
}

/** "Phantom Blade Zero" -> "phantom-blade-zero" */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "Phantom Blade Zero" -> "Phantom-Blade-Zero" (TrueSteamAchievements). */
function hyphenName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Wraps a search so that one discovery never runs more than `max` searches, however many are asked for. */
export function limitSearches(search: DiscoverDeps["search"], max = MAX_SEARCHES): DiscoverDeps["search"] {
  let used = 0;
  return async (query) => {
    if (used >= max) return [];
    used += 1;
    return search(query);
  };
}

const ALL_PATTERN = /100\s*[%％]|\ball\b|\btodas?\b|\btodos\b|全成就|全部成就|все|всё|completionist/iu;

function mentionsAll(title: string, description: string): boolean {
  return ALL_PATTERN.test(`${title}\n${description}`);
}

function guessLanguage(text: string): string | undefined {
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  return undefined;
}

type GuideEntry = { title: string; description: string; author?: string; url: string };

export function parseSteamGuideList(html: string): GuideEntry[] {
  const { document } = parseHTML(html);
  const entries: GuideEntry[] = [];
  for (const a of document.querySelectorAll("a.workshopItemCollection")) {
    const url = a.getAttribute("href");
    const title = a.querySelector(".workshopItemTitle")?.textContent?.trim();
    if (!url || !title) continue;
    entries.push({
      url,
      title,
      description: a.querySelector(".workshopItemShortDesc")?.textContent?.trim() ?? "",
      author: a.querySelector(".workshopItemAuthorName")?.textContent?.trim(),
    });
  }
  return entries;
}

/** Region and collectible pages of the game found in the roadmap page (in page order, no duplicates). */
export function parsePowerpyxCollectibleLinks(html: string, slug: string): string[] {
  const out: string[] = [];
  const re = /href="https:\/\/(?:www\.)?powerpyx\.com\/([^"#?]+?)\/?(?:[#?][^"]*)?"/g;
  for (const m of html.matchAll(re)) {
    const path = m[1]!;
    if (!path.startsWith(`${slug}-`)) continue;
    if (!/collectible-locations$|collectibles-guide/.test(path)) continue;
    const url = `https://www.powerpyx.com/${path}/`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

const regionName = (url: string, slug: string): string =>
  url
    .replace(/^.*powerpyx\.com\//, "")
    .replace(/\/$/, "")
    .replace(`${slug}-`, "")
    .replace(/-collectible-locations$/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** Search plan: one query per group of sites, in priority order. */
function searchPlan(name: string): string[] {
  return [
    `${name} trophy guide site:psnprofiles.com`,
    `${name} trophy guide grindnstrat`,
    `${name} achievements guide (site:game8.co OR site:ign.com)`,
    `${name} achievements guide (site:games.gg OR site:allthings.how)`,
    `${name} guide (site:fextralife.com OR site:fandom.com OR site:mobalytics.gg)`,
    `${name} 100% achievements guide site:reddit.com`,
  ];
}

const SEARCH_HOSTS: { match: RegExp; name: string; role: SourceRole }[] = [
  { match: /(^|\.)psnprofiles\.com$/, name: "PSNProfiles", role: "roteiro_psn" },
  { match: /(^|\.)grindnstrat\.com$/, name: "Grindnstrat", role: "coletaveis" },
  { match: /(^|\.)game8\.co$/, name: "Game8", role: "coletaveis" },
  { match: /(^|\.)ign\.com$/, name: "IGN", role: "coletaveis" },
  { match: /(^|\.)games\.gg$/, name: "games.gg", role: "coletaveis" },
  { match: /(^|\.)allthings\.how$/, name: "allthings.how", role: "coletaveis" },
  { match: /(^|\.)fextralife\.com$/, name: "Fextralife", role: "coletaveis" },
  { match: /(^|\.)fandom\.com$/, name: "Fandom", role: "coletaveis" },
  { match: /(^|\.)mobalytics\.gg$/, name: "Mobalytics", role: "coletaveis" },
  { match: /(^|\.)reddit\.com$/, name: "Reddit", role: "confirmacao" },
  { match: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/, name: "YouTube", role: "confirmacao" },
];
const PER_HOST = 2;

export async function discoverSources(
  game: { name: string; steamAppId: number },
  deps: DiscoverDeps,
): Promise<SourceRef[]> {
  const slug = slugify(game.name);
  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  const add = (s: SourceRef) => {
    if (seen.has(s.url)) return;
    seen.add(s.url);
    sources.push(s);
  };

  // PowerPyx: the roadmap, then the region/collectible pages it links to.
  const roadmapUrl = `https://www.powerpyx.com/${slug}-trophy-guide-roadmap/`;
  add({ name: "PowerPyx", url: roadmapUrl, role: "roteiro_psn", language: "en" });
  const roadmap = await deps.fetchPage(roadmapUrl);
  if (roadmap.status === "ok" && roadmap.html) {
    for (const url of parsePowerpyxCollectibleLinks(roadmap.html, slug)) {
      const label = /collectibles-guide/.test(url) ? "Collectibles" : regionName(url, slug);
      add({ name: `PowerPyx (${label})`, url, role: "coletaveis", language: "en" });
    }
  }

  // Steam guides: the 3 best rated that talk about 100% / all achievements.
  const listUrl = `https://steamcommunity.com/app/${game.steamAppId}/guides/?browsefilter=toprated&requiredtags[]=Achievements`;
  const list = await deps.fetchPage(listUrl);
  if (list.status === "ok" && list.html) {
    const picked = parseSteamGuideList(list.html)
      .filter((g) => mentionsAll(g.title, g.description))
      .slice(0, STEAM_GUIDES_PICKED);
    for (const g of picked) {
      const language = guessLanguage(g.title + g.description);
      add({
        name: `Steam: ${g.title}${g.author ? ` (${g.author})` : ""}`,
        url: g.url,
        role: "roteiro_steam",
        ...(language ? { language } : {}),
      });
    }
  }

  add({
    name: "TrueSteamAchievements",
    url: `https://www.truesteamachievements.com/game/${hyphenName(game.name)}/achievements`,
    role: "roteiro_steam",
  });

  // Web search: at most MAX_SEARCHES per call.
  const search = limitSearches(deps.search);
  const perHost = new Map<string, number>();
  for (const query of searchPlan(game.name)) {
    let hits: SearchHit[];
    try {
      hits = await search(query);
    } catch (err) {
      if (isFatalSearchError(err)) throw err;
      deps.onSearchFailure?.(query, err);
      continue;
    }
    for (const hit of hits) {
      let host: string;
      try {
        host = new URL(hit.url).hostname.toLowerCase();
      } catch {
        continue;
      }
      const known = SEARCH_HOSTS.find((h) => h.match.test(host));
      if (!known) continue;
      const n = perHost.get(known.name) ?? 0;
      if (n >= PER_HOST) continue;
      perHost.set(known.name, n + 1);
      add({ name: known.name, url: hit.url, role: known.role });
    }
  }
  return sources;
}
