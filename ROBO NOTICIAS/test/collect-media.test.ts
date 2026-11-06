import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractMedia, mediaOf } from "../src/collect/media.js";
import { openDb, type ItemRow } from "../src/db.js";
import { fetchItemTexts } from "../src/pipeline.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(here, "fixtures", "media", name), "utf8");
const PAGE = "https://www.ign.com/articles/tes-vi-sentinel";

describe("extractMedia", () => {
  const media = extractMedia(fx("sentinel-ign.html"), PAGE);

  it("takes og:image with its dimensions, resolved against the page url", () => {
    expect(media.images[0]).toEqual({
      url: "https://www.ign.com/images/sentinel-logo.jpg",
      width: 1920,
      height: 1080,
      role: "og",
    });
    expect(media.images.filter((i) => i.role === "og")).toHaveLength(1);
  });

  it("falls back to twitter:image when there is no og:image", () => {
    const m = extractMedia(fx("twitter-only.html"), "https://itch.io/news");
    expect(m.images).toEqual([{ url: "https://static.itch.io/card.png", role: "og" }]);
  });

  it("keeps large article images (attribute or biggest srcset), never icons, avatars, data: or small ones", () => {
    const body = media.images.filter((i) => i.role === "body").map((i) => i.url);
    expect(body).toEqual(["https://cdn.ign.com/body-1.jpg", "https://cdn.ign.com/body-2-1600.jpg"]);
    expect(media.images.find((i) => i.url === "https://cdn.ign.com/body-1.jpg")).toMatchObject({ width: 1280, height: 720 });
  });

  it("keeps article images without a size hint (measured when fetched), never related-post thumbnails or default share images", () => {
    const html = `<html><head><meta property="og:image" content="https://store.fastly.steamstatic.com/public/shared/images/news/social_share_default.jpg"></head><body><article>
      <img data-src="https://cdn.pxn.test/gta-1.webp" alt="GTA 6">
      <a href="https://cdn.pxn.test/gta-2-full.jpg"><img src="https://cdn.pxn.test/gta-2.jpg" alt="GTA 6"></a>
      <a href="/noticia/outra-materia"><img src="https://cdn.pxn.test/related.jpg" width="1200"></a>
      <img src="https://cdn.pxn.test/tiny.jpg" width="120">
    </article></body></html>`;
    expect(extractMedia(html, "https://pxngames.com/noticia/gta").images).toEqual([
      { url: "https://cdn.pxn.test/gta-1.webp", role: "body" },
      { url: "https://cdn.pxn.test/gta-2.jpg", role: "body" },
    ]);
  });

  it("ignores images outside article/main", () => {
    expect(media.images.some((i) => i.url.includes("site-logo"))).toBe(false);
  });

  it("caps images at 16", () => {
    const imgs = Array.from({ length: 20 }, (_, n) => `<img src="https://cdn.x.com/${n}.jpg" width="1000">`).join("");
    const m = extractMedia(`<html><body><article>${imgs}</article></body></html>`, PAGE);
    expect(m.images).toHaveLength(16);
  });

  it("collects YouTube ids from embeds and links, valid and unique, at most 5", () => {
    expect(media.youtube).toEqual(["AbCdEfGhIjK", "ZyXwVuTsRqP", "12345678901"]);
    const links = Array.from({ length: 8 }, (_, n) => `<a href="https://youtu.be/AAAAAAAAAA${n}">v</a>`).join("");
    expect(extractMedia(`<html><body><article>${links}</article></body></html>`, PAGE).youtube).toHaveLength(5);
  });

  it("collects X posts from embeds and links, normalized to x.com, without intent/share/i/web/hashtag links", () => {
    expect(media.posts).toEqual([
      { url: "https://x.com/bethesda/status/1850000000000000001", handle: "bethesda", statusId: "1850000000000000001" },
      { url: "https://x.com/ToddHoward/status/1850000000000000002", handle: "ToddHoward", statusId: "1850000000000000002" },
    ]);
  });

  it("caps X posts at 5", () => {
    const links = Array.from({ length: 7 }, (_, n) => `<a href="https://x.com/a${n}/status/${100 + n}">p</a>`).join("");
    expect(extractMedia(`<html><body><article>${links}</article></body></html>`, PAGE).posts).toHaveLength(5);
  });

  it("videos and X posts only from the article, never from sidebars or footers", () => {
    const html = `<html><body><aside><iframe src="https://www.youtube.com/embed/SIDEBAR0001"></iframe><a href="https://x.com/PlayStation/status/1">p</a></aside>
      <article><p>Texto.</p></article><footer><a href="https://youtu.be/FOOTER00001">v</a></footer></body></html>`;
    expect(extractMedia(html, PAGE)).toMatchObject({ youtube: [], posts: [] });
  });

  it("returns empty media for an empty or broken page", () => {
    expect(extractMedia("", PAGE)).toEqual({ images: [], youtube: [], posts: [] });
  });
});

describe("mediaOf and setItemMedia", () => {
  it("round-trips through the items table; null or invalid JSON is empty media", () => {
    const db = openDb(":memory:");
    db.insertItemIfNew({ url: "https://a.com/1", sourceId: "s", title: "t", summary: null, publishedAt: null, contentHash: null });
    const item = db.itemsByStatus("new")[0]!;
    expect(item.media_json).toBeNull();
    expect(mediaOf(item)).toEqual({ images: [], youtube: [], posts: [] });

    const media = extractMedia(fx("sentinel-ign.html"), PAGE);
    db.setItemMedia(item.id, media);
    expect(mediaOf(db.itemsByStatus("new")[0]!)).toEqual(media);

    expect(mediaOf({ ...item, media_json: "{not json" } as ItemRow)).toEqual({ images: [], youtube: [], posts: [] });
    expect(mediaOf({ ...item, media_json: '{"images":"x"}' } as ItemRow)).toEqual({ images: [], youtube: [], posts: [] });
  });
});

describe("fetchItemTexts keeps the page media", () => {
  it("stores the media of the same HTML, also when the page has no readable text", async () => {
    const db = openDb(":memory:");
    db.insertItemIfNew({ url: "https://a.com/full", sourceId: "s", title: "full" });
    db.insertItemIfNew({ url: "https://a.com/empty", sourceId: "s", title: "empty" });
    const article = `<p>${"Texto corrido da matéria com detalhes. ".repeat(20)}</p>`;
    const html = (body: string) =>
      `<html><head><meta property="og:image" content="https://cdn.a.com/og.jpg"></head><body><article>${body}</article></body></html>`;
    const fetchFn = async (url: string) =>
      new Response(url.endsWith("/full") ? html(article) : html(""), { status: 200, headers: { "content-type": "text/html" } });
    const items = db.itemsByStatus("new");
    await fetchItemTexts(items, { db, fetchFn });
    for (const item of db.itemsByStatus("new")) {
      expect(mediaOf(item).images[0]?.url).toBe("https://cdn.a.com/og.jpg");
    }
    expect(db.itemsByStatus("new").find((i) => i.title === "full")?.text).toContain("Texto corrido");
  });
});
