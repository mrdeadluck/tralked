"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { revealAchievement } from "@/components/guide/reveal-achievement";

/*
 * Spoilers of a walkthrough page: off by default. The reader turns them all on (the toggle in the
 * journey bar) or reveals one item at a time ("mostrar"). While hidden, the content is not
 * rendered at all, so it is not in the page's text either.
 */

type SpoilerState = {
  /** Every spoiler shown. */
  on: boolean;
  setOn: (on: boolean) => void;
  /** Shows one item, by id, without turning everything on. */
  reveal: (id: string) => void;
  /** Whether the item `id` is shown (everything on, or this one revealed). */
  shown: (id: string) => boolean;
};

const OFF: SpoilerState = { on: false, setOn: () => {}, reveal: () => {}, shown: () => false };

const SpoilerContext = createContext<SpoilerState>(OFF);

export function SpoilerProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const reveal = useCallback((id: string) => setRevealed((prev) => new Set(prev).add(id)), []);
  const value = useMemo<SpoilerState>(
    () => ({ on, setOn, reveal, shown: (id) => on || revealed.has(id) }),
    [on, reveal, revealed],
  );
  return <SpoilerContext.Provider value={value}>{children}</SpoilerContext.Provider>;
}

/** The page's spoiler state (all off outside a SpoilerProvider). */
export function useSpoilers(): SpoilerState {
  return useContext(SpoilerContext);
}

type SpoilerGateProps = {
  /** Unique on the page: revealing it shows only this one. */
  id: string;
  /** What the "mostrar" button reveals, for screen readers ("o aviso Final verdadeiro"). */
  what: string;
  /** Width of the blurred placeholder, in characters. */
  size?: number;
  children: ReactNode;
};

/** Children while spoilers are shown; a blurred bar and a "mostrar" button otherwise. */
export function SpoilerGate({ id, what, size = 14, children }: SpoilerGateProps) {
  const { shown, reveal } = useSpoilers();
  if (shown(id)) return <>{children}</>;
  return (
    <span className="wk-spoiler">
      <span data-spoiler="hidden" aria-hidden="true" className="wk-spoiler-bar" style={{ width: `${size}ch` }} />
      <button type="button" onClick={() => reveal(id)} className="wk-spoiler-btn" aria-label={`Mostrar ${what}`}>
        mostrar
      </button>
    </span>
  );
}

/** Name of a hidden Steam achievement: not sent with the page, fetched once it is shown. */
function FetchedName({ id }: { id: string }) {
  const [name, setName] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    revealAchievement(id).then(
      (r) => live && (r ? setName(r.name) : setFailed(true)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [id]);
  if (name) return <>{name}</>;
  return <span className="text-muted">{failed ? "Conquista oculta" : "…"}</span>;
}

type SpoilerAchievementProps = {
  /** Spoiler id on the page (see SpoilerGate). */
  id: string;
  achievement: { id: string; name: string | null };
  what: string;
};

/** An achievement's name behind the spoiler gate; a hidden one (name null) is fetched on reveal. */
export function SpoilerAchievement({ id, achievement, what }: SpoilerAchievementProps) {
  return (
    <SpoilerGate id={id} what={what}>
      {achievement.name ?? <FetchedName id={achievement.id} />}
    </SpoilerGate>
  );
}
