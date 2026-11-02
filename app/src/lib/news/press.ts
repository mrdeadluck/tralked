import { normalizeTitle } from "@/lib/integrations/title-match";

/*
 * Press headlines as readers see them (pure; tested): the publication's proper name and whether a
 * catalog game is really the subject of a title.
 */

/** Feeds whose configured name is not how the publication is known. Keys are normalized. */
const KNOWN_SOURCES: Record<string, string> = {
  "ign movies": "IGN",
  "ign tv": "IGN",
  "ign brasil": "IGN Brasil",
  "the verge ia": "The Verge",
  "the verge ai": "The Verge",
  "tecmundo": "TecMundo",
  "tecnoblog": "Tecnoblog",
  "canaltech": "Canaltech",
  "adrenaline": "Adrenaline",
  "animenew": "AnimeNew",
  "anime news network": "Anime News Network",
  "legiao dos herois": "Legião dos Heróis",
  "tom s hardware": "Tom's Hardware",
  "pc gamer": "PC Gamer",
  "eurogamer": "Eurogamer",
  "gamespot": "GameSpot",
  "polygon": "Polygon",
  "kotaku": "Kotaku",
  "the enemy": "The Enemy",
  "voxel": "Voxel",
  "jovem nerd": "Jovem Nerd",
};

/**
 * The publication's name for a byline: a known feed by its proper name ("IGN Movies" -> "IGN"),
 * otherwise the configured name without a section suffix ("Portal - Últimas notícias" -> "Portal",
 * "The Verge (IA)" -> "The Verge") and, when it was typed in capitals, in title case.
 */
export function pressSourceName(source: string): string {
  const base = source
    .replace(/\s*\([^)]*\)\s*$/, "")
    .split(/\s+[-–—|:]\s+/)[0]
    .trim();
  const known = KNOWN_SOURCES[normalizeTitle(source)] ?? KNOWN_SOURCES[normalizeTitle(base)];
  if (known) return known;
  if (!base) return source.trim();
  const letters = base.replace(/[^A-Za-zÀ-ÿ]/g, "");
  // "PORTAL EXEMPLO" -> "Portal Exemplo"; short acronyms ("IGN", "UOL") stay as they are.
  if (letters.length > 4 && letters === letters.toUpperCase()) {
    return base.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space: string, ch: string) => space + ch.toUpperCase());
  }
  return base;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `name` (a catalog name or alias) is named in `title`. Several words: as whole words,
 * ignoring case and punctuation. One word is often an ordinary word too ("Attack!" in "Attack on
 * Titan", "Control" in "take control"), so it must appear as written, punctuation included, or
 * capitalized ("DOOM" as "Doom").
 */
export function namesGame(title: string, name: string): boolean {
  const raw = name.trim();
  const normalized = normalizeTitle(raw);
  if (!normalized) return false;
  if (normalized.includes(" ")) return ` ${normalizeTitle(title)} `.includes(` ${normalized} `);
  const forms = new Set([raw, raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()]);
  return [...forms].some((form) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escape(form)}(?![\\p{L}\\p{N}])`, "u").test(title),
  );
}
