import { mediaOf } from "../collect/media.js";
import type { Source } from "../config.js";
import type { ItemRow } from "../db.js";
import { SAME_IMAGE_MAX_DISTANCE, hamming, type FetchedImage } from "./images.js";

/**
 * Where a candidate image came from. Only `fonte` (a news site's own page) needs the repetition signal to
 * count as official; the others are official by origin (the spec's rule 2) or ours (`catalogo`).
 */
export type ImageOrigin = "fonte-oficial" | "fonte" | "video-oficial" | "loja" | "catalogo";

export type ImageCandidate = {
  id: string;
  url: string;
  origin: ImageOrigin;
  /** The outlet that carried it ("IGN", "Xbox Wire"); "YouTube" for a video cover; "Tralked" for the catalog. */
  sourceName: string;
  /** The page it came from: the credit links there. */
  sourceUrl: string;
  /** The site of that page, without "www.": two hosts carrying one picture make it a repetition. */
  host: string;
  /** The page's main (og) image or one of its article images; absent for videos and the catalog. */
  role?: "og" | "body";
  image?: FetchedImage;
};

/** "news.xbox.com" → "xbox.com"; "img.uol.com.br" → "uol.com.br". */
function siteOf(host: string): string {
  const parts = host.toLowerCase().split(".");
  const two = parts.slice(-2).join(".");
  return /^(com|co|org|net|gov|edu)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join(".") : two;
}

/** CDNs official sites serve their own pictures from, by the official site. */
const OFFICIAL_CDNS: Record<string, RegExp> = {
  "steampowered.com": /(^|\.)steamstatic\.com$/,
  "xbox.com": /(^|\.)thesourcemediaassets\.com$|(^|\.)xboxservices\.com$/,
  "rockstargames.com": /^media-rockstargames-com\.akamaized\.net$/,
  "playstation.com": /(^|\.)playstation\.(com|net)$/,
};

/** An official page's own picture: on its own site or on that site's known CDN (not a press article it reposts). */
export function ownPicture(pageUrl: string, imageUrl: string): boolean {
  if (!URL.canParse(pageUrl) || !URL.canParse(imageUrl)) return false;
  const page = siteOf(new URL(pageUrl).hostname);
  const image = new URL(imageUrl).hostname.toLowerCase();
  return siteOf(image) === page || (OFFICIAL_CDNS[page]?.test(image) ?? false);
}

const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : url);
const isHttps = (url: string): boolean => URL.canParse(url) && new URL(url).protocol === "https:";
/** Steam store art, wherever a page put it: the store's own material. */
const isStoreAsset = (url: string): boolean => {
  if (!URL.canParse(url)) return false;
  const u = new URL(url);
  return /(^|\.)steamstatic\.com$/.test(u.hostname) && u.pathname.includes("/store_item_assets/");
};

/**
 * Every image the article could use, in order of preference: official source pages, official video
 * covers, other news sites, Steam store art found on the pages, then the catalog of the exact game.
 * The images are not fetched here (`image` is filled later). Only https, no URL twice.
 */
export function collectCandidates(input: {
  items: ItemRow[];
  sources: Source[];
  officialVideoIds: string[];
  catalog: { url: string; gameName: string }[];
}): ImageCandidate[] {
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const official: ImageCandidate[] = [];
  const other: ImageCandidate[] = [];
  const store: ImageCandidate[] = [];
  const seen = new Set<string>();
  const fresh = (url: string) => {
    if (!isHttps(url) || seen.has(url)) return false;
    seen.add(url);
    return true;
  };

  for (const item of input.items) {
    const source = byId.get(item.source_id);
    const sourceName = item.publisher?.trim() || source?.name.replace(/\s*\((via|YouTube)[^)]*\)\s*$/i, "") || hostOf(item.url);
    const host = hostOf(item.url);
    for (const image of mediaOf(item).images) {
      if (!fresh(image.url)) continue;
      const base = { url: image.url, sourceName, sourceUrl: item.url, host, role: image.role };
      if (isStoreAsset(image.url)) store.push({ ...base, id: "", origin: "loja" });
      // Official feeds through Google News (Rockstar Newswire, Nintendo IR) count too: the item's URL is the official page.
      else if (source?.tier === "oficial" && ownPicture(item.url, image.url)) official.push({ ...base, id: "", origin: "fonte-oficial" });
      else other.push({ ...base, id: "", origin: "fonte" });
    }
  }

  const videos: ImageCandidate[] = input.officialVideoIds.flatMap((id) => {
    const url = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
    return fresh(url)
      ? [{ id: "", url, origin: "video-oficial" as const, sourceName: "YouTube", sourceUrl: `https://www.youtube.com/watch?v=${id}`, host: "youtube.com" }]
      : [];
  });
  const catalog: ImageCandidate[] = input.catalog.flatMap((c) =>
    fresh(c.url) ? [{ id: "", url: c.url, origin: "catalogo" as const, sourceName: "Tralked", sourceUrl: c.url, host: hostOf(c.url) }] : [],
  );

  return [...official, ...videos, ...other, ...store, ...catalog].map((c, i) => ({ ...c, id: `img${i + 1}` }));
}

/** Ids of the candidates whose picture (by fingerprint, not URL) also appears on another host. */
export function markRepeated(cands: ImageCandidate[]): Set<string> {
  const out = new Set<string>();
  const fetched = cands.filter((c) => c.image);
  for (let i = 0; i < fetched.length; i++) {
    for (let j = i + 1; j < fetched.length; j++) {
      const a = fetched[i]!;
      const b = fetched[j]!;
      if (siteOf(a.host) === siteOf(b.host)) continue; // br.ign.com and ign.com are one outlet
      if (hamming(a.image!.hash, b.image!.hash) <= SAME_IMAGE_MAX_DISTANCE) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
}

/** Official enough to go to the vision check: official by origin, or repeated across sites. */
export const isEligible = (c: ImageCandidate, repeated: Set<string>): boolean => c.origin !== "fonte" || repeated.has(c.id);

export const COVER_MIN_WIDTH = 1000;
export const COVER_MIN_RATIO = 1.3;
export const COVER_MAX_RATIO = 2.4;
/** Above this share in one flat tone, the picture is an empty frame in the site's cover box. */
export const COVER_MAX_BLANK = 0.85;
export const BODY_MIN_WIDTH = 600;

/** Fits the site's cover frame: wide, landscape without being a strip, and not mostly empty. */
export function fitsCover(img: FetchedImage): boolean {
  const ratio = img.width / img.height;
  return img.width >= COVER_MIN_WIDTH && ratio >= COVER_MIN_RATIO && ratio <= COVER_MAX_RATIO && img.blank <= COVER_MAX_BLANK;
}

export const fitsBody = (img: FetchedImage): boolean => img.width >= BODY_MIN_WIDTH;
