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
 * - Steam screenshots: `ss_<hash>.1920x1080.jpg` also exists as `.600x338.jpg`.
 * - SteamGridDB: `/hero/<id>.png` has an 850 px JPEG at `/hero_thumb/<id>.jpg`, `/grid/<id>.png`
 *   a 267×400 one at `/thumb/<id>.jpg`. A few transparent images keep their thumbnail in PNG, so
 *   `fallbacks` lists what an `onError` handler tries next: the PNG thumbnail (PNG originals), then
 *   the original.
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
const SGDB = /^https:\/\/cdn2\.steamgriddb\.com\/(hero|grid)\/([0-9a-f]+)\.(png|jpe?g|webp)$/;

/**
 * IGDB sizes by box shape, with nominal widths: 16:9 crops ("lfill") for wide boxes; for `fit`, the
 * cover sizes and the 720p/1080p fit sizes (widths of a portrait cover; wide art comes wider).
 */
const IGDB_SIZES: Record<ArtShape, [token: string, width: number][]> = {
  wide: [
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

function candidatesFor(url: string, shape: ArtShape): { list: Candidate[]; fallbacks?: string[] } | null {
  const igdb = url.match(IGDB);
  if (igdb) {
    return { list: IGDB_SIZES[shape].map(([token, width]) => ({ url: `${igdb[1]}${token}${igdb[2]}`, width })) };
  }
  const shot = url.match(STEAM_SCREENSHOT);
  if (shot) {
    return {
      list: [
        { url: `${shot[1]}.600x338${shot[2]}`, width: 600 },
        { url: `${shot[1]}.1920x1080${shot[2]}`, width: 1920 },
      ],
    };
  }
  const sgdb = url.match(SGDB);
  if (sgdb) {
    const [, kind, id, ext] = sgdb;
    const folder = kind === "hero" ? "hero_thumb" : "thumb";
    const thumb = (type: string) => `https://cdn2.steamgriddb.com/${folder}/${id}.${type}`;
    const fallbacks = ext === "png" ? [thumb("png"), url] : [url];
    // The hero thumbnail is 850 px wide; it stands in up to 900 px boxes (a 6% upscale nobody sees,
    // against a 3840 px PNG of up to 5 MB).
    return kind === "hero"
      ? { list: [{ url: thumb("jpg"), width: 900 }, { url, width: 1920 }], fallbacks }
      : { list: [{ url: thumb("jpg"), width: 267 }, { url, width: 600 }], fallbacks };
  }
  return null;
}

/**
 * The URL (and srcset) of `url` for a box at most `width` CSS px wide. `src` covers `width` at
 * 1x; with `sizes` on the element, the browser picks from `srcSet` for the screen's density.
 */
export function sizedImage(url: string, width: number, shape: ArtShape = "wide"): SizedImage {
  const found = candidatesFor(url, shape);
  if (!found) return { src: url };
  const { list, fallbacks } = found;
  const src = (list.find((c) => c.width >= width) ?? list[list.length - 1]).url;
  return {
    src,
    srcSet: list.map((c) => `${c.url} ${c.width}w`).join(", "),
    ...(fallbacks ? { fallbacks } : {}),
  };
}

/** The single URL of `url` for a box at most `width` CSS px wide (for places without srcset). */
export function sizedUrl(url: string, width: number, shape: ArtShape = "wide"): string {
  return sizedImage(url, width, shape).src;
}
