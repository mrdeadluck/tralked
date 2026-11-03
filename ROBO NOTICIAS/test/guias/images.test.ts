import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Ai } from "../../src/ai/client.js";
import { composeImage, pickItemImage } from "../../src/guias/images.js";
import { locateTarget } from "../../src/guias/locate.js";

const sample = readFileSync(new URL("./fixtures/map-sample.jpg", import.meta.url));
const target = { x: 0.5, y: 0.4, r: 0.04 };

async function raw(buf: Buffer, region?: { left: number; top: number; width: number; height: number }) {
  let img = sharp(buf);
  if (region) img = img.extract(region);
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

describe("composeImage", () => {
  it("terceiro nunca é recortado", async () => {
    const out = await composeImage(sample, { target, thirdParty: true, crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1000); // 800x500 ratio kept
  });

  it("oficial com crop recorta", async () => {
    const out = await composeImage(sample, { target: null, thirdParty: false, crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(2000); // 400x500 crop, 4:5
  });

  it("sem alvo não desenha anel", async () => {
    const out = await composeImage(sample, { target: null, thirdParty: true });
    const base = await sharp(sample).resize({ width: 1600 }).webp().toBuffer();
    const region = { left: 700, top: 300, width: 200, height: 200 }; // central, away from the corner mark
    const a = await raw(out, region);
    const b = await raw(base, region);
    let diff = 0;
    for (let i = 0; i < a.data.length; i++) diff += Math.abs(a.data[i]! - b.data[i]!);
    expect(diff / a.data.length).toBeLessThan(2);
  });

  it("com alvo desenha o anel lima", async () => {
    const out = await composeImage(sample, { target, thirdParty: true });
    const { data, info } = await raw(out);
    // ring of radius 0.04*1600 = 64 around (800, 400): lime pixel on the right edge of the ring
    const x = 800 + 64;
    const y = 400;
    const i = (y * info.width + x) * info.channels;
    expect(data[i + 1]!).toBeGreaterThan(200);
    expect(data[i]!).toBeGreaterThan(150);
    expect(data[i + 2]!).toBeLessThan(120);
  });

  it("marca TRALKED presente", async () => {
    const dark = await sharp({ create: { width: 800, height: 500, channels: 3, background: "#101010" } }).png().toBuffer();
    const out = await composeImage(dark, { target: null, thirdParty: true });
    const region = { left: 1600 - 330, top: 1000 - 90, width: 320, height: 80 };
    const { data } = await raw(out, region);
    let max = 0;
    for (const v of data) max = Math.max(max, v);
    expect(max).toBeGreaterThan(100); // white mark at 55% over near-black
    expect(max).toBeLessThan(200); // not fully opaque
  });
});

describe("pickItemImage", () => {
  const html = (body: string) => `<html><body>${body}</body></html>`;
  const item = { name: "Pena Dourada", nameEn: "Golden Feather" };

  it("pega a imagem do bloco do item e resolve a URL relativa", () => {
    const pages = [
      {
        url: "https://wiki.example.fandom.com/wiki/Feathers",
        sourceName: "Wiki",
        html: html(
          `<h3>Other</h3><img src="/img/other-big.jpg" width="800">` +
            `<h3>Golden Feather</h3><p>Behind the waterfall.</p><img src="/img/gf.jpg" width="800">`,
        ),
      },
    ];
    expect(pickItemImage(item, pages)).toEqual({
      url: "https://wiki.example.fandom.com/img/gf.jpg",
      sourceName: "Wiki",
      sourceUrl: "https://wiki.example.fandom.com/wiki/Feathers",
      thirdParty: true,
    });
  });

  it("PowerPyx fica por último, wiki e guia Steam vêm antes", () => {
    const body = `<h3>Golden Feather</h3><img src="/a.jpg" width="800">`;
    const pages = [
      { url: "https://www.powerpyx.com/game-guide/", sourceName: "PowerPyx", html: html(body) },
      { url: "https://steamcommunity.com/sharedfiles/filedetails/?id=1", sourceName: "Steam Guide", html: html(body) },
    ];
    expect(pickItemImage(item, pages)?.sourceName).toBe("Steam Guide");
  });

  it("ignora ícones e não chuta quando o item não aparece", () => {
    const pages = [
      { url: "https://x.com/g", sourceName: "X", html: html(`<h3>Golden Feather</h3><img src="/logo.png" width="32">`) },
      { url: "https://y.com/g", sourceName: "Y", html: html(`<h3>Silver Coin</h3><img src="/coin.jpg" width="800">`) },
    ];
    expect(pickItemImage(item, pages)).toBeNull();
  });
});

describe("locateTarget", () => {
  const ai = (out: unknown) => {
    const structured = vi.fn(async (_opts: unknown) => out);
    return { ai: { structured } as unknown as Ai, structured };
  };

  it("manda a imagem e devolve coordenadas normalizadas", async () => {
    const a = ai({ found: true, x: 0.3, y: 0.7, r: 0.05 });
    expect(await locateTarget(a.ai, sample, "Golden Feather")).toEqual({ x: 0.3, y: 0.7, r: 0.05 });
    const opts = a.structured.mock.calls[0]![0] as { images: { mediaType: string }[] };
    expect(opts.images[0]!.mediaType).toBe("image/jpeg");
  });

  it("devolve null quando não achou ou fora do intervalo", async () => {
    expect(await locateTarget(ai({ found: false, x: 0, y: 0, r: 0 }).ai, sample, "x")).toBeNull();
    expect(await locateTarget(ai({ found: true, x: 1.4, y: 0.2, r: 0.05 }).ai, sample, "x")).toBeNull();
  });
});
