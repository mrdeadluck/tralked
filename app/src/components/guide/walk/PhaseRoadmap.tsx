import type { CSSProperties } from "react";
import type { GuideStepView } from "@/lib/queries/games";
import { walkPlain } from "./inline";
import { Both } from "./versions";
import { phaseBodyScope, phaseTitleScope, type ChapterView, type ItemView, type PhaseText } from "./view";

/*
 * "O caminho até o Tralked": the guide's phases (its roadmap steps) in order, each with a short
 * description, its hours and how many achievements its chapters hold, joined by lime diamonds.
 * Titles and descriptions come masked (view.ts): a boss the robot named stays behind the spoiler gate.
 * In a guide with a PlayStation version, that version counts only its own achievements.
 */

/** Achievement items of the chapters that belong to phase `phase` (1-based, view.ts). */
function achievementsIn(chapters: ChapterView[], phase: number): ItemView[] {
  return chapters
    .filter((c) => c.phase === phase)
    .flatMap((c) => c.steps.flatMap((s) => s.items.filter((i) => i.kind === "achievement" || i.achievement)));
}

const achievementsText = (n: number) => (n > 0 ? ` · ${n} ${n === 1 ? "conquista" : "conquistas"}` : null);

type PhaseRoadmapProps = {
  steps: GuideStepView[];
  /** The phases' title and body, masked, in the order of `steps`. */
  texts: PhaseText[];
  /** The page's chapters (view.ts); `phase` numbers them after `steps`. */
  chapters: ChapterView[];
};

export function PhaseRoadmap({ steps, texts, chapters }: PhaseRoadmapProps) {
  if (steps.length === 0) return null;
  return (
    <section id="g-roadmap" className="wk-sec" aria-labelledby="g-roadmap-h">
      <p className="wk-lbl">Roadmap</p>
      <h2 id="g-roadmap-h">O caminho até o Tralked</h2>
      <ol className="wk-road" style={{ "--cols": Math.min(4, steps.length) } as CSSProperties}>
        {steps.map((step, i) => {
          const achievements = achievementsIn(chapters, i + 1);
          const ps = achievements.filter((a) => !a.steamOnly).length;
          return (
            <li key={step.id} className="wk-stp">
              <span className="n" aria-hidden="true">
                {i + 1}
              </span>
              <b>{walkPlain(texts[i].title, phaseTitleScope(i))}</b>
              {texts[i].body ? <p>{walkPlain(texts[i].body, phaseBodyScope(i))}</p> : null}
              <span className="m">
                {step.hours}
                <Both steam={achievementsText(achievements.length)} ps={achievementsText(ps)} />
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
