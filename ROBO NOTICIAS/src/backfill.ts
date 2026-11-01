import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { checkDraft } from "./ai/checker.js";
import { BudgetExceededError, RefusalError, costUsd } from "./ai/client.js";
import { CLUSTER_CHUNK, clusterItems, storyKeyOf, type ClusterItem, type OpenStory } from "./ai/cluster.js";
import { TRIAGE_CHUNK, triageItems, type Triage, type TriageInput } from "./ai/triage.js";
import { parseDraftText, sourcesText, writeBatchRequest, writeDraft, type Draft, type StoryForWriting } from "./ai/writer.js";
import { alert, alertOncePerDay } from "./alerts.js";
import { assemble } from "./assemble.js";
import { localDay, localStartOfDay, randomTimeOn } from "./clock.js";
import { collectBackfill, collectLive, type RawItem } from "./collect/index.js";
import type { Db, ItemRow, PautaRow, StoryRow } from "./db.js";
import {
  chooseFormat,
  finishPautaDraft,
  gatherPautaSources,
  loadPautaStyle,
  markPauta,
  pautaBatchRequest,
  pautaKey,
  pautaPayload,
  pautaStory,
  pickPautaGame,
  recentFormats,
  recordPauta,
  type PautaFormat,
} from "./pautas.js";
import {
  OPEN_STORIES_CAP,
  coveredStories,
  errorMessage,
  fetchItemTexts,
  insightsOf,
  isPaused,
  itemTime,
  parseGames,
  recomputeStory,
  storyFacts,
  storyForWriting,
  triageOf,
  type PipelineDeps,
} from "./pipeline.js";
import { isPublishable, type Tier } from "./rank.js";
import { FEED_LIMIT, TralkedError, articleKey, type ArticlePayload, type FeedArticle } from "./tralked.js";
import { normalizeUrl } from "./url.js";

/**
 * The 3-month backfill (`pnpm retroativo [fase]`). Five phases, each resumable from DB state only:
 * - descobrir: sitemaps (RSS feed as fallback) of the last `BACKFILL_DAYS` days → items tracked as backfill;
 * - triar: the fast model triages them, 50 titles a call (bucket `backfill`);
 * - agrupar: clusters them per local day, in order, with the previous day's stories still open;
 * - escrever: picks the best stories of each day (`dayQuotas`), fetches their texts, writes them in ONE
 *   Message Batch (id stored, so a crash resumes polling), then checks each draft live with one rewrite;
 * - publicar: publishes the `ready` articles oldest first, backdated to 06:00–23:59 on the story's day.
 * Stories are unique by key and articles by story, so the backfill and the live pipeline never publish
 * the same story twice: backfill items that cluster into a live story stay with it.
 */

// ---------------------------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------------------------

export const PHASES = ["descobrir", "triar", "agrupar", "escrever", "publicar"] as const;
export type Phase = (typeof PHASES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** `escrever` polls the batch this often. */
export const BATCH_POLL_MS = 60_000;
/** `publicar` sends at most one request every 2 s. */
export const PUBLISH_INTERVAL_MS = 2_000;
/** A backdated time is at least this far in the past (the site refuses future times). */
const PAST_MARGIN_MS = 5 * 60 * 1000;
const DISCOVERED_KEY = "retroativo.descoberto";
const QUOTAS_KEY = "retroativo.cotas";
/** Set before `batches.create` and cleared once the batch id is stored: `{ id, at, count }`. */
const SUBMITTING_KEY = "retroativo.enviando";
/** Clock skew allowed when matching a listed batch's `created_at` with the marker's time. */
const RECONCILE_SKEW_MS = 5 * 60 * 1000;
/** Site errors that concern one article only (the rest stop the run). */
const ARTICLE_ERRORS = new Set([400, 404, 409, 422]);
/** Pautas Tralked in the backfill: one a day across the window, on top of the news (approved in the spec). */
export const BACKFILL_PAUTAS = 90;
/** Games tried for one day's pauta in a run before the day is left for a later run (fetches only, no AI). */
const PAUTA_GAME_ATTEMPTS = 5;

type BatchRequest = Anthropic.Messages.Batches.BatchCreateParams.Request;

/** The slice of the Anthropic Message Batches API the backfill uses (`client.messages.batches`). */
export type BatchApi = {
  create(params: { requests: BatchRequest[] }): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ id: string; processing_status: string }>;
  results(id: string): Promise<AsyncIterable<Anthropic.Messages.Batches.MessageBatchIndividualResponse>>;
  /** Newest first, auto-paginated. */
  list(params?: { limit?: number }): AsyncIterable<{
    id: string;
    created_at: string;
    processing_status: string;
    request_counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number };
  }>;
};

export type BackfillDeps = PipelineDeps & {
  batches: BatchApi;
  sleep: (ms: number) => Promise<void>;
  rand: () => number;
};

export type RetroativoReport = {
  ran: Phase[];
  discovered: number;
  inserted: number;
  sourceFailures: number;
  triaged: number;
  kept: number;
  clustered: number;
  newStories: number;
  /** Backfill stories dropped because the site already covered the fact. */
  covered: number;
  selected: number;
  submitted: number;
  /** Queued stories left out of the batch so its estimated cost fits the budget. */
  trimmed: number;
  batchId: string | null;
  drafted: number;
  ready: number;
  failed: number;
  published: number;
  publishFailed: number;
  /** Pautas Tralked: planned (sources gathered) in this run, checked and ready, published backdated. */
  pautasPlanned: number;
  pautasReady: number;
  pautasPublished: number;
  paused: boolean;
  /** Why the run stopped early (budget, site API), when it did. */
  stopped: string | null;
};

const emptyReport = (): RetroativoReport => ({
  ran: [],
  discovered: 0,
  inserted: 0,
  sourceFailures: 0,
  triaged: 0,
  kept: 0,
  clustered: 0,
  newStories: 0,
  covered: 0,
  selected: 0,
  submitted: 0,
  trimmed: 0,
  batchId: null,
  drafted: 0,
  ready: 0,
  failed: 0,
  published: 0,
  publishFailed: 0,
  pautasPlanned: 0,
  pautasReady: 0,
  pautasPublished: 0,
  paused: false,
  stopped: null,
});

// ---------------------------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------------------------

/**
 * How many stories each day gets: proportional to the day's publishable story count, at least 1 for a day
 * with stories, at most `maxPerDay` (and never more than the day has), summing to at most `total`.
 * The proportional share is found with a common scale; the units left after rounding down go to the
 * largest remainders (ties: busier day, then earlier day). Deterministic, whatever the map order.
 * When there are more non-empty days than `total`, only the `total` busiest days get 1.
 */
export function dayQuotas(storyCountsByDay: Map<string, number>, total = 750, maxPerDay = 15): Map<string, number> {
  const days = [...storyCountsByDay.entries()]
    .filter(([, n]) => n > 0)
    .map(([day, n]) => ({ day, n, cap: Math.min(n, maxPerDay) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const out = new Map<string, number>();
  if (days.length === 0 || total <= 0) return out;

  const byPriority = (a: { day: string; n: number }, b: { day: string; n: number }) =>
    b.n - a.n || (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

  if (days.length > total) {
    for (const d of [...days].sort(byPriority).slice(0, total)) out.set(d.day, 1);
    return out;
  }
  const capacity = days.reduce((sum, d) => sum + d.cap, 0);
  if (capacity <= total) {
    for (const d of days) out.set(d.day, d.cap);
    return out;
  }

  // f(λ) = Σ clamp(λ·n, 1, cap) grows with λ: f(0) = #days <= total < capacity = f(∞). Find f(λ) <= total.
  const share = (d: { n: number; cap: number }, lambda: number) => Math.min(d.cap, Math.max(1, lambda * d.n));
  const f = (lambda: number) => days.reduce((sum, d) => sum + share(d, lambda), 0);
  let lo = 0;
  let hi = maxPerDay;
  while (f(hi) < total) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) <= total) lo = mid;
    else hi = mid;
  }

  const rows = days.map((d) => {
    const exact = share(d, lo);
    return { ...d, quota: Math.floor(exact + 1e-9), rest: exact - Math.floor(exact + 1e-9) };
  });
  let left = total - rows.reduce((sum, r) => sum + r.quota, 0);
  const order = [...rows].sort((a, b) => b.rest - a.rest || byPriority(a, b));
  while (left > 0) {
    let gave = false;
    for (const r of order) {
      if (left === 0) break;
      if (r.quota < r.cap) {
        r.quota++;
        left--;
        gave = true;
      }
    }
    if (!gave) break;
  }
  for (const r of rows) out.set(r.day, r.quota);
  return out;
}

// ---------------------------------------------------------------------------------------------
// DB state of the backfill (own tables, created on demand)
// ---------------------------------------------------------------------------------------------

const TABLES = `
CREATE TABLE IF NOT EXISTS backfill_items (
  item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS backfill_batches (
  id TEXT PRIMARY KEY,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','processed'))
);
CREATE TABLE IF NOT EXISTS backfill_drafts (
  story_id INTEGER PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  writing_json TEXT NOT NULL,
  draft_json TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','drafted','done','failed')),
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_backfill_drafts_status ON backfill_drafts(status);
`;

type DraftRow = { story_id: number; batch_id: string; writing_json: string; draft_json: string | null; status: string };

function ensureTables(db: Db): void {
  db.raw.exec(TABLES);
}

/** Runs `fn` in one SQLite transaction. */
function tx(db: Db, fn: () => void): void {
  db.raw.exec("BEGIN");
  try {
    fn();
    db.raw.exec("COMMIT");
  } catch (error) {
    db.raw.exec("ROLLBACK");
    throw error;
  }
}

const all = <T>(db: Db, sql: string, ...args: (string | number | null)[]) => db.raw.prepare(sql).all(...args) as unknown as T[];

const backfillStories = (db: Db, status: StoryRow["status"]) =>
  all<StoryRow>(db, "SELECT * FROM stories WHERE mode = 'backfill' AND status = ? ORDER BY story_date, id", status);

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** Same message prefix as the live commands' alert, so one `pausado` alert a day covers them all. */
function pausedAlert(deps: BackfillDeps): void {
  alertOncePerDay(
    deps.db,
    "pausado",
    `Arquivo PAUSADO presente em ${join(deps.config.DATA_DIR, "PAUSADO")}: o retroativo não publica. Apague o arquivo para retomar.`,
    deps.now(),
    "Arquivo PAUSADO",
  );
}

/** The calendar day before/after `day` ("YYYY-MM-DD"). */
function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The writer's "today" for a backfill story: mid-afternoon on the story's own day. */
function storyNow(story: StoryRow, deps: BackfillDeps): Date {
  return story.story_date ? randomTimeOn(story.story_date, () => 0.5) : deps.now();
}

const customIdOf = (storyId: number) => `story-${storyId}`;

function storyIdOf(customId: string): number | null {
  const m = /^story-(\d+)$/.exec(customId);
  return m ? Number(m[1]) : null;
}

/** A pauta's request in the same batch as the news (ruling: custom_id `pauta-<id>`). */
const pautaCustomId = (pautaId: number) => `pauta-${pautaId}`;

function pautaIdOf(customId: string): number | null {
  const m = /^pauta-(\d+)$/.exec(customId);
  return m ? Number(m[1]) : null;
}

/** The writer's "today" for a backfill pauta: mid-afternoon on its day, like a backfill story. */
const pautaNow = (row: Pick<PautaRow, "story_date">) => randomTimeOn(row.story_date, () => 0.5);

const pautasEnabled = (deps: BackfillDeps) => (deps.famousGames?.length ?? 0) > 0;

/** A `StoryForWriting` stored as JSON (dates as ISO strings), back to its runtime shape. */
export function storyFromJson(json: string): StoryForWriting {
  const raw = JSON.parse(json) as Omit<StoryForWriting, "sources"> & {
    sources: (Omit<StoryForWriting["sources"][number], "publishedAt"> & { publishedAt: string | null })[];
  };
  return { ...raw, sources: raw.sources.map((s) => ({ ...s, publishedAt: s.publishedAt ? new Date(s.publishedAt) : null })) };
}

const tzParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** ISO 8601 with the São Paulo offset, e.g. `2026-08-03T14:25:00-03:00`. */
export function isoWithOffset(d: Date): string {
  const p: Record<string, string> = {};
  for (const part of tzParts.formatToParts(d)) if (part.type !== "literal") p[part.type] = part.value;
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const offsetMin = Math.round((wall - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`;
}

/**
 * A uniform minute in 06:00–23:59 local on `day`, but always at least 5 min in the past (today's stories).
 * Null when nothing of today's window has passed yet (before 06:05): the story waits for a later run.
 */
export function backdatedTime(day: string, now: Date, rand: () => number): Date | null {
  const fullMinutes = 18 * 60;
  const first = randomTimeOn(day, () => 0).getTime();
  const latest = now.getTime() - PAST_MARGIN_MS;
  if (latest >= first + fullMinutes * 60_000) return randomTimeOn(day, rand);
  const allowed = Math.floor((latest - first) / 60_000) + 1;
  if (allowed <= 0) return null;
  return randomTimeOn(day, () => (rand() * allowed) / fullMinutes);
}

// ---------------------------------------------------------------------------------------------
// descobrir
// ---------------------------------------------------------------------------------------------

/**
 * The backfill window: the `BACKFILL_DAYS` local days that end where yesterday starts. Yesterday's and
 * today's facts belong to the live pipeline.
 */
export function backfillWindow(now: Date, days: number): { from: Date; to: Date } {
  const today = localDay(now);
  return {
    from: localStartOfDay(shiftDay(today, -1 - days)),
    to: new Date(localStartOfDay(shiftDay(today, -1)).getTime() - 1),
  };
}

/**
 * Each active source's backfill sitemap (child sitemaps followed); RSS sources without a sitemap, or whose
 * sitemap failed without yielding anything, are read from their feed instead. Only items inside
 * `backfillWindow` are kept. Newly stored items get the backfill-only status `bf_new` in the same
 * transaction as their insert, so the live pipeline never sees them; URLs it already holds stay with it.
 */
async function descobrir(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db, config } = deps;
  const now = deps.now();
  const { from, to } = backfillWindow(now, config.BACKFILL_DAYS);
  const active = deps.sources.filter((s) => s.active);

  const sitemaps = await collectBackfill(active, from, to, deps.fetchFn);
  const withItems = new Set(sitemaps.items.map((i) => i.sourceId));
  const sitemapFailed = new Set(sitemaps.failures.map((f) => f.sourceId));
  const fallback = active.filter(
    (s) => s.kind === "rss" && (!s.backfill || (sitemapFailed.has(s.id) && !withItems.has(s.id))),
  );
  const feeds = fallback.length > 0 ? await collectLive(fallback, deps.fetchFn, now) : { items: [], failures: [] };
  const inWindow = (i: RawItem) => i.publishedAt !== null && i.publishedAt >= from && i.publishedAt <= to;
  const items = [...sitemaps.items, ...feeds.items.filter(inWindow)];

  const failures = [...sitemaps.failures, ...feeds.failures];
  report.sourceFailures += failures.length;
  for (const f of failures) deps.log?.(`retroativo: fonte ${f.sourceId} com falha (${f.error})`);

  const claim = db.raw.prepare("UPDATE items SET status = 'bf_new' WHERE url = ? AND status = 'new'");
  const track = db.raw.prepare("INSERT OR IGNORE INTO backfill_items (item_id) SELECT id FROM items WHERE url = ?");
  tx(db, () => {
    for (const item of items) {
      report.discovered++;
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
      if (!inserted) continue;
      const url = normalizeUrl(item.url);
      claim.run(url);
      track.run(url);
      report.inserted++;
    }
  });
  db.setMeta(DISCOVERED_KEY, now.toISOString());
}

// ---------------------------------------------------------------------------------------------
// triar
// ---------------------------------------------------------------------------------------------

/**
 * Triages the `bf_new` items, 50 per call, each chunk saved before the next (a budget stop loses nothing).
 * Kept items become `bf_triaged` (invisible to the live pipeline), the others `dropped`. Unanswered items
 * stay `bf_new` for the next run.
 */
async function triar(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db, config } = deps;
  const sourcesById = new Map(deps.sources.map((s) => [s.id, s]));
  const pending = db.itemsByStatus("bf_new", 1_000_000);
  const inputs: TriageInput[] = pending.flatMap((item) => {
    const source = sourcesById.get(item.source_id);
    return source ? [{ id: item.id, title: item.title, summary: item.summary, source }] : [];
  });
  for (let i = 0; i < inputs.length; i += TRIAGE_CHUNK) {
    const triages = await triageItems(deps.ai, inputs.slice(i, i + TRIAGE_CHUNK), "backfill", { model: config.MODEL_FAST });
    tx(db, () => {
      for (const t of triages) {
        db.setItemStatus(t.id, t.keep ? "bf_triaged" : "dropped", JSON.stringify(t));
        report.triaged++;
        if (t.keep) report.kept++;
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// agrupar
// ---------------------------------------------------------------------------------------------

/**
 * Stories open while clustering `day`: backfill stories of that day and the day before, and live stories
 * first seen or last fed during those two local days (stored times are UTC ISO strings, so the range is
 * compared in SQL).
 */
function openStoriesFor(db: Db, day: string): OpenStory[] {
  const prev = shiftDay(day, -1);
  const from = localStartOfDay(prev).toISOString();
  const to = localStartOfDay(shiftDay(day, 1)).toISOString();
  return all<StoryRow>(
    db,
    `SELECT * FROM stories
     WHERE (mode = 'backfill' AND story_date IN (?, ?))
        OR (mode = 'live' AND ((first_seen_at >= ? AND first_seen_at < ?) OR (last_item_at >= ? AND last_item_at < ?)))
     ORDER BY last_item_at DESC, id DESC
     LIMIT ?`,
    prev,
    day,
    from,
    to,
    from,
    to,
    OPEN_STORIES_CAP,
  ).map((s) => ({ key: s.key, headline: s.headline, games: parseGames(s.games_json) }));
}

/**
 * Clusters the triaged backfill items one local day at a time, oldest day first, items in time order.
 * Every result goes to `storyKeyOf(r)`: a founder creates the story (mode `backfill`, `story_date` = the
 * day), later items join. An item that joins a live story stays with it (never written again here).
 */
async function agrupar(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db, config } = deps;
  const now = deps.now();
  const items = db.itemsByStatus("bf_triaged", 1_000_000);
  const byDay = new Map<string, { item: ItemRow; t: Triage; at: number }[]>();
  for (const item of items) {
    const t = triageOf(item);
    if (!t) continue;
    const at = itemTime(item, now);
    const day = localDay(new Date(at));
    byDay.set(day, [...(byDay.get(day) ?? []), { item, t, at }]);
  }

  for (const day of [...byDay.keys()].sort()) {
    const entries = byDay.get(day)!.sort((a, b) => a.at - b.at || a.item.id - b.item.id);
    const inputs: ClusterItem[] = entries.map(({ item, t }) => ({ id: item.id, headlinePt: t.headlinePt, games: t.games }));
    const results = await clusterItems(deps.ai, inputs, openStoriesFor(db, day), "backfill", { model: config.MODEL_FAST });
    const byId = new Map(entries.map((e) => [e.item.id, e]));
    const touched = new Set<number>();
    tx(db, () => {
      for (const r of results) {
        const entry = byId.get(r.id);
        if (!entry) continue;
        const key = storyKeyOf(r);
        let story = db.storyByKey(key);
        if (!story) {
          const id = db.upsertStory(
            {
              key,
              headline: r.newHeadline?.trim() || entry.t.headlinePt,
              category: entry.t.category,
              score: 0,
              bomb: false,
              rumor: entry.t.rumor,
              gamesJson: JSON.stringify(entry.t.games),
              mode: "backfill",
              storyDate: day,
              status: "open",
              lastItemAt: new Date(entry.at).toISOString(),
            },
            now,
          );
          story = db.storyById(id)!;
          report.newStories++;
        }
        db.attachItem(story.id, entry.item.id);
        db.setItemStatus(entry.item.id, "clustered");
        report.clustered++;
        touched.add(story.id);
      }
      for (const id of touched) recomputeStory(id, deps, now);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// escrever
// ---------------------------------------------------------------------------------------------

/** Publishable once its texts are fetched: every item except title-only ones may still get full text. */
function couldBePublishable(story: StoryRow, deps: BackfillDeps): boolean {
  const tierOf = new Map(deps.sources.map((s) => [s.id, s.tier]));
  const items = deps.db.itemsForStory(story.id);
  return isPublishable({
    tiers: items.map((i): Tier => tierOf.get(i.source_id) ?? "outro"),
    sourceCount: new Set(items.map((i) => i.source_id)).size,
    rumor: story.rumor === 1,
    hasFullText: items.some((i) => i.text_unavailable !== 1),
  });
}

/**
 * Quotas computed once and stored, so a resumed run keeps them. Before counting, the open backfill
 * stories the site already covered are dropped (anti-goal: never repeat what the newsroom published),
 * with the live pipeline's matching (game slug plus title clustering) in bucket `backfill`.
 * Returns null when the site feed cannot be read: nothing is selected in this run.
 */
async function quotasFor(deps: BackfillDeps, report: RetroativoReport): Promise<Map<string, number> | null> {
  const { db, config } = deps;
  const saved = db.getMeta(QUOTAS_KEY);
  if (saved) return new Map(Object.entries(JSON.parse(saved) as Record<string, number>));
  const open = backfillStories(db, "open");
  if (open.length === 0) return new Map();

  const now = deps.now();
  let feed: FeedArticle[];
  try {
    feed = await deps.tralked.recentArticles(backfillWindow(now, config.BACKFILL_DAYS).from);
  } catch (error) {
    if (!(error instanceof TralkedError)) throw error;
    alertOncePerDay(
      db,
      "api",
      `Retroativo: erro da API do site ao ler as matérias publicadas: ${error.status} ${error.message}. Nada foi escolhido para escrever.`,
      now,
      "Retroativo: erro da API",
    );
    report.stopped = "api";
    return null;
  }
  if (feed.length >= FEED_LIMIT) {
    deps.log?.(`retroativo: o feed do site veio com ${feed.length} matérias (o limite); as mais antigas podem faltar na checagem`);
    alert(
      db,
      "api",
      `Retroativo: cobertura do site limitada a ${FEED_LIMIT} matérias; matérias mais antigas da janela podem não ter sido checadas.`,
      now,
    );
  }

  // Only stories that could be published are checked. Each slice is its own call against the same feed:
  // every prompt is the feed plus at most CLUSTER_CHUNK stories, and a story counts as covered only when it
  // joins a feed article (stories never accumulate across slices).
  const candidates = open.filter((s) => couldBePublishable(s, deps));
  const covered = new Set<number>();
  for (let i = 0; i < candidates.length; i += CLUSTER_CHUNK) {
    for (const id of await coveredStories(candidates.slice(i, i + CLUSTER_CHUNK), feed, deps, "backfill")) covered.add(id);
  }
  tx(db, () => {
    for (const id of covered) if (db.setStoryStatusIf(id, "dropped", ["open"])) report.covered++;
  });
  if (covered.size > 0) deps.log?.(`retroativo: ${covered.size} histórias já cobertas pelo site, descartadas`);

  const counts = new Map<string, number>();
  for (const story of open) {
    if (covered.has(story.id) || !story.story_date || !couldBePublishable(story, deps)) continue;
    counts.set(story.story_date, (counts.get(story.story_date) ?? 0) + 1);
  }
  // With pautas on, every day keeps one place for its pauta: news quota + pauta <= MAX_PER_DAY.
  const newsPerDay = config.MAX_PER_DAY - (pautasEnabled(deps) ? 1 : 0);
  const quotas = dayQuotas(counts, config.BACKFILL_TOTAL, newsPerDay);
  if (quotas.size > 0) db.setMeta(QUOTAS_KEY, JSON.stringify(Object.fromEntries(quotas)));
  return quotas;
}

const countOf = (db: Db, sql: string, ...args: (string | number)[]) =>
  (db.raw.prepare(sql).get(...args) as { n: number }).n;

/**
 * Per day (oldest first): the open backfill stories are ranked by score and the best ones become `queued`
 * up to the day's quota; their texts are fetched as they are picked, and a story that is not publishable
 * once fetched (R15) gives its place to the next. The rest of the day's open stories are dropped. The day
 * never goes over `MAX_PER_DAY` counting articles already published on it. A day with candidates but no
 * stored quota (clustered after the quotas were fixed) is logged and reported in one `api` alert.
 * Returns false when the run must stop (site feed unavailable).
 */
async function selectStories(deps: BackfillDeps, report: RetroativoReport): Promise<boolean> {
  const { db, config } = deps;
  const now = deps.now();
  const quotas = await quotasFor(deps, report);
  if (!quotas) return false;
  const open = backfillStories(db, "open");
  const days = [...new Set(open.map((s) => s.story_date).filter((d): d is string => d !== null))].sort();
  const withoutQuota: string[] = [];

  for (const day of days) {
    const ofDay = open.filter((s) => s.story_date === day);
    const taken = countOf(
      db,
      "SELECT COUNT(*) AS n FROM stories WHERE mode = 'backfill' AND story_date = ? AND status IN ('queued','written','published')",
      day,
    );
    const backfillPublished = countOf(
      db,
      "SELECT COUNT(*) AS n FROM stories WHERE mode = 'backfill' AND story_date = ? AND status = 'published'",
      day,
    );
    // Published pautas are in `publishedCountOn`; a pauta planned or written for the day takes its place too.
    const otherPublished = Math.max(0, db.publishedCountOn(day) - backfillPublished);
    const pendingPautas = countOf(
      db,
      "SELECT COUNT(*) AS n FROM pautas WHERE mode = 'backfill' AND story_date = ? AND status IN ('bf_planned','bf_drafted','ready')",
      day,
    );
    const allowed = Math.max(
      0,
      Math.min((quotas.get(day) ?? 0) - taken, config.MAX_PER_DAY - otherPublished - pendingPautas - taken),
    );

    const ranked = ofDay.filter((s) => couldBePublishable(s, deps)).sort((a, b) => b.score - a.score || a.id - b.id);
    if (!quotas.has(day) && ranked.length > 0) {
      withoutQuota.push(day);
      deps.log?.(`retroativo: ${day} tem ${ranked.length} histórias e nenhuma cota guardada; descartadas`);
    }
    const selected: StoryRow[] = [];
    let next = 0;
    while (selected.length < allowed && next < ranked.length) {
      const slice = ranked.slice(next, next + allowed - selected.length);
      next += slice.length;
      await fetchItemTexts(
        slice.flatMap((s) => db.itemsForStory(s.id)),
        { db, fetchFn: deps.fetchFn, log: (line) => deps.log?.(`retroativo: ${line}`) },
      );
      for (const s of slice) if (storyFacts(s, deps, now).publishable) selected.push(s);
    }

    const chosen = new Set(selected.map((s) => s.id));
    tx(db, () => {
      for (const s of ofDay) db.setStoryStatusIf(s.id, chosen.has(s.id) ? "queued" : "dropped", ["open"]);
    });
    report.selected += selected.length;
  }

  if (withoutQuota.length > 0) {
    alert(
      db,
      "api",
      `Retroativo: ${withoutQuota.length} dia(s) com histórias e sem cota guardada (${withoutQuota.join(", ")}); as histórias desses dias foram descartadas. As cotas são fixadas na primeira escolha.`,
      now,
    );
  }
  return true;
}

/** Every local day of the backfill window, oldest first. */
function windowDays(deps: BackfillDeps): string[] {
  const { from, to } = backfillWindow(deps.now(), deps.config.BACKFILL_DAYS);
  const days: string[] = [];
  for (let day = localDay(from), last = localDay(to); day <= last; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/** Articles a backfill day already has or will have: chosen backfill news, plus what the site published on it. */
function articlesOnDay(db: Db, day: string): number {
  const news = countOf(
    db,
    "SELECT COUNT(*) AS n FROM stories WHERE mode = 'backfill' AND story_date = ? AND status IN ('queued','written','published')",
    day,
  );
  const newsPublished = countOf(
    db,
    "SELECT COUNT(*) AS n FROM stories WHERE mode = 'backfill' AND story_date = ? AND status = 'published'",
    day,
  );
  const pautas = countOf(
    db,
    "SELECT COUNT(*) AS n FROM pautas WHERE story_date = ? AND status IN ('bf_planned','bf_drafted','ready')",
    day,
  );
  return news + Math.max(0, db.publishedCountOn(day) - newsPublished) + pautas;
}

/**
 * Plans the backfill's Pautas Tralked: one per window day, oldest first, up to `BACKFILL_PAUTAS`, after the
 * news are chosen, and only on a day that stays within `MAX_PER_DAY` with it. For each day a game is drawn
 * as of that day (60-day rule by date); one out of the catalog or without material for any format is
 * `skipped` and the next is tried. A planned pauta keeps its writer input, and the batch writes it.
 * A day that already had a pauta (planned, written, published or failed) is never planned again.
 */
async function planPautas(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  if (!pautasEnabled(deps)) return;
  const { db, config } = deps;
  const list = deps.famousGames ?? [];
  let planned = countOf(db, "SELECT COUNT(*) AS n FROM pautas WHERE mode = 'backfill' AND status != 'skipped'");

  for (const day of windowDays(deps)) {
    if (planned >= BACKFILL_PAUTAS) break;
    if (countOf(db, "SELECT COUNT(*) AS n FROM pautas WHERE mode = 'backfill' AND story_date = ? AND status != 'skipped'", day) > 0) continue;
    if (articlesOnDay(db, day) + 1 > config.MAX_PER_DAY) {
      deps.log?.(`retroativo: ${day} já tem ${config.MAX_PER_DAY} matérias; sem pauta nesse dia`);
      continue;
    }
    const asOf = randomTimeOn(day, () => 0.5);
    for (let attempt = 0; attempt < PAUTA_GAME_ATTEMPTS; attempt++) {
      const entry = pickPautaGame(db, list, asOf, deps.rand);
      if (!entry) break;
      let sources: Awaited<ReturnType<typeof gatherPautaSources>>;
      try {
        sources = await gatherPautaSources(entry, { tralked: deps.tralked, fetchFn: deps.fetchFn, log: deps.log });
      } catch (error) {
        if (!(error instanceof TralkedError)) throw error;
        alertOncePerDay(
          db,
          "api",
          `Retroativo: erro da API do site ao montar as pautas: ${error.status} ${error.message}`,
          deps.now(),
          "Retroativo: erro da API",
        );
        report.stopped = "api";
        return;
      }
      const base = { gameName: entry.name, mode: "backfill" as const, storyDate: day };
      if (!sources.dossier || !sources.slug) {
        recordPauta(db, { ...base, gameSlug: null, format: null, status: "skipped", error: "fora do catálogo do Tralked" }, deps.now());
        continue;
      }
      const format = chooseFormat(sources, recentFormats(db, day), deps.rand);
      if (!format) {
        recordPauta(db, { ...base, gameSlug: sources.slug, format: null, status: "skipped", error: "sem material para nenhum formato" }, deps.now());
        continue;
      }
      const writing = pautaStory(sources, format);
      recordPauta(db, { ...base, gameSlug: sources.slug, format, status: "bf_planned", writingJson: JSON.stringify(writing) }, deps.now());
      planned++;
      report.pautasPlanned++;
      break;
    }
  }
}

/** Characters of a prompt part (string, or text blocks). */
function promptChars(part: unknown): number {
  if (typeof part === "string") return part.length;
  if (Array.isArray(part)) return part.reduce((sum: number, p) => sum + promptChars(p), 0);
  if (part && typeof part === "object") {
    const o = part as { text?: unknown; content?: unknown };
    return promptChars(o.text) + promptChars(o.content);
  }
  return 0;
}

/**
 * Upper-bound estimate of one batch request: prompt characters / 4 input tokens and `max_tokens / 2` output
 * tokens, at batch prices for `model`.
 */
export function estimateRequestUsd(request: BatchRequest, model: string): number {
  const p = request.params;
  const input = Math.ceil((promptChars(p.system) + promptChars(p.messages)) / 4);
  return costUsd(model, { input_tokens: input, output_tokens: Math.ceil(p.max_tokens / 2) }, true);
}

type SubmitMarker = { id: string; at: string; count: number };

function readMarker(db: Db): SubmitMarker | null {
  const raw = db.getMeta(SUBMITTING_KEY);
  return raw ? (JSON.parse(raw) as SubmitMarker) : null;
}

/** Stores the batch id: the batch row, the drafts moved from the marker to it, the marker cleared. */
function adoptBatch(deps: BackfillDeps, marker: SubmitMarker, batchId: string): void {
  const { db } = deps;
  tx(db, () => {
    db.raw.prepare("INSERT INTO backfill_batches (id, submitted_at, status) VALUES (?, ?, 'submitted')").run(batchId, marker.at);
    db.raw.prepare("UPDATE backfill_drafts SET batch_id = ? WHERE batch_id = ?").run(batchId, marker.id);
    db.raw.prepare("UPDATE pautas SET batch_id = ? WHERE batch_id = ?").run(batchId, marker.id);
    db.setMeta(SUBMITTING_KEY, "");
  });
}

/**
 * A run that crashed between `batches.create` and storing the id left a marker. The batch is looked up with
 * `batches.list` (newest first): created at most `RECONCILE_SKEW_MS` before the marker, with the marker's
 * request count, not already known, and, when it has ended, only our `story-<id>` custom ids. The oldest
 * match is adopted; with none, the marker and its draft rows are removed so the stories are submitted again.
 */
async function reconcileSubmission(deps: BackfillDeps): Promise<void> {
  const { db } = deps;
  const marker = readMarker(db);
  if (!marker) return;
  const since = Date.parse(marker.at) - RECONCILE_SKEW_MS;
  const ours = new Set([
    ...all<{ story_id: number }>(db, "SELECT story_id FROM backfill_drafts WHERE batch_id = ?", marker.id).map((r) => customIdOf(r.story_id)),
    ...all<{ id: number }>(db, "SELECT id FROM pautas WHERE batch_id = ?", marker.id).map((r) => pautaCustomId(r.id)),
  ]);
  const known = (id: string) => db.raw.prepare("SELECT 1 AS x FROM backfill_batches WHERE id = ?").get(id) !== undefined;

  let found: string | null = null;
  for await (const b of deps.batches.list({ limit: 20 })) {
    if (Date.parse(b.created_at) < since) break;
    const c = b.request_counts;
    if (c.processing + c.succeeded + c.errored + c.canceled + c.expired !== marker.count || known(b.id)) continue;
    if (b.processing_status === "ended") {
      let match = true;
      for await (const r of await deps.batches.results(b.id)) {
        if (!ours.has(r.custom_id)) {
          match = false;
          break;
        }
      }
      if (!match) continue;
    }
    found = b.id; // keep going: the oldest match is the one this marker created
  }

  if (found) {
    adoptBatch(deps, marker, found);
    deps.log?.(`retroativo: lote ${found} recuperado (a execução anterior caiu antes de guardar o id)`);
    return;
  }
  tx(db, () => {
    db.raw.prepare("DELETE FROM backfill_drafts WHERE batch_id = ?").run(marker.id);
    db.raw.prepare("UPDATE pautas SET batch_id = NULL WHERE batch_id = ?").run(marker.id);
    db.setMeta(SUBMITTING_KEY, "");
  });
  deps.log?.("retroativo: nenhum lote da execução anterior encontrado; as histórias serão enviadas de novo");
}

type BatchEntry =
  | { kind: "story"; story: StoryRow; writing: StoryForWriting; request: BatchRequest; usd: number }
  | { kind: "pauta"; pauta: PautaRow; request: BatchRequest; usd: number };

/**
 * Submits ONE batch with the queued backfill stories and the planned pautas not yet sent (`story-<id>` and
 * `pauta-<id>`). The estimated cost of all of them must fit what is left of the backfill budget: news go
 * first by score, then pautas by day, and what does not fit is left out (still `queued`/`bf_planned`, for a
 * later run); when nothing fits, one `orcamento` alert and the run stops. A marker is saved before `create`
 * and replaced by the batch id right after, so a crash in between is reconciled instead of paid twice.
 */
async function submitBatch(deps: BackfillDeps, report: RetroativoReport): Promise<string | null> {
  const { db, ai, config } = deps;
  const toWrite = all<StoryRow>(
    db,
    `SELECT s.* FROM stories s LEFT JOIN backfill_drafts d ON d.story_id = s.id
     WHERE s.mode = 'backfill' AND s.status = 'queued' AND d.story_id IS NULL
     ORDER BY s.score DESC, s.id`,
  );
  const pautasToWrite = all<PautaRow>(
    db,
    "SELECT * FROM pautas WHERE mode = 'backfill' AND status = 'bf_planned' AND batch_id IS NULL ORDER BY story_date, id",
  );
  if (toWrite.length === 0 && pautasToWrite.length === 0) return null;

  // `batchRequest` does not check the budget: stop here, before building or submitting anything.
  ai.assertBudget("backfill");

  const entries: BatchEntry[] = [];
  for (const story of toWrite) {
    const writing = await storyForWriting(story, deps);
    const request = writeBatchRequest(ai, writing, customIdOf(story.id), { models: config, now: storyNow(story, deps) });
    entries.push({ kind: "story", story, writing, request, usd: estimateRequestUsd(request, config.MODEL_WRITER) });
  }
  for (const pauta of pautasToWrite) {
    const writing = storyFromJson(pauta.writing_json ?? "{}");
    const request = pautaBatchRequest(ai, writing, pautaCustomId(pauta.id), { models: config, now: pautaNow(pauta) });
    entries.push({ kind: "pauta", pauta, request, usd: estimateRequestUsd(request, config.MODEL_WRITER) });
  }

  // News by score, then pautas by day: what does not fit is the least relevant.
  const left = config.BACKFILL_BUDGET_USD - db.spentTotal("backfill");
  const kept: typeof entries = [];
  let total = 0;
  for (const e of entries) {
    if (total + e.usd > left) break;
    kept.push(e);
    total += e.usd;
  }
  report.trimmed += entries.length - kept.length;
  const now = deps.now();
  if (kept.length === 0) {
    alertOncePerDay(
      db,
      "orcamento",
      `Retroativo: teto de US$ ${config.BACKFILL_BUDGET_USD} não comporta nem uma matéria (restam US$ ${left.toFixed(2)}, estimativa US$ ${entries[0]!.usd.toFixed(2)} por matéria). Aumente BACKFILL_BUDGET_USD e rode de novo.`,
      now,
      "Retroativo: teto",
    );
    report.stopped = "orcamento";
    return null;
  }
  if (kept.length < entries.length) {
    deps.log?.(
      `retroativo: lote reduzido a ${kept.length} de ${entries.length} matérias (estimativa US$ ${total.toFixed(2)}, restam US$ ${left.toFixed(2)})`,
    );
  }

  const marker: SubmitMarker = { id: `pendente-${now.toISOString()}`, at: now.toISOString(), count: kept.length };
  tx(db, () => {
    db.setMeta(SUBMITTING_KEY, JSON.stringify(marker));
    const insert = db.raw.prepare("INSERT INTO backfill_drafts (story_id, batch_id, writing_json, status) VALUES (?, ?, ?, 'submitted')");
    const claimPauta = db.raw.prepare("UPDATE pautas SET batch_id = ? WHERE id = ?");
    for (const e of kept) {
      if (e.kind === "story") insert.run(e.story.id, marker.id, JSON.stringify(e.writing));
      else claimPauta.run(marker.id, e.pauta.id);
    }
  });
  const batch = await deps.batches.create({ requests: kept.map((e) => e.request) });
  adoptBatch(deps, marker, batch.id);
  report.submitted += kept.length;
  deps.log?.(`retroativo: lote ${batch.id} enviado com ${kept.length} matérias (estimativa US$ ${total.toFixed(2)})`);
  return batch.id;
}

async function waitForBatch(deps: BackfillDeps, id: string): Promise<void> {
  for (;;) {
    const batch = await deps.batches.retrieve(id);
    if (batch.processing_status === "ended") return;
    deps.log?.(`retroativo: lote ${id} ainda em processamento (${batch.processing_status})`);
    await deps.sleep(BATCH_POLL_MS);
  }
}

/** Marks a story's writing as failed: article `failed`, story `dropped`. No alert here (one summary per run). */
function failStory(deps: BackfillDeps, storyId: number, reason: string, report: RetroativoReport): void {
  const { db } = deps;
  const now = deps.now();
  db.raw.prepare("UPDATE backfill_drafts SET status = 'failed', error = ? WHERE story_id = ?").run(reason, storyId);
  db.saveArticle({ storyId, payloadJson: JSON.stringify({ error: reason }), status: "failed" }, now);
  db.setStoryStatusIf(storyId, "dropped", ["queued", "written", "open"]);
  report.failed++;
  deps.log?.(`retroativo: história ${storyId} falhou (${reason})`);
}

/** Marks a pauta's writing as failed. No alert here (one summary per run). */
function failPauta(deps: BackfillDeps, pautaId: number, reason: string, report: RetroativoReport): void {
  markPauta(deps.db, pautaId, { status: "failed", error: reason });
  report.failed++;
  deps.log?.(`retroativo: pauta ${pautaId} falhou (${reason})`);
}

/**
 * Reads the ended batch's results, matched by `custom_id` only (`story-<id>` and `pauta-<id>`). Each result
 * is saved with its usage (batch prices) in one transaction, so a crash midway never records anything twice.
 * A result that errored, expired, was refused or does not parse as a Draft fails that story or pauta; so
 * does a missing result.
 */
async function collectResults(deps: BackfillDeps, batchId: string, report: RetroativoReport): Promise<void> {
  const { db, ai, config } = deps;
  const pending = new Set(
    all<{ story_id: number }>(db, "SELECT story_id FROM backfill_drafts WHERE batch_id = ? AND status = 'submitted'", batchId).map(
      (r) => r.story_id,
    ),
  );
  const pendingPautas = new Set(
    all<{ id: number }>(db, "SELECT id FROM pautas WHERE batch_id = ? AND status = 'bf_planned'", batchId).map((r) => r.id),
  );

  /** Saves one result: the draft through `save`, or a failure through `fail`. */
  const handle = (
    result: Anthropic.Messages.Batches.MessageBatchIndividualResponse["result"],
    fail: (reason: string) => void,
    save: (draft: Draft) => void,
  ) => {
    if (result.type !== "succeeded") {
      fail(result.type === "errored" ? `erro no lote: ${result.error.error.message}` : `lote: ${result.type}`);
      return;
    }
    const message = result.message;
    ai.recordBatchUsage(config.MODEL_WRITER, message.usage, "write-batch");
    if (message.stop_reason === "refusal") {
      fail("o modelo recusou");
      return;
    }
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const draft = parseDraftText(text);
    if (!draft) {
      fail(`resposta fora do formato (stop_reason ${String(message.stop_reason)})`);
      return;
    }
    save(draft);
    report.drafted++;
  };

  if (pending.size + pendingPautas.size > 0) {
    for await (const response of await deps.batches.results(batchId)) {
      const storyId = storyIdOf(response.custom_id);
      const pautaId = pautaIdOf(response.custom_id);
      if (storyId !== null && pending.has(storyId)) {
        pending.delete(storyId);
        tx(db, () =>
          handle(
            response.result,
            (reason) => failStory(deps, storyId, reason, report),
            (draft) =>
              db.raw
                .prepare("UPDATE backfill_drafts SET status = 'drafted', draft_json = ? WHERE story_id = ?")
                .run(JSON.stringify(draft), storyId),
          ),
        );
      } else if (pautaId !== null && pendingPautas.has(pautaId)) {
        pendingPautas.delete(pautaId);
        tx(db, () =>
          handle(
            response.result,
            (reason) => failPauta(deps, pautaId, reason, report),
            (draft) =>
              db.raw.prepare("UPDATE pautas SET status = 'bf_drafted', draft_json = ? WHERE id = ?").run(JSON.stringify(draft), pautaId),
          ),
        );
      }
    }
    tx(db, () => {
      for (const storyId of pending) failStory(deps, storyId, "sem resultado no lote", report);
      for (const pautaId of pendingPautas) failPauta(deps, pautaId, "sem resultado no lote", report);
    });
  }
  db.raw.prepare("UPDATE backfill_batches SET status = 'processed' WHERE id = ?").run(batchId);
}

/**
 * Fact-checks each batch draft live (fast model); on failure rewrites once through the live writer and
 * checks again (bucket `backfill`). A passing draft is assembled and saved as `ready`; the story is `written`.
 */
async function checkDrafts(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db, ai, config } = deps;
  const rows = all<DraftRow>(db, "SELECT * FROM backfill_drafts WHERE status = 'drafted' ORDER BY story_id");
  for (const row of rows) {
    const story = db.storyById(row.story_id);
    if (!story || !row.draft_json) continue;
    const writing = storyFromJson(row.writing_json);
    const sources = sourcesText(writing);
    const check = { model: config.MODEL_FAST, candidates: writing.candidates };

    let final: Draft | null = JSON.parse(row.draft_json) as Draft;
    let problems: string[] = [];
    try {
      const first = await checkDraft(ai, final, sources, "backfill", check);
      if (!first.ok) {
        // A live Messages call: it uses server-side fallbacks like every live writer call (only the batch omits them).
        const second = await writeDraft(ai, writing, "backfill", {
          models: config,
          now: storyNow(story, deps),
          problems: first.problems,
          fallbacks: true,
        });
        const verdict = await checkDraft(ai, second, sources, "backfill", check);
        final = verdict.ok ? second : null;
        problems = verdict.problems;
      }
    } catch (error) {
      if (error instanceof RefusalError) {
        tx(db, () => failStory(deps, story.id, "o modelo recusou a reescrita", report));
        continue;
      }
      throw error;
    }

    if (!final) {
      tx(db, () => failStory(deps, story.id, `checagem reprovou duas vezes: ${problems.join(" | ")}`, report));
      continue;
    }
    const payload = assemble(final, writing, { insights: insightsOf(writing.candidates) });
    tx(db, () => {
      db.saveArticle({ storyId: story.id, payloadJson: JSON.stringify(payload), status: "ready" }, deps.now());
      db.raw.prepare("UPDATE backfill_drafts SET status = 'done' WHERE story_id = ?").run(story.id);
      db.setStoryStatusIf(story.id, "written", ["queued"]);
    });
    report.ready++;
  }
  await checkPautaDrafts(deps, report);
}

/**
 * The same check for the pautas' batch drafts: checked live (fast model), rewritten once through the live
 * writer with the pauta addendum and fallbacks, checked again. A passing draft gets the format's title,
 * category and game in code, is assembled and saved as `ready`.
 */
async function checkPautaDrafts(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db, ai, config } = deps;
  const rows = all<PautaRow>(db, "SELECT * FROM pautas WHERE mode = 'backfill' AND status = 'bf_drafted' ORDER BY story_date, id");
  for (const row of rows) {
    if (!row.draft_json || !row.writing_json || !row.format) continue;
    const writing = storyFromJson(row.writing_json);
    const sources = sourcesText(writing);
    const check = { model: config.MODEL_FAST, candidates: writing.candidates };

    let final: Draft | null = JSON.parse(row.draft_json) as Draft;
    let problems: string[] = [];
    try {
      const first = await checkDraft(ai, final, sources, "backfill", check);
      if (!first.ok) {
        const second = await writeDraft(ai, writing, "backfill", {
          models: config,
          now: pautaNow(row),
          problems: first.problems,
          fallbacks: true,
          systemExtra: loadPautaStyle(),
        });
        const verdict = await checkDraft(ai, second, sources, "backfill", check);
        final = verdict.ok ? second : null;
        problems = verdict.problems;
      }
    } catch (error) {
      if (error instanceof RefusalError) {
        failPauta(deps, row.id, "o modelo recusou a reescrita", report);
        continue;
      }
      throw error;
    }

    if (!final) {
      failPauta(deps, row.id, `checagem reprovou duas vezes: ${problems.join(" | ")}`, report);
      continue;
    }
    const payload = pautaPayload(finishPautaDraft(final, writing, row.format as PautaFormat), writing);
    markPauta(db, row.id, { status: "ready", payloadJson: JSON.stringify(payload) });
    report.pautasReady++;
  }
}

async function escrever(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db } = deps;
  const failedBefore = report.failed;
  try {
    // A batch submitted by an earlier (crashed or stopped) run is polled, never resubmitted.
    await reconcileSubmission(deps);
    let batchId =
      (db.raw.prepare("SELECT id FROM backfill_batches WHERE status = 'submitted' ORDER BY submitted_at LIMIT 1").get() as
        | { id: string }
        | undefined)?.id ?? null;
    if (!batchId) {
      if (!(await selectStories(deps, report))) return;
      // After the news are chosen, so a pauta only takes a day that still has room for it.
      await planPautas(deps, report);
      if (report.stopped) return;
      batchId = await submitBatch(deps, report);
    }
    if (batchId) {
      report.batchId = batchId;
      await waitForBatch(deps, batchId);
      await collectResults(deps, batchId, report);
    }
    await checkDrafts(deps, report);
  } finally {
    const failed = report.failed - failedBefore;
    if (failed > 0) {
      alert(
        db,
        "checagem",
        `Retroativo: ${failed} história(s) ou pauta(s) não viraram matéria (lote com erro, expirado ou fora do formato, ou checagem reprovada duas vezes).`,
        deps.now(),
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// publicar
// ---------------------------------------------------------------------------------------------

/**
 * Publishes the `ready` backfill articles by ascending `story_date`, one request every 2 s. The backdated
 * time is chosen once and saved with the payload before the POST, and the idempotency key is
 * `articleKey("backfill", storyId)`: a crash and a re-run send the same article, never a second one.
 */
async function publicar(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const refused: string[] = [];
  try {
    await publishReady(deps, report, refused);
  } finally {
    // One alert for every article the site refused in this run (never one per article).
    if (refused.length > 0) {
      alert(deps.db, "api", `Retroativo: o site recusou ${refused.length} matéria(s), marcadas como falhas: ${refused.join("; ")}`, deps.now());
    }
  }
}

async function publishReady(deps: BackfillDeps, report: RetroativoReport, refused: string[]): Promise<void> {
  const { db, config } = deps;
  if (isPaused(config)) {
    report.paused = true;
    pausedAlert(deps);
    deps.log?.("retroativo: PAUSADO, nada publicado");
    return;
  }
  const stories = all<StoryRow>(
    db,
    `SELECT s.* FROM stories s JOIN articles a ON a.story_id = s.id
     WHERE s.mode = 'backfill' AND a.status = 'ready' AND s.story_date IS NOT NULL
     ORDER BY s.story_date, s.id`,
  );
  const pautas = all<PautaRow>(db, "SELECT * FROM pautas WHERE mode = 'backfill' AND status = 'ready' ORDER BY story_date, id");

  /** One article to publish: how to read its saved payload, save it again, and mark it failed or published. */
  type Job = {
    day: string;
    label: string;
    key: string;
    payload: () => ArticlePayload | null;
    save: (payload: ArticlePayload, now: Date) => void;
    fail: (now: Date) => void;
    done: (payload: ArticlePayload, created: { id: string; slug: string }) => void;
  };
  const storyJobs: Job[] = stories.map((story) => ({
    day: story.story_date!,
    label: `história ${story.id}`,
    key: articleKey("backfill", story.id),
    payload: () => {
      const article = db.articleForStory(story.id);
      return article?.status === "ready" ? (JSON.parse(article.payload_json) as ArticlePayload) : null;
    },
    save: (payload, now) => db.saveArticle({ storyId: story.id, payloadJson: JSON.stringify(payload), status: "ready" }, now),
    fail: (now) => {
      db.markArticle(story.id, { status: "failed" }, now);
      db.setStoryStatus(story.id, "dropped");
    },
    done: (payload, created) => {
      db.saveArticle(
        {
          storyId: story.id,
          payloadJson: JSON.stringify(payload),
          status: "published",
          siteId: created.id,
          slug: created.slug,
          publishedAt: new Date(payload.publishedAt!).toISOString(),
        },
        deps.now(),
      );
      db.setStoryStatus(story.id, "published");
      report.published++;
    },
  }));
  const pautaJobs: Job[] = pautas.map((pauta) => ({
    day: pauta.story_date,
    label: `pauta ${pauta.id}`,
    key: pautaKey("backfill", pauta.id),
    payload: () => {
      const row = db.raw.prepare("SELECT status, payload_json FROM pautas WHERE id = ?").get(pauta.id) as
        | { status: string; payload_json: string | null }
        | undefined;
      return row?.status === "ready" && row.payload_json ? (JSON.parse(row.payload_json) as ArticlePayload) : null;
    },
    save: (payload) => markPauta(db, pauta.id, { payloadJson: JSON.stringify(payload) }),
    fail: () => markPauta(db, pauta.id, { status: "failed", error: "recusada pelo site" }),
    done: (payload, created) => {
      markPauta(db, pauta.id, {
        status: "published",
        siteId: created.id,
        slug: created.slug,
        publishedAt: new Date(payload.publishedAt!).toISOString(),
        payloadJson: JSON.stringify(payload),
      });
      report.pautasPublished++;
    },
  }));
  // Oldest day first, the day's news before its pauta (a stable sort keeps each list's order).
  const jobs = [...storyJobs, ...pautaJobs].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  let sent = 0;
  for (const job of jobs) {
    if (isPaused(config)) {
      report.paused = true;
      pausedAlert(deps);
      return;
    }
    const payload = job.payload();
    if (!payload) continue;
    const now = deps.now();
    if (!payload.publishedAt) {
      const at = backdatedTime(job.day, now, deps.rand);
      if (!at) continue; // today's article before 06:05: a later run publishes it
      payload.publishedAt = isoWithOffset(at);
      job.save(payload, now);
    }

    if (sent > 0) await deps.sleep(PUBLISH_INTERVAL_MS);
    sent++;
    let created: { id: string; slug: string };
    try {
      created = await deps.tralked.createArticle(payload, job.key);
    } catch (error) {
      if (!(error instanceof TralkedError)) throw error;
      if (ARTICLE_ERRORS.has(error.status)) {
        job.fail(now);
        report.publishFailed++;
        refused.push(`${job.label} (${error.status} ${error.message})`);
        continue;
      }
      alertOncePerDay(db, "api", `Retroativo: erro da API do site ao publicar: ${error.status} ${error.message}`, now, "Retroativo: erro da API");
      report.stopped = "api";
      return;
    }

    job.done(payload, created);
    deps.log?.(`retroativo: publicada a ${job.label} (${job.day}) → ${created.id}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

const RUNNERS: Record<Phase, (deps: BackfillDeps, report: RetroativoReport) => Promise<void>> = {
  descobrir,
  triar,
  agrupar,
  escrever,
  publicar,
};

/**
 * Runs one phase, or every phase in order (discovery only once: run `descobrir` explicitly to look again).
 * Stops on the backfill budget (one alert) and on site API errors; anything else is thrown, and running the
 * command again resumes from the DB.
 */
export async function runRetroativo(deps: BackfillDeps, phase?: Phase): Promise<RetroativoReport> {
  const { db, config } = deps;
  ensureTables(db);
  const report = emptyReport();
  const phases: readonly Phase[] = phase ? [phase] : PHASES;
  try {
    for (const p of phases) {
      if (!phase && p === "descobrir" && db.getMeta(DISCOVERED_KEY)) continue;
      report.ran.push(p);
      await RUNNERS[p](deps, report);
      if (report.stopped) break;
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      alertOncePerDay(
        db,
        "orcamento",
        `Retroativo: teto de US$ ${config.BACKFILL_BUDGET_USD} atingido (${error.message}). Aumente BACKFILL_BUDGET_USD e rode de novo para continuar.`,
        deps.now(),
        "Retroativo: teto",
      );
      report.stopped = "orcamento";
      return report;
    }
    throw error;
  }
  return report;
}
