import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/collect/rss.js";
import { parseSitemap } from "../src/collect/sitemap.js";
import { parseListing } from "../src/collect/listing.js";
import { extractText } from "../src/collect/extract.js";
import { collectBackfill, collectLive, type FetchFn } from "../src/collect/index.js";
import type { Source } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

describe("parseFeed", () => {
  it("parses RSS 2.0 titles, urls, dates and strips HTML from the summary", () => {
    const items = parseFeed(fx("rss2.xml"), "src1");
    // the item without a <link> is skipped
    expect(items.map((i) => i.title)).toEqual([
      "Hollow Knight: Silksong gets a release date",
      "Studio & Co. announces layoffs",
      "Very long summary",
      "Undated item",
    ]);
    const first = items[0]!;
    expect(first.url).toBe("https://example.com/news/silksong-release-date");
    expect(first.sourceId).toBe("src1");
    expect(first.publishedAt?.toISOString()).toBe("2026-10-30T14:30:00.000Z");
    expect(first.summary).toBe("Team Cherry has finally confirmed the date. Read & enjoy more.");
    expect(first.summary).not.toMatch(/[<>]/);
  });

  it("prefers description over content:encoded and decodes entities in escaped HTML", () => {
    const second = parseFeed(fx("rss2.xml"), "s")[1]!;
    expect(second.summary).toBe("Plain escaped text with an entity: café.");
    expect(second.publishedAt?.toISOString()).toBe("2026-10-29T09:00:00.000Z");
  });

  it("truncates the summary to 500 chars", () => {
    const third = parseFeed(fx("rss2.xml"), "s")[2]!;
    expect(third.summary).toHaveLength(500);
  });

  it("returns null summary and date when the feed has none", () => {
    const last = parseFeed(fx("rss2.xml"), "s")[3]!;
    expect(last.summary).toBeNull();
    expect(last.publishedAt).toBeNull();
  });

  it("parses Atom: alternate link, published/updated dates, media:description", () => {
    const items = parseFeed(fx("atom.xml"), "verge");
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      url: "https://www.theverge.com/games/1/switch-2-bundle",
      title: "Nintendo Switch 2 & the new bundle",
      summary: "Nintendo is bundling the console.",
    });
    expect(items[0]!.publishedAt?.toISOString()).toBe("2026-10-30T16:15:00.000Z");
    // YouTube style entry
    expect(items[1]!.url).toBe("https://www.youtube.com/watch?v=abc123");
    expect(items[1]!.summary).toBe("Watch the new trailer. Out next year.");
    // updated-only entry, link without rel
    expect(items[2]!.url).toBe("https://www.theverge.com/games/3/updated-only");
    expect(items[2]!.publishedAt?.toISOString()).toBe("2026-10-28T09:00:00.000Z");
    expect(items[2]!.summary).toBe("Short summary.");
  });

  it("captures the <source> publisher, strips it from the title and drops a title-only snippet", () => {
    const items = parseFeed(fx("gnews.xml"), "gn");
    expect(items[0]).toMatchObject({
      title: "Switch 2 performance analysed",
      publisher: "Digital Foundry",
      summary: null,
    });
  });

  it("throws on content that is not a feed", () => {
    expect(() => parseFeed(fx("not-xml.html"), "x")).toThrow(/not a feed/i);
    expect(() => parseFeed("", "x")).toThrow();
  });
});

describe("parseSitemap", () => {
  const from = new Date("2026-10-01T00:00:00Z");
  const to = new Date("2026-10-31T23:59:59Z");

  it("returns index children, dropping those whose lastmod is before `from`", () => {
    const r = parseSitemap(fx("sitemap-index.xml"), "s", from, to);
    expect(r.items).toEqual([]);
    expect(r.children).toEqual(["https://example.com/sitemap-2026-10.xml", "https://example.com/sitemap-misc.xml"]);
  });

  it("keeps only urlset entries inside [from, to], using news:publication_date over lastmod", () => {
    const r = parseSitemap(fx("news-sitemap.xml"), "s", from, to);
    expect(r.children).toEqual([]);
    expect(r.items.map((i) => i.url)).toEqual([
      "https://example.com/news/in-window-with-title",
      "https://example.com/2026/10/the-last-of-us-part-3_confirmed/",
    ]);
    expect(r.items[0]).toMatchObject({ title: "Elden Ring DLC & the future", sourceId: "s", summary: null });
    expect(r.items[0]!.publishedAt?.toISOString()).toBe("2026-10-20T15:00:00.000Z");
  });

  it("derives a de-slugified title from the last URL segment when there is no news:title", () => {
    const r = parseSitemap(fx("news-sitemap.xml"), "s", from, to);
    expect(r.items[1]!.title).toBe("The last of us part 3 confirmed");
    expect(r.items[1]!.publishedAt?.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("throws on content that is not a sitemap", () => {
    expect(() => parseSitemap(fx("not-xml.html"), "s", from, to)).toThrow(/not a sitemap/i);
  });
});

describe("parseListing", () => {
  const base = "https://example.com/news/";
  const items = parseListing(fx("listing.html"), base, "a.item", "lst");

  it("resolves relative links to absolute URLs and cleans titles", () => {
    const first = items.find((i) => i.url.includes("launch-of-the-year"))!;
    expect(first.url.startsWith("https://example.com/news/2026/launch-of-the-year")).toBe(true);
    expect(first.title).toBe("Launch of the year");
    expect(first.sourceId).toBe("lst");
    expect(first.summary).toBeNull();
    expect(first.publishedAt).toBeNull();
  });

  it("keeps only article-like URLs: same host, deeper than one segment, no section pages", () => {
    const paths = items.map((i) => new URL(i.url).pathname);
    expect(paths).toEqual([
      "/news/2026/launch-of-the-year/",
      "/news/another-story",
      "/news/www-variant-story",
      "/news/no-text-story",
    ]);
  });

  it("dedupes repeated links, drops fragments, and falls back to img alt for the title", () => {
    expect(items.some((i) => i.url.includes("#"))).toBe(false);
    expect(items.find((i) => i.url.endsWith("no-text-story"))!.title).toBe("Alt text title");
    expect(items.filter((i) => i.url.includes("launch-of-the-year"))).toHaveLength(1);
  });

  it("returns [] when the selector matches nothing", () => {
    expect(parseListing(fx("listing.html"), base, "a.nope", "x")).toEqual([]);
  });
});

describe("extractText", () => {
  it("returns the article body without menu, sidebar and footer text, plus published_time", () => {
    const r = extractText(fx("article.html"), "https://example.com/news/silksong")!;
    expect(r).not.toBeNull();
    expect(r.title).toBe("Silksong gets a date");
    expect(r.text).toContain("Pharloom");
    expect(r.text).toContain("Team Cherry has confirmed");
    expect(r.text).not.toContain("MENUITEM");
    expect(r.text).not.toContain("SIDEBARTRENDING");
    expect(r.text).not.toContain("FOOTERCOPYRIGHT");
    expect(r.publishedAt?.toISOString()).toBe("2026-10-30T14:30:00.000Z");
  });

  it("falls back to JSON-LD datePublished (also inside @graph)", () => {
    const r = extractText(fx("article-jsonld.html"), "https://example.com/x")!;
    expect(r.publishedAt?.toISOString()).toBe("2026-09-15T11:00:00.000Z");
  });

  it("caps the text at 20,000 chars", () => {
    const para = `<p>${"Long sentence, with commas, and many words to look like content. ".repeat(40)}</p>`;
    const html = `<html><body><article><h1>Big</h1>${para.repeat(30)}</article></body></html>`;
    const r = extractText(html, "https://example.com/big")!;
    expect(r.text.length).toBeLessThanOrEqual(20_000);
    expect(r.text.length).toBeGreaterThan(15_000);
  });

  it("returns null when nothing readable is found", () => {
    expect(extractText("<html><body></body></html>", "https://example.com/e")).toBeNull();
    expect(extractText("", "https://example.com/e")).toBeNull();
  });
});

// ---------- collectLive / collectBackfill ----------

function source(over: Partial<Source> & { id: string }): Source {
  return {
    name: over.id,
    kind: "rss",
    url: `https://${over.id}.test/feed`,
    tier: "portal",
    category: "GAMES",
    gamingFilter: false,
    active: true,
    ...over,
  };
}

type Handler = string | Response | ((url: string, init?: RequestInit) => Response | Promise<Response>);

function respond(body: string, opts: { status?: number; url?: string } = {}): Response {
  const r = new Response(body, { status: opts.status ?? 200 });
  if (opts.url) Object.defineProperty(r, "url", { value: opts.url });
  return r;
}

function mockFetch(routes: Record<string, Handler>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchFn = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const h = routes[url];
    if (h === undefined) return respond("not found", { status: 404 });
    if (typeof h === "string") return respond(h);
    if (typeof h === "function") return h(url, init);
    return h;
  };
  return { fn, calls };
}

const fast = { timeoutMs: 40 } as const;

describe("collectLive", () => {
  it("collects from healthy sources and reports a not-xml source and a timeout as failures", async () => {
    const { fn } = mockFetch({
      "https://good.test/feed": fx("rss2.xml"),
      "https://html.test/feed": fx("not-xml.html"),
      "https://slow.test/feed": () => new Promise<Response>(() => {}),
      "https://err.test/feed": respond("boom", { status: 500 }),
    });
    const r = await collectLive(
      [source({ id: "good" }), source({ id: "html" }), source({ id: "slow" }), source({ id: "err" })],
      fn,
      new Date("2026-10-31T12:00:00Z"),
      fast,
    );
    expect(r.items.length).toBe(4);
    expect(new Set(r.items.map((i) => i.sourceId))).toEqual(new Set(["good"]));
    expect(r.failures.map((f) => f.sourceId).sort()).toEqual(["err", "html", "slow"]);
    expect(r.failures.find((f) => f.sourceId === "slow")!.error).toMatch(/timeout/i);
    expect(r.failures.find((f) => f.sourceId === "err")!.error).toMatch(/500/);
  });

  it("skips inactive sources", async () => {
    const { fn, calls } = mockFetch({ "https://off.test/feed": fx("rss2.xml") });
    const r = await collectLive([source({ id: "off", active: false })], fn);
    expect(calls).toHaveLength(0);
    expect(r.items).toEqual([]);
    expect(r.failures).toEqual([]);
  });

  it("sends the honest User-Agent and the Accept header, with an abort signal", async () => {
    const { fn, calls } = mockFetch({ "https://good.test/feed": fx("rss2.xml") });
    await collectLive([source({ id: "good" })], fn);
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("user-agent")).toBe("TralkedBot/1.0 (+https://tralked.com)");
    expect(headers.get("accept")).toBe("text/html,application/xml;q=0.9,*/*;q=0.5");
    expect(calls[0]!.init?.signal).toBeTruthy();
  });

  it("runs at most 6 requests at the same time", async () => {
    let active = 0;
    let peak = 0;
    const fn: FetchFn = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return respond(fx("rss2.xml"));
    };
    const sources = Array.from({ length: 14 }, (_, i) => source({ id: `s${i}` }));
    const r = await collectLive(sources, fn);
    expect(peak).toBe(6);
    expect(r.failures).toEqual([]);
  });

  it("treats a failing YouTube-style feed (404) as a normal source failure", async () => {
    const yt = "https://www.youtube.com/feeds/videos.xml?channel_id=UC1";
    const { fn } = mockFetch({ [yt]: respond("", { status: 404 }), "https://good.test/feed": fx("atom.xml") });
    const r = await collectLive([source({ id: "yt", url: yt }), source({ id: "good" })], fn);
    expect(r.items).toHaveLength(3);
    expect(r.failures).toEqual([{ sourceId: "yt", error: expect.stringMatching(/404/) }]);
  });

  it("collects listing sources and filters section links", async () => {
    const { fn } = mockFetch({ "https://l.test/news/": fx("listing.html") });
    const r = await collectLive(
      [source({ id: "l", kind: "listing", url: "https://l.test/news/", listingSelector: "a.item" })],
      fn,
    );
    // listing.html mixes relative links (resolved against l.test) with absolute example.com links
    // (other host: dropped), so only the two relative article links survive
    expect(r.items.map((i) => new URL(i.url).host)).toEqual(["l.test", "l.test"]);
    expect(r.failures).toEqual([]);
    const { fn: fn2 } = mockFetch({ "https://example.com/news/": fx("listing.html") });
    const r2 = await collectLive(
      [source({ id: "l", kind: "listing", url: "https://example.com/news/", listingSelector: "a.item" })],
      fn2,
    );
    expect(r2.items).toHaveLength(4);
  });

  it("fails a listing whose selector finds nothing (a redesign broke it), so the source alert fires", async () => {
    const { fn } = mockFetch({ "https://l.test/news/": fx("listing.html") });
    const r = await collectLive([source({ id: "l", kind: "listing", url: "https://l.test/news/", listingSelector: "a.nope" })], fn);
    expect(r.items).toEqual([]);
    expect(r.failures[0]).toMatchObject({ sourceId: "l" });
    expect(r.failures[0]!.error).toMatch(/nenhum item/);
  });

  it("fails a listing source that has no listingSelector", async () => {
    const { fn } = mockFetch({ "https://example.com/news/": fx("listing.html") });
    const r = await collectLive([source({ id: "l", kind: "listing", url: "https://example.com/news/" })], fn);
    expect(r.failures[0]).toMatchObject({ sourceId: "l" });
    expect(r.failures[0]!.error).toMatch(/listingSelector/);
  });

  it("substitutes the current year into a /YYYY/ path segment of listing URLs", async () => {
    const { fn, calls } = mockFetch({ "https://example.com/media/news/2027/": fx("listing.html") });
    const r = await collectLive(
      [source({ id: "cd", kind: "listing", url: "https://example.com/media/news/2026/", listingSelector: "a.item" })],
      fn,
      new Date("2027-03-01T00:00:00Z"),
    );
    expect(calls[0]!.url).toBe("https://example.com/media/news/2027/");
    expect(r.failures).toEqual([]);
  });

  it("falls back to the previous year when the new year's page does not exist yet", async () => {
    const { fn, calls } = mockFetch({ "https://example.com/media/news/2026/": fx("listing.html") });
    const r = await collectLive(
      [source({ id: "cd", kind: "listing", url: "https://example.com/media/news/2026/", listingSelector: "a.item" })],
      fn,
      new Date("2027-01-02T00:00:00Z"),
    );
    expect(calls.map((c) => c.url)).toEqual([
      "https://example.com/media/news/2027/",
      "https://example.com/media/news/2026/",
    ]);
    expect(r.failures).toEqual([]);
    expect(r.items.length).toBeGreaterThan(0);
  });

  describe("linkResolve google-news", () => {
    const gnUrl = "https://news.google.com/rss/search?q=site:digitalfoundry.net";
    const gn = source({ id: "df", url: gnUrl, linkResolve: "google-news" });
    const A = "https://news.google.com/rss/articles/CBMiAAAA?oc=5";
    const B = "https://news.google.com/rss/articles/CBMiBBBB?oc=5";

    it("replaces the Google link with the publisher URL when the redirect resolves", async () => {
      const { fn } = mockFetch({
        [gnUrl]: fx("gnews.xml"),
        [A]: respond("<html></html>", { url: "https://www.digitalfoundry.net/switch-2-analysis" }),
        [B]: respond("<html></html>", { url: "https://www.digitalfoundry.net/gta-6-preview" }),
      });
      const r = await collectLive([gn], fn);
      expect(r.failures).toEqual([]);
      expect(r.items.map((i) => i.url).sort()).toEqual([
        "https://www.digitalfoundry.net/gta-6-preview",
        "https://www.digitalfoundry.net/switch-2-analysis",
      ]);
      expect(r.items.every((i) => !i.textUnavailable)).toBe(true);
    });

    it("keeps the item with the Google URL and textUnavailable when it cannot be resolved", async () => {
      const { fn } = mockFetch({
        [gnUrl]: fx("gnews.xml"),
        [A]: respond("<html>consent</html>", { url: A }),
        [B]: respond("<html>consent</html>", { url: B }),
      });
      const r = await collectLive([gn], fn);
      expect(r.failures).toEqual([]);
      expect(r.items).toHaveLength(2);
      const item = r.items.find((i) => i.url === A)!;
      expect(item).toMatchObject({
        title: "Switch 2 performance analysed",
        publisher: "Digital Foundry",
        textUnavailable: true,
        sourceId: "df",
      });
    });

    it("sorts by publication date, newest first", async () => {
      const { fn } = mockFetch({ [gnUrl]: fx("gnews.xml") });
      const r = await collectLive([gn], fn);
      expect(r.items.map((i) => i.url)).toEqual([B, A]);
    });

    it("stops trying to resolve once the first attempts all fail (no flood of requests)", async () => {
      const items = Array.from({ length: 12 }, (_, i) => {
        const l = `https://news.google.com/rss/articles/ID${i}`;
        return `<item><title>Story ${i} - DF</title><link>${l}</link><pubDate>Fri, 30 Oct 2026 ${String(i).padStart(2, "0")}:00:00 GMT</pubDate><source url="https://x.test">DF</source></item>`;
      }).join("");
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;
      const { fn, calls } = mockFetch({ [gnUrl]: xml });
      const r = await collectLive([gn], fn);
      expect(r.items).toHaveLength(12);
      expect(r.items.every((i) => i.textUnavailable)).toBe(true);
      expect(calls.filter((c) => c.url.includes("/rss/articles/")).length).toBeLessThanOrEqual(3);
    });

    it("drops an unresolved Google item whose title duplicates an item from another source", async () => {
      const other = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>GTA 6 tech preview</title><link>https://df.test/gta</link></item></channel></rss>`;
      const { fn } = mockFetch({ [gnUrl]: fx("gnews.xml"), "https://other.test/feed": other });
      const r = await collectLive([gn, source({ id: "other" })], fn);
      expect(r.items.map((i) => i.url).sort()).toEqual(["https://df.test/gta", A].sort());
    });
  });

  it("de-duplicates items with the same normalized URL across sources, keeping the first", async () => {
    const mk = (u: string) =>
      `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>Same</title><link>${u}</link></item></channel></rss>`;
    const { fn } = mockFetch({
      "https://a.test/feed": mk("https://x.test/story/?utm_source=a"),
      "https://b.test/feed": mk("https://x.test/story"),
    });
    const r = await collectLive([source({ id: "a" }), source({ id: "b" })], fn);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.sourceId).toBe("a");
  });
});

describe("collectBackfill", () => {
  const from = new Date("2026-10-01T00:00:00Z");
  const to = new Date("2026-10-31T23:59:59Z");
  const bf = (id: string, url: string) => source({ id, backfill: { kind: "sitemap", url } });

  it("recurses into sitemap indexes and keeps only entries in the window", async () => {
    const { fn, calls } = mockFetch({
      "https://e.test/index.xml": fx("sitemap-index.xml"),
      "https://example.com/sitemap-2026-10.xml": fx("news-sitemap.xml"),
      // sitemap-2026-07 / 09 are filtered by lastmod and must not be fetched
    });
    const r = await collectBackfill([bf("e", "https://e.test/index.xml")], from, to, fn);
    expect(r.items.map((i) => i.url)).toEqual([
      "https://example.com/news/in-window-with-title",
      "https://example.com/2026/10/the-last-of-us-part-3_confirmed/",
    ]);
    expect(calls.map((c) => c.url)).not.toContain("https://example.com/sitemap-2026-07.xml");
    // sitemap-misc.xml (no lastmod) was followed and 404'd: recorded as a failure, siblings still collected
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ sourceId: "e" });
    expect(r.failures[0]!.error).toMatch(/404/);
  });

  it("limits recursion to depth 3", async () => {
    const idx = (next: string) =>
      `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${next}</loc></sitemap></sitemapindex>`;
    const { fn, calls } = mockFetch({
      "https://d.test/0": idx("https://d.test/1"),
      "https://d.test/1": idx("https://d.test/2"),
      "https://d.test/2": idx("https://d.test/3"),
      "https://d.test/3": idx("https://d.test/4"),
      "https://d.test/4": idx("https://d.test/5"),
    });
    const r = await collectBackfill([bf("d", "https://d.test/0")], from, to, fn);
    expect(calls.map((c) => c.url)).toEqual(["https://d.test/0", "https://d.test/1", "https://d.test/2", "https://d.test/3"]);
    expect(r.items).toEqual([]);
  });

  it("does not loop on a sitemap index that references itself", async () => {
    const self = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://c.test/i</loc></sitemap></sitemapindex>`;
    const { fn, calls } = mockFetch({ "https://c.test/i": self });
    await collectBackfill([bf("c", "https://c.test/i")], from, to, fn);
    expect(calls).toHaveLength(1);
  });

  it("never throws per source: a failing source is reported and the others continue", async () => {
    const { fn } = mockFetch({
      "https://ok.test/s.xml": fx("news-sitemap.xml"),
      "https://bad.test/s.xml": fx("not-xml.html"),
    });
    const r = await collectBackfill(
      [bf("bad", "https://bad.test/s.xml"), bf("ok", "https://ok.test/s.xml"), source({ id: "nobackfill" })],
      from,
      to,
      fn,
    );
    expect(r.items.map((i) => i.sourceId)).toEqual(["ok", "ok"]);
    expect(r.failures.map((f) => f.sourceId)).toEqual(["bad"]);
  });
});
