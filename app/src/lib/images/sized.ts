/**
 * Hotlinked art at the size it is shown (client-safe, pure; tested).
 *
 * The catalog stores the largest art each source offers (IGDB `t_1080p`, Steam 1920×1080
 * screenshots, SteamGridDB 3840×1240 PNG heroes), and a 112 px thumbnail must not download a 5 MB
 * hero. These CDNs serve smaller copies by URL, so the right size is picked here, at render time,
 * instead of going through Next's image optimizer (Vercel Hobby has a small transformation quota
 * and the art lives on other hosts). Unknown hosts pass through unchanged.
 *
 * - IGDB: the size token in the path (`t_screenshot_med`, `t_cover_big`, `t_720p`, `t_1080p`…).
 * - Steam screenshots: `ss_<hash>.1920x1080.jpg` also exists as `.600x338.jpg` and `.116x65.jpg`.
 * - SteamGridDB: `/hero/<id>.png` has an 850 px JPEG at `/hero_thumb/<id>.jpg` (wider boxes get the
 *   original through the image optimizer, OPTIMIZED_HERO_WIDTHS, never the PNG itself), `/grid/<id>.png`
 *   a 267×400 one at `/thumb/<id>.jpg`. A few transparent images keep their thumbnail in PNG only
 *   (most PNG originals do have the JPEG one, so the extension says nothing). The sync records it on
 *   the stored URL as the fragment `#png-thumb` (PNG_THUMB_HINT; the CDN never sees a fragment),
 *   and a JPEG thumbnail seen failing in this tab is remembered (`noteFailedImage`): both go
 *   straight to the PNG thumbnail, without a failed request. Otherwise `fallbacks` lists what an
 *   `onError` handler tries next: the PNG thumbnail (PNG originals), then the original.
 * - Steam library/store art (`library_hero.jpg`, `library_600x900.jpg`, `header.jpg`, capsules)
 *   has no smaller copy under the same path and passes through.
 */

export type SizedImage = {
  /** Smallest candidate that covers the requested width (also the src of browsers without srcset). */
  src: string;
  /** Width-described candidates; absent when the URL has a single size. */
  srcSet?: string;
  /**
   * When a candidate is a guessed thumbnail that may not exist: the URLs to try next, in order, for
   * an onError handler (plain src, no srcset). The last one is the original.
   */
  fallbacks?: string[];
};

/**
 * How the art is boxed: `wide` boxes take IGDB's 16:9 "screenshot" crops; `fit` (covers, portrait
 * boxes, inline images shown whole) takes its uncropped sizes.
 */
export type ArtShape = "wide" | "fit";

type Candidate = { url: string; width: number };

const IGDB = /^(https:\/\/images\.igdb\.com\/igdb\/image\/upload\/)t_[a-z0-9_]+(\/[A-Za-z0-9]+\.(?:jpg|png|webp))$/;
const STEAM_SCREENSHOT = /^(https:\/\/[a-z.]+\.steamstatic\.com\/.+\/ss_[0-9a-f]+)\.(?:\d+x\d+)(\.jpg(?:\?.*)?)$/;
const SGDB = /^(https:\/\/cdn2\.steamgriddb\.com\/(hero|grid)\/([0-9a-f]+)\.(png|jpe?g|webp))(#png-thumb)?$/;
const SGDB_JPEG_THUMB = /^https:\/\/cdn2\.steamgriddb\.com\/(?:hero_thumb|thumb)\/([0-9a-f]+)\.jpg$/;

/**
 * Widths the image optimizer makes of a SteamGridDB hero (WebP, Next's default device sizes and
 * quality). The originals are 3840 px PNGs of up to 8 MB: a 7.6 MB one made the game page's
 * largest paint take ~43 s on a throttled phone (Lighthouse, 07/11/2026). Lucas chose (07/11)
 * the light thumbnail for phones and the same art optimized for wider screens.
 */
export const OPTIMIZED_HERO_WIDTHS = [1200, 1920] as const;
/**
 * The game page's hero (its largest paint) takes optimizer copies at every width: WebP at 1200 px
 * is 52 KB against 124 KB for the 850 px JPEG thumbnail, and on a slow phone every KB delays it.
 * Cards and lists keep the CDN thumbnail (no optimizer work for each card of a list).
 */
const OPTIMIZED_LCP_WIDTHS = [640, 828, 1200, 1920] as const;
const SGDB_LOGO = /^https:\/\/cdn2\.steamgriddb\.com\/logo\/[0-9a-f]+\.png$/;
/** Logo widths: its box is at most 620 CSS px wide. */
const OPTIMIZED_LOGO_WIDTHS = [640, 1200] as const;
const OPTIMIZER_QUALITY = 75;

/** Next's image optimizer URL (`/_next/image`, Vercel's on deploy) for a remote image allowed in next.config. */
export function optimizedUrl(url: string, width: number): string {
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${OPTIMIZER_QUALITY}`;
}

/** Whether `url` is an image optimizer URL (a failed one means: use the CDN copies instead). */
export function isOptimizedUrl(url: string | undefined): boolean {
  return Boolean(url && /(?:^|\/\/[^/]+)\/_next\/image\?/.test(url));
}

/** Fragment the sync appends to a SteamGridDB URL whose thumbnail exists only in PNG. */
export const PNG_THUMB_HINT = "#png-thumb";

/** SteamGridDB ids whose JPEG thumbnail failed in this tab (client memory, never persisted). */
const pngOnly = new Set<string>();

/**
 * Called by image `onError` handlers with the URL that failed: a SteamGridDB JPEG thumbnail that
 * does not exist is remembered, so the next render of that art asks for the PNG one directly.
 */
export function noteFailedImage(src: string | undefined): void {
  const id = src?.match(SGDB_JPEG_THUMB)?.[1];
  if (id) pngOnly.add(id);
}

/**
 * IGDB sizes by box shape, with nominal widths: 16:9 crops ("lfill") for wide boxes; for `fit`, the
 * cover sizes and the 720p/1080p fit sizes (widths of a portrait cover; wide art comes wider).
 */
const IGDB_SIZES: Record<ArtShape, [token: string, width: number][]> = {
  wide: [
    // A 90 px square crop: only small thumbnails (96 × 60 lists) take it, a 7% upscale.
    ["t_thumb", 96],
    ["t_screenshot_med", 569],
    ["t_screenshot_big", 889],
    ["t_720p", 1280],
    ["t_1080p", 1920],
  ],
  fit: [
    ["t_cover_big", 264],
    ["t_cover_big_2x", 528],
    ["t_720p", 720],
    ["t_1080p", 1080],
  ],
};

function candidatesFor(
  url: string,
  shape: ArtShape,
  optimize: boolean,
): { list: Candidate[]; fallbacks?: string[] } | null {
  const igdb = url.match(IGDB);
  if (igdb) {
    return { list: IGDB_SIZES[shape].map(([token, width]) => ({ url: `${igdb[1]}${token}${igdb[2]}`, width })) };
  }
  const shot = url.match(STEAM_SCREENSHOT);
  if (shot) {
    return {
      list: [
        { url: `${shot[1]}.116x65${shot[2]}`, width: 116 },
        { url: `${shot[1]}.600x338${shot[2]}`, width: 600 },
        { url: `${shot[1]}.1920x1080${shot[2]}`, width: 1920 },
      ],
    };
  }
  const sgdb = url.match(SGDB);
  if (sgdb) {
    const [, original, kind, id, ext, hint] = sgdb;
    const folder = kind === "hero" ? "hero_thumb" : "thumb";
    const thumb = (type: string) => `https://cdn2.steamgriddb.com/${folder}/${id}.${type}`;
    const png = ext === "png" && (Boolean(hint) || pngOnly.has(id));
    const fallbacks = png ? [original] : ext === "png" ? [thumb("png"), original] : [original];
    const small = thumb(png ? "png" : "jpg");
    // The hero thumbnail is 850 px wide; it stands in up to 900 px boxes (a 6% upscale nobody sees).
    // Wider boxes get the original resized by the image optimizer, never the 3840 px PNG of up to
    // 8 MB. The grid one (267 px) stands in up to the 280 px case of the game page's intro, against
    // a 600 px PNG of up to 1 MB.
    if (kind === "hero" && optimize) {
      return {
        list: OPTIMIZED_LCP_WIDTHS.map((w) => ({ url: optimizedUrl(original, w), width: w })),
        // The optimizer out: the CDN's own copies, as for any hero.
        fallbacks: [small, ...fallbacks],
      };
    }
    return kind === "hero"
      ? {
          list: [
            { url: small, width: 900 },
            ...OPTIMIZED_HERO_WIDTHS.map((w) => ({ url: optimizedUrl(original, w), width: w })),
          ],
          fallbacks,
        }
      : { list: [{ url: small, width: 280 }, { url: original, width: 600 }], fallbacks };
  }
  return null;
}

/**
 * The URL (and srcset) of `url` for a box at most `width` CSS px wide. `src` covers `width` at
 * 1x; with `sizes` on the element, the browser picks from `srcSet` for the screen's density.
 */
export function sizedImage(
  url: string,
  width: number,
  shape: ArtShape = "wide",
  /** The page's largest paint: optimizer copies at every width where the original allows it. */
  optimize = false,
): SizedImage {
  const found = candidatesFor(url, shape, optimize);
  if (!found) return { src: url };
  const { list, fallbacks } = found;
  const src = (list.find((c) => c.width >= width) ?? list[list.length - 1]).url;
  // An optimizer copy as `src` falls back to the CDN's own smallest copy first.
  const fallbacksFor =
    isOptimizedUrl(src) && fallbacks && !isOptimizedUrl(list[0].url) ? [list[0].url, ...fallbacks] : fallbacks;
  return {
    src,
    srcSet: list.map((c) => `${c.url} ${c.width}w`).join(", "),
    ...(fallbacksFor ? { fallbacks: fallbacksFor } : {}),
  };
}

/** The single URL of `url` for a box at most `width` CSS px wide (for places without srcset). */
export function sizedUrl(url: string, width: number, shape: ArtShape = "wide"): string {
  return sizedImage(url, width, shape).src;
}

/**
 * A game's logo (the game page's <h1>): SteamGridDB's transparent PNGs (often 100 KB or more) go
 * through the image optimizer (WebP keeps the transparency) with the original as the fallback;
 * other logos (Steam's) pass through.
 */
export function logoImage(url: string): SizedImage {
  if (!SGDB_LOGO.test(url)) return { src: url };
  return {
    src: optimizedUrl(url, OPTIMIZED_LOGO_WIDTHS[0]),
    srcSet: OPTIMIZED_LOGO_WIDTHS.map((w) => `${optimizedUrl(url, w)} ${w}w`).join(", "),
    fallbacks: [url],
  };
}
