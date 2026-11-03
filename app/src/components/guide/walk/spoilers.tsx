"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { revealAchievement } from "@/components/guide/reveal-achievement";
import { inlineMarkup } from "@/lib/content/render";
import { revealWalkSpoilers } from "./reveal-spoilers";
import type { GatedItem, WalkSpoilers } from "./view";

/*
 * Spoilers of a walkthrough page: off by default. The reader turns them all on (the toggle in the
 * journey bar) or reveals one at a time ("mostrar"). The server sends placeholders only (view.ts):
 * the first time anything is shown, the provider fetches this guide's spoilers once
 * (revealWalkSpoilers) and the gates below render them. Nothing gated is in the page's HTML or
 * payload while spoilers are off.
 */

type Texts = WalkSpoilers | null | "failed";

type SpoilerState = {
  /** Every spoiler shown. */
  on: boolean;
  setOn: (on: boolean) => void;
  /** Shows one gate, by id, without turning everything on. */
  reveal: (id: string) => void;
  /** Whether the gate `id` is shown (everything on, or this one revealed). */
  shown: (id: string) => boolean;
  /** The guide's spoilers once fetched; "failed" when the server refused. */
  texts: Texts;
};

const OFF: SpoilerState = { on: false, setOn: () => {}, reveal: () => {}, shown: () => false, texts: null };

const SpoilerContext = createContext<SpoilerState>(OFF);

export function SpoilerProvider({ guideId, children }: { guideId: string; children: ReactNode }) {
  const [on, setOn] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [texts, setTexts] = useState<Texts>(null);
  const reveal = useCallback((id: string) => setRevealed((prev) => new Set(prev).add(id)), []);
  const wanted = on || revealed.size > 0;

  useEffect(() => {
    if (!wanted || texts !== null) return;
    let live = true;
    revealWalkSpoilers(guideId).then(
      (r) => live && setTexts(r ?? "failed"),
      () => live && setTexts("failed"),
    );
    return () => {
      live = false;
    };
  }, [wanted, texts, guideId]);

  const value = useMemo<SpoilerState>(
    () => ({ on, setOn, reveal, shown: (id) => on || revealed.has(id), texts }),
    [on, reveal, revealed, texts],
  );
  return <SpoilerContext.Provider value={value}>{children}</SpoilerContext.Provider>;
}

/** The page's spoiler state (all off outside a SpoilerProvider). */
export function useSpoilers(): SpoilerState {
  return useContext(SpoilerContext);
}

/** A gated item's real text once its gate `id` is shown and the spoilers arrived; null otherwise. */
export function useGatedItem(id: string, ref: string): GatedItem | null {
  const { shown, texts } = useSpoilers();
  if (!shown(id) || !texts || texts === "failed") return null;
  return texts.items[ref] ?? null;
}

type SpoilerGateProps = {
  /** Unique on the page: revealing it shows only this one. */
  id: string;
  /** What the "mostrar" button reveals, for screen readers ("o aviso Final verdadeiro"). */
  what: string;
  /** Width of the blurred placeholder, in characters. */
  size?: number;
  /**
   * Shown once revealed. Only client code may pass children here: whatever a server component
   * passes is serialized into the page, shown or not. Server components use the gates below
   * (SpoilerNote, SpoilerItemName, SpoilerCallout, SpoilerAchievement), which fetch their text.
   */
  children: ReactNode;
};

/** Children while the gate is shown; a blurred bar and a "mostrar" button otherwise. */
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

/** While the spoilers are on their way: "…", or a neutral word when the server refused. */
function Pending({ failed, fallback }: { failed: boolean; fallback: string }) {
  return <span className="text-muted">{failed ? fallback : "…"}</span>;
}

/** A fetched spoiler text (null until it arrives) and whether the fetch failed. */
function useSpoilerText(pick: (texts: WalkSpoilers) => string | undefined): { text: string | null; failed: boolean } {
  const { texts } = useSpoilers();
  if (texts === "failed") return { text: null, failed: true };
  return { text: texts ? (pick(texts) ?? null) : null, failed: false };
}

/** A read-first note marked as spoiler: its text is fetched on reveal. */
export function SpoilerNote({ id, index, what }: { id: string; index: number; what: string }) {
  const { text, failed } = useSpoilerText((t) => t.notes[String(index)]);
  return (
    <SpoilerGate id={id} what={what} size={24}>
      <p>{text ? inlineMarkup(text) : <Pending failed={failed} fallback="Spoiler" />}</p>
    </SpoilerGate>
  );
}

/** Name of a gated item (spoiler, or a hidden achievement's item), fetched on reveal. */
export function SpoilerItemName({ id, itemRef, what }: { id: string; itemRef: string; what: string }) {
  const { text, failed } = useSpoilerText((t) => t.items[itemRef]?.name);
  return (
    <SpoilerGate id={id} what={what}>
      {text ?? <Pending failed={failed} fallback="Spoiler" />}
    </SpoilerGate>
  );
}

/** A step callout with the "spoiler" tone: its label stays, its text is fetched on reveal. */
export function SpoilerCallout({ id }: { id: string }) {
  const { text, failed } = useSpoilerText((t) => t.callouts[id]);
  return (
    <aside className="wk-callout s" aria-label="Spoiler">
      <b>Spoiler.</b>{" "}
      <SpoilerGate id={`callout-${id}`} what="o trecho com spoiler" size={30}>
        {text ? inlineMarkup(text) : <Pending failed={failed} fallback="Trecho com spoiler" />}
      </SpoilerGate>
    </aside>
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
  return <Pending failed={failed} fallback="Conquista oculta" />;
}

/*
 * Only primitives cross into this client component: whatever it receives is serialized into the
 * page, so a hidden achievement must arrive as its database id and nothing else (never its apiName,
 * which often spells the name).
 */
type SpoilerAchievementProps = {
  /** Spoiler id on the page (see SpoilerGate). */
  id: string;
  /** Database id of the achievement, to fetch a hidden one's name. */
  achievementId: string;
  /** The name; null for a hidden Steam achievement (fetched on reveal). */
  name: string | null;
  what: string;
};

/** An achievement's name behind the spoiler gate; a hidden one (name null) is fetched on reveal. */
export function SpoilerAchievement({ id, achievementId, name, what }: SpoilerAchievementProps) {
  return (
    <SpoilerGate id={id} what={what}>
      {name ?? <FetchedName id={achievementId} />}
    </SpoilerGate>
  );
}
