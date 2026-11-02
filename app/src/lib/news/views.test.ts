import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { isBotUserAgent, isPrefetchRequest, RecentViews, windowStartDay } from "./views";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("isBotUserAgent", () => {
  it("lets real browsers through", () => {
    expect(isBotUserAgent(CHROME)).toBe(false);
    expect(
      isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"),
    ).toBe(false);
  });

  it("drops crawlers, previewers, headless browsers, HTTP libraries and empty agents", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
      "curl/8.4.0",
      "python-requests/2.32.0",
      "",
      null,
    ]) {
      expect(isBotUserAgent(ua)).toBe(true);
    }
  });
});

describe("isPrefetchRequest", () => {
  it("recognizes the prefetch and prerender markers", () => {
    expect(isPrefetchRequest(new Headers({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetchRequest(new Headers({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetchRequest(new Headers({ "x-moz": "prefetch" }))).toBe(true);
    expect(isPrefetchRequest(new Headers({ "user-agent": CHROME }))).toBe(false);
  });
});

describe("RecentViews", () => {
  it("counts a visitor's view of an article once per window", () => {
    const recent = new RecentViews(1_000);
    expect(recent.take("v1:a", 0)).toBe(true);
    expect(recent.take("v1:a", 999)).toBe(false);
    expect(recent.take("v1:b", 999)).toBe(true);
    expect(recent.take("v2:a", 999)).toBe(true);
    expect(recent.take("v1:a", 1_000)).toBe(true);
  });

  it("stays bounded, forgetting expired and then the oldest entries", () => {
    const recent = new RecentViews(1_000, 10);
    for (let i = 0; i < 11; i++) recent.take(`k${i}`, i);
    expect(recent.size).toBeLessThanOrEqual(10);
    // The newest key is still remembered.
    expect(recent.take("k10", 20)).toBe(false);
  });
});

describe("windowStartDay", () => {
  it("covers today and the 6 days before it, in Sao Paulo time", () => {
    // 2026-11-04 01:00 UTC is still 2026-11-03 in Sao Paulo.
    expect(windowStartDay(new Date("2026-11-04T01:00:00Z"))).toBe("2026-10-28");
    expect(windowStartDay(new Date("2026-11-04T12:00:00Z"))).toBe("2026-10-29");
  });
});

async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("view counter (database)", () => {
  // These statements run outside a transaction (one statement each), so the test cleans up the
  // article it creates.
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.article.deleteMany({ where: { slug: { startsWith: "views-test-" } } });
    await prisma.$disconnect();
  });

  async function newArticle(status = "published") {
    const { prisma } = await import("@/lib/db");
    const author = await prisma.author.findFirstOrThrow();
    return prisma.article.create({
      data: {
        slug: `views-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: "Contador",
        body: "x",
        category: "GAMES",
        imageLabel: "x",
        authorId: author.id,
        status,
        publishedAt: new Date("2020-01-01T00:00:00Z"),
      },
    });
  }

  it("aggregates views per article and day: one bucket row, not one row per view", async () => {
    const { prisma } = await import("@/lib/db");
    const { recordArticleView } = await import("./views");
    const article = await newArticle();
    const day1 = new Date("2026-11-03T15:00:00Z");
    const day2 = new Date("2026-11-04T15:00:00Z");
    for (let i = 0; i < 3; i++) expect(await recordArticleView(article.id, day1)).toBe(true);
    await recordArticleView(article.id, day2);

    expect(await prisma.article.findUniqueOrThrow({ where: { id: article.id } })).toMatchObject({ views: 4 });
    expect(
      await prisma.articleViewDaily.findMany({
        where: { articleId: article.id },
        orderBy: { day: "asc" },
        select: { day: true, count: true },
      }),
    ).toEqual([
      { day: "2026-11-03", count: 3 },
      { day: "2026-11-04", count: 1 },
    ]);
  });

  it("ignores drafts and unknown articles", async () => {
    const { prisma } = await import("@/lib/db");
    const { recordArticleView } = await import("./views");
    const draft = await newArticle("draft");
    expect(await recordArticleView(draft.id)).toBe(false);
    expect(await recordArticleView("does-not-exist")).toBe(false);
    expect(await prisma.articleViewDaily.count({ where: { articleId: draft.id } })).toBe(0);
    expect(await prisma.article.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ views: 0 });
  });

  it("ranks the last 7 days and prunes old buckets", async () => {
    const { prisma } = await import("@/lib/db");
    const { mostViewedArticleIds, pruneViewBuckets, recordArticleView } = await import("./views");
    const hot = await newArticle();
    const old = await newArticle();
    // A far-future week, so other tests' views do not interfere.
    const now = new Date("2031-06-20T15:00:00Z");
    for (let i = 0; i < 5; i++) await recordArticleView(hot.id, now);
    for (let i = 0; i < 9; i++) await recordArticleView(old.id, new Date("2031-06-10T15:00:00Z"));
    await recordArticleView(old.id, new Date("2031-06-14T15:00:00Z"));

    expect(await mostViewedArticleIds(10, now)).toEqual([
      { articleId: hot.id, views: 5 },
      { articleId: old.id, views: 1 },
    ]);

    await pruneViewBuckets(new Date("2031-07-17T15:00:00Z"));
    const left = await prisma.articleViewDaily.findMany({ where: { articleId: { in: [hot.id, old.id] } } });
    expect(left.map((b) => b.day).sort()).toEqual(["2031-06-14", "2031-06-20"]);
    // The lifetime total is untouched by pruning.
    expect(await prisma.article.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ views: 10 });
  });
});
