import { Toc, type TocItem } from "@/components/guide/Toc";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";
import type { GuideDetail } from "@/lib/queries/games";
import { ProgressCard } from "./ProgressBits";

/*
 * Sticky column of a walkthrough: the visitor's progress (Steam achievements, ticked
 * collectibles, the XP still on the table) and "Neste guia", the table of contents.
 */

type WalkSidebarProps = {
  guide: GuideDetail;
  walkthrough: Walkthrough;
  /** Refs of the walkthrough's collectibles (view.ts), to count the visitor's ticks. */
  collectibleRefs: string[];
};

export function WalkSidebar({ guide, walkthrough, collectibleRefs }: WalkSidebarProps) {
  const toc: TocItem[] = [
    ...(guide.overview.length > 0 ? [{ id: "g-visao", label: "Visão geral" }] : []),
    { id: "g-leia", label: "Antes de começar" },
    ...(guide.steps.length > 0 ? [{ id: "g-roadmap", label: "Roadmap", count: `${guide.steps.length} etapas` }] : []),
    { id: "g-detonado", label: "Detonado", count: `${walkthrough.chapters.length} cap.` },
  ];

  return (
    <aside className="wk-side" aria-label="Seu progresso e índice do guia">
      <ProgressCard achievementCount={guide.game.achievementCount} collectibleRefs={collectibleRefs} />
      <div className="wk-card">
        <h2>Neste guia</h2>
        <Toc items={toc} />
      </div>
    </aside>
  );
}
