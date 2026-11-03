import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AlertRow } from "../db.js";

/** The guide robot's own SQLite (`robo-guias.db`): fetched pages (its cache), runs, spend, dossiers. */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  url TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  status TEXT NOT NULL,
  final_url TEXT NOT NULL,
  text TEXT,
  html TEXT,
  content_hash TEXT,
  text_version INTEGER
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_request ON runs(request_id);

CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spend_request ON spend(request_id);

CREATE TABLE IF NOT EXISTS dossiers (
  request_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

export interface PageRow {
  url: string;
  fetched_at: string;
  status: string;
  final_url: string;
  text: string | null;
  html: string | null;
  content_hash: string | null;
  /** `PAGE_TEXT_VERSION` of the extractor that made `text`; null for pages stored before it existed. */
  text_version: number | null;
}

export interface PageInput {
  url: string;
  fetchedAt: Date;
  status: string;
  finalUrl: string;
  text?: string | null;
  html?: string | null;
  contentHash?: string | null;
  textVersion?: number | null;
}

export interface RunInput {
  requestId: string;
  attempt: number;
  startedAt: Date;
  finishedAt?: Date | null;
  outcome?: string | null;
}

export interface GuideDb {
  raw: DatabaseSync;
  dir: string;
  close(): void;
  getPage(url: string): PageRow | undefined;
  savePage(page: PageInput): void;
  recordRun(run: RunInput): void;
  /** Spend of one guide request, in USD. */
  spentForRequest(requestId: string): number;
  recordSpend(requestId: string, purpose: string, model: string, usd: number, at?: Date): void;
  getDossier(requestId: string): unknown | undefined;
  saveDossier(requestId: string, dossier: unknown, at?: Date): void;
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  addAlert(kind: string, message: string, now?: Date): void;
  alerts(): AlertRow[];
}

export function openGuideDb(dir: string): GuideDb {
  const memory = dir === ":memory:";
  if (!memory) mkdirSync(dir, { recursive: true });
  const raw = new DatabaseSync(memory ? ":memory:" : join(dir, "robo-guias.db"));
  raw.exec("PRAGMA journal_mode=WAL");
  raw.exec("PRAGMA busy_timeout=5000");
  raw.exec(SCHEMA);
  // Databases created before `text_version` existed.
  const pageColumns = raw.prepare("PRAGMA table_info(pages)").all() as unknown as { name: string }[];
  if (!pageColumns.some((c) => c.name === "text_version")) raw.exec("ALTER TABLE pages ADD COLUMN text_version INTEGER");

  const one = <T>(sql: string, ...args: (string | number | null)[]) =>
    raw.prepare(sql).get(...args) as unknown as T | undefined;

  return {
    raw,
    dir,
    close: () => raw.close(),

    getPage: (url) => one<PageRow>("SELECT * FROM pages WHERE url = ?", url),

    savePage(page) {
      raw
        .prepare(
          `INSERT INTO pages (url, fetched_at, status, final_url, text, html, content_hash, text_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(url) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status,
             final_url = excluded.final_url, text = excluded.text, html = excluded.html, content_hash = excluded.content_hash,
             text_version = excluded.text_version`,
        )
        .run(
          page.url,
          page.fetchedAt.toISOString(),
          page.status,
          page.finalUrl,
          page.text ?? null,
          page.html ?? null,
          page.contentHash ?? null,
          page.textVersion ?? null,
        );
    },

    recordRun(run) {
      raw
        .prepare("INSERT INTO runs (request_id, attempt, started_at, finished_at, outcome) VALUES (?, ?, ?, ?, ?)")
        .run(run.requestId, run.attempt, run.startedAt.toISOString(), run.finishedAt?.toISOString() ?? null, run.outcome ?? null);
    },

    spentForRequest: (requestId) =>
      one<{ total: number }>("SELECT COALESCE(SUM(usd), 0) AS total FROM spend WHERE request_id = ?", requestId)!.total,

    recordSpend(requestId, purpose, model, usd, at = new Date()) {
      raw
        .prepare("INSERT INTO spend (at, request_id, purpose, model, usd) VALUES (?, ?, ?, ?, ?)")
        .run(at.toISOString(), requestId, purpose, model, usd);
    },

    getDossier(requestId) {
      const row = one<{ json: string }>("SELECT json FROM dossiers WHERE request_id = ?", requestId);
      return row ? (JSON.parse(row.json) as unknown) : undefined;
    },

    saveDossier(requestId, dossier, at = new Date()) {
      raw
        .prepare(
          `INSERT INTO dossiers (request_id, json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(request_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        )
        .run(requestId, JSON.stringify(dossier), at.toISOString());
    },

    getMeta: (key) => one<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value,

    setMeta(key, value) {
      raw
        .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(key, value);
    },

    addAlert(kind, message, now = new Date()) {
      raw.prepare("INSERT INTO alerts (at, kind, message, emailed) VALUES (?, ?, ?, 0)").run(now.toISOString(), kind, message);
    },

    alerts: () => raw.prepare("SELECT * FROM alerts ORDER BY id").all() as unknown as AlertRow[],
  };
}
