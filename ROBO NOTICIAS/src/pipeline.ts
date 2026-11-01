import { existsSync } from "node:fs";
import { join } from "node:path";
import { BudgetExceededError, RefusalError, type Ai } from "./ai/client.js";
import { clusterItems, openStories, storyKeyOf, type ClusterItem, type OpenStory } from "./ai/cluster.js";
import { checkNovelty } from "./ai/novelty.js";
import { CATEGORIES, triageItems, type Triage, type TriageInput } from "./ai/triage.js";
import { writeAndCheck, type StoryForWriting, type StorySource } from "./ai/writer.js";
import { assemble } from "./assemble.js";
import { inSlotWindow, localDay, localHour } from "./clock.js";
import { collectLive, extractText, fetchPage, type FetchFn } from "./collect/index.js";
import type { Config, Source } from "./config.js";
import type { ArticleRow, Db, ItemRow, StoryRow } from "./db.js";
import { acquireLock, type Lock } from "./lock.js";
import { TIER_WEIGHT, isBomb, isExpired, isPublishable, storyScore, type Tier } from "./rank.js";
import {
  TralkedError,
  articleKey,
  updateKey,
  type ArticleCategory,
  type ArticlePayload,
  type ContentBlock,
  type FeedArticle,
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
/** `publica` waits 0–12 min before publishing, so articles do not land on the hour. */
export const JITTER_MAX_MS = 12 * 60 * 1000;
/** Sources given to the writer, full-text and higher tiers first (keeps the Opus prompt bounded). */
export const MAX_WRITER_SOURCES = 8;
/** A story's article is updated at most once an hour (counting from publication) and 3 times a local day. */
export const UPDATE_MIN_GAP_MS = 60 * 60 * 1000;
export const MAX_UPDATES_PER_DAY = 3;
/** Held by whoever publishes (`publica`, and `coleta` for bombs); stale after 30 min. */
export const PUBLISH_LOCK_FILE = "publica.lock";
/** Meta key holding the last local slot (`YYYY-MM-DD HH`) in which `publica` published. */
const LAST_SLOT_KEY = "publica.lastSlot";
const FETCH_CONCURRENCY = 6;
const FEED_KEY_PREFIX = "feed-";

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
};

export type PublicaDeps = PipelineDeps & {
  sleep: (ms: number) => Promise<void>;
  rand: () => number;
  /** Manual run (`--agora`): skip the jitter wait. */
  agora?: boolean;
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

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function triageOf(item: ItemRow): Triage | null {
  if (!item.triage_json) return null;
  try {
    return JSON.parse(item.triage_json) as Triage;
  } catch {
    return null;
  }
}

function parseGames(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

/** When the item happened, never in the future: `min(pubDate, now)`, or the fetch time without a date. */
function itemTime(item: ItemRow, now: Date): number {
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

function expired(story: StoryRow, db: Db, now: Date): boolean {
  return isExpired({ score: story.score, firstSeenAt: storyStartedAt(story, db, now) }, now);
}

/** Local slot (São Paulo day and hour) used for the one-article-per-hour rule of `publica`. */
const slotOf = (d: Date) => `${localDay(d)} ${String(localHour(d)).padStart(2, "0")}`;

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

/** One alert of a kind per local day (budget alerts would otherwise repeat every run). */
function alertOncePerDay(db: Db, kind: string, message: string, now: Date): void {
  const today = localDay(now);
  if (db.alerts().some((a) => a.kind === kind && localDay(new Date(a.at)) === today)) return;
  db.addAlert(kind, message, now);
}

function budgetAlert(db: Db, error: BudgetExceededError, now: Date): void {
  alertOncePerDay(db, "orcamento", `Teto de gasto atingido: ${error.message}. O robô para até amanhã.`, now);
}

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await worker(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

/** Resolves triaged game names to site games, one lookup per name. Lookup failures count as "not found". */
function gameResolver(tralked: Tralked) {
  const cache = new Map<string, Promise<{ slug: string; name: string } | null>>();
  return (name: string) => {
    const key = name.trim().toLowerCase();
    let hit = cache.get(key);
    if (!hit) {
      hit = tralked.findGame(name).catch(() => null);
      cache.set(key, hit);
    }
    return hit;
  };
}

// ---------------------------------------------------------------------------------------------
// Story facts
// ---------------------------------------------------------------------------------------------

type StoryFacts = {
  items: ItemRow[];
  triages: Triage[];
  score: number;
  bomb: boolean;
  rumor: boolean;
  publishable: boolean;
  category: Triage["category"] | null;
  games: string[];
  lastItemAt: number;
};

function storyFacts(story: StoryRow, deps: PipelineDeps, now: Date): StoryFacts {
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
  const hasFullText = items.some((i) => i.text_unavailable !== 1 && (i.text ?? "").trim() !== "");
  const top = [...triages].sort((a, b) => b.importance - a.importance)[0];
  const stats = { maxImportance, tiers, sourceCount, rumor };
  return {
    items,
    triages,
    score: storyScore(stats),
    bomb: isBomb(stats),
    rumor,
    publishable: isPublishable({ ...stats, hasFullText }),
    category: top && (CATEGORIES as readonly string[]).includes(top.category) ? top.category : null,
    games: [...new Set(triages.flatMap((t) => t.games))],
    lastItemAt: Math.max(0, ...items.map((i) => itemTime(i, now))),
  };
}

/** Recomputes score, bomb, rumor, category, games and last item time; keeps headline, status and mode. */
function recomputeStory(storyId: number, deps: PipelineDeps, now: Date): StoryFacts | null {
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

async function storyForWriting(
  story: StoryRow,
  deps: PipelineDeps,
  previous?: StoryForWriting["previous"],
): Promise<StoryForWriting> {
  const parent = parentOf(story, deps);
  return {
    id: story.id,
    headline: story.headline,
    category: story.category as ArticleCategory,
    rumor: story.rumor === 1,
    sources: writerSources(deps.db.itemsForStory(story.id), deps.sources),
    candidates: await candidatesFor(story, deps.tralked),
    ...(previous ? { previous } : {}),
    ...(parent ? { parent: { title: parent.title, blocksText: parent.blocksText } } : {}),
  };
}

const insightsOf = (candidates: StoryForWriting["candidates"]) =>
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

async function publishOne(story: StoryRow, deps: PipelineDeps): Promise<PublishOutcome> {
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
          db.addAlert("recusa", `História ${story.id} "${story.headline}": ${error.message}`, now);
          return { kind: "rejected" };
        }
        throw error;
      }
      if (!result.ok) {
        db.setStoryStatus(story.id, "dropped");
        db.addAlert(
          "checagem",
          `História ${story.id} "${story.headline}" reprovada duas vezes na checagem: ${result.problems.join(" | ")}`,
          now,
        );
        return { kind: "rejected" };
      }
      payload = assemble(result.draft, writing, assembleOpts(story, writing, deps));
      db.saveArticle(
        { storyId: story.id, payloadJson: JSON.stringify(payload), status: "ready", parentArticleId: story.parent_article_id },
        now,
      );
    }

    let created: { id: string; slug: string };
    try {
      created = await tralked.createArticle(payload, articleKey("live", story.id));
    } catch (error) {
      if (error instanceof TralkedError) {
        const permanent = error.status >= 400 && error.status < 500 && error.status !== 429;
        db.addAlert("api", `Falha ao publicar a história ${story.id} "${story.headline}": ${error.status} ${error.message}`, now);
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
    deps.log?.(`publicada: história ${story.id} → ${created.id} (${payload.title})`);
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
async function updateStory(story: StoryRow, deps: PipelineDeps): Promise<boolean> {
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
      db.addAlert(
        "checagem",
        `Atualização da história ${story.id} "${story.headline}" reprovada duas vezes na checagem: ${result.problems.join(" | ")}`,
        now,
      );
      return false;
    }

    const payload = assemble(result.draft, writing, assembleOpts(story, writing, deps, now));
    const { status: _status, ...patch } = payload;
    try {
      await tralked.patchArticle(article.site_id, patch, updateKey(article.site_id, db.itemIdsForStory(story.id).length));
    } catch (error) {
      if (error instanceof TralkedError) {
        db.addAlert("api", `Falha ao atualizar a matéria ${article.site_id}: ${error.status} ${error.message}`, now);
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
      db.addAlert("recusa", `Atualização da história ${story.id} "${story.headline}": ${error.message}`, now);
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

/** Downloads and extracts the article text of kept items (never for title-only items). */
async function fetchTexts(deps: PipelineDeps, report: ColetaReport): Promise<void> {
  const pending = deps.db
    .itemsByStatus("triaged", 100_000)
    .filter((i) => i.text_unavailable !== 1 && (i.text ?? "").trim() === "");
  await pool(pending, FETCH_CONCURRENCY, async (item) => {
    try {
      const { text, finalUrl } = await fetchPage(item.url, deps.fetchFn);
      const extracted = extractText(text, finalUrl);
      if (extracted?.text) {
        deps.db.setItemText(item.id, extracted.text);
        report.textsFetched++;
      }
    } catch (error) {
      deps.log?.(`texto indisponível: ${item.url} (${errorMessage(error)})`);
    }
  });
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
      if (story.mode !== "live" || !expired(story, deps.db, now)) continue;
      if (deps.db.setStoryStatusIf(story.id, "expired", ["open", "queued"])) report.expired++;
    }
  }
}

/**
 * Stories the site already covered: the same game slug and a title match decided by `clusterItems`, with
 * the feed articles passed as open stories. A follow-up never counts as covered by its own parent article.
 */
async function coveredStories(candidates: StoryRow[], feed: FeedArticle[], deps: PipelineDeps): Promise<Set<number>> {
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
  const results = await clusterItems(ai, items, open, "live", { model: config.MODEL_FAST });

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
      db.addAlert("api", `Falha ao ler as matérias recentes do site: ${error.status} ${error.message}`, now);
      report.feedUnavailable = true;
      return;
    }
    throw error;
  }

  const covered = await coveredStories(candidates, feed, deps);
  for (const story of candidates) {
    if (covered.has(story.id)) {
      if (db.setStoryStatusIf(story.id, "dropped", ["open", "queued"])) report.covered++;
    } else if (story.status === "open") {
      if (db.setStoryStatusIf(story.id, "queued", ["open"])) report.queued++;
    }
  }
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
    report.paused = true;
    return report;
  }

  await collectAndStore(deps, report, now);
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

/** The highest-score queued live story that is not expired; expired ones are marked on the way. */
function nextQueued(deps: PipelineDeps, now: Date): StoryRow | null {
  for (const story of deps.db.storiesByStatus("queued", 100_000)) {
    if (story.mode !== "live") continue;
    if (expired(story, deps.db, now)) {
      deps.db.setStoryStatusIf(story.id, "expired", ["queued"]);
      continue;
    }
    return story;
  }
  return null;
}

function refusal(deps: PipelineDeps, now: Date): string | null {
  const { config, db } = deps;
  if (isPaused(config)) return "pausado (arquivo PAUSADO)";
  if (!inSlotWindow(now, config.SLOT_FIRST_HOUR, config.SLOT_LAST_HOUR)) {
    return `fora da grade (${config.SLOT_FIRST_HOUR}h–${config.SLOT_LAST_HOUR}h, horário de Brasília)`;
  }
  if (db.publishedCountOn(localDay(now)) >= config.MAX_PER_DAY) return `limite diário de ${config.MAX_PER_DAY} matérias atingido`;
  if (db.getMeta(LAST_SLOT_KEY) === slotOf(now)) return "já houve publicação neste horário";
  return null;
}

/**
 * One slot: refuses when paused, outside 06–23, at the daily cap or when this local hour already had a
 * `publica` article (bombs are exempt); waits 0–12 min (not with `--agora`); then, holding the publish
 * lock, re-checks and publishes the best queued story, trying the next one once after a failed check.
 */
export async function runPublica(deps: PublicaDeps): Promise<PublicaResult> {
  const before = refusal(deps, deps.now());
  if (before) return { published: null, reason: before };

  if (!deps.agora) await deps.sleep(Math.floor(deps.rand() * JITTER_MAX_MS));

  const ran = await withPublishLock(deps, async (): Promise<PublicaResult> => {
    // A bomb, a pause or another publisher may have acted during the wait.
    const now = deps.now();
    const after = refusal(deps, now);
    if (after) return { published: null, reason: after };

    let rejected = 0;
    for (let attempt = 0; attempt < 3 && rejected < 2; attempt++) {
      const story = nextQueued(deps, now);
      if (!story) return { published: null, reason: rejected === 0 ? "fila vazia" : "checagem reprovou a história; fila vazia" };
      try {
        const outcome = await publishOne(story, deps);
        if (outcome.kind === "published") {
          deps.db.setMeta(LAST_SLOT_KEY, slotOf(now));
          return { published: outcome.id, reason: `publicada a história ${story.id}: ${story.headline}` };
        }
        if (outcome.kind === "rejected") rejected++;
      } catch (error) {
        if (error instanceof BudgetExceededError) return { published: null, reason: `orçamento diário esgotado (${error.message})` };
        if (error instanceof TralkedError) return { published: null, reason: `erro da API do site: ${error.status} ${error.message}` };
        throw error;
      }
    }
    return { published: null, reason: "checagem reprovou duas histórias seguidas" };
  });
  return ran?.value ?? { published: null, reason: "outra publicação em andamento" };
}
