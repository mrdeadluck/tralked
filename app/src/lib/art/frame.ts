/**
 * Which of a game's images fits a box (client-safe, pure; tested).
 *
 * Every place that shows a game's art in a fixed shape (a case, a 16:10 card, a 21:9 article top,
 * a 112×64 thumb) asks here instead of taking the first URL and cropping it from the centre, which
 * cut logos (Mass Effect 2), heads (Tomb Raider) and screenshot captions. Each image is known by its
 * kind and proportion:
 *
 * - images with lettering (portrait covers, Steam capsules and headers, SteamGridDB grids, IGDB
 *   artworks) are used only when the box has nearly their proportion: cropping them cuts the text;
 * - clean images (heroes, screenshots) take a crop more easily;
 * - when no lettered image fits a wide box, a clean hero is shown with the game's transparent logo
 *   set whole over it (`logo`), so no box ever cuts a logo.
 */

export type ArtKind = "cover" | "capsule" | "header" | "hero" | "artwork" | "screenshot" | "logo";

/** One image of a game. `w`/`h` when known (stored by the sync); otherwise inferred from its URL. */
export type ArtAsset = { url: string; kind: ArtKind; w?: number | null; h?: number | null };

/**
 * What a box shows: one image (with where to crop), or a clean image with the logo over it.
 * `whole`: lettered art whose shape is near but not the box's own — shown whole (contained) over a
 * blurred copy of itself, since even a few percent cropped can cut a logo set near its edge.
 */
export type ArtPick = { url: string; kind: ArtKind; position?: string; logo?: string; whole?: boolean };

/** Width / height an image is known to have, by its stored size, its file name or its kind. */
export function artRatio(asset: ArtAsset): number | null {
  if (asset.w && asset.h) return asset.w / asset.h;
  const url = asset.url;
  const size = url.match(/[._/](\d{2,4})x(\d{2,4})(?:[._/]|$)/);
  if (size) return Number(size[1]) / Number(size[2]);
  if (/\/header\.(?:jpg|png)/.test(url)) return 460 / 215;
  if (/\/library_hero(?:_2x)?\.(?:jpg|png)/.test(url)) return 3840 / 1240;
  if (/\/library_capsule(?:_2x)?\.(?:jpg|png)|\/library_600x900/.test(url)) return 2 / 3;
  if (/cdn2\.steamgriddb\.com\/hero/.test(url)) return 1920 / 620;
  if (/cdn2\.steamgriddb\.com\/(?:grid|thumb)\//.test(url)) return 2 / 3;
  if (/images\.igdb\.com\/.*\/t_cover/.test(url)) return 264 / 374;
  if (/\/ss_[0-9a-f]+\./.test(url)) return 16 / 9;
  switch (asset.kind) {
    case "cover":
      return 2 / 3;
    case "capsule":
      return 616 / 353;
    case "header":
      return 460 / 215;
    case "hero":
      return 3840 / 1240;
    case "screenshot":
    case "artwork":
      return 16 / 9;
    default:
      return null;
  }
}

/** Kind of a stored image, reading Steam headers and capsules kept as "artwork" or "cover". */
export function artKindOf(kind: string, url: string): ArtKind | null {
  if (/\/header\.(?:jpg|png)/.test(url)) return "header";
  if (/\/capsule_(?:616x353|467x181|231x87|184x69|sm_120)\.(?:jpg|png)/.test(url)) return "capsule";
  if (/\/library_hero(?:_2x)?\.(?:jpg|png)/.test(url)) return "hero";
  const known: ArtKind[] = ["cover", "capsule", "header", "hero", "artwork", "screenshot", "logo"];
  return (known as string[]).includes(kind) ? (kind as ArtKind) : null;
}

/** Images with lettering: a crop of more than a few percent cuts their text. */
const LETTERED: ReadonlySet<ArtKind> = new Set(["cover", "capsule", "header", "artwork"]);

/** How far apart two proportions are (0 = same shape; 0.1 ≈ 10% of one side cropped away). */
const gap = (a: number, b: number) => Math.abs(Math.log(a / b));

/** Lettered art fits up to this gap (a 616×353 capsule in a 16:10 box: 0.087). */
const LETTERED_FIT = 0.12;
/** Clean art takes a crop up to this gap before it looks zoomed in (16:9 in 21:9: 0.27). */
const CLEAN_FIT = 0.45;

function pickIndex(seed: string, length: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % length;
}

/**
 * The image for a box of `ratio` (width / height), or null when the game has none (the caller
 * paints the generated art). Two uses:
 *
 * - `identity` (default; a game's card or case): lettered art of nearly the box's shape (the cover
 *   in a case, the capsule in a card), else the clean hero with the logo over it (wide boxes), else
 *   clean art of a near shape;
 * - `scene` (a news story about the game, whose headline sits on the image): the clean hero, else an
 *   official artwork of nearly the box's shape (whole), else screenshots (Steam's before IGDB's,
 *   varied by `seed`), else lettered art of nearly the box's shape.
 *
 * Last resort: the closest image (a portrait cover in a wide box has `kind: "cover"`, which the
 * caller shows whole). Images in `exclude` are skipped while another one is left.
 */
export function pickArt(
  assets: readonly ArtAsset[],
  ratio: number,
  {
    seed = "",
    exclude,
    mode = "identity",
  }: { seed?: string; exclude?: ReadonlySet<string>; mode?: "identity" | "scene" } = {},
): ArtPick | null {
  const all = assets.filter((a) => a.kind !== "logo" && a.url);
  const fresh = exclude ? all.filter((a) => !exclude.has(a.url)) : all;
  const pool = fresh.length > 0 ? fresh : all;
  if (pool.length === 0) return null;
  const logo = assets.find((a) => a.kind === "logo")?.url;
  const measured = pool.map((a) => ({ asset: a, d: gap(artRatio(a) ?? ratio, ratio) }));
  const at = (m: { asset: ArtAsset }, extra?: Partial<ArtPick>): ArtPick => ({
    url: m.asset.url,
    kind: m.asset.kind,
    ...(m.asset.kind === "hero" && { position: "center 35%" }),
    ...extra,
  });

  const letteredFit = () => {
    const fit = measured.filter((m) => LETTERED.has(m.asset.kind) && m.d <= LETTERED_FIT);
    // Kinds made for the shape go first: the capsule in a card, the cover in a case.
    const order: ArtKind[] = ratio < 1 ? ["cover", "capsule", "header", "artwork"] : ["capsule", "header", "artwork", "cover"];
    fit.sort((a, b) => order.indexOf(a.asset.kind) - order.indexOf(b.asset.kind) || a.d - b.d);
    return fit[0] ? at(fit[0], fit[0].d > 0.02 ? { whole: true } : {}) : null;
  };
  const cleanFit = () => {
    const fit = measured.filter((m) => !LETTERED.has(m.asset.kind) && m.d <= CLEAN_FIT);
    if (fit.length === 0) return null;
    // A hero is drawn to be cropped (no interface text, subject in the middle): it wins a close
    // call against a screenshot, whose captions and menus sit at the edges.
    const score = (m: (typeof fit)[number]) => m.d - (m.asset.kind === "hero" ? 0.1 : 0);
    const best = Math.min(...fit.map(score));
    const near = fit.filter((m) => score(m) <= best + 0.08);
    return at(near[pickIndex(seed, near.length)]);
  };
  // The clean hero (no text) cropped to the box, the transparent logo set whole over it.
  const heroWithLogo = () => {
    if (!logo || ratio < 1.2) return null;
    const heroes = measured.filter((m) => m.asset.kind === "hero").sort((a, b) => a.d - b.d);
    return heroes[0] ? at(heroes[0], { logo }) : null;
  };

  // A story's scene, official art first: the clean hero; an official artwork of nearly the box's
  // shape (shown whole); then screenshots, Steam's (chosen by the publisher, rarely with the game's
  // interface on screen) before IGDB's (often captures with menus and HUD).
  const sceneFit = () => {
    const heroes = measured.filter((m) => m.asset.kind === "hero" && m.d <= CLEAN_FIT).sort((a, b) => a.d - b.d);
    if (heroes[0]) return at(heroes[0]);
    const artworks = measured.filter((m) => m.asset.kind === "artwork" && m.d <= LETTERED_FIT);
    if (artworks.length > 0) {
      const chosen = artworks[pickIndex(seed, artworks.length)];
      return at(chosen, chosen.d > 0.02 ? { whole: true } : {});
    }
    const shots = measured.filter((m) => m.asset.kind === "screenshot" && m.d <= CLEAN_FIT);
    if (shots.length === 0) return null;
    const igdb = (m: (typeof shots)[number]) => /images\.igdb\.com/.test(m.asset.url);
    const steam = shots.filter((m) => !igdb(m));
    const pool = steam.length > 0 ? steam : shots;
    const best = Math.min(...pool.map((m) => m.d));
    const near = pool.filter((m) => m.d <= best + 0.08);
    return at(near[pickIndex(seed, near.length)]);
  };

  const pick = mode === "scene" ? (sceneFit() ?? cleanFit() ?? letteredFit()) : (letteredFit() ?? heroWithLogo() ?? cleanFit());
  if (pick) return pick;
  measured.sort((a, b) => a.d - b.d);
  return at(measured[0]);
}

/** A game's images from its columns and GameMedia rows (any order; duplicates dropped). */
export function artAssets(game: {
  coverUrl?: string | null;
  heroUrl?: string | null;
  logoUrl?: string | null;
  media?: readonly { kind: string; url: string | null; width?: number | null; height?: number | null }[];
}): ArtAsset[] {
  const out: ArtAsset[] = [];
  const add = (kind: string, url: string | null | undefined, w?: number | null, h?: number | null) => {
    if (!url || !/^https:\/\//.test(url) || out.some((a) => a.url === url)) return;
    const k = artKindOf(kind, url);
    if (k) out.push({ url, kind: k, w: w ?? null, h: h ?? null });
  };
  for (const m of game.media ?? []) add(m.kind, m.url, m.width, m.height);
  add("cover", game.coverUrl);
  add("hero", game.heroUrl);
  add("logo", game.logoUrl);
  return out;
}
