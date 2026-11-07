import { describe, expect, it, vi } from "vitest";
import { indexNowEnabled, indexNowPayload, INDEXNOW_KEY, submitIndexNow } from "./indexnow";
import { buildNewsSitemap, buildRss, xmlEscape, type FeedArticle } from "./news-feeds";

const BASE = "https://tralked.example";
const NOW = new Date("2026-11-07T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

const article = (over: Partial<FeedArticle> = {}): FeedArticle => ({
  slug: "gta-6-adiado",
  title: 'GTA 6 & "Leonida" <adiado>',
  excerpt: "A Rockstar confirmou a nova data.",
  category: "noticia",
  authorLabel: "Equipe Tralked",
  publishedAt: hoursAgo(3),
  imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg",
  ...over,
});

describe("xmlEscape", () => {
  it("escapes markup and drops characters XML forbids", () => {
    expect(xmlEscape(`a & b <c> "d" 'e'`)).toBe("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;");
    expect(xmlEscape("ok\u0001\u000Bfim")).toBe("okfim");
  });
});

describe("Google News sitemap", () => {
  it("lists only the articles of the last two days, escaped, in the news namespace", () => {
    const xml = buildNewsSitemap(
      [article(), article({ slug: "velha", publishedAt: hoursAgo(49) }), article({ slug: "futura", publishedAt: new Date(NOW.getTime() + 3600_000) })],
      BASE,
      NOW,
    );
    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(xml).toContain("<loc>https://tralked.example/noticias/gta-6-adiado</loc>");
    expect(xml).toContain("<news:name>Tralked</news:name><news:language>pt</news:language>");
    expect(xml).toContain(`<news:publication_date>${hoursAgo(3).toISOString()}</news:publication_date>`);
    expect(xml).toContain("<news:title>GTA 6 &amp; &quot;Leonida&quot; &lt;adiado&gt;</news:title>");
    expect(xml).not.toContain("/noticias/velha");
    expect(xml).not.toContain("/noticias/futura");
  });

  it("is a valid empty urlset when nothing is recent", () => {
    const xml = buildNewsSitemap([article({ publishedAt: hoursAgo(72) })], BASE, NOW);
    expect(xml).not.toContain("<url>");
    expect(xml).toContain("</urlset>");
  });
});

describe("RSS feed", () => {
  it("has the channel, self link and one escaped item per article with its picture", () => {
    const xml = buildRss([article(), article({ slug: "sem-foto", imageUrl: null, excerpt: null })], BASE, "/feed.xml");
    expect(xml).toContain('<atom:link href="https://tralked.example/feed.xml" rel="self" type="application/rss+xml"/>');
    expect(xml).toContain("<language>pt-BR</language>");
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain("<title>GTA 6 &amp; &quot;Leonida&quot; &lt;adiado&gt;</title>");
    expect(xml).toContain('<guid isPermaLink="true">https://tralked.example/noticias/gta-6-adiado</guid>');
    expect(xml).toContain(`<pubDate>${hoursAgo(3).toUTCString()}</pubDate>`);
    // IGDB pictures are asked in the 720p size (wide enough for large previews).
    expect(xml).toContain('<media:content url="https://images.igdb.com/igdb/image/upload/t_720p/abc.jpg" medium="image"/>');
    expect(xml).not.toMatch(/<item>(?:(?!<\/item>).)*sem-foto(?:(?!<\/item>).)*<media:content/);
  });
});

describe("IndexNow", () => {
  it("builds the payload for this host with the public key file", () => {
    expect(indexNowPayload(["/noticias/a", "/noticias/a", "/noticias/b"], BASE)).toEqual({
      host: "tralked.example",
      key: INDEXNOW_KEY,
      keyLocation: `https://tralked.example/${INDEXNOW_KEY}.txt`,
      urlList: ["https://tralked.example/noticias/a", "https://tralked.example/noticias/b"],
    });
  });

  it("only submits from the production site", () => {
    expect(indexNowEnabled("https://tralked.com", { NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(true);
    expect(indexNowEnabled("https://tralked.com", { NODE_ENV: "production" })).toBe(true);
    expect(indexNowEnabled("https://tralked.com", { NODE_ENV: "test" })).toBe(false);
    expect(indexNowEnabled("https://tralked.com", { NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(false);
    expect(indexNowEnabled("http://localhost:3000", { NODE_ENV: "production" })).toBe(false);
    expect(indexNowEnabled("https://tralked.vercel.app", { NODE_ENV: "production" })).toBe(false);
  });

  it("posts the payload and never throws", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
    expect(await submitIndexNow(["/noticias/a"], BASE, fetcher as unknown as typeof fetch)).toBe(202);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(JSON.parse(init.body as string).urlList).toEqual(["https://tralked.example/noticias/a"]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await submitIndexNow(["/noticias/a"], BASE, failing as unknown as typeof fetch)).toBeNull();
    expect(await submitIndexNow([], BASE, fetcher as unknown as typeof fetch)).toBeNull();
    warn.mockRestore();
  });
});
