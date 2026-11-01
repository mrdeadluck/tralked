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
  { pattern: /Activision|Blizzard|Call of Duty/i, names: ["Activision", "Blizzard"] },
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

/** The companies named in `text`, in the order of COMPANIES (pure; tested). */
export function companiesIn(text: string): string[][] {
  return COMPANIES.filter((c) => c.pattern.test(text)).map((c) => c.names);
}

/** Wide art of the most popular game of the first company named in `text` that has any, or null. */
export async function companyArt(text: string): Promise<string | null> {
  for (const names of companiesIn(text)) {
    const game = await prisma.game.findFirst({
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
      select: { heroUrl: true, coverUrl: true },
    });
    const url = game?.heroUrl ?? game?.coverUrl;
    if (url) return url;
  }
  return null;
}

/** Fills `imageUrl` of cards without one from the company their title or summary names. */
export async function withCompanyArt<T extends { title: string; excerpt: string | null; imageUrl: string | null }>(
  cards: T[],
): Promise<T[]> {
  const cache = new Map<string, Promise<string | null>>();
  return Promise.all(
    cards.map(async (card) => {
      if (card.imageUrl) return card;
      const text = `${card.title} ${card.excerpt ?? ""}`;
      const key = JSON.stringify(companiesIn(text)[0] ?? null);
      if (key === "null") return card;
      if (!cache.has(key)) cache.set(key, companyArt(text));
      const imageUrl = await cache.get(key)!;
      return imageUrl ? { ...card, imageUrl } : card;
    }),
  );
}
