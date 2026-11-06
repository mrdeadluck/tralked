/**
 * Platform families of releases and of the console catalog import (Plano 4, F10), in the order the
 * UI shows them: Steam / PC first. The same keys as the catalog filters (`/jogos?plataforma=`).
 */
export const RELEASE_PLATFORMS = ["PC", "PLAYSTATION", "XBOX", "NINTENDO"] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];

export const RELEASE_PLATFORM_LABEL: Record<ReleasePlatform, string> = {
  PC: "PC",
  PLAYSTATION: "PlayStation",
  XBOX: "Xbox",
  NINTENDO: "Nintendo",
};

export const RELEASE_PLATFORM_COLOR: Record<ReleasePlatform, string> = {
  PC: "var(--pc)",
  PLAYSTATION: "var(--ps)",
  XBOX: "var(--xbox)",
  NINTENDO: "var(--nin)",
};

export function isReleasePlatform(value: string | undefined | null): value is ReleasePlatform {
  return (RELEASE_PLATFORMS as readonly string[]).includes(value ?? "");
}

/**
 * IGDB platform ids per family (IGDB `platforms`): PC = Windows; PlayStation 1–5, PSP and Vita;
 * every Xbox; Nintendo home and handheld consoles from the NES/Famicom to the Switch. Platforms
 * newer than this table (e.g. Switch 2) are looked up by name at run time (IGDB_EXTRA_PLATFORMS).
 */
export const IGDB_PLATFORM_FAMILY: Record<number, ReleasePlatform> = {
  6: "PC",
  7: "PLAYSTATION", // PlayStation
  8: "PLAYSTATION", // PlayStation 2
  9: "PLAYSTATION", // PlayStation 3
  48: "PLAYSTATION", // PlayStation 4
  167: "PLAYSTATION", // PlayStation 5
  38: "PLAYSTATION", // PSP
  46: "PLAYSTATION", // PS Vita
  11: "XBOX", // Xbox
  12: "XBOX", // Xbox 360
  49: "XBOX", // Xbox One
  169: "XBOX", // Xbox Series X|S
  130: "NINTENDO", // Switch
  41: "NINTENDO", // Wii U
  5: "NINTENDO", // Wii
  21: "NINTENDO", // GameCube
  4: "NINTENDO", // Nintendo 64
  19: "NINTENDO", // Super Nintendo
  58: "NINTENDO", // Super Famicom
  18: "NINTENDO", // NES
  99: "NINTENDO", // Famicom
  37: "NINTENDO", // 3DS
  137: "NINTENDO", // New 3DS
  20: "NINTENDO", // DS
  159: "NINTENDO", // DSi
  24: "NINTENDO", // Game Boy Advance
  33: "NINTENDO", // Game Boy
  22: "NINTENDO", // Game Boy Color
  87: "NINTENDO", // Virtual Boy
};

/** Platforms IGDB added after the table above, found by exact name (family by name prefix). */
export const IGDB_EXTRA_PLATFORMS: { name: string; family: ReleasePlatform }[] = [
  { name: "Nintendo Switch 2", family: "NINTENDO" },
];

/** Every platform id of the table above, for IGDB `where platform = (...)`. */
export const IGDB_PLATFORM_IDS = Object.keys(IGDB_PLATFORM_FAMILY).map(Number);

/**
 * Console slugs (IGDB platform slugs, `Game.consoles`) per IGDB platform id: the same platforms as
 * IGDB_PLATFORM_FAMILY, one slug each. Platforms newer than the table are left out.
 */
export const IGDB_PLATFORM_CONSOLE: Record<number, string> = {
  6: "pc",
  7: "ps1",
  8: "ps2",
  9: "ps3",
  48: "ps4",
  167: "ps5",
  38: "psp",
  46: "psvita",
  11: "xbox",
  12: "xbox360",
  49: "xboxone",
  169: "series-x-s",
  130: "switch",
  41: "wiiu",
  5: "wii",
  21: "gamecube",
  4: "n64",
  19: "snes",
  58: "super-famicom",
  18: "nes",
  99: "famicom",
  37: "3ds",
  137: "new-3ds",
  20: "nds",
  159: "dsi",
  24: "gba",
  33: "gb",
  22: "gbc",
  87: "virtualboy",
};

/** Console slugs of a list of IGDB platform ids (unknown ids dropped, no repeats), sorted. */
export function consolesOf(platformIds: number[]): string[] {
  return [...new Set(platformIds.map((id) => IGDB_PLATFORM_CONSOLE[id]).filter(Boolean))].sort();
}

/**
 * Console slug of a label a platform sync wrote ("PS4", "PSVITA", "Xbox 360"), or null when the
 * label names no single console ("Xbox", "PlayStation", a retro console).
 */
export function consoleOfLabel(label: string): string | null {
  const value = label.trim().toUpperCase().replace(/\s+/g, "");
  const table: Record<string, string> = {
    PS1: "ps1", PSX: "ps1", PS2: "ps2", PS3: "ps3", PS4: "ps4", PS5: "ps5", PSP: "psp", PSVITA: "psvita", VITA: "psvita",
    XBOX360: "xbox360", "360": "xbox360", XBOXONE: "xboxone", XBOXSERIES: "series-x-s", XBOXSERIESX: "series-x-s",
  };
  return table[value] ?? null;
}

/**
 * A Game.platforms list that holds console labels ("PS4", "Xbox") as families plus consoles:
 * `["PS4", "PC"]` -> platforms `["PC", "PLAYSTATION"]`, consoles `["ps4"]`. Labels naming no console
 * and no bare family ("Mega Drive", "Retro") stay as written; null when nothing needs changing.
 */
export function normalizeConsoleLabels(platforms: readonly string[]): { platforms: string[]; consoles: string[] } | null {
  const keep: string[] = [];
  const consoles: string[] = [];
  let changed = false;
  for (const label of platforms) {
    const console = consoleOfLabel(label);
    const family = console || label.trim().toUpperCase() === "XBOX" ? familyOfLabel(label) : null;
    if (!family || (RELEASE_PLATFORMS as readonly string[]).includes(label)) {
      keep.push(label);
      continue;
    }
    changed = true;
    keep.push(family);
    if (console) consoles.push(console);
  }
  if (!changed) return null;
  return { platforms: [...new Set(keep)].sort(), consoles: [...new Set(consoles)].sort() };
}

/** Families of a list of IGDB platform ids (unknown ids dropped), in display order. */
export function familiesOf(platformIds: number[], extra: Record<number, ReleasePlatform> = {}): ReleasePlatform[] {
  const found = new Set(platformIds.map((id) => IGDB_PLATFORM_FAMILY[id] ?? extra[id]).filter(Boolean));
  return RELEASE_PLATFORMS.filter((p) => found.has(p));
}

/** Family of a Game.platforms entry: a family key, or a label a platform sync wrote ("PS5", "Xbox One"). */
export function familyOfLabel(label: string): ReleasePlatform | null {
  const value = label.trim().toUpperCase();
  if ((RELEASE_PLATFORMS as readonly string[]).includes(value)) return value as ReleasePlatform;
  if (/^PS\d|PLAYSTATION|^PSP|VITA/.test(value)) return "PLAYSTATION";
  if (/XBOX/.test(value)) return "XBOX";
  if (/SWITCH|NINTENDO|WII|3DS|^DS|GAME ?BOY|GAMECUBE|N64|SNES|^NES|FAMICOM/.test(value)) return "NINTENDO";
  if (/^PC$|WINDOWS|STEAM/.test(value)) return "PC";
  return null;
}

/** Platform families printed on a game case's top band (the catalog filters' five). */
export type BandPlatform = ReleasePlatform | "RETRO";
const BAND_ORDER: BandPlatform[] = ["PC", "PLAYSTATION", "XBOX", "NINTENDO", "RETRO"];

/**
 * The band's words: full names while they fit next to the Tralked monogram on a 140 px case
 * (BAND_FIT characters, separators included), the short codes otherwise.
 */
const BAND_LONG: Record<BandPlatform, string> = { PC: "PC · Steam", PLAYSTATION: "PlayStation", XBOX: "Xbox", NINTENDO: "Nintendo", RETRO: "Retrô" };
const BAND_MID: Record<BandPlatform, string> = { ...BAND_LONG, PC: "PC" };
const BAND_SHORT: Record<BandPlatform, string> = { PC: "PC", PLAYSTATION: "PS", XBOX: "Xbox", NINTENDO: "NIN", RETRO: "Retrô" };
const BAND_FIT = 12;

export const BAND_NAME: Record<BandPlatform, string> = { ...RELEASE_PLATFORM_LABEL, RETRO: "Retrô" };

/**
 * A game's case band: its platform families in the filters' order, each with the label that fits.
 * `platforms` are Game.platforms entries (family keys or labels a sync wrote, "PS5", "SNES"); a
 * label of no known family (a retro console such as "Mega Drive", or "Retro") counts as Retrô.
 */
export function bandPlatforms(platforms: readonly string[]): { platform: BandPlatform; label: string }[] {
  const found = new Set<BandPlatform>();
  for (const p of platforms) {
    if (!p.trim()) continue;
    found.add(p.trim().toUpperCase() === "RETRO" ? "RETRO" : (familyOfLabel(p) ?? "RETRO"));
  }
  const ordered = BAND_ORDER.filter((p) => found.has(p));
  const width = (labels: Record<BandPlatform, string>) =>
    ordered.reduce((sum, p) => sum + labels[p].length, 0) + 3 * Math.max(0, ordered.length - 1);
  const labels = ordered.length === 1 ? BAND_LONG : width(BAND_MID) <= BAND_FIT ? BAND_MID : BAND_SHORT;
  return ordered.map((platform) => ({ platform, label: labels[platform] }));
}
