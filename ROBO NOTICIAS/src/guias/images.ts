import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import sharp, { type OverlayOptions } from "sharp";
import type { Target } from "./locate.js";
import type { GuideSkeleton } from "./skeleton.js";

export const OUTPUT_WIDTH = 1600;
/** Tralked lime (`--acc`). */
export const LIME = "#c6f432";
const RING_PX = 4;
const MARK_WIDTH_FRACTION = 0.16;

export type PagesInput = { url: string; html: string; sourceName: string }[];
export type PickedImage = { url: string; sourceName: string; sourceUrl: string; thirdParty: boolean };

// ---------------------------------------------------------------- pick

/** An item as the image stage sees it. */
export type ImageItem = {
  name: string;
  nameEn?: string;
  /** More names of the item, in the sources' words (the dossier's). */
  aliases?: string[];
  /** Where the item is, in the source's own words: tells apart entries of the same name. */
  hint?: string;
  /** The pages that list the item. */
  sourceUrls?: string[];
  /** Another item of the guide has the same name: only an entry its hint confirms is this one. */
  shared?: boolean;
};

/**
 * What the run's picks used so far: an image (same normalized URL or same bytes) never goes to two items, and the
 * sources are rotated. Also keeps each page parsed once.
 */
export type ImageUsage = {
  urls: Set<string>;
  hashes: Set<string>;
  /** Images placed per source site (host). */
  bySource: Map<string, number>;
  /** Picks where the item's best image was already another item's. */
  duplicatesAvoided: number;
  parsed: Map<string, PageIndex>;
  /** The other pictures of the entry an offered image came from: one entry, one item. */
  siblings: Map<string, string[]>;
};

export const newImageUsage = (): ImageUsage => ({
  urls: new Set(),
  hashes: new Set(),
  bySource: new Map(),
  duplicatesAvoided: 0,
  parsed: new Map(),
  siblings: new Map(),
});

/** Narrower than this (attributes, srcset or the fetched bytes), an image is an icon or a thumbnail, not the item. */
export const MIN_IMAGE_WIDTH = 300;

/** The site an image is credited to, for the variety count ("powerpyx.com"). */
export const imageSource = (pageUrl: string): string => (URL.canParse(pageUrl) ? new URL(pageUrl).hostname.replace(/^www\./, "") : pageUrl);

/**
 * One key per picture: no query or fragment, a MediaWiki thumbnail as its file, a WordPress size variant
 * ("-300x169") as the original.
 */
export function imageKey(url: string): string {
  if (!URL.canParse(url)) return url;
  const u = new URL(url);
  let path = u.pathname.replace(/\/thumb\/(.+?\.[a-z0-9]+)\/\d+px-[^/]+$/i, "/$1").replace(/-\d+x\d+(\.[a-z0-9]+)$/i, "$1");
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape: the path as written.
  }
  return `${u.hostname.replace(/^www\./, "").toLowerCase()}${path.toLowerCase()}`;
}

export const imageUsed = (usage: ImageUsage, url: string): boolean => usage.urls.has(imageKey(url));

/**
 * The image went to an item: never offered again, nor the other pictures of its entry (that entry is this item's),
 * nor its bytes; its source counted.
 */
export function markImageUsed(usage: ImageUsage, picked: PickedImage, hash?: string): void {
  const key = imageKey(picked.url);
  for (const k of usage.siblings.get(key) ?? [key]) usage.urls.add(k);
  if (hash) usage.hashes.add(hash);
  const source = imageSource(picked.sourceUrl);
  usage.bySource.set(source, (usage.bySource.get(source) ?? 0) + 1);
}

/** The image cannot be used (unreadable, too narrow, the same bytes as a placed one): never offered again. */
export const refuseImage = (usage: ImageUsage, url: string): void => void usage.urls.add(imageKey(url));

/** Width of the image's bytes, or undefined when they are not an image sharp reads. */
export async function imageWidth(bytes: Buffer): Promise<number | undefined> {
  try {
    return (await sharp(bytes).metadata()).width;
  } catch {
    return undefined;
  }
}

/** Official store art is first-party; everything else we fetch is someone else's work. */
const isOfficialHost = (host: string) => host.endsWith("steamstatic.com") && host.includes("store");

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const JUNK = /(logo|avatar|icon|sprite|emoji|smiley|smilies|badge|banner|pixel|tracking|gravatar|button)/i;

/** The largest file the tag offers, and how wide it is when the markup says. */
function bestSrc(img: Element, pageUrl: string): { url: string; width?: number } | null {
  const srcset = img.getAttribute("data-srcset") ?? img.getAttribute("srcset");
  let raw: string | null = null;
  let width: number | undefined;
  const attrWidth = Number.parseInt(img.getAttribute("width") ?? "", 10);
  if (srcset) {
    const cands = srcset
      .split(",")
      .map((c) => c.trim().split(/\s+/))
      .map(([u, d]) => ({ u: u ?? "", n: Number.parseFloat(d ?? "0") || 0, unit: (d ?? "").slice(-1) }))
      .filter((c) => c.u);
    cands.sort((a, b) => b.n - a.n);
    const top = cands[0];
    if (top) {
      raw = top.u;
      if (top.unit === "w") width = top.n;
      else if (top.unit === "x" && Number.isFinite(attrWidth)) width = attrWidth * top.n;
    }
  }
  raw ??= img.getAttribute("data-src") ?? img.getAttribute("data-lazy-src") ?? img.getAttribute("src");
  if (!raw || raw.startsWith("data:")) return null;
  try {
    const url = new URL(raw, pageUrl);
    const imw = Number.parseInt(url.searchParams.get("imw") ?? "", 10);
    width ??= Number.isFinite(attrWidth) ? attrWidth : Number.isFinite(imw) ? imw : undefined;
    return { url: url.href, ...(width !== undefined ? { width } : {}) };
  } catch {
    return null;
  }
}

function usableImage(img: Element, src: { url: string; width?: number }): boolean {
  if (/\.(svg|gif)(\?|$)/i.test(src.url) || JUNK.test(src.url) || JUNK.test(img.getAttribute("class") ?? "")) return false;
  if (src.width !== undefined && src.width < MIN_IMAGE_WIDTH) return false;
  const height = Number.parseInt(img.getAttribute("height") ?? "", 10);
  return !(Number.isFinite(height) && height < 120);
}

const SKIP = "nav,footer,aside,header,[role=navigation]";
/** Site chrome and page-level art (hero, infobox, banners): never one item's picture. */
const SKIP_CLASS =
  /(^|[\s_-])(toc|menu|nav|navigation|breadcrumbs?|sidebar|comments?|related|share|hero|infobox|banner|masthead|author|avatar|sponsor|ads?|advert\w*|widget)([\s_-]|$)/i;
const LABEL_TAGS = new Set(["STRONG", "B", "DT", "TH", "FIGCAPTION", "CAPTION"]);
const BLOCK_TAGS = new Set(["P", "LI", "DIV", "TD", "DD"]);
const HEADING_LEVEL: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const ENTRY_LEVEL = 7;
const LABEL_MAX = 120;
const MAX_DIST_LABEL = 40;
const MAX_DIST_PROSE = 12;

/** Where a page keeps its own text (WordPress, MediaWiki, Steam guides, Game8...); the whole <body> when none. */
const CONTENT_ROOTS = [".entry-content", ".mw-parser-output", "#mw-content-text", ".guide.subSections", "[itemprop=articleBody]", ".archive-style-wrapper", "article", "main"];

/**
 * Outside the page's content, or in its chrome (menus, comments, hero, infobox...). Only the classes between the
 * element and the content root count: the page's own wrappers ("content-sidebar-wrap") say nothing about one image.
 */
function inSkippedArea(el: Element, root: Element): boolean {
  if (!root.contains(el)) return true;
  const chrome = el.closest(SKIP);
  if ((chrome && root.contains(chrome)) || el.closest("a[href^='#']")) return true;
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
    if (SKIP_CLASS.test(`${n.getAttribute("class") ?? ""} ${n.getAttribute("id") ?? ""}`)) return true;
  }
  return false;
}

type PageImg = { at: number; url: string; key: string; alt: string };
type PageLabel = { at: number; el: Element; level: number; text: string; bare: string; context: string };
/** `entry`: holds a label (it is that entry's own paragraph, not a mention elsewhere). */
type PagePara = { at: number; el: Element; text: string; entry: boolean };
type PageIndex = { imgs: PageImg[]; labels: PageLabel[]; paras: PagePara[] };

const hasOwnText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");

/** The element's text with its text nodes kept apart ("<strong>Name</strong><br>From the bell" is not "Namefrom"). */
function textOf(el: Node): string {
  if (el.nodeType === 3) return el.textContent ?? "";
  return [...el.childNodes].map(textOf).join(" ");
}

/** A short title that opens its block: a heading, or "<p><strong>#12 – Name</strong> text</p>", a caption, a dt/th. */
function labelLevel(el: Element): number | undefined {
  const heading = HEADING_LEVEL[el.tagName];
  if (heading) return heading;
  if (!LABEL_TAGS.has(el.tagName)) return undefined;
  const text = (el.textContent ?? "").trim();
  if (!text || text.length > LABEL_MAX) return undefined;
  if (el.tagName === "STRONG" || el.tagName === "B") {
    const parent = el.parentElement;
    if (!parent || !BLOCK_TAGS.has(parent.tagName) || !(parent.textContent ?? "").trim().startsWith(text)) return undefined;
  }
  return ENTRY_LEVEL;
}

function indexPage(html: string, pageUrl: string): PageIndex {
  const { document } = parseHTML(html);
  const all = [...document.querySelectorAll("body *")] as Element[];
  const root = (CONTENT_ROOTS.map((sel) => document.querySelector(sel)).find(Boolean) ?? document.body) as Element;
  const imgs: PageImg[] = [];
  const labels: PageLabel[] = [];
  const paras: PagePara[] = [];
  const seen = new Map<string, number>();
  all.forEach((el, at) => {
    if (el.tagName === "IMG") {
      const src = bestSrc(el, pageUrl);
      if (!src) return;
      const key = imageKey(src.url);
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (!usableImage(el, src) || inSkippedArea(el, root)) return;
      imgs.push({ at, url: src.url, key, alt: norm(`${el.getAttribute("alt") ?? ""} ${el.getAttribute("title") ?? ""}`) });
      return;
    }
    const level = labelLevel(el);
    if (level !== undefined) {
      if (inSkippedArea(el, root)) return;
      const raw = textOf(el).trim();
      const parent = el.parentElement;
      const context = level === ENTRY_LEVEL && parent && BLOCK_TAGS.has(parent.tagName) ? norm(textOf(parent)) : "";
      labels.push({ at, el, level, text: norm(raw), bare: norm(raw.replace(/\s*\([^)]*\)\s*$/, "")), context });
      return;
    }
    if (hasOwnText(el) && !el.closest("h1,h2,h3,h4,h5,h6") && !inSkippedArea(el, root)) paras.push({ at, el, text: norm(textOf(el)), entry: false });
  });
  const paraOf = new Map(paras.map((p) => [p.el, p] as const));
  for (const label of labels) {
    for (let n = label.el.parentElement; n; n = n.parentElement) {
      const para = paraOf.get(n);
      if (para) para.entry = true;
    }
  }
  // A picture used more than once on the page (a banner, a shared map) is no single item's.
  return { imgs: imgs.filter((i) => seen.get(i.key) === 1), labels, paras };
}

const STOP = new Set(
  "from with then that this into will your where there have after before once when they their them which what just also onto down over under item items collectible collectibles".split(" "),
);
const words = (text: string) => norm(text).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
/** Share of the hint's words the entry's text has. */
function hintScore(hint: string[], context: string): number {
  if (hint.length === 0) return 0;
  const have = new Set(context.split(" "));
  return hint.filter((w) => have.has(w)).length / hint.length;
}
const HINT_MIN = 0.4;
const HINT_MARGIN = 0.15;
/** A hint of fewer words tells nothing. */
const HINT_MIN_WORDS = 2;

type Entry = { images: PageImg[]; context: string };

/**
 * The entry that is this item's, among the entries of one page that name it: the only one, or the one its hint
 * points at (required when the guide has other items of the same name or the page does not list the item). None
 * when that is not clear: no picture beats another item's picture.
 */
function chooseEntry(entries: Entry[], hint: string[], mustConfirm: boolean): Entry | undefined {
  const withImages = entries.filter((e) => e.images.length > 0);
  if (withImages.length === 0) return undefined;
  if (withImages.length === 1 && !mustConfirm) return withImages[0];
  if (hint.length < HINT_MIN_WORDS) return undefined;
  const scored = withImages.map((e) => ({ e, s: hintScore(hint, e.context) })).sort((a, b) => b.s - a.s);
  const [best, second] = scored;
  if (!best || best.s < HINT_MIN || (second && best.s - second.s < HINT_MARGIN)) return undefined;
  return best.e;
}

/** `pos`: the image's rank in its entry (the closest to the mention first); `entry`: the keys of all its pictures. */
type Candidate = { picked: PickedImage; key: string; tier: number; listed: number; order: number; pos: number; entry: string[] };

/** The item's candidates on one page, most item-specific first: 0 alt/title names it, 1 its own entry, 2 a prose mention. */
function pageCandidates(item: ImageItem, page: PagesInput[number], index: PageIndex, order: number): Candidate[] {
  const names = [...new Set([item.nameEn, item.name, ...(item.aliases ?? [])].filter((n): n is string => !!n).map(norm))].filter((n) => n.length >= 3);
  if (names.length === 0) return [];
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const exact = new RegExp(`^(?:\\d+ )*(?:${alt})(?: \\d+)*$`);
  const word = new RegExp(`(?:^| )(?:${alt})(?: |$)`);
  const hint = words(item.hint ?? "");
  const listed = !item.sourceUrls?.length || item.sourceUrls.includes(page.url);
  // A name other items of the guide share, on a page that does not list this one: whatever entry it is, it is not provably this item's.
  if (item.shared && !listed) return [];
  const mustConfirm = Boolean(item.shared) || (!listed && hint.length >= HINT_MIN_WORDS);
  const { imgs, labels, paras } = index;

  const after = (from: number, to: number) => imgs.filter((i) => i.at > from && i.at < to && i.at - from <= MAX_DIST_LABEL);
  const near = (at: number, from: number, to: number) =>
    imgs
      .filter((i) => i.at > from && i.at < to && Math.abs(i.at - at) <= MAX_DIST_PROSE)
      .sort((x, y) => Math.abs(x.at - at) - Math.abs(y.at - at) || y.at - x.at);
  const nextLabel = (at: number, level = ENTRY_LEVEL) => labels.find((l) => l.at > at && l.level <= level)?.at ?? Number.POSITIVE_INFINITY;
  const prevLabel = (at: number) => labels.findLast((l) => l.at < at)?.at ?? -1;

  const tiers: Entry[][] = [
    imgs.filter((i) => word.test(i.alt)).map((i) => ({ images: [i], context: i.alt })),
    labels
      .filter((l) => exact.test(l.text) || exact.test(l.bare))
      .map((l) => {
        const end = nextLabel(l.at, l.level);
        const block = paras.filter((p) => p.at > l.at && p.at < end && !p.entry).map((p) => p.text);
        return { images: after(l.at, end), context: [l.context, l.text, ...block].join(" ") };
      }),
    paras
      .filter((p) => !p.entry && word.test(p.text))
      // A passing mention: only the closest picture (the next one may be the next row's, another item's).
      .map((p) => ({ images: near(p.at, prevLabel(p.at), nextLabel(p.at)).slice(0, 1), context: p.text })),
  ];
  const out: Candidate[] = [];
  tiers.forEach((entries, tier) => {
    const entry = chooseEntry(entries, hint, mustConfirm);
    const keys = (entry?.images ?? []).map((i) => i.key);
    (entry?.images ?? []).forEach((img, pos) => {
      const thirdParty = !isOfficialHost(new URL(img.url).hostname);
      out.push({ picked: { url: img.url, sourceName: page.sourceName, sourceUrl: page.url, thirdParty }, key: img.key, tier, listed: listed ? 0 : 1, order, pos, entry: keys });
    });
  });
  return out;
}

/** What the dossier knows of each guide item (by key) that the written guide does not carry: names and place in the sources' words. */
export type ImageHints = Map<string, { aliases: string[]; hint?: string }>;

export function imageHints(skeleton: GuideSkeleton): ImageHints {
  const out: ImageHints = new Map();
  for (const s of skeleton.chapters.flatMap((c) => c.steps.flatMap((st) => st.items))) {
    const names = [s.item?.nameEn, s.item?.name, s.ach?.nameEn, s.ach?.namePt ?? undefined].filter((n): n is string => !!n);
    out.set(s.key, { aliases: [...new Set(names)], ...(s.item?.location ? { hint: s.item.location } : {}) });
  }
  return out;
}

/**
 * The guide's items as the image stage sees them: the written names, the dossier's, the hint, the pages that list
 * each one, and whether another item has the same name (then only an entry its hint confirms is its own).
 */
export function imageItems<T extends { key: string; name: string; nameEn?: string; sources?: { url: string }[] }>(
  items: T[],
  hints: ImageHints,
): Map<T, ImageItem> {
  const nameOf = (i: T) => norm(hints.get(i.key)?.aliases[0] ?? i.nameEn ?? i.name);
  const count = new Map<string, number>();
  for (const i of items) count.set(nameOf(i), (count.get(nameOf(i)) ?? 0) + 1);
  return new Map(
    items.map((i) => {
      const h = hints.get(i.key);
      const sourceUrls = (i.sources ?? []).map((s) => s.url);
      return [
        i,
        {
          name: i.name,
          ...(i.nameEn ? { nameEn: i.nameEn } : {}),
          ...(h?.aliases.length ? { aliases: h.aliases } : {}),
          ...(h?.hint ? { hint: h.hint } : {}),
          ...(sourceUrls.length > 0 ? { sourceUrls } : {}),
          ...((count.get(nameOf(i)) ?? 0) > 1 ? { shared: true } : {}),
        },
      ];
    }),
  );
}

/**
 * The image of the item in the stored source pages, or null. Item-specific evidence first (an image whose alt
 * names it, the image of its own entry or heading, then a prose mention), the pages that list it first; among
 * equals, the source with the fewest images placed so far (variety, R42: PowerPyx included, its watermark kept).
 * An image already placed (`usage`) is never offered again: the next candidate of the item, or none.
 */
export function pickItemImage(item: ImageItem, pages: PagesInput, usage: ImageUsage = newImageUsage()): PickedImage | null {
  const all: Candidate[] = [];
  pages.forEach((page, order) => {
    if (!URL.canParse(page.url)) return;
    const id = `${page.url}\n${page.html.length}`;
    let index = usage.parsed.get(id);
    if (!index) usage.parsed.set(id, (index = indexPage(page.html, page.url)));
    all.push(...pageCandidates(item, page, index, order));
  });
  if (all.length === 0) return null;
  const specific = (a: Candidate, b: Candidate) => a.tier - b.tier || a.listed - b.listed;
  const firstByPlace = [...all].sort((a, b) => specific(a, b) || a.order - b.order || a.pos - b.pos)[0]!;
  const uses = (c: Candidate) => usage.bySource.get(imageSource(c.picked.sourceUrl)) ?? 0;
  const free = all.filter((c) => !usage.urls.has(c.key)).sort((a, b) => specific(a, b) || uses(a) - uses(b) || a.order - b.order || a.pos - b.pos);
  if (usage.urls.has(firstByPlace.key)) usage.duplicatesAvoided++;
  const chosen = free[0];
  if (!chosen) return null;
  usage.siblings.set(chosen.key, chosen.entry);
  return chosen.picked;
}

// ---------------------------------------------------------------- compose

export type Crop = { x: number; y: number; w: number; h: number };
export type ComposeOpts = {
  target: Target | null;
  thirdParty: boolean;
  /** Normalized (0..1) crop of the source image; honored only for official images. */
  crop?: Crop;
};

type Corner = "tl" | "tr" | "bl" | "br";
type Box = { left: number; top: number; width: number; height: number };

const cornerBox = (c: Corner, w: number, h: number, bw: number, bh: number): Box => ({
  left: c === "tl" || c === "bl" ? 0 : w - bw,
  top: c === "tl" || c === "tr" ? 0 : h - bh,
  width: bw,
  height: bh,
});

/** Detail (luminance spread) of each corner box; lowest wins, earlier in `order` wins ties. */
async function emptiest(img: Buffer, order: Corner[], w: number, h: number, bw: number, bh: number): Promise<Corner> {
  let best = order[0]!;
  let bestDev = Number.POSITIVE_INFINITY;
  for (const c of order) {
    // stats() ignores pending pipeline steps, so materialize the crop first
    const crop = await sharp(img).extract(cornerBox(c, w, h, bw, bh)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const st = await sharp(crop.data, { raw: crop.info }).stats();
    const dev = st.channels[0]?.stdev ?? 0;
    if (dev < bestDev - 1e-6) {
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
  const from = { tl: [0, 0], tr: [w, 0], bl: [0, h], br: [w, h] }[corner];
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

  const markW = Math.round(w * MARK_WIDTH_FRACTION);
  const mark = await sharp(wordmark(), { density: 300 }).resize({ width: markW }).png().toBuffer();
  const markH = (await sharp(mark).metadata()).height ?? 0;
  const margin = Math.round(w * 0.015);
  const boxW = Math.min(w, markW + 2 * margin);
  const boxH = Math.min(h, markH + 2 * margin);

  // A third-party image keeps its own watermark: the mark goes to the corner with the least detail.
  const markCorner: Corner = opts.thirdParty
    ? await emptiest(resized, ["br", "bl", "tr", "tl"], w, h, boxW, boxH)
    : "br";

  const layers: OverlayOptions[] = [];
  if (target) {
    const others = (["tl", "tr", "bl", "br"] as Corner[]).filter((c) => c !== markCorner);
    const corner = await emptiest(resized, others, w, h, Math.round(w * 0.2), Math.round(h * 0.2));
    layers.push({ input: Buffer.from(overlaySvg(w, h, target, corner)), left: 0, top: 0 });
  }
  layers.push({
    input: mark,
    left: markCorner === "tl" || markCorner === "bl" ? margin : w - markW - margin,
    top: markCorner === "tl" || markCorner === "tr" ? margin : Math.max(0, h - markH - margin),
  });

  return sharp(resized).composite(layers).webp({ quality: 86 }).toBuffer();
}
