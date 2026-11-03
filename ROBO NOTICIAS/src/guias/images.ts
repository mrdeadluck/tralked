import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import sharp, { type OverlayOptions } from "sharp";
import type { Target } from "./locate.js";

export const OUTPUT_WIDTH = 1600;
/** Tralked lime (`--acc`). */
export const LIME = "#c6f432";
const RING_PX = 4;
const MARK_WIDTH_FRACTION = 0.16;

export type PagesInput = { url: string; html: string; sourceName: string }[];
export type PickedImage = { url: string; sourceName: string; sourceUrl: string; thirdParty: boolean };

// ---------------------------------------------------------------- pick

function isPreferredHost(host: string, url: string): boolean {
  return host.includes("wiki") || host.endsWith("fandom.com") || (host === "steamcommunity.com" && /sharedfiles|\/guides?\//.test(url));
}
/** Official store art is first-party; everything else we fetch is someone else's work. */
const isOfficialHost = (host: string) => host.endsWith("steamstatic.com") && host.includes("store");

/** 0 wiki / Steam guide, 1 other, 2 PowerPyx (last, when in doubt). */
function sourceRank(pageUrl: string): number {
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  if (host.endsWith("powerpyx.com")) return 2;
  return isPreferredHost(host, pageUrl) ? 0 : 1;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const JUNK = /(logo|avatar|icon|sprite|emoji|badge|banner|pixel|tracking|gravatar|button)/i;

function bestSrc(img: Element, pageUrl: string): string | null {
  const srcset = img.getAttribute("data-srcset") ?? img.getAttribute("srcset");
  let raw: string | null = null;
  if (srcset) {
    const cands = srcset
      .split(",")
      .map((c) => c.trim().split(/\s+/))
      .map(([u, d]) => ({ u: u ?? "", w: Number.parseFloat(d ?? "0") || 0 }))
      .filter((c) => c.u);
    cands.sort((a, b) => b.w - a.w);
    raw = cands[0]?.u ?? null;
  }
  raw ??= img.getAttribute("data-src") ?? img.getAttribute("data-lazy-src") ?? img.getAttribute("src");
  if (!raw || raw.startsWith("data:")) return null;
  try {
    return new URL(raw, pageUrl).href;
  } catch {
    return null;
  }
}

function usableImage(img: Element, url: string): boolean {
  if (/\.(svg|gif)(\?|$)/i.test(url) || JUNK.test(url)) return false;
  for (const attr of ["width", "height"]) {
    const v = Number.parseInt(img.getAttribute(attr) ?? "", 10);
    if (Number.isFinite(v) && v < 120) return false;
  }
  return true;
}

const imgsIn = (el: Element) => [...el.querySelectorAll("img")] as Element[];

/** Images of the block that names the item: climb from the deepest element mentioning it until a block holds images. */
function imagesNear(html: string, pageUrl: string, names: string[]): string[] {
  const { document } = parseHTML(html);
  const wanted = names.map(norm).filter((n) => n.length >= 3);
  if (wanted.length === 0) return [];
  const hasName = (el: Element) => {
    const t = norm(el.textContent ?? "");
    return wanted.some((n) => t.includes(n));
  };
  const all = [...document.querySelectorAll("body *")] as Element[];
  const mentions = all.filter((el) => el.tagName !== "IMG" && hasName(el) && ![...el.children].some((c) => hasName(c as Element)));
  for (const m of mentions) {
    let node: Element | null = m;
    for (let up = 0; node && up < 4; up++) {
      // Images inside this node, then in the siblings that follow it up to the next heading.
      const pool: Element[] = imgsIn(node);
      let sib = node.nextElementSibling;
      for (let n = 0; sib && n < 3 && !/^H[1-6]$/.test(sib.tagName); n++, sib = sib.nextElementSibling) {
        if (sib.tagName === "IMG") pool.push(sib);
        pool.push(...imgsIn(sib));
      }
      const found: string[] = [];
      for (const img of pool) {
        const src = bestSrc(img, pageUrl);
        if (src && usableImage(img, src)) found.push(src);
      }
      if (found.length > 0) return found;
      node = node.parentElement;
    }
  }
  return [];
}

/** The image of the item's block in the stored source pages; wiki / Steam guides first, PowerPyx last. */
export function pickItemImage(item: { name: string; nameEn?: string }, pages: PagesInput): PickedImage | null {
  const names = [item.nameEn, item.name].filter((n): n is string => !!n);
  let best: { rank: number; order: number; picked: PickedImage } | null = null;
  pages.forEach((page, order) => {
    let rank: number;
    try {
      rank = sourceRank(page.url);
    } catch {
      return;
    }
    if (best && rank >= best.rank) return; // ties go to the earlier page
    const [url] = imagesNear(page.html, page.url, names);
    if (!url) return;
    const thirdParty = !isOfficialHost(new URL(url).hostname);
    best = { rank, order, picked: { url, sourceName: page.sourceName, sourceUrl: page.url, thirdParty } };
  });
  return (best as { picked: PickedImage } | null)?.picked ?? null;
}

// ---------------------------------------------------------------- compose

export type Crop = { x: number; y: number; w: number; h: number };
export type ComposeOpts = {
  target: Target | null;
  thirdParty: boolean;
  /** Normalized (0..1) crop of the source image; honored only for official images. */
  crop?: Crop;
};

type Corner = "tl" | "tr" | "bl";

/** The corner with the least detail (lowest luminance spread); bottom-right is left to the Tralked mark. */
async function emptiestCorner(img: Buffer, w: number, h: number): Promise<Corner> {
  const cw = Math.round(w * 0.2);
  const ch = Math.round(h * 0.2);
  const spots: [Corner, number, number][] = [
    ["tl", 0, 0],
    ["tr", w - cw, 0],
    ["bl", 0, h - ch],
  ];
  let best: Corner = "tl";
  let bestDev = Number.POSITIVE_INFINITY;
  for (const [c, left, top] of spots) {
    const st = await sharp(img).extract({ left, top, width: cw, height: ch }).greyscale().stats();
    const dev = st.channels[0]?.stdev ?? 0;
    if (dev < bestDev) {
      bestDev = dev;
      best = c;
    }
  }
  return best;
}

function overlaySvg(w: number, h: number, t: Target, corner: Corner): string {
  const cx = t.x * w;
  const cy = t.y * h;
  const r = Math.max(t.r * w, 16);
  const from = { tl: [0, 0], tr: [w, 0], bl: [0, h] }[corner];
  let dx = from[0]! - cx;
  let dy = from[1]! - cy;
  const dist = Math.hypot(dx, dy) || 1;
  dx /= dist;
  dy /= dist;
  const len = Math.min(w * 0.14, Math.max(dist - r - 12, 0));
  const gap = RING_PX + 6;
  const tip = { x: cx + dx * (r + gap), y: cy + dy * (r + gap) };
  const tail = { x: tip.x + dx * len, y: tip.y + dy * len };
  const head = 22;
  const ang = Math.atan2(-dy, -dx); // direction tail -> tip
  const wing = (a: number) => `${tip.x - Math.cos(ang + a) * head},${tip.y - Math.sin(ang + a) * head}`;
  const shaft = `M${tail.x} ${tail.y}L${tip.x} ${tip.y}`;
  const tipPath = `M${wing(0.5)}L${tip.x} ${tip.y}L${wing(-0.5)}`;
  const stroke = (color: string, width: number) =>
    `<path d="${shaft}${tipPath}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  const arrow = len > 8 ? stroke("#0b0b0b", RING_PX + 4) + stroke(LIME, RING_PX) : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#0b0b0b" stroke-width="${RING_PX + 4}" opacity="0.6"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${LIME}" stroke-width="${RING_PX}"/>
    ${arrow}
  </svg>`;
}

let wordmarkSvg: Buffer | undefined;
const wordmark = () => (wordmarkSvg ??= readFileSync(new URL("../../assets/tralked-wordmark.svg", import.meta.url)));

/**
 * WebP, 1600 px wide. Third-party images are only resized (never cropped), so the source's own watermark
 * stays; official images may be cropped. Ring + arrow on the target, TRALKED mark bottom-right at 55%.
 */
export async function composeImage(bytes: Buffer, opts: ComposeOpts): Promise<Buffer> {
  let target = opts.target;
  let base = sharp(bytes).rotate();
  const crop = !opts.thirdParty ? opts.crop : undefined;
  if (crop) {
    const meta = await sharp(bytes).rotate().metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    const left = Math.max(0, Math.round(crop.x * W));
    const top = Math.max(0, Math.round(crop.y * H));
    const width = Math.max(1, Math.min(W - left, Math.round(crop.w * W)));
    const height = Math.max(1, Math.min(H - top, Math.round(crop.h * H)));
    base = sharp(await base.extract({ left, top, width, height }).toBuffer());
    if (target) {
      // Re-express the target in the cropped frame (r stays relative to the new width).
      const x = (target.x * W - left) / width;
      const y = (target.y * H - top) / height;
      target = x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y, r: (target.r * W) / width };
    }
  }
  const resized = await base.resize({ width: OUTPUT_WIDTH }).png().toBuffer();
  const meta = await sharp(resized).metadata();
  const w = meta.width ?? OUTPUT_WIDTH;
  const h = meta.height ?? 0;

  const layers: OverlayOptions[] = [];
  if (target) {
    const corner = await emptiestCorner(resized, w, h);
    layers.push({ input: Buffer.from(overlaySvg(w, h, target, corner)), left: 0, top: 0 });
  }
  const markW = Math.round(w * MARK_WIDTH_FRACTION);
  const mark = await sharp(wordmark(), { density: 300 }).resize({ width: markW }).png().toBuffer();
  const markH = (await sharp(mark).metadata()).height ?? 0;
  const margin = Math.round(w * 0.015);
  layers.push({ input: mark, left: w - markW - margin, top: Math.max(0, h - markH - margin) });

  return sharp(resized).composite(layers).webp({ quality: 86 }).toBuffer();
}
