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

export const BAND_COLOR: Record<BandPlatform, string> = { ...RELEASE_PLATFORM_COLOR, RETRO: "var(--retro)" };

/**
 * The band's words by how many platforms share it, so every name fits a 140 px case: one platform
 * gets the full name, two keep readable names, three or more the short codes.
 */
const BAND_LABELS: Record<"one" | "two" | "many", Record<BandPlatform, string>> = {
  one: { PC: "PC · Steam", PLAYSTATION: "PlayStation", XBOX: "Xbox", NINTENDO: "Nintendo", RETRO: "Retrô" },
  two: { PC: "PC", PLAYSTATION: "PlayStation", XBOX: "Xbox", NINTENDO: "Nintendo", RETRO: "Retrô" },
  many: { PC: "PC", PLAYSTATION: "PS", XBOX: "Xbox", NINTENDO: "NIN", RETRO: "Retrô" },
};

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
  const labels = BAND_LABELS[ordered.length === 1 ? "one" : ordered.length === 2 ? "two" : "many"];
  return ordered.map((platform) => ({ platform, label: labels[platform] }));
}
