import { createHash } from "node:crypto";
import sharp from "sharp";
import { BudgetExceededError, type Ai } from "../ai/client.js";
import { VISION_MAX_IMAGES, checkImages, type VisionVerdict } from "../ai/vision.js";
import type { MediaImage } from "../assemble.js";
import type { FetchFn } from "../collect/index.js";
import { mediaOf } from "../collect/media.js";
import type { Config, Source } from "../config.js";
import type { ItemRow, StoryRow } from "../db.js";
import type { GameMedia, Tralked } from "../tralked.js";
import { collectCandidates, fitsBody, fitsCover, isEligible, markRepeated, youtubeThumbnailId, type ImageCandidate } from "./candidates.js";
import { GALLERY_MAX, GALLERY_MIN } from "./gallery.js";
import { SAME_IMAGE_MAX_DISTANCE, fetchImage, hamming, type FetchedImage } from "./images.js";
import { isRecentVideo } from "./video.js";

export type ChooseDeps = {
  ai: Ai;
  config: Pick<Config, "MODEL_VISION">;
  fetchFn: FetchFn;
  tralked: Pick<Tralked, "uploadImage">;
  log?: (line: string) => void;
  /** `pnpm midia`: every candidate, its origin, size and whether it repeats across sites. */
  trace?: (line: string) => void;
};

/** Images downloaded per article at most (pages carry up to 16 each; big stories have 20+ sources). */
export const MAX_FETCHED = 48;
const FETCH_CONCURRENCY = 4;
/** Catalog pictures offered per article: a scene or two of the exact game is enough to mix in. */
const MAX_CATALOG = 2;
/** A gallery story: the vision check sees up to two batches of pictures. */
const GALLERY_VISION_MAX = 2 * VISION_MAX_IMAGES;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Xbox Wire", "Bethesda.net (oficial)": an official source's name as the company that owns it. */
const sourceCompany = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, "").trim();

/**
 * The credit of an image, always "Divulgação" (it is the company's material):
 * - official by origin (official page, official video, store, our catalog): "Divulgação/<Empresa>";
 * - a news site's copy, official because several sites carry it: "Divulgação/<Empresa>, via <Veículo>";
 * - no company known: "Divulgação, via <Veículo>" (an official page without one: "Divulgação/<Fonte>").
 * The link goes to the page the image came from; the catalog is ours and has none.
 */
export function creditFor(c: ImageCandidate, companies: string[]): { credit: string; creditUrl?: string } {
  const company = companies.map((x) => x.trim()).find(Boolean) ?? (c.origin === "fonte-oficial" ? sourceCompany(c.sourceName) : "");
  const via = c.origin === "fonte" || (!company && c.origin !== "catalogo");
  let credit = company ? `Divulgação/${company}` : "Divulgação";
  if (via && c.sourceName) credit += `, via ${c.sourceName}`;
  return c.origin === "catalogo" ? { credit } : { credit, creditUrl: c.sourceUrl };
}

/**
 * Downloads the candidates, most telling first: official pictures, video covers and every source's main
 * (og) image (the one sites share when they carry the same official picture), then article images.
 */
async function fetchAll(cands: ImageCandidate[], fetchFn: FetchFn): Promise<void> {
  const rank = (c: ImageCandidate) => (c.origin === "fonte" && c.role === "body" ? 1 : 0);
  const todo = cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .slice(0, MAX_FETCHED)
    .map((x) => x.c);
  let next = 0;
  const run = async () => {
    while (next < todo.length) {
      const c = todo[next++]!;
      const img = await fetchImage(c.url, fetchFn);
      if (img) c.image = img;
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, todo.length) }, run));
}

const same = (a: FetchedImage, b: FetchedImage) => hamming(a.hash, b.hash) <= SAME_IMAGE_MAX_DISTANCE;

/**
 * One candidate per picture: copies of one image (other sites, other sizes) collapse into the first one in
 * preference order, which takes the largest copy's bytes when its own is too small for a cover.
 */
export function distinctPictures(cands: ImageCandidate[]): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  for (const c of cands) {
    if (!c.image) continue;
    const twin = out.find((o) => same(o.image!, c.image!));
    if (!twin) out.push({ ...c });
    else if (!fitsCover(twin.image!) && fitsCover(c.image) && c.origin !== "catalogo" && twin.origin !== "catalogo") twin.image = c.image;
  }
  return out;
}

/** The catalog of the exact game as candidates: scenes first, rotated by story so its articles vary. */
export function catalogPool(catalog: GameMedia | null, storyId: number): { url: string; gameName: string }[] {
  if (!catalog) return [];
  const scenes = catalog.images.filter((i) => i.kind !== "hero");
  const rotated = scenes.length > 0 ? [...scenes.slice(storyId % scenes.length), ...scenes.slice(0, storyId % scenes.length)] : [];
  const heroes = catalog.images.filter((i) => i.kind === "hero");
  return [...rotated, ...heroes].slice(0, MAX_CATALOG).map((i) => ({ url: i.url, gameName: catalog.game.name }));
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The site's upload limit (`MAX_MEDIA_BYTES` in app/src/lib/api/media-upload.ts). */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const UPLOAD_MAX_WIDTH = 2560;

/** WebP under the site's upload limit (the site stores WebP anyway): smaller and lower quality until it fits. */
async function forUpload(bytes: Buffer): Promise<Buffer | null> {
  for (const [width, quality] of [
    [UPLOAD_MAX_WIDTH, 85],
    [UPLOAD_MAX_WIDTH, 70],
    [1920, 70],
  ] as const) {
    const out = await sharp(bytes).resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
    if (out.length <= UPLOAD_MAX_BYTES) return out;
  }
  return null;
}

async function host(c: ImageCandidate, deps: ChooseDeps): Promise<string | null> {
  const img = c.image!;
  const key = `noticia-img-${createHash("sha1").update(img.bytes).digest("hex")}`;
  try {
    const bytes = await forUpload(img.bytes);
    if (!bytes) throw new Error("imagem grande demais mesmo reduzida");
    return (await deps.tralked.uploadImage(new Uint8Array(bytes), "image/webp", key)).url;
  } catch (error) {
    deps.log?.(`envio de imagem falhou (${c.url}): ${errorMessage(error)}`);
    return null;
  }
}

/** Picks the official candidates the vision check sees: the first ones in order, plus a catalog scene. */
function forVision(pictures: ImageCandidate[], repeated: Set<string>, max: number): ImageCandidate[] {
  const eligible = pictures.filter((c) => isEligible(c, repeated) && fitsBody(c.image!));
  const official = eligible.filter((c) => c.origin !== "catalogo");
  const catalog = eligible.filter((c) => c.origin === "catalogo");
  const keepCatalog = Math.min(catalog.length, official.length > 0 ? 1 : MAX_CATALOG);
  return [...official.slice(0, max - keepCatalog), ...catalog.slice(0, keepCatalog)];
}

/** Videos whose covers the source pages carry, dated at most this many per article (one watch page each). */
const MAX_COVER_DATE_LOOKUPS = 3;

/**
 * The videos whose covers (YouTube thumbnails on the source pages) must not illustrate the story: published
 * long before it or of unknown date (B5: story 4929 would show the 2018 teaser). The official videos the
 * article embeds were checked already; covers beyond `MAX_COVER_DATE_LOOKUPS` videos count as stale.
 */
async function staleVideoCovers(
  input: { items: ItemRow[]; officialVideoIds: string[]; storyAt?: Date },
  fetchFn: FetchFn,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const item of input.items) {
    for (const image of mediaOf(item).images) {
      const id = youtubeThumbnailId(image.url);
      if (id && !input.officialVideoIds.includes(id)) ids.add(id);
    }
  }
  const stale = new Set<string>();
  if (ids.size === 0) return stale;
  const storyAt = input.storyAt ?? earliest(input.items);
  let lookups = 0;
  for (const id of ids) {
    if (lookups++ >= MAX_COVER_DATE_LOOKUPS || !(await isRecentVideo(id, storyAt, fetchFn))) stale.add(id);
  }
  return stale;
}

/** The earliest date among the items (published, else fetched). */
function earliest(items: ItemRow[]): Date {
  const times = items.map((i) => Date.parse(i.published_at ?? i.fetched_at)).filter((t) => !Number.isNaN(t));
  return new Date(times.length > 0 ? Math.min(...times) : Date.now());
}

/**
 * The article's images (spec "Escolher a imagem"):
 * - candidates from the sources, the official videos and the catalog of the exact game;
 * - only official ones (by origin or repeated across sites) go to one vision call;
 * - cover: the first approved that fits the cover frame;
 * - body: an approved catalog scene of the exact game, or else the next approved official picture (never
 *   the official video's cover: the player shows it), never a copy of the cover.
 * Every image is uploaded to the site (`POST /api/v1/media`); a failed upload costs only that image. A
 * vision failure costs the images; the subscription limit (`BudgetExceededError`) stops the run.
 */
export async function chooseImages(
  input: {
    story: Pick<StoryRow, "id" | "headline">;
    items: ItemRow[];
    sources: Source[];
    companies: string[];
    subject: string;
    catalog: GameMedia | null;
    /** Already checked (recent official videos): their covers may be candidates. */
    officialVideoIds: string[];
    /** When the story broke (its earliest item); defaults to its items' earliest date. */
    storyAt?: Date;
  },
  deps: ChooseDeps,
  opts: { gallery?: boolean } = {},
): Promise<{ cover?: MediaImage; bodyImage?: MediaImage; gallery?: MediaImage[] }> {
  const cands = collectCandidates({
    items: input.items,
    sources: input.sources,
    officialVideoIds: input.officialVideoIds,
    catalog: catalogPool(input.catalog, input.story.id),
    staleVideoIds: await staleVideoCovers(input, deps.fetchFn),
  });
  await fetchAll(cands, deps.fetchFn);
  const repeated = markRepeated(cands);
  for (const c of cands) {
    const size = c.image ? `${c.image.width}×${c.image.height}` : "não baixou";
    deps.trace?.(`candidata ${c.id} ${c.origin}${repeated.has(c.id) ? " repetida" : ""} (${c.sourceName}, ${size}): ${c.url}`);
  }
  const pictures = distinctPictures(cands);
  // A picture is repeated when any of its copies is.
  for (const p of pictures) if (cands.some((c) => repeated.has(c.id) && c.image && same(c.image, p.image!))) repeated.add(p.id);
  const sent = forVision(pictures, repeated, opts.gallery ? GALLERY_VISION_MAX : VISION_MAX_IMAGES);
  if (sent.length === 0) return {};

  const verdicts = new Map<string, VisionVerdict>();
  try {
    for (let i = 0; i < sent.length; i += VISION_MAX_IMAGES) {
      const batch = sent.slice(i, i + VISION_MAX_IMAGES);
      const answer = await checkImages(deps.ai, { subject: input.subject, headline: input.story.headline, candidates: batch }, { model: deps.config.MODEL_VISION });
      for (const [id, v] of answer) verdicts.set(id, v);
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    deps.log?.(`conferência de imagens falhou: ${errorMessage(error)}`);
    return {};
  }
  const approved = sent.filter((c) => verdicts.get(c.id)?.ok);
  for (const c of sent) {
    const v = verdicts.get(c.id);
    deps.log?.(`imagem ${c.id} (${c.origin}, ${c.sourceName}): ${v ? (v.ok ? "aprovada" : "recusada") : "sem resposta"}${v ? ` — ${v.depicts}; ${v.reason}` : ""}`);
  }

  const catalogCompanies = input.catalog?.game.publisher ? [input.catalog.game.publisher, ...input.companies] : input.companies;
  const toMedia = async (c: ImageCandidate): Promise<MediaImage | undefined> => {
    const url = await host(c, deps);
    if (!url) return undefined;
    const depicts = verdicts.get(c.id)?.depicts.trim();
    return {
      url,
      alt: capitalize(depicts || `Imagem de ${input.subject}`),
      ...creditFor(c, c.origin === "catalogo" ? catalogCompanies : input.companies),
    };
  };

  /** The first candidate of `list` whose upload works (a failed upload tries the next one). */
  const firstHosted = async (list: ImageCandidate[]): Promise<{ c: ImageCandidate; media: MediaImage } | null> => {
    for (const c of list) {
      const media = await toMedia(c);
      if (media) return { c, media };
    }
    return null;
  };

  const out: { cover?: MediaImage; bodyImage?: MediaImage } = {};
  const covers = [
    ...approved.filter((c) => c.origin !== "catalogo" && fitsCover(c.image!)),
    ...approved.filter((c) => c.origin === "catalogo" && fitsCover(c.image!)),
  ];
  const hostedCover = await firstHosted(covers);
  const coverCand = hostedCover?.c;
  if (hostedCover) out.cover = hostedCover.media;
  const rest = approved.filter((c) => c !== coverCand && c.origin !== "video-oficial" && !(coverCand && same(c.image!, coverCand.image!)));

  if (opts.gallery) {
    const picks = rest.filter((c) => c.origin !== "catalogo" && fitsBody(c.image!)).slice(0, GALLERY_MAX);
    if (picks.length >= GALLERY_MIN) {
      const gallery: MediaImage[] = [];
      for (const c of picks) {
        const m = await toMedia(c);
        if (m) gallery.push(m);
      }
      if (gallery.length >= GALLERY_MIN) return { ...out, gallery };
    }
  }

  // Without a cover, the body image is the article's first image, so the site's card: it must fit the cover frame.
  const fits = (c: ImageCandidate) => (out.cover ? fitsBody(c.image!) : fitsCover(c.image!));
  const hostedBody = await firstHosted([...rest.filter((c) => c.origin === "catalogo" && fits(c)), ...rest.filter((c) => c.origin !== "catalogo" && fits(c))]);
  if (hostedBody) out.bodyImage = hostedBody.media;
  return out;
}
