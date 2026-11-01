import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { checkDraft } from "./ai/checker.js";
import { BudgetExceededError, RefusalError } from "./ai/client.js";
import { clusterItems, storyKeyOf, type ClusterItem, type OpenStory } from "./ai/cluster.js";
import { TRIAGE_CHUNK, triageItems, type Triage, type TriageInput } from "./ai/triage.js";
import { parseDraftText, sourcesText, writeBatchRequest, writeDraft, type Draft, type StoryForWriting } from "./ai/writer.js";
import { assemble } from "./assemble.js";
import { localDay, randomTimeOn } from "./clock.js";
import { collectBackfill, collectLive, extractText, fetchPage, type RawItem } from "./collect/index.js";
import type { Db, ItemRow, StoryRow } from "./db.js";
import { alert, alertOncePerDay } from "./alerts.js";
import {
  OPEN_STORIES_CAP,
  insightsOf,
  isPaused,
  itemTime,
  pool,
  recomputeStory,
  storyFacts,
  storyForWriting,
  triageOf,
  type PipelineDeps,
} from "./pipeline.js";
import { isPublishable, type Tier } from "./rank.js";
import { TralkedError, articleKey, type ArticlePayload } from "./tralked.js";
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
const FETCH_CONCURRENCY = 6;
const DISCOVERED_KEY = "retroativo.descoberto";
const QUOTAS_KEY = "retroativo.cotas";
/** Site errors that concern one article only (the rest stop the run). */
const ARTICLE_ERRORS = new Set([400, 404, 409, 422]);

/** The slice of the Anthropic Message Batches API the backfill uses (`client.messages.batches`). */
export type BatchApi = {
  create(params: { requests: Anthropic.Messages.Batches.BatchCreateParams.Request[] }): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ id: string; processing_status: string }>;
  results(id: string): Promise<AsyncIterable<Anthropic.Messages.Batches.MessageBatchIndividualResponse>>;
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
  selected: number;
  submitted: number;
  batchId: string | null;
  drafted: number;
  ready: number;
  failed: number;
  published: number;
  publishFailed: number;
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
  selected: 0,
  submitted: 0,
  batchId: null,
  drafted: 0,
  ready: 0,
  failed: 0,
  published: 0,
  publishFailed: 0,
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

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

function parseGames(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
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
 * Each active source's backfill sitemap (child sitemaps followed); RSS sources without a sitemap, or whose
 * sitemap failed without yielding anything, are read from their feed instead. Only items published in the
 * last `BACKFILL_DAYS` days are kept. Newly stored items are tracked as backfill items; URLs the live
 * pipeline already holds stay with it.
 */
async function descobrir(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db, config } = deps;
  const now = deps.now();
  const from = new Date(now.getTime() - config.BACKFILL_DAYS * DAY_MS);
  const active = deps.sources.filter((s) => s.active);

  const sitemaps = await collectBackfill(active, from, now, deps.fetchFn);
  const withItems = new Set(sitemaps.items.map((i) => i.sourceId));
  const sitemapFailed = new Set(sitemaps.failures.map((f) => f.sourceId));
  const fallback = active.filter(
    (s) => s.kind === "rss" && (!s.backfill || (sitemapFailed.has(s.id) && !withItems.has(s.id))),
  );
  const feeds = fallback.length > 0 ? await collectLive(fallback, deps.fetchFn, now) : { items: [], failures: [] };
  const inWindow = (i: RawItem) => i.publishedAt !== null && i.publishedAt >= from && i.publishedAt <= now;
  const items = [...sitemaps.items, ...feeds.items.filter(inWindow)];

  const failures = [...sitemaps.failures, ...feeds.failures];
  report.sourceFailures += failures.length;
  for (const f of failures) deps.log?.(`retroativo: fonte ${f.sourceId} com falha (${f.error})`);

  const track = db.raw.prepare("INSERT OR IGNORE INTO backfill_items (item_id) SELECT id FROM items WHERE url = ?");
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
    track.run(normalizeUrl(item.url));
    report.inserted++;
  }
  db.setMeta(DISCOVERED_KEY, now.toISOString());
}

// ---------------------------------------------------------------------------------------------
// triar
// ---------------------------------------------------------------------------------------------

/**
 * Triages the backfill items not triaged yet: `new` ones, and ones the live pipeline dropped untriaged as
 * stale. 50 per call, each chunk saved before the next (a budget stop loses nothing). Unanswered items
 * stay as they are for the next run.
 */
async function triar(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db, config } = deps;
  const sourcesById = new Map(deps.sources.map((s) => [s.id, s]));
  const pending = all<ItemRow>(
    db,
    `SELECT items.* FROM items JOIN backfill_items b ON b.item_id = items.id
     WHERE items.status = 'new' OR (items.status = 'dropped' AND items.triage_json IS NULL)
     ORDER BY items.id`,
  );
  const inputs: TriageInput[] = pending.flatMap((item) => {
    const source = sourcesById.get(item.source_id);
    return source ? [{ id: item.id, title: item.title, summary: item.summary, source }] : [];
  });
  for (let i = 0; i < inputs.length; i += TRIAGE_CHUNK) {
    const triages = await triageItems(deps.ai, inputs.slice(i, i + TRIAGE_CHUNK), "backfill", { model: config.MODEL_FAST });
    tx(db, () => {
      for (const t of triages) {
        db.setItemStatus(t.id, t.keep ? "triaged" : "dropped", JSON.stringify(t));
        report.triaged++;
        if (t.keep) report.kept++;
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// agrupar
// ---------------------------------------------------------------------------------------------

/** Stories open while clustering `day`: backfill stories of that day and the day before, and live stories of those days. */
function openStoriesFor(db: Db, day: string): OpenStory[] {
  const prev = shiftDay(day, -1);
  const days = new Set([prev, day]);
  return all<StoryRow>(db, "SELECT * FROM stories WHERE story_date IN (?, ?) OR mode = 'live'", prev, day)
    .filter((s) =>
      s.mode === "backfill"
        ? s.story_date !== null && days.has(s.story_date)
        : days.has(localDay(new Date(s.first_seen_at))) || days.has(localDay(new Date(s.last_item_at))),
    )
    .sort((a, b) => Date.parse(b.last_item_at) - Date.parse(a.last_item_at))
    .slice(0, OPEN_STORIES_CAP)
    .map((s) => ({ key: s.key, headline: s.headline, games: parseGames(s.games_json) }));
}

/**
 * Clusters the triaged backfill items one local day at a time, oldest day first, items in time order.
 * Every result goes to `storyKeyOf(r)`: a founder creates the story (mode `backfill`, `story_date` = the
 * day), later items join. An item that joins a live story stays with it (never written again here).
 */
async function agrupar(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db, config } = deps;
  const now = deps.now();
  const items = all<ItemRow>(
    db,
    `SELECT items.* FROM items JOIN backfill_items b ON b.item_id = items.id
     WHERE items.status = 'triaged' AND items.triage_json IS NOT NULL`,
  );
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

/** Quotas computed once (from the open stories after clustering) and stored, so a resumed run keeps them. */
function quotasFor(deps: BackfillDeps): Map<string, number> {
  const saved = deps.db.getMeta(QUOTAS_KEY);
  if (saved) return new Map(Object.entries(JSON.parse(saved) as Record<string, number>));
  const counts = new Map<string, number>();
  for (const story of backfillStories(deps.db, "open")) {
    if (story.story_date && couldBePublishable(story, deps)) counts.set(story.story_date, (counts.get(story.story_date) ?? 0) + 1);
  }
  const quotas = dayQuotas(counts, deps.config.BACKFILL_TOTAL, deps.config.MAX_PER_DAY);
  if (quotas.size > 0) deps.db.setMeta(QUOTAS_KEY, JSON.stringify(Object.fromEntries(quotas)));
  return quotas;
}

async function fetchTexts(stories: StoryRow[], deps: BackfillDeps): Promise<void> {
  const items = stories
    .flatMap((s) => deps.db.itemsForStory(s.id))
    .filter((i) => i.text_unavailable !== 1 && (i.text ?? "").trim() === "");
  await pool(items, FETCH_CONCURRENCY, async (item) => {
    try {
      const { text, finalUrl } = await fetchPage(item.url, deps.fetchFn);
      const extracted = extractText(text, finalUrl);
      if (extracted?.text) deps.db.setItemText(item.id, extracted.text);
    } catch (error) {
      deps.log?.(`retroativo: texto indisponível: ${item.url} (${errorMessage(error)})`);
    }
  });
}

const countOf = (db: Db, sql: string, ...args: (string | number)[]) =>
  (db.raw.prepare(sql).get(...args) as { n: number }).n;

/**
 * Per day (oldest first): the open backfill stories are ranked by score and the best ones become `queued`
 * up to the day's quota; their texts are fetched as they are picked, and a story that is not publishable
 * once fetched (R15) gives its place to the next. The rest of the day's open stories are dropped. The day
 * never goes over `MAX_PER_DAY` counting articles already published on it.
 */
async function selectStories(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db, config } = deps;
  const now = deps.now();
  const quotas = quotasFor(deps);
  const open = backfillStories(db, "open");
  const days = [...new Set(open.map((s) => s.story_date).filter((d): d is string => d !== null))].sort();

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
    const otherPublished = Math.max(0, db.publishedCountOn(day) - backfillPublished);
    const allowed = Math.max(0, Math.min((quotas.get(day) ?? 0) - taken, config.MAX_PER_DAY - otherPublished - taken));

    const ranked = ofDay.filter((s) => couldBePublishable(s, deps)).sort((a, b) => b.score - a.score || a.id - b.id);
    const selected: StoryRow[] = [];
    let next = 0;
    while (selected.length < allowed && next < ranked.length) {
      const slice = ranked.slice(next, next + allowed - selected.length);
      next += slice.length;
      await fetchTexts(slice, deps);
      for (const s of slice) if (storyFacts(s, deps, now).publishable) selected.push(s);
    }

    const chosen = new Set(selected.map((s) => s.id));
    tx(db, () => {
      for (const s of ofDay) db.setStoryStatusIf(s.id, chosen.has(s.id) ? "queued" : "dropped", ["open"]);
    });
    report.selected += selected.length;
  }
}

/** Submits ONE batch with every queued backfill story not yet sent; the batch id is stored with the stories. */
async function submitBatch(deps: BackfillDeps, report: RetroativoReport): Promise<string | null> {
  const { db, ai, config } = deps;
  const toWrite = all<StoryRow>(
    db,
    `SELECT s.* FROM stories s LEFT JOIN backfill_drafts d ON d.story_id = s.id
     WHERE s.mode = 'backfill' AND s.status = 'queued' AND d.story_id IS NULL
     ORDER BY s.story_date, s.id`,
  );
  if (toWrite.length === 0) return null;

  // `batchRequest` does not check the budget: stop here, before building or submitting anything.
  ai.assertBudget("backfill");

  const entries: { story: StoryRow; writing: StoryForWriting; request: ReturnType<typeof writeBatchRequest> }[] = [];
  for (const story of toWrite) {
    const writing = await storyForWriting(story, deps);
    const request = writeBatchRequest(ai, writing, customIdOf(story.id), { models: config, now: storyNow(story, deps) });
    entries.push({ story, writing, request });
  }

  const batch = await deps.batches.create({ requests: entries.map((e) => e.request) });
  const at = deps.now().toISOString();
  tx(db, () => {
    db.raw.prepare("INSERT INTO backfill_batches (id, submitted_at, status) VALUES (?, ?, 'submitted')").run(batch.id, at);
    const insert = db.raw.prepare("INSERT INTO backfill_drafts (story_id, batch_id, writing_json, status) VALUES (?, ?, ?, 'submitted')");
    for (const e of entries) insert.run(e.story.id, batch.id, JSON.stringify(e.writing));
  });
  report.submitted += entries.length;
  deps.log?.(`retroativo: lote ${batch.id} enviado com ${entries.length} matérias`);
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

/**
 * Reads the ended batch's results, matched to stories by `custom_id` only. Each result is saved with its
 * usage (batch prices) in one transaction, so a crash midway never records anything twice. A result that
 * errored, expired, was refused or does not parse as a Draft fails that story; so does a missing result.
 */
async function collectResults(deps: BackfillDeps, batchId: string, report: RetroativoReport): Promise<void> {
  const { db, ai, config } = deps;
  const pending = new Set(
    all<{ story_id: number }>(db, "SELECT story_id FROM backfill_drafts WHERE batch_id = ? AND status = 'submitted'", batchId).map(
      (r) => r.story_id,
    ),
  );
  if (pending.size > 0) {
    for await (const response of await deps.batches.results(batchId)) {
      const storyId = storyIdOf(response.custom_id);
      if (storyId === null || !pending.has(storyId)) continue;
      pending.delete(storyId);
      const result = response.result;
      tx(db, () => {
        if (result.type !== "succeeded") {
          const reason = result.type === "errored" ? `erro no lote: ${result.error.error.message}` : `lote: ${result.type}`;
          failStory(deps, storyId, reason, report);
          return;
        }
        const message = result.message;
        ai.recordBatchUsage(config.MODEL_WRITER, message.usage, "write-batch");
        if (message.stop_reason === "refusal") {
          failStory(deps, storyId, "o modelo recusou", report);
          return;
        }
        const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const draft = parseDraftText(text);
        if (!draft) {
          failStory(deps, storyId, `resposta fora do formato (stop_reason ${String(message.stop_reason)})`, report);
          return;
        }
        db.raw
          .prepare("UPDATE backfill_drafts SET status = 'drafted', draft_json = ? WHERE story_id = ?")
          .run(JSON.stringify(draft), storyId);
        report.drafted++;
      });
    }
    tx(db, () => {
      for (const storyId of pending) failStory(deps, storyId, "sem resultado no lote", report);
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
        const second = await writeDraft(ai, writing, "backfill", { models: config, now: storyNow(story, deps), problems: first.problems });
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
}

async function escrever(deps: BackfillDeps, report: RetroativoReport): Promise<void> {
  const { db } = deps;
  const failedBefore = report.failed;
  try {
    // A batch submitted by an earlier (crashed or stopped) run is polled, never resubmitted.
    let batchId =
      (db.raw.prepare("SELECT id FROM backfill_batches WHERE status = 'submitted' ORDER BY submitted_at LIMIT 1").get() as
        | { id: string }
        | undefined)?.id ?? null;
    if (!batchId) {
      await selectStories(deps, report);
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
        `Retroativo: ${failed} história(s) não viraram matéria (lote com erro, expirado ou fora do formato, ou checagem reprovada duas vezes).`,
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
  const ready = all<StoryRow>(
    db,
    `SELECT s.* FROM stories s JOIN articles a ON a.story_id = s.id
     WHERE s.mode = 'backfill' AND a.status = 'ready' AND s.story_date IS NOT NULL
     ORDER BY s.story_date, s.id`,
  );

  let sent = 0;
  for (const story of ready) {
    if (isPaused(config)) {
      report.paused = true;
      pausedAlert(deps);
      return;
    }
    const article = db.articleForStory(story.id);
    if (article?.status !== "ready") continue;
    const now = deps.now();
    const payload = JSON.parse(article.payload_json) as ArticlePayload;
    if (!payload.publishedAt) {
      const at = backdatedTime(story.story_date!, now, deps.rand);
      if (!at) continue; // today's story before 06:05: a later run publishes it
      payload.publishedAt = isoWithOffset(at);
      db.saveArticle({ storyId: story.id, payloadJson: JSON.stringify(payload), status: "ready" }, now);
    }

    if (sent > 0) await deps.sleep(PUBLISH_INTERVAL_MS);
    sent++;
    let created: { id: string; slug: string };
    try {
      created = await deps.tralked.createArticle(payload, articleKey("backfill", story.id));
    } catch (error) {
      if (!(error instanceof TralkedError)) throw error;
      if (ARTICLE_ERRORS.has(error.status)) {
        db.markArticle(story.id, { status: "failed" }, now);
        db.setStoryStatus(story.id, "dropped");
        report.publishFailed++;
        refused.push(`${story.id} (${error.status} ${error.message})`);
        continue;
      }
      alertOncePerDay(db, "api", `Retroativo: erro da API do site ao publicar: ${error.status} ${error.message}`, now, "Retroativo: erro da API");
      report.stopped = "api";
      return;
    }

    db.saveArticle(
      {
        storyId: story.id,
        payloadJson: JSON.stringify(payload),
        status: "published",
        siteId: created.id,
        slug: created.slug,
        publishedAt: new Date(payload.publishedAt).toISOString(),
      },
      deps.now(),
    );
    db.setStoryStatus(story.id, "published");
    report.published++;
    deps.log?.(`retroativo: publicada a história ${story.id} (${story.story_date}) → ${created.id}`);
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
