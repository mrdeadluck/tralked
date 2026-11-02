import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { ArticleCard, ArticleCategory, ExternalHeadline } from "./news";

// Plan 4 F7 (press headlines per area) and F12 (article -> game page). Needs the seeded test
// database; skipped when it is not reachable.
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
const now = new Date("2026-10-31T12:00:00Z");

const card = (slug: string, category: ArticleCategory, hoursAgo: number): ArticleCard => ({
  id: slug,
  slug,
  title: `Matéria ${slug}`,
  subtitle: null,
  excerpt: null,
  category,
  platforms: [],
  imageLabel: "",
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
  game: null,
});

const headline = (id: string, url: string, hoursAgo: number, game: ExternalHeadline["game"] = null): ExternalHeadline => ({
  id,
  title: `Manchete ${id}`,
  url,
  source: "Bit Exemplo",
  publishedAt: new Date(now.getTime() - hoursAgo * 3_600_000),
  game,
});

describe("withPressHeadlines", () => {
  it("adds each area's headlines after the newsroom's stories, marked as external", async () => {
    const { buildNewsTabs, withPressHeadlines } = await import("./news");
    const tabs = buildNewsTabs([card("tec-1", "TECNOLOGIA", 5), card("games-1", "GAMES", 1)], now);
    const out = withPressHeadlines(
      tabs,
      {
        TECNOLOGIA: [
          headline("t1", "https://example.com/t1", 1, { slug: "elden-ring", name: "Elden Ring" }),
          headline("bad", "javascript:alert(1)", 2),
        ],
        ENTRETENIMENTO: [headline("e1", "https://example.org/e1", 3)],
      },
      now,
    );

    const tec = out.find((t) => t.id === "tecnologia")!;
    expect(tec.stories.map((s) => s.id)).toEqual(["tec-1", "x:t1"]);
    expect(tec.stories[1]).toMatchObject({
      href: "https://example.com/t1",
      external: true,
      kicker: "Imprensa · Elden Ring",
      source: "Fonte externa: Bit Exemplo",
      when: "há 1 hora",
    });
    const ent = out.find((t) => t.id === "entretenimento")!;
    expect(ent.stories).toEqual([expect.objectContaining({ id: "x:e1", external: true, kicker: "Imprensa" })]);
    // The other tabs ("Últimas", Games, ...) stay editorial only.
    for (const id of ["ultimas", "games", "guias", "comunidade", "mercado"]) {
      expect(out.find((t) => t.id === id)!.stories.every((s) => !s.external)).toBe(true);
    }
  });

  it("isPressArea only accepts Entretenimento and Tecnologia", async () => {
    const { isPressArea } = await import("./news");
    expect(isPressArea("ENTRETENIMENTO")).toBe(true);
    expect(isPressArea("TECNOLOGIA")).toBe(true);
    expect(isPressArea("GAMES")).toBe(false);
    expect(isPressArea("MERCADO")).toBe(false);
    expect(isPressArea(null)).toBe(false);
  });
});

describe.skipIf(!reachable)("press headlines and article games (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("getAreaHeadlines returns only that area's headlines, newest first", async () => {
    const { getAreaHeadlines, getPressHeadlines } = await import("./news");
    const tec = await getAreaHeadlines("TECNOLOGIA", 10);
    expect(tec.map((h) => h.title)).toEqual([
      "Nova geração de placas de vídeo promete ray tracing mais barato (exemplo)",
      "IA nos estúdios: como equipes de games usam a ferramenta nos bastidores (exemplo)",
      "Portátil para PC roda Elden Ring a 60 fps nos testes (exemplo)",
    ]);
    expect(tec[2].game).toEqual({ slug: "elden-ring", name: "Elden Ring" });

    const press = await getPressHeadlines(2);
    expect(press.ENTRETENIMENTO.map((h) => h.source)).toEqual(["Tela Fictícia", "Tela Fictícia"]);
    expect(press.TECNOLOGIA).toHaveLength(2);
    // GAMES headlines (Hollow Knight) are not press-area items.
    expect([...press.ENTRETENIMENTO, ...press.TECNOLOGIA].some((h) => h.game?.slug === "hollow-knight")).toBe(false);
  });

  it("getAreaHeadlines links only https items", async () => {
    const { prisma } = await import("@/lib/db");
    const { getAreaHeadlines } = await import("./news");
    const url = "http://example.com/bit/press-http-only-test";
    await prisma.externalNews.deleteMany({ where: { url } });
    try {
      await prisma.externalNews.create({
        data: { url, title: "Manchete http", source: "Bit Exemplo", area: "TECNOLOGIA", publishedAt: new Date() },
      });
      const tec = await getAreaHeadlines("TECNOLOGIA", 10);
      expect(tec.length).toBeGreaterThan(0);
      expect(tec.every((h) => h.url.startsWith("https://"))).toBe(true);
    } finally {
      await prisma.externalNews.deleteMany({ where: { url } });
    }
  });

  it("getWireHeadlines keeps the wire about games with art: Games feeds plus game-linked press items", async () => {
    const { prisma } = await import("@/lib/db");
    const { getWireHeadlines } = await import("./news");
    const slugs = ["hollow-knight", "hades", "elden-ring"];
    const games = await prisma.game.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, heroUrl: true } });
    try {
      // Without art, no press headline makes the wire (no generated art for someone else's story).
      await prisma.game.updateMany({ where: { slug: { in: slugs } }, data: { heroUrl: null } });
      const bare = await getWireHeadlines(50);
      expect(bare.some((h) => slugs.includes(h.game?.slug ?? ""))).toBe(false);

      for (const g of games) {
        await prisma.game.update({ where: { id: g.id }, data: { heroUrl: `https://cdn.example.com/${g.slug}-hero.jpg` } });
      }
      const wire = await getWireHeadlines(50);
      const titles = wire.map((h) => h.title);
      expect(wire.every((h) => h.imageUrl)).toBe(true);
      // Games feed headlines (Hollow Knight) are on the wire.
      expect(wire.filter((h) => h.game?.slug === "hollow-knight")).toHaveLength(6);
      // Press items linked to a catalog game are too...
      expect(titles).toContain("Série animada do jogo Hades ganha primeiro teaser (exemplo)");
      expect(titles).toContain("Portátil para PC roda Elden Ring a 60 fps nos testes (exemplo)");
      // ...but general tech/entertainment news is not.
      expect(titles).not.toContain("Nova geração de placas de vídeo promete ray tracing mais barato (exemplo)");
      expect(titles).not.toContain("IA nos estúdios: como equipes de games usam a ferramenta nos bastidores (exemplo)");
      expect(titles).not.toContain("Anime baseado em jogo de luta estreia em janeiro (exemplo)");
    } finally {
      for (const g of games) await prisma.game.update({ where: { id: g.id }, data: { heroUrl: g.heroUrl } });
    }
  });

  it("getArticle gives each related game its catalog cover (media cover first) or null", async () => {
    const { prisma } = await import("@/lib/db");
    const { getArticle } = await import("./news");
    const slug = "hollow-knight-guia-100-por-cento-em-7-etapas";

    const before = await getArticle(slug);
    expect(before?.games).toEqual([
      expect.objectContaining({ slug: "hollow-knight", name: "Hollow Knight", hasGuide: true, coverUrl: null }),
    ]);
    // What there is to hunt, for the article's game card.
    expect(before?.games[0].achievementCount).toBeGreaterThan(0);
    expect(before?.games[0].platforms).toContain("PC");

    const game = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" }, select: { id: true, coverUrl: true } });
    try {
      await prisma.game.update({ where: { id: game.id }, data: { coverUrl: "https://cdn.example.com/hk-cover.jpg" } });
      expect((await getArticle(slug))?.games[0].coverUrl).toBe("https://cdn.example.com/hk-cover.jpg");
      await prisma.game.update({ where: { id: game.id }, data: { coverUrl: "javascript:alert(1)" } });
      expect((await getArticle(slug))?.games[0].coverUrl).toBeNull();
    } finally {
      await prisma.game.update({ where: { id: game.id }, data: { coverUrl: game.coverUrl } });
    }
  });
});
