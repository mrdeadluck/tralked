import type { Dossier } from "../tralked.js";
import type { GuideCompat } from "./contract.js";
import { isRevisit, pageLabel, revisitPlace } from "./chapter-order.js";
import { buildSourceGroups, collectTarget, detectFragmentRules, type FragmentRule } from "./crossref.js";
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
  deadlineChapter?: string;
  /** R20: the deadline is the chapter of the item that is this achievement (no milestone points to a chapter). */
  deadlineAssumed?: boolean;
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
  unreadSources: { name: string; url: string; reason: string }[];
};

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
  for (const chapter of ahead) {
    const region = normalizeName(chapter.region ?? "");
    if (region.length >= 3 && wanted.includes(region)) return { title: chapter.title, assumed: true };
  }
  return undefined;
}

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
  const divergences: string[] = [];
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
    const text = plain([item.collectibleType, item.nameEn, item.name].filter(Boolean).join(" "));
    if (!FRAGMENT_WORD.test(text)) return 1;
    const words = text.split(/[^a-z0-9]+/).filter(Boolean);
    const rule = fragmentRules.find((r) => words.some((w) => similarity(w, r.unit) >= 0.75));
    return rule ? 1 / rule.perUnit : 1;
  };

  // --- achievements -------------------------------------------------------------------------------------------
  type AchAcc = {
    howTo?: string;
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
      a = { missable: false, bugged: false, online: false, groups: new Set(), links: new Map(), platforms: new Set(), missSeen: new Set(), conflicts: [] };
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

  // R28: an item that counts toward a "collect N" and has no number gets the next one of its type in its chapter
  // (the source lists in route order), for review. Only for achievements with a collect target.
  const collectApis = new Set(
    steamList
      .filter(
        (s) =>
          [s.description, s.descriptionPt, accs.get(s.apiName)?.howTo].some((t) => collectTarget(t) !== undefined) ||
          chapters.some((c) => c.items.some((i) => i.countsFor.includes(s.apiName) && i.total !== undefined)),
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

  const allItems = chapters.flatMap((c) => c.items);
  const chapterOf = new Map(chapters.flatMap((c) => c.items.map((i) => [i, c.title] as const)));
  const achievements: DossierAchievement[] = steamList.map((s): DossierAchievement => {
    const a = accs.get(s.apiName);
    const groupsSet = a?.groups ?? new Set<string>();
    const counting = allItems.filter((i) => i.countsFor.includes(s.apiName));
    const textTarget = [s.description, s.descriptionPt, a?.howTo].map(collectTarget).find((n) => n !== undefined);
    const totals = [...new Set(counting.map((i) => i.total).filter((t): t is number => t !== undefined))];
    const target = textTarget ?? (totals.length > 0 ? Math.max(...totals) : undefined);
    // R23: exactly N only when a source says the game has N (the items print it as their total).
    const exact = textTarget === undefined || totals.includes(textTarget);
    const weights = counting.map(weightOf);
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
            }
          : undefined,
      conflict: a && a.conflicts.length > 0 ? a.conflicts.join('; ') : undefined,
    };
  });
  for (const a of achievements) {
    const ownAt = chapters.findIndex((c) => c.items.some((i) => i.achievement === a.apiName));
    const deadline = chapterForMilestone(a.missableUntil, chapters, Math.max(0, ownAt));
    if (deadline) {
      a.deadlineChapter = deadline.title;
      if (deadline.assumed) a.deadlineAssumed = true;
    }
    if (a.missable && !a.deadlineChapter) {
      // R20: the chapter of the item that is this achievement. A loose one stays without deadline (gate rule d).
      const own = chapters[ownAt];
      if (own) {
        a.deadlineChapter = own.title;
        a.deadlineAssumed = true;
      }
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
    unreadSources,
  };
}
