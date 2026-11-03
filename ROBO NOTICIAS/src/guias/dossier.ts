import type { Dossier } from "../tralked.js";
import type { GuideCompat } from "./contract.js";
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
  /** Title of the chapter the `missableUntil` milestone points to. */
  deadlineChapter?: string;
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
};

export type DossierChapter = { title: string; region?: string; order: number; items: DossierItem[] };

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
  collect?: { target: number; counted: number };
};

export type Scalar<T> = { value: T; sources: string[]; agreed: boolean };

export type GuideDossier = {
  chapters: DossierChapter[];
  achievements: DossierAchievement[];
  facts: {
    playthroughs?: Scalar<{ min: number; note: string }>;
    difficulty?: Scalar<{ value: number; note: string }>;
    hours?: Scalar<{ min: number; max: number }>;
    roadmap: { title: string; summary: string; sources: string[] }[];
    psnTrophyListSize?: number;
    /** Seal computed from the PSN list the sources gave. */
    compat: GuideCompat;
    /** "N fragments = 1 unit" as the sources state it. */
    fragmentRules: FragmentRule[];
  };
  /** Script sources (roteiro_*), one per independent group: is the group complete? Input of gate rule (e). */
  scripts: { name: string; complete: boolean }[];
  /** Plain Portuguese sentences; they never fail the gate by themselves. */
  divergences: string[];
  unreadSources: { name: string; url: string; reason: string }[];
};

const ROLE_ORDER: Record<SourceRole, number> = { roteiro_psn: 0, roteiro_steam: 1, coletaveis: 2, confirmacao: 3 };

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
};

const singular = (word: string) => word.replace(/s$/, "");

function alignId(chapter: string, item: ExtractedFacts["chapters"][number]["items"][number]) {
  const type = singular(normalizeName(item.collectibleType ?? item.kind));
  const tail = item.index !== undefined ? String(item.index) : `name:${normalizeName(item.nameEn ?? item.name)}`;
  return `${normalizeName(chapter)}|${type}|${tail}`;
}

/** The chapter a "until X" milestone belongs to: X names a chapter, or an item inside one. */
function chapterForMilestone(milestone: string | undefined, chapters: DossierChapter[]): string | undefined {
  if (!milestone) return undefined;
  const wanted = normalizeName(milestone);
  if (wanted.length < 3) return undefined;
  for (const chapter of chapters) {
    const title = normalizeName(chapter.title);
    if (title.length >= 3 && (wanted.includes(title) || title.includes(wanted))) return chapter.title;
  }
  for (const chapter of chapters) {
    for (const item of chapter.items) {
      for (const name of [item.nameEn, item.name]) {
        const n = name ? normalizeName(name) : "";
        if (n.length >= 3 && (wanted.includes(n) || n.includes(wanted))) return chapter.title;
      }
    }
  }
  return undefined;
}

function pickScalar<T>(
  facts: ExtractedFacts[],
  nameOf: (f: ExtractedFacts) => string,
  read: (f: ExtractedFacts) => T | undefined,
  label: string,
  divergences: string[],
): Scalar<T> | undefined {
  const withValue = facts.filter((f) => read(f) !== undefined);
  const first = withValue[0];
  if (!first) return undefined;
  const value = read(first)!;
  const same = withValue.filter((f) => JSON.stringify(read(f)) === JSON.stringify(value));
  const sources = [...new Set(same.map(nameOf))];
  const other = withValue.filter((f) => !same.includes(f));
  if (other.length > 0) {
    divergences.push(
      `${label}: ${sources.join(", ")} diz ${JSON.stringify(value)}, mas ${[...new Set(other.map(nameOf))].join(", ")} diz ${JSON.stringify(read(other[0]!))}.`,
    );
  }
  return { value, sources, agreed: sources.length >= 2 };
}

/**
 * Cross-references the extracted facts into one dossier: aligns items by (chapter, type, index) or name, ties
 * achievements to the Steam master list, counts the independent sources of every fact and records disagreements.
 * Pure code, no AI. `groups` come from `independentGroups`.
 */
export function buildDossier(
  steamList: SteamAchievement[],
  rawFacts: ExtractedFacts[],
  groups: string[][],
  unreadSources: GuideDossier["unreadSources"] = [],
): GuideDossier {
  const facts = rawFacts
    .map((f, i) => ({ f, i }))
    .sort((a, b) => ROLE_ORDER[a.f.source.role] - ROLE_ORDER[b.f.source.role] || a.i - b.i)
    .map((x) => x.f);
  const { nameOf } = buildSourceGroups(facts, groups);
  const divergences: string[] = [];
  const steam: SteamEntry[] = steamList.map((s) => ({
    apiName: s.apiName,
    name: s.name,
    description: s.description,
  }));
  const steamBy = new Map(steamList.map((s) => [s.apiName, s]));
  const apiNameCache = new Map<string, string | undefined>();
  const toApiName = (nameEn: string) => {
    if (!apiNameCache.has(nameEn)) apiNameCache.set(nameEn, steamApiNameFor(steam, { nameEn }));
    return apiNameCache.get(nameEn);
  };

  // --- chapters and items -------------------------------------------------------------------------------------
  const chapterMap = new Map<string, { title: string; region?: string; order: number; items: Map<string, Acc> }>();
  for (const fact of facts) {
    for (const chapter of [...fact.chapters].sort((a, b) => a.order - b.order)) {
      const chapterKey = normalizeName(chapter.title);
      let target = chapterMap.get(chapterKey);
      if (!target) {
        target = { title: chapter.title, region: chapter.region, order: chapterMap.size + 1, items: new Map() };
        chapterMap.set(chapterKey, target);
      }
      target.region ??= chapter.region;
      for (const item of chapter.items) {
        const id = alignId(chapter.title, item);
        let acc = target.items.get(id);
        if (!acc) {
          acc = {
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
          };
          target.items.set(id, acc);
        }
        acc.nameEn ??= item.nameEn;
        acc.collectibleType ??= item.collectibleType;
        acc.index ??= item.index;
        acc.total ??= item.total;
        acc.location ||= item.location;
        acc.missable ||= item.missable;
        acc.missableUntil ??= item.missableUntil;
        acc.returnLater ||= item.returnLater;
        acc.achievementNameEn ??= item.achievementNameEn;
        for (const c of item.countsForEn) if (!acc.countsForEn.includes(c)) acc.countsForEn.push(c);
        acc.groups.add(nameOf(fact));
        acc.links.set(fact.source.url, { name: fact.source.name, url: fact.source.url });
        acc.platforms.add(fact.platform);
      }
    }
  }

  const chapters: DossierChapter[] = [...chapterMap.values()].map((c) => ({
    title: c.title,
    region: c.region,
    order: c.order,
    items: [...c.items.values()].map((acc): DossierItem => {
      const { groups: g, links, platforms, achievementNameEn, countsForEn, ...rest } = acc;
      const achievement = achievementNameEn ? toApiName(achievementNameEn) : undefined;
      if (achievementNameEn && !achievement) {
        divergences.push(`O item "${acc.name}" aponta para a conquista "${achievementNameEn}", que não existe na lista da Steam.`);
      }
      return {
        ...rest,
        achievement,
        countsFor: countsForEn.map(toApiName).filter((x): x is string => x !== undefined),
        sources: [...g],
        sourceLinks: [...links.values()],
        agreed: g.size >= 2,
        platforms: [...platforms],
      };
    }),
  }));
  for (const chapter of chapters) {
    for (const item of chapter.items) {
      if (item.missableUntil) item.deadlineChapter = chapterForMilestone(item.missableUntil, chapters);
    }
  }

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
  };
  const accs = new Map<string, AchAcc>();
  const accFor = (apiName: string) => {
    let a = accs.get(apiName);
    if (!a) {
      a = { missable: false, bugged: false, online: false, groups: new Set(), links: new Map(), platforms: new Set() };
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
      a.missable ||= entry.missable;
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

  const allItems = chapters.flatMap((c) => c.items);
  const achievements: DossierAchievement[] = steamList.map((s): DossierAchievement => {
    const a = accs.get(s.apiName);
    const groupsSet = a?.groups ?? new Set<string>();
    const counting = allItems.filter((i) => i.countsFor.includes(s.apiName));
    const target = [s.description, s.descriptionPt, a?.howTo].map(collectTarget).find((n) => n !== undefined);
    const counted = counting.reduce((sum, i) => sum + weightOf(i), 0);
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
      collect: target !== undefined ? { target, counted: Math.round(counted * 1000) / 1000 } : undefined,
    };
  });
  for (const a of achievements) {
    if (a.missableUntil) a.deadlineChapter = chapterForMilestone(a.missableUntil, chapters);
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
            matchedAll: psnNames.every((nameEn) => steamBy.has(toApiName(nameEn) ?? "")),
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

  return {
    chapters,
    achievements,
    facts: {
      playthroughs: pickScalar(facts, nameOf, (f) => f.playthroughs, "Número de jogadas", divergences),
      difficulty: pickScalar(facts, nameOf, (f) => f.difficulty, "Dificuldade", divergences),
      hours: pickScalar(facts, nameOf, (f) => f.hours, "Horas", divergences),
      roadmap: (roadmapFact?.roadmap ?? []).map((r) => ({ ...r, sources: [nameOf(roadmapFact!)] })),
      psnTrophyListSize,
      compat,
      fragmentRules,
    },
    scripts,
    divergences,
    unreadSources,
  };
}
