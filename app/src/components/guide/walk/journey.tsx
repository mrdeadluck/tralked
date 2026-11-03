"use client";

import { createContext, useContext, type ReactNode, type Ref } from "react";

/*
 * The chapters of the journey, sent to the browser once (JourneyProvider) and read by every row of
 * diamonds: the big row under the page's top (WalkJourney) and the timeline before each chapter
 * (ChapterTimeline), which only carries its own number.
 */

export type JourneyChapter = {
  key: string;
  title: string;
  /** Roadmap phase (a divider marks where it changes). */
  phase: number;
  /** Refs of the chapter's items (view.ts). */
  refs: string[];
  missables: number;
};

const JourneyContext = createContext<JourneyChapter[]>([]);

export function JourneyProvider({ chapters, children }: { chapters: JourneyChapter[]; children: ReactNode }) {
  return <JourneyContext value={chapters}>{children}</JourneyContext>;
}

export const useJourney = () => useContext(JourneyContext);

type JourneyRowProps = {
  chapters: JourneyChapter[];
  /** The visitor's ticks per chapter. */
  counts: number[];
  /** Signed in: the row shows ticks/total, otherwise the item count. */
  user: boolean;
  current: number;
  /** Chapters before the current one are drawn as passed (the timeline before a chapter). */
  passed?: boolean;
  /** aria-current of the current chapter's link. */
  currentAs: "location" | "step";
  ref?: Ref<HTMLOListElement>;
};

/** A diamond per chapter: short title, ticks or item count, missables; a divider at a new phase. */
export function JourneyRow({ chapters, counts, user, current, passed = false, currentAs, ref }: JourneyRowProps) {
  return (
    <ol ref={ref} className="wk-jr">
      {chapters.map((c, i) => {
        const full = c.refs.length > 0 && counts[i] === c.refs.length;
        const cls = [
          "wk-hn",
          i === current ? "c" : "",
          passed && i < current ? "p" : "",
          full ? "f" : "",
          i > 0 && c.phase !== chapters[i - 1].phase ? "ph" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={c.key} className={cls}>
            <a href={`#cap-${c.key}`} aria-current={i === current ? currentAs : undefined}>
              <span className="dot" aria-hidden="true" />
              <span className="t">{c.title}</span>
              <span className="s">
                {user ? `${counts[i]}/${c.refs.length}` : `${c.refs.length} itens`}
                {c.missables > 0 ? <span className="w"> · {c.missables} ⚠</span> : null}
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
