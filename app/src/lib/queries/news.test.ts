import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { ArticleCategory } from "./news";

// Needs Postgres up and seeded (`pnpm db:up && pnpm db:migrate && pnpm db:seed`);
// skipped when the database is not reachable.
async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
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

describe.skipIf(!reachable)("news queries (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("getHomeNews returns the main highlight, up to 4 side highlights of the week and the latest list", async () => {
    const { getHomeNews } = await import("./news");
    const { hero, side, latest } = await getHomeNews();
    expect(hero?.featured).toBe(2);
    // Side highlights: the week's articles with most engagement first, then the most recent.
    expect(side.length).toBeLessThanOrEqual(4);
    expect(side.some((a) => a.id === hero?.id)).toBe(false);
    const weekAgo = Date.now() - 7 * 86_400_000;
    expect(side.every((a) => a.publishedAt.getTime() >= weekAgo)).toBe(true);
    expect(latest.length).toBeGreaterThan(0);
    expect(latest.every((a) => a.featured === 0)).toBe(true);
    const times = latest.map((a) => a.publishedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("getHomeNews falls back to the newest article when no main highlight is published", async () => {
    const { prisma } = await import("@/lib/db");
    const { getHomeNews } = await import("./news");
    const mains = await prisma.article.findMany({ where: { featured: 2 }, select: { id: true } });
    await prisma.article.updateMany({ where: { featured: 2 }, data: { featured: 0 } });
    try {
      const { hero, latest } = await getHomeNews();
      expect(hero).not.toBeNull();
      expect(latest.some((a) => a.id === hero?.id)).toBe(false);
    } finally {
      await prisma.article.updateMany({ where: { id: { in: mains.map((m) => m.id) } }, data: { featured: 2 } });
    }
  });

  it("getArticle returns the article with author, or null for an unknown slug", async () => {
    const { getArticle } = await import("./news");
    const article = await getArticle("25-conquistas-mais-raras-da-steam-em-2026");
    expect(article?.authorHandle).toBe("Cronista_Iolanda");
    expect(article?.body.length).toBeGreaterThan(0);
    expect(await getArticle("nao-existe")).toBeNull();
  });

  it("getArticle exposes the related game and whether it has a published guide", async () => {
    const { prisma } = await import("@/lib/db");
    const { getArticle } = await import("./news");
    const withGame = await prisma.article.findFirstOrThrow({ where: { gameId: { not: null } } });
    const article = await getArticle(withGame.slug);
    expect(article?.game?.slug).toBeTruthy();
    expect(typeof article?.game?.hasGuide).toBe("boolean");
  });

  it("getNewsIndex paginates published articles newest first", async () => {
    const { prisma } = await import("@/lib/db");
    const { getNewsIndex } = await import("./news");
    const total = await prisma.article.count({ where: { status: "published" } });
    const p1 = await getNewsIndex({ category: null, page: 1, pageSize: 4 });
    const p2 = await getNewsIndex({ category: null, page: 2, pageSize: 4 });
    expect(p1.total).toBe(total);
    expect(p1.pageCount).toBe(Math.ceil(total / 4));
    expect(p1.articles).toHaveLength(4);
    expect(p2.page).toBe(2);
    expect(p1.articles.at(-1)!.publishedAt.getTime()).toBeGreaterThanOrEqual(p2.articles[0].publishedAt.getTime());
    expect(new Set([...p1.articles, ...p2.articles].map((a) => a.slug)).size).toBe(8);
    // Out of range and invalid pages clamp.
    expect((await getNewsIndex({ category: null, page: 99, pageSize: 4 })).page).toBe(p1.pageCount);
    expect((await getNewsIndex({ category: null, page: Number.NaN, pageSize: 4 })).page).toBe(1);
  });

  it("getNewsIndex filters by category and hides drafts", async () => {
    const { prisma } = await import("@/lib/db");
    const { getNewsIndex } = await import("./news");
    const guides = await getNewsIndex({ category: "GUIAS", page: 1, pageSize: 50 });
    expect(guides.total).toBe(await prisma.article.count({ where: { status: "published", category: "GUIAS" } }));
    expect(guides.articles.length).toBeGreaterThan(0);
    expect(guides.articles.every((a) => a.category === "GUIAS")).toBe(true);

    const author = await prisma.author.findFirstOrThrow();
    const draft = await prisma.article.create({
      data: { slug: "test-news-draft", title: "Rascunho", body: "x", category: "GUIAS", imageLabel: "x", authorId: author.id },
    });
    try {
      const after = await getNewsIndex({ category: "GUIAS", page: 1, pageSize: 50 });
      expect(after.total).toBe(guides.total);
      expect(after.articles.some((a) => a.slug === draft.slug)).toBe(false);
    } finally {
      await prisma.article.delete({ where: { id: draft.id } });
    }
  });

  it("getArticle returns validated blocks, related games and their external headlines", async () => {
    const { getArticle } = await import("./news");
    const article = await getArticle("hollow-knight-guia-100-por-cento-em-7-etapas");
    expect(article?.blocks.length).toBeGreaterThan(0);
    expect(article?.blocks.every((b) => typeof b.type === "string")).toBe(true);
    expect(article?.games.map((g) => g.slug)).toContain("hollow-knight");
    expect(article?.externalNews.length).toBeGreaterThan(0);
    expect(article?.externalNews.every((n) => n.game?.slug === "hollow-knight")).toBe(true);
    expect(article?.excerpt).toBeTruthy();
  });

  it("falls back to the body for the excerpt when blocks are empty, and resolves achievement blocks", async () => {
    const { prisma } = await import("@/lib/db");
    const { getArticle } = await import("./news");
    const author = await prisma.author.findFirstOrThrow();
    const game = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
    const ach = await prisma.achievement.findFirstOrThrow({ where: { gameId: game.id, platform: "steam" } });
    const legacy = await prisma.article.create({
      data: {
        slug: "test-news-legacy",
        title: "Legado",
        body: "## Título\n\nPrimeiro **parágrafo** do corpo.",
        status: "published",
        category: "GAMES",
        imageLabel: "x",
        authorId: author.id,
      },
    });
    const withBlocks = await prisma.article.create({
      data: {
        slug: "test-news-blocks",
        title: "Blocos",
        body: "",
        blocks: [{ type: "achievement", apiName: ach.apiName }],
        status: "published",
        category: "GAMES",
        imageLabel: "x",
        authorId: author.id,
        games: { create: { gameId: game.id } },
      },
    });
    try {
      const a = await getArticle(legacy.slug);
      expect(a?.blocks).toEqual([]);
      expect(a?.excerpt).toBe("Primeiro parágrafo do corpo.");
      const b = await getArticle(withBlocks.slug);
      expect(b?.achievements[`steam:${ach.apiName}`]?.name).toBe(ach.name);
      expect(b?.achievements[`steam:${ach.apiName}`]?.gameName).toBe(game.name);
    } finally {
      await prisma.article.deleteMany({ where: { id: { in: [legacy.id, withBlocks.id] } } });
    }
  });

  it("drops external headlines whose URL is not absolute http(s)", async () => {
    const { prisma } = await import("@/lib/db");
    const { getArticle, getExternalHeadlines } = await import("./news");
    const game = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
    const future = new Date(Date.now() + 86_400_000); // newest, so they would be first if not filtered
    const bad = ["javascript:alert(document.cookie)", "data:text/html,<script>alert(1)</script>", "//evil.example.com/x", " javascript:alert(1)"];
    await prisma.externalNews.createMany({
      data: bad.map((url, i) => ({ gameId: game.id, title: `test-unsafe-${i}`, url, source: "Feed hostil", publishedAt: future })),
    });
    try {
      const all = await getExternalHeadlines(50);
      expect(all.length).toBeGreaterThan(0);
      expect(all.some((n) => n.title.startsWith("test-unsafe-"))).toBe(false);
      expect(all.every((n) => /^https?:\/\//.test(n.url))).toBe(true);
      const forGame = await getExternalHeadlines(50, ["hollow-knight"]);
      expect(forGame.some((n) => n.title.startsWith("test-unsafe-"))).toBe(false);
      const article = await getArticle("hollow-knight-guia-100-por-cento-em-7-etapas");
      expect(article?.externalNews.some((n) => n.title.startsWith("test-unsafe-"))).toBe(false);
    } finally {
      await prisma.externalNews.deleteMany({ where: { title: { startsWith: "test-unsafe-" } } });
    }
  });

  it("getTopPlayers returns public profiles ordered by total XP", async () => {
    const { getTopPlayers } = await import("./news");
    const players = await getTopPlayers(5);
    expect(players).toHaveLength(5);
    const xp = players.map((p) => p.totalXp);
    expect(xp).toEqual([...xp].sort((a, b) => b - a));
    expect(players[0]).toEqual(
      expect.objectContaining({ handle: expect.any(String), level: expect.any(Number) }),
    );
    expect(players[0].handle.startsWith("@")).toBe(false);
  });

  it("getTodayMission returns the user's daily mission for today, or null", async () => {
    const { prisma } = await import("@/lib/db");
    const { getTodayMission } = await import("./news");
    const { toLocalDay } = await import("@/lib/engine/streak");
    const now = new Date();
    const user = await prisma.user.create({
      data: { steamId: "test-news-mission", handle: "test-news-mission", displayName: "Test" },
    });
    try {
      expect(await getTodayMission(user.id, now)).toBeNull();
      await prisma.mission.createMany({
        data: [
          { userId: user.id, kind: "weekly", periodKey: toLocalDay(now), title: "W", condition: { minCount: 9 }, rewardXp: 1 },
          { userId: user.id, kind: "daily", periodKey: "2000-01-01", title: "Old", condition: { minCount: 9 }, rewardXp: 1 },
          { userId: user.id, kind: "daily", periodKey: toLocalDay(now), title: "Hoje", condition: { minCount: 3 }, rewardXp: 12000, progress: 1 },
        ],
      });
      expect(await getTodayMission(user.id, now)).toEqual({
        title: "Hoje",
        progress: 1,
        goal: 3,
        rewardXp: 12000,
      });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

describe("wire and tab view models", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const card = (slug: string, category: ArticleCategory, hoursAgo: number) => ({
    id: slug,
    slug,
    title: `Título ${slug}`,
    subtitle: null,
    excerpt: null,
    category,
    platforms: [],
    imageLabel: slug,
    imageUrl: null,
    authorHandle: "Arauto_Leopoldo",
    authorLabel: "@Arauto_Leopoldo",
    bot: false,
    featured: 0,
    likes: 0,
    comments: 0,
    views: 0,
    humanAuthored: true,
    publishedAt: new Date(now.getTime() - hoursAgo * 3_600_000),
    game: category === "GUIAS" ? { slug: "hollow-knight", name: "Hollow Knight" } : null,
  });

  it("merges articles and external headlines by date and labels the external source", async () => {
    const { buildWireItems } = await import("./news");
    const items = buildWireItems(
      [card("a", "GAMES", 1), card("b", "GAMES", 5)],
      [
        {
          id: "x1",
          title: "Fora",
          url: "https://example.com/n",
          source: "Portal Exemplo",
          publishedAt: new Date(now.getTime() - 3 * 3_600_000),
          game: null,
        },
      ],
      now,
    );
    expect(items.map((i) => i.id)).toEqual(["a:a", "x:x1", "a:b"]);
    expect(items[1]).toMatchObject({
      external: true,
      href: "https://example.com/n",
      source: "Fonte externa: Portal Exemplo",
    });
    expect(items[0]).toMatchObject({ href: "/noticias/a", source: "Redação Tralked", when: "há 1 hora" });
    expect(items.every((i) => Number.isInteger(i.seed))).toBe(true);
  });

  it("never puts an unsafe external URL on the wire", async () => {
    const { buildWireItems } = await import("./news");
    const headline = (id: string, url: string) => ({
      id,
      title: id,
      url,
      source: "Feed",
      publishedAt: new Date(now.getTime() - 3_600_000),
      game: null,
    });
    const items = buildWireItems(
      [],
      [
        headline("js", "javascript:alert(1)"),
        headline("data", "data:text/html,<b>x</b>"),
        headline("proto", "//evil.example.com"),
        headline("ok", "https://example.com/ok"),
      ],
      now,
    );
    expect(items.map((i) => i.id)).toEqual(["x:ok"]);
  });

  it("adds the 'Guias da semana' block card when there are two guides", async () => {
    const { buildWireItems } = await import("./news");
    const items = buildWireItems([card("g1", "GUIAS", 1), card("g2", "GUIAS", 2), card("c", "GAMES", 3)], [], now);
    expect(items[1]).toMatchObject({ variant: "block", href: "/noticias?categoria=guias#todas" });
    expect(items[1].items).toEqual([
      { label: "Hollow Knight", date: expect.stringMatching(/^\d{2} \S+$/) },
      { label: "Hollow Knight", date: expect.any(String) },
    ]);
  });

  it("builds Últimas + one tab per category linking to the filtered index", async () => {
    const { buildNewsTabs } = await import("./news");
    const tabs = buildNewsTabs([card("g1", "GUIAS", 1), card("c", "COMUNIDADE", 2)], now);
    expect(tabs.map((t) => [t.id, t.stories.length, t.moreHref])).toEqual([
      ["ultimas", 2, "/noticias#todas"],
      ["games", 0, "/noticias?categoria=games#todas"],
      ["guias", 1, "/noticias?categoria=guias#todas"],
      ["comunidade", 1, "/noticias?categoria=comunidade#todas"],
      ["mercado", 0, "/noticias?categoria=mercado#todas"],
      ["entretenimento", 0, "/noticias?categoria=entretenimento#todas"],
      ["tecnologia", 0, "/noticias?categoria=tecnologia#todas"],
    ]);
  });

  it("maps the new category slugs and labels", async () => {
    const { categoryFromSlug, categoryLabel } = await import("./news");
    expect(categoryFromSlug("mercado")).toBe("MERCADO");
    expect(categoryFromSlug("entretenimento")).toBe("ENTRETENIMENTO");
    expect(categoryFromSlug("tecnologia")).toBe("TECNOLOGIA");
    expect(categoryLabel("MERCADO")).toBe("Mercado");
    expect(categoryLabel("ENTRETENIMENTO")).toBe("Entretenimento");
    expect(categoryLabel("TECNOLOGIA")).toBe("Tecnologia");
  });

  it("signs robots as 'Equipe Tralked' (no '@'), on tabs and on the wire", async () => {
    const { BOT_BYLINE, articleStory, authorLabel, buildWireItems } = await import("./news");
    expect(BOT_BYLINE).toBe("Equipe Tralked");
    expect(authorLabel("bot", "Robô Notícias")).toBe("Equipe Tralked");
    expect(authorLabel("editorial", "mrdead")).toBe("@mrdead");
    expect(authorLabel(null, "Arauto_Leopoldo")).toBe("@Arauto_Leopoldo");

    const bot = { ...card("r", "GAMES", 1), authorHandle: "Robô Patch Notes", authorLabel: authorLabel("bot", "Robô Patch Notes"), bot: true, humanAuthored: false };
    expect(bot.authorLabel).toBe("Equipe Tralked");
    expect(bot.humanAuthored).toBe(false);
    expect(articleStory(bot, now).source).toBe("Equipe Tralked");
    expect(articleStory(card("h", "GAMES", 1), now).source).toBe("@Arauto_Leopoldo");
    const [wireBot, wireHuman] = buildWireItems([bot, card("h", "GAMES", 2)], [], now);
    expect(wireBot.source).toBe("Equipe Tralked");
    expect(wireHuman.source).toBe("Redação Tralked");
  });
});
