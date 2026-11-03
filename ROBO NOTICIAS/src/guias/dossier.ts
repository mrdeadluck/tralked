import type { Dossier } from "../tralked.js";
import type { GuideCompat } from "./contract.js";
import { isRevisit, pageLabel, revisitPlace } from "./chapter-order.js";
import {
  buildSourceGroups,
  collectGoal,
  detectFragmentRules,
  leadClause,
  maxPartsPerUnit,
  PART_WORDS,
  partsPerUnit,
  singularName,
  singularPhrase,
  type FragmentRule,
} from "./crossref.js";
import { COMPLETE_SHARE, labelNamesType, partsTotalOf, type StatedTotal } from "./completeness.js";
import type { ExtractedFacts } from "./facts.js";
import { computeCompat, matchAchievements, normalizeName, similarity, steamApiNameFor, type SteamEntry } from "./match.js";
import type { SourceRole } from "./sources.js";

/** One achievement of the Steam master list, hidden ones included (`GET /dossie?all=1`). */
export type SteamAchievement = {
  platform: string;
  apiName: string;
  /** English name (schema `l=english`). */
  name: string;
  description: string | null;
  globalPct: number | null;
  hidden: boolean;
  /** Brazilian Portuguese name/description (schema `l=brazilian`); null when Steam has none. */
  namePt: string | null;
  descriptionPt: string | null;
};

/** What `api.dossier(slug)` returns for the guide robot: the news robot's Dossier with the full achievement list. */
export type GuideDossierSource = Omit<Dossier, "achievements"> & { achievements: SteamAchievement[] };

export type FactPlatform = "psn" | "steam" | "unknown";
export type SourceLink = { name: string; url: string };

/** An item of the walkthrough, merged across every source that lists it. Enough to write the step without the raw facts. */
export type DossierItem = {
  /** Alignment id: normalized chapter, type and index (or name). */
  id: string;
  kind: string;
  name: string;
  nameEn?: string;
  collectibleType?: string;
  index?: number;
  total?: number;
  location: string;
  missable: boolean;
  missableUntil?: string;
  /** Title of the chapter the `missableUntil` milestone points to (or its own chapter, see `deadlineAssumed`). */
  deadlineChapter?: string;
  /**
   * R20: no source gives a milestone that points to a chapter, so the deadline is the item's own chapter ("pegue
   * agora" before leaving it). The item goes to review.
   */
  deadlineAssumed?: boolean;
  returnLater: boolean;
  /** apiName of the Steam achievement this item is (matched). */
  achievement?: string;
  /** apiNames of the Steam achievements this item counts toward (matched). */
  countsFor: string[];
  /** Names of the independent source groups that list it. */
  sources: string[];
  /** Name + url of every page that lists it, for the credits. */
  sourceLinks: SourceLink[];
  /** Listed by >= 2 independent groups. */
  agreed: boolean;
  platforms: FactPlatform[];
  /** Sources contradict each other (total, missable, until). Task 8 maps it to `review = true`. */
  conflict?: string;
  /**
   * The source numbers everything on its page in one running sequence (PowerPyx: #1 Bell, #2 Tale, #3 Bell...):
   * `index` was renumbered per collectible type within the chapter, and only counts within it.
   */
  numbering?: "chapter";
  /** Its chapter is a revisit whose place in the game the primary script does not state: it goes to review. */
  orderAssumed?: boolean;
  /**
   * R28: it counts toward a "collect N" and its source gives no number: it got the next number of its type in its
   * chapter (the source lists in route order), and goes to review.
   */
  numberAssumed?: boolean;
  /** Its page's extraction brought more than 110% of the entries the page lists: it never closes a "collect N". */
  suspect?: boolean;
  /**
   * Task 18: linked by the code to a "collect N <type>" achievement because its type is that thing (no source links
   * it). "ambiguous": the type only contains the name, or the sources say one unit has a varying number of parts
   * (2-6 petals): it goes to review.
   */
  countedByType?: "exact" | "ambiguous";
};

export type DossierChapter = {
  title: string;
  region?: string;
  order: number;
  items: DossierItem[];
  /** Goes back to a place already visited ("Clean Up Visits", "Second Visit", "Crimson Forest Cleanup #3"). */
  revisit?: boolean;
  /**
   * A revisit whose position the primary script does not state (each region page's own "Clean Up Visits"): placed
   * after the last first visit, its items go to review.
   */
  orderAssumed?: boolean;
};

/**
 * An item of a secondary source that matches no item of the primary script: it only corroborates. It never gets a
 * place in the route (no invented position); the report lists it as "not placed" with what the source says of it.
 */
export type CorroborationOnly = {
  name: string;
  nameEn?: string;
  kind: string;
  collectibleType?: string;
  /** The source's chapter it came from. */
  chapter: string;
  source: string;
  missable: boolean;
  missableUntil?: string;
  returnLater: boolean;
  /** Steam apiNames it counts toward (matched). */
  countsFor: string[];
  /** What it counts toward as the source wrote it (also what matches no Steam achievement). */
  countsForEn: string[];
};

export type DossierAchievement = {
  apiName: string;
  /** Steam English name. */
  nameEn: string;
  namePt: string | null;
  description: string | null;
  descriptionPt: string | null;
  hidden: boolean;
  globalPct: number | null;
  howTo?: string;
  missable: boolean;
  missableUntil?: string;
  /** The chapter by whose end it is lost: the guide never places it later. */
  deadlineChapter?: string;
  /**
   * R20: the deadline is the chapter of the item that is this achievement (no milestone points to a chapter). Task
   * 18: or the code read `warnChapter` from its texts.
   */
  deadlineAssumed?: boolean;
  /**
   * Task 18: a loose missable with no deadline of its own: the chapter its texts tie it to (the milestone's region or
   * boss, else the earliest region of the how-to...). The guide warns there ("start or collect before here"); it is no
   * limit to where the achievement is done.
   */
  warnChapter?: string;
  /** The last region, boss or quest its texts name: where the code puts it when the writer does not (never a limit). */
  doneChapter?: string;
  bugged: boolean;
  bugNote?: string;
  online: boolean;
  /** Independent groups that cover it, in an achievement entry or in an item. Empty = nobody covers it. */
  sources: string[];
  sourceLinks: SourceLink[];
  agreed: boolean;
  /** Not on the PSN list the sources gave (or there is no PSN list). */
  steamOnly: boolean;
  /** At least one covering source is `platform: "steam"`. */
  steamSourced: boolean;
  /** "Collect N" achievements: N and what the items add up to (fragments converted by the rule). */
  collect?: {
    target: number;
    counted: number;
    /** Where N came from: the achievement text, or the `total` the sources print on the items. */
    from: "texto" | "total";
    /**
     * R23: the count must be exactly N only when a source says the game has exactly N (N came from the totals the
     * items print, or they print the same N as the text). Otherwise "collect N" asks for at least N, and every item
     * the sources list stays in the guide.
     */
    exact: boolean;
    /** Distinct `total`s printed by the counting items when the text gave no N and they disagree. */
    conflictingTotals: number[];
    /** Counting items with no location. */
    withoutLocation: string[];
    /** Problems with the numbering of the counting items (duplicates, absent; at least N: an item without number). */
    indexProblems: string[];
    /**
     * Task 18: the route's items of the type the text names were counted ("Collect 30 Accessories"). `unconverted`:
     * parts of that thing ("Sha-Chi Amber Fragment") left out because no source says how many make one.
     */
    byType?: { type: string; ambiguous: boolean; unconverted: number };
    /**
     * R39: still short after the re-reads, by less than one whole unit, and a source states a game total of the thing
     * (or of its parts) that reaches N: the gate lets it pass, the guide says how many the sources locate (a code note)
     * and the achievement goes to review. Numbers in the stated total's own unit (shards when it counts shards).
     */
    shortfallAccepted?: { located: number; stated: number; missing: number; label: string; source: string };
  };
  /** Sources contradict each other on missable / until. Task 8 maps it to `review = true`. */
  conflict?: string;
};

/** apiName -> the achievement's names in other Steam languages (`steam-aliases.ts`). */
export type AchievementAliases = Record<string, string[]>;

export type Scalar<T> = { value: T; sources: string[]; agreed: boolean };

/** The whole PSN trophy list as one complete PSN script gives it (R22: the guide may follow it). */
export type PsnTrophyList = {
  /** Trophies on the list, platinum included (the source's trophy count). */
  total: number;
  /** English names as the source lists them: exactly `total`. */
  names: string[];
  /** The source group that gave the list. */
  source: string;
  /**
   * Each name and the Steam achievement it is; none for the platinum and for a trophy with no Steam twin. The
   * platinum comes from the trophy grade the source shows (themed names), else from a "get all trophies" how-to.
   */
  matches: { name: string; apiName?: string; platinum: boolean }[];
};

export type GuideDossier = {
  chapters: DossierChapter[];
  achievements: DossierAchievement[];
  facts: {
    playthroughs?: Scalar<{ min: number; note: string }>;
    difficulty?: Scalar<{ value: number; note: string }>;
    hours?: Scalar<{ min: number; max: number }>;
    roadmap: { title: string; summary: string; sources: string[] }[];
    psnTrophyListSize?: number;
    /** The full PSN list, when a complete PSN script names every trophy (count and names). */
    psnList?: PsnTrophyList;
    /** Seal computed from the PSN list the sources gave. */
    compat: GuideCompat;
    /** "N fragments = 1 unit" as the sources state it. */
    fragmentRules: FragmentRule[];
  };
  /** Script sources (roteiro_*), one per independent group: is the group complete? Input of gate rule (e). */
  scripts: { name: string; complete: boolean }[];
  /**
   * The primary script (the complete PSN script, PowerPyx and its region pages; else the complete Steam script) and
   * its chapters in its own order: the guide's chapters follow it (the chronology check).
   */
  primaryScript?: { name: string; chapters: string[] };
  /**
   * Items of secondary sources that match no item of the primary script (never a chapter of their own). Their
   * achievements still count as covered by that source.
   */
  corroborationOnly: CorroborationOnly[];
  /**
   * Items the primary script names only in its roadmap stages ("Step N") and that match no item of the route: no
   * secondary source, but no place in the route either. Listed apart in the report.
   */
  stageOnly: CorroborationOnly[];
  /** Plain Portuguese sentences; they never fail the gate by themselves. */
  divergences: string[];
  /**
   * R32: pages of the primary script whose extraction stayed incomplete after the second reading (under 90% of the
   * entries, or under the total of a type a "collect N" counts). Each one is a gap of the gate. Absent on old dossiers.
   */
  extractionGaps?: string[];
  /**
   * Pages that could not be read or extracted. Task 25 review: with the source's role, and `blocked` when the page can
   * never be read (a challenge page, robots.txt): only then is a missing piece truly "not mapped" by the sources (R39).
   */
  unreadSources: UnreadSource[];
};

export type UnreadSource = { name: string; url: string; reason: string; role?: SourceRole; blocked?: boolean };

/** An unread page that no retry can read (challenge page, robots.txt); older dossiers only have the reason. */
export const blockedForGood = (u: UnreadSource) => u.blocked ?? /^(página de desafio|bloqueada pelo)/.test(u.reason);

const ROLE_ORDER: Record<SourceRole, number> = { roteiro_psn: 0, roteiro_steam: 1, coletaveis: 2, confirmacao: 3 };

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * The facts of the primary script, in reading order: the first complete PSN script (PowerPyx), else the first
 * complete Steam script, plus the pages of the same guide (same site, "PowerPyx (Crimson Forest)" for "PowerPyx").
 * Empty when no script is complete.
 */
function primaryFacts(facts: ExtractedFacts[]): ExtractedFacts[] {
  const lead =
    facts.find((f) => f.source.role === "roteiro_psn" && f.complete) ?? facts.find((f) => f.source.role === "roteiro_steam" && f.complete);
  if (!lead) return [];
  const host = hostOf(lead.source.url);
  const name = lead.source.name;
  return facts.filter((f) => f === lead || (hostOf(f.source.url) === host && f.source.name.startsWith(`${name} (`)));
}

/** Every warning about missables left out of the route carries this: the report never cuts those lines. */
export const UNPLACED_MARK = "fora da rota (sem posição)";

/** "Obtain all trophies": what the platinum asks for. */
const ALL_TROPHIES = /\b(?:all|every)\b[^.]*\btroph|\btodos os trofeus\b/i;

type TrophyEntry = { name: string; apiName?: string; grade?: string; howTo?: string };

/**
 * Which trophies of a PSN list are the platinum (it has no Steam twin, and often a themed name): the ones the
 * source grades "platinum"; else the single trophy with no Steam twin whose how-to is "get all trophies"; else, as a
 * last resort, the single trophy with no Steam twin named "platinum". More than one graded platinum is returned as
 * is: the gate refuses such a list.
 */
function platinumIndexes(entries: TrophyEntry[]): number[] {
  const graded = entries.flatMap((e, i) => (e.grade === "platinum" ? [i] : []));
  if (graded.length > 0) return graded;
  const loose = entries.flatMap((e, i) => (e.apiName ? [] : [i]));
  const allTrophies = loose.filter((i) => ALL_TROPHIES.test(plain(entries[i]!.howTo ?? "")));
  if (allTrophies.length === 1) return allTrophies;
  const named = loose.filter((i) => /platin/.test(normalizeName(entries[i]!.name)));
  return named.length === 1 ? named : [];
}

const FRAGMENT_WORD = /\b(fragment\w*|shard\w*|piece\w*|pedaco\w*)\b/;

function plain(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

type Acc = Omit<DossierItem, "sources" | "sourceLinks" | "agreed" | "platforms" | "countsFor" | "achievement" | "id"> & {
  id: string;
  achievementNameEn?: string;
  countsForEn: string[];
  groups: Set<string>;
  links: Map<string, SourceLink>;
  platforms: Set<FactPlatform>;
  missSeen: Set<boolean>;
  conflicts: string[];
};

const singular = (word: string) => word.replace(/s$/, "");

function alignId(chapter: string, item: ExtractedFacts["chapters"][number]["items"][number]) {
  const type = singular(normalizeName(item.collectibleType ?? item.kind));
  const tail = item.index !== undefined ? String(item.index) : `name:${normalizeName(item.nameEn ?? item.name)}`;
  return `${normalizeName(chapter)}|${type}|${tail}`;
}

/**
 * The chapter a "until X" milestone belongs to, looking only at or after `from` (the missable's own chapter: a
 * deadline never comes before the item can be had, so the guide's warning always precedes it): X names a chapter,
 * or an item inside one. Failing that, X names a region ("Crimson Forest region main boss"): the first chapter of
 * that region. That last one is the code's reading of the milestone, not a chapter the source named: `assumed`, so
 * it goes to review. A milestone that only matches earlier chapters matches nothing (R20 then takes the own chapter).
 */
function chapterForMilestone(
  milestone: string | undefined,
  chapters: DossierChapter[],
  from = 0,
): { title: string; assumed: boolean } | undefined {
  if (!milestone) return undefined;
  const wanted = normalizeName(milestone);
  if (wanted.length < 3) return undefined;
  const ahead = chapters.slice(Math.max(0, from));
  for (const chapter of ahead) {
    const title = normalizeName(chapter.title);
    if (title.length >= 3 && (wanted.includes(title) || title.includes(wanted))) return { title: chapter.title, assumed: false };
  }
  for (const chapter of ahead) {
    for (const item of chapter.items) {
      for (const name of [item.nameEn, item.name]) {
        const n = name ? normalizeName(name) : "";
        if (n.length >= 3 && (wanted.includes(n) || n.includes(wanted))) return { title: chapter.title, assumed: false };
      }
    }
  }
  const title = regionChapter(milestone, chapters, from);
  return title ? { title, assumed: true } : undefined;
}

/** Words that never tell one place, thing or phrase from another. */
const STOP = new Set(["the", "of", "a", "an", "and", "or", "to", "in", "on", "at", "for", "de", "do", "da", "dos", "das", "o", "os", "e", "no", "na"]);
const wordsOf = (text: string) => normalizeName(text).split(" ").filter((w) => w && !STOP.has(w));

/**
 * The first chapter, at or after `from`, of each region the text names, in route order. The region's words in any
 * order ("Weeping Valley Creek" is "Weeping Creek Valley"); "Crimson Manor" names no "Crimson Forest".
 */
function regionIndexes(text: string | undefined, chapters: DossierChapter[], from: number): number[] {
  if (!text) return [];
  const words = new Set(wordsOf(text));
  const seen = new Set<string>();
  const out: number[] = [];
  chapters.forEach((c, at) => {
    const region = wordsOf(c.region ?? "");
    const key = region.join(" ");
    if (at < from || key.replace(/ /g, "").length < 3 || seen.has(key) || !region.every((w) => words.has(w))) return;
    seen.add(key);
    out.push(at);
  });
  return out;
}

/** The earliest chapter, at or after `from`, of a region the text names. */
function regionChapter(text: string | undefined, chapters: DossierChapter[], from: number): string | undefined {
  const at = regionIndexes(text, chapters, from)[0];
  return at === undefined ? undefined : chapters[at]!.title;
}

/** Words that name no boss, NPC or quest of their own ("an optional boss", "the normal final boss"). */
const GENERIC = new Set([
  "boss", "bosses", "enemy", "enemies", "area", "region", "optional", "final", "normal", "main", "all", "every", "game", "story", "side",
  "quest", "quests", "tale", "tales", "trophy", "achievement", "defeat", "complete", "completing", "collect", "obtain", "awarded", "first",
  "after", "before", "during", "through", "each", "with", "from", "into", "this", "that", "then", "when", "where", "midway", "end",
]);

/**
 * The bosses, NPCs and quests a text names, as written: what it puts in brackets ("Complete [A Severed Mindseal]")
 * and what it says to defeat ("Defeat Meng Hua, the Merciful Lady...", "defeating Jing Ye, The Outlaw / Bai
 * Chilian"), cut at commas, colons, slashes and "and". Task 23: the copy check takes them as known names too.
 */
export function targetNames(text: string | null | undefined): string[] {
  if (!text) return [];
  const names = [
    ...[...text.matchAll(/[[【「『]([^\]】」』]{3,80})[\]】」』]/g)].map((m) => m[1]!),
    ...[...text.matchAll(/\b(?:defeat|beat|kill|slay)(?:s|ed|ing)?\s+([^.;()[\]]+)/gi)].flatMap((m) => m[1]!.split(/[,:/]|\band\b/i)),
  ];
  // Not the generic pieces ("the normal final boss"): they name nothing of their own.
  return names.filter((name) => {
    const words = wordsOf(name);
    return words.length > 0 && words.join("").length >= 4 && !words.some((w) => GENERIC.has(w));
  });
}

/** `targetNames` of an achievement's texts, each as its words. */
function namedTargets(texts: (string | null | undefined)[]): string[][] {
  return texts.flatMap((text) => targetNames(text).map(wordsOf));
}

/**
 * The first chapter, at or after `from`, holding a route item each target names: by the item's name, or also by its
 * text when `byText` ("Reward for defeating Jing Ye, The Outlaw" is where Jing Ye falls).
 */
function targetIndexes(targets: string[][], chapters: DossierChapter[], from: number, byText: boolean): number[] {
  const out = new Set<number>();
  for (const target of targets) {
    const at = chapters.findIndex(
      (c, i) =>
        i >= from &&
        c.items.some((item) => {
          const words = new Set(wordsOf(`${item.name} ${item.nameEn ?? ""}${byText ? ` ${item.location}` : ""}`));
          return target.every((w) => words.has(w));
        }),
    );
    if (at >= 0) out.add(at);
  }
  return [...out];
}

/**
 * Phrases that tie an achievement to a place by text: its own name (two words or more) and the pairs of adjacent
 * distinctive words of its texts ("completing the true ending" -> "true ending").
 */
function mentionPhrases(nameEn: string, texts: (string | null | undefined)[]): string[] {
  const phrases = new Set<string>();
  const name = wordsOf(nameEn);
  if (name.length >= 2) phrases.add(normalizeName(nameEn));
  for (const text of texts) {
    if (!text) continue;
    const words = normalizeName(text).split(" ");
    for (let i = 0; i + 1 < words.length; i++) {
      const [a, b] = [words[i]!, words[i + 1]!];
      if (a.length >= 4 && b.length >= 4 && !STOP.has(a) && !STOP.has(b) && !GENERIC.has(a) && !GENERIC.has(b)) phrases.add(`${a} ${b}`);
    }
  }
  return [...phrases];
}

/**
 * Task 18 (B): where a loose missable achievement (no item of the route is it, no milestone names a chapter or an
 * item) is anchored, read from its texts. The anchor (`warn`) is where the guide warns "start or collect before
 * here": (1) the milestone, whole: a region it names, else a boss or NPC it names (a route item's name or text);
 * else (2) the earliest region its how-to names; else (3) a boss, NPC or quest it names that is a route item; else
 * (4) a route item whose name or location mentions it. `done` is the last region, boss or quest its texts name: the
 * code's default spot for it, never a limit (finishing may come later than any warning). Always at or after `from`.
 */
function looseAnchor(
  a: { nameEn: string; description: string | null; missableUntil?: string },
  howTos: string[],
  chapters: DossierChapter[],
  from: number,
): { warn: string; done: string } | undefined {
  // "Entering Pangzhen": the warning belongs to the chapter before the region's first one.
  const entering = /\b(?:enter|entering|reach|reaching|arrive|arriving)\b/i.test(a.missableUntil ?? "");
  const untilRegions = regionIndexes(a.missableUntil, chapters, from).map((at) => (entering ? Math.max(from, at - 1) : at));
  const until = untilRegions.length > 0 ? untilRegions : targetIndexes(namedTargets([a.missableUntil]), chapters, from, true);
  const regions = howTos.flatMap((t) => regionIndexes(t, chapters, from));
  const targets = targetIndexes(namedTargets([a.description, ...howTos]), chapters, from, false);
  const phrases = mentionPhrases(a.nameEn, [a.description, ...howTos]);
  const mentioned = chapters.findIndex(
    (c, i) => i >= from && c.items.some((item) => phrases.some((p) => ` ${normalizeName(`${item.name} ${item.location}`)} `.includes(` ${p} `))),
  );
  const first = (list: number[]) => (list.length > 0 ? Math.min(...list) : undefined);
  const warn = first(until) ?? first(regions) ?? first(targets) ?? (mentioned >= 0 ? mentioned : undefined);
  if (warn === undefined) return undefined;
  const done = Math.max(warn, ...until, ...regions, ...targets);
  return { warn: chapters[warn]!.title, done: chapters[done]!.title };
}

type Shortfall = NonNullable<ExtractedFacts["shortfall"]>;
const entriesShort = (s: Shortfall) => s.extracted < COMPLETE_SHARE * s.stated;
const incompleteSentence = (f: ExtractedFacts) =>
  `Extração incompleta: ${f.source.name} diz ter ${f.shortfall!.stated} entradas e a extração trouxe ${f.shortfall!.extracted}, ` +
  "mesmo relendo a página em partes; a rota dessa página pode estar incompleta. Revise antes de publicar.";
const typeSentence = (f: ExtractedFacts, t: NonNullable<Shortfall["types"]>[number]) =>
  `Extração incompleta: ${f.source.name} diz ter ${t.stated} "${t.label}" e a extração trouxe ${t.extracted}, mesmo relendo a página em partes`;

/** Free-form regions name the same place: equal, or one contains the other ("Crimson Forest" / "The Crimson Forest"). */
const sameRegion = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);

const ROMAN = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)$/;
/** The numbers in a normalized name, digits and roman numerals ("book reflections ii" -> "ii"). */
const numbersIn = (name: string) => name.split(" ").filter((w) => /^\d+$/.test(w) || ROMAN.test(w)).join(" ");

/** `uid`: creation number, part of the items' alignment ids (the list order may change as chapters are inserted). */
type ChapterAcc = {
  title: string;
  region?: string;
  norm: string;
  regionNorm: string;
  uid: number;
  items: Map<string, Acc>;
  revisit: boolean;
  orderAssumed: boolean;
};

/**
 * The dossier chapter a source's chapter joins, if any. Chapters merge by title; they split by region only when
 * both have a region and the regions differ ("First Visit" of Crimson Forest and of Meigu Lake). A chapter without
 * region joins the only chapter of that title; with several of different regions it stays apart (no guessing).
 * `adopt`: a region-less chapter of that title found by a chapter with region takes the region (the merge itself;
 * a mere lookup leaves it alone).
 */
function findChapter(list: ChapterAcc[], title: string, region: string | undefined, adopt: boolean): ChapterAcc | undefined {
  const norm = normalizeName(title);
  const regionNorm = normalizeName(region ?? "");
  const same = list.filter((c) => c.norm === norm);
  if (!regionNorm) return same.length === 1 ? same[0] : same.find((c) => !c.regionNorm);
  const found = same.find((c) => c.regionNorm && sameRegion(c.regionNorm, regionNorm));
  if (found) return found;
  // A region-less chapter of that title takes the region, unless other regions already claim the title.
  if (same.length === 1 && !same[0]!.regionNorm) {
    if (adopt) {
      same[0]!.region = region;
      same[0]!.regionNorm = regionNorm;
    }
    return same[0];
  }
  return undefined;
}

type SourceChapter = { title: string; region?: string };

/**
 * Without a primary script: the chapter of `chapters[at]` (one source's chapters, in its order), created when no
 * dossier chapter matches. A new chapter keeps the source's order around the chapters already there: right after
 * `previous` (the chapter before it in this source); with none, right before the next chapter of this source
 * already in the list; with neither (the source shares no chapter with the list yet), at the end.
 */
function chapterFor(
  list: ChapterAcc[],
  chapters: SourceChapter[],
  at: number,
  create: () => ChapterAcc,
  previous: ChapterAcc | undefined,
): ChapterAcc {
  const { title, region } = chapters[at]!;
  const found = findChapter(list, title, region, true);
  if (found) return found;
  const created = create();
  let index = list.length;
  if (previous) {
    index = list.indexOf(previous) + 1;
  } else {
    const next = chapters.slice(at + 1).map((c) => findChapter(list, c.title, c.region, false)).find((c) => c !== undefined);
    if (next) index = list.indexOf(next);
  }
  list.splice(index, 0, created);
  return created;
}

function pickScalar<T>(
  facts: ExtractedFacts[],
  nameOf: (f: ExtractedFacts) => string,
  read: (f: ExtractedFacts) => T | undefined,
  key: (v: T) => string,
  show: (v: T) => string,
  label: string,
  divergences: string[],
): Scalar<T> | undefined {
  const withValue = facts.filter((f) => read(f) !== undefined);
  const first = withValue[0];
  if (!first) return undefined;
  const value = read(first)!;
  const same = withValue.filter((f) => key(read(f)!) === key(value));
  const sources = [...new Set(same.map(nameOf))];
  const other = withValue.filter((f) => !same.includes(f));
  if (other.length > 0) {
    divergences.push(
      `${label}: ${sources.join(", ")} diz ${show(value)}, mas ${[...new Set(other.map(nameOf))].join(", ")} diz ${show(read(other[0]!)!)}.`,
    );
  }
  return { value, sources, agreed: sources.length >= 2 };
}

/**
 * Numbers that run across collectible types on one page (#1 Bell, #2 Tale, #3 Bell...: PowerPyx) say nothing about
 * "n of a type": such a page gets its items renumbered per type within each chapter (and loses their totals). The
 * renumbered items are recorded in `numbered`.
 */
function renumberRunning(fact: ExtractedFacts, numbered: Set<object>): ExtractedFacts {
  const chapters = [...fact.chapters].sort((a, b) => a.order - b.order);
  const indexed = chapters.flatMap((c) => c.items).filter((i) => i.index !== undefined);
  const typeOf = (i: (typeof indexed)[number]) => singular(normalizeName(i.collectibleType ?? i.kind));
  const running =
    indexed.length >= 3 && new Set(indexed.map(typeOf)).size >= 2 && indexed.every((i, n) => n === 0 || i.index! > indexed[n - 1]!.index!);
  if (!running) return fact;
  return {
    ...fact,
    chapters: fact.chapters.map((c) => {
      const counters = new Map<string, number>();
      return {
        ...c,
        items: c.items.map((i) => {
          if (i.index === undefined) return i;
          const n = (counters.get(typeOf(i)) ?? 0) + 1;
          counters.set(typeOf(i), n);
          const { total: _total, ...rest } = i;
          const copy = { ...rest, index: n };
          numbered.add(copy);
          return copy;
        }),
      };
    }),
  };
}

/**
 * Cross-references the extracted facts into one dossier, pure code, no AI. With a primary script (complete
 * PowerPyx and its region pages, else a complete Steam guide), it alone makes the chapters, in its own order:
 * its pages in the order they state ("is the 2nd region", `sequence`: url -> number), the roadmap's "Step N"
 * as phases, its own unplaced revisits after the last first visit. The other sources only add their names to the
 * primary's items they match (by achievement, name, or type and number in the same place); what matches nothing
 * only corroborates. Achievements are tied to the Steam master list, every fact counts its independent sources
 * (`groups` from `independentGroups`) and disagreements are recorded.
 */
export function buildDossier(
  fullList: SteamAchievement[],
  rawFacts: ExtractedFacts[],
  groups: string[][],
  unreadSources: GuideDossier["unreadSources"] = [],
  aliases: AchievementAliases = {},
  sequence: Record<string, number> = {},
  /** url -> the game's totals the page states (`statedGameTotals`): R39. */
  statedTotals: Record<string, StatedTotal[]> = {},
): GuideDossier {
  // `?all=1` returns the rows of every platform; the master list is the Steam ones only.
  const steamList = fullList.filter((s) => s.platform === "steam");
  const chapterNumbered = new Set<object>();
  const byRole = rawFacts
    .map((f) => renumberRunning(f, chapterNumbered))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => ROLE_ORDER[a.f.source.role] - ROLE_ORDER[b.f.source.role] || a.i - b.i)
    .map((x) => x.f);
  // The primary script goes first.
  const primary = primaryFacts(byRole);
  const facts = [...primary, ...byRole.filter((f) => !primary.includes(f))];
  const { nameOf } = buildSourceGroups(facts, groups);
  // An extraction that stayed short of what its page says it lists, even read again in parts (extract.ts): first,
  // so a cut report keeps it.
  const divergences: string[] = facts.flatMap((f) => [
    ...(f.shortfall && entriesShort(f.shortfall) ? [incompleteSentence(f)] : []),
    ...(f.shortfall?.types ?? []).map((t) => `${typeSentence(f, t)}.`),
    ...(f.suspect
      ? [
          `Extração suspeita: ${f.source.name} diz ter ${f.suspect.stated} entradas e a extração trouxe ${f.suspect.extracted} (mais de 110%); ` +
            'os itens dessa página não fecham contagem de "coletar N". Revise antes de publicar.',
        ]
      : []),
  ]);
  const steam: SteamEntry[] = steamList.map((s) => ({
    apiName: s.apiName,
    name: s.name,
    description: s.description,
    aliases: aliases[s.apiName] ?? [],
  }));
  const steamBy = new Map(steamList.map((s) => [s.apiName, s]));
  const apiNameCache = new Map<string, string | undefined>();
  const toApiName = (nameEn: string) => {
    if (!apiNameCache.has(nameEn)) apiNameCache.set(nameEn, steamApiNameFor(steam, { nameEn }));
    return apiNameCache.get(nameEn);
  };

  // --- chapters and items -------------------------------------------------------------------------------------
  type FactItem = ExtractedFacts["chapters"][number]["items"][number];
  const newAcc = (id: string, item: FactItem): Acc => ({
    id,
    kind: item.kind,
    name: item.name,
    nameEn: item.nameEn,
    collectibleType: item.collectibleType,
    index: item.index,
    total: item.total,
    location: item.location,
    missable: false,
    returnLater: false,
    countsForEn: [],
    groups: new Set(),
    links: new Map(),
    platforms: new Set(),
    missSeen: new Set(),
    conflicts: [],
    ...(chapterNumbered.has(item) ? { numbering: "chapter" as const } : {}),
  });
  /**
   * One more source for `acc`. A corroborating source never types or numbers it (it may name and count otherwise,
   * in another language).
   */
  const merge = (acc: Acc, item: FactItem, fact: ExtractedFacts, corroborating: boolean) => {
    acc.nameEn ??= item.nameEn;
    if (!corroborating) acc.collectibleType ??= item.collectibleType;
    if (!corroborating) acc.index ??= item.index;
    if (acc.total !== undefined && item.total !== undefined && acc.total !== item.total) {
      acc.conflicts.push(`total ${acc.total} numa fonte e ${item.total} em ${nameOf(fact)}`);
    }
    if (!corroborating) acc.total ??= item.total;
    acc.location ||= item.location;
    acc.missSeen.add(item.missable);
    if (acc.missSeen.size > 1 && !acc.conflicts.some((c) => c.startsWith("perdível"))) {
      acc.conflicts.push(`perdível segundo uma fonte e não perdível segundo ${nameOf(fact)}`);
    }
    acc.missable ||= item.missable;
    if (acc.missableUntil && item.missableUntil && normalizeName(acc.missableUntil) !== normalizeName(item.missableUntil)) {
      acc.conflicts.push(`prazo "${acc.missableUntil}" numa fonte e "${item.missableUntil}" em ${nameOf(fact)}`);
    }
    acc.missableUntil ??= item.missableUntil;
    acc.returnLater ||= item.returnLater;
    acc.achievementNameEn ??= item.achievementNameEn;
    for (const c of item.countsForEn) if (!acc.countsForEn.includes(c)) acc.countsForEn.push(c);
    acc.groups.add(nameOf(fact));
    acc.links.set(fact.source.url, { name: fact.source.name, url: fact.source.url });
    acc.platforms.add(fact.platform);
  };
  /** The chapter's items, aligned by type and index (or name); the n-th repeat of a name is an item of its own. */
  const addItems = (target: ChapterAcc, items: FactItem[], fact: ExtractedFacts) => {
    const seen = new Map<string, number>();
    for (const item of items) {
      const base = alignId(`${target.norm} ${target.uid}`, item);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const id = n === 1 ? base : `${base}#${n}`;
      let acc = target.items.get(id);
      if (!acc) {
        acc = newAcc(id, item);
        target.items.set(id, acc);
      }
      merge(acc, item, fact, false);
      if (fact.suspect) acc.suspect = true;
    }
  };
  const byOrder = (chapters: ExtractedFacts["chapters"]) => [...chapters].sort((a, b) => a.order - b.order);
  const orphan = (item: FactItem, chapter: string, source: string): CorroborationOnly => ({
    name: item.name,
    ...(item.nameEn ? { nameEn: item.nameEn } : {}),
    kind: item.kind,
    ...(item.collectibleType ? { collectibleType: item.collectibleType } : {}),
    chapter,
    source,
    missable: item.missable,
    ...(item.missableUntil ? { missableUntil: item.missableUntil } : {}),
    returnLater: item.returnLater,
    countsFor: [...new Set(item.countsForEn.map(toApiName).filter((x): x is string => x !== undefined))],
    countsForEn: [...item.countsForEn],
  });

  let chapterList: ChapterAcc[] = [];
  const corroborationOnly: CorroborationOnly[] = [];
  const stageOnly: CorroborationOnly[] = [];
  const stageItems: { item: FactItem; chapter: string }[] = [];
  let phaseChapters: { title: string; summary: string }[] = [];
  let uids = 0;
  const created = (title: string, region: string | undefined): ChapterAcc => ({
    title,
    region,
    norm: normalizeName(title),
    regionNorm: normalizeName(region ?? ""),
    uid: ++uids,
    items: new Map(),
    revisit: false,
    orderAssumed: false,
  });

  const lead = primary[0];
  if (lead) {
    // The primary script alone makes the chapters. Its pages go in the order the source states for them ("is the
    // 2nd region"); a page that states none goes after those that do, in the order it came.
    const pages = [
      lead,
      ...primary
        .slice(1)
        .map((f, i) => ({ f, i, at: sequence[f.source.url] ?? Number.POSITIVE_INFINITY }))
        .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at - b.at))
        .map((x) => x.f),
    ];
    // The roadmap page's "Step N" chapters are its phases (roadmap stages), not chapters.
    const leadChapters = byOrder(lead.chapters);
    const roadmapTitles = new Set((lead.roadmap ?? []).map((r) => normalizeName(r.title)));
    const allEmpty = leadChapters.length > 0 && leadChapters.every((c) => c.items.length === 0);
    const isPhase = (fact: ExtractedFacts, c: ExtractedFacts["chapters"][number]) =>
      fact === lead && (roadmapTitles.has(normalizeName(c.title)) || (allEmpty && c.items.length === 0));
    phaseChapters = leadChapters.filter((c) => isPhase(lead, c)).map((c) => ({ title: c.title, summary: "" }));

    const main: ChapterAcc[] = [];
    const later: ChapterAcc[] = [];
    for (const page of pages) {
      const ordered = byOrder(page.chapters);
      const pageRegion = ordered.find((c) => c.region && !isRevisit(c.title))?.region ?? pageLabel(page.source.name);
      const pageRegionNorm = normalizeName(pageRegion ?? "");
      for (const chapter of ordered) {
        if (isPhase(page, chapter)) {
          // A stage's items are no steps of their own: matched against the route below (their achievements stay
          // covered either way).
          for (const item of chapter.items) stageItems.push({ item, chapter: chapter.title });
          continue;
        }
        // A heading with nothing to pick up is no chapter.
        if (chapter.items.length === 0) continue;
        const revisit = isRevisit(chapter.title);
        // A revisit that names another place ("Crimson Forest Cleanup #3" on the Mirage Estate page) sits where
        // that page puts it: the source states its position. A page's own revisit ("Clean Up Visits") does not.
        const place = revisit ? revisitPlace(chapter.title) : "";
        const elsewhere = place.length >= 3 && !(pageRegionNorm.length >= 3 && sameRegion(place, pageRegionNorm));
        const assumed = revisit && !elsewhere;
        const region = chapter.region ?? (elsewhere ? undefined : pageRegion);
        const list = assumed ? later : main;
        let target = findChapter(list, chapter.title, region, true);
        if (!target) {
          target = created(chapter.title, region);
          list.push(target);
        }
        target.revisit ||= revisit;
        target.orderAssumed ||= assumed;
        addItems(target, chapter.items, page);
      }
    }
    // Revisits with no stated position go after the last first visit, in page order.
    chapterList = [...main, ...later];

    // Secondary sources never make chapters: their items join the primary's when they match, else corroborate.
    const slots = chapterList.flatMap((c) => [...c.items.values()].map((acc) => ({ acc, chapter: c })));
    type Slot = (typeof slots)[number];
    const namesOf = (names: (string | undefined)[]) =>
      [...new Set(names.filter((n): n is string => Boolean(n)).flatMap((n) => [n, ...n.split(/\s+\/\s+/)]).map(normalizeName))].filter(
        (n) => n.length >= 3,
      );
    const slotNames = new Map(slots.map((s) => [s.acc, namesOf([s.acc.nameEn, s.acc.name])]));
    const slotApi = new Map(slots.map((s) => [s.acc, s.acc.achievementNameEn ? toApiName(s.acc.achievementNameEn) : undefined]));
    const claimed = new Set<string>();
    // The roadmap stages' items: the route item with the same achievement or the only one with the same name.
    for (const { item, chapter } of stageItems) {
      const api = item.achievementNameEn ? toApiName(item.achievementNameEn) : undefined;
      const names = namesOf([item.nameEn, item.name]);
      const byApi = api ? slots.find((s) => slotApi.get(s.acc) === api) : undefined;
      const named = slots.filter((s) => slotNames.get(s.acc)!.some((n) => names.includes(n)));
      const found = byApi ?? (named.length === 1 ? named[0] : undefined);
      if (found) merge(found.acc, item, lead, true);
      else stageOnly.push(orphan(item, chapter, nameOf(lead)));
    }
    const unmatched: { item: FactItem; fact: ExtractedFacts; group: string; chapter: string; scope: Slot[] }[] = [];
    for (const fact of facts.filter((f) => !primary.includes(f))) {
      const group = nameOf(fact);
      const claim = (s: Slot) => `${group}|${s.chapter.uid}|${s.acc.id}`;
      for (const chapter of byOrder(fact.chapters)) {
        const t = normalizeName(chapter.title);
        const r = normalizeName(chapter.region ?? "");
        // The primary chapters this one can be: same region, else same title (or a title that names the region).
        const scope = slots.filter(({ chapter: c }) =>
          r
            ? c.regionNorm
              ? sameRegion(c.regionNorm, r)
              : c.norm === t
            : c.norm === t || (t.length >= 3 && c.regionNorm.length >= 3 && sameRegion(c.regionNorm, t)),
        );
        for (const item of chapter.items) {
          const api = item.achievementNameEn ? toApiName(item.achievementNameEn) : undefined;
          const names = namesOf([item.nameEn, item.name]);
          const type = singular(normalizeName(item.collectibleType ?? item.kind));
          // Same type and number, when both sources count the same way.
          const sameNumber = (s: Slot) =>
            item.index !== undefined &&
            s.acc.index === item.index &&
            singular(normalizeName(s.acc.collectibleType ?? s.acc.kind)) === type &&
            (s.acc.numbering === "chapter") === chapterNumbered.has(item);
          /**
           * The slot of `pool` that is this item: the same achievement; else the only one with its name (several:
           * the one with its number too); else, inside the same place, the only one with its type and number.
           */
          const pick = (pool: Slot[], scoped: boolean): Slot | "ambiguous" | undefined => {
            if (api) {
              const hit = pool.find((s) => !claimed.has(claim(s)) && slotApi.get(s.acc) === api);
              if (hit) return hit;
            }
            let named = pool.filter((s) => slotNames.get(s.acc)!.some((n) => names.includes(n)));
            if (named.length > 1) named = named.filter(sameNumber);
            if (named.length > 1) return "ambiguous";
            if (named.length === 1) return claimed.has(claim(named[0]!)) ? "ambiguous" : named[0];
            if (scoped) {
              const numbered = pool.filter(sameNumber);
              if (numbered.length === 1 && !claimed.has(claim(numbered[0]!))) return numbered[0];
            }
            return undefined;
          };
          let found = scope.length > 0 ? pick(scope, true) : undefined;
          if (found === undefined) found = pick(slots, false);
          if (found && found !== "ambiguous") {
            claimed.add(claim(found));
            merge(found.acc, item, fact, true);
          } else {
            unmatched.push({ item, fact, group, chapter: chapter.title, scope });
          }
        }
      }
    }
    // Once more by the English name alone: exactly, anywhere; or with a slip of spelling, but then only with the
    // same numbers (digits and roman numerals: "Fragment 8" is not "Fragment 7"), the same type and in the same
    // chapter or region. In doubt, no match.
    const typeOf = (kind: string, type: string | undefined) => singular(normalizeName(type ?? kind));
    for (const { item, fact, group, chapter, scope } of unmatched) {
      const claim = (s: Slot) => `${group}|${s.chapter.uid}|${s.acc.id}`;
      const en = item.nameEn ? normalizeName(item.nameEn) : "";
      let found: Slot | undefined;
      if (en.length >= 3) {
        const exact = slots.filter((s) => slotNames.get(s.acc)!.includes(en));
        const close =
          exact.length > 0 || en.length < 6
            ? exact
            : scope.filter(
                (s) =>
                  typeOf(s.acc.kind, s.acc.collectibleType) === typeOf(item.kind, item.collectibleType) &&
                  slotNames.get(s.acc)!.some((n) => numbersIn(n) === numbersIn(en) && similarity(n, en) >= 0.92),
              );
        if (close.length === 1 && !claimed.has(claim(close[0]!))) found = close[0];
      }
      if (found) {
        claimed.add(claim(found));
        merge(found.acc, item, fact, true);
      } else {
        corroborationOnly.push(orphan(item, chapter, group));
      }
    }
  } else {
    // No complete script: no primary order to follow (the gate refuses it anyway). Every source makes chapters.
    for (const fact of facts) {
      let previous: ChapterAcc | undefined;
      const ordered = byOrder(fact.chapters);
      for (const [at, chapter] of ordered.entries()) {
        const target = chapterFor(chapterList, ordered, at, () => created(chapter.title, chapter.region), previous);
        previous = target;
        addItems(target, chapter.items, fact);
      }
    }
  }

  // A title shared by chapters of different regions gets the region (and a number, as a last resort): every
  // chapter title stays unique.
  const titleCount = new Map<string, number>();
  for (const c of chapterList) titleCount.set(c.norm, (titleCount.get(c.norm) ?? 0) + 1);
  const shown = new Map<ChapterAcc, string>();
  const taken = new Set<string>();
  for (const c of chapterList) {
    const base = c.region && (titleCount.get(c.norm) ?? 0) > 1 ? `${c.title} — ${c.region}` : c.title;
    let title = base;
    for (let n = 2; taken.has(normalizeName(title)); n++) title = `${base} (${n})`;
    taken.add(normalizeName(title));
    shown.set(c, title);
  }

  const chapters: DossierChapter[] = chapterList.map((c, at) => ({
    title: shown.get(c)!,
    region: c.region,
    order: at + 1,
    ...(c.revisit ? { revisit: true } : {}),
    ...(c.orderAssumed ? { orderAssumed: true } : {}),
    items: [...c.items.values()].map((acc): DossierItem => {
      const { groups: g, links, platforms, achievementNameEn, countsForEn, missSeen: _m, conflicts, ...rest } = acc;
      const achievement = achievementNameEn ? toApiName(achievementNameEn) : undefined;
      if (achievementNameEn && !achievement) {
        divergences.push(`O item "${acc.name}" aponta para a conquista "${achievementNameEn}", que não existe na lista da Steam.`);
      }
      for (const x of conflicts) divergences.push(`O item "${acc.name}": ${x}.`);
      return {
        ...rest,
        achievement,
        countsFor: countsForEn.map(toApiName).filter((x): x is string => x !== undefined),
        sources: [...g],
        sourceLinks: [...links.values()],
        agreed: g.size >= 2,
        platforms: [...platforms],
        conflict: conflicts.length > 0 ? conflicts.join("; ") : undefined,
        ...(c.orderAssumed ? { orderAssumed: true } : {}),
      };
    }),
  }));
  // R30: a missable that only a secondary source lists stays out of the route (no invented position): warn.
  const lostOnes = corroborationOnly.filter((c) => c.missable);
  if (lostOnes.length > 0) {
    const n = lostOnes.length;
    const names = lostOnes.slice(0, 10).map((c) => c.name).join(", ");
    divergences.push(
      `${n} ${n === 1 ? "item perdível aparece só em fonte secundária e ficou" : "itens perdíveis aparecem só em fonte secundária e ficaram"} ${UNPLACED_MARK}: ` +
        `${names}${n > 10 ? ` (e mais ${n - 10})` : ""}. Revise antes de publicar: veja "Itens só de fonte secundária, não posicionados" no relatório.`,
    );
  }
  const stageLost = stageOnly.filter((c) => c.missable);
  if (stageLost.length > 0) {
    const n = stageLost.length;
    const names = stageLost.slice(0, 10).map((c) => c.name).join(", ");
    divergences.push(
      `${n} ${n === 1 ? "item perdível citado só nas etapas do roadmap do roteiro principal ficou" : "itens perdíveis citados só nas etapas do roadmap do roteiro principal ficaram"} ${UNPLACED_MARK}: ` +
        `${names}${n > 10 ? ` (e mais ${n - 10})` : ""}. Revise antes de publicar.`,
    );
  }

  chapters.forEach((chapter, at) => {
    for (const item of chapter.items) {
      const deadline = chapterForMilestone(item.missableUntil, chapters, at);
      if (deadline) {
        item.deadlineChapter = deadline.title;
        if (deadline.assumed) item.deadlineAssumed = true;
      }
      // R20: a missable whose milestone points to no chapter is picked up in its own chapter (and reviewed).
      if (item.missable && !item.deadlineChapter) {
        item.deadlineChapter = chapter.title;
        item.deadlineAssumed = true;
      }
    }
  });

  // --- fragments ----------------------------------------------------------------------------------------------
  const { rules: fragmentRules, conflicts } = detectFragmentRules(facts, nameOf);
  divergences.push(...conflicts);
  const weightOf = (item: DossierItem) => {
    if (item.suspect) return 0;
    const text = plain([item.collectibleType, item.nameEn, item.name].filter(Boolean).join(" "));
    if (!FRAGMENT_WORD.test(text)) return 1;
    const words = text.split(/[^a-z0-9]+/).filter(Boolean);
    const rule = fragmentRules.find((r) => words.some((w) => similarity(w, r.unit) >= 0.75));
    return rule ? 1 / rule.perUnit : 1;
  };

  // --- achievements -------------------------------------------------------------------------------------------
  type AchAcc = {
    howTo?: string;
    /** Every source's how-to, in source order (a fragment rule or a region may sit in any of them). */
    howTos: string[];
    missable: boolean;
    missableUntil?: string;
    bugged: boolean;
    bugNote?: string;
    online: boolean;
    groups: Set<string>;
    links: Map<string, SourceLink>;
    platforms: Set<FactPlatform>;
    missSeen: Set<boolean>;
    conflicts: string[];
  };
  const accs = new Map<string, AchAcc>();
  const accFor = (apiName: string) => {
    let a = accs.get(apiName);
    if (!a) {
      a = { howTos: [], missable: false, bugged: false, online: false, groups: new Set(), links: new Map(), platforms: new Set(), missSeen: new Set(), conflicts: [] };
      accs.set(apiName, a);
    }
    return a;
  };
  const touch = (a: AchAcc, fact: ExtractedFacts) => {
    a.groups.add(nameOf(fact));
    a.links.set(fact.source.url, { name: fact.source.name, url: fact.source.url });
    a.platforms.add(fact.platform);
  };
  for (const fact of facts) {
    for (const entry of fact.achievements) {
      const apiName = toApiName(entry.nameEn);
      if (!apiName) {
        divergences.push(`${fact.source.name} cita a conquista "${entry.nameEn}", que não casa com nenhuma da lista da Steam.`);
        continue;
      }
      const a = accFor(apiName);
      touch(a, fact);
      a.howTo ||= entry.howTo;
      if (entry.howTo && !a.howTos.includes(entry.howTo)) a.howTos.push(entry.howTo);
      a.missSeen.add(entry.missable);
      if (a.missSeen.size > 1 && !a.conflicts.some((c) => c.startsWith("perdível"))) {
        a.conflicts.push(`perdível segundo uma fonte e não perdível segundo ${nameOf(fact)}`);
      }
      a.missable ||= entry.missable;
      if (a.missableUntil && entry.missableUntil && normalizeName(a.missableUntil) !== normalizeName(entry.missableUntil)) {
        a.conflicts.push(`prazo "${a.missableUntil}" numa fonte e "${entry.missableUntil}" em ${nameOf(fact)}`);
      }
      a.missableUntil ??= entry.missableUntil;
      a.bugged ||= entry.bugged;
      a.bugNote ??= entry.bugNote;
      a.online ||= entry.online;
    }
    for (const chapter of fact.chapters) {
      for (const item of chapter.items) {
        const apiName = item.achievementNameEn ? toApiName(item.achievementNameEn) : undefined;
        if (!apiName) continue;
        const a = accFor(apiName);
        touch(a, fact);
        if (item.missable) {
          a.missable = true;
          a.missableUntil ??= item.missableUntil;
        }
      }
    }
  }

  // PSN list: what the PSN sources name, matched against Steam.
  const psnFacts = facts.filter((f) => f.platform === "psn");
  const psnNames = [
    ...new Set(
      psnFacts.flatMap((f) => [
        ...f.achievements.map((a) => a.nameEn),
        ...f.chapters.flatMap((c) => c.items.flatMap((i) => (i.achievementNameEn ? [i.achievementNameEn] : []))),
      ]),
    ),
  ];
  const onPsn = new Map(matchAchievements(steam, psnNames.map((nameEn) => ({ nameEn }))).map((m) => [m.apiName, m.matched]));
  /** A PSN trophy with what the source says about it (grade, how-to) and its Steam twin. */
  const trophyEntry = (name: string, fs: ExtractedFacts[]): TrophyEntry => {
    const said = fs.flatMap((f) => f.achievements).filter((a) => normalizeName(a.nameEn) === normalizeName(name));
    return { name, apiName: toApiName(name), grade: said.find((a) => a.grade)?.grade, howTo: said.find((a) => a.howTo)?.howTo };
  };

  // "Collect N <things>": from the Steam text, else the lead clause of the how-to (its details are steps, not the goal).
  const goals = new Map<string, { target: number; noun?: string }>();
  for (const s of steamList) {
    const found = [s.description, s.descriptionPt, leadClause(accs.get(s.apiName)?.howTo)].map(collectGoal).filter((g) => g !== undefined);
    if (found[0]) goals.set(s.apiName, { target: found[0].target, noun: found.find((g) => g.target === found[0]!.target && g.noun)?.noun });
  }

  // Task 18 (A): a "collect N <things>" the sources link no (or too few) items to counts the route's items of that
  // type. A part of the thing ("Sha-Chi Amber Fragment") counts 1/N when a source says N make one (in this
  // achievement's how-tos, else a rule of any source), and not at all without one. When a source says one thing has
  // a varying number of parts ("each has 2-6 petals"), every item may be a part: it counts 1/most, for review.
  const allItems = chapters.flatMap((c) => c.items);
  /** Parts per unit of a "collect N <things>": its own texts' rule, else a rule of any source for that word. */
  const perUnitOf = (s: SteamAchievement, unit: string) =>
    [s.description, s.descriptionPt, ...(accs.get(s.apiName)?.howTos ?? [])].map(partsPerUnit).find((n) => n !== undefined) ??
    fragmentRules.find((r) => similarity(r.unit, unit.split(" ").at(-1)!) >= 0.75)?.perUnit;
  const linkedWeight = new Map<string, Map<DossierItem, number>>();
  const byTypeOf = new Map<string, NonNullable<NonNullable<DossierAchievement["collect"]>["byType"]>>();
  for (const s of steamList) {
    const goal = goals.get(s.apiName);
    if (!goal?.noun) continue;
    const already = allItems.filter((i) => i.countsFor.includes(s.apiName)).reduce((n, i) => n + weightOf(i), 0);
    if (already >= goal.target) continue;
    const unit = singularName(goal.noun);
    const unitWords = unit.split(" ");
    const texts = [s.description, s.descriptionPt, ...(accs.get(s.apiName)?.howTos ?? [])];
    const perUnit = perUnitOf(s, unit);
    const maxParts = texts.map(maxPartsPerUnit).find((n) => n !== undefined);
    const weights = new Map<DossierItem, number>();
    let unconverted = 0;
    let ambiguous = false;
    const isPartOf = (name: string) => {
      const words = name.split(" ");
      return words.length === unitWords.length + 1 && PART_WORDS.has(words.at(-1)!) && words.slice(0, -1).join(" ") === unit;
    };
    for (const item of allItems) {
      if (item.countsFor.includes(s.apiName)) continue;
      const type = item.collectibleType ? singularName(item.collectibleType) : "";
      // Its own name may say what it is when the type is the page's label ("Upgrade: Sha-Chi Amber Fragment"), or
      // that it is only a part ("Sha-Chi Amber Shard" typed "Sha-Chi Amber").
      const names = [item.nameEn, item.name].flatMap((n) => (n ? n.split(/\s+\/\s+/) : [])).map(singularName);
      const namedPart = names.some((n) => n.split(" ").some((w) => PART_WORDS.has(w)));
      const typeWords = type.split(" ");
      const kind =
        isPartOf(type) || names.some(isPartOf) || ((type === unit || names.includes(unit)) && namedPart)
          ? "part"
          : type === unit || names.includes(unit)
            ? "exact"
            : type && unitWords.every((w) => typeWords.includes(w)) && !typeWords.some((w) => PART_WORDS.has(w))
              ? "contains"
              : undefined;
      if (!kind) continue;
      let weight: number;
      let loose = false;
      if (kind === "part") {
        // No fixed rule but "2-6 petals each": the most parts, a lower bound for review. Neither: it cannot count.
        const per = perUnit ?? maxParts;
        if (per === undefined) {
          unconverted++;
          continue;
        }
        weight = 1 / per;
        loose = perUnit === undefined;
      } else if (kind === "exact") {
        weight = maxParts === undefined ? 1 : 1 / maxParts;
        loose = maxParts !== undefined;
      } else {
        // "Relic Key" for "Relics": linked for review, never counted.
        weight = 0;
        loose = true;
      }
      ambiguous ||= loose;
      weights.set(item, item.suspect ? 0 : weight);
      item.countsFor.push(s.apiName);
      item.countedByType = loose || item.countedByType === "ambiguous" ? "ambiguous" : "exact";
    }
    if (weights.size > 0 || unconverted > 0) {
      linkedWeight.set(s.apiName, weights);
      byTypeOf.set(s.apiName, { type: singularPhrase(goal.noun), ambiguous, unconverted });
    }
  }

  // R28: an item that counts toward a "collect N" and has no number gets the next one of its type in its chapter
  // (the source lists in route order), for review. Only for achievements with a collect target.
  const collectApis = new Set(
    steamList
      .filter(
        (s) => goals.has(s.apiName) || chapters.some((c) => c.items.some((i) => i.countsFor.includes(s.apiName) && i.total !== undefined)),
      )
      .map((s) => s.apiName),
  );
  for (const chapter of chapters) {
    const typeOf = (i: DossierItem) => singular(normalizeName(i.collectibleType ?? i.kind));
    const last = new Map<string, number>();
    for (const i of chapter.items) if (i.index !== undefined) last.set(typeOf(i), Math.max(last.get(typeOf(i)) ?? 0, i.index));
    for (const i of chapter.items) {
      if (i.index !== undefined || !i.countsFor.some((a) => collectApis.has(a))) continue;
      const n = (last.get(typeOf(i)) ?? 0) + 1;
      last.set(typeOf(i), n);
      Object.assign(i, { index: n, numbering: "chapter" as const, numberAssumed: true });
    }
  }

  const chapterOf = new Map(chapters.flatMap((c) => c.items.map((i) => [i, c.title] as const)));
  const achievements: DossierAchievement[] = steamList.map((s): DossierAchievement => {
    const a = accs.get(s.apiName);
    const groupsSet = a?.groups ?? new Set<string>();
    const counting = allItems.filter((i) => i.countsFor.includes(s.apiName));
    const textTarget = goals.get(s.apiName)?.target;
    const totals = [...new Set(counting.map((i) => i.total).filter((t): t is number => t !== undefined))];
    const target = textTarget ?? (totals.length > 0 ? Math.max(...totals) : undefined);
    // R23: exactly N only when a source says the game has N (the items print it as their total).
    const exact = textTarget === undefined || totals.includes(textTarget);
    const weights = counting.map((i) => linkedWeight.get(s.apiName)?.get(i) ?? weightOf(i));
    const byType = byTypeOf.get(s.apiName);
    const counted = weights.reduce((sum, w) => sum + w, 0);
    const indexProblems: string[] = [];
    const indexed = counting.filter((i) => i.index !== undefined);
    const whole = weights.every((w) => w === 1);
    if (target !== undefined && whole && (exact ? indexed.length > 0 && counted === target : counted >= target)) {
      // A number renumbered within its chapter (running numbers of the page) repeats only inside that chapter.
      const seen = new Set<number>();
      const seenKeys = new Set<string>();
      for (const i of indexed) {
        const key = i.numbering === "chapter" ? `${chapterOf.get(i)}|${singular(normalizeName(i.collectibleType ?? i.kind))}|${i.index}` : String(i.index);
        if (seenKeys.has(key)) indexProblems.push(`o número ${i.index} aparece mais de uma vez`);
        seenKeys.add(key);
        if (i.numbering !== "chapter") seen.add(i.index!);
      }
      // Numbers that count within a chapter cannot say which of 1..N is missing. (Every counting item has a
      // number by now: R28 gave one to those without.)
      if (exact && seen.size > 0) for (let n = 1; n <= target; n++) if (!seen.has(n)) indexProblems.push(`falta o número ${n}`);
    }
    return {
      apiName: s.apiName,
      nameEn: s.name,
      namePt: s.namePt,
      description: s.description,
      descriptionPt: s.descriptionPt,
      hidden: s.hidden,
      globalPct: s.globalPct,
      howTo: a?.howTo,
      missable: a?.missable ?? false,
      missableUntil: a?.missableUntil,
      bugged: a?.bugged ?? false,
      bugNote: a?.bugNote,
      online: a?.online ?? false,
      sources: [...groupsSet],
      sourceLinks: [...(a?.links.values() ?? [])],
      agreed: groupsSet.size >= 2,
      steamOnly: !onPsn.get(s.apiName),
      steamSourced: a?.platforms.has("steam") ?? false,
      collect:
        target !== undefined
          ? {
              target,
              counted: Math.round(counted * 1000) / 1000,
              from: textTarget !== undefined ? "texto" : "total",
              exact,
              conflictingTotals: textTarget === undefined && totals.length > 1 ? totals : [],
              withoutLocation: counting.filter((i) => !i.location.trim()).map((i) => i.name),
              indexProblems,
              ...(byType ? { byType } : {}),
            }
          : undefined,
      conflict: a && a.conflicts.length > 0 ? a.conflicts.join('; ') : undefined,
    };
  });
  // R39: a count short by less than one whole unit passes when a source states a game total that reaches N. Only a
  // total of the thing's parts can be short by less than one unit, and the guide speaks in those parts ("38 de 40
  // shards", never "9,5 de 10"); it needs the rule saying how many parts make one.
  // Task 25 review: not when a page that may map the missing parts was not read: any page of the primary script's
  // site, or a script page elsewhere that a retry could read (a challenge page or robots.txt never can).
  const sourceOfUrl = new Map(facts.map((f) => [f.source.url, nameOf(f)] as const));
  const primaryHosts = new Set(primary.map((f) => hostOf(f.source.url)));
  const mayMap = unreadSources.filter(
    (u) => primaryHosts.has(hostOf(u.url)) || ((u.role === "roteiro_psn" || u.role === "roteiro_steam") && !blockedForGood(u)),
  );
  for (const a of achievements) {
    const c = a.collect;
    const noun = goals.get(a.apiName)?.noun;
    if (!c || !noun || !(c.counted < c.target - 1e-6 && c.target - c.counted < 1 - 1e-6)) continue;
    const steam = steamList.find((x) => x.apiName === a.apiName)!;
    const perUnit = perUnitOf(steam, singularName(noun));
    if (perUnit === undefined) continue;
    for (const [url, totals] of Object.entries(statedTotals)) {
      const source = sourceOfUrl.get(url);
      if (!source) continue;
      const found = totals
        .filter((t) => partsTotalOf(t.label, noun))
        .map((t) => ({ t, units: t.total / perUnit, located: Math.round(c.counted * perUnit * 1000) / 1000 }))
        .find((x) => x.units >= c.target - 1e-6 && x.located < x.t.total);
      if (!found) continue;
      if (mayMap.length > 0) {
        divergences.push(
          `"${a.nameEn}" (${a.apiName}): contagem incompleta não aceita (R39) — as fontes localizam ${found.located} de ${found.t.total} ${found.t.label}, ` +
            `mas ${mayMap.length === 1 ? "uma página que pode mapear o resto não foi lida" : `${mayMap.length} páginas que podem mapear o resto não foram lidas`}: ` +
            `${mayMap.map((u) => `${u.name} (${u.reason})`).join("; ")}.`,
        );
        break;
      }
      const missing = Math.round((found.t.total - found.located) * 1000) / 1000;
      c.shortfallAccepted = { located: found.located, stated: found.t.total, missing, label: found.t.label, source };
      divergences.push(
        `"${a.nameEn}" (${a.apiName}): contagem incompleta aceita (R39) — pede ${c.target} e os itens somam ${c.counted}; ` +
          `as fontes localizam ${found.located} de ${found.t.total} ${found.t.label} (total declarado por ${source}); ` +
          `${missing} sem mapa. O guia avisa e a conquista vai para revisão.`,
      );
      break;
    }
  }

  for (const a of achievements) {
    const ownAt = chapters.findIndex((c) => c.items.some((i) => i.achievement === a.apiName));
    const deadline = chapterForMilestone(a.missableUntil, chapters, Math.max(0, ownAt));
    if (ownAt >= 0 || !a.missable || (deadline && !deadline.assumed)) {
      if (deadline) {
        a.deadlineChapter = deadline.title;
        if (deadline.assumed) a.deadlineAssumed = true;
      }
      // R20: a missable is picked up in the chapter of the item that is it.
      if (a.missable && !a.deadlineChapter && ownAt >= 0) {
        a.deadlineChapter = chapters[ownAt]!.title;
        a.deadlineAssumed = true;
      }
      continue;
    }
    // Task 18: a loose missable whose milestone names no chapter or item: what its texts tie it to is a warning
    // anchor, not a limit to where it is done. One that nothing ties to a chapter fails the gate (rule d).
    const anchor = looseAnchor(a, accs.get(a.apiName)?.howTos ?? [], chapters, 0);
    if (anchor) {
      a.warnChapter = anchor.warn;
      a.doneChapter = anchor.done;
      a.deadlineAssumed = true;
    }
  }

  // R32: a page of the primary script still short after the second reading fails the gate: under 90% of its
  // entries, or under the page's total of a type a "collect N" counts.
  const extractionGaps: string[] = [];
  for (const f of primary) {
    if (!f.shortfall) continue;
    if (entriesShort(f.shortfall)) extractionGaps.push(incompleteSentence(f));
    for (const t of f.shortfall.types ?? []) {
      // The type is the thing a "collect N" names, or a part of it ("Sha-Chi Amber Shards" for "Sha-Chi Ambers").
      const counts = achievements.filter((a) => {
        const noun = goals.get(a.apiName)?.noun;
        return a.collect !== undefined && noun !== undefined && labelNamesType(t.label, `${noun} fragment`);
      });
      if (counts.length > 0) extractionGaps.push(`${typeSentence(f, t)}; isso conta para ${counts.map((a) => `"${a.nameEn}" (${a.apiName})`).join(", ")}.`);
    }
  }

  // --- compat -------------------------------------------------------------------------------------------------
  const psnTrophyListSize = psnFacts.map((f) => f.trophyListSize).find((n) => n !== undefined);
  const compat = computeCompat(
    steamList.length,
    psnFacts.length === 0
      ? []
      : [
          {
            platform: "psn",
            // The PlayStation platinum has no Steam twin: it never makes the list "unmatched".
            matchedAll: (() => {
              const entries = psnNames.map((name) => trophyEntry(name, psnFacts));
              const platinum = new Set(platinumIndexes(entries));
              return entries.every((e, i) => steamBy.has(e.apiName ?? "") || platinum.has(i));
            })(),
            size: psnTrophyListSize ?? psnNames.length,
          },
        ],
  );

  // --- divergences: a source's stated total against what it lists -----------------------------------------------
  for (const fact of facts) {
    const byType = new Map<string, { type: string; total: number; listed: number }>();
    for (const chapter of fact.chapters) {
      for (const item of chapter.items) {
        if (item.total === undefined) continue;
        const type = item.collectibleType ?? item.kind;
        const key = `${singular(normalizeName(type))}|${chapter.region ?? ""}`;
        const entry = byType.get(key) ?? { type, total: item.total, listed: 0 };
        entry.listed++;
        byType.set(key, entry);
      }
    }
    for (const e of byType.values()) {
      if (e.listed !== e.total) divergences.push(`${nameOf(fact)} diz ${e.total} ${e.type} e lista ${e.listed}.`);
    }
  }

  const roteiros = facts.filter((f) => f.source.role === "roteiro_psn" || f.source.role === "roteiro_steam");
  const scripts = [...new Set(roteiros.map(nameOf))].map((name) => ({
    name,
    complete: roteiros.some((f) => nameOf(f) === name && f.complete),
  }));

  const roadmapFact = facts.find((f) => (f.roadmap?.length ?? 0) > 0);
  // The primary's own roadmap; else its "Step N" chapters; else another source's roadmap.
  const roadmap =
    primary[0] && (primary[0].roadmap?.length ?? 0) === 0 && phaseChapters.length > 0
      ? phaseChapters.map((r) => ({ ...r, sources: [nameOf(primary[0]!)] }))
      : (roadmapFact?.roadmap ?? []).map((r) => ({ ...r, sources: [nameOf(roadmapFact!)] }));

  // The full PSN list: a complete PSN script that names as many trophies as it says the list has.
  const trophyNames = (f: ExtractedFacts) => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of [...f.achievements.map((a) => a.nameEn), ...f.chapters.flatMap((c) => c.items.flatMap((i) => (i.achievementNameEn ? [i.achievementNameEn] : [])))]) {
      const key = normalizeName(name);
      if (!seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    }
    return names;
  };
  const listFact = psnFacts.find(
    (f) => f.source.role === "roteiro_psn" && f.complete && f.trophyListSize !== undefined && trophyNames(f).length === f.trophyListSize,
  );
  const listEntries = listFact ? trophyNames(listFact).map((name) => trophyEntry(name, [listFact])) : [];
  const listPlatinum = new Set(platinumIndexes(listEntries));
  const psnList: PsnTrophyList | undefined = listFact && {
    total: listFact.trophyListSize!,
    names: listEntries.map((e) => e.name),
    source: nameOf(listFact),
    matches: listEntries.map((e, i) =>
      listPlatinum.has(i) ? { name: e.name, platinum: true } : { name: e.name, ...(e.apiName ? { apiName: e.apiName } : {}), platinum: false },
    ),
  };

  return {
    chapters,
    achievements,
    facts: {
      playthroughs: pickScalar(facts, nameOf, (f) => f.playthroughs, (v) => String(v.min), (v) => `${v.min} jogada(s)`, "Número de jogadas", divergences),
      difficulty: pickScalar(facts, nameOf, (f) => f.difficulty, (v) => String(v.value), (v) => `dificuldade ${v.value}`, "Dificuldade", divergences),
      hours: pickScalar(facts, nameOf, (f) => f.hours, (v) => `${v.min}-${v.max}`, (v) => `${v.min} a ${v.max} horas`, "Horas", divergences),
      roadmap,
      psnTrophyListSize,
      ...(psnList ? { psnList } : {}),
      compat,
      fragmentRules,
    },
    scripts,
    ...(primary.length > 0
      ? { primaryScript: { name: nameOf(primary[0]!), chapters: chapters.map((c) => c.title) } }
      : {}),
    corroborationOnly,
    stageOnly,
    divergences,
    extractionGaps,
    unreadSources,
  };
}

/**
 * The Steam achievements that are not on the PlayStation list. The whole list from a complete PSN script
 * (`facts.psnList`) decides when there is one: the per-achievement `steamOnly` flag only says that no PSN source
 * named the achievement, and walkthrough pages name many achievements in passing (PBZ: 63 of 66 flagged as on the
 * PSN list, which has 36 trophies). Without the whole list, the flag is all there is.
 * The flag stays as it was in the dossier: the writing cache hashes the dossier, and no text of the writer reads it.
 */
export function steamOnlyApiNames(d: Pick<GuideDossier, "achievements" | "facts">): Set<string> {
  const list = d.facts.psnList;
  if (!list) return new Set(d.achievements.filter((a) => a.steamOnly).map((a) => a.apiName));
  const onList = new Set(list.matches.flatMap((m) => (m.apiName ? [m.apiName] : [])));
  return new Set(d.achievements.filter((a) => !onList.has(a.apiName)).map((a) => a.apiName));
}

/** How many trophies the PlayStation list has (platinum included), when a source says. */
export const psnListSize = (d: Pick<GuideDossier, "facts">): number | undefined => d.facts.psnList?.total ?? d.facts.psnTrophyListSize;
