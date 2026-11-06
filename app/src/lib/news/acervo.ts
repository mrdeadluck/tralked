/**
 * The official picture of a console or a company (app/public/acervo/), for news about it that brings no
 * image of its own and has no game: "PS5 vendeu tanto", "EA fecha a BioWare". Never the art of one of the
 * company's games (spec 2026-11-05, "Consoles e empresas"). Every file is the company's own material,
 * 1600×900 WebP; pictures that were not 16:9 sit centered on their own border colour (or a blurred copy of
 * themselves), never cropped. Lucas checked the set once before it went live.
 *
 * Where each picture came from (the og:image or asset of the official page, downloaded 05/11/2026):
 * - ps5: playstation.com/en-us/ps5 (gmedia.playstation.com ps5-product-thumbnail-01-en-14sep21)
 * - ps5-pro: playstation.com/en-us/ps5/ps5-pro (ps5-pro-dualsense-image-block-01-en-16aug24)
 * - xbox-series: xbox.com/en-US/consoles (Console-Hub_Content-Placement 642227-3)
 * - switch-2: nintendo.com/jp/hardware/switch2 (sns.png)
 * - steam-deck: steamdeck.com (steamdeck/images/oled/social_media_image.jpg)
 * - playstation: playstation.com/en-us/corporate/about-us (ps-default-listing-thumb-05oct20)
 * - xbox: the official Xbox YouTube channel's picture (youtube.com/@Xbox)
 * - nintendo: nintendo.com/us (ncom/global/social-share.jpg)
 * - valve-steam: store.steampowered.com/about (store/about/social-og.jpg)
 * - ea: ea.com/about (ea-about-featured-image.jpg)
 * - ubisoft: ubisoft.com (ubi-share.jpg)
 * - rockstar: the official Rockstar Games YouTube channel's picture (youtube.com/@RockstarGames)
 * - take-two: take2games.com (T2_OG_Img_1200x630.jpg)
 * - bethesda: the official Bethesda YouTube channel's picture (youtube.com/@bethesda)
 * - capcom: capcom-games.com (common/images/common/share.png)
 * - square-enix: square-enix-games.com (selogo_onwhite.jpg)
 * - sega: sega.co.jp/en (common/images/ogp_image.png)
 * - bandai-namco: bandainamcoent.com (open-graph.webp)
 * - epic: epicgames.com (epic-games-social-share-1200x675)
 * - blizzard: blizzard.com (thumbnail-home.jpg)
 * - activision: activisionblizzard.com (activision-blizzard-share.png)
 * - cd-projekt: cdprojekt.com/en (og-3.png)
 * - konami: konami.com/games/us/en (ogp_top.jpg)
 * - warner-bros-games: wbgames.com (static/wb-games-logo-h.svg, on a dark background)
 * - riot: riotgames.com (meta-icon-1000x1000.jpg)
 * - krafton: krafton.com/en/about (ogimage.jpg)
 * - embracer: embracer.com (Embracer_delningsbild_1200x628.png)
 * - itch-io: itch.io/press-kit (static.itch.io/images/logo-white-new.svg, on itch.io red)
 */

export type AcervoEntry = { key: string; pattern: RegExp; file: string; alt: string; credit: string };

/** Consoles, in the order they are tried (a "PS5 Pro" is not a "PS5"). A console in the text wins over any company. */
const CONSOLES: AcervoEntry[] = [
  { key: "ps5-pro", pattern: /\bPS5 Pro\b|PlayStation 5 Pro/i, file: "ps5-pro.webp", alt: "PlayStation 5 Pro e controle DualSense", credit: "Divulgação/PlayStation" },
  { key: "ps5", pattern: /\bPS5\b|PlayStation 5/i, file: "ps5.webp", alt: "PlayStation 5 e controle DualSense", credit: "Divulgação/PlayStation" },
  { key: "xbox-series", pattern: /Xbox Series|Series [XS]\b|\bXSX\b/i, file: "xbox-series.webp", alt: "Consoles Xbox Series X com controles", credit: "Divulgação/Xbox" },
  { key: "switch-2", pattern: /Switch ?2\b/i, file: "switch-2.webp", alt: "Nintendo Switch 2 com os Joy-Con", credit: "Divulgação/Nintendo" },
  { key: "steam-deck", pattern: /Steam Deck/i, file: "steam-deck.webp", alt: "Steam Deck OLED", credit: "Divulgação/Valve" },
];

/** Companies: the one the text names first wins. Their best-known studios and series count as them. */
const COMPANIES: AcervoEntry[] = [
  { key: "playstation", pattern: /PlayStation|\bSony\b|\bPS Plus\b|\bPS[1-6]\b|Insomniac|Naughty Dog|Sucker Punch/i, file: "playstation.webp", alt: "Logotipo do PlayStation", credit: "Divulgação/PlayStation" },
  { key: "xbox", pattern: /\bXbox\b|Microsoft|Game Pass/i, file: "xbox.webp", alt: "Logotipo do Xbox", credit: "Divulgação/Xbox" },
  { key: "nintendo", pattern: /Nintendo|\bSwitch\b/i, file: "nintendo.webp", alt: "Logotipo da Nintendo", credit: "Divulgação/Nintendo" },
  { key: "valve-steam", pattern: /\bValve\b|\bSteam\b/i, file: "valve-steam.webp", alt: "Logotipo do Steam", credit: "Divulgação/Valve" },
  { key: "ea", pattern: /\bEA\b|Electronic Arts|BioWare|EA Sports/i, file: "ea.webp", alt: "Logotipo da Electronic Arts", credit: "Divulgação/Electronic Arts" },
  { key: "ubisoft", pattern: /Ubisoft/i, file: "ubisoft.webp", alt: "Logotipo da Ubisoft", credit: "Divulgação/Ubisoft" },
  { key: "rockstar", pattern: /Rockstar|\bGTA\b|Grand Theft Auto/i, file: "rockstar.webp", alt: "Logotipo da Rockstar Games", credit: "Divulgação/Rockstar Games" },
  { key: "take-two", pattern: /Take-?Two/i, file: "take-two.webp", alt: "Logotipo da Take-Two Interactive", credit: "Divulgação/Take-Two" },
  { key: "bethesda", pattern: /Bethesda|id Software|ZeniMax/i, file: "bethesda.webp", alt: "Logotipo da Bethesda", credit: "Divulgação/Bethesda" },
  { key: "capcom", pattern: /Capcom/i, file: "capcom.webp", alt: "Logotipo da Capcom", credit: "Divulgação/Capcom" },
  { key: "square-enix", pattern: /Square Enix/i, file: "square-enix.webp", alt: "Logotipo da Square Enix", credit: "Divulgação/Square Enix" },
  { key: "sega", pattern: /\bSega\b|\bAtlus\b/i, file: "sega.webp", alt: "Logotipo da Sega", credit: "Divulgação/Sega" },
  { key: "bandai-namco", pattern: /Bandai Namco/i, file: "bandai-namco.webp", alt: "Logotipo da Bandai Namco", credit: "Divulgação/Bandai Namco" },
  { key: "epic", pattern: /Epic Games|Fortnite/i, file: "epic.webp", alt: "Logotipo da Epic Games", credit: "Divulgação/Epic Games" },
  { key: "blizzard", pattern: /Blizzard|Warcraft|Diablo|Overwatch|Hearthstone|StarCraft/i, file: "blizzard.webp", alt: "Logotipo da Blizzard Entertainment", credit: "Divulgação/Blizzard" },
  { key: "activision", pattern: /Activision|Call of Duty/i, file: "activision.webp", alt: "Logotipos da Activision e da Blizzard", credit: "Divulgação/Activision Blizzard" },
  { key: "cd-projekt", pattern: /CD Projekt/i, file: "cd-projekt.webp", alt: "Logotipo da CD Projekt Red", credit: "Divulgação/CD Projekt" },
  { key: "konami", pattern: /Konami/i, file: "konami.webp", alt: "Logotipo da Konami", credit: "Divulgação/Konami" },
  { key: "warner-bros-games", pattern: /Warner Bros|\bWB Games\b/i, file: "warner-bros-games.webp", alt: "Logotipo da Warner Bros. Games", credit: "Divulgação/Warner Bros. Games" },
  { key: "riot", pattern: /Riot Games|League of Legends|Valorant/i, file: "riot.webp", alt: "Logotipo da Riot Games", credit: "Divulgação/Riot Games" },
  { key: "krafton", pattern: /Krafton|\bPUBG\b/i, file: "krafton.webp", alt: "Logotipo da Krafton", credit: "Divulgação/Krafton" },
  { key: "embracer", pattern: /Embracer/i, file: "embracer.webp", alt: "Logotipo do Embracer Group", credit: "Divulgação/Embracer Group" },
  { key: "itch-io", pattern: /itch\.io/i, file: "itch-io.webp", alt: "Logotipo do itch.io", credit: "Divulgação/itch.io" },
];

/** Every picture of the acervo: consoles first, then companies. */
export const ACERVO: AcervoEntry[] = [...CONSOLES, ...COMPANIES];

const toImage = (e: AcervoEntry) => ({ url: `/acervo/${e.file}`, alt: e.alt, credit: e.credit });

/** The entry the text names first (by position), among `list`. */
function firstNamed(text: string, list: AcervoEntry[]): AcervoEntry | null {
  let best: { entry: AcervoEntry; at: number } | null = null;
  for (const entry of list) {
    const at = text.search(entry.pattern);
    if (at >= 0 && (!best || at < best.at)) best = { entry, at };
  }
  return best?.entry ?? null;
}

/** The official picture for a text about a console or a company (pure), or null when it names neither. */
export function acervoFor(text: string): { url: string; alt: string; credit: string } | null {
  const entry = CONSOLES.find((c) => c.pattern.test(text)) ?? firstNamed(text, COMPANIES);
  return entry ? toImage(entry) : null;
}
