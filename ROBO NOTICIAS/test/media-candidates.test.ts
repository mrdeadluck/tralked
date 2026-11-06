import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { SourceMedia } from "../src/collect/media.js";
import type { Source } from "../src/config.js";
import type { ItemRow } from "../src/db.js";
import { collectCandidates, fitsBody, fitsCover, isEligible, markRepeated, type ImageCandidate } from "../src/media/candidates.js";
import { blankShare, type FetchedImage } from "../src/media/images.js";

const src = (id: string, name: string, tier: Source["tier"]): Source => ({
  id,
  name,
  kind: "rss",
  url: `https://feeds.test/${id}.xml`,
  tier,
  category: "GAMES",
  gamingFilter: false,
  active: true,
});

const SOURCES = [src("ign", "IGN", "portal"), src("pxn", "PXN Games", "portal"), src("xbox", "Xbox Wire", "oficial"), src("blog", "Blog", "outro")];

let nextId = 1;
function item(sourceId: string, url: string, media: Partial<SourceMedia>, publisher: string | null = null): ItemRow {
  return {
    id: nextId++,
    url,
    source_id: sourceId,
    title: "t",
    summary: null,
    published_at: null,
    fetched_at: "2026-11-03T12:00:00Z",
    content_hash: null,
    text: "x",
    status: "clustered",
    triage_json: null,
    publisher,
    text_unavailable: 0,
    video_id: null,
    media_json: JSON.stringify({ images: [], youtube: [], posts: [], ...media }),
  };
}

const img = (over: Partial<FetchedImage> = {}): FetchedImage => ({
  url: "https://x/y.jpg",
  bytes: Buffer.alloc(0),
  contentType: "image/jpeg",
  width: 1920,
  height: 1080,
  hash: 0n,
  blank: 0.2,
  ...over,
});

describe("collectCandidates", () => {
  it("orders official sources, official video covers, other sources, store art, then the catalog; no repeated URL", () => {
    const items = [
      item("ign", "https://www.ign.com/a", {
        images: [
          { url: "https://cdn.ign.com/logo.jpg", role: "og" },
          { url: "https://shared.steamstatic.com/store_item_assets/steam/apps/1/header.jpg", role: "body" },
        ],
      }),
      item("xbox", "https://news.xbox.com/b", { images: [{ url: "https://news.xbox.com/wp/logo.jpg", role: "og" }] }),
      item("pxn", "https://pxngames.com/c", {
        images: [
          { url: "https://img.pxngames.com/logo.jpg", role: "og" },
          { url: "https://cdn.ign.com/logo.jpg", role: "body" },
          { url: "http://img.pxngames.com/insecure.jpg", role: "body" },
        ],
      }),
    ];
    const cands = collectCandidates({
      items,
      sources: SOURCES,
      officialVideoIds: ["AbCdEfGhIjK"],
      catalog: [{ url: "https://cdn.tralked.com/hero.jpg", gameName: "The Elder Scrolls VI" }],
    });
    expect(cands.map((c) => [c.origin, c.url])).toEqual([
      ["fonte-oficial", "https://news.xbox.com/wp/logo.jpg"],
      ["video-oficial", "https://i.ytimg.com/vi/AbCdEfGhIjK/maxresdefault.jpg"],
      ["fonte", "https://cdn.ign.com/logo.jpg"],
      ["fonte", "https://img.pxngames.com/logo.jpg"],
      ["loja", "https://shared.steamstatic.com/store_item_assets/steam/apps/1/header.jpg"],
      ["catalogo", "https://cdn.tralked.com/hero.jpg"],
    ]);
    expect(new Set(cands.map((c) => c.id)).size).toBe(cands.length);
    expect(cands[0]).toMatchObject({ sourceName: "Xbox Wire", sourceUrl: "https://news.xbox.com/b", host: "news.xbox.com" });
    expect(cands[2]).toMatchObject({ sourceName: "IGN", host: "ign.com" });
  });

  it("credits a Google News item to its publisher", () => {
    const [c] = collectCandidates({
      items: [item("ign", "https://www.eurogamer.net/x", { images: [{ url: "https://cdn.eg.net/a.jpg", role: "og" }] }, "Eurogamer")],
      sources: SOURCES,
      officialVideoIds: [],
      catalog: [],
    });
    expect(c).toMatchObject({ sourceName: "Eurogamer", host: "eurogamer.net" });
  });
});

describe("markRepeated and isEligible", () => {
  const cand = (id: string, host: string, origin: ImageCandidate["origin"], hash: bigint): ImageCandidate => ({
    id,
    url: `https://${host}/${id}.jpg`,
    origin,
    sourceName: host,
    sourceUrl: `https://${host}/page`,
    host,
    image: img({ hash }),
  });

  it("the same picture on two hosts makes both eligible; alone on one site it is not", () => {
    const a = cand("a", "ign.com", "fonte", 0xffff0000ffff0000n);
    const b = cand("b", "pxngames.com", "fonte", 0xffff0000ffff0001n); // 1 bit apart: another copy
    const c = cand("c", "blog.com", "fonte", 0x0123456789abcdefn);
    const repeated = markRepeated([a, b, c]);
    expect([...repeated].sort()).toEqual(["a", "b"]);
    expect(isEligible(a, repeated)).toBe(true);
    expect(isEligible(b, repeated)).toBe(true);
    expect(isEligible(c, repeated)).toBe(false);
  });

  it("two copies on the same host are not a repetition", () => {
    const a = cand("a", "ign.com", "fonte", 0xffff0000ffff0000n);
    const b = cand("b", "ign.com", "fonte", 0xffff0000ffff0000n);
    expect(markRepeated([a, b]).size).toBe(0);
  });

  it("official source, official video and store images are eligible on their own", () => {
    const none = new Set<string>();
    for (const origin of ["fonte-oficial", "video-oficial", "loja", "catalogo"] as const) {
      expect(isEligible(cand("x", "news.xbox.com", origin, 1n), none)).toBe(true);
    }
  });

  it("candidates without a fetched image never count", () => {
    const a = cand("a", "ign.com", "fonte", 5n);
    const b: ImageCandidate = { ...cand("b", "pxn.com", "fonte", 5n), image: undefined };
    expect(markRepeated([a, b]).size).toBe(0);
  });
});

describe("fitsCover and fitsBody", () => {
  it("a cover is wide (>= 1000px), between 1.3 and 2.4, and not mostly empty", () => {
    expect(fitsCover(img({ width: 1920, height: 1080 }))).toBe(true);
    expect(fitsCover(img({ width: 800, height: 800 }))).toBe(false);
    expect(fitsCover(img({ width: 1200, height: 400 }))).toBe(false);
    expect(fitsCover(img({ width: 1000, height: 1000 }))).toBe(false);
    expect(fitsCover(img({ width: 1920, height: 1080, blank: 0.95 }))).toBe(false);
  });

  it("a body image is at least 600px wide", () => {
    expect(fitsBody(img({ width: 600, height: 900 }))).toBe(true);
    expect(fitsBody(img({ width: 599, height: 300 }))).toBe(false);
  });
});

describe("blankShare", () => {
  it("is high for a black frame with a small mark and low for a full picture", async () => {
    const W = 1600;
    const H = 900;
    const black = Buffer.alloc(W * H, 0);
    for (let y = 420; y < 480; y++) for (let x = 760; x < 840; x++) black[y * W + x] = 255;
    const blackJpg = await sharp(black, { raw: { width: W, height: H, channels: 1 } }).jpeg().toBuffer();
    expect(await blankShare(blackJpg)).toBeGreaterThan(0.9);

    const full = Buffer.alloc(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) full[y * W + x] = Math.round((255 * (x / W + y / H)) / 2);
    const fullJpg = await sharp(full, { raw: { width: W, height: H, channels: 1 } }).jpeg().toBuffer();
    expect(await blankShare(fullJpg)).toBeLessThan(0.5);
  });
});
