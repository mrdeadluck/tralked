import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { BudgetExceededError, UsageLimitError, type Ai, type StructuredOpts } from "../src/ai/client.js";
import type { SourceMedia } from "../src/collect/media.js";
import type { Source } from "../src/config.js";
import type { ItemRow, StoryRow } from "../src/db.js";
import type { ImageCandidate } from "../src/media/candidates.js";
import { chooseImages, creditFor } from "../src/media/choose.js";
import type { GameMedia } from "../src/tralked.js";

// ------------------------------------------------------------------ pictures

/** A structured picture (diagonal gradient, a block whose place depends on `seed`), as JPEG. */
async function picture(width: number, height: number, seed = 0): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  const bx = 0.1 + (seed % 5) * 0.15;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const inBlock = x > width * bx && x < width * (bx + 0.25) && y > height * 0.2 && y < height * 0.7;
      const v = inBlock ? (seed * 53) % 200 : Math.round((255 * ((seed % 2 ? 1 - x / width : x / width) + y / height)) / 2);
      raw[i] = v;
      raw[i + 1] = (v + seed * 40) % 256;
      raw[i + 2] = 255 - v;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

// ------------------------------------------------------------------ fixtures

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
const SOURCES = [src("ign", "IGN", "portal"), src("pxn", "PXN Games", "portal"), src("xbox", "Xbox Wire", "oficial"), src("itch", "itch.io blog", "portal")];

let nextId = 1;
function item(sourceId: string, url: string, media: Partial<SourceMedia>): ItemRow {
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
    publisher: null,
    text_unavailable: 0,
    video_id: null,
    media_json: JSON.stringify({ images: [], youtube: [], posts: [], ...media }),
  };
}

const STORY = { id: 4929, headline: "The Elder Scrolls VI se chama Sentinel" } as StoryRow;

function images(files: Record<string, Buffer>) {
  return vi.fn(async (url: string) => {
    const bytes = files[url];
    return bytes
      ? new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/jpeg" } })
      : new Response("no", { status: 404 });
  });
}

/** Vision that approves every image except the ids in `refuse`. */
function visionAi(refuse: (id: string) => boolean = () => false) {
  const calls: StructuredOpts<unknown>[] = [];
  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    const ids = [...opts.user.matchAll(/^Imagem \d+: (img\d+)/gm)].map((m) => m[1]!);
    return opts.schema.parse({
      verdicts: ids.map((id) => ({ id, ok: !refuse(id), depicts: "logotipo de The Elder Scrolls VI: Sentinel", reason: "ok" })),
    });
  });
  return { ai: { structured } as unknown as Ai, calls };
}

function uploader(fail = false) {
  const uploads: { key: string; contentType: string }[] = [];
  const uploadImage = vi.fn(async (_bytes: Uint8Array, contentType: string, key: string) => {
    if (fail) throw new Error("503");
    uploads.push({ key, contentType });
    return { url: `https://blob.test/${uploads.length}.webp` };
  });
  return { tralked: { uploadImage }, uploads };
}

async function sentinel() {
  const logo = await picture(1920, 1080, 1);
  const files = {
    "https://news.xbox.com/wp/sentinel-logo.jpg": logo,
    "https://cdn.ign.com/sentinel.jpg": await sharp(logo).resize(1280, 720).jpeg({ quality: 70 }).toBuffer(),
    "https://img.pxngames.com/sentinel.jpg": await sharp(logo).resize(1200, 675).jpeg({ quality: 75 }).toBuffer(),
    "https://i.ytimg.com/vi/AbCdEfGhIjK/maxresdefault.jpg": await picture(1280, 720, 3),
  };
  const items = [
    item("ign", "https://www.ign.com/articles/tes-vi", { images: [{ url: "https://cdn.ign.com/sentinel.jpg", role: "og" }] }),
    item("pxn", "https://pxngames.com/noticia/tes-vi", { images: [{ url: "https://img.pxngames.com/sentinel.jpg", role: "og" }] }),
    item("xbox", "https://news.xbox.com/en-us/tes-vi", { images: [{ url: "https://news.xbox.com/wp/sentinel-logo.jpg", role: "og" }] }),
  ];
  return { files, items, logo };
}

const input = (items: ItemRow[], over: Partial<Parameters<typeof chooseImages>[0]> = {}) => ({
  story: STORY,
  items,
  sources: SOURCES,
  companies: ["Bethesda"],
  subject: "The Elder Scrolls VI: Sentinel",
  catalog: null,
  officialVideoIds: ["AbCdEfGhIjK"],
  ...over,
});

const deps = (ai: Ai, fetchFn: ReturnType<typeof images>, tralked: ReturnType<typeof uploader>["tralked"]) => ({
  ai,
  config: { MODEL_VISION: "claude-sonnet-5-5" },
  fetchFn,
  tralked,
});

// ------------------------------------------------------------------ tests

describe("chooseImages", () => {
  it("Sentinel: the logo three sites share becomes the cover, credited to Bethesda with the official page, hosted by us", async () => {
    const { files, items, logo } = await sentinel();
    const { ai, calls } = visionAi();
    const up = uploader();
    const out = await chooseImages(input(items), deps(ai, images(files), up.tralked));

    expect(calls).toHaveLength(1);
    // The three copies of the logo go to the vision check once.
    expect(calls[0]!.images).toHaveLength(2);
    expect(out.cover).toEqual({
      url: "https://blob.test/1.webp",
      alt: "Logotipo de The Elder Scrolls VI: Sentinel",
      credit: "Divulgação/Bethesda",
      creditUrl: "https://news.xbox.com/en-us/tes-vi",
    });
    // The official video's cover is never the body image: the player right after shows it.
    expect(out.bodyImage).toBeUndefined();
    expect(up.tralked.uploadImage).toHaveBeenCalledTimes(1);
    expect(up.uploads[0]!.key).toBe(`noticia-img-${createHash("sha1").update(logo).digest("hex")}`);
    expect(up.uploads[0]!.key).toMatch(/^noticia-img-[0-9a-f]{40}$/);
  });

  it("itch.io: only the site's own og:image, on one site, gives no image and no vision call", async () => {
    const files = { "https://static.itch.io/card.png": await picture(1200, 630, 2) };
    const items = [item("itch", "https://itch.io/blog/1", { images: [{ url: "https://static.itch.io/card.png", role: "og" }] })];
    const { ai, calls } = visionAi();
    const up = uploader();
    const out = await chooseImages(input(items, { companies: ["itch.io"], subject: "itch.io", officialVideoIds: [] }), deps(ai, images(files), up.tralked));
    expect(out).toEqual({});
    expect(calls).toHaveLength(0);
    expect(up.tralked.uploadImage).not.toHaveBeenCalled();
  });

  it("vision refusing everything gives no image", async () => {
    const { files, items } = await sentinel();
    const { ai } = visionAi(() => true);
    const up = uploader();
    expect(await chooseImages(input(items), deps(ai, images(files), up.tralked))).toEqual({});
    expect(up.tralked.uploadImage).not.toHaveBeenCalled();
  });

  it("the catalog of the exact game goes to the body, after an official cover", async () => {
    const { files, items } = await sentinel();
    const catalog: GameMedia = {
      game: { slug: "tes-vi", name: "The Elder Scrolls VI", developer: "Bethesda Game Studios", publisher: "Bethesda Softworks" },
      images: [{ url: "https://images.igdb.com/s1.jpg", kind: "screenshot", width: 1920, height: 1080, source: "igdb" }],
      videos: [],
    };
    const all = { ...files, "https://images.igdb.com/s1.jpg": await picture(1920, 1080, 4) };
    const { ai } = visionAi();
    const up = uploader();
    const out = await chooseImages(input(items, { catalog }), deps(ai, images(all), up.tralked));
    expect(out.cover?.creditUrl).toBe("https://news.xbox.com/en-us/tes-vi");
    expect(out.bodyImage).toMatchObject({ url: "https://blob.test/2.webp", credit: "Divulgação/Bethesda Softworks" });
    expect(out.bodyImage!.creditUrl).toBeUndefined();
  });

  it("a failed upload costs only that image", async () => {
    const { files, items } = await sentinel();
    const { ai } = visionAi();
    const up = uploader(true);
    const log = vi.fn();
    expect(await chooseImages(input(items), { ...deps(ai, images(files), up.tralked), log })).toEqual({});
    expect(log).toHaveBeenCalled();
  });

  it("a vision failure costs the images, except the subscription limit, which stops the run", async () => {
    const { files, items } = await sentinel();
    const broken = { structured: vi.fn(async () => Promise.reject(new Error("timeout"))) } as unknown as Ai;
    expect(await chooseImages(input(items), deps(broken, images(files), uploader().tralked))).toEqual({});
    const limited = { structured: vi.fn(async () => Promise.reject(new UsageLimitError("Mon 12:00am"))) } as unknown as Ai;
    await expect(chooseImages(input(items), deps(limited, images(files), uploader().tralked))).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("a cover that does not fit the frame (square) is skipped for the next official one", async () => {
    const files = {
      "https://news.xbox.com/square.jpg": await picture(1080, 1080, 1),
      "https://news.xbox.com/wide.jpg": await picture(1920, 1080, 2),
    };
    const items = [
      item("xbox", "https://news.xbox.com/a", {
        images: [
          { url: "https://news.xbox.com/square.jpg", role: "og" },
          { url: "https://news.xbox.com/wide.jpg", role: "body" },
        ],
      }),
    ];
    const { ai } = visionAi();
    const up = uploader();
    const out = await chooseImages(input(items, { officialVideoIds: [] }), deps(ai, images(files), up.tralked));
    expect(out.cover?.url).toBe("https://blob.test/1.webp");
    expect(up.tralked.uploadImage).toHaveBeenCalledTimes(2); // wide as cover, square in the body
    expect(out.bodyImage?.url).toBe("https://blob.test/2.webp");
  });
});

describe("creditFor", () => {
  const c = (origin: ImageCandidate["origin"], sourceName = "IGN"): ImageCandidate => ({
    id: "img1",
    url: "https://x/y.jpg",
    origin,
    sourceName,
    sourceUrl: "https://www.ign.com/a",
    host: "ign.com",
  });

  it("official origins are Divulgação/<Empresa>; a repeated news image says via the outlet", () => {
    expect(creditFor(c("fonte-oficial", "Xbox Wire"), ["Bethesda"])).toEqual({ credit: "Divulgação/Bethesda", creditUrl: "https://www.ign.com/a" });
    expect(creditFor(c("video-oficial"), ["Bethesda"]).credit).toBe("Divulgação/Bethesda");
    expect(creditFor(c("loja"), ["Bethesda"]).credit).toBe("Divulgação/Bethesda");
    expect(creditFor(c("fonte"), ["Bethesda"]).credit).toBe("Divulgação/Bethesda, via IGN");
    expect(creditFor(c("fonte"), []).credit).toBe("Divulgação, via IGN");
  });

  it("an official source without a company is credited to the source's name", () => {
    expect(creditFor(c("fonte-oficial", "Xbox Wire"), []).credit).toBe("Divulgação/Xbox Wire");
  });
});
