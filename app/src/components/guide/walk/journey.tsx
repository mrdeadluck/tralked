"use client";

import { createContext, useContext, useMemo, type MouseEvent, type ReactNode, type Ref } from "react";
import { useVersion } from "./version-state";
import { STEAM_ONLY } from "./versions";

/*
 * The chapters of the journey, sent to the browser once (JourneyProvider) and read by every row of
 * diamonds: the big row under the page's top (WalkJourney) and the timeline before each chapter
 * (ChapterTimeline), which only carries its own number. The resume point (resume-state.tsx) reads
 * them too. They follow the version being read (version-state.tsx): in the PlayStation version a
 * chapter counts only the items it shows, and a chapter it leaves out is not drawn.
 */

/** A missable of the chapter: its name, or null while it is behind the spoiler gate. */
export type JourneyMissable = { ref: string; name: string | null };

export type JourneyChapter = {
  key: string;
  title: string;
  /** Roadmap phase (a divider marks where it changes). */
  phase: number;
  /** Refs of the chapter's items (view.ts), in order. */
  refs: string[];
  /** Items per step, in order: step `n` of chapter `c` is numbered `${c + 1}.${n + 1}`. */
  steps: number[];
  missables: JourneyMissable[];
  /** The robot's cleanup chapter (resume.ts). */
  cleanup: boolean;
  /** The PlayStation version leaves the whole chapter out (view.ts). */
  steamOnly?: boolean;
  /** Left out of the version being read: its diamond is not drawn (it keeps its place and number). */
  hidden?: boolean;
};

const JourneyContext = createContext<JourneyChapter[]>([]);

/** The chapter as a version shows it: only the refs it shows, counted again per step. */
function shownChapter(chapter: JourneyChapter, shownRefs: (refs: readonly string[]) => readonly string[]): JourneyChapter {
  const shown = new Set(shownRefs(chapter.refs));
  let at = 0;
  const steps = chapter.steps.map((count) => chapter.refs.slice(at, (at += count)).filter((ref) => shown.has(ref)).length);
  return {
    ...chapter,
    refs: chapter.refs.filter((ref) => shown.has(ref)),
    steps,
    missables: chapter.missables.filter((m) => shown.has(m.ref)),
    hidden: Boolean(chapter.steamOnly),
  };
}

export function JourneyProvider({ chapters, children }: { chapters: JourneyChapter[]; children: ReactNode }) {
  const { version, shownRefs } = useVersion();
  const shown = useMemo(
    () => (version === "playstation" ? chapters.map((c) => shownChapter(c, shownRefs)) : chapters),
    [chapters, version, shownRefs],
  );
  return <JourneyContext value={shown}>{children}</JourneyContext>;
}

export const useJourney = () => useContext(JourneyContext);

/** A signed-in visitor's progress on the row (resume-state.tsx). */
export type JourneyLit = {
  /** Chapters the visitor has passed: drawn lit. */
  passed: ReadonlySet<number>;
  /** The resume point's chapter ("você está aqui") and item; null when the guide is done. */
  here: { chapter: number; ref: string } | null;
  /** Follows the "você está aqui" link (scroll and highlight). */
  goHere: (event: MouseEvent<HTMLAnchorElement>) => void;
};

type JourneyRowProps = {
  chapters: JourneyChapter[];
  /** The visitor's done items per chapter. */
  counts: number[];
  /** Signed in: the row shows done/total, otherwise the item count. */
  user: boolean;
  current: number;
  /** Chapters before the current one are drawn as passed (the timeline before a chapter). */
  passed?: boolean;
  /** aria-current of the current chapter's link. */
  currentAs: "location" | "step";
  /** Signed in: lit chapters and the resume point. */
  lit?: JourneyLit | null;
  ref?: Ref<HTMLOListElement>;
};

/** A diamond per chapter: short title, ticks or item count, missables; a divider at a new phase. */
export function JourneyRow({ chapters, counts, user, current, passed = false, currentAs, lit = null, ref }: JourneyRowProps) {
  return (
    <ol ref={ref} className="wk-jr">
      {chapters.map((c, i) => {
        const full = c.refs.length > 0 && counts[i] === c.refs.length;
        const here = lit?.here?.chapter === i ? lit.here : null;
        const before = chapters.slice(0, i).findLast((b) => !b.hidden);
        const cls = [
          "wk-hn",
          i === current ? "c" : "",
          passed && i < current ? "p" : "",
          full ? "f" : "",
          before && c.phase !== before.phase ? "ph" : "",
          lit?.passed.has(i) ? "lit" : "",
          here ? "here" : "",
          // Hidden by the root's CSS from the first paint; `hidden` follows once the client reads the choice.
          c.steamOnly ? STEAM_ONLY : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          // A hidden chapter keeps its <li>: the rows find a chapter's diamond by its index.
          <li key={c.key} className={cls} hidden={c.hidden}>
            <a
              href={here ? `#item-${here.ref}` : `#cap-${c.key}`}
              aria-current={i === current ? currentAs : undefined}
              onClick={here ? lit?.goHere : undefined}
            >
              <span className="dot" aria-hidden="true" />
              <span className="t">{c.title}</span>
              <span className="s">
                {user ? `${counts[i]}/${c.refs.length}` : `${c.refs.length} itens`}
                {c.missables.length > 0 ? <span className="w"> · {c.missables.length} ⚠</span> : null}
              </span>
              {here ? <span className="here-tag">você está aqui</span> : null}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
