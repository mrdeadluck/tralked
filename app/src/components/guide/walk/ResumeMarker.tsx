"use client";

import type { MouseEvent } from "react";
import type { JourneyChapter } from "./journey";
import type { Evidence } from "./resume";
import { useResume } from "./resume-state";
import { SpoilerItemName } from "./spoilers";

/*
 * "Você está aqui": a callout on the signed-in visitor's resume step that says why the guide brought
 * them there (their Steam achievements, the items they ticked, or both), what they left behind, and
 * the missables they may have missed ("talvez": they may have done one without ticking it). Item
 * names behind the spoiler gate stay masked, as everywhere.
 */

const WHY: Record<Exclude<Evidence, "nenhum">, string> = {
  conquistas: "De acordo com suas conquistas, você está aqui na história",
  itens: "Pelos itens que você marcou, você está aqui",
  ambos: "Pelas suas conquistas e pelos itens que você marcou, você está aqui na história",
};

/** A link that takes the page to an item's row (scroll and highlight) instead of jumping. */
function ItemLink({ itemRef, children }: { itemRef: string; children: string }) {
  const { goTo } = useResume();
  return (
    <a
      href={`#item-${itemRef}`}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        goTo(itemRef);
      }}
    >
      {children}
    </a>
  );
}

/** "3 itens ficaram para trás. Ver o primeiro" */
export function BehindLink({ refs }: { refs: string[] }) {
  if (refs.length === 0) return null;
  return (
    <p className="wk-behind">
      {refs.length === 1 ? "1 item ficou para trás." : `${refs.length} itens ficaram para trás.`}{" "}
      <ItemLink itemRef={refs[0]}>Ver o primeiro</ItemLink>
    </p>
  );
}

function MissedPanel({ refs, chapters }: { refs: string[]; chapters: JourneyChapter[] }) {
  if (refs.length === 0) return null;
  const names = new Map(chapters.flatMap((c) => c.missables.map((m) => [m.ref, m.name] as const)));
  return (
    <aside className="wk-missed tk-cut" aria-label="Talvez você tenha perdido">
      <b className="wk-lbl">Talvez você tenha perdido</b>
      <ul>
        {refs.map((ref) => {
          const name = names.get(ref) ?? null;
          return (
            <li key={ref}>
              {name ?? <SpoilerItemName id={`perdido-${ref}`} itemRef={ref} what="o perdível" />}
              {" · "}
              <ItemLink itemRef={ref}>ir até ele</ItemLink>
            </li>
          );
        })}
      </ul>
      <p>
        Talvez você tenha feito sem marcar. Se não fez, pode precisar de uma nova jogada ou da seleção de capítulos para
        pegar.
      </p>
    </aside>
  );
}

/** Rendered in every step; shows only on the visitor's resume step, once they have some progress. */
export function ResumeMarker({ step }: { step: string }) {
  const { at, chapters, synced } = useResume();
  const point = at?.resume;
  if (!at || !point || point.step !== step || at.evidence === "nenhum") return null;
  const chapter = chapters[point.chapter];
  return (
    <>
      <aside className={synced ? "wk-here now tk-cut" : "wk-here tk-cut"} aria-label="Você está aqui">
        <b className="wk-lbl">Você está aqui</b>
        <p role={synced ? "status" : undefined}>
          {WHY[at.evidence]}: {chapter ? `${chapter.title}, ` : null}passo {step}.
        </p>
        <BehindLink refs={at.behind} />
      </aside>
      <MissedPanel refs={at.possiblyMissed} chapters={chapters} />
    </>
  );
}
