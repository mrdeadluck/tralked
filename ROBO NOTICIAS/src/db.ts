import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localDay } from "./clock.js";
import { normalizeUrl } from "./url.js";

/**
 * `bf_new` and `bf_triaged` belong to the backfill only: the live pipeline reads `new` and `triaged`, so it
 * never triages, fetches or clusters an item the backfill is working on.
 */
export type ItemStatus = "new" | "triaged" | "dropped" | "clustered" | "bf_new" | "bf_triaged";
export type StoryStatus = "open" | "queued" | "written" | "published" | "dropped" | "expired";
export type StoryMode = "live" | "backfill";
export type ArticleStatus = "ready" | "published" | "failed" | "archived";
export type SpendBucket = "live" | "backfill";

export interface ItemRow {
  id: number;
  url: string;
  source_id: string;
  title: string;
  summary: string | null;
  published_at: string | null;
  fetched_at: string;
  content_hash: string | null;
  text: string | null;
  status: ItemStatus;
  triage_json: string | null;
  /** Publisher name from the feed (Google News `<source>`), when known. */
  publisher: string | null;
  /** 1 when the item has no fetchable article page (unresolved Google News link): title-only. */
  text_unavailable: number;
}

export interface StoryRow {
  id: number;
  key: string;
  headline: string;
  category: string;
  score: number;
  bomb: number;
  rumor: number;
  games_json: string;
  first_seen_at: string;
  last_item_at: string;
  status: StoryStatus;
  mode: StoryMode;
  story_date: string | null;
  /** Set on a follow-up story: the article it follows up on. */
  parent_article_id: number | null;
}

export interface ArticleRow {
  id: number;
  story_id: number;
  site_id: string | null;
  slug: string | null;
  published_at: string | null;
  payload_json: string;
  status: ArticleStatus;
  updated_at: string;
  parent_article_id: number | null;
}

export interface SourceHealthRow {
  source_id: string;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
}

export interface AlertRow {
  id: number;
  at: string;
  kind: string;
  message: string;
  emailed: number;
}

export interface NewItem {
  url: string;
  sourceId: string;
  title: string;
  summary?: string | null;
  publishedAt?: string | null;
  contentHash?: string | null;
  text?: string | null;
  publisher?: string | null;
  textUnavailable?: boolean;
}

export interface StoryInput {
  key: string;
  headline: string;
  category: string;
  score: number;
  bomb: boolean;
  rumor: boolean;
  gamesJson: string;
  mode: StoryMode;
  storyDate?: string | null;
  status?: StoryStatus;
  /** ISO timestamp of the most recent item; defaults to now. */
  lastItemAt?: string;
  /** Follow-up stories: the article they follow up on. Set on insert only. */
  parentArticleId?: number | null;
}

export interface ArticleInput {
  storyId: number;
  payloadJson: string;
  status?: ArticleStatus;
  siteId?: string | null;
  slug?: string | null;
  publishedAt?: string | null;
  parentArticleId?: number | null;
}

export interface ArticlePatch {
  status?: ArticleStatus;
  siteId?: string | null;
  slug?: string | null;
  publishedAt?: string | null;
}

const ITEM_STATUSES = "'new','triaged','dropped','clustered','bf_new','bf_triaged'";

const ITEM_COLUMNS = [
  "id",
  "url",
  "source_id",
  "title",
  "summary",
  "published_at",
  "fetched_at",
  "content_hash",
  "text",
  "status",
  "triage_json",
  "publisher",
  "text_unavailable",
];

const itemsTable = (name: string) => `
CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  content_hash TEXT,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (${ITEM_STATUSES})),
  triage_json TEXT,
  publisher TEXT,
  text_unavailable INTEGER NOT NULL DEFAULT 0
);`;

const ITEM_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_hash ON items(content_hash);`;

const SCHEMA = `
${itemsTable("items")}
${ITEM_INDEXES}

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  category TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  bomb INTEGER NOT NULL DEFAULT 0,
  rumor INTEGER NOT NULL DEFAULT 0,
  games_json TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL,
  last_item_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','queued','written','published','dropped','expired')),
  mode TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('live','backfill')),
  story_date TEXT,
  parent_article_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);

CREATE TABLE IF NOT EXISTS story_items (
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, item_id)
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL UNIQUE REFERENCES stories(id) ON DELETE CASCADE,
  site_id TEXT,
  slug TEXT,
  published_at TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','published','failed','archived')),
  updated_at TEXT NOT NULL,
  parent_article_id INTEGER REFERENCES articles(id)
);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(status, published_at);

CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('live','backfill')),
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spend_bucket_at ON spend(bucket, at);

CREATE TABLE IF NOT EXISTS source_health (
  source_id TEXT PRIMARY KEY,
  last_ok_at TEXT,
  last_error_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS article_updates (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_article_updates_story ON article_updates(story_id);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  emailed INTEGER NOT NULL DEFAULT 0
);
`;

/** Columns added after the first release: added to existing databases on open. */
const ADDED_COLUMNS: [table: string, column: string, ddl: string][] = [
  ["items", "publisher", "TEXT"],
  ["items", "text_unavailable", "INTEGER NOT NULL DEFAULT 0"],
  ["stories", "parent_article_id", "INTEGER"],
];

function addMissingColumns(raw: DatabaseSync): void {
  for (const [table, column, ddl] of ADDED_COLUMNS) {
    const columns = raw.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
    if (!columns.some((c) => c.name === column)) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/**
 * Databases created before the backfill statuses have a narrower CHECK on `items.status`. SQLite cannot
 * alter a CHECK, so the table is rebuilt (SQLite's documented procedure: foreign keys off so the drop does
 * not cascade to `story_items`, copy, drop, rename, indexes back), all in one transaction.
 */
function widenItemStatuses(raw: DatabaseSync): void {
  const row = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'").get() as
    | { sql: string }
    | undefined;
  if (!row || row.sql.includes("'bf_triaged'")) return;
  const cols = ITEM_COLUMNS.join(", ");
  raw.exec("PRAGMA foreign_keys=OFF");
  try {
    raw.exec("BEGIN");
    try {
      raw.exec(itemsTable("items_widened"));
      raw.exec(`INSERT INTO items_widened (${cols}) SELECT ${cols} FROM items`);
      raw.exec("DROP TABLE items");
      raw.exec("ALTER TABLE items_widened RENAME TO items");
      raw.exec(ITEM_INDEXES);
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  } finally {
    raw.exec("PRAGMA foreign_keys=ON");
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Db {
  raw: DatabaseSync;
  /** The data directory this database lives in (":memory:" for an in-memory one); logs go under it. */
  dir: string;
  close(): void;

  /** Returns false when the normalized URL (or a provided content hash) is already stored. */
  insertItemIfNew(item: NewItem, now?: Date): boolean;
  itemsByStatus(status: ItemStatus, limit?: number): ItemRow[];
  setItemStatus(id: number, status: ItemStatus, triageJson?: string | null): void;
  setItemText(id: number, text: string): void;
  /** The story's items, in id order. */
  itemsForStory(storyId: number): ItemRow[];

  /** Insert or update by `key`; returns the story id. */
  upsertStory(story: StoryInput, now?: Date): number;
  attachItem(storyId: number, itemId: number): void;
  itemIdsForStory(storyId: number): number[];
  storiesByStatus(status: StoryStatus, limit?: number): StoryRow[];
  setStoryStatus(id: number, status: StoryStatus): void;
  /** Changes the status only when it is currently one of `from`; true when the row changed (atomic claim). */
  setStoryStatusIf(id: number, status: StoryStatus, from: StoryStatus[]): boolean;
  storyById(id: number): StoryRow | undefined;
  storyByKey(key: string): StoryRow | undefined;
  /** Follow-up stories of an article, newest first. */
  followUpsOf(articleId: number): StoryRow[];

  recordSpend(bucket: SpendBucket, purpose: string, model: string, usd: number, at?: Date): void;
  spentToday(bucket: SpendBucket, now?: Date): number;
  spentTotal(bucket: SpendBucket): number;

  publishedCountOn(day: string): number;
  /** Insert or update by story id; returns the article id. */
  saveArticle(article: ArticleInput, now?: Date): number;
  markArticle(storyId: number, patch: ArticlePatch, now?: Date): void;
  articleForStory(storyId: number): ArticleRow | undefined;
  articleById(id: number): ArticleRow | undefined;
  /** Same-day updates (PATCH) of a story's article. */
  recordUpdate(storyId: number, at?: Date): void;
  updateTimes(storyId: number): string[];

  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;

  markSourceOk(sourceId: string, now?: Date): void;
  markSourceError(sourceId: string, message: string, now?: Date): void;
  sourceHealth(sourceId: string): SourceHealthRow | undefined;

  addAlert(kind: string, message: string, now?: Date): void;
  alerts(): AlertRow[];
}

export function openDb(dir: string): Db {
  const memory = dir === ":memory:";
  if (!memory) mkdirSync(dir, { recursive: true });
  const raw = new DatabaseSync(memory ? ":memory:" : join(dir, "robo.db"));
  raw.exec("PRAGMA journal_mode=WAL");
  raw.exec("PRAGMA foreign_keys=ON");
  raw.exec("PRAGMA busy_timeout=5000");
  raw.exec(SCHEMA);
  addMissingColumns(raw);
  widenItemStatuses(raw);

  const iso = (d: Date) => d.toISOString();
  const rows = <T>(sql: string, ...args: (string | number | null)[]) =>
    raw.prepare(sql).all(...args) as unknown as T[];
  const one = <T>(sql: string, ...args: (string | number | null)[]) =>
    raw.prepare(sql).get(...args) as unknown as T | undefined;

  return {
    raw,
    dir,
    close: () => raw.close(),

    insertItemIfNew(item, now = new Date()) {
      const url = normalizeUrl(item.url);
      if (one("SELECT 1 AS x FROM items WHERE url = ?", url)) return false;
      if (item.contentHash && one("SELECT 1 AS x FROM items WHERE content_hash = ?", item.contentHash)) {
        return false;
      }
      raw
        .prepare(
          `INSERT INTO items (url, source_id, title, summary, published_at, fetched_at, content_hash, text, status, publisher, text_unavailable)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
        )
        .run(
          url,
          item.sourceId,
          item.title,
          item.summary ?? null,
          item.publishedAt ?? null,
          iso(now),
          item.contentHash ?? null,
          item.text ?? null,
          item.publisher ?? null,
          item.textUnavailable ? 1 : 0,
        );
      return true;
    },

    itemsByStatus(status, limit = 1000) {
      return rows<ItemRow>("SELECT * FROM items WHERE status = ? ORDER BY id LIMIT ?", status, limit);
    },

    setItemStatus(id, status, triageJson) {
      if (triageJson === undefined) {
        raw.prepare("UPDATE items SET status = ? WHERE id = ?").run(status, id);
      } else {
        raw.prepare("UPDATE items SET status = ?, triage_json = ? WHERE id = ?").run(status, triageJson, id);
      }
    },

    setItemText(id, text) {
      raw.prepare("UPDATE items SET text = ? WHERE id = ?").run(text, id);
    },

    itemsForStory(storyId) {
      return rows<ItemRow>(
        "SELECT items.* FROM items JOIN story_items ON story_items.item_id = items.id WHERE story_items.story_id = ? ORDER BY items.id",
        storyId,
      );
    },

    upsertStory(s, now = new Date()) {
      const last = s.lastItemAt ?? iso(now);
      raw
        .prepare(
          `INSERT INTO stories (key, headline, category, score, bomb, rumor, games_json, first_seen_at, last_item_at, status, mode, story_date, parent_article_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             headline = excluded.headline,
             category = excluded.category,
             score = excluded.score,
             bomb = excluded.bomb,
             rumor = excluded.rumor,
             games_json = excluded.games_json,
             last_item_at = excluded.last_item_at,
             mode = excluded.mode,
             story_date = COALESCE(excluded.story_date, stories.story_date)${
               s.status ? ",\n             status = excluded.status" : ""
             }`,
        )
        .run(
          s.key,
          s.headline,
          s.category,
          s.score,
          s.bomb ? 1 : 0,
          s.rumor ? 1 : 0,
          s.gamesJson,
          iso(now),
          last,
          s.status ?? "open",
          s.mode,
          s.storyDate ?? null,
          s.parentArticleId ?? null,
        );
      return one<{ id: number }>("SELECT id FROM stories WHERE key = ?", s.key)!.id;
    },

    attachItem(storyId, itemId) {
      raw.prepare("INSERT OR IGNORE INTO story_items (story_id, item_id) VALUES (?, ?)").run(storyId, itemId);
    },

    itemIdsForStory(storyId) {
      return rows<{ item_id: number }>(
        "SELECT item_id FROM story_items WHERE story_id = ? ORDER BY item_id",
        storyId,
      ).map((r) => r.item_id);
    },

    storiesByStatus(status, limit = 1000) {
      return rows<StoryRow>("SELECT * FROM stories WHERE status = ? ORDER BY score DESC, id LIMIT ?", status, limit);
    },

    setStoryStatus(id, status) {
      raw.prepare("UPDATE stories SET status = ? WHERE id = ?").run(status, id);
    },

    setStoryStatusIf(id, status, from) {
      if (from.length === 0) return false;
      const result = raw
        .prepare(`UPDATE stories SET status = ? WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`)
        .run(status, id, ...from);
      return Number(result.changes) === 1;
    },

    storyById(id) {
      return one<StoryRow>("SELECT * FROM stories WHERE id = ?", id);
    },

    storyByKey(key) {
      return one<StoryRow>("SELECT * FROM stories WHERE key = ?", key);
    },

    followUpsOf(articleId) {
      return rows<StoryRow>("SELECT * FROM stories WHERE parent_article_id = ? ORDER BY id DESC", articleId);
    },

    recordSpend(bucket, purpose, model, usd, at = new Date()) {
      raw
        .prepare("INSERT INTO spend (at, bucket, purpose, model, usd) VALUES (?, ?, ?, ?, ?)")
        .run(iso(at), bucket, purpose, model, usd);
    },

    spentToday(bucket, now = new Date()) {
      const today = localDay(now);
      // A local day spans at most ~24h around "now"; fetch a 2-day window and filter by local day.
      const from = iso(new Date(now.getTime() - 2 * DAY_MS));
      const to = iso(new Date(now.getTime() + 2 * DAY_MS));
      return rows<{ at: string; usd: number }>(
        "SELECT at, usd FROM spend WHERE bucket = ? AND at >= ? AND at <= ?",
        bucket,
        from,
        to,
      )
        .filter((r) => localDay(new Date(r.at)) === today)
        .reduce((sum, r) => sum + r.usd, 0);
    },

    spentTotal(bucket) {
      return one<{ total: number }>("SELECT COALESCE(SUM(usd), 0) AS total FROM spend WHERE bucket = ?", bucket)!.total;
    },

    publishedCountOn(day) {
      const mid = Date.parse(`${day}T12:00:00Z`);
      const from = iso(new Date(mid - 2 * DAY_MS));
      const to = iso(new Date(mid + 2 * DAY_MS));
      return rows<{ published_at: string }>(
        "SELECT published_at FROM articles WHERE status = 'published' AND published_at >= ? AND published_at <= ?",
        from,
        to,
      ).filter((r) => localDay(new Date(r.published_at)) === day).length;
    },

    saveArticle(a, now = new Date()) {
      raw
        .prepare(
          `INSERT INTO articles (story_id, site_id, slug, published_at, payload_json, status, updated_at, parent_article_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(story_id) DO UPDATE SET
             site_id = COALESCE(excluded.site_id, articles.site_id),
             slug = COALESCE(excluded.slug, articles.slug),
             published_at = COALESCE(excluded.published_at, articles.published_at),
             payload_json = excluded.payload_json,
             status = excluded.status,
             updated_at = excluded.updated_at,
             parent_article_id = COALESCE(excluded.parent_article_id, articles.parent_article_id)`,
        )
        .run(
          a.storyId,
          a.siteId ?? null,
          a.slug ?? null,
          a.publishedAt ?? null,
          a.payloadJson,
          a.status ?? "ready",
          iso(now),
          a.parentArticleId ?? null,
        );
      return one<{ id: number }>("SELECT id FROM articles WHERE story_id = ?", a.storyId)!.id;
    },

    markArticle(storyId, patch, now = new Date()) {
      raw
        .prepare(
          `UPDATE articles SET
             status = COALESCE(?, status),
             site_id = COALESCE(?, site_id),
             slug = COALESCE(?, slug),
             published_at = COALESCE(?, published_at),
             updated_at = ?
           WHERE story_id = ?`,
        )
        .run(patch.status ?? null, patch.siteId ?? null, patch.slug ?? null, patch.publishedAt ?? null, iso(now), storyId);
    },

    articleForStory(storyId) {
      return one<ArticleRow>("SELECT * FROM articles WHERE story_id = ?", storyId);
    },

    articleById(id) {
      return one<ArticleRow>("SELECT * FROM articles WHERE id = ?", id);
    },

    recordUpdate(storyId, at = new Date()) {
      raw.prepare("INSERT INTO article_updates (story_id, at) VALUES (?, ?)").run(storyId, iso(at));
    },

    updateTimes(storyId) {
      return rows<{ at: string }>("SELECT at FROM article_updates WHERE story_id = ? ORDER BY at", storyId).map((r) => r.at);
    },

    getMeta(key) {
      return one<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value;
    },

    setMeta(key, value) {
      raw
        .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(key, value);
    },

    markSourceOk(sourceId, now = new Date()) {
      raw
        .prepare(
          `INSERT INTO source_health (source_id, last_ok_at) VALUES (?, ?)
           ON CONFLICT(source_id) DO UPDATE SET last_ok_at = excluded.last_ok_at`,
        )
        .run(sourceId, iso(now));
    },

    markSourceError(sourceId, message, now = new Date()) {
      raw
        .prepare(
          `INSERT INTO source_health (source_id, last_error_at, last_error) VALUES (?, ?, ?)
           ON CONFLICT(source_id) DO UPDATE SET last_error_at = excluded.last_error_at, last_error = excluded.last_error`,
        )
        .run(sourceId, iso(now), message);
    },

    sourceHealth(sourceId) {
      return one<SourceHealthRow>("SELECT * FROM source_health WHERE source_id = ?", sourceId);
    },

    addAlert(kind, message, now = new Date()) {
      raw.prepare("INSERT INTO alerts (at, kind, message, emailed) VALUES (?, ?, ?, 0)").run(iso(now), kind, message);
    },

    alerts() {
      return rows<AlertRow>("SELECT * FROM alerts ORDER BY id");
    },
  };
}
