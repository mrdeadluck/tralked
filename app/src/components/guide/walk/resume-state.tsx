"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import { useJourney, type JourneyChapter, type JourneyLit } from "./journey";
import { useWalkProgress, type WalkSession } from "./progress";
import { resumeItems, resumeOf, type Resume } from "./resume";

/*
 * "Continuar de onde parou" on the page: the signed-in visitor's resume point (resume.ts), computed
 * once on the client from the journey and their progress, for the cover button, the "você está
 * aqui" marker, the missed panel and the lit chapters. The page never moves by itself on load; it
 * goes to the resume point only when the visitor asks (the button, a link) or right after a Steam
 * check they asked for brought new unlocks.
 */

/** How long a row stays highlighted after the page took the visitor to it. */
const HIGHLIGHT_MS = 2400;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Scrolls to an element (instant under reduced motion) and briefly highlights it. */
function bringIntoView(el: HTMLElement | null, highlight: boolean) {
  if (!el) return;
  el.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: highlight ? "center" : "start" });
  if (!highlight) return;
  el.classList.add("wk-hl");
  setTimeout(() => el.classList.remove("wk-hl"), HIGHLIGHT_MS);
}

type ResumeState = {
  session: WalkSession;
  chapters: JourneyChapter[];
  /** The visitor's resume point; null until a signed-in visitor's progress arrives. */
  at: Resume | null;
  /** A check the visitor asked for just brought new unlocks: the marker says why the page moved. */
  synced: boolean;
  /** Scrolls to an item's row (a gated one stays gated) and highlights it. */
  goTo: (ref: string) => void;
  /** Scrolls to the last chapter (the guide is done). */
  goToEnd: () => void;
};

const ResumeContext = createContext<ResumeState | null>(null);

export function ResumeProvider({ children }: { children: ReactNode }) {
  const chapters = useJourney();
  const { session, isTicked, isUnlocked, achievementOf, syncs } = useWalkProgress();

  const items = useMemo(() => resumeItems(chapters, achievementOf), [chapters, achievementOf]);
  const at = useMemo(
    () => (session === "user" ? resumeOf(items, { isTicked, isUnlocked }) : null),
    [session, items, isTicked, isUnlocked],
  );

  const goTo = useCallback((ref: string) => bringIntoView(document.getElementById(`item-${ref}`), true), []);
  const goToEnd = useCallback(() => {
    const last = chapters.at(-1);
    if (last) bringIntoView(document.getElementById(`cap-${last.key}`), false);
  }, [chapters]);

  // After each sync the visitor asked for, follow the resume point it moved (once per sync).
  const followed = useRef(0);
  useEffect(() => {
    if (syncs === followed.current) return;
    followed.current = syncs;
    if (at?.resume) goTo(at.resume.ref);
    else if (at) goToEnd();
  }, [syncs, at, goTo, goToEnd]);

  const synced = syncs > 0;
  const value = useMemo<ResumeState>(
    () => ({ session, chapters, at, synced, goTo, goToEnd }),
    [session, chapters, at, synced, goTo, goToEnd],
  );
  return <ResumeContext.Provider value={value}>{children}</ResumeContext.Provider>;
}

const NONE: ResumeState = {
  session: "pending",
  chapters: [],
  at: null,
  synced: false,
  goTo: () => {},
  goToEnd: () => {},
};

/** The resume state (nothing outside a ResumeProvider). */
export function useResume(): ResumeState {
  return useContext(ResumeContext) ?? NONE;
}

/** Lit chapters and the "você está aqui" chapter for a journey row; null for anonymous visitors. */
export function useJourneyLit(): JourneyLit | null {
  const { at, goTo } = useResume();
  return useMemo(() => {
    if (!at) return null;
    const point = at.resume;
    return {
      passed: new Set(at.passedChapters),
      here: point ? { chapter: point.chapter, ref: point.ref } : null,
      goHere: (event: MouseEvent<HTMLAnchorElement>) => {
        if (!point) return;
        event.preventDefault();
        goTo(point.ref);
      },
    };
  }, [at, goTo]);
}
