import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Ai, StructuredOpts } from "../src/ai/client.js";
import type { SourceMedia } from "../src/collect/media.js";
import type { Source } from "../src/config.js";
import type { ItemRow, StoryRow } from "../src/db.js";
import { chooseImages } from "../src/media/choose.js";
import { GALLERY_MAX, GALLERY_MIN, isImagesStory } from "../src/media/gallery.js";

/** A distinct picture per seed (block position, gradient direction and colours vary). */
async function picture(width: number, height: number, seed: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  const bx = (seed % 4) * 0.2;
  const by = (Math.floor(seed / 4) % 3) * 0.25;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const inBlock = x > width * bx && x < width * (bx + 0.2) && y > height * by && y < height * (by + 0.3);
      const v = inBlock ? 255 - ((seed * 37) % 120) : Math.round((255 * ((seed % 2 ? 1 - x / width : x / width) + (seed % 3 ? y / height : 1 - y / height))) / 2);
      raw[i] = v;
      raw[i + 1] = (v + seed * 50) % 256;
      raw[i + 2] = (255 - v + seed * 20) % 256;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

const SOURCES: Source[] = [
  { id: "rn", name: "Rockstar Newswire", kind: "rss", url: "https://feeds.test/rn.xml", tier: "oficial", category: "GAMES", gamingFilter: false, active: true },
  { id: "ign", name: "IGN", kind: "rss", url: "https://feeds.test/ign.xml", tier: "portal", category: "GAMES", gamingFilter: false, active: true },
];

let nextId = 1;
const item = (sourceId: string, url: string, title: string, media: Partial<SourceMedia>): ItemRow => ({
  id: nextId++,
  url,
  source_id: sourceId,
  title,
  summary: null,
  published_at: null,
  fetched_at: "2026-11-05T12:00:00Z",
  content_hash: null,
  text: "x",
  status: "clustered",
  triage_json: null,
  publisher: null,
  text_unavailable: 0,
  video_id: null,
  media_json: JSON.stringify({ images: [], youtube: [], posts: [], ...media }),
});

function visionAi(refuse: (url: string) => boolean = () => false) {
  const calls: StructuredOpts<unknown>[] = [];
  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    const rows = [...opts.user.matchAll(/^Imagem \d+: (img\d+) \(de [^)]*\) <([^>]+)>/gm)];
    return opts.schema.parse({ verdicts: rows.map((m) => ({ id: m[1], ok: !refuse(m[2]!), depicts: "captura de GTA 6", reason: "ok" })) });
  });
  return { ai: { structured } as unknown as Ai, calls };
}

function uploader() {
  let n = 0;
  return { uploadImage: vi.fn(async () => ({ url: `https://blob.test/${++n}.webp` })) };
}

/** Rockstar Newswire and IGN carry the same key art and the same `shots` screenshots. */
async function gta(shots: number) {
  const files: Record<string, Buffer> = {};
  const key = await picture(1920, 1080, 0);
  files["https://media-rockstargames-com.akamaized.net/key.jpg"] = key;
  files["https://ign.test/key.jpg"] = await sharp(key).resize(1280, 720).jpeg().toBuffer();
  const rnImages = [{ url: "https://media-rockstargames-com.akamaized.net/key.jpg", role: "og" as const }];
  const ignImages = [{ url: "https://ign.test/key.jpg", role: "og" as const }];
  for (let i = 1; i <= shots; i++) {
    const shot = await picture(1600, 900, i);
    files[`https://media-rockstargames-com.akamaized.net/shot${i}.jpg`] = shot;
    files[`https://ign.test/shot${i}.jpg`] = await sharp(shot).resize(1200, 675).jpeg({ quality: 70 }).toBuffer();
    rnImages.push({ url: `https://media-rockstargames-com.akamaized.net/shot${i}.jpg`, role: "body" as const } as never);
    ignImages.push({ url: `https://ign.test/shot${i}.jpg`, role: "body" as const } as never);
  }
  const items = [
    item("rn", "https://www.rockstargames.com/newswire/article/gta6", "New Grand Theft Auto VI screenshots", { images: rnImages }),
    item("ign", "https://www.ign.com/gta6-images", "GTA 6 new images show Jason and Lucia", { images: ignImages }),
  ];
  const fetchFn = vi.fn(async (url: string) =>
    files[url] ? new Response(new Uint8Array(files[url]!), { status: 200, headers: { "content-type": "image/jpeg" } }) : new Response("no", { status: 404 }),
  );
  return { items, fetchFn };
}

const story = { id: 5265, headline: "Rockstar solta novas imagens de GTA 6 com Jason e Lucia" } as StoryRow;
const input = (items: ItemRow[]) => ({
  story,
  items,
  sources: SOURCES,
  companies: ["Rockstar Games"],
  subject: "Grand Theft Auto VI",
  catalog: null,
  officialVideoIds: [],
});

describe("isImagesStory", () => {
  it("is about new images, screenshots or a gallery; not a delay", () => {
    const it_ = (title: string) => [item("ign", "https://x.test/1", title, {})];
    expect(isImagesStory({ headline: "Rockstar solta novas imagens de GTA 6" } as StoryRow, it_("x"))).toBe(true);
    expect(isImagesStory({ headline: "GTA 6" } as StoryRow, it_("New GTA VI screenshots"))).toBe(true);
    expect(isImagesStory({ headline: "GTA 6 é adiado" } as StoryRow, it_("GTA 6 delayed"))).toBe(false);
    expect([GALLERY_MIN, GALLERY_MAX]).toEqual([3, 8]);
  });
});

describe("chooseImages with a gallery", () => {
  it("news about new images brings the official gallery, the cover apart, credited to Rockstar Games", async () => {
    const { items, fetchFn } = await gta(5);
    const { ai, calls } = visionAi();
    const out = await chooseImages(input(items), { ai, config: { MODEL_VISION: "m" }, fetchFn, tralked: uploader() }, { gallery: true });
    expect(out.cover?.creditUrl).toBe("https://www.rockstargames.com/newswire/article/gta6");
    expect(out.gallery).toHaveLength(5);
    for (const g of out.gallery!) expect(g).toMatchObject({ credit: "Divulgação/Rockstar Games", creditUrl: "https://www.rockstargames.com/newswire/article/gta6" });
    expect(out.gallery!.map((g) => g.url)).not.toContain(out.cover!.url);
    expect(out.bodyImage).toBeUndefined();
    // Copies on IGN count once: 6 pictures, one vision call.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.images).toHaveLength(6);
  });

  it("at most 8 pictures, and the vision check runs in at most 2 calls of 6", async () => {
    const { items, fetchFn } = await gta(11);
    const { ai, calls } = visionAi();
    const out = await chooseImages(input(items), { ai, config: { MODEL_VISION: "m" }, fetchFn, tralked: uploader() }, { gallery: true });
    expect(calls).toHaveLength(2);
    expect(out.gallery).toHaveLength(8);
  });

  it("an image the vision refuses stays out; with fewer than 3 approved there is no gallery", async () => {
    const { items, fetchFn } = await gta(4);
    const refused = visionAi((url) => url.endsWith("shot2.jpg"));
    const out = await chooseImages(input(items), { ai: refused.ai, config: { MODEL_VISION: "m" }, fetchFn, tralked: uploader() }, { gallery: true });
    expect(out.gallery).toHaveLength(3);

    const few = visionAi((url) => /shot[234]\.jpg$/.test(url));
    const none = await chooseImages(input(items), { ai: few.ai, config: { MODEL_VISION: "m" }, fetchFn, tralked: uploader() }, { gallery: true });
    expect(none.gallery).toBeUndefined();
    expect(none.cover).toBeDefined();
    expect(none.bodyImage).toBeDefined();
  });
});
