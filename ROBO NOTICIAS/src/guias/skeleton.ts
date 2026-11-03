import type { DossierAchievement, DossierChapter, DossierItem, GuideDossier } from "./dossier.js";

/**
 * The guide's structure, made by code from the dossier alone: chapters, steps, items, roadmap phases and their keys
 * (slug of the title + index). The same dossier always gives the same keys, so readers' checkmarks survive a
 * rewrite or an update. The writer model never invents a key: it gets these ready-made.
 */

const MAX_STEPS_PER_CHAPTER = 80;
/** Steps written (and checked) per model call: keeps each answer far below the non-streaming output limit. */
export const STEPS_PER_CALL = 20;
const KEY_MAX = 80;

/** Lowercase ASCII letters, digits and single hyphens (the site's STEP_KEY_PATTERN), at most `max` characters. */
export function slugify(text: string, max = 40): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** One key namespace: a repeated base gets "-2", "-3"... in claim order, which is the dossier order. */
function keyClaimer() {
  const used = new Set<string>();
  return (base: string, fallback: string) => {
    const root = (slugify(base, KEY_MAX - 4) || fallback).slice(0, KEY_MAX - 4).replace(/-+$/g, "");
    let key = root;
    for (let n = 2; used.has(key); n++) key = `${root}-${n}`;
    used.add(key);
    return key;
  };
}

export type SkelItem = { key: string; item: DossierItem | null; ach: DossierAchievement | null };
export type SkelStep = { key: string; items: SkelItem[] };
export type SkelChapter = {
  key: string;
  title: string;
  region?: string;
  cleanup: boolean;
  steps: SkelStep[];
  /** "Until X" milestones after which this chapter's missables are lost (the site's `chapter.deadline`). */
  deadlines: string[];
};
export type SkelPhase = { key: string; title: string; summary: string };

export type GuideSkeleton = {
  phases: SkelPhase[];
  chapters: SkelChapter[];
  /** Achievements no dossier item IS: they start in the cleanup chapter and the model may move them. */
  loose: SkelItem[];
};

/** One writer call (and one checker call): a run of at most STEPS_PER_CALL steps of one chapter. */
export type WriteJob = { id: string; chapter: SkelChapter; steps: SkelStep[] };

export function chunk<T>(list: T[], parts: number): T[][] {
  const size = Math.max(1, Math.ceil(list.length / parts));
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function isMissable(s: SkelItem): boolean {
  return Boolean(s.item?.missable || s.ach?.missable);
}

/** The "until X" milestone of a missable item or achievement (the item's own first). */
export function untilOf(item: DossierItem | null | undefined, ach: DossierAchievement | null | undefined): string | undefined {
  if (item?.missable && item.missableUntil) return item.missableUntil;
  if (ach?.missable && ach.missableUntil) return ach.missableUntil;
  return undefined;
}

/** Deterministic: the same dossier always gives the same keys. */
export function buildSkeleton(dossier: GuideDossier): GuideSkeleton {
  const claim = keyClaimer();
  const achBy = new Map(dossier.achievements.map((a) => [a.apiName, a]));

  const deadlinesOf = (chapter: DossierChapter) => {
    const set = new Set<string>();
    for (const i of chapter.items) {
      const until = untilOf(i, i.achievement ? achBy.get(i.achievement) : undefined);
      if (until) set.add(until);
    }
    return [...set];
  };

  const itemKey = (chapter: DossierChapter, item: DossierItem) => {
    if (item.achievement) return claim(`conq-${item.achievement}`, "conq");
    const what = item.index !== undefined ? `${item.collectibleType ?? item.nameEn ?? item.name} ${item.index}` : (item.nameEn ?? item.name);
    return claim(`${slugify(chapter.title, 30)}-${slugify(what, 44)}`, "item");
  };

  const chapters: SkelChapter[] = [...dossier.chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => {
      const key = claim(slugify(chapter.title, 50), "capitulo");
      // One step per item (the order of the game), chunked when a chapter has more items than the site's steps.
      const groups = chapter.items.length === 0 ? [[]] : chunk(chapter.items, MAX_STEPS_PER_CHAPTER);
      const stepKeys = groups.map((_, n) => claim(`${key}-${n + 1}`, key));
      const steps = groups.map((group, n) => ({
        key: stepKeys[n]!,
        items: group.map((item) => ({ key: itemKey(chapter, item), item, ach: item.achievement ? (achBy.get(item.achievement) ?? null) : null })),
      }));
      return { key, title: chapter.title, region: chapter.region, cleanup: false, steps, deadlines: deadlinesOf(chapter) };
    });

  const asItem = new Set(dossier.chapters.flatMap((c) => c.items.map((i) => i.achievement).filter(Boolean)));
  const loose: SkelItem[] = dossier.achievements
    .filter((a) => !asItem.has(a.apiName))
    .map((a) => ({ key: claim(`conq-${a.apiName}`, "conq"), item: null, ach: a }));

  if (loose.length > 0) {
    const key = claim("limpeza", "limpeza");
    const steps = chunk(loose, MAX_STEPS_PER_CHAPTER).map((items, n) => ({ key: claim(`${key}-${n + 1}`, key), items }));
    chapters.push({ key, title: "Limpeza", cleanup: true, steps, deadlines: [] });
  }

  const phaseClaim = keyClaimer();
  const roadmap = dossier.facts.roadmap.length > 0 ? dossier.facts.roadmap : [{ title: "Do início ao Tralked", summary: "" }];
  const phases = roadmap.map((r) => ({ key: phaseClaim(`etapa-${r.title}`, "etapa"), title: r.title, summary: r.summary }));
  if (dossier.facts.roadmap.length === 0 && loose.length > 0) {
    phases.push({ key: phaseClaim("etapa-limpeza", "etapa"), title: "Limpeza", summary: "" });
  }

  return { phases, chapters, loose };
}

/** The writer's (and checker's) calls: each chapter's steps in runs of at most STEPS_PER_CALL. */
export function writeJobs(skel: GuideSkeleton): WriteJob[] {
  return skel.chapters.flatMap((chapter) =>
    chunk(chapter.steps, Math.ceil(chapter.steps.length / STEPS_PER_CALL)).map((steps) => ({ id: steps[0]!.key, chapter, steps })),
  );
}
