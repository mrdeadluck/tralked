import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
