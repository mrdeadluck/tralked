import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { z } from "zod";
import type { Ai } from "./ai/client.js";
import { escapeText } from "./ai/escape.js";
import {
  writeAndCheck,
  writeBatchRequest,
  type Draft,
  type Models,
  type StoryForWriting,
  type StorySource,
} from "./ai/writer.js";
import { assemble, type AssembleDraft } from "./assemble.js";
import { localDay } from "./clock.js";
import { extractText, fetchPage, type FetchFn } from "./collect/index.js";
import { stripHtml } from "./collect/text.js";
import type { Db, PautaRow, PautaStatus, SpendBucket, StoryMode } from "./db.js";
import type { ArticleCategory, ArticlePayload, Dossier, Insights, Tralked } from "./tralked.js";

/**
 * Pautas Tralked: evergreen pieces on famous games, with the same identity as the news ("Equipe Tralked",
 * "Em 3 pontos", "No Tralked", "Fontes"). A game comes from `config/jogos-famosos.json`; its sources are the
 * Tralked dossier, the Steam store text and the game's wiki. Nothing is invented: without material for a
 * format another one is tried, and without any the game is skipped.
 */

// ---------------------------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------------------------

export const PAUTA_FORMATS = ["vale-o-100", "mais-raras", "perdiveis", "iniciantes"] as const;
export type PautaFormat = (typeof PAUTA_FORMATS)[number];

/** A game gets at most one pauta (or one skip) in any 60-day span. */
export const PAUTA_GAP_DAYS = 60;
/** `chooseFormat` prefers a format not used in this many most recent pautas. */
export const RECENT_FORMATS = 5;
export const MIN_ACHIEVEMENTS_100 = 10;
export const MIN_RARE_ACHIEVEMENTS = 5;
export const MIN_BEGINNER_CHARS = 1500;
/** "perdíveis": the missable word and the achievement word at most this many characters apart. */
const NEAR_CHARS = 150;
const STEAM_TEXT_MAX = 8_000;
const WIKI_TEXT_MAX = 12_000;
/** The dossier holds up to 500 achievements: the prompt gets the rarest ones. */
const DOSSIER_ACHIEVEMENTS_MAX = 200;
/** Rarest achievements given as `rarest` (the cards of "No Tralked" come from here). */
const RAREST_MAX = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export const tralkedGameUrl = (slug: string) => `https://tralked.com/jogos/${encodeURIComponent(slug)}`;
export const steamAppDetailsUrl = (appId: number) => `https://store.steampowered.com/api/appdetails?appids=${appId}&l=brazilian`;
const steamStoreUrl = (appId: number) => `https://store.steampowered.com/app/${appId}/`;

/** Idempotency key of a pauta's creation (ruling: its own keys, never a story's). */
export const pautaKey = (mode: StoryMode, id: number) => `robo-pauta-${mode}-${id}`;

export type FamousGame = {
  name: string;
  steamAppId?: number;
  /** The game's wiki page (verified to answer a plain GET with the honest User-Agent). */
  wiki?: string;
  /** Pins the Tralked catalog slug when the name search would miss it. */
  slug?: string;
};

export type PautaSources = {
  entry: FamousGame;
  /** The Tralked catalog slug; null when the game is not in the catalog. */
  slug: string | null;
  name: string;
  dossier: Dossier | null;
  steam: { url: string; text: string } | null;
  /** The main wiki page first, then its achievements/trophies page when it links one. */
  wiki: { url: string; text: string }[];
};

/** A pauta draft: the writer's draft with the format's title, category and game set in code. */
export type PautaDraft = AssembleDraft;

export class PautaRejectedError extends Error {
  constructor(
    readonly title: string,
    readonly problems: string[],
  ) {
    super(`Pauta "${title}" reprovada duas vezes na checagem: ${problems.join(" | ")}`);
    this.name = "PautaRejectedError";
  }
}

// ---------------------------------------------------------------------------------------------
// The famous games list
// ---------------------------------------------------------------------------------------------

const FamousGameSchema = z
  .object({
    name: z.string().trim().min(1),
    steamAppId: z.number().int().positive().optional(),
    wiki: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), { message: "wiki must be https" })
      .optional(),
    slug: z.string().trim().min(1).optional(),
  })
  .strict();

export function loadFamousGames(path: string | URL = new URL("../config/jogos-famosos.json", import.meta.url)): FamousGame[] {
  const parsed = z.array(FamousGameSchema).safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`Invalid famous games file: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const seen = new Set<string>();
  for (const g of parsed.data) {
    const key = normName(g.name);
    if (seen.has(key)) throw new Error(`Invalid famous games file: duplicate game "${g.name}"`);
    seen.add(key);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

function normName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const sameName = (a: string, b: string) => normName(a) === normName(b);

/** Store names carry editions and marks ("DARK SOULS™ III", "... Definitive Edition"): containment is enough. */
function looselySame(a: string, names: string[]): boolean {
  const x = normName(a);
  return names.some((n) => {
    const y = normName(n);
    return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
  });
}

// ---------------------------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------------------------

export type NewPauta = {
  gameName: string;
  gameSlug: string | null;
  format: PautaFormat | null;
  status: PautaStatus;
  mode: StoryMode;
  storyDate: string;
  writingJson?: string | null;
  payloadJson?: string | null;
  siteId?: string | null;
  publishedAt?: string | null;
  error?: string | null;
};

export function recordPauta(db: Db, p: NewPauta, now: Date = new Date()): number {
  const result = db.raw
    .prepare(
      `INSERT INTO pautas (game_name, game_slug, format, status, mode, story_date, writing_json, payload_json, site_id, published_at, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.gameName,
      p.gameSlug,
      p.format,
      p.status,
      p.mode,
      p.storyDate,
      p.writingJson ?? null,
      p.payloadJson ?? null,
      p.siteId ?? null,
      p.publishedAt ?? null,
      p.error ?? null,
      now.toISOString(),
    );
  return Number(result.lastInsertRowid);
}

export function pautaById(db: Db, id: number): PautaRow | undefined {
  return db.raw.prepare("SELECT * FROM pautas WHERE id = ?").get(id) as unknown as PautaRow | undefined;
}

export type PautaPatch = { status?: PautaStatus; siteId?: string; slug?: string; publishedAt?: string; payloadJson?: string; error?: string };

export function markPauta(db: Db, id: number, patch: PautaPatch): void {
  db.raw
    .prepare(
      `UPDATE pautas SET
         status = COALESCE(?, status),
         site_id = COALESCE(?, site_id),
         slug = COALESCE(?, slug),
         published_at = COALESCE(?, published_at),
         payload_json = COALESCE(?, payload_json),
         error = COALESCE(?, error)
       WHERE id = ?`,
    )
    .run(patch.status ?? null, patch.siteId ?? null, patch.slug ?? null, patch.publishedAt ?? null, patch.payloadJson ?? null, patch.error ?? null, id);
}

/** Pautas published on the local `day` (both modes). */
export function pautasPublishedOn(db: Db, day: string): number {
  const mid = Date.parse(`${day}T12:00:00Z`);
  const rows = db.raw
    .prepare("SELECT published_at FROM pautas WHERE status = 'published' AND published_at >= ? AND published_at <= ?")
    .all(new Date(mid - 2 * DAY_MS).toISOString(), new Date(mid + 2 * DAY_MS).toISOString()) as unknown as { published_at: string }[];
  return rows.filter((r) => localDay(new Date(r.published_at)) === day).length;
}

/** Formats of the most recent pautas (by day, then id), most recent first; up to `upToDay` when given. */
export function recentFormats(db: Db, upToDay?: string): PautaFormat[] {
  const rows = db.raw
    .prepare(
      `SELECT format FROM pautas
       WHERE format IS NOT NULL AND status NOT IN ('skipped', 'failed') AND (? IS NULL OR story_date <= ?)
       ORDER BY story_date DESC, id DESC LIMIT ?`,
    )
    .all(upToDay ?? null, upToDay ?? null, RECENT_FORMATS) as unknown as { format: PautaFormat }[];
  return rows.map((r) => r.format);
}

const dayDistance = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY_MS;

/**
 * A random game among those without a pauta row (any status: published, planned, failed or skipped for
 * being out of the catalog or without material) within 60 days of `now`'s local day, either side.
 */
export function pickPautaGame(db: Db, list: FamousGame[], now: Date, rand: () => number): FamousGame | null {
  const today = localDay(now);
  const rows = db.raw.prepare("SELECT game_name, story_date FROM pautas").all() as unknown as { game_name: string; story_date: string }[];
  const blocked = new Set(rows.filter((r) => dayDistance(r.story_date, today) < PAUTA_GAP_DAYS).map((r) => normName(r.game_name)));
  const eligible = list.filter((g) => !blocked.has(normName(g.name)));
  if (eligible.length === 0) return null;
  return eligible[Math.min(eligible.length - 1, Math.floor(rand() * eligible.length))]!;
}

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

export type GatherDeps = { tralked: Pick<Tralked, "findGame" | "dossier">; fetchFn: FetchFn; log?: (line: string) => void };

const CHALLENGE_TITLE = /just a moment|attention required|making sure you.?re not a bot|access denied|are you a (human|robot)/i;
const CHALLENGE_BODY = /id="anubis_challenge"|window\._cf_chl_opt|cf-chl-/;

/** A bot-protection page: the source is unavailable (never worked around). */
export function isChallenge(html: string): boolean {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  return CHALLENGE_TITLE.test(title) || CHALLENGE_BODY.test(html);
}

const ACHIEVEMENTS_LINK = /\b(achievements?|trophies|trophy|conquistas?|trof[eé]us?)\b/i;

/**
 * The achievements/trophies page a wiki page links to, on the same host. Encyclopedias are skipped: their
 * "achievement" links lead to the general article about achievements, not to the game's list.
 */
function achievementsLink(html: string, pageUrl: string): string | null {
  const base = new URL(pageUrl);
  if (/(^|\.)wikipedia\.org$/.test(base.hostname)) return null;
  const { document } = parseHTML(html);
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    let target: URL;
    try {
      target = new URL(href, base);
    } catch {
      continue;
    }
    if (target.hostname !== base.hostname || !/^https?:$/.test(target.protocol)) continue;
    target.hash = "";
    if (target.href === base.href.replace(/#.*$/, "")) continue;
    let path = target.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep the raw path
    }
    if (ACHIEVEMENTS_LINK.test((a.textContent ?? "").trim()) || ACHIEVEMENTS_LINK.test(path.replace(/[_+-]/g, " "))) return target.href;
  }
  return null;
}

/** One wiki page as readable text, or null when unavailable (HTTP error, challenge, nothing readable). */
async function wikiPage(url: string, deps: GatherDeps): Promise<{ html: string; finalUrl: string; text: string } | null> {
  try {
    const { text: html, finalUrl } = await fetchPage(url, deps.fetchFn);
    if (isChallenge(html)) {
      deps.log?.(`pauta: wiki indisponível (proteção contra robôs): ${url}`);
      return null;
    }
    const extracted = extractText(html, finalUrl);
    if (!extracted?.text) return null;
    return { html, finalUrl, text: extracted.text.slice(0, WIKI_TEXT_MAX).trim() };
  } catch (error) {
    deps.log?.(`pauta: wiki indisponível: ${url} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

async function wikiPages(url: string, deps: GatherDeps): Promise<PautaSources["wiki"]> {
  const main = await wikiPage(url, deps);
  if (!main) return [];
  const out = [{ url, text: main.text }];
  const link = achievementsLink(main.html, main.finalUrl);
  if (link) {
    const sub = await wikiPage(link, deps);
    if (sub) out.push({ url: link, text: sub.text });
  }
  return out;
}

/** The store's "about the game" text, HTML stripped; null when unavailable or about another game. */
async function steamText(appId: number, names: string[] | null, deps: GatherDeps): Promise<PautaSources["steam"]> {
  try {
    const { text } = await fetchPage(steamAppDetailsUrl(appId), deps.fetchFn);
    const entry = (JSON.parse(text) as Record<string, { success?: boolean; data?: { name?: string; about_the_game?: string } }>)[String(appId)];
    if (!entry?.success || !entry.data) return null;
    if (names && !looselySame(entry.data.name ?? "", names)) {
      deps.log?.(`pauta: a página Steam ${appId} é de outro jogo (${entry.data.name ?? "sem nome"})`);
      return null;
    }
    const about = stripHtml(entry.data.about_the_game ?? "").slice(0, STEAM_TEXT_MAX).trim();
    return about ? { url: steamStoreUrl(appId), text: about } : null;
  } catch (error) {
    deps.log?.(`pauta: Steam indisponível para ${appId} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

/**
 * The dossier (`findGame` → `dossier`, or the pinned slug), then the Steam text and the wiki pages. A
 * catalog hit counts only when it is the same game: same name, or the same Steam app id. Without the
 * dossier nothing else is fetched. Site API errors propagate; Steam and wiki failures make that source
 * unavailable.
 */
export async function gatherPautaSources(entry: FamousGame, deps: GatherDeps): Promise<PautaSources> {
  const empty: PautaSources = { entry, slug: null, name: entry.name, dossier: null, steam: null, wiki: [] };
  let slug = entry.slug ?? null;
  let hitName: string | null = null;
  if (!slug) {
    const hit = await deps.tralked.findGame(entry.name);
    if (!hit) return empty;
    slug = hit.slug;
    hitName = hit.name;
  }
  const dossier = await deps.tralked.dossier(slug);
  if (!dossier) return empty;
  if (!entry.slug) {
    const same =
      sameName(hitName ?? "", entry.name) ||
      sameName(dossier.game.name, entry.name) ||
      (entry.steamAppId !== undefined && dossier.game.steamAppId === entry.steamAppId);
    if (!same) {
      deps.log?.(`pauta: "${entry.name}" não está no catálogo (a busca achou "${dossier.game.name}")`);
      return empty;
    }
  }

  // The catalog's Steam id is the game's own; one from the list must match the game's name.
  const appId = dossier.game.steamAppId ?? entry.steamAppId ?? null;
  const steam = appId === null ? null : await steamText(appId, dossier.game.steamAppId ? null : [entry.name, dossier.game.name], deps);
  const wiki = entry.wiki ? await wikiPages(entry.wiki, deps) : [];
  return { entry, slug, name: dossier.game.name, dossier, steam, wiki };
}

// ---------------------------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------------------------

const MISSABLE = /\bperd|\bmissable\b|\bmiss(?:ed|es|ing)?\b/gi;
const ACHIEVEMENT = /achievement|conquista/gi;

/** The wiki says "perd…", "missable" or "miss" near "achievement" or "conquista". */
function mentionsMissable(text: string): boolean {
  const a = [...text.matchAll(MISSABLE)].map((m) => m.index);
  const b = [...text.matchAll(ACHIEVEMENT)].map((m) => m.index);
  return a.some((i) => b.some((j) => Math.abs(i - j) <= NEAR_CHARS));
}

function eligibleFormats(sources: PautaSources): PautaFormat[] {
  const dossier = sources.dossier;
  if (!dossier) return [];
  const steam = sources.steam?.text.trim() ?? "";
  const wikis = sources.wiki.map((w) => w.text.trim()).filter((t) => t !== "");
  // Ruling: a pauta needs the dossier plus Steam or wiki text.
  if (steam === "" && wikis.length === 0) return [];
  const textChars = steam.length + wikis.reduce((sum, t) => sum + t.length, 0);
  const ok: Record<PautaFormat, boolean> = {
    "vale-o-100": dossier.achievements.length >= MIN_ACHIEVEMENTS_100,
    "mais-raras": dossier.achievements.filter((a) => a.globalPct !== null).length >= MIN_RARE_ACHIEVEMENTS,
    perdiveis: wikis.some(mentionsMissable),
    iniciantes: textChars >= MIN_BEGINNER_CHARS,
  };
  return PAUTA_FORMATS.filter((f) => ok[f]);
}

/**
 * The format for these sources: among the eligible ones, those not used in the last 5 pautas (`recent`,
 * most recent first) are preferred; `rand` picks inside the preferred group. Null when none is eligible.
 */
export function chooseFormat(sources: PautaSources, recent: PautaFormat[], rand: () => number): PautaFormat | null {
  const eligible = eligibleFormats(sources);
  if (eligible.length === 0) return null;
  const used = new Set(recent.slice(0, RECENT_FORMATS));
  const fresh = eligible.filter((f) => !used.has(f));
  const pool = fresh.length > 0 ? fresh : eligible;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]!;
}

export const pautaCategory = (format: PautaFormat): ArticleCategory =>
  format === "vale-o-100" || format === "mais-raras" ? "GAMES" : "GUIAS";

/** The spec's title of each format. */
export function pautaTitle(format: PautaFormat, game: string, achievements: number): string {
  switch (format) {
    case "vale-o-100":
      return `${game} tem ${achievements} conquistas: vale a pena caçar o 100%?`;
    case "mais-raras":
      return `As 5 conquistas mais raras de ${game} e o que cada uma pede`;
    case "perdiveis":
      return `Conquistas perdíveis de ${game}: o que saber antes de começar`;
    case "iniciantes":
      return `${game} para iniciantes: por onde começar`;
  }
}

const BRIEFS: Record<PautaFormat, string> = {
  "vale-o-100":
    "Formato 1, \"vale a pena caçar o 100%?\": mostre o que a caça ao 100% exige, com o número de conquistas, as mais raras e suas porcentagens, o tempo para completar e o tipo de tarefa que domina a lista, tudo pelos dados do Tralked e pelas descrições. Não dê veredito: o leitor decide.",
  "mais-raras":
    "Formato 2, \"as 5 mais raras\": as cinco conquistas com a menor porcentagem global nos dados do Tralked, da mais rara para a menos rara, cada uma com o nome exato, a porcentagem e o que pede segundo a descrição dos dados ou da wiki.",
  perdiveis:
    "Formato 3, \"conquistas perdíveis\": só o que a wiki ou a página da Steam dizem sobre conquistas perdíveis e o momento em que se perde cada uma. Nada do que você lembra do jogo. Os dados do Tralked ficam para \"No Tralked\".",
  iniciantes:
    "Formato 4, \"para iniciantes\": só o que a wiki ou a página da Steam dizem sobre o jogo, o começo e as mecânicas básicas. Nada do que você lembra do jogo. Os dados do Tralked ficam para \"No Tralked\".",
};

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

const minutes = (m: number | null) => (m === null ? "sem dado" : `${m} minutos`);

/** The dossier as plain text: the "Tralked" source of the writer and the checker. */
function dossierText(d: Dossier): string {
  const g = d.game;
  const lines = [
    `Jogo: ${g.name} (slug ${g.slug})`,
    `Desenvolvedora: ${g.developer ?? "sem dado"}; publicadora: ${g.publisher ?? "sem dado"}`,
    `Lançamento: ${g.releaseDate ?? "sem dado"}; plataformas: ${g.platforms.join(", ") || "sem dado"}; nota da crítica: ${g.criticScore ?? "sem dado"}`,
    `Resumo do catálogo: ${g.summary ?? "sem dado"}`,
    `Total de conquistas: ${g.achievementCount}`,
    `Tempo para completar 100%: ${minutes(g.timeToBeatCompleteMin)}`,
    `Jogadores no Tralked: ${d.tralked.players}; horas médias dos jogadores no Tralked: ${minutes(d.tralked.avgPlaytimeMin)}; jogadores que completaram no Tralked: ${d.tralked.completedPlayers}`,
    `Conquistas visíveis (da mais rara para a mais comum; apiName | nome | o que pede | % global de jogadores que têm):`,
    ...d.achievements
      .slice(0, DOSSIER_ACHIEVEMENTS_MAX)
      .map((a) => `- ${a.apiName} | ${a.name} | ${a.description ?? "sem descrição"} | ${a.globalPct === null ? "sem dado" : `${a.globalPct}%`}`),
  ];
  if (d.achievements.length > DOSSIER_ACHIEVEMENTS_MAX) lines.push(`(mais ${d.achievements.length - DOSSIER_ACHIEVEMENTS_MAX} conquistas comuns fora da lista)`);
  return lines.join("\n");
}

/** The dossier in the shape "No Tralked" uses (and `assemble` checks achievement cards against). */
export function insightsFromDossier(d: Dossier): Insights {
  return {
    game: {
      slug: d.game.slug,
      name: d.game.name,
      releaseDate: d.game.releaseDate,
      platforms: d.game.platforms,
      achievementCount: d.game.achievementCount,
      timeToBeatCompleteMin: d.game.timeToBeatCompleteMin,
    },
    tralked: { players: d.tralked.players, avgPlaytimeMin: d.tralked.avgPlaytimeMin },
    rarest: d.achievements
      .filter((a): a is typeof a & { globalPct: number } => a.globalPct !== null)
      .slice(0, RAREST_MAX)
      .map((a) => ({ platform: a.platform, apiName: a.apiName, name: a.name, globalPct: a.globalPct })),
  };
}

function wikiName(url: string): string {
  const host = new URL(url).hostname;
  return /(^|\.)wikipedia\.org$/.test(host) ? "Wikipédia" : `Wiki (${host})`;
}

/**
 * The writer's input for a pauta: the Steam page, the wiki pages and the Tralked game page as sources
 * (they close the article in "Fontes"), the game as the only candidate, and the format's brief and title.
 * Needs a dossier and a slug.
 */
export function pautaStory(sources: PautaSources, format: PautaFormat, id = 0): StoryForWriting {
  const dossier = sources.dossier;
  const slug = sources.slug;
  if (!dossier || !slug) throw new Error(`Pauta sem dossiê: ${sources.entry.name}`);
  const title = pautaTitle(format, dossier.game.name, dossier.game.achievementCount || dossier.achievements.length);
  const list: StorySource[] = [];
  if (sources.steam) list.push({ name: "Steam", tier: "oficial", url: sources.steam.url, publishedAt: null, text: sources.steam.text });
  for (const w of sources.wiki) list.push({ name: wikiName(w.url), tier: "outro", url: w.url, publishedAt: null, text: w.text });
  list.push({ name: "Tralked", tier: "oficial", url: tralkedGameUrl(slug), publishedAt: null, text: dossierText(dossier) });
  return {
    id,
    headline: title,
    category: pautaCategory(format),
    rumor: false,
    sources: list,
    candidates: [{ slug, name: dossier.game.name, insights: insightsFromDossier(dossier) }],
    formatBrief: [BRIEFS[format], `Título obrigatório (use exatamente): ${escapeText(title)}`].join("\n\n"),
  };
}

let pautaStyleCache: string | null = null;

/** The Pautas Tralked addendum to the editorial manual (system prompt; byte-stable for the cache). */
export function loadPautaStyle(): string {
  pautaStyleCache ??= readFileSync(new URL("../prompts/pautas.md", import.meta.url), "utf8");
  return pautaStyleCache;
}

/** The format's title, category and game, set in code after drafting (R17: the model schema stays news-only). */
export function finishPautaDraft(draft: Draft, story: StoryForWriting, format: PautaFormat): PautaDraft {
  const slug = story.candidates[0]?.slug;
  return { ...draft, title: story.headline, category: pautaCategory(format), games: slug ? [slug] : [], rumor: false };
}

export type PautaWriteOpts = { models?: Models; now?: Date; fallbacks?: boolean };

/**
 * Writes and fact-checks a pauta with the news writer (`writeAndCheck`), the pauta addendum appended to the
 * system prompt. Throws `PautaRejectedError` when the check fails twice.
 */
export async function writePauta(
  ai: Ai,
  sources: PautaSources,
  format: PautaFormat,
  bucket: SpendBucket,
  opts: PautaWriteOpts = {},
): Promise<PautaDraft> {
  const story = pautaStory(sources, format);
  const result = await writeAndCheck(ai, story, bucket, {
    ...(opts.models ? { models: opts.models } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.fallbacks !== undefined ? { fallbacks: opts.fallbacks } : {}),
    systemExtra: loadPautaStyle(),
  });
  if (!result.ok) throw new PautaRejectedError(story.headline, result.problems);
  return finishPautaDraft(result.draft, story, format);
}

/** The backfill's batch request for a pauta: the batch writer with the pauta addendum (no fallbacks). */
export function pautaBatchRequest(
  ai: Ai,
  story: StoryForWriting,
  customId: string,
  opts: { models?: Models; now?: Date } = {},
): ReturnType<Ai["batchRequest"]> {
  return writeBatchRequest(ai, story, customId, { ...opts, systemExtra: loadPautaStyle() });
}

/** The site payload of a checked pauta draft. */
export function pautaPayload(draft: PautaDraft, story: StoryForWriting): ArticlePayload {
  const insights = new Map(story.candidates.flatMap((c) => (c.insights ? [[c.slug, c.insights] as const] : [])));
  return assemble(draft, story, { insights });
}
