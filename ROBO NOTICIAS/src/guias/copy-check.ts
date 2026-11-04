import type { ContentBlock } from "../tralked.js";
import type { GuidePayloadV2 } from "./contract.js";
import { targetNames, type GuideDossier } from "./dossier.js";

/**
 * Deterministic checks of the written guide, run before the LLM checker: copied runs of 9+ words (the manual allows
 * at most 8 equal words in a row) and the vocabulary ("Tralked", never "platina"; voice v2: no phrase that hands the
 * doubt to the reader, `DOUBT_PHRASES`).
 */

const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const ngramCache = new WeakMap<readonly string[], Map<number, Set<string>>>();

function ngrams(sources: readonly string[], n: number): Set<string> {
  let byN = ngramCache.get(sources);
  if (!byN) ngramCache.set(sources, (byN = new Map()));
  let set = byN.get(n);
  if (!set) {
    set = new Set();
    for (const source of sources) {
      const w = words(source);
      for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(" "));
    }
    byN.set(n, set);
  }
  return set;
}

/**
 * Articles and other small words (English and Portuguese): a name's part never starts with one, and they need no
 * capital inside a proper name ("Lady of the Blossom Veil").
 */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "and", "or", "in", "on", "at", "for", "with", "from", "by",
  "o", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "nos", "nas", "para", "por", "com",
]);

/** The text's tokens that start with a letter (numbers and punctuation have no case). */
const letterTokens = (text: string) => text.split(/\s+/).filter((t) => /^\p{L}/u.test(t));
const capitalized = (token: string) => /^\p{Lu}/u.test(token);
const isStopword = (token: string) => STOPWORDS.has(words(token)[0] ?? "");

/** Task 23 review: a part of a name counts only when it starts with a capital and not with an article or stopword. */
function properPart(part: string): boolean {
  const first = letterTokens(part)[0];
  return first !== undefined && capitalized(first) && !isStopword(first);
}

/**
 * Task 23 review: a target an achievement text cites ("defeat X") counts as a name only when it is short (at most 6
 * words) and every significant word is capitalized, as proper names are: the lowercase tail of an instruction ("take
 * the ladder on the right side…") never is.
 */
function properTarget(target: string): boolean {
  const tokens = letterTokens(target);
  return words(target).length <= 6 && tokens.length > 0 && tokens.every((t) => isStopword(t) || capitalized(t));
}

/**
 * Task 23: a known name's word sequences: the whole name, and its parts cut at the separators names use ("Boss: Meng
 * Hua, the Merciful Lady of the Blossom Veil", "Memory Flower – Xuan Li’s Memory Flower – 6. Control") that are
 * proper (`properPart`). Only sequences of 2+ words: a single word ("the", "control") is never taken for a name.
 */
function nameSequences(names: readonly string[]): string[][] {
  const out = new Map<string, string[]>();
  for (const name of names) {
    const parts = name.split(/\s*[,:;|/()[\]–—]\s*|\s+-\s+|\.\s+/).filter((part) => part !== name && properPart(part));
    for (const part of [name, ...parts]) {
      const w = words(part);
      if (w.length >= 2) out.set(w.join(" "), w);
    }
  }
  return [...out.values()];
}

/** For each word of `w`: true when it belongs to an occurrence of one of the names' word sequences. */
function nameMask(w: readonly string[], names: readonly string[]): boolean[] {
  const mask = w.map(() => false);
  for (const seq of nameSequences(names)) {
    for (let i = 0; i + seq.length <= w.length; i++) {
      if (seq.every((word, k) => w[i + k] === word)) for (let k = 0; k < seq.length; k++) mask[i + k] = true;
    }
  }
  return mask;
}

/**
 * Runs of `n` or more consecutive words of `text` that also appear, in the same order, in one of the sources
 * (case, accents and punctuation ignored). The guide checks with n = 9. Task 23: the guide must cite proper names,
 * which repeat the sources; a run counts only when, taking out the words of the known `names` (`knownNames`), it
 * still has `n` or more equal words (a name in the middle of a copied sentence does not save it).
 */
export function copiedRuns(text: string, sources: readonly string[], n = 9, names: readonly string[] = []): string[] {
  const index = ngrams(sources, n);
  const w = words(text);
  const named = names.length > 0 ? nameMask(w, names) : w.map(() => false);
  const runs: string[] = [];
  const push = (start: number, end: number) => {
    let copied = 0;
    for (let i = start; i < end; i++) {
      if (!named[i]) copied++;
    }
    if (copied >= n) runs.push(w.slice(start, end).join(" "));
  };
  let start = -1;
  let end = -1;
  for (let i = 0; i + n <= w.length; i++) {
    if (!index.has(w.slice(i, i + n).join(" "))) continue;
    if (start >= 0 && i <= end) {
      end = i + n;
    } else {
      if (start >= 0) push(start, end);
      start = i;
      end = i + n;
    }
  }
  if (start >= 0) push(start, end);
  return runs;
}

/**
 * Task 23: the proper names the dossier knows, which the guide must cite: items' names (and English names),
 * achievements' names (English and PT-BR), chapter titles, regions, and the bosses, NPCs and quests the achievements'
 * texts and the milestones cite (`targetNames`, only the proper ones: `properTarget`). Not the collectible types:
 * generic nouns.
 */
export function knownNames(dossier: GuideDossier): string[] {
  const cited = (text: string | null | undefined) => targetNames(text).map((t) => t.trim()).filter(properTarget);
  const names = [
    ...dossier.chapters.flatMap((c) => [
      c.title,
      c.region ?? "",
      ...c.items.flatMap((i) => [i.name, i.nameEn ?? "", ...cited(i.missableUntil)]),
    ]),
    ...dossier.achievements.flatMap((a) => [
      a.nameEn,
      a.namePt ?? "",
      ...[a.description, a.descriptionPt, a.howTo, a.missableUntil].flatMap(cited),
    ]),
  ];
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];
}

/** The texts the dossier carries from the sources: what the guide may not copy when the raw pages are not given. */
export function dossierTexts(dossier: GuideDossier): string[] {
  return [
    ...dossier.chapters.flatMap((c) => c.items.map((i) => i.location)),
    ...dossier.achievements.flatMap((a) => [a.howTo ?? "", a.bugNote ?? ""]),
    ...dossier.facts.roadmap.map((r) => r.summary),
    dossier.facts.playthroughs?.value.note ?? "",
    dossier.facts.difficulty?.value.note ?? "",
  ].filter((t) => t.trim().length > 0);
}

const blockText = (b: ContentBlock) => (b.type === "paragraph" || b.type === "callout" ? b.text : "");

/**
 * Every text the model wrote, with where it is and the walkthrough key it belongs to (a step or item key; null for
 * the frame: cover, ficha, overview, read-first, roadmap, chapter titles). Names are left out: they repeat the
 * sources on purpose.
 */
export function guideProse(p: GuidePayloadV2): { where: string; key: string | null; text: string }[] {
  const w = p.walkthrough;
  return [
    { where: "a capa", key: null, text: `${w.cover.headline}. ${w.cover.deck}` },
    { where: "a ficha", key: null, text: `${w.extraFacts.playthroughsNote} ${w.extraFacts.difficultyNote}` },
    ...(p.overview ?? []).map((text) => ({ where: "a visão geral", key: null, text })),
    ...w.readFirst.map((r) => ({ where: `o "leia antes" "${r.title}"`, key: null, text: `${r.title}. ${r.text}` })),
    ...p.steps.flatMap((s) => s.body.map((b) => ({ where: `a etapa ${s.key ?? s.title}`, key: null, text: blockText(b) }))),
    ...w.chapters.flatMap((c) => [
      { where: `o capítulo ${c.key}`, key: null, text: `${c.title}. ${c.deadline ?? ""}` },
      ...c.steps.flatMap((s) => [
        ...s.body.map((b) => ({ where: `o passo ${s.key}`, key: s.key, text: blockText(b) })),
        ...s.items.map((i) => ({ where: `o item ${i.key}`, key: i.key, text: i.location ?? "" })),
      ]),
    ]),
  ].filter((x) => x.text.trim().length > 0);
}

/**
 * Voice v2 (Lucas, 2026-11-03): the guide never hands its uncertainty to the reader. These phrases are banned from
 * every text the reader sees (the style manual lists the same ones); a source conflict becomes the safest correct
 * instruction, and the `review` flag tells the editor.
 */
export const DOUBT_PHRASES = [
  "confira no jogo",
  "confirme no jogo",
  "as fontes divergem",
  "só uma fonte",
  "uma fonte diz",
  "não há certeza",
  "segundo as fontes",
  "em revisão",
  // Fix round 1: no reader-facing text talks about sources at all.
  "as fontes",
] as const;

/** A text's words as written (`raw`) and as compared (`norm`: lowercase, no accents), in order. */
function tokens(text: string): { raw: string; norm: string }[] {
  return text
    .normalize("NFC")
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() }));
}

/** Longest first: an occurrence inside a longer phrase ("segundo as fontes") is not counted again ("as fontes"). */
const DOUBT_WORDS = DOUBT_PHRASES.map((phrase) => ({ phrase, words: words(phrase) })).sort((a, b) => b.words.length - a.words.length);

/**
 * Review 2: the game sense of "fonte" (a hot spring; a fountain, a source of light, energy or power in the game) is not
 * source talk.
 */
const FONTE_GAME = new Set(["termal", "termais"]);
const FONTE_GAME_OF = new Set(["agua", "luz", "energia", "poder"]);
/** "revisita", "revisitar" (a revisit chapter) and "revistar" (to search) are game words, not "revisão". */
const REVIS_GAME = /^(revisit|revist)/;
/** "confira no jogo", "verifique no jogo", "confere no jogo"... */
const CHECK_IN_GAME = /^(confir|verifi|confer)/;

/** The word sequences of the known names (`knownNames`), one-word names included, computed once per list. */
const nameWordsCache = new WeakMap<readonly string[], string[][]>();
function nameWords(names: readonly string[]): string[][] {
  let out = nameWordsCache.get(names);
  if (!out) {
    const seen = new Map<string, string[]>();
    for (const n of names) {
      const w = words(n);
      if (w.length > 0) seen.set(w.join(" "), w);
    }
    nameWordsCache.set(names, (out = [...seen.values()]));
  }
  return out;
}

/** Options of the ban check: the known names to mask, and the fountain sense of "fonte" (the dossier names one). */
export type BanOpts = { names?: readonly string[]; fountain?: boolean };

/**
 * Review 2: the expressions in `text` that hand the doubt to the reader or talk about sources: the `DOUBT_PHRASES`
 * (list order), then, by position, any other "fonte"/"fontes" (not the game sense), "revis…" (not a revisit),
 * "confir… / verifi… / confer… no jogo" and the names of the sites the run read (`sites`, lowercase: `sourceSites`).
 * As written in the text (lowercase), without repeats; whole words, case and accents ignored.
 * Final review: the words of a known name (`names`: an achievement, item or place the guide must cite, "Fonte da
 * Juventude") never count; with `fountain` (the dossier itself names a fountain for this part), "fonte"/"fontes" and
 * "as fontes" are the game sense.
 */
export function bannedExpressions(text: string, sites: readonly string[] = [], opts: BanOpts = {}): string[] {
  const t = tokens(text);
  const used = t.map(() => false);
  for (const name of opts.names ? nameWords(opts.names) : []) {
    for (let i = 0; i + name.length <= t.length; i++) {
      if (name.every((w, k) => t[i + k]!.norm === w)) for (let k = 0; k < name.length; k++) used[i + k] = true;
    }
  }
  /** "fonte termal", "fontes termais", "fonte de água / luz / energia / poder": the game sense. */
  const gameFonte = (i: number) => {
    const next = t[i + 1]?.norm;
    const of = next === "de" || next === "da" || next === "do";
    return (next !== undefined && FONTE_GAME.has(next)) || (of && FONTE_GAME_OF.has(t[i + 2]?.norm ?? ""));
  };
  const found = new Set<string>();
  for (const d of DOUBT_WORDS) {
    if (opts.fountain && d.phrase === "as fontes") continue;
    for (let i = 0; i + d.words.length <= t.length; i++) {
      if (d.words.every((w, k) => t[i + k]!.norm === w && !used[i + k] && !(w.startsWith("fonte") && gameFonte(i + k)))) {
        found.add(d.phrase);
        for (let k = 0; k < d.words.length; k++) used[i + k] = true;
      }
    }
  }
  const extra: string[] = [];
  const site = new Set(sites);
  for (let i = 0; i < t.length; i++) {
    if (used[i]) continue;
    const w = t[i]!.norm;
    const next = t[i + 1]?.norm;
    if (w === "fonte" || w === "fontes") {
      if (!opts.fountain && !gameFonte(i)) extra.push(t[i]!.raw.toLowerCase());
    } else if (w.startsWith("revis") && !REVIS_GAME.test(w)) {
      extra.push(t[i]!.raw.toLowerCase());
    } else if (CHECK_IN_GAME.test(w) && next === "no" && t[i + 2]?.norm === "jogo") {
      extra.push(`${t[i]!.raw.toLowerCase()} no jogo`);
      i += 2;
    } else if (site.has(w)) {
      extra.push(t[i]!.raw);
    }
  }
  return [...new Set([...DOUBT_PHRASES.filter((p) => found.has(p)), ...extra])];
}

/** The banned phrases (`DOUBT_PHRASES`) in `text`, in list order: `bannedExpressions` without the other words. */
export function doubtPhrases(text: string): string[] {
  const listed = new Set<string>(DOUBT_PHRASES);
  return bannedExpressions(text).filter((x) => listed.has(x));
}

/** Second-level suffixes under a country code ("tecmundo.com.br", "game8.co.jp"): the site's label is the one before. */
const SECOND_LEVEL = new Set(["com", "net", "org", "gov", "edu", "co", "ac", "gg"]);

/**
 * Review 2: the sites the dossier's facts come from, one lowercase word each: the main label of every source link's
 * host ("www.powerpyx.com" → "powerpyx", "phantombladezero.wiki.fextralife.com" → "fextralife", "www.tecmundo.com.br"
 * → "tecmundo"). Only hosts: a source's name may be a common word ("Guia"). Never Steam (the platform the guide talks
 * about), never a short or common word.
 */
export function sourceSites(dossier: Pick<GuideDossier, "chapters" | "achievements">): string[] {
  const links = [...dossier.chapters.flatMap((c) => c.items.flatMap((i) => i.sourceLinks)), ...dossier.achievements.flatMap((a) => a.sourceLinks)];
  const out = new Set<string>();
  for (const l of links) {
    let labels: string[];
    try {
      labels = new URL(l.url).hostname.toLowerCase().split(".").filter(Boolean);
    } catch {
      continue;
    }
    let at = labels.length - 2;
    if (at > 0 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels[at]!)) at--;
    const label = labels[Math.max(0, at)];
    if (label) out.add(label);
  }
  return [...out].filter((s) => s.length >= 4 && !s.startsWith("steam") && !STOPWORDS.has(s) && !GENERIC_HOSTS.has(s) && !/^\d+$/.test(s));
}

/**
 * Final review: host labels that are platforms, hosting sites or common words ("games", "wiki", "guia"): never a
 * banned site name, only the distinctive ones are (powerpyx, fextralife, allthings...).
 */
const GENERIC_HOSTS = new Set([
  "game", "games", "gaming", "gamer", "gamers", "jogo", "jogos", "wiki", "wikis", "fandom", "youtube", "youtu", "twitch",
  "playstation", "xbox", "nintendo", "reddit", "google", "facebook", "twitter", "discord", "blog", "blogs", "news",
  "noticias", "forum", "forums", "guide", "guides", "guia", "guias", "trophy", "trophies", "trofeu", "trofeus",
  "achievement", "achievements", "conquista", "conquistas", "store", "loja", "play", "online", "world", "mundo", "site",
  "home", "help", "info", "official", "oficial", "walkthrough", "detonado", "fonte", "fontes", "revisao", "dicas",
]);

/**
 * Reader-facing texts the model may write that `guideProse` leaves out (it skips names on purpose): the cover's call
 * labels, the roadmap phase titles and the names of the items that are not achievements (an achievement's name is the
 * dossier's). Only the banned-expression check reads them.
 */
function shownNames(p: GuidePayloadV2): { where: string; key: string | null; text: string }[] {
  return [
    ...p.walkthrough.cover.calls.map((c) => ({ where: "a capa", key: null, text: c.label })),
    ...p.steps.map((s) => ({ where: `a etapa ${s.key ?? s.title}`, key: null, text: s.title })),
    ...p.walkthrough.chapters.flatMap((c) =>
      c.steps.flatMap((s) => s.items.filter((i) => !i.achievement).map((i) => ({ where: `o item ${i.key}`, key: i.key, text: i.name }))),
    ),
  ];
}

/**
 * Final review: every text the reader sees, one by one (a chapter's title and deadline apart), with where it is and its
 * walkthrough key: what the ban check reads. A code-owned text among them (`codeTexts`) is left to `bannedInCode`.
 */
function readerTexts(p: GuidePayloadV2): { where: string; key: string | null; text: string }[] {
  const w = p.walkthrough;
  return [
    { where: "a capa", key: null, text: w.cover.headline },
    { where: "a capa", key: null, text: w.cover.deck },
    { where: "a ficha", key: null, text: w.extraFacts.playthroughsNote },
    { where: "a ficha", key: null, text: w.extraFacts.difficultyNote },
    ...(p.overview ?? []).map((text) => ({ where: "a visão geral", key: null, text })),
    ...w.readFirst.flatMap((r) => [
      { where: `o "leia antes" "${r.title}"`, key: null, text: r.title },
      { where: `o "leia antes" "${r.title}"`, key: null, text: r.text },
    ]),
    ...p.steps.flatMap((s) => s.body.map((b) => ({ where: `a etapa ${s.key ?? s.title}`, key: null, text: blockText(b) }))),
    ...w.chapters.flatMap((c) => [
      { where: `o capítulo ${c.key}`, key: null, text: c.title },
      { where: `o capítulo ${c.key}`, key: null, text: c.deadline ?? "" },
      ...c.steps.flatMap((s) => [
        ...s.body.map((b) => ({ where: `o passo ${s.key}`, key: s.key, text: blockText(b) })),
        ...s.items.map((i) => ({ where: `o item ${i.key}`, key: i.key, text: i.location ?? "" })),
      ]),
    ]),
    ...shownNames(p),
  ].filter((x) => x.text.trim().length > 0);
}

/** Options of the deterministic checks besides the copy check's (final review). */
export type DeterministicOpts = {
  /** Texts the code wrote (its warnings, notes and fallbacks): never a writer problem (`bannedInCode`). */
  codeTexts?: ReadonlySet<string>;
  /** Walkthrough keys (items and steps) whose dossier facts name a fountain: "fonte" there is the game sense. */
  fountainKeys?: ReadonlySet<string>;
};

/**
 * Copy (9+ equal words), vocabulary ("platina") and banned-expression problems (`bannedExpressions`, with the run's
 * `sites` and the known `names` masked; kind "expressao"), in Portuguese, one per finding, with their key (the writer's
 * scope of the part that rewrites it). The code's own texts are never the writer's problem (`codeTexts`).
 */
export function deterministicProblems(
  p: GuidePayloadV2,
  sources: readonly string[],
  names: readonly string[] = [],
  sites: readonly string[] = [],
  opts: DeterministicOpts = {},
): { text: string; key: string | null; kind: "copia" | "vocabulario" | "expressao" }[] {
  const problems: { text: string; key: string | null; kind: "copia" | "vocabulario" | "expressao" }[] = [];
  for (const { where, key, text } of guideProse(p)) {
    for (const run of copiedRuns(text, sources, 9, names)) {
      problems.push({ key, kind: "copia", text: `Trecho copiado de uma fonte em ${where}: "${run}". Reescreva com palavras próprias (no máximo 8 palavras seguidas iguais).` });
    }
    if (/platin/i.test(text)) problems.push({ key, kind: "vocabulario", text: `Em ${where}, use "Tralked" no lugar de "platina".` });
  }
  // Review 2: a neutral message (it repeats neither the doubt nor the source talk to the writer).
  for (const { where, key, text } of readerTexts(p)) {
    if (opts.codeTexts?.has(text)) continue;
    const fountain = key !== null && Boolean(opts.fountainKeys?.has(key));
    for (const expression of bannedExpressions(text, sites, { names, fountain })) {
      problems.push({ key, kind: "expressao", text: `Em ${where}, não use a expressão "${expression}" no texto do guia.` });
    }
  }
  return problems;
}

/**
 * Final review: a banned expression in a text the code wrote (an anchor warning, an R39 note, a deadline or name from
 * the dossier, a fallback) is a robot bug, not the writer's: an internal error each, never a rewrite.
 */
export function bannedInCode(codeTexts: Iterable<string>, sites: readonly string[] = [], names: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const text of new Set(codeTexts)) {
    for (const expression of bannedExpressions(text, sites, { names })) {
      out.push(`texto do código com expressão proibida "${expression}": "${text.length > 120 ? `${text.slice(0, 119)}…` : text}"`);
    }
  }
  return out;
}
