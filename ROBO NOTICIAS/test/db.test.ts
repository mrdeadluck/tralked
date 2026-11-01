import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db.js";

let db: Db;

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), "robo-db-")));
});

const item = (url: string, extra = {}) => ({ url, sourceId: "ign", title: "t", ...extra });

describe("items", () => {
  it("insertItemIfNew returns false for a URL equal after normalization", () => {
    expect(db.insertItemIfNew(item("https://ign.com/a"))).toBe(true);
    expect(db.insertItemIfNew(item("https://IGN.com/a/?utm_source=x#c"))).toBe(false);
    expect(db.itemsByStatus("new")).toHaveLength(1);
  });

  it("returns false for a repeated content hash", () => {
    expect(db.insertItemIfNew(item("https://ign.com/a", { contentHash: "h1" }))).toBe(true);
    expect(db.insertItemIfNew(item("https://ign.com/b", { contentHash: "h1" }))).toBe(false);
  });

  it("stores the normalized url and lists items by status", () => {
    db.insertItemIfNew(item("https://IGN.com/a/"));
    const [row] = db.itemsByStatus("new");
    expect(row?.url).toBe("https://ign.com/a");
    expect(db.itemsByStatus("triaged")).toHaveLength(0);
  });

  it("setItemStatus moves an item and saves triage json", () => {
    db.insertItemIfNew(item("https://ign.com/a"));
    const [row] = db.itemsByStatus("new");
    db.setItemStatus(row!.id, "triaged", '{"ok":true}');
    expect(db.itemsByStatus("new")).toHaveLength(0);
    expect(db.itemsByStatus("triaged")[0]?.triage_json).toBe('{"ok":true}');
  });
});

describe("stories", () => {
  const story = (key: string) => ({
    key,
    headline: "h",
    category: "GAMES",
    score: 1,
    bomb: false,
    rumor: false,
    gamesJson: "[]",
    mode: "live" as const,
    storyDate: "2026-08-10",
  });

  it("upsertStory is idempotent on key and attachItem links items", () => {
    const a = db.upsertStory(story("k1"));
    const b = db.upsertStory({ ...story("k1"), score: 9 });
    expect(b).toBe(a);
    expect(db.storiesByStatus("open")).toHaveLength(1);
    expect(db.storiesByStatus("open")[0]?.score).toBe(9);

    db.insertItemIfNew(item("https://ign.com/a"));
    const itemId = db.itemsByStatus("new")[0]!.id;
    db.attachItem(a, itemId);
    db.attachItem(a, itemId); // no throw on duplicates
    expect(db.itemIdsForStory(a)).toEqual([itemId]);
  });
});

describe("spend", () => {
  it("spentToday sums only today's (local) rows of the bucket", () => {
    const now = new Date("2026-08-10T15:00:00Z"); // 12:00 local
    db.recordSpend("live", "write", "m", 1, new Date("2026-08-10T09:00:00Z")); // 06:00 local, today
    db.recordSpend("live", "write", "m", 0.5, new Date("2026-08-11T02:30:00Z")); // 23:30 local, today
    db.recordSpend("live", "write", "m", 7, new Date("2026-08-10T02:30:00Z")); // 23:30 local, yesterday
    db.recordSpend("live", "write", "m", 9, new Date("2026-08-11T03:30:00Z")); // 00:30 local, tomorrow
    db.recordSpend("backfill", "write", "m", 100, new Date("2026-08-10T12:00:00Z"));
    expect(db.spentToday("live", now)).toBeCloseTo(1.5);
    expect(db.spentToday("backfill", now)).toBeCloseTo(100);
  });

  it("spentTotal sums every row of the bucket", () => {
    db.recordSpend("backfill", "write", "m", 2, new Date("2026-06-01T12:00:00Z"));
    db.recordSpend("backfill", "write", "m", 3);
    db.recordSpend("live", "write", "m", 50);
    expect(db.spentTotal("backfill")).toBeCloseTo(5);
    expect(db.spentTotal("live")).toBeCloseTo(50);
  });
});

describe("articles", () => {
  function article(storyKey: string, publishedAt: string, status: "published" | "ready" | "failed") {
    const storyId = db.upsertStory({
      key: storyKey,
      headline: "h",
      category: "GAMES",
      score: 1,
      bomb: false,
      rumor: false,
      gamesJson: "[]",
      mode: "live",
      storyDate: "2026-08-10",
    });
    db.saveArticle({ storyId, publishedAt, payloadJson: "{}", status });
    return storyId;
  }

  it("publishedCountOn counts only published articles of that local day", () => {
    article("a", "2026-08-10T09:00:00Z", "published"); // 06:00 local, Aug 10
    article("b", "2026-08-11T02:59:00Z", "published"); // 23:59 local, Aug 10
    article("c", "2026-08-11T03:01:00Z", "published"); // 00:01 local, Aug 11
    article("d", "2026-08-10T02:59:00Z", "published"); // 23:59 local, Aug 9
    article("e", "2026-08-10T15:00:00Z", "ready"); // not published
    article("f", "2026-08-10T15:00:00Z", "failed"); // not published
    expect(db.publishedCountOn("2026-08-10")).toBe(2);
    expect(db.publishedCountOn("2026-08-11")).toBe(1);
  });

  it("saveArticle upserts per story and markArticle updates status", () => {
    const storyId = article("a", "2026-08-10T09:00:00Z", "ready");
    db.saveArticle({ storyId, publishedAt: "2026-08-10T09:00:00Z", payloadJson: '{"v":2}' });
    expect(db.articleForStory(storyId)?.payload_json).toBe('{"v":2}');
    db.markArticle(storyId, { status: "published", siteId: "site-1", slug: "foo" });
    const row = db.articleForStory(storyId);
    expect(row?.status).toBe("published");
    expect(row?.site_id).toBe("site-1");
    expect(row?.slug).toBe("foo");
  });
});

describe("source health and alerts", () => {
  it("records ok and error for a source", () => {
    db.markSourceOk("ign");
    db.markSourceError("ign", "boom");
    const h = db.sourceHealth("ign");
    expect(h?.last_ok_at).toBeTruthy();
    expect(h?.last_error).toBe("boom");
  });

  it("records alerts", () => {
    db.addAlert("budget", "over budget");
    expect(db.alerts()).toHaveLength(1);
    expect(db.alerts()[0]?.emailed).toBe(0);
  });
});

describe("pipeline helpers", () => {
  it("adds the newer columns to a database created before them", () => {
    const dir = mkdtempSync(join(tmpdir(), "robo-db-old-"));
    const old = new DatabaseSync(join(dir, "robo.db"));
    old.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, source_id TEXT NOT NULL, title TEXT NOT NULL,
        summary TEXT, published_at TEXT, fetched_at TEXT NOT NULL, content_hash TEXT, text TEXT,
        status TEXT NOT NULL DEFAULT 'new', triage_json TEXT);
      CREATE TABLE stories (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, headline TEXT NOT NULL, category TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0, bomb INTEGER NOT NULL DEFAULT 0, rumor INTEGER NOT NULL DEFAULT 0,
        games_json TEXT NOT NULL DEFAULT '[]', first_seen_at TEXT NOT NULL, last_item_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', mode TEXT NOT NULL DEFAULT 'live', story_date TEXT);
      INSERT INTO items (url, source_id, title, fetched_at) VALUES ('https://old.test/a', 'ign', 'old', '2026-10-01T00:00:00Z');
    `);
    old.close();

    const migrated = openDb(dir);
    expect(migrated.itemsByStatus("new")[0]).toMatchObject({ title: "old", publisher: null, text_unavailable: 0 });
    migrated.insertItemIfNew({ url: "https://news.google.com/x", sourceId: "gnews", title: "t", publisher: "Eurogamer", textUnavailable: true });
    expect(migrated.itemsByStatus("new")[1]).toMatchObject({ publisher: "Eurogamer", text_unavailable: 1 });
    const id = migrated.upsertStory({ key: "k", headline: "h", category: "GAMES", score: 1, bomb: false, rumor: false, gamesJson: "[]", mode: "live", parentArticleId: 7 });
    expect(migrated.storyById(id)?.parent_article_id).toBe(7);
    migrated.close();
  });

  it("widens the item status CHECK of an older database for the backfill statuses, keeping rows and links", () => {
    const dir = mkdtempSync(join(tmpdir(), "robo-db-check-"));
    const old = new DatabaseSync(join(dir, "robo.db"));
    old.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE items (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, source_id TEXT NOT NULL, title TEXT NOT NULL,
        summary TEXT, published_at TEXT, fetched_at TEXT NOT NULL, content_hash TEXT, text TEXT,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','dropped','clustered')), triage_json TEXT,
        publisher TEXT, text_unavailable INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX idx_items_status ON items(status);
      CREATE TABLE stories (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, headline TEXT NOT NULL, category TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0, bomb INTEGER NOT NULL DEFAULT 0, rumor INTEGER NOT NULL DEFAULT 0,
        games_json TEXT NOT NULL DEFAULT '[]', first_seen_at TEXT NOT NULL, last_item_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', mode TEXT NOT NULL DEFAULT 'live', story_date TEXT, parent_article_id INTEGER);
      CREATE TABLE story_items (story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE, PRIMARY KEY (story_id, item_id));
      INSERT INTO items (url, source_id, title, fetched_at, status, triage_json, text) VALUES ('https://old.test/a', 'ign', 'old', '2026-10-01T00:00:00Z', 'clustered', '{"x":1}', 'texto');
      INSERT INTO stories (key, headline, category, first_seen_at, last_item_at) VALUES ('k', 'h', 'GAMES', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
      INSERT INTO story_items (story_id, item_id) VALUES (1, 1);
    `);
    expect(() => old.exec("UPDATE items SET status = 'bf_triaged'")).toThrow();
    old.close();

    const migrated = openDb(dir);
    expect(migrated.itemsForStory(1)).toMatchObject([{ id: 1, title: "old", status: "clustered", triage_json: '{"x":1}', text: "texto" }]);
    migrated.insertItemIfNew({ url: "https://new.test/b", sourceId: "ign", title: "b" });
    migrated.setItemStatus(2, "bf_triaged");
    expect(migrated.itemsByStatus("bf_triaged").map((i) => i.id)).toEqual([2]);
    expect(() => migrated.raw.exec("UPDATE items SET status = 'nonsense' WHERE id = 2")).toThrow();
    const indexes = (migrated.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'items'").all() as { name: string }[]).map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(["idx_items_status", "idx_items_hash"]));
    expect((migrated.raw.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(migrated.raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    migrated.close();
    // Opening again does not rebuild anything.
    openDb(dir).close();
  });

  it("lists a story's items, finds stories by key and follow-ups by parent article", () => {
    db.insertItemIfNew(item("https://ign.com/a"));
    db.insertItemIfNew(item("https://ign.com/b"));
    const [a, b] = db.itemsByStatus("new");
    const base = { headline: "h", category: "GAMES", score: 1, bomb: false, rumor: false, gamesJson: "[]", mode: "live" as const };
    const parent = db.upsertStory({ ...base, key: "parent" });
    db.attachItem(parent, b!.id);
    db.attachItem(parent, a!.id);
    db.setItemText(a!.id, "texto");
    expect(db.itemsForStory(parent).map((i) => [i.id, i.text])).toEqual([
      [a!.id, "texto"],
      [b!.id, null],
    ]);
    const article = db.saveArticle({ storyId: parent, payloadJson: "{}", status: "published" });
    const follow = db.upsertStory({ ...base, key: "follow", parentArticleId: article });
    expect(db.storyByKey("follow")?.id).toBe(follow);
    expect(db.followUpsOf(article).map((s) => s.id)).toEqual([follow]);
  });
});
