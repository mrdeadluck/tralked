import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Ai } from "../../src/ai/client.js";
import {
  composeImage,
  imageKey,
  imageWidth,
  markImageUsed,
  newImageUsage,
  pickItemImage,
  type ImageItem,
  type PagesInput,
} from "../../src/guias/images.js";
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

describe("marca em imagem de terceiro", () => {
  it("vai para o canto mais vazio e deixa a marca d'água da fonte intacta", async () => {
    // flat grey picture with a high-contrast pattern (a source watermark) in the bottom-right corner
    const stripes = Array.from({ length: 12 }, (_, i) => `<rect x="${560 + i * 20}" y="400" width="10" height="100" fill="#fff"/>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#303030"/><rect x="560" y="400" width="240" height="100" fill="#000"/>${stripes}</svg>`;
    const src = await sharp(Buffer.from(svg)).png().toBuffer();
    const out = await composeImage(src, { target: null, thirdParty: true });
    const truth = await sharp(src).resize({ width: 1600 }).png().toBuffer();
    const lossyBase = await sharp(truth).webp({ quality: 86 }).toBuffer();
    const br = { left: 1100, top: 800, width: 500, height: 200 };
    const meanDiff = async (x: Buffer) => {
      const a = await raw(x, br);
      const b = await raw(truth, br);
      let diff = 0;
      for (let i = 0; i < a.data.length; i++) diff += Math.abs(a.data[i]! - b.data[i]!);
      return diff / a.data.length;
    };
    // same as plain WebP compression of the resized input: nothing drawn over the source watermark
    expect(Math.abs((await meanDiff(out)) - (await meanDiff(lossyBase)))).toBeLessThan(1);
    // the mark landed in another corner: bright pixels there
    const tl = await raw(out, { left: 0, top: 0, width: 330, height: 90 });
    const bl = await raw(out, { left: 0, top: 910, width: 330, height: 90 });
    const bright = (d: Buffer) => d.reduce((m, v) => Math.max(m, v), 0);
    expect(Math.max(bright(tl.data), bright(bl.data))).toBeGreaterThan(100);
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

  it("imagem antes da legenda", () => {
    const pages = [
      {
        url: "https://wiki.x.com/p",
        sourceName: "W",
        html: html(`<div><img src="/hero.jpg" width="900"><p>Intro text.</p><img src="/gf.jpg" width="800"><p class="cap">Golden Feather</p></div>`),
      },
    ];
    expect(pickItemImage(item, pages)?.url).toBe("https://wiki.x.com/gf.jpg");
  });

  it("vários itens no mesmo contêiner: cada um fica com a sua imagem", () => {
    const pages = [
      {
        url: "https://wiki.x.com/p",
        sourceName: "W",
        html: html(
          `<div><img src="/hero.jpg" width="900"><p>Silver Coin: near the gate.</p><img src="/coin.jpg" width="800">` +
            `<p>Golden Feather: behind the waterfall.</p><img src="/gf.jpg" width="800"></div>`,
        ),
      },
    ];
    expect(pickItemImage(item, pages)?.url).toBe("https://wiki.x.com/gf.jpg");
    expect(pickItemImage({ name: "Silver Coin" }, pages)?.url).toBe("https://wiki.x.com/coin.jpg");
  });

  it("não cruza para a seção de outro item (cabeçalho seguinte)", () => {
    const pages = [
      {
        url: "https://wiki.x.com/p",
        sourceName: "W",
        html: html(`<h3>Golden Feather</h3><p>Somewhere.</p><h3>Silver Coin</h3><img src="/coin.jpg" width="800">`),
      },
    ];
    expect(pickItemImage(item, pages)).toBeNull();
  });

  it("palavra inteira: 'Golden Feather Fragment' não é 'Golden Feather'; sumário é ignorado", () => {
    const pages = [
      {
        url: "https://wiki.x.com/p",
        sourceName: "W",
        html: html(
          `<nav class="toc"><a href="#gf">Golden Feather</a><img src="/toc.jpg" width="800"></nav>` +
            `<h3>Golden Feather Fragment</h3><img src="/frag.jpg" width="800">` +
            `<h3>Golden Feather 2</h3><img src="/gf2.jpg" width="800">`,
        ),
      },
    ];
    expect(pickItemImage(item, pages)?.url).toBe("https://wiki.x.com/gf2.jpg");
  });

  it("ignora ícones e não chuta quando o item não aparece", () => {
    const pages = [
      { url: "https://x.com/g", sourceName: "X", html: html(`<h3>Golden Feather</h3><img src="/logo.png" width="32">`) },
      { url: "https://y.com/g", sourceName: "Y", html: html(`<h3>Silver Coin</h3><img src="/coin.jpg" width="800">`) },
    ];
    expect(pickItemImage(item, pages)).toBeNull();
  });
});

describe("Task 28: imagens por item, únicas e de fontes variadas (R42)", () => {
  const html = (body: string, bodyClass = "") => `<html><body class="${bodyClass}">${body}</body></html>`;
  const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  /** Picks for the items in order, each one used as the pipeline does: what each item got. */
  const place = (items: ImageItem[], pages: PagesInput, usage = newImageUsage()) =>
    items.map((item) => {
      const picked = pickItemImage(item, pages, usage);
      if (picked) markImageUsed(usage, picked);
      return picked;
    });

  it("a mesma imagem nunca vai para dois itens; o segundo leva o próximo candidato do próprio item ou nenhum", () => {
    const pages = [
      { url: "https://wiki.x.com/a", sourceName: "A", html: html(`<h3>Golden Feather</h3><img src="/gf.jpg" width="800">`) },
      { url: "https://guides.y.com/b", sourceName: "B", html: html(`<h3>Golden Feather</h3><img src="/gf-b.jpg" width="800">`) },
    ];
    const usage = newImageUsage();
    const [first, second, third] = place([{ name: "Golden Feather" }, { name: "Golden Feather" }, { name: "Golden Feather" }], pages, usage);
    expect(first?.url).toBe("https://wiki.x.com/gf.jpg");
    expect(second?.url).toBe("https://guides.y.com/gf-b.jpg");
    expect(third).toBeNull();
    expect(usage.duplicatesAvoided).toBe(2);
  });

  it("a URL normalizada conta: a miniatura -300x169 e a original são a mesma imagem", () => {
    expect(imageKey("https://www.powerpyx.com/wp-content/uploads/pbz-1-1-300x169.jpg?x=1")).toBe(
      imageKey("https://www.powerpyx.com/wp-content/uploads/pbz-1-1.jpg"),
    );
    expect(imageKey("https://static0.fextralifeimages.com/file/pbz/thumb/0/02/Shot.jpg/900px-Shot.jpg")).toBe(
      imageKey("https://static0.fextralifeimages.com/file/pbz/0/02/Shot.jpg"),
    );
  });

  it("fontes variadas: com imagem própria em duas fontes, os itens se revezam entre elas", () => {
    const names = ["Golden Feather", "Silver Coin", "Iron Key", "Jade Ring"];
    const body = (who: string) => names.map((n) => `<h3>${n}</h3><img src="/${who}-${n.replace(" ", "")}.jpg" width="800">`).join("");
    const pages = [
      { url: "https://www.powerpyx.com/game-guide/", sourceName: "PowerPyx", html: html(body("ppx")) },
      { url: "https://steamcommunity.com/sharedfiles/filedetails/?id=1", sourceName: "Steam Guide", html: html(body("steam")) },
    ];
    const picks = place(names.map((name) => ({ name })), pages);
    expect(picks.map((p) => p?.sourceName)).toEqual(["PowerPyx", "Steam Guide", "PowerPyx", "Steam Guide"]);
  });

  it("especificidade vence a variedade: o bloco do item numa fonte já usada antes da menção solta em outra", () => {
    const pages = [
      {
        url: "https://wiki.x.com/a",
        sourceName: "A",
        html: html(`<h3>Silver Coin</h3><img src="/coin.jpg" width="800"><h3>Golden Feather</h3><img src="/gf.jpg" width="800">`),
      },
      { url: "https://guides.y.com/b", sourceName: "B", html: html(`<p>You may find the Golden Feather around here.</p><img src="/loose.jpg" width="800">`) },
    ];
    const picks = place([{ name: "Silver Coin" }, { name: "Golden Feather" }], pages);
    expect(picks.map((p) => p?.url)).toEqual(["https://wiki.x.com/coin.jpg", "https://wiki.x.com/gf.jpg"]);
  });

  it("alt com o nome do item conta como prova do item", () => {
    const pages = [
      {
        url: "https://wiki.x.com/a",
        sourceName: "A",
        html: html(`<p>Many things live here.</p><img src="/x.jpg" width="800"><img src="/gf.jpg" width="800" alt="Golden Feather location">`),
      },
    ];
    expect(pickItemImage({ name: "Golden Feather" }, pages)?.url).toBe("https://wiki.x.com/gf.jpg");
  });

  it("recusa imagem de topo/infobox, repetida na página e estreita; a classe do <body> não esconde a página", () => {
    const page = (inner: string) => [{ url: "https://site.x.com/p", sourceName: "X", html: html(inner, "content-sidebar genesis-breadcrumbs-visible") }];
    const item = { name: "Golden Feather" };
    expect(pickItemImage(item, page(`<h3>Golden Feather</h3><img src="/gf.jpg" width="300" height="169">`))?.url).toBe("https://site.x.com/gf.jpg");
    expect(pickItemImage(item, page(`<h3>Golden Feather</h3><div class="infobox"><img src="/box.jpg" width="800"></div>`))).toBeNull();
    expect(pickItemImage(item, page(`<div class="post-hero"><h3>Golden Feather</h3><img src="/hero.jpg" width="800"></div>`))).toBeNull();
    expect(pickItemImage(item, page(`<img src="/art.jpg" width="900"><h3>Golden Feather</h3><img src="/art.jpg" width="900">`))).toBeNull();
    expect(pickItemImage(item, page(`<h3>Golden Feather</h3><img src="/small.jpg" width="200" height="120">`))).toBeNull();
    // A small thumbnail whose srcset offers the big file is fine.
    expect(
      pickItemImage(item, page(`<h3>Golden Feather</h3><img src="/gf-200x113.jpg" width="200" srcset="/gf-200x113.jpg 200w, /gf.jpg 1280w">`))?.url,
    ).toBe("https://site.x.com/gf.jpg");
  });

  it("entradas com o mesmo nome: a pista de local separa; sem pista, nenhuma (nunca a de outro item)", () => {
    const pages = [
      {
        url: "https://www.powerpyx.com/region/",
        sourceName: "PowerPyx (Region)",
        html: html(
          `<p><strong>#4 – Blackstone Fragment</strong><br>From the Outpost Bell, climb the stairs to the courtyard chest.</p><p><img src="/r-4.jpg" width="800"></p>` +
            `<p><strong>#9 – Blackstone Fragment</strong><br>Behind the waterfall, a monk drops it once defeated.</p><p><img src="/r-9.jpg" width="800"></p>`,
        ),
      },
    ];
    const waterfall = pickItemImage({ name: "Blackstone Fragment", hint: "Go behind the waterfall and defeat the monk; he drops it." }, pages);
    expect(waterfall?.url).toBe("https://www.powerpyx.com/r-9.jpg");
    const outpost = pickItemImage({ name: "Blackstone Fragment", hint: "Outpost Bell: up the stairs, chest in the courtyard." }, pages);
    expect(outpost?.url).toBe("https://www.powerpyx.com/r-4.jpg");
    expect(pickItemImage({ name: "Blackstone Fragment" }, pages)).toBeNull();
    // The number in the item's own name picks its entry.
    expect(pickItemImage({ name: "#9 Blackstone Fragment" }, pages)?.url).toBe("https://www.powerpyx.com/r-9.jpg");
  });

  it("PowerPyx real (Weeping Creek Valley): cada entrada numerada dá a sua própria captura, sem repetir", () => {
    const pages = [
      {
        url: "https://www.powerpyx.com/phantom-blade-zero-weeping-creek-valley-collectible-locations/",
        sourceName: "PowerPyx (Weeping Creek Valley)",
        html: fx("powerpyx-pbz-weeping-creek.html"),
      },
    ];
    const items: ImageItem[] = [
      { name: "Bell (The Beginning)" },
      { name: "Bell (The Lady's Rift)" },
      { name: "Triple Threat" },
      { name: "Hunter's Insight" },
      { name: "Sanguine Twin" },
      { name: "Bell (Outpost)" },
      { name: "Scarlet Wraithblade" },
      { name: "Sha-Chi Amber Fragment", hint: "In a chest next to the enemy you defeat to remove the thread barrier." },
      { name: "Sha-Chi Amber Fragment", hint: "From the Rustblade Pavilion Bell go up the stairs; an enemy jumps out of the boxes and drops it." },
      { name: "Sha-Chi Amber Fragment", hint: "From the Outpost Bell break the barricade, enter the house up the stairs and defeat the enemy inside." },
      { name: "Blackstone Fragment", hint: "From the Long Pillar Overlook Bell, cross the bridge, drop into the village, follow the river north to the wooden platform." },
      { name: "Blackstone Fragment", hint: "From the Long Pillar Overlook Bell, backtrack into the small cave under the tower; the monks drop it." },
    ];
    const picks = place(items, pages);
    const urls = picks.map((p) => p?.url);
    expect(urls.every(Boolean)).toBe(true);
    expect(new Set(urls).size).toBe(items.length);
    expect(urls[0]).toBe("https://www.powerpyx.com/wp-content/uploads/phantom-blade-zero-weeping-creek-valley-1-1.jpg");
    // Same-named entries, each its own screenshot: #12, #15, #24 and #49, #50.
    expect(new Set(urls.slice(7).map((u) => u!.match(/valley-(\d+)-/)?.[1])).size).toBe(5);
    expect(picks.every((p) => p!.sourceUrl === pages[0]!.url && p!.thirdParty)).toBe(true);
  });

  it("Fextralife real (Steel and Steam): o print do trecho não vai para os vários itens de mesmo nome do guia", () => {
    const pages = [{ url: "https://phantombladezero.wiki.fextralife.com/Steel_and_Steam", sourceName: "Fextralife", html: fx("fextralife-pbz-steel-and-steam.html") }];
    // Many items of the guide share these names (one per place): a passing mention in a walkthrough is none of them.
    const shared = (name: string): ImageItem[] => Array.from({ length: 8 }, () => ({ name, shared: true }));
    const picks = place([...shared("Blackstone Fragment"), ...shared("Sha-Chi Amber Fragment"), { name: "Scarlet Wraithblade" }], pages);
    // Before: one screenshot for 27 "Blackstone Fragment" items and another for 23 "Sha-Chi Amber Fragment" ones.
    expect(picks.slice(0, 16).every((p) => p === null)).toBe(true);
    const urls = picks.filter((p) => p !== null).map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.some((u) => /logo/i.test(u))).toBe(false);
  });
});

describe("imageWidth", () => {
  it("lê a largura dos bytes; bytes que não são imagem → undefined", async () => {
    expect(await imageWidth(sample)).toBe(800);
    expect(await imageWidth(Buffer.from("not an image"))).toBeUndefined();
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
