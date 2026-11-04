"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useJourney, type JourneyChapter, type JourneyLit } from "./journey";
import { useWalkProgress, type WalkSession } from "./progress";
import { resumeItems, resumeOf, type Evidence, type Resume } from "./resume";

/*
 * "Continuar de onde parou" on the page: the signed-in visitor's resume point (resume.ts), computed
 * once on the client from the journey and their progress, for the cover buttons, the "você está
 * aqui" marker, the missed panel and the lit chapters. The page never moves by itself: it goes to
 * the resume point only when the visitor asks (the continue button, a link) or after the cover's
 * "Sincronizar conquistas", which asks Steam, says where the visitor is and takes them there.
 * Ticking a row never moves the page.
 */

/** How long a row stays highlighted after the page took the visitor to it. */
const HIGHLIGHT_MS = 2400;
/** How long the marker glows (and the announcement stays) after a sync. */
const SYNCED_MS = 5000;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Scrolls to an element (instant under reduced motion) and briefly highlights it. */
function bringIntoView(el: HTMLElement | null, highlight: boolean) {
  if (!el) return;
  el.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: highlight ? "center" : "start" });
  if (!highlight) return;
  el.classList.add("wk-hl");
  setTimeout(() => el.classList.remove("wk-hl"), HIGHLIGHT_MS);
}

const WHY: Record<Exclude<Evidence, "nenhum">, string> = {
  conquistas: "De acordo com suas conquistas, você está aqui na história",
  itens: "Pelos itens que você marcou, você está aqui",
  ambos: "Pelas suas conquistas e pelos itens que você marcou, você está aqui na história",
};

/** What the marker (and the announcement after a sync) says about the visitor's place. */
export function hereText(at: Resume, chapters: JourneyChapter[]): string {
  const point = at.resume;
  if (!point) return "Guia concluído: você passou por todo o detonado.";
  const chapter = chapters[point.chapter];
  const where = `${chapter ? `${chapter.title}, ` : ""}passo ${point.step}`;
  if (at.evidence === "nenhum") return `Sua Steam ainda não tem conquistas deste guia: o detonado começa aqui, ${where}.`;
  return `${WHY[at.evidence]}: ${where}.`;
}

/** The cover's sync: idle, asking Steam, or why it could not. */
export type SyncStatus = "idle" | "syncing" | "invite" | "login" | "error";

type ResumeState = {
  session: WalkSession;
  chapters: JourneyChapter[];
  /** The visitor's resume point; null until a signed-in visitor's progress arrives. */
  at: Resume | null;
  /** A sync just finished: the marker shows (and glows) for a few seconds. */
  synced: boolean;
  syncStatus: SyncStatus;
  /** Asks Steam (checkGameAchievements), then says where the visitor is and takes them there. */
  sync: () => Promise<void>;
  /** Scrolls to an item's row (a gated one stays gated) and highlights it. */
  goTo: (ref: string) => void;
  /** Scrolls to the last chapter the version being read shows (the guide is done). */
  goToEnd: () => void;
};

const ResumeContext = createContext<ResumeState | null>(null);

export function ResumeProvider({ children }: { children: ReactNode }) {
  const chapters = useJourney();
  const { session, isTicked, isUnlocked, achievementOf, check } = useWalkProgress();
  const [syncs, setSyncs] = useState(0);
  const [synced, setSynced] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const glow = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(glow.current), []);

  const items = useMemo(() => resumeItems(chapters, achievementOf), [chapters, achievementOf]);
  const at = useMemo(
    () => (session === "user" ? resumeOf(items, { isTicked, isUnlocked }) : null),
    [session, items, isTicked, isUnlocked],
  );

  const goTo = useCallback((ref: string) => bringIntoView(document.getElementById(`item-${ref}`), true), []);
  const goToEnd = useCallback(() => {
    const last = chapters.findLast((c) => !c.hidden);
    if (last) bringIntoView(document.getElementById(`cap-${last.key}`), false);
  }, [chapters]);

  const sync = useCallback(async () => {
    setSyncStatus("syncing");
    let status: SyncStatus = "idle";
    try {
      const result = await check();
      if (result.status === "unlinked" || result.status === "private") status = "invite";
      else if (result.status === "unauthenticated") status = "login";
      else if (result.status === "error") status = "error";
    } catch {
      status = "error";
    }
    setSyncStatus(status);
    if (status !== "idle") return;
    setSyncs((n) => n + 1);
    setSynced(true);
    clearTimeout(glow.current);
    glow.current = setTimeout(() => setSynced(false), SYNCED_MS);
  }, [check]);

  // After each sync, take the visitor to the resume point it computed (read after the new unlocks).
  const followed = useRef(0);
  useEffect(() => {
    if (syncs === followed.current) return;
    followed.current = syncs;
    if (at?.resume) goTo(at.resume.ref);
    else if (at) goToEnd();
  }, [syncs, at, goTo, goToEnd]);

  const value = useMemo<ResumeState>(
    () => ({ session, chapters, at, synced, syncStatus, sync, goTo, goToEnd }),
    [session, chapters, at, synced, syncStatus, sync, goTo, goToEnd],
  );
  return (
    <ResumeContext.Provider value={value}>
      {children}
      {/* The page's one live region: where a sync left the visitor. */}
      <p className="sr-only" role="status" aria-live="polite">
        {synced && at ? hereText(at, chapters) : ""}
      </p>
    </ResumeContext.Provider>
  );
}

const NONE: ResumeState = {
  session: "pending",
  chapters: [],
  at: null,
  synced: false,
  syncStatus: "idle",
  sync: async () => {},
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
