import { describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { howToJsonLd, newsArticleJsonLd, serializeJsonLd, videoGameJsonLd } from "./json-ld";
import { buildRobots, DISALLOWED_PATHS } from "./robots";
import { buildSitemap, loadSitemapData, STATIC_PATHS } from "./sitemap";

const article = {
  slug: "noticia-x",
  title: "Título </script><script>alert(1)</script>",
  excerpt: "Resumo & mais",
  authorLabel: "Robô Patch Notes",
  bot: true,
  publishedAt: new Date("2026-10-30T12:00:00Z"),
  imageUrl: "javascript:alert(1)",
  heroUrl: "https://cdn.example.com/hero.jpg",
  games: [{ name: "Hades" }],
};

describe("JSON-LD", () => {
  it("never lets content close the script tag or start markup", () => {
    const text = serializeJsonLd(newsArticleJsonLd(article));
    expect(text).not.toMatch(/[<>&]/);
    expect(text).not.toContain(String.fromCharCode(0x2028));
    // Still the same data once parsed.
    expect(JSON.parse(text).headline).toBe(article.title);
    expect(serializeJsonLd({ "@context": "https://schema.org", "@type": "Thing", name: `a${String.fromCharCode(0x2028)}b` })).toContain("\\u2028");
  });

  it("NewsArticle: absolute URLs, only http(s) images, robot credited as an organization", () => {
    const ld = newsArticleJsonLd(article);
    expect(ld).toMatchObject({
      "@type": "NewsArticle",
      url: new URL("/noticias/noticia-x", env.APP_URL).toString(),
      datePublished: "2026-10-30T12:00:00.000Z",
      image: ["https://cdn.example.com/hero.jpg"],
      author: { "@type": "Organization", name: "Robô Patch Notes" },
      about: [{ "@type": "VideoGame", name: "Hades" }],
    });
    const human = newsArticleJsonLd({ ...article, bot: false, authorLabel: "@Arauto_Leopoldo", imageUrl: null, heroUrl: null });
    expect(human.author).toEqual({ "@type": "Person", name: "Arauto_Leopoldo" });
    expect(human.image).toEqual([new URL("/opengraph-image", env.APP_URL).toString()]);
  });

  it("VideoGame for the game page and HowTo for the guide", () => {
    const game = videoGameJsonLd({ slug: "hades", name: "Hades", summary: null, coverUrl: "https://cdn.example.com/c.jpg", platforms: ["PC", "NINTENDO"] });
    expect(game).toMatchObject({ "@type": "VideoGame", name: "Hades", gamePlatform: ["PC", "Nintendo"], image: "https://cdn.example.com/c.jpg" });

    const howTo = howToJsonLd({
      game: { slug: "hades", name: "Hades", summary: "Roguelike" },
      facts: { hoursMin: 20, hoursMax: 60 },
      overview: ["Platinar Hades exige paciência."],
      steps: [
        { order: 1, title: "Primeira fuga", body: "Escape do Tártaro." },
        { order: 2, title: "Heat 16", body: "" },
      ],
    });
    expect(howTo).toMatchObject({
      "@type": "HowTo",
      totalTime: "PT60H",
      description: "Platinar Hades exige paciência.",
      step: [
        { "@type": "HowToStep", position: 1, name: "Primeira fuga", text: "Escape do Tártaro." },
        { "@type": "HowToStep", position: 2, name: "Heat 16", text: "Heat 16" },
      ],
    });
  });
});

describe("sitemap and robots", () => {
  it("builds absolute entries for static pages, articles, games, guides and threads", () => {
    const at = new Date("2026-10-01T00:00:00Z");
    const entries = buildSitemap(
      {
        games: [{ slug: "hades", updatedAt: at }],
        guides: [{ slug: "hades", updatedAt: at }],
        articles: [{ slug: "noticia-x", updatedAt: at }],
        threads: [{ id: "t1", lastPostAt: at }],
      },
      "https://tralked.example",
    );
    const urls = entries.map((e) => e.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://tralked.example/",
        "https://tralked.example/privacidade",
        "https://tralked.example/noticias/noticia-x",
        "https://tralked.example/jogos/hades",
        "https://tralked.example/jogos/hades/guia",
        "https://tralked.example/forum/t/t1",
      ]),
    );
    expect(urls).toHaveLength(STATIC_PATHS.length + 4);
    expect(urls.some((u) => /\/(admin|conta|api)\b/.test(u))).toBe(false);
  });

  it("loads only public content from the database", async () => {
    const data = await loadSitemapData();
    expect(data.guides.map((g) => g.slug)).toContain("hollow-knight");
    expect(data.articles.length).toBeGreaterThan(0);
    const { prisma } = await import("@/lib/db");
    const unpublished = await prisma.article.findMany({ where: { status: { not: "published" } }, select: { slug: true } });
    const hidden = await prisma.forumThread.findMany({ where: { status: { in: ["hidden", "removed"] } }, select: { id: true } });
    const listed = new Set(data.articles.map((a) => a.slug));
    for (const { slug } of unpublished) expect(listed.has(slug), slug).toBe(false);
    for (const thread of hidden) expect(data.threads.map((t) => t.id)).not.toContain(thread.id);
    expect(data.articles.length).toBe(await prisma.article.count({ where: { status: "published" } }));
  });

  it("robots disallows the private areas and points to the sitemap", () => {
    const robots = buildRobots("https://tralked.example");
    expect(robots.rules).toEqual({ userAgent: "*", allow: "/", disallow: DISALLOWED_PATHS });
    expect(DISALLOWED_PATHS).toEqual(expect.arrayContaining(["/admin", "/conta", "/api"]));
    expect(robots.sitemap).toBe("https://tralked.example/sitemap.xml");
  });
});
