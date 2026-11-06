import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Ai, StructuredOpts } from "../src/ai/client.js";
import { VISION_SYSTEM, checkImages } from "../src/ai/vision.js";
import type { ImageCandidate } from "../src/media/candidates.js";
import type { FetchedImage } from "../src/media/images.js";

async function picture(width: number, height: number): Promise<FetchedImage> {
  const bytes = await sharp({ create: { width, height, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  return { url: "https://x/y.jpg", bytes, contentType: "image/jpeg", width, height, hash: 0n, blank: 0.1 };
}

async function cands(n: number, withImage = (_i: number) => true): Promise<ImageCandidate[]> {
  const out: ImageCandidate[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: `img${i}`,
      url: `https://cdn.test/${i}.jpg`,
      origin: "fonte-oficial",
      sourceName: "Xbox Wire",
      sourceUrl: "https://news.xbox.com/a",
      host: "news.xbox.com",
      ...(withImage(i) ? { image: await picture(2000, 1125) } : {}),
    });
  }
  return out;
}

function fakeAi(answer: (opts: StructuredOpts<unknown>) => unknown) {
  const calls: StructuredOpts<unknown>[] = [];
  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    return opts.schema.parse(answer(opts));
  });
  return { ai: { structured } as unknown as Ai, calls };
}

const INPUT = { subject: "The Elder Scrolls VI: Sentinel", headline: "The Elder Scrolls VI se chama Sentinel" };

describe("checkImages", () => {
  it("sends the first 6 candidates that have an image, in id order, in one call, and maps the verdicts by id", async () => {
    const list = await cands(9, (i) => i !== 2);
    const { ai, calls } = fakeAi((opts) => {
      const ids = [...opts.user.matchAll(/^Imagem (\d+): (img\d+)/gm)].map((m) => m[2]);
      return { verdicts: ids.map((id) => ({ id, ok: id !== "img3", depicts: `logo ${id}`, reason: "r" })) };
    });
    const verdicts = await checkImages(ai, { ...INPUT, candidates: list }, { model: "claude-sonnet-5-5" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call).toMatchObject({ purpose: "vision", bucket: "live", effort: "low", model: "claude-sonnet-5-5", system: VISION_SYSTEM });
    expect(call.images).toHaveLength(6);
    expect([...call.user.matchAll(/^Imagem (\d+): (img\d+)/gm)].map((m) => `${m[1]}:${m[2]}`)).toEqual([
      "1:img1",
      "2:img3",
      "3:img4",
      "4:img5",
      "5:img6",
      "6:img7",
    ]);
    expect(call.user).toContain(INPUT.subject);
    expect(call.user).toContain(INPUT.headline);
    expect([...verdicts.keys()]).toEqual(["img1", "img3", "img4", "img5", "img6", "img7"]);
    expect(verdicts.get("img3")?.ok).toBe(false);
    expect(verdicts.get("img1")).toEqual({ id: "img1", ok: true, depicts: "logo img1", reason: "r" });
  });

  it("shrinks big images before sending them", async () => {
    const { ai, calls } = fakeAi(() => ({ verdicts: [] }));
    await checkImages(ai, { ...INPUT, candidates: await cands(1) }, { model: "m" });
    const meta = await sharp(calls[0]!.images![0]!.data).metadata();
    expect(meta.width).toBeLessThanOrEqual(1024);
  });

  it("ignores ids the model made up; an unanswered candidate is missing from the map", async () => {
    const { ai } = fakeAi(() => ({
      verdicts: [
        { id: "img1", ok: true, depicts: "a", reason: "" },
        { id: "img99", ok: true, depicts: "b", reason: "" },
      ],
    }));
    const verdicts = await checkImages(ai, { ...INPUT, candidates: await cands(2) }, { model: "m" });
    expect([...verdicts.keys()]).toEqual(["img1"]);
    expect(verdicts.has("img2")).toBe(false);
  });

  it("makes no call when no candidate has an image", async () => {
    const { ai, calls } = fakeAi(() => ({ verdicts: [] }));
    const verdicts = await checkImages(ai, { ...INPUT, candidates: await cands(3, () => false) }, { model: "m" });
    expect(calls).toHaveLength(0);
    expect(verdicts.size).toBe(0);
  });

  it("the system prompt refuses outlet watermarks, montages, overlaid text and the wrong subject", () => {
    for (const word of ["marca d'água", "montagem", "texto", "assunto", "logotipo oficial", "cortad"]) {
      expect(VISION_SYSTEM.toLowerCase()).toContain(word);
    }
  });
});
