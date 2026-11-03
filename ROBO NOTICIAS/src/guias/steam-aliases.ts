import type { AchievementAliases } from "./dossier.js";
import type { FetchPage } from "./sources.js";

/**
 * The achievements' names in the languages of the guides read. The best Steam guides of a new game are often
 * Chinese or Russian and cite the achievements by their localized Steam names ("逆天改命", "Сердцем и кровью"),
 * which never match the English list.
 *
 * First the game's public achievement page, `steamcommunity.com/achievements/<appid>?l=<language>` (keyless, no
 * profile): it embeds the achievement schema in the language asked, apinames and hidden achievements included
 * (verified live on Phantom Blade Zero, 2026-11-03). Then, as a fallback, the community XML of a profile that owns
 * the game (`?xml=1&l=`), the page the site reads as the schema (app/src/lib/integrations/steam/community.ts); on
 * PBZ it answered in English whatever the `l=`, so a list of English names does not count as localized. Read
 * through `politeFetch` (robots.txt, 5 s per request on steamcommunity.com, 7-day cache).
 */

/** Steam's language codes the robot reads names in. */
export const ALIAS_LANGUAGES = ["schinese", "tchinese", "russian", "japanese", "koreana"] as const;
export type AliasLanguage = (typeof ALIAS_LANGUAGES)[number];

/**
 * Default reference profile: MrDead_'s public profile, the site's reference for the schema of every game
 * (`DEFAULT_REFERENCE_STEAM_ID`). `GUIDE_STEAM_REFERENCE_ID` overrides it.
 */
export const REFERENCE_STEAM_ID = "76561198012210783";

const COUNT = {
  han: /[㐀-䶿一-鿿]/gu,
  kana: /[぀-ヿ]/gu,
  hangul: /[가-힯]/gu,
  cyrillic: /[Ѐ-ӿ]/gu,
};
const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;
/** Letters of a script a page needs before it counts as written in it (a stray game title does not). */
const MIN_LETTERS = 50;
const MIN_KANA_OR_HANGUL = 20;

const HINTS: Record<string, AliasLanguage[]> = { zh: ["schinese", "tchinese"], ru: ["russian"], ja: ["japanese"], ko: ["koreana"] };

/** The Steam languages the pages read are written in (Chinese: both scripts, a guide may use either). */
export function steamLanguagesIn(pages: { text: string; language?: string }[]): AliasLanguage[] {
  const found = new Set<AliasLanguage>();
  for (const page of pages) {
    for (const lang of HINTS[page.language ?? ""] ?? []) found.add(lang);
    const kana = count(page.text, COUNT.kana);
    if (kana >= MIN_KANA_OR_HANGUL) found.add("japanese");
    else if (count(page.text, COUNT.han) >= MIN_LETTERS) {
      found.add("schinese");
      found.add("tchinese");
    }
    if (count(page.text, COUNT.cyrillic) >= MIN_LETTERS) found.add("russian");
    if (count(page.text, COUNT.hangul) >= MIN_KANA_OR_HANGUL) found.add("koreana");
  }
  return ALIAS_LANGUAGES.filter((l) => found.has(l));
}

/** The game's public achievement page in a language (the schema, embedded as JSON). */
export const steamAliasUrl = (appId: number | string, language: AliasLanguage) => `https://steamcommunity.com/achievements/${appId}?l=${language}`;

/** The fallback: a profile's achievement XML in a language. */
export const steamProfileXmlUrl = (appId: number | string, language: AliasLanguage, profile = REFERENCE_STEAM_ID) =>
  `https://steamcommunity.com/profiles/${profile}/stats/${appId}/achievements/?xml=1&l=${language}`;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") return String.fromCodePoint(code[1]!.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  if (!match) return undefined;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(match[1]!);
  return (cdata ? cdata[1]! : decode(match[1]!)).trim();
}

/** apiname (lowercased by Steam) and name of each achievement; null when it is not an achievement list. */
export function parseAchievementXml(xml: string): { apiName: string; name: string }[] | null {
  if (!xml.includes("<playerstats") || tag(xml, "error") !== undefined) return null;
  const out: { apiName: string; name: string }[] = [];
  for (const [, body] of xml.matchAll(/<achievement(?:\s[^>]*)?>([\s\S]*?)<\/achievement>/g)) {
    const apiName = tag(body!, "apiname");
    const name = tag(body!, "name");
    if (apiName && name) out.push({ apiName, name });
  }
  return out;
}

type SchemaQuery = {
  queryKey?: unknown[];
  state?: { data?: { groups?: { achievements?: { api_name?: unknown; name?: unknown }[] }[] } | null };
};

/**
 * apiName and name of each achievement on the game's public achievement page: its server-rendered JSON
 * (`<script id="valve-ssr-data">`) carries `renderContext.queryData`, a JSON string whose `["achievements", appid,
 * "schema_v2"]` query holds the schema in the page's language. Null when the page has no such list.
 */
export function parseAchievementSchemaPage(html: string): { apiName: string; name: string }[] | null {
  const script = /<script[^>]*\bid="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!script) return null;
  try {
    const ssr = JSON.parse(script[1]!) as { renderContext?: { queryData?: unknown } };
    const queryData = ssr.renderContext?.queryData;
    if (typeof queryData !== "string") return null;
    const { queries } = JSON.parse(queryData) as { queries?: SchemaQuery[] };
    const schema = (queries ?? []).find((q) => q.queryKey?.[0] === "achievements" && Array.isArray(q.state?.data?.groups));
    const rows = (schema?.state?.data?.groups ?? []).flatMap((g) => g.achievements ?? []);
    const out = rows.flatMap((a) =>
      typeof a.api_name === "string" && typeof a.name === "string" && a.name.trim() ? [{ apiName: a.api_name, name: a.name.trim() }] : [],
    );
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Steam sends some apps to a friendly name (`/stats/<Name>/?tab=achievements`): the XML url under that name. */
function friendlyRetry(finalUrl: string, asked: string, language: AliasLanguage): string | undefined {
  if (!URL.canParse(finalUrl) || finalUrl === asked) return undefined;
  const target = new URL(finalUrl);
  if (target.protocol !== "https:" || target.hostname !== "steamcommunity.com") return undefined;
  const stats = target.pathname.match(/^(.*\/stats\/[^/]+)\/?(?:achievements\/?)?$/);
  const url = stats ? `${target.origin}${stats[1]}/achievements/?xml=1&l=${language}` : undefined;
  return url === asked ? undefined : url;
}

export type SteamAliasResult = {
  aliases: AchievementAliases;
  /** Languages whose list was read. */
  read: AliasLanguage[];
  /** The page each language was read from (the public page, or the profile XML when only that one answered). */
  urls: Partial<Record<AliasLanguage, string>>;
  failed: { language: AliasLanguage; reason: string }[];
};

/**
 * Names of the Steam master list's achievements in each language, keyed by the list's apiName: from the game's
 * public achievement page, else from the profile XML. A language whose list cannot be read, or comes back in
 * English, is reported in `failed` and skipped: its guides simply match fewer names. `steamList` may carry the
 * English names, to tell an English list apart.
 */
export async function readSteamAliases(
  appId: number,
  languages: AliasLanguage[],
  steamList: { apiName: string; name?: string }[],
  fetchPage: FetchPage,
  profile = REFERENCE_STEAM_ID,
): Promise<SteamAliasResult> {
  const canonical = new Map(steamList.map((s) => [s.apiName.toLowerCase(), s.apiName]));
  const english = new Map(steamList.flatMap((s) => (s.name ? [[s.apiName.toLowerCase(), s.name.trim()] as const] : [])));
  const aliases: AchievementAliases = {};
  const result: SteamAliasResult = { aliases, read: [], urls: {}, failed: [] };
  for (const language of languages) {
    const pageUrl = steamAliasUrl(appId, language);
    const page = await fetchPage(pageUrl);
    const fromPage = page.status === "ok" ? parseAchievementSchemaPage(page.html ?? "") : null;
    const listed = fromPage ? { rows: fromPage, url: pageUrl } : await readProfileXml(appId, language, fetchPage, profile);
    if ("reason" in listed) {
      result.failed.push({ language, reason: listed.reason });
      continue;
    }
    const known = listed.rows.filter((r) => canonical.has(r.apiName.toLowerCase()));
    if (known.length === 0) {
      result.failed.push({ language, reason: "a lista da Steam não tem as conquistas do jogo" });
      continue;
    }
    if (english.size > 0 && known.every((r) => english.get(r.apiName.toLowerCase()) === r.name.trim())) {
      result.failed.push({ language, reason: `a Steam devolveu os nomes em inglês, não em ${language}` });
      continue;
    }
    for (const row of known) {
      const apiName = canonical.get(row.apiName.toLowerCase())!;
      const names = (aliases[apiName] ??= []);
      if (!names.includes(row.name)) names.push(row.name);
    }
    result.read.push(language);
    result.urls[language] = listed.url;
  }
  return result;
}

/** The fallback list: the profile's achievement XML (following the app's friendly name once). */
async function readProfileXml(
  appId: number,
  language: AliasLanguage,
  fetchPage: FetchPage,
  profile: string,
): Promise<{ rows: { apiName: string; name: string }[]; url: string } | { reason: string }> {
  const url = steamProfileXmlUrl(appId, language, profile);
  let page = await fetchPage(url);
  let read = url;
  let rows = page.status === "ok" ? parseAchievementXml(page.html ?? "") : null;
  const retry = page.status === "ok" && !rows ? friendlyRetry(page.finalUrl, url, language) : undefined;
  if (retry) {
    page = await fetchPage(retry);
    read = retry;
    rows = page.status === "ok" ? parseAchievementXml(page.html ?? "") : null;
  }
  if (rows) return { rows, url: read };
  return { reason: page.status === "ok" ? "a Steam não devolveu a lista de conquistas" : (page.reason ?? page.status) };
}
