import type { CSSProperties } from "react";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";
import type { GuideStepView } from "@/lib/queries/games";
import { walkPlain } from "./inline";
import { phaseBodyScope, phaseTitleScope, type PhaseText } from "./view";

/*
 * "O caminho até o Tralked": the guide's phases (its roadmap steps) in order, each with a short
 * description, its hours and how many achievements its chapters hold, joined by lime diamonds.
 * Titles and descriptions come masked (view.ts): a boss the robot named stays behind the spoiler gate.
 */

/** Achievement items of the chapters that belong to the phase `key`. */
function achievementsIn(walkthrough: Walkthrough, key: string | null): number {
  if (!key) return 0;
  return walkthrough.chapters
    .filter((c) => c.phaseKey === key)
    .reduce((sum, c) => sum + c.steps.reduce((n, s) => n + s.items.filter((i) => i.kind === "achievement" || i.achievement).length, 0), 0);
}

type PhaseRoadmapProps = {
  steps: GuideStepView[];
  /** The phases' title and body, masked, in the order of `steps`. */
  texts: PhaseText[];
  walkthrough: Walkthrough;
};

export function PhaseRoadmap({ steps, texts, walkthrough }: PhaseRoadmapProps) {
  if (steps.length === 0) return null;
  return (
    <section id="g-roadmap" className="wk-sec" aria-labelledby="g-roadmap-h">
      <p className="wk-lbl">Roadmap</p>
      <h2 id="g-roadmap-h">O caminho até o Tralked</h2>
      <ol className="wk-road" style={{ "--cols": Math.min(4, steps.length) } as CSSProperties}>
        {steps.map((step, i) => {
          const count = achievementsIn(walkthrough, step.key);
          return (
            <li key={step.id} className="wk-stp">
              <span className="n" aria-hidden="true">
                {i + 1}
              </span>
              <b>{walkPlain(texts[i].title, phaseTitleScope(i))}</b>
              {texts[i].body ? <p>{walkPlain(texts[i].body, phaseBodyScope(i))}</p> : null}
              <span className="m">
                {step.hours}
                {count > 0 ? ` · ${count} ${count === 1 ? "conquista" : "conquistas"}` : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
