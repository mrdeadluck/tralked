import type { GuidePayloadV2 } from "./contract.js";
import type { GuideDossier } from "./dossier.js";
import type { GuideSkeleton, SkelItem } from "./skeleton.js";

/**
 * The chronology check (code, no model), run on every written guide. Lucas wants the walkthrough strictly in the
 * order of play, with the roadmap that takes the fewest playthroughs:
 * - the chapters keep the order of the primary script (PowerPyx, or the complete Steam guide): a subsequence of it,
 *   chapters it does not have slotting in between;
 * - the chapters walk the roadmap phases forward, never back to an earlier phase;
 * - no missable comes after the chapter where it is lost (voice v2: the page warns the step that holds it, with its own
 *   box before the step, so the step needs no warning callout of its own).
 * Each problem has the key it belongs to (a step or item key; null for the frame) and its owner: "writer" when the
 * model placed it (a loose achievement put in a step), so a rewrite can fix it; "code" when the order is the code's
 * own (chapters, phases, the skeleton's items): a bug the model cannot fix, reported as an internal
 * error instead.
 */

export type ChronologyProblem = { text: string; key: string | null; owner: "code" | "writer" };

export function chronologyProblems(p: GuidePayloadV2, skel: GuideSkeleton, dossier: GuideDossier): ChronologyProblem[] {
  const problems: ChronologyProblem[] = [];
  const chapters = p.walkthrough.chapters;
  const titleOf = new Map(skel.chapters.map((c) => [c.key, c.title]));
  const keyOfTitle = new Map(skel.chapters.filter((c) => !c.cleanup).map((c) => [c.title, c.key]));

  // The primary script's order.
  const primary = dossier.primaryScript;
  if (primary) {
    let last: { at: number; key: string; title: string } | undefined;
    for (const chapter of chapters) {
      const title = titleOf.get(chapter.key);
      const at = title === undefined ? -1 : primary.chapters.indexOf(title);
      if (at < 0) continue;
      if (last && at < last.at) {
        problems.push({
          key: null,
          owner: "code",
          text: `O capítulo ${chapter.key} veio depois de ${last.key}, mas no roteiro principal (${primary.name}) "${title}" vem antes de "${last.title}". Siga a ordem da fonte.`,
        });
      } else {
        last = { at, key: chapter.key, title: title! };
      }
    }
  }

  // The roadmap phases, forward only.
  const phaseAt = new Map(p.steps.map((s, i) => [s.key, i]));
  chapters.forEach((chapter, n) => {
    const before = chapters[n - 1];
    if (!before) return;
    const at = phaseAt.get(chapter.phaseKey) ?? -1;
    const previous = phaseAt.get(before.phaseKey) ?? -1;
    if (at >= 0 && previous >= 0 && at < previous) {
      problems.push({
        key: null,
        owner: "code",
        text: `O capítulo ${chapter.key} está na etapa ${chapter.phaseKey}, que vem antes da etapa ${before.phaseKey} do capítulo anterior. As etapas seguem o roadmap, na ordem.`,
      });
    }
  });

  // Missables: before their point of no return.
  const skelItems = new Map<string, SkelItem>();
  for (const c of skel.chapters) for (const s of c.steps) for (const i of s.items) skelItems.set(i.key, i);
  for (const l of skel.loose) skelItems.set(l.key, l);
  // Loose achievements are the only items the model places (assemble in writer.ts).
  const placedByModel = new Set(skel.loose.map((l) => l.key));
  const chapterAt = new Map(chapters.map((c, i) => [c.key, i]));
  chapters.forEach((chapter, at) => {
    for (const step of chapter.steps) {
      const lost = step.items.filter((i) => i.missable && !i.returnLater);
      for (const item of lost) {
        const s = skelItems.get(item.key);
        const title = (s?.item?.missable ? s.item.deadlineChapter : undefined) ?? (s?.ach?.missable ? s.ach.deadlineChapter : undefined);
        const deadlineKey = title === undefined ? undefined : keyOfTitle.get(title);
        const deadline = deadlineKey === undefined ? -1 : (chapterAt.get(deadlineKey) ?? -1);
        if (deadline >= 0 && at > deadline) {
          problems.push({
            key: item.key,
            owner: placedByModel.has(item.key) ? "writer" : "code",
            text: `O perdível "${item.name}" (${item.key}) está no capítulo ${chapter.key}, depois de ${deadlineKey}, onde ele se perde. O aviso tem que vir antes do ponto de não retorno.`,
          });
        }
      }
    }
  });
  return problems;
}
