import { prisma } from "@/lib/db";

/**
 * Art for news without a game of its own (market, deals, layoffs): the most popular catalog game of
 * the company the headline names, so EA news shows an EA game and Ubisoft news an Ubisoft one.
 * Matched on the catalog's publisher or developer; only art the catalog already has (Steam CDN,
 * IGDB, SteamGridDB). The first company named in the text wins.
 */
export const COMPANIES: { pattern: RegExp; names: string[] }[] = [
  { pattern: /\bEA\b|Electronic Arts|BioWare|EA Sports/i, names: ["Electronic Arts"] },
  { pattern: /Ubisoft/i, names: ["Ubisoft"] },
  { pattern: /Rockstar|Take-Two|\bGTA\b/i, names: ["Rockstar Games"] },
  { pattern: /Blizzard|Warcraft|WoW|Diablo|Overwatch|Hearthstone|StarCraft/i, names: ["Blizzard"] },
  { pattern: /Activision|Call of Duty|CoD/i, names: ["Activision"] },
  { pattern: /Bethesda|id Software/i, names: ["Bethesda"] },
  { pattern: /\bXbox\b|Microsoft/i, names: ["Xbox Game Studios", "Microsoft"] },
  { pattern: /PlayStation|\bSony\b|Insomniac|Naughty Dog|Sucker Punch/i, names: ["PlayStation", "Sony Interactive"] },
  { pattern: /Nintendo/i, names: ["Nintendo"] },
  { pattern: /Capcom/i, names: ["CAPCOM"] },
  { pattern: /Square Enix/i, names: ["Square Enix"] },
  { pattern: /Bandai Namco/i, names: ["Bandai Namco"] },
  { pattern: /\bSega\b|Atlus/i, names: ["SEGA"] },
  { pattern: /Konami/i, names: ["Konami"] },
  { pattern: /CD Projekt/i, names: ["CD PROJEKT"] },
  { pattern: /Warner Bros/i, names: ["Warner Bros"] },
  { pattern: /Epic Games|Fortnite/i, names: ["Epic Games"] },
  { pattern: /\bValve\b|\bSteam\b/i, names: ["Valve"] },
  { pattern: /Riot Games/i, names: ["Riot Games"] },
  { pattern: /Krafton/i, names: ["KRAFTON"] },
  { pattern: /Paradox/i, names: ["Paradox"] },
  { pattern: /FromSoftware/i, names: ["FromSoftware"] },
];

/** IGDB serves several sizes by URL: wide art on the site uses the 1080p one (covers come at 264 px). */
export function wideArt(url: string): string {
  return url.replace(/(images\.igdb\.com\/igdb\/image\/upload\/)t_[a-z0-9_]+\//, "$1t_1080p/");
}

/** The companies named in `text`, in the order of COMPANIES (pure; tested). */
export function companiesIn(text: string): string[][] {
  return COMPANIES.filter((c) => c.pattern.test(text)).map((c) => c.names);
}

/** How many of the company's most popular games take turns as art (so 3 EA stories differ). */
const GALLERY_SIZE = 10;
/** How many of its games are checked for a name the article mentions. */
const MENTION_POOL = 60;

/** Stable small hash of a string (FNV-1a), to pick the same image for the same article every time. */
export function pickIndex(seed: string, size: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return size > 0 ? (h >>> 0) % size : 0;
}

const fold = (text: string) =>
  ` ${text
    .normalize("NFD")
    .replace(/[̀-ͯ™®©]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/**
 * The franchise part of a game name, as an article would write it: "STAR WARS™ Battlefront™ II" →
 * "star wars battlefront", "Mass Effect™ Legendary Edition" → "mass effect" (pure; tested).
 */
export function franchiseOf(name: string): string {
  const base = fold(name.split(/[:–—]| - /)[0])
    .replace(/ (legendary|deluxe|ultimate|complete|definitive|remastered|gold|standard) edition /g, " ")
    .replace(/ (edition|remastered|remake|hd|goty) /g, " ")
    .replace(/ ([0-9]+|i|ii|iii|iv|v|vi|vii|viii|ix|x) $/g, " ")
    .trim();
  return base.length >= 4 ? base : "";
}

type CompanyGames = { name: string; url: string }[];

/** The company's most popular games with wide art (publisher or developer), most popular first. */
async function companyGames(names: string[]): Promise<CompanyGames> {
  const games = await prisma.game.findMany({
    where: {
      stub: false,
      OR: [{ heroUrl: { startsWith: "https://" } }, { coverUrl: { startsWith: "https://" } }],
      AND: [
        {
          OR: names.flatMap((name) => [
            { publisher: { contains: name, mode: "insensitive" as const } },
            { developer: { contains: name, mode: "insensitive" as const } },
          ]),
        },
      ],
    },
    orderBy: { popularity: "desc" },
    take: MENTION_POOL,
    select: { name: true, heroUrl: true, coverUrl: true },
  });
  const seen = new Set<string>();
  return games.flatMap((g) => {
    const found = g.heroUrl ?? g.coverUrl;
    const url = found ? wideArt(found) : null;
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ name: g.name, url }];
  });
}

/** The images to take turns among: games the text mentions, else the company's top games. */
export function galleryFor(games: CompanyGames, text: string): string[] {
  const folded = fold(text);
  const mentioned = games.filter((g) => {
    const franchise = franchiseOf(g.name);
    return franchise !== "" && folded.includes(` ${franchise} `);
  });
  return (mentioned.length > 0 ? mentioned : games.slice(0, GALLERY_SIZE)).map((g) => g.url);
}

/**
 * Art for one article: one of the most popular games of the first company named in `text` that has
 * any, chosen by `seed` (the article slug), so each article keeps its image and articles alternate.
 */
export async function companyArt(text: string, seed: string): Promise<string | null> {
  for (const names of companiesIn(text)) {
    const gallery = galleryFor(await companyGames(names), text);
    if (gallery.length > 0) return gallery[pickIndex(seed, gallery.length)];
  }
  return null;
}

/**
 * Fills `imageUrl` of cards without one from the company their title or summary names. Each card
 * starts from its own pick (same as the article page); within one list a repeated image moves to the
 * next one of the company that is not on screen yet.
 */
export async function withCompanyArt<
  T extends { slug: string; title: string; excerpt: string | null; imageUrl: string | null },
>(cards: T[]): Promise<T[]> {
  const pools = new Map<string, Promise<CompanyGames>>();
  const used = new Set(cards.map((c) => c.imageUrl).filter(Boolean));
  const out: T[] = [];
  for (const card of cards) {
    const text = `${card.title} ${card.excerpt ?? ""}`;
    const names = card.imageUrl ? undefined : companiesIn(text)[0];
    if (!names) {
      out.push(card);
      continue;
    }
    const key = names.join("|");
    if (!pools.has(key)) pools.set(key, companyGames(names));
    const gallery = galleryFor(await pools.get(key)!, text);
    if (gallery.length === 0) {
      out.push(card);
      continue;
    }
    let index = pickIndex(card.slug, gallery.length);
    for (let tries = 0; tries < gallery.length && used.has(gallery[index]); tries++) index = (index + 1) % gallery.length;
    used.add(gallery[index]);
    out.push({ ...card, imageUrl: gallery[index] });
  }
  return out;
}
