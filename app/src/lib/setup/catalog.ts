/**
 * Player setup catalog (profile "Setup"): the platforms a player can mark as owned, grouped by
 * family, and the fields of the PC spec sheet. Client-safe (no database). Platform ids are stored
 * in `PlayerSetup.platforms`: never rename or reuse one; retire it by removing it (unknown ids are
 * dropped on read).
 */

export type SetupFamilyId = "playstation" | "xbox" | "nintendo" | "pc" | "mobile" | "sega" | "atari" | "retro";

export type SetupFamily = {
  id: SetupFamilyId;
  label: string;
  /** CSS color of the family's seals (tokens in globals.css). */
  color: string;
};

export type SetupPlatform = {
  id: string;
  family: SetupFamilyId;
  /** Full name, shown in the form and read by screen readers. */
  name: string;
  /** Short mark printed on the seal ("PS5", "N64", "Series X"). */
  code: string;
  /** Launch year (first release anywhere); left out for open platforms (PC, phones). */
  year?: number;
  /** Extra search terms ("nintendinho", "genesis"). */
  aliases?: string[];
};

export const SETUP_FAMILIES: SetupFamily[] = [
  { id: "playstation", label: "PlayStation", color: "var(--ps)" },
  { id: "xbox", label: "Xbox", color: "var(--xbox)" },
  { id: "nintendo", label: "Nintendo", color: "var(--nin)" },
  { id: "pc", label: "PC e portáteis PC", color: "var(--pc)" },
  { id: "mobile", label: "Celular", color: "var(--mobile)" },
  { id: "sega", label: "Sega", color: "var(--sega)" },
  { id: "atari", label: "Atari", color: "var(--atari)" },
  { id: "retro", label: "Retrô e outros", color: "var(--retro)" },
];

/** Every platform, by family and then by launch year (the order seals and checkboxes follow). */
export const SETUP_PLATFORMS: SetupPlatform[] = [
  // PlayStation
  { id: "ps1", family: "playstation", name: "PlayStation", code: "PS1", year: 1994, aliases: ["psone", "ps one", "playstation 1", "psx"] },
  { id: "ps2", family: "playstation", name: "PlayStation 2", code: "PS2", year: 2000 },
  { id: "psp", family: "playstation", name: "PlayStation Portable", code: "PSP", year: 2004, aliases: ["portatil"] },
  { id: "ps3", family: "playstation", name: "PlayStation 3", code: "PS3", year: 2006 },
  { id: "psvita", family: "playstation", name: "PlayStation Vita", code: "PS Vita", year: 2011, aliases: ["vita"] },
  { id: "ps4", family: "playstation", name: "PlayStation 4", code: "PS4", year: 2013, aliases: ["slim"] },
  { id: "ps4pro", family: "playstation", name: "PlayStation 4 Pro", code: "PS4 Pro", year: 2016 },
  { id: "psvr", family: "playstation", name: "PlayStation VR", code: "PS VR", year: 2016, aliases: ["realidade virtual"] },
  { id: "ps5", family: "playstation", name: "PlayStation 5", code: "PS5", year: 2020, aliases: ["slim", "digital"] },
  { id: "psvr2", family: "playstation", name: "PlayStation VR2", code: "PS VR2", year: 2023, aliases: ["realidade virtual"] },
  { id: "psportal", family: "playstation", name: "PlayStation Portal", code: "PS Portal", year: 2023, aliases: ["remote player"] },
  { id: "ps5pro", family: "playstation", name: "PlayStation 5 Pro", code: "PS5 Pro", year: 2024 },
  // Xbox
  { id: "xbox", family: "xbox", name: "Xbox", code: "Xbox", year: 2001, aliases: ["xbox classico", "original"] },
  { id: "xbox360", family: "xbox", name: "Xbox 360", code: "360", year: 2005 },
  { id: "xboxone", family: "xbox", name: "Xbox One", code: "One", year: 2013 },
  { id: "xboxones", family: "xbox", name: "Xbox One S", code: "One S", year: 2016 },
  { id: "xboxonex", family: "xbox", name: "Xbox One X", code: "One X", year: 2017 },
  { id: "xboxseriess", family: "xbox", name: "Xbox Series S", code: "Series S", year: 2020, aliases: ["xss"] },
  { id: "xboxseriesx", family: "xbox", name: "Xbox Series X", code: "Series X", year: 2020, aliases: ["xsx"] },
  // Nintendo
  { id: "nes", family: "nintendo", name: "NES (Nintendinho)", code: "NES", year: 1983, aliases: ["nintendinho", "famicom"] },
  { id: "gameboy", family: "nintendo", name: "Game Boy", code: "GB", year: 1989, aliases: ["gameboy", "pocket"] },
  { id: "snes", family: "nintendo", name: "Super Nintendo", code: "SNES", year: 1990, aliases: ["super famicom", "super nes"] },
  { id: "virtualboy", family: "nintendo", name: "Virtual Boy", code: "Virtual Boy", year: 1995 },
  { id: "n64", family: "nintendo", name: "Nintendo 64", code: "N64", year: 1996 },
  { id: "gbc", family: "nintendo", name: "Game Boy Color", code: "GBC", year: 1998, aliases: ["gameboy color"] },
  { id: "gba", family: "nintendo", name: "Game Boy Advance", code: "GBA", year: 2001, aliases: ["gameboy advance", "sp", "micro"] },
  { id: "gamecube", family: "nintendo", name: "GameCube", code: "GameCube", year: 2001, aliases: ["ngc", "game cube"] },
  { id: "nds", family: "nintendo", name: "Nintendo DS", code: "DS", year: 2004, aliases: ["ds lite", "dsi"] },
  { id: "wii", family: "nintendo", name: "Wii", code: "Wii", year: 2006 },
  { id: "n3ds", family: "nintendo", name: "Nintendo 3DS", code: "3DS", year: 2011, aliases: ["2ds", "new 3ds", "3ds xl"] },
  { id: "wiiu", family: "nintendo", name: "Wii U", code: "Wii U", year: 2012 },
  { id: "switch", family: "nintendo", name: "Nintendo Switch", code: "Switch", year: 2017, aliases: ["oled"] },
  { id: "switchlite", family: "nintendo", name: "Nintendo Switch Lite", code: "Switch Lite", year: 2019 },
  { id: "switch2", family: "nintendo", name: "Nintendo Switch 2", code: "Switch 2", year: 2025 },
  // PC
  { id: "pc", family: "pc", name: "PC (Windows ou Linux)", code: "PC", aliases: ["computador", "desktop", "notebook", "windows", "linux"] },
  { id: "mac", family: "pc", name: "Mac", code: "Mac", aliases: ["macbook", "apple", "macos"] },
  { id: "steamdeck", family: "pc", name: "Steam Deck", code: "Steam Deck", year: 2022, aliases: ["valve", "oled"] },
  { id: "rogally", family: "pc", name: "ROG Ally", code: "ROG Ally", year: 2023, aliases: ["asus"] },
  { id: "legiongo", family: "pc", name: "Lenovo Legion Go", code: "Legion Go", year: 2023, aliases: ["lenovo"] },
  { id: "msiclaw", family: "pc", name: "MSI Claw", code: "MSI Claw", year: 2024 },
  { id: "rogxboxally", family: "pc", name: "ROG Xbox Ally", code: "Xbox Ally", year: 2025, aliases: ["asus", "ally x"] },
  // Celular
  { id: "ios", family: "mobile", name: "iPhone e iPad (iOS)", code: "iOS", aliases: ["iphone", "ipad", "apple", "celular"] },
  { id: "android", family: "mobile", name: "Android", code: "Android", aliases: ["celular", "tablet"] },
  // Sega
  { id: "mastersystem", family: "sega", name: "Master System", code: "Master", year: 1986, aliases: ["tectoy"] },
  { id: "megadrive", family: "sega", name: "Mega Drive", code: "Mega Drive", year: 1988, aliases: ["genesis", "tectoy"] },
  { id: "gamegear", family: "sega", name: "Game Gear", code: "Game Gear", year: 1990 },
  { id: "segacd", family: "sega", name: "Sega CD", code: "Sega CD", year: 1991, aliases: ["mega cd"] },
  { id: "sega32x", family: "sega", name: "Sega 32X", code: "32X", year: 1994 },
  { id: "saturn", family: "sega", name: "Sega Saturn", code: "Saturn", year: 1994 },
  { id: "dreamcast", family: "sega", name: "Dreamcast", code: "Dreamcast", year: 1998 },
  // Atari
  { id: "atari2600", family: "atari", name: "Atari 2600", code: "2600", year: 1977, aliases: ["vcs"] },
  { id: "atari7800", family: "atari", name: "Atari 7800", code: "7800", year: 1986 },
  { id: "lynx", family: "atari", name: "Atari Lynx", code: "Lynx", year: 1989 },
  { id: "jaguar", family: "atari", name: "Atari Jaguar", code: "Jaguar", year: 1993 },
  // Retrô e outros
  { id: "pcengine", family: "retro", name: "PC Engine / TurboGrafx-16", code: "PC Engine", year: 1987, aliases: ["turbografx", "nec"] },
  { id: "neogeo", family: "retro", name: "Neo Geo", code: "Neo Geo", year: 1990, aliases: ["snk", "aes", "mvs"] },
  { id: "3do", family: "retro", name: "3DO", code: "3DO", year: 1993, aliases: ["panasonic"] },
  { id: "metaquest", family: "retro", name: "Meta Quest", code: "Quest", year: 2019, aliases: ["oculus", "realidade virtual", "vr"] },
  { id: "evercade", family: "retro", name: "Evercade", code: "Evercade", year: 2020, aliases: ["portatil"] },
  { id: "analoguepocket", family: "retro", name: "Analogue Pocket", code: "Analogue", year: 2021, aliases: ["fpga", "portatil"] },
  { id: "anbernic", family: "retro", name: "Anbernic", code: "Anbernic", aliases: ["rg35xx", "rg405", "portatil", "emulador"] },
  { id: "miyoo", family: "retro", name: "Miyoo Mini", code: "Miyoo", year: 2022, aliases: ["portatil", "emulador"] },
  { id: "retroid", family: "retro", name: "Retroid Pocket", code: "Retroid", aliases: ["portatil", "emulador"] },
  { id: "aynodin", family: "retro", name: "AYN Odin", code: "Odin", year: 2022, aliases: ["thor", "portatil", "emulador"] },
  { id: "playdate", family: "retro", name: "Playdate", code: "Playdate", year: 2022, aliases: ["panic", "manivela"] },
];

const PLATFORM_INDEX = new Map(SETUP_PLATFORMS.map((platform, index) => [platform.id, index]));

export const FAMILY_BY_ID = new Map(SETUP_FAMILIES.map((family) => [family.id, family]));

export function isSetupPlatformId(id: string): boolean {
  return PLATFORM_INDEX.has(id);
}

export function setupPlatform(id: string): SetupPlatform | undefined {
  const index = PLATFORM_INDEX.get(id);
  return index === undefined ? undefined : SETUP_PLATFORMS[index];
}

/** Known ids only, without repeats, in catalog order (how they are stored and shown). */
export function orderPlatformIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].filter(isSetupPlatformId).sort((a, b) => PLATFORM_INDEX.get(a)! - PLATFORM_INDEX.get(b)!);
}

export type SetupPlatformGroup = { family: SetupFamily; platforms: SetupPlatform[] };

/** The platforms grouped by family, in family order; families without platforms are left out. */
export function groupPlatforms(platforms: SetupPlatform[]): SetupPlatformGroup[] {
  return SETUP_FAMILIES.map((family) => ({ family, platforms: platforms.filter((p) => p.family === family.id) })).filter(
    (group) => group.platforms.length > 0,
  );
}

/** Lowercase, without accents or punctuation: "Mega Drive" and "megadrive" both fold to "megadrive". */
export function foldSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Whether the platform matches the search box (name, code, aliases or family). */
export function platformMatches(platform: SetupPlatform, query: string): boolean {
  const needle = foldSearch(query);
  if (needle === "") return true;
  const family = FAMILY_BY_ID.get(platform.family)?.label ?? "";
  return [platform.name, platform.code, family, ...(platform.aliases ?? [])].some((term) =>
    foldSearch(term).includes(needle),
  );
}

/** PC spec sheet fields, in display order. Values are short plain text. */
export const PC_FIELDS = [
  { key: "cpu", label: "Processador", group: "machine", placeholder: "Ryzen 7 7800X3D" },
  { key: "gpu", label: "Placa de vídeo", group: "machine", placeholder: "GeForce RTX 4070 Super 12 GB" },
  { key: "ram", label: "Memória", group: "machine", placeholder: "32 GB DDR5 6000 MHz" },
  { key: "storage", label: "Armazenamento", group: "machine", placeholder: "SSD NVMe 2 TB" },
  { key: "motherboard", label: "Placa-mãe", group: "machine", placeholder: "ASUS TUF B650M-Plus" },
  { key: "psu", label: "Fonte", group: "machine", placeholder: "750 W 80 Plus Gold" },
  { key: "case", label: "Gabinete", group: "machine", placeholder: "Lian Li O11 Mini" },
  { key: "monitor", label: "Monitor", group: "peripherals", placeholder: "27\" 1440p 165 Hz" },
  { key: "mouse", label: "Mouse", group: "peripherals", placeholder: "Logitech G Pro X Superlight" },
  { key: "keyboard", label: "Teclado", group: "peripherals", placeholder: "Mecânico 75%, switch marrom" },
  { key: "headset", label: "Headset", group: "peripherals", placeholder: "HyperX Cloud II" },
  { key: "controller", label: "Controle", group: "peripherals", placeholder: "DualSense Edge" },
] as const;

export type PcFieldKey = (typeof PC_FIELDS)[number]["key"];
export type PcFieldGroup = (typeof PC_FIELDS)[number]["group"];

export const PC_GROUP_LABEL: Record<PcFieldGroup, string> = {
  machine: "Máquina",
  peripherals: "Periféricos",
};

/** Filled fields only. */
export type PcSpecs = Partial<Record<PcFieldKey, string>>;

/** Longest value of a spec field (characters, after cleanup). */
export const SPEC_MAX = 80;
