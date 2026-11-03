import type { JourneyChapter } from "./journey";

/*
 * Where a signed-in visitor stands in a walkthrough ("continuar de onde parou"), from what the page
 * already knows: the items they ticked and the Steam achievements they unlocked. A pure function of
 * the ordered item list, so a filtered list (one platform's version of the guide) gives that
 * version's answer.
 *
 * - An item is done when it is ticked or its achievement is unlocked.
 * - "Furthest" is the last done item in the guide's order. The cleanup chapter and loose achievements
 *   (no fixed place in the story) are left out of it, so one achievement done out of order does not
 *   throw the visitor ahead; an achievement on several items counts at its first item only.
 *   Steam-only achievements have no item, so they never count.
 * - "Resume" is the next undone item after the furthest one, anywhere after it (cleanup included).
 *   It never goes back to an item skipped early on: those are "behind".
 */

export type ResumeItem = {
  ref: string;
  /** Index of the item's chapter in the page's chapter list. */
  chapter: number;
  /** Number of the item's step ("2.4"). */
  step: string;
  missable: boolean;
  /** Chapter after which a missable is lost (null: none known). */
  deadlineChapter: number | null;
  /** In the cleanup chapter, after the story. */
  cleanup: boolean;
  /** An achievement without a fixed place in the story. */
  loose: boolean;
  /** Database id of the Steam achievement the item is. */
  achievementId: string | null;
};

/** What the resume point is based on. */
export type Evidence = "conquistas" | "itens" | "ambos" | "nenhum";

export type ResumePoint = { ref: string; chapter: number; step: string };

export type Resume = {
  /** Index (in the item list) of the furthest done item; null when none counts. */
  furthest: number | null;
  /** The next undone item after the furthest; null when nothing is left after it. */
  resume: ResumePoint | null;
  /** Refs of the undone items before the resume point (cleanup chapter left out). */
  behind: string[];
  /** Refs of the undone missables whose place or deadline is already behind the resume point. */
  possiblyMissed: string[];
  /** Chapters before the resume point's, plus every chapter whose items are all done. */
  passedChapters: number[];
  evidence: Evidence;
};

export type ResumePredicates = {
  /** The visitor ticked the item. */
  isTicked: (ref: string) => boolean;
  /** The visitor has the Steam achievement (database id). */
  isUnlocked: (achievementId: string) => boolean;
};

export function resumeOf(items: readonly ResumeItem[], { isTicked, isUnlocked }: ResumePredicates): Resume {
  const first = new Map<string, number>();
  items.forEach((item, i) => {
    if (item.achievementId && !first.has(item.achievementId)) first.set(item.achievementId, i);
  });
  const unlocked = items.map((item) => item.achievementId !== null && isUnlocked(item.achievementId));
  const ticked = items.map((item) => isTicked(item.ref));
  const done = items.map((_, i) => ticked[i] || unlocked[i]);

  let furthest: number | null = null;
  let byTicks = false;
  let byUnlocks = false;
  for (const [i, item] of items.entries()) {
    if (item.cleanup || item.loose) continue;
    const byUnlock = unlocked[i] && first.get(item.achievementId!) === i;
    if (!ticked[i] && !byUnlock) continue;
    furthest = i;
    byTicks ||= ticked[i];
    byUnlocks ||= byUnlock;
  }

  const start = furthest === null ? 0 : furthest + 1;
  const at = done.findIndex((d, i) => i >= start && !d);
  const end = at < 0 ? items.length : at;
  const resume = at < 0 ? null : { ref: items[at].ref, chapter: items[at].chapter, step: items[at].step };
  const lastChapter = items.reduce((max, item) => Math.max(max, item.chapter), -1);
  const resumeChapter = resume ? resume.chapter : lastChapter + 1;

  const behind = items.filter((item, i) => i < end && !done[i] && !item.cleanup).map((item) => item.ref);
  const possiblyMissed = items
    .filter(
      (item, i) =>
        item.missable &&
        !done[i] &&
        (i < end || (item.deadlineChapter !== null && item.deadlineChapter < resumeChapter)),
    )
    .map((item) => item.ref);

  const passed = new Set<number>();
  for (let c = 0; c < resumeChapter; c++) passed.add(c);
  const open = new Set(items.filter((_, i) => !done[i]).map((item) => item.chapter));
  for (const item of items) if (!open.has(item.chapter)) passed.add(item.chapter);

  return {
    furthest,
    resume,
    behind,
    possiblyMissed,
    passedChapters: [...passed].sort((a, b) => a - b),
    evidence: byTicks && byUnlocks ? "ambos" : byUnlocks ? "conquistas" : byTicks ? "itens" : "nenhum",
  };
}

/** The robot's cleanup chapter: the last one, keyed "limpeza" (or "limpeza-2" when a chapter took that key). */
export const cleanupChapter = (key: string, index: number, count: number) =>
  index === count - 1 && /^limpeza(?:-\d+)?$/.test(key);

/**
 * The page's items in walkthrough order, as resumeOf reads them. A missable is lost after its own
 * chapter (the chapter's deadline); the achievements left in the cleanup chapter are the loose ones.
 */
export function resumeItems(
  chapters: readonly Pick<JourneyChapter, "refs" | "steps" | "missables" | "cleanup">[],
  achievementOf: (ref: string) => string | null,
): ResumeItem[] {
  return chapters.flatMap((chapter, c) => {
    const missable = new Set(chapter.missables.map((m) => m.ref));
    const steps = chapter.steps.flatMap((count, s) => Array<string>(count).fill(`${c + 1}.${s + 1}`));
    return chapter.refs.map((ref, i) => {
      const achievementId = achievementOf(ref);
      return {
        ref,
        chapter: c,
        step: steps[i],
        missable: missable.has(ref),
        deadlineChapter: missable.has(ref) ? c : null,
        cleanup: chapter.cleanup,
        loose: chapter.cleanup && achievementId !== null,
        achievementId,
      };
    });
  });
}
