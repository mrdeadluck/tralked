import { loginHref } from "@/components/guide/format";
import { Toc, type TocItem } from "@/components/guide/Toc";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";
import type { GuideDetail } from "@/lib/queries/games";
import { formatCompact } from "@/lib/xp-format";

/*
 * Sticky column of a walkthrough: the visitor's progress (Steam achievements, ticked
 * collectibles, the XP still on the table) and "Neste guia", the table of contents.
 */

type WalkSidebarProps = {
  guide: GuideDetail;
  walkthrough: Walkthrough;
  loggedIn: boolean;
  returnTo: string;
};

export function WalkSidebar({ guide, walkthrough, loggedIn, returnTo }: WalkSidebarProps) {
  const { game, totals, itemsDone } = guide;
  const items = walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
  const collectibles = items.filter((i) => i.kind === "collectible");
  const doneCollectibles = collectibles.filter((i) => itemsDone.has(i.key)).length;

  const toc: TocItem[] = [
    ...(guide.overview.length > 0 ? [{ id: "g-visao", label: "Visão geral" }] : []),
    { id: "g-leia", label: "Antes de começar" },
    ...(guide.steps.length > 0 ? [{ id: "g-roadmap", label: "Roadmap", count: `${guide.steps.length} etapas` }] : []),
    { id: "g-detonado", label: "Detonado", count: `${walkthrough.chapters.length} cap.` },
  ];

  return (
    <aside className="wk-side" aria-label="Seu progresso e índice do guia">
      <div className="wk-card">
        <h2>Seu progresso</h2>
        {loggedIn ? (
          <>
            <p className="wk-row">
              <span>Conquistas</span>
              <b>
                {game.progress?.unlockedCount ?? 0} / {game.achievementCount}
              </b>
            </p>
            <p className="wk-row">
              <span>Coletáveis</span>
              <b>
                {doneCollectibles} / {collectibles.length}
              </b>
            </p>
            <p className="wk-row">
              <span>Faltam neste guia</span>
              <b className="acc">+{formatCompact(totals.pendingXp)} XP</b>
            </p>
            <p className="note">
              {game.progress
                ? "As conquistas vêm da sua Steam. O XP só entra quando a Steam confirma."
                : "Este jogo ainda não aparece na sua biblioteca Steam. Sincronize seu perfil para acompanhar."}
            </p>
          </>
        ) : (
          <p className="note">
            <a href={loginHref(returnTo)}>Entre</a> para marcar os itens do detonado e ver quanto XP as{" "}
            {game.achievementCount} conquistas valem para você.
          </p>
        )}
      </div>
      <div className="wk-card">
        <h2>Neste guia</h2>
        <Toc items={toc} />
      </div>
    </aside>
  );
}
