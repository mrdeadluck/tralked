import { existsSync } from "node:fs";
import { join } from "node:path";
import { BudgetExceededError, RefusalError, UsageLimitError, type Ai } from "./ai/client.js";
import { withUsageRef } from "./ai/usage-context.js";
import { clusterItems, openStories, storyKeyOf, type ClusterItem, type OpenStory } from "./ai/cluster.js";
import { checkNovelty } from "./ai/novelty.js";
import { CATEGORIES, triageItems, type Triage, type TriageInput } from "./ai/triage.js";
import { writeAndCheck, type StoryForWriting, type StorySource } from "./ai/writer.js";
import { alert, alertOncePerDay, checkSourceHealth } from "./alerts.js";
import { assemble, type ArticleMedia, type MediaImage } from "./assemble.js";
import { inSlotWindow, localDay, localHour } from "./clock.js";
import { collectLive, extractText, fetchPage, type FetchFn } from "./collect/index.js";
import { extractMedia } from "./collect/media.js";
import { isValidYoutubeId } from "./collect/youtube.js";
import type { Config, Source } from "./config.js";
import type { ArticleRow, Db, ItemRow, SpendBucket, StoryRow } from "./db.js";
import { gameDestination } from "./game-destination.js";
import { acquireLock, type Lock } from "./lock.js";
import { chooseImages } from "./media/choose.js";
import {
  PautaRejectedError,
  chooseFormat,
  gatherPautaSources,
  markPauta,
  pautaById,
  pautaKey,
  pautaPayload,
  pautaStory,
  pautasPublishedOn,
  pickPautaGame,
  recentFormats,
  recordPauta,
  writePauta,
  type FamousGame,
} from "./pautas.js";
import { TIER_WEIGHT, isBomb, isExpired, isPublishable, storyScore, type Tier } from "./rank.js";
import {
  TralkedError,
  articleKey,
  updateKey,
  type ArticleCategory,
  type ArticlePayload,
  type ContentBlock,
  type FeedArticle,
  type GameMedia,
  type Insights,
  type Tralked,
} from "./tralked.js";

/**
 * The live pipeline: `runColeta` (every 30 min) collects, triages, clusters, queues and handles bombs,
 * updates and follow-ups; `runPublica` (hourly, 06–23 São Paulo) publishes the best queued story.
 * Every day and slot decision goes through `clock.ts` (America/Sao_Paulo). AI calls are sequential.
 */

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
/** Items published longer ago than this are stale (Google News feeds reach back 30–90 days): dropped untriaged. */
export const STALE_ITEM_MS = 48 * HOUR_MS;
/** At most this many open stories (most recent first) are offered to clustering. */
export const OPEN_STORIES_CAP = 300;
/** The site feed window used to skip stories the site already covered. */
export const FEED_WINDOW_MS = 3 * 24 * HOUR_MS;
/** New items of a story published today trigger an update (PATCH) from this importance. */
export const UPDATE_MIN_IMPORTANCE = 50;
/** New items of a story published on an earlier day start a follow-up from this importance. */
export const FOLLOW_UP_MIN_IMPORTANCE = 70;
/**
 * `publica` waits 0–2 min before publishing, so articles do not land on the scheduler's exact minute
 * (it runs every 7 min; a longer wait would run into the next call).
 */
export const JITTER_MAX_MS = 2 * 60 * 1000;
/** Sources given to the writer, full-text and higher tiers first (keeps the Opus prompt bounded). */
export const MAX_WRITER_SOURCES = 8;
/** A story's article is updated at most once an hour (counting from publication) and 3 times a local day. */
export const UPDATE_MIN_GAP_MS = 60 * 60 * 1000;
export const MAX_UPDATES_PER_DAY = 3;
/** Held by whoever publishes (`publica`, and `coleta` for bombs); stale after 30 min. */
export const PUBLISH_LOCK_FILE = "publica.lock";
/** Meta key holding when `publica` last published (ISO), for the PUBLISH_GAP_MINUTES rule. */
/**
 * A source counts as text only with a real article body: a page that gave just its footer or menu
 * (Steam News pages without the post) wrote a story about missing information.
 */
export const MIN_TEXT_CHARS = 400;
export const hasRealText = (text: string | null | undefined) => (text ?? "").trim().length >= MIN_TEXT_CHARS;

const LAST_PUBLISH_KEY = "publica.lastAt";
/** Stories a publishing slot may try, and rejections it accepts before giving the hour up. */
const SLOT_ATTEMPTS = 5;
const SLOT_REJECTIONS = 4;
/** News older than this when published is dated when it broke (see publishStory). */
const OLD_STORY_MS = 12 * 3_600_000;
const FETCH_CONCURRENCY = 6;
const FEED_KEY_PREFIX = "feed-";
/** Pautas Tralked: at most 2 a day (inside `MAX_PER_DAY`), in a slot whose best queued news scores below 60. */
export const MAX_PAUTAS_PER_DAY = 2;
export const PAUTA_SCORE_BELOW = 60;
/** From this local hour, a day without a pauta gives the slot to one, whatever the news score. */
export const PAUTA_HOUR = 20;
/** Games tried in one slot before it falls back to news (each costs only fetches, no AI). */
const PAUTA_GAME_ATTEMPTS = 3;
/**
 * Video stories (a new trailer or gameplay from an official YouTube channel, no text source): publishable
 * from this triage importance, at most `MAX_VIDEO_STORIES_PER_DAY` a local day (inside `MAX_PER_DAY` and
 * the daily budget like any story), and dropped when the same game already had a story in the last
 * `VIDEO_DEDUPE_MS`.
 */
export const VIDEO_MIN_IMPORTANCE = 60;
export const MAX_VIDEO_STORIES_PER_DAY = 4;
export const VIDEO_DEDUPE_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type PipelineDeps = {
  db: Db;
  ai: Ai;
  tralked: Tralked;
  sources: Source[];
  config: Config;
  now: () => Date;
  fetchFn: FetchFn;
  /** Progress lines; silent by default. */
  log?: (line: string) => void;
  /** `config/jogos-famosos.json`: Pautas Tralked are made only when it is given and not empty. */
  famousGames?: FamousGame[];
  /** `publica --revisao`: articles go to the site as drafts (`status: "review"`) for Lucas to check first. */
  revisao?: boolean;
};

export type PublicaDeps = PipelineDeps & {
  sleep: (ms: number) => Promise<void>;
  rand: () => number;
  /** Manual run (`--agora`): skip the jitter wait. */
  agora?: boolean;
  /**
   * Manual run outside the SLOT_FIRST_HOUR–SLOT_LAST_HOUR window (`--fora-do-horario`, implies `agora`).
   * The daily cap, the minimum gap between articles and the daily budget still apply.
   */
  foraDoHorario?: boolean;
  /**
   * Manual override (`--ignorar-limite`): skips `MAX_PER_DAY` and the minimum gap between articles. The daily budget
   * (`DAILY_BUDGET_USD`) is never skipped by a flag.
   */
  ignorarLimite?: boolean;
};

export type ColetaReport = {
  paused: boolean;
  /** Items returned by the collectors / newly stored. */
  collected: number;
  inserted: number;
  sourceFailures: number;
  /** Triage: answered, kept, dropped (not kept or stale). */
  triaged: number;
  kept: number;
  dropped: number;
  textsFetched: number;
  clustered: number;
  newStories: number;
  followUps: number;
  queued: number;
  covered: number;
  expired: number;
  /** Site ids of bombs published in this run. */
  published: string[];
  /** Same-day updates PATCHed. */
  updated: number;
  /** Video stories dropped or merged because the same game already has a story (site or queue). */
  videoDuplicates: number;
  /** The site feed could not be read: nothing new was queued in this run (the run went on). */
  feedUnavailable: boolean;
  /** Why the run stopped early, when it did (budget, site API). */
  stopped: string | null;
};

export type PublicaResult = { published: string | null; reason: string };

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export function isPaused(config: Pick<Config, "DATA_DIR">): boolean {
  return existsSync(join(config.DATA_DIR, "PAUSADO"));
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function triageOf(item: ItemRow): Triage | null {
  if (!item.triage_json) return null;
  try {
    return JSON.parse(item.triage_json) as Triage;
  } catch {
    return null;
  }
}

export function parseGames(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

/** When the item happened, never in the future: `min(pubDate, now)`, or the fetch time without a date. */
export function itemTime(item: ItemRow, now: Date): number {
  const pub = item.published_at ? Date.parse(item.published_at) : Number.NaN;
  const at = Number.isNaN(pub) ? Date.parse(item.fetched_at) : pub;
  return Math.min(Number.isNaN(at) ? now.getTime() : at, now.getTime());
}

/**
 * When the story started: its earliest item time (`min(pubDate, now)`), so old items cannot pass as fresh
 * news. Falls back to `first_seen_at` for a story without items.
 */
function storyStartedAt(story: StoryRow, db: Db, now: Date): Date {
  const times = db.itemsForStory(story.id).map((i) => itemTime(i, now));
  return times.length > 0 ? new Date(Math.min(...times)) : new Date(story.first_seen_at);
}

function expired(story: StoryRow, deps: PipelineDeps, now: Date): boolean {
  return isExpired(
    { score: story.score, firstSeenAt: storyStartedAt(story, deps.db, now) },
    now,
    deps.config.NEWS_MAX_AGE_HOURS,
  );
}

/** Minutes left before `publica` may publish again (PUBLISH_GAP_MINUTES after the last article), or 0. */
function gapLeft(deps: PublicaDeps, now: Date): number {
  const last = deps.db.getMeta(LAST_PUBLISH_KEY);
  const at = last ? Date.parse(last) : NaN;
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at + deps.config.PUBLISH_GAP_MINUTES * 60_000 - now.getTime()) / 60_000));
}

/** Runs `fn` holding the publish lock; returns `null` without running it when another run holds the lock. */
async function withPublishLock<T>(deps: PipelineDeps, fn: () => Promise<T>): Promise<{ value: T } | null> {
  const lock: Lock | null = acquireLock(join(deps.config.DATA_DIR, PUBLISH_LOCK_FILE), deps.now());
  if (!lock) return null;
  try {
    // Holding the lock, no one else is writing: a `written` live story is left over from a crashed run.
    for (const story of deps.db.storiesByStatus("written", 100_000)) {
      if (story.mode === "live") deps.db.setStoryStatusIf(story.id, "queued", ["written"]);
    }
    return { value: await fn() };
  } finally {
    lock.release();
  }
}

/** One budget alert per local day (it would otherwise repeat every run). */
function budgetAlert(db: Db, error: BudgetExceededError, now: Date): void {
  if (error instanceof UsageLimitError) {
    alertOncePerDay(
      db,
      "orcamento",
      `Robô parado: ${error.message}. Ele tenta de novo a cada rodada e volta sozinho quando o limite liberar.`,
      now,
      "Limite da assinatura do Claude",
    );
    return;
  }
  alertOncePerDay(db, "orcamento", `Teto de gasto atingido: ${error.message}. O robô para até amanhã.`, now, "Teto de gasto");
}

/** "Custo: 41,2 mil tokens, ~US$ 0,38 se fosse pela API; limite semanal em 46%" (the subscription counter). */
export function usageLine(db: Db, ref: { storyId?: number; pautaId?: number }): string | null {
  const where = ref.storyId !== undefined ? "story_id = ?" : "pauta_id = ?";
  const id = ref.storyId ?? ref.pautaId;
  if (id === undefined) return null;
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS runs, COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens,
              COALESCE(SUM(usd_equivalent), 0) AS usd FROM claude_usage WHERE ${where}`,
    )
    .get(id) as { runs: number; tokens: number; usd: number };
  if (row.runs === 0) return null;
  const week = db.lastWeeklyUtilization();
  const tokens = row.tokens >= 1000 ? `${(row.tokens / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(row.tokens);
  const usd = row.usd.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `custo: ${tokens} tokens, ~US$ ${usd} se fosse pela API${week === null ? "" : `; limite semanal em ${Math.round(week * 100)}%`}`;
}

/** One `pausado` alert per local day, whichever command was stopped by the PAUSADO file. */
function pausedAlert(deps: Pick<PipelineDeps, "db" | "config">, now: Date): void {
  alertOncePerDay(
    deps.db,
    "pausado",
    `Arquivo PAUSADO presente em ${join(deps.config.DATA_DIR, "PAUSADO")}: o robô não coleta nem publica. Apague o arquivo para retomar.`,
    now,
    "Arquivo PAUSADO",
  );
}

export async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await worker(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

/**
 * Resolves triaged game names to site games, one lookup per name. Lookup failures count as "not found".
 * A game with a destination (`gameDestination`: Mass Effect 1-3 → Legendary Edition) resolves to it,
 * whether the triage named it or the catalog search found it.
 */
function gameResolver(tralked: Tralked) {
  const cache = new Map<string, Promise<{ slug: string; name: string } | null>>();
  return (name: string) => {
    const key = name.trim().toLowerCase();
    let hit = cache.get(key);
    if (!hit) {
      const destination = gameDestination(name);
      hit = destination
        ? Promise.resolve(destination)
        : tralked
            .findGame(name)
            .then((found) => (found ? (gameDestination(found.name) ?? gameDestination(found.slug) ?? found) : null))
            .catch(() => null);
      cache.set(key, hit);
    }
    return hit;
  };
}

// ---------------------------------------------------------------------------------------------
// Videos (official YouTube channels)
// ---------------------------------------------------------------------------------------------

export const isVideoItem = (item: ItemRow) => isValidYoutubeId(item.video_id);

/** A video story: an official video and no text source besides it (title-only items do not count). */
export function isVideoOnly(items: ItemRow[]): boolean {
  return items.some(isVideoItem) && !items.some((i) => !isVideoItem(i) && i.text_unavailable !== 1 && hasRealText(i.text));
}

/** The video a story embeds: from a `pt` channel first, then the most important, then the oldest. */
export function storyVideo(items: ItemRow[], sources: Source[]): { item: ItemRow; source: Source | undefined } | null {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const ranked = items
    .filter(isVideoItem)
    .map((item) => ({ item, source: byId.get(item.source_id), importance: triageOf(item)?.importance ?? 0 }))
    .sort(
      (a, b) =>
        Number(b.source?.lang === "pt") - Number(a.source?.lang === "pt") || b.importance - a.importance || a.item.id - b.item.id,
    );
  return ranked[0] ?? null;
}

/** Name of a channel as readers know it: "PlayStation (YouTube channel)" → "PlayStation". */
const channelName = (source: Source | undefined, item: ItemRow) =>
  (source?.name ?? item.source_id).replace(/\s*\((?:YouTube|canal)[^)]*\)\s*$/i, "").trim();

/** Live video stories published on the local `day` (they have their own daily cap). */
function videoStoriesPublishedOn(db: Db, day: string): number {
  const mid = Date.parse(`${day}T12:00:00Z`);
  const rows = db.raw
    .prepare("SELECT story_id, published_at FROM articles WHERE status = 'published' AND published_at >= ? AND published_at <= ?")
    .all(new Date(mid - 2 * 24 * HOUR_MS).toISOString(), new Date(mid + 2 * 24 * HOUR_MS).toISOString()) as unknown as {
    story_id: number;
    published_at: string;
  }[];
  return rows.filter((r) => localDay(new Date(r.published_at)) === day && isVideoOnly(db.itemsForStory(r.story_id))).length;
}

const videoCapReached = (db: Db, now: Date) => videoStoriesPublishedOn(db, localDay(now)) >= MAX_VIDEO_STORIES_PER_DAY;

/** Game names compared loosely: "Marvel’s Wolverine" = "marvel's wolverine". */
const gameKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// ---------------------------------------------------------------------------------------------
// Story facts
// ---------------------------------------------------------------------------------------------

export type StoryFacts = {
  items: ItemRow[];
  triages: Triage[];
  score: number;
  bomb: boolean;
  rumor: boolean;
  publishable: boolean;
  category: Triage["category"] | null;
  games: string[];
  lastItemAt: number;
  /** No text source besides an official video (see `isVideoOnly`). */
  videoOnly: boolean;
};

export function storyFacts(story: StoryRow, deps: PipelineDeps, now: Date): StoryFacts {
  const sourcesById = new Map(deps.sources.map((s) => [s.id, s]));
  const items = deps.db.itemsForStory(story.id);
  const withTriage = items.flatMap((item) => {
    const t = triageOf(item);
    return t ? [{ item, t }] : [];
  });
  const triages = withTriage.map((x) => x.t);
  const tierOf = (item: ItemRow): Tier => sourcesById.get(item.source_id)?.tier ?? "outro";
  const tiers = items.map(tierOf);
  const sourceCount = new Set(items.map((i) => i.source_id)).size;
  const maxImportance = Math.max(0, ...triages.map((t) => t.importance));
  // A rumor until an official source reports it as fact.
  const rumor =
    triages.some((t) => t.rumor) && !withTriage.some(({ item, t }) => tierOf(item) === "oficial" && !t.rumor);
  // R15: at least one source with extracted text (title-only Google News items have none).
  const hasFullText = items.some((i) => i.text_unavailable !== 1 && hasRealText(i.text));
  const top = [...triages].sort((a, b) => b.importance - a.importance)[0];
  const stats = { maxImportance, tiers, sourceCount, rumor };
  // A video story stands on the official video alone: a relevant one (importance >= 60), never a rumor.
  const videoOnly = isVideoOnly(items);
  const relevantVideo =
    videoOnly &&
    !rumor &&
    withTriage.some(({ item, t }) => isVideoItem(item) && tierOf(item) === "oficial" && t.importance >= VIDEO_MIN_IMPORTANCE);
  return {
    items,
    triages,
    score: storyScore(stats),
    bomb: isBomb(stats),
    rumor,
    publishable: isPublishable({ ...stats, hasFullText }) || relevantVideo,
    category: top && (CATEGORIES as readonly string[]).includes(top.category) ? top.category : null,
    games: [...new Set(triages.flatMap((t) => t.games))],
    lastItemAt: Math.max(0, ...items.map((i) => itemTime(i, now))),
    videoOnly,
  };
}

/** Recomputes score, bomb, rumor, category, games and last item time; keeps headline, status and mode. */
export function recomputeStory(storyId: number, deps: PipelineDeps, now: Date): StoryFacts | null {
  const story = deps.db.storyById(storyId);
  if (!story) return null;
  const facts = storyFacts(story, deps, now);
  deps.db.upsertStory(
    {
      key: story.key,
      headline: story.headline,
      category: facts.category ?? story.category,
      score: facts.score,
      bomb: facts.bomb,
      rumor: facts.rumor,
      gamesJson: JSON.stringify(facts.games),
      mode: story.mode,
      lastItemAt: new Date(facts.lastItemAt || now.getTime()).toISOString(),
    },
    now,
  );
  return facts;
}

// ---------------------------------------------------------------------------------------------
// Writing and publishing
// ---------------------------------------------------------------------------------------------

/** The story's sources for the writer: full text first, higher tiers first, at most `MAX_WRITER_SOURCES`. */
function writerSources(items: ItemRow[], sources: Source[]): StorySource[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: StorySource[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const source = byId.get(item.source_id);
    if (isVideoItem(item)) {
      // An official video: its title and description are the material (the watch page is never fetched).
      out.push({
        name: source?.name ?? item.source_id,
        tier: source?.tier ?? "outro",
        url: item.url,
        publishedAt: item.published_at ? new Date(item.published_at) : null,
        text: [`Vídeo publicado no YouTube pelo canal oficial ${channelName(source, item)}.`, `Título do vídeo: ${item.title}`, `Descrição: ${item.summary?.trim() || "(sem descrição)"}`].join("\n"),
        title: item.title,
      });
      continue;
    }
    const titleOnly = item.text_unavailable === 1;
    const text = titleOnly ? "" : (item.text ?? "").trim();
    out.push({
      // Google News items carry the real outlet as `publisher`: that is who gets cited (R15).
      name: item.publisher ?? source?.name ?? item.source_id,
      tier: source?.tier ?? "outro",
      url: item.url,
      publishedAt: item.published_at ? new Date(item.published_at) : null,
      text,
      title: item.title,
      ...(titleOnly ? { textUnavailable: true as const } : {}),
    });
  }
  const rank = (s: StorySource) => (s.text ? 1000 : 0) + TIER_WEIGHT[s.tier];
  return out.sort((a, b) => rank(b) - rank(a)).slice(0, MAX_WRITER_SOURCES);
}

async function candidatesFor(story: StoryRow, tralked: Tralked): Promise<StoryForWriting["candidates"]> {
  const resolve = gameResolver(tralked);
  const out: StoryForWriting["candidates"] = [];
  for (const name of parseGames(story.games_json)) {
    const hit = await resolve(name);
    if (!hit || out.some((c) => c.slug === hit.slug)) continue;
    let insights: Insights | null = null;
    try {
      insights = await tralked.insights(hit.slug);
    } catch {
      insights = null; // "No Tralked" is optional; the article does not depend on it
    }
    out.push({ slug: hit.slug, name: hit.name, insights });
  }
  return out;
}

const parsePayload = (article: ArticleRow): Partial<ArticlePayload> => {
  try {
    return JSON.parse(article.payload_json) as Partial<ArticlePayload>;
  } catch {
    return {};
  }
};

/** A follow-up's parent article: its text for the writer and its public URL for the "Entenda o caso" link. */
function parentOf(story: StoryRow, deps: PipelineDeps): { title: string; blocksText: string; url: string | null } | null {
  if (story.parent_article_id === null) return null;
  const article = deps.db.articleById(story.parent_article_id);
  if (!article) return null;
  const payload = parsePayload(article);
  const title = payload.title ?? deps.db.storyById(article.story_id)?.headline ?? "";
  const url = article.slug ? new URL(`/noticias/${encodeURIComponent(article.slug)}`, deps.config.TRALKED_API_URL).toString() : null;
  return { title, blocksText: blocksText(payload.blocks ?? []), url };
}

export async function storyForWriting(
  story: StoryRow,
  deps: PipelineDeps,
  previous?: StoryForWriting["previous"],
): Promise<StoryForWriting> {
  const parent = parentOf(story, deps);
  const items = deps.db.itemsForStory(story.id);
  const video = storyVideo(items, deps.sources);
  return {
    id: story.id,
    headline: story.headline,
    category: story.category as ArticleCategory,
    rumor: story.rumor === 1,
    sources: writerSources(items, deps.sources),
    candidates: await candidatesFor(story, deps.tralked),
    ...(previous ? { previous } : {}),
    ...(parent ? { parent: { title: parent.title, blocksText: parent.blocksText } } : {}),
    ...(video
      ? {
          video: {
            youtubeId: video.item.video_id!,
            title: video.item.title,
            channel: channelName(video.source, video.item),
            only: isVideoOnly(items),
          },
        }
      : {}),
  };
}

/** The companies the story is about, from its most important items first (triage `companies`). */
export function storyCompanies(items: ItemRow[]): string[] {
  const triages = items.flatMap((i) => {
    const t = triageOf(i);
    return t ? [t] : [];
  });
  const out: string[] = [];
  for (const t of triages.sort((a, b) => b.importance - a.importance)) {
    for (const c of t.companies ?? []) if (c.trim() && !out.some((o) => o.toLowerCase() === c.trim().toLowerCase())) out.push(c.trim());
  }
  return out;
}

/** The images an article already has (an update keeps them: no second vision call, no new uploads). */
function previousImages(blocks: ContentBlock[] | undefined): Pick<ArticleMedia, "cover" | "bodyImage"> {
  const images = (blocks ?? []).flatMap((b) => (b.type === "image" ? [b] : []));
  const toMedia = (b: (typeof images)[number]): MediaImage => ({
    url: b.url,
    alt: b.alt,
    credit: b.credit,
    ...(b.creditUrl ? { creditUrl: b.creditUrl } : {}),
  });
  return { ...(images[0] ? { cover: toMedia(images[0]) } : {}), ...(images[1] ? { bodyImage: toMedia(images[1]) } : {}) };
}

/**
 * The media of an article (see `ArticleMedia`):
 * - the story's official video when it has one;
 * - the images `chooseImages` picks (official images of the sources, the catalog of the exact game);
 * - the game's trailer from the catalog when the article is about exactly one game and has no video.
 * The catalog is the first game the writer linked (`findGame` resolves exact games only). A catalog or
 * image failure only costs the media, never the article; the subscription limit stops the run.
 */
export async function articleMedia(
  story: StoryRow,
  writing: StoryForWriting,
  payload: ArticlePayload,
  deps: Pick<PipelineDeps, "tralked" | "log" | "db" | "ai" | "config" | "fetchFn" | "sources">,
  reuse?: Pick<ArticleMedia, "cover" | "bodyImage">,
): Promise<ArticleMedia> {
  const items = deps.db.itemsForStory(story.id);
  const linked = (payload.games ?? []).flatMap((g) => ("slug" in g ? [g.slug] : []));
  const slug = linked[0] ?? writing.candidates[0]?.slug;
  let set: GameMedia | null = null;
  if (slug) {
    try {
      set = await deps.tralked.media(slug);
    } catch (error) {
      deps.log?.(`mídia indisponível para ${slug}: ${errorMessage(error)}`);
    }
  }
  const media: ArticleMedia = {};
  if (writing.video) media.video = { youtubeId: writing.video.youtubeId, title: writing.video.title };

  if (reuse?.cover) {
    Object.assign(media, reuse);
  } else {
    const companies = storyCompanies(items);
    const games = parseGames(story.games_json);
    const subject = games[0] ?? set?.game.name ?? companies[0] ?? story.headline;
    const images = await chooseImages(
      {
        story,
        items,
        sources: deps.sources,
        companies,
        subject,
        catalog: set,
        officialVideoIds: writing.video ? [writing.video.youtubeId] : [],
      },
      { ai: deps.ai, config: deps.config, fetchFn: deps.fetchFn, tralked: deps.tralked, ...(deps.log ? { log: deps.log } : {}) },
    );
    Object.assign(media, images);
  }

  const trailer = set?.videos[0];
  if (!writing.video && trailer && linked.length === 1) media.trailer = { youtubeId: trailer.youtubeId, title: `Vídeo de ${set!.game.name}` };
  return media;
}

/** `assemble` with the article's media: the games the writer linked decide which catalog is used. */
async function assembleWithMedia(
  draft: Parameters<typeof assemble>[0],
  story: StoryRow,
  writing: StoryForWriting,
  deps: PipelineDeps,
  updatedAt?: Date,
  reuse?: Pick<ArticleMedia, "cover" | "bodyImage">,
): Promise<ArticlePayload> {
  const opts = assembleOpts(story, writing, deps, updatedAt);
  const plain = assemble(draft, writing, opts);
  const media = await articleMedia(story, writing, plain, deps, reuse);
  return Object.keys(media).length > 0 ? assemble(draft, writing, { ...opts, media }) : plain;
}

export const insightsOf = (candidates: StoryForWriting["candidates"]) =>
  new Map(candidates.flatMap((c) => (c.insights ? [[c.slug, c.insights] as const] : [])));

/** `assemble` options: the Tralked data, and the parent link of a follow-up. */
function assembleOpts(story: StoryRow, writing: StoryForWriting, deps: PipelineDeps, updatedAt?: Date) {
  const parent = parentOf(story, deps);
  return {
    insights: insightsOf(writing.candidates),
    ...(updatedAt ? { updatedAt } : {}),
    ...(parent?.url && parent.title ? { parent: { title: parent.title, url: parent.url } } : {}),
  };
}

/** Plain text of an article's blocks, given to the writer as the previous version on an update. */
export function blocksText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
        case "paragraph":
        case "callout":
          return b.text;
        case "list":
          return b.items.map((i) => `- ${i}`).join("\n");
        case "quote":
          return b.author ? `"${b.text}" (${b.author})` : `"${b.text}"`;
        case "table":
          return [b.header, ...b.rows].map((r) => r.join(" | ")).join("\n");
        default:
          return "";
      }
    })
    .filter((t) => t !== "")
    .join("\n\n");
}

/** `published`: on the site. `rejected`: check failed twice or refused, story dropped. `busy`: someone else claimed it. */
type PublishOutcome = { kind: "published"; id: string } | { kind: "rejected" } | { kind: "busy" };

/** `publishOneInner` with its AI runs counted for the story (`claude_usage.story_id`). */
function publishOne(story: StoryRow, deps: PipelineDeps): Promise<PublishOutcome> {
  return withUsageRef({ storyId: story.id }, () => publishOneInner(story, deps));
}

async function publishOneInner(story: StoryRow, deps: PipelineDeps): Promise<PublishOutcome> {
  const { db, ai, tralked, config } = deps;
  const now = deps.now();
  // Atomic claim: only one run may write a given story.
  if (!db.setStoryStatusIf(story.id, "written", ["queued"])) return { kind: "busy" };

  try {
    const saved = db.articleForStory(story.id);
    if (saved?.status === "published" && saved.site_id) {
      db.setStoryStatus(story.id, "published");
      return { kind: "published", id: saved.site_id };
    }

    let payload: ArticlePayload;
    if (saved?.status === "ready") {
      payload = JSON.parse(saved.payload_json) as ArticlePayload;
    } else {
      const writing = await storyForWriting(story, deps);
      let result: Awaited<ReturnType<typeof writeAndCheck>>;
      try {
        result = await writeAndCheck(ai, writing, "live", { models: config, now });
      } catch (error) {
        if (error instanceof BudgetExceededError) budgetAlert(db, error, now);
        if (error instanceof RefusalError) {
          db.setStoryStatus(story.id, "dropped");
          alert(db, "recusa", `História ${story.id} "${story.headline}": ${error.message}`, now);
          return { kind: "rejected" };
        }
        throw error;
      }
      if (!result.ok) {
        db.setStoryStatus(story.id, "dropped");
        alert(
          db,
          "checagem",
          `História ${story.id} "${story.headline}" reprovada duas vezes na checagem: ${result.problems.join(" | ")}`,
          now,
        );
        return { kind: "rejected" };
      }
      try {
        payload = await assembleWithMedia(result.draft, story, writing, deps);
      } catch (error) {
        if (error instanceof BudgetExceededError) budgetAlert(db, error, now);
        throw error;
      }
      // A story that broke more than OLD_STORY_MS ago is dated when it broke, not today: the queue also
      // holds older news, and a batch of them must not look like it all happened at once.
      const brokeAt = storyStartedAt(story, db, now);
      if (now.getTime() - brokeAt.getTime() > OLD_STORY_MS) payload = { ...payload, publishedAt: brokeAt.toISOString() };
      db.saveArticle(
        { storyId: story.id, payloadJson: JSON.stringify(payload), status: "ready", parentArticleId: story.parent_article_id },
        now,
      );
    }

    // `--revisao`: the article goes to the site's admin as a draft for Lucas to check.
    if (deps.revisao) payload = { ...payload, status: "review" };
    let created: { id: string; slug: string };
    try {
      created = await tralked.createArticle(payload, articleKey("live", story.id));
    } catch (error) {
      if (error instanceof TralkedError) {
        const permanent = error.status >= 400 && error.status < 500 && error.status !== 429;
        alert(db, "api", `Falha ao publicar a história ${story.id} "${story.headline}": ${error.status} ${error.message}`, now);
        if (permanent) {
          db.markArticle(story.id, { status: "failed" }, now);
          db.setStoryStatus(story.id, "dropped");
        }
      }
      throw error;
    }

    const publishedAt = deps.now();
    db.saveArticle(
      {
        storyId: story.id,
        payloadJson: JSON.stringify(payload),
        status: "published",
        siteId: created.id,
        slug: created.slug,
        publishedAt: publishedAt.toISOString(),
        parentArticleId: story.parent_article_id,
      },
      publishedAt,
    );
    db.setStoryStatus(story.id, "published");
    deps.log?.(`${deps.revisao ? "rascunho enviado" : "publicada"}: história ${story.id} → ${created.id} (${payload.title})`);
    const cost = usageLine(db, { storyId: story.id });
    if (cost) deps.log?.(`  ${cost}`);
    return { kind: "published", id: created.id };
  } catch (error) {
    // Budget, transient site errors and anything unexpected: back to the queue (final states stay).
    db.setStoryStatusIf(story.id, "queued", ["written"]);
    throw error;
  }
}

/**
 * Claims, writes, checks and publishes one story. Callers hold the publish lock.
 * - Returns the site article id when published.
 * - Returns null when the check failed twice or the writer refused (the story is `dropped` and an alert
 *   raised), or when another run already claimed the story.
 * - Throws `BudgetExceededError` (alert raised, story back to `queued`) and `TralkedError` (alert raised; back
 *   to `queued` unless the site refused the article for good) so the caller stops the run.
 * The checked payload is saved as `ready` before the POST, so a failed POST never pays for a second draft.
 */
export async function publishStory(story: StoryRow, deps: PipelineDeps): Promise<string | null> {
  const outcome = await publishOne(story, deps);
  return outcome.kind === "published" ? outcome.id : null;
}

/**
 * Same-day update, only for a relevant new fact:
 * - at least `UPDATE_MIN_GAP_MS` since publication or the last update, and at most `MAX_UPDATES_PER_DAY` a day;
 * - a cheap novelty call (fast model) on the items that arrived since then must find new facts;
 * - the writer then rewrites the article with the previous version and those facts, and it is PATCHed with
 *   the "Atualizado às" note. `published_at` is untouched, so the day count does not change.
 * Returns true when patched. The idempotency key's counter is the story's item count, which only grows.
 */
function updateStory(story: StoryRow, deps: PipelineDeps): Promise<boolean> {
  return withUsageRef({ storyId: story.id }, () => updateStoryInner(story, deps));
}

async function updateStoryInner(story: StoryRow, deps: PipelineDeps): Promise<boolean> {
  const { db, ai, tralked, config } = deps;
  const now = deps.now();
  const article = db.articleForStory(story.id);
  if (!article?.site_id || !article.published_at || article.status !== "published") return false;

  const updates = db.updateTimes(story.id);
  const today = localDay(now);
  if (updates.filter((at) => localDay(new Date(at)) === today).length >= MAX_UPDATES_PER_DAY) {
    deps.log?.(`atualização adiada (limite de ${MAX_UPDATES_PER_DAY} por dia): história ${story.id}`);
    return false;
  }
  const lastChange = Math.max(Date.parse(article.published_at), ...updates.map((at) => Date.parse(at)));
  if (now.getTime() - lastChange < UPDATE_MIN_GAP_MS) {
    deps.log?.(`atualização adiada (menos de 60 min desde a última mudança): história ${story.id}`);
    return false;
  }

  // Everything that arrived since the article last changed, including items a gap or the cap held back.
  const pending = db.itemsForStory(story.id).filter((i) => Date.parse(i.fetched_at) > lastChange);
  if (pending.length === 0) return false;
  const previousPayload = parsePayload(article);
  const previousTitle = previousPayload.title ?? story.headline;
  const previousText = blocksText(previousPayload.blocks ?? []);

  let result: Awaited<ReturnType<typeof writeAndCheck>>;
  try {
    const novelty = await checkNovelty(
      ai,
      {
        articleTitle: previousTitle,
        articleText: previousText,
        items: pending.map((i) => ({ title: i.title, text: i.text_unavailable === 1 ? "" : (i.text ?? i.summary ?? "") })),
      },
      "live",
      { model: config.MODEL_FAST },
    );
    if (!novelty.hasNewFacts) {
      deps.log?.(`sem fato novo: história ${story.id}`);
      return false;
    }
    const writing = await storyForWriting(story, deps, {
      title: previousTitle,
      blocksText: previousText,
      newFacts: novelty.newFacts,
    });
    result = await writeAndCheck(ai, writing, "live", { models: config, now });
    if (!result.ok) {
      alert(
        db,
        "checagem",
        `Atualização da história ${story.id} "${story.headline}" reprovada duas vezes na checagem: ${result.problems.join(" | ")}`,
        now,
      );
      return false;
    }

    const payload = await assembleWithMedia(result.draft, story, writing, deps, now, previousImages(previousPayload.blocks));
    const { status: _status, ...patch } = payload;
    try {
      await tralked.patchArticle(article.site_id, patch, updateKey(article.site_id, db.itemIdsForStory(story.id).length));
    } catch (error) {
      if (error instanceof TralkedError) {
        alert(db, "api", `Falha ao atualizar a matéria ${article.site_id}: ${error.status} ${error.message}`, now);
      }
      throw error;
    }
    db.saveArticle({ storyId: story.id, payloadJson: JSON.stringify(payload), status: "published" }, now);
    db.recordUpdate(story.id, now);
    deps.log?.(`atualizada: história ${story.id} (${article.site_id})`);
    return true;
  } catch (error) {
    if (error instanceof BudgetExceededError) budgetAlert(db, error, now);
    if (error instanceof RefusalError) {
      alert(db, "recusa", `Atualização da história ${story.id} "${story.headline}": ${error.message}`, now);
      return false;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// coleta
// ---------------------------------------------------------------------------------------------

const emptyReport = (): ColetaReport => ({
  paused: false,
  collected: 0,
  inserted: 0,
  sourceFailures: 0,
  triaged: 0,
  kept: 0,
  dropped: 0,
  textsFetched: 0,
  clustered: 0,
  newStories: 0,
  followUps: 0,
  queued: 0,
  covered: 0,
  expired: 0,
  published: [],
  updated: 0,
  videoDuplicates: 0,
  feedUnavailable: false,
  stopped: null,
});

async function collectAndStore(deps: PipelineDeps, report: ColetaReport, now: Date): Promise<void> {
  const { db, sources } = deps;
  const result = await collectLive(sources, deps.fetchFn, now);
  report.collected = result.items.length;
  report.sourceFailures = result.failures.length;
  for (const item of result.items) {
    const inserted = db.insertItemIfNew(
      {
        url: item.url,
        sourceId: item.sourceId,
        title: item.title,
        summary: item.summary,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        publisher: item.publisher ?? null,
        textUnavailable: item.textUnavailable === true,
        videoId: item.videoId ?? null,
      },
      now,
    );
    if (inserted) report.inserted++;
  }
  const failed = new Set(result.failures.map((f) => f.sourceId));
  for (const f of result.failures) db.markSourceError(f.sourceId, f.error, now);
  for (const s of sources) if (s.active && !failed.has(s.id)) db.markSourceOk(s.id, now);
}

/** Triages every `new` item; unanswered items stay `new` for the next run. */
async function triageNew(deps: PipelineDeps, report: ColetaReport, now: Date): Promise<void> {
  const { db, ai, config } = deps;
  const sourcesById = new Map(deps.sources.map((s) => [s.id, s]));
  const inputs: TriageInput[] = [];
  for (const item of db.itemsByStatus("new", 100_000)) {
    const source = sourcesById.get(item.source_id);
    const stale = item.published_at !== null && now.getTime() - Date.parse(item.published_at) > STALE_ITEM_MS;
    if (!source || stale) {
      db.setItemStatus(item.id, "dropped");
      report.dropped++;
      continue;
    }
    inputs.push({ id: item.id, title: item.title, summary: item.summary, source });
  }
  if (inputs.length === 0) return;
  const triages = await triageItems(ai, inputs, "live", { model: config.MODEL_FAST });
  for (const t of triages) {
    db.setItemStatus(t.id, t.keep ? "triaged" : "dropped", JSON.stringify(t));
    report.triaged++;
    if (t.keep) report.kept++;
    else report.dropped++;
  }
}

/**
 * Downloads and extracts the article text of the given items that have none yet (never for title-only
 * items), 6 at a time. Returns how many texts were stored.
 */
export async function fetchItemTexts(items: ItemRow[], deps: Pick<PipelineDeps, "db" | "fetchFn" | "log">): Promise<number> {
  const pending = items.filter((i) => i.text_unavailable !== 1 && (i.text ?? "").trim() === "");
  let fetched = 0;
  await pool(pending, FETCH_CONCURRENCY, async (item) => {
    try {
      const { text, finalUrl } = await fetchPage(item.url, deps.fetchFn);
      deps.db.setItemMedia(item.id, extractMedia(text, finalUrl));
      const extracted = extractText(text, finalUrl);
      if (extracted?.text) {
        deps.db.setItemText(item.id, extracted.text);
        fetched++;
      }
    } catch (error) {
      deps.log?.(`texto indisponível: ${item.url} (${errorMessage(error)})`);
    }
  });
  return fetched;
}

/** Downloads and extracts the article text of kept items (never for title-only items). */
async function fetchTexts(deps: PipelineDeps, report: ColetaReport): Promise<void> {
  report.textsFetched += await fetchItemTexts(deps.db.itemsByStatus("triaged", 100_000), deps);
}

/**
 * Clusters every `triaged` item against the open stories. Results are processed in order and every item
 * goes to `storyKeyOf(r)`: a founder creates `item-<id>`, and the items after it join that key.
 * Returns the stories that got items, with those items.
 */
async function clusterTriaged(deps: PipelineDeps, report: ColetaReport, now: Date): Promise<Map<number, ItemRow[]>> {
  const { db, ai, config } = deps;
  const touched = new Map<number, ItemRow[]>();
  const items = db.itemsByStatus("triaged", 100_000);
  const triages = new Map(items.flatMap((i) => {
    const t = triageOf(i);
    return t ? [[i.id, t] as const] : [];
  }));
  const inputs: ClusterItem[] = items
    .filter((i) => triages.has(i.id))
    .map((i) => ({ id: i.id, headlinePt: triages.get(i.id)!.headlinePt, games: triages.get(i.id)!.games }));
  if (inputs.length === 0) return touched;

  const open = openStories(db, now).slice(0, OPEN_STORIES_CAP);
  const results = await clusterItems(ai, inputs, open, "live", { model: config.MODEL_FAST });
  const byId = new Map(items.map((i) => [i.id, i]));

  for (const r of results) {
    const item = byId.get(r.id);
    const t = triages.get(r.id);
    if (!item || !t) continue;
    const key = storyKeyOf(r);
    let story = db.storyByKey(key);
    if (!story) {
      const id = db.upsertStory(
        {
          key,
          headline: r.newHeadline?.trim() || t.headlinePt,
          category: t.category,
          score: 0,
          bomb: false,
          rumor: t.rumor,
          gamesJson: JSON.stringify(t.games),
          mode: "live",
          status: "open",
          lastItemAt: new Date(itemTime(item, now)).toISOString(),
        },
        now,
      );
      story = db.storyById(id)!;
      report.newStories++;
    }
    db.attachItem(story.id, item.id);
    db.setItemStatus(item.id, "clustered");
    report.clustered++;
    touched.set(story.id, [...(touched.get(story.id) ?? []), item]);
  }
  return touched;
}

/**
 * For published stories that got new items:
 * - same-day ones with `importance >= 50` are returned as update candidates (`updateStory` then requires
 *   a relevant new fact, the 60-min gap and the daily cap);
 * - earlier-day ones with `importance >= 70` get a follow-up story. An `open` or `queued` follow-up of the
 *   same article absorbs the items instead; no new follow-up starts while one is being written or when one
 *   was already created today.
 */
function planUpdatesAndFollowUps(
  touched: Map<number, ItemRow[]>,
  deps: PipelineDeps,
  report: ColetaReport,
  now: Date,
): StoryRow[] {
  const { db } = deps;
  const today = localDay(now);
  const updates: StoryRow[] = [];
  for (const [storyId, newItems] of touched) {
    const story = db.storyById(storyId);
    if (!story || story.status !== "published") continue;
    const article = db.articleForStory(story.id);
    if (!article?.published_at || article.status !== "published") continue;
    const ranked = newItems
      .map((item) => ({ item, t: triageOf(item) }))
      .filter((x): x is { item: ItemRow; t: Triage } => x.t !== null)
      .sort((a, b) => b.t.importance - a.t.importance);
    const top = ranked[0];
    if (!top) continue;

    if (localDay(new Date(article.published_at)) === today) {
      if (top.t.importance >= UPDATE_MIN_IMPORTANCE) updates.push(story);
      continue;
    }
    if (top.t.importance < FOLLOW_UP_MIN_IMPORTANCE) continue;

    const existing = db.followUpsOf(article.id);
    const pending = existing.find((s) => s.status === "open" || s.status === "queued");
    if (!pending) {
      const blocked = existing.some((s) => s.status === "written" || localDay(new Date(s.first_seen_at)) === today);
      if (blocked) continue;
    }
    const followUpId =
      pending?.id ??
      db.upsertStory(
        {
          key: `followup-${story.id}-${top.item.id}`,
          headline: top.t.headlinePt,
          category: top.t.category,
          score: 0,
          bomb: false,
          rumor: top.t.rumor,
          gamesJson: JSON.stringify(top.t.games),
          mode: "live",
          status: "open",
          lastItemAt: new Date(itemTime(top.item, now)).toISOString(),
          parentArticleId: article.id,
        },
        now,
      );
    for (const { item } of ranked) db.attachItem(followUpId, item.id);
    recomputeStory(followUpId, deps, now);
    if (!pending) report.followUps++;
  }
  return updates;
}

/** Expires live `open`/`queued` stories, counting age from their earliest item. */
function expireStale(deps: PipelineDeps, report: ColetaReport, now: Date): void {
  for (const status of ["open", "queued"] as const) {
    for (const story of deps.db.storiesByStatus(status, 100_000)) {
      if (story.mode !== "live" || !expired(story, deps, now)) continue;
      if (deps.db.setStoryStatusIf(story.id, "expired", ["open", "queued"])) report.expired++;
    }
  }
}

/**
 * Stories the site already covered: the same game slug and a title match decided by `clusterItems`, with
 * the feed articles passed as open stories. A follow-up never counts as covered by its own parent article.
 */
export async function coveredStories(
  candidates: StoryRow[],
  feed: FeedArticle[],
  deps: PipelineDeps,
  bucket: SpendBucket = "live",
): Promise<Set<number>> {
  const { db, ai, config } = deps;
  const covered = new Set<number>();
  if (candidates.length === 0 || feed.length === 0) return covered;

  const resolve = gameResolver(deps.tralked);
  const slugs = new Map<number, string[]>();
  for (const story of candidates) {
    const found: string[] = [];
    for (const name of parseGames(story.games_json)) {
      const hit = await resolve(name);
      if (hit) found.push(hit.slug);
    }
    slugs.set(story.id, found);
  }

  const feedByKey = new Map(feed.map((a) => [`${FEED_KEY_PREFIX}${a.id}`, a]));
  const open: OpenStory[] = feed.map((a) => ({ key: `${FEED_KEY_PREFIX}${a.id}`, headline: a.title, games: a.games }));
  const items: ClusterItem[] = candidates.map((s) => ({ id: s.id, headlinePt: s.headline, games: slugs.get(s.id)! }));
  const results = await clusterItems(ai, items, open, bucket, { model: config.MODEL_FAST });

  for (const r of results) {
    const article = r.storyKey ? feedByKey.get(r.storyKey) : undefined;
    if (!article) continue;
    const story = candidates.find((s) => s.id === r.id);
    if (!story) continue;
    if (story.parent_article_id !== null && db.articleById(story.parent_article_id)?.site_id === article.id) continue;
    if ((slugs.get(story.id) ?? []).some((slug) => article.games.includes(slug))) covered.add(story.id);
  }
  return covered;
}

/**
 * Drops covered stories, then queues the publishable open ones. Queued stories are re-checked each run,
 * except those with a `ready` article (already written and paid for). Status changes are conditional, so
 * a story a publisher claimed meanwhile is left alone.
 */
async function queueStories(deps: PipelineDeps, report: ColetaReport, now: Date): Promise<void> {
  const { db } = deps;
  const open = db
    .storiesByStatus("open", 100_000)
    .filter((s) => s.mode === "live" && storyFacts(s, deps, now).publishable);
  const queued = db.storiesByStatus("queued", 100_000).filter((s) => s.mode === "live");
  const candidates = [...open, ...queued].filter((s) => db.articleForStory(s.id)?.status !== "ready");
  if (candidates.length === 0) return;

  let feed: FeedArticle[];
  try {
    feed = await deps.tralked.recentArticles(new Date(now.getTime() - FEED_WINDOW_MS));
  } catch (error) {
    // Without the feed we cannot tell what the site already covered: queue nothing new this run.
    if (error instanceof TralkedError) {
      alert(db, "api", `Falha ao ler as matérias recentes do site: ${error.status} ${error.message}`, now);
      report.feedUnavailable = true;
      return;
    }
    throw error;
  }

  const remaining = await dedupeVideoStories(candidates, feed, deps, report, now);
  const covered = await coveredStories(remaining, feed, deps);
  for (const story of remaining) {
    if (covered.has(story.id)) {
      if (db.setStoryStatusIf(story.id, "dropped", ["open", "queued"])) report.covered++;
    } else if (story.status === "open") {
      if (db.setStoryStatusIf(story.id, "queued", ["open"])) report.queued++;
    }
  }
}

/**
 * Video stories (see `isVideoOnly`) about a game that already has a story are not published again:
 * - the site published an article about the game in the last 24 h: dropped;
 * - an open or queued text story is about the game: the video joins it (embedded there), and the video
 *   story is dropped;
 * - a story about the game was published or is being written in the last 24 h: dropped;
 * - another video story of this run is about the game (the same trailer on two channels): the videos join
 *   the higher-score one.
 * Stories without games are left to clustering and `coveredStories`. Returns the candidates still standing.
 */
async function dedupeVideoStories(
  candidates: StoryRow[],
  feed: FeedArticle[],
  deps: PipelineDeps,
  report: ColetaReport,
  now: Date,
): Promise<StoryRow[]> {
  const { db } = deps;
  const videos = candidates
    .filter((s) => isVideoOnly(db.itemsForStory(s.id)))
    .sort((a, b) => b.score - a.score || a.id - b.id);
  if (videos.length === 0) return candidates;

  const keysOf = (s: StoryRow) => new Set(parseGames(s.games_json).map(gameKey).filter((k) => k !== ""));
  const shares = (a: Set<string>, b: Set<string>) => [...a].some((k) => b.has(k));
  const videoIds = new Set(videos.map((s) => s.id));
  const live = (status: StoryRow["status"]) => db.storiesByStatus(status, 100_000).filter((s) => s.mode === "live" && !videoIds.has(s.id));
  const recent = (iso: string | null | undefined) => !!iso && now.getTime() - Date.parse(iso) <= VIDEO_DEDUPE_MS;

  const textStories = [...live("open"), ...live("queued")].filter((s) => !isVideoOnly(db.itemsForStory(s.id)));
  const done = [...live("written"), ...live("published")].filter(
    (s) => recent(db.articleForStory(s.id)?.published_at) || (s.status === "written" && recent(s.last_item_at)),
  );
  const recentFeed = feed.filter((a) => recent(a.publishedAt));
  const resolve = gameResolver(deps.tralked);

  const dropped = new Set<number>();
  const kept: { story: StoryRow; keys: Set<string> }[] = [];
  const mergeInto = (from: StoryRow, to: StoryRow) => {
    for (const itemId of db.itemIdsForStory(from.id)) db.attachItem(to.id, itemId);
    recomputeStory(to.id, deps, now);
  };
  for (const story of videos) {
    const keys = keysOf(story);
    if (keys.size === 0) continue;
    let reason: string | null = null;
    const slugs: string[] = [];
    for (const name of parseGames(story.games_json)) {
      const hit = await resolve(name);
      if (hit) slugs.push(hit.slug);
    }
    const target = textStories.find((s) => shares(keysOf(s), keys));
    const twin = kept.find((k) => shares(k.keys, keys));
    if (recentFeed.some((a) => a.games.some((g) => slugs.includes(g)))) {
      reason = "o site já publicou sobre o jogo";
    } else if (target) {
      mergeInto(story, target);
      reason = `vídeo juntado à história ${target.id}`;
    } else if (done.some((s) => shares(keysOf(s), keys))) {
      reason = "história do mesmo jogo publicada nas últimas 24 h";
    } else if (twin) {
      mergeInto(story, twin.story);
      reason = `vídeo juntado à história ${twin.story.id}`;
    }
    if (reason === null) {
      kept.push({ story, keys });
      continue;
    }
    if (db.setStoryStatusIf(story.id, "dropped", ["open", "queued"])) {
      dropped.add(story.id);
      report.videoDuplicates++;
      deps.log?.(`vídeo repetido: história ${story.id} (${reason})`);
    }
  }
  return candidates.filter((s) => !dropped.has(s.id));
}

/** Bombs go out right away, even outside the slot window, while today's count is under the cap. */
async function publishBombs(deps: PipelineDeps, report: ColetaReport): Promise<void> {
  const { db, config } = deps;
  const hasBombs = () => db.storiesByStatus("queued", 100_000).some((s) => s.mode === "live" && s.bomb === 1);
  if (!hasBombs()) return;
  const ran = await withPublishLock(deps, async () => {
    const bombs = db.storiesByStatus("queued", 100_000).filter((s) => s.mode === "live" && s.bomb === 1);
    for (const story of bombs) {
      // Re-checked inside the lock: a concurrent `publica` may have just published.
      if (db.publishedCountOn(localDay(deps.now())) >= config.MAX_PER_DAY) {
        deps.log?.(`bomba na fila (limite diário atingido): história ${story.id}`);
        return;
      }
      if (isVideoOnly(db.itemsForStory(story.id)) && videoCapReached(db, deps.now())) {
        deps.log?.(`bomba de vídeo na fila (limite diário de ${MAX_VIDEO_STORIES_PER_DAY} vídeos atingido): história ${story.id}`);
        continue;
      }
      const outcome = await publishOne(story, deps);
      if (outcome.kind === "published") report.published.push(outcome.id);
    }
  });
  if (!ran) deps.log?.("bombas na fila: outra publicação em andamento, ficam para a próxima coleta");
}

export async function runColeta(deps: PipelineDeps): Promise<ColetaReport> {
  const report = emptyReport();
  const now = deps.now();
  if (isPaused(deps.config)) {
    deps.log?.("PAUSADO: coleta não executada");
    pausedAlert(deps, now);
    report.paused = true;
    return report;
  }

  await collectAndStore(deps, report, now);
  checkSourceHealth(deps.db, deps.sources, now);
  try {
    await triageNew(deps, report, now);
    await fetchTexts(deps, report);
    const touched = await clusterTriaged(deps, report, now);
    for (const storyId of touched.keys()) recomputeStory(storyId, deps, now);
    // Follow-ups are created before queueing so they are queued in this same run.
    const updates = planUpdatesAndFollowUps(touched, deps, report, now);
    expireStale(deps, report, now);
    await queueStories(deps, report, now);
    await publishBombs(deps, report);
    for (const story of updates) if (await updateStory(story, deps)) report.updated++;
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      budgetAlert(deps.db, error, deps.now());
      report.stopped = "orcamento";
      return report;
    }
    if (error instanceof TralkedError) {
      report.stopped = "api";
      return report;
    }
    throw error;
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
// publica
// ---------------------------------------------------------------------------------------------

/**
 * The highest-score queued live story that is not expired; expired ones are marked on the way. Video
 * stories are skipped (left queued) once `MAX_VIDEO_STORIES_PER_DAY` went out today.
 */
function nextQueued(deps: PipelineDeps, now: Date): StoryRow | null {
  let videoCap: boolean | null = null;
  for (const story of deps.db.storiesByStatus("queued", 100_000)) {
    if (story.mode !== "live") continue;
    if (expired(story, deps, now)) {
      deps.db.setStoryStatusIf(story.id, "expired", ["queued"]);
      continue;
    }
    if (isVideoOnly(deps.db.itemsForStory(story.id))) {
      videoCap ??= videoCapReached(deps.db, now);
      if (videoCap) continue;
    }
    return story;
  }
  return null;
}

function refusal(deps: PublicaDeps, now: Date): string | null {
  const { config, db } = deps;
  if (isPaused(config)) {
    pausedAlert(deps, now);
    return "pausado (arquivo PAUSADO)";
  }
  if (!deps.foraDoHorario && !inSlotWindow(now, config.SLOT_FIRST_HOUR, config.SLOT_LAST_HOUR)) {
    return `fora da grade (${config.SLOT_FIRST_HOUR}h–${config.SLOT_LAST_HOUR}h, horário de Brasília); para publicar mesmo assim, use --fora-do-horario`;
  }
  if (deps.ignorarLimite) return null;
  if (db.publishedCountOn(localDay(now)) >= config.MAX_PER_DAY) return `limite diário de ${config.MAX_PER_DAY} matérias atingido`;
  const wait = gapLeft(deps, now);
  if (wait > 0) return `intervalo mínimo de ${config.PUBLISH_GAP_MINUTES} min entre matérias: faltam ${wait} min`;
  return null;
}

/**
 * Whether this slot goes to a Pauta Tralked: fewer than 2 pautas today, and either the best queued news
 * scores below 60 (or there is none), or it is 20:00 or later and no pauta went out today.
 */
function wantsPauta(deps: PublicaDeps, now: Date): boolean {
  if (!deps.famousGames || deps.famousGames.length === 0) return false;
  const today = pautasPublishedOn(deps.db, localDay(now));
  if (today >= MAX_PAUTAS_PER_DAY) return false;
  const best = nextQueued(deps, now);
  return best === null || best.score < PAUTA_SCORE_BELOW || (localHour(now) >= PAUTA_HOUR && today === 0);
}

/**
 * Writes and publishes one live pauta (callers hold the publish lock and checked the cap and the slot).
 * A `ready` pauta left by a failed POST goes out first, so it is never paid twice. Otherwise a game is
 * drawn (`pickPautaGame`); one out of the catalog or without material for any format is recorded as
 * `skipped` (it rests 60 days) and the next is tried. Returns null when no pauta was published, so the slot
 * falls back to news: no game, a site error while gathering, or a draft the check or the model refused
 * (recorded `failed`, with an alert). Budget errors and site errors on the POST are thrown.
 */
async function publishLivePauta(deps: PublicaDeps, now: Date): Promise<{ id: string; title: string } | null> {
  const { db, ai, config } = deps;
  const today = localDay(now);
  let row = db.raw.prepare("SELECT * FROM pautas WHERE mode = 'live' AND status = 'ready' ORDER BY id LIMIT 1").get() as
    | ReturnType<typeof pautaById>
    | undefined;

  for (let attempt = 0; !row && attempt < PAUTA_GAME_ATTEMPTS; attempt++) {
    const entry = pickPautaGame(db, deps.famousGames ?? [], now, deps.rand);
    if (!entry) return null;
    let sources: Awaited<ReturnType<typeof gatherPautaSources>>;
    try {
      sources = await gatherPautaSources(entry, { tralked: deps.tralked, fetchFn: deps.fetchFn, log: deps.log });
    } catch (error) {
      if (!(error instanceof TralkedError)) throw error;
      deps.log?.(`pauta: erro da API do site ao montar "${entry.name}" (${error.status} ${error.message}); o horário fica com a notícia`);
      return null;
    }
    const skip = (gameSlug: string | null, reason: string) => {
      recordPauta(db, { gameName: entry.name, gameSlug, format: null, status: "skipped", mode: "live", storyDate: today, error: reason }, now);
      deps.log?.(`pauta: "${entry.name}" pulado (${reason})`);
    };
    if (!sources.dossier || !sources.slug) {
      skip(null, "fora do catálogo do Tralked");
      continue;
    }
    const format = chooseFormat(sources, recentFormats(db), deps.rand);
    if (!format) {
      skip(sources.slug, "sem material para nenhum formato");
      continue;
    }

    const story = pautaStory(sources, format);
    const usageTag = `pauta-${now.getTime()}-${attempt}-${sources.slug}`;
    const failed = (error: string) =>
      recordPauta(db, { gameName: entry.name, gameSlug: sources.slug, format, status: "failed", mode: "live", storyDate: today, error }, now);
    let draft: Awaited<ReturnType<typeof writePauta>>;
    try {
      draft = await withUsageRef({ tag: usageTag }, () => writePauta(ai, sources, format, "live", { models: config, now }));
    } catch (error) {
      if (error instanceof PautaRejectedError) {
        failed(error.message);
        alert(db, "checagem", error.message, now);
        return null;
      }
      if (error instanceof RefusalError) {
        failed(error.message);
        alert(db, "recusa", `Pauta "${story.headline}": ${error.message}`, now);
        return null;
      }
      if (error instanceof BudgetExceededError) budgetAlert(db, error, now);
      throw error;
    }
    const payload = pautaPayload(draft, story);
    const id = recordPauta(
      db,
      {
        gameName: entry.name,
        gameSlug: sources.slug,
        format,
        status: "ready",
        mode: "live",
        storyDate: today,
        writingJson: JSON.stringify(story),
        payloadJson: JSON.stringify(payload),
      },
      now,
    );
    db.linkUsageTag(usageTag, { pautaId: id });
    row = pautaById(db, id);
  }
  if (!row?.payload_json) return null;

  const stored = JSON.parse(row.payload_json) as ArticlePayload;
  const payload: ArticlePayload = deps.revisao ? { ...stored, status: "review" } : stored;
  let created: { id: string; slug: string };
  try {
    created = await deps.tralked.createArticle(payload, pautaKey("live", row.id));
  } catch (error) {
    if (error instanceof TralkedError) {
      alert(db, "api", `Falha ao publicar a pauta ${row.id} "${payload.title}": ${error.status} ${error.message}`, now);
      if (error.status >= 400 && error.status < 500 && error.status !== 429) markPauta(db, row.id, { status: "failed", error: error.message });
    }
    throw error;
  }
  markPauta(db, row.id, { status: "published", siteId: created.id, slug: created.slug, publishedAt: deps.now().toISOString() });
  deps.log?.(`${deps.revisao ? "rascunho enviado" : "publicada"}: pauta ${row.id} → ${created.id} (${payload.title})`);
  const cost = usageLine(db, { pautaId: row.id });
  if (cost) deps.log?.(`  ${cost}`);
  return { id: created.id, title: payload.title };
}

/**
 * One slot: refuses when paused, outside 06–23 (unless `foraDoHorario`), at the daily cap or less than
 * PUBLISH_GAP_MINUTES after the last `publica` article (bombs are exempt; `ignorarLimite` skips both); waits 0–2 min
 * (not with `--agora` or `--fora-do-horario`); then, holding the publish
 * lock, re-checks and publishes a Pauta Tralked when the slot is one (`wantsPauta`; news when no pauta can
 * be made), else the best queued story, trying the next one once after a failed check.
 */
export async function runPublica(deps: PublicaDeps): Promise<PublicaResult> {
  const before = refusal(deps, deps.now());
  if (before) return { published: null, reason: before };

  if (!deps.agora && !deps.foraDoHorario) await deps.sleep(Math.floor(deps.rand() * JITTER_MAX_MS));

  const ran = await withPublishLock(deps, async (): Promise<PublicaResult> => {
    // A bomb, a pause or another publisher may have acted during the wait.
    const now = deps.now();
    const after = refusal(deps, now);
    if (after) return { published: null, reason: after };

    if (wantsPauta(deps, now)) {
      try {
        const pauta = await publishLivePauta(deps, now);
        if (pauta) {
          deps.db.setMeta(LAST_PUBLISH_KEY, deps.now().toISOString());
          return { published: pauta.id, reason: `publicada a pauta: ${pauta.title}` };
        }
        deps.log?.("pauta: nenhuma pauta possível agora; o horário fica com a notícia");
      } catch (error) {
        if (error instanceof UsageLimitError) return { published: null, reason: error.message };
        if (error instanceof BudgetExceededError) return { published: null, reason: `orçamento diário esgotado (${error.message})` };
        if (error instanceof TralkedError) return { published: null, reason: `erro da API do site: ${error.status} ${error.message}` };
        throw error;
      }
    }

    let rejected = 0;
    for (let attempt = 0; attempt < SLOT_ATTEMPTS && rejected < SLOT_REJECTIONS; attempt++) {
      const story = nextQueued(deps, now);
      if (!story) return { published: null, reason: rejected === 0 ? "fila vazia" : "checagem reprovou a história; fila vazia" };
      try {
        const outcome = await publishOne(story, deps);
        if (outcome.kind === "published") {
          deps.db.setMeta(LAST_PUBLISH_KEY, deps.now().toISOString());
          return { published: outcome.id, reason: `publicada a história ${story.id}: ${story.headline}` };
        }
        if (outcome.kind === "rejected") rejected++;
      } catch (error) {
        if (error instanceof UsageLimitError) return { published: null, reason: error.message };
        if (error instanceof BudgetExceededError) return { published: null, reason: `orçamento diário esgotado (${error.message})` };
        if (error instanceof TralkedError) return { published: null, reason: `erro da API do site: ${error.status} ${error.message}` };
        throw error;
      }
    }
    return { published: null, reason: `checagem reprovou ${rejected} histórias seguidas` };
  });
  return ran?.value ?? { published: null, reason: "outra publicação em andamento" };
}
