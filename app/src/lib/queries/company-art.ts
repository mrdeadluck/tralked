import { acervoFor } from "@/lib/news/acervo";

/**
 * Art for news without a game or an image of its own (market, deals, layoffs, consoles): the official
 * picture of the console or company the headline names (lib/news/acervo.ts). Never the art of one of the
 * company's games: "EA fecha a BioWare" showing FIFA was the wrong subject (spec 2026-11-05).
 */

/** IGDB serves several sizes by URL: wide art on the site uses the 1080p one (covers come at 264 px). */
export function wideArt(url: string): string {
  return url.replace(/(images\.igdb\.com\/igdb\/image\/upload\/)t_[a-z0-9_]+\//, "$1t_1080p/");
}

/** Stable small hash of a string (FNV-1a), to pick the same image for the same article every time. */
export function pickIndex(seed: string, size: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return size > 0 ? (h >>> 0) % size : 0;
}

/** Art for one article page: the official picture of the console or company `text` names first, or null. */
export async function companyArt(text: string): Promise<string | null> {
  return acervoFor(text)?.url ?? null;
}

/**
 * Gives cards without an image the official picture of the console or company their title or summary
 * names, as their own image (`imageUrl` and `wideImageUrl`, no game `art`), like an article that brings one.
 */
export async function withCompanyArt<
  T extends { slug: string; title: string; excerpt: string | null; imageUrl: string | null; wideImageUrl?: string | null },
>(cards: T[]): Promise<T[]> {
  return cards.map((card) => {
    if (card.imageUrl) return card;
    const found = acervoFor(`${card.title} ${card.excerpt ?? ""}`);
    return found ? { ...card, imageUrl: found.url, wideImageUrl: found.url, art: null } : card;
  });
}
