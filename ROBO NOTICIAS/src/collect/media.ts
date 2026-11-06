import { parseHTML } from "linkedom";
import type { ItemRow } from "../db.js";
import { youtubeIdOf } from "./youtube.js";

/**
 * The media a source page carries, read from the same HTML the text comes from: its share image and large
 * article images, the YouTube videos it embeds or links, and the X posts it embeds or links. The robot
 * picks the article's image, video and posts from these (src/media/).
 */
export type SourceImage = { url: string; width?: number; height?: number; role: "og" | "body" };
export type SourcePost = { url: string; handle: string; statusId: string };
export type SourceMedia = { images: SourceImage[]; youtube: string[]; posts: SourcePost[] };

const MAX_IMAGES = 16;
const MAX_VIDEOS = 5;
const MAX_POSTS = 5;
const BODY_MIN_WIDTH = 600;

const empty = (): SourceMedia => ({ images: [], youtube: [], posts: [] });

type Doc = ReturnType<typeof parseHTML>["document"];
type El = ReturnType<Doc["querySelector"]> & {};

function resolve(raw: string | null | undefined, base: string): string | null {
  const v = raw?.trim();
  if (!v || v.startsWith("data:")) return null;
  if (!URL.canParse(v, base)) return null;
  const u = new URL(v, base);
  return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
}

const int = (v: string | null | undefined): number | undefined => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function meta(document: Doc, selector: string): string | null {
  return document.querySelector(selector)?.getAttribute("content")?.trim() || null;
}

/** Not a picture of the subject: author avatars, icons, emoji, sprites, tracking pixels, placeholders. */
const NOT_A_PICTURE = /avatar|gravatar|icon|emoji|sprite|pixel|placeholder|spinner|badge/i;
/** A site's generic share picture (Steam News' "social_share_default"): never about the story. */
const DEFAULT_SHARE = /social_share_default|default[-_](share|og|social)|og[-_]default/i;
const IMAGE_FILE = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

/** An image inside a link to another page is a related-post thumbnail, not the article's picture. */
function linksElsewhere(img: El, base: string): boolean {
  const href = img.closest("a[href]")?.getAttribute("href");
  if (!href) return false;
  const target = resolve(href, base);
  if (!target || IMAGE_FILE.test(new URL(target).pathname)) return false;
  return target.split("#")[0] !== base.split("#")[0];
}

/** The largest `w` candidate of a srcset, when it has width descriptors. */
function biggestSrcset(srcset: string | null, base: string): { url: string; width: number } | null {
  let best: { url: string; width: number } | null = null;
  for (const part of (srcset ?? "").split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    const w = /^(\d+)w$/.exec(d ?? "")?.[1];
    const url = resolve(u, base);
    if (!url || !w) continue;
    const width = Number(w);
    if (!best || width > best.width) best = { url, width };
  }
  return best;
}

function bodyImage(img: El, base: string): SourceImage | null {
  const hint = [img.getAttribute("class"), img.getAttribute("alt"), img.getAttribute("src"), img.getAttribute("data-src")]
    .filter(Boolean)
    .join(" ");
  if (NOT_A_PICTURE.test(hint) || linksElsewhere(img, base)) return null;
  const src = resolve(img.getAttribute("src") ?? img.getAttribute("data-src") ?? img.getAttribute("data-lazy-src"), base);
  const set = biggestSrcset(img.getAttribute("srcset") ?? img.getAttribute("data-srcset"), base);
  const attrWidth = int(img.getAttribute("width"));
  const height = int(img.getAttribute("height"));
  if (set && set.width > (attrWidth ?? 0)) {
    return set.width >= BODY_MIN_WIDTH ? { url: set.url, width: set.width, role: "body" } : null;
  }
  if (!src || (attrWidth !== undefined && attrWidth < BODY_MIN_WIDTH)) return null;
  // No size in the HTML (lazy-loaded pictures): kept, and measured when fetched.
  if (attrWidth === undefined) return { url: src, role: "body" };
  return { url: src, width: attrWidth, ...(height ? { height } : {}), role: "body" };
}

const X_STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/i;
const X_NOT_A_PROFILE = new Set(["i", "intent", "share", "hashtag", "home", "search", "explore", "settings"]);

function xPostOf(href: string | null): SourcePost | null {
  const m = X_STATUS.exec(href?.trim() ?? "");
  if (!m) return null;
  const [, handle, statusId] = m as unknown as [string, string, string];
  if (X_NOT_A_PROFILE.has(handle.toLowerCase())) return null;
  return { url: `https://x.com/${handle}/status/${statusId}`, handle, statusId };
}

/**
 * Reads the media of a source page. Parses its own document (Readability mutates the one it reads), so it
 * can run on the same HTML as `extractText`. Never throws: a broken page has no media.
 */
export function extractMedia(html: string, pageUrl: string): SourceMedia {
  if (!html.trim()) return empty();
  try {
    const { document } = parseHTML(html);
    const media = empty();
    const seenImages = new Set<string>();
    const addImage = (img: SourceImage | null) => {
      if (!img || seenImages.has(img.url) || DEFAULT_SHARE.test(img.url) || media.images.length >= MAX_IMAGES) return;
      seenImages.add(img.url);
      media.images.push(img);
    };

    const og = resolve(meta(document, 'meta[property="og:image"]') ?? meta(document, 'meta[property="og:image:url"]'), pageUrl);
    if (og) {
      const width = int(meta(document, 'meta[property="og:image:width"]'));
      const height = int(meta(document, 'meta[property="og:image:height"]'));
      addImage({ url: og, ...(width ? { width } : {}), ...(height ? { height } : {}), role: "og" });
    } else {
      const tw = resolve(meta(document, 'meta[name="twitter:image"]') ?? meta(document, 'meta[property="twitter:image"]'), pageUrl);
      if (tw) addImage({ url: tw, role: "og" });
    }

    const containers = Array.from(document.querySelectorAll("article, main"));
    const imgs = new Set<El>();
    for (const c of containers) for (const img of Array.from(c.querySelectorAll("img"))) imgs.add(img);
    for (const img of imgs) addImage(bodyImage(img, pageUrl));

    const ids = new Set<string>();
    const addVideo = (url: string | null) => {
      const id = url ? youtubeIdOf(url) : null;
      if (id && !ids.has(id) && ids.size < MAX_VIDEOS) ids.add(id);
    };
    // Videos and posts of the article only: sidebars, "latest trailers" and footers are about other things.
    const within = (selector: string) => containers.flatMap((c) => Array.from(c.querySelectorAll(selector)));
    for (const f of within("iframe")) addVideo(resolve(f.getAttribute("src") ?? f.getAttribute("data-src"), pageUrl));
    for (const a of within("a[href]")) addVideo(resolve(a.getAttribute("href"), pageUrl));
    media.youtube = [...ids];

    const posts = new Map<string, SourcePost>();
    const addPost = (href: string | null) => {
      const p = xPostOf(href);
      if (p && !posts.has(p.statusId) && posts.size < MAX_POSTS) posts.set(p.statusId, p);
    };
    for (const a of within('blockquote.twitter-tweet a[href*="/status/"]')) addPost(a.getAttribute("href"));
    for (const a of within("a[href]")) addPost(a.getAttribute("href"));
    media.posts = [...posts.values()];
    return media;
  } catch {
    return empty();
  }
}

function isMedia(v: unknown): v is SourceMedia {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o["images"]) && Array.isArray(o["youtube"]) && Array.isArray(o["posts"]);
}

/** The stored media of an item; empty when none was read or the JSON is not media. */
export function mediaOf(item: Pick<ItemRow, "media_json">): SourceMedia {
  if (!item.media_json) return empty();
  try {
    const v: unknown = JSON.parse(item.media_json);
    return isMedia(v) ? v : empty();
  } catch {
    return empty();
  }
}
