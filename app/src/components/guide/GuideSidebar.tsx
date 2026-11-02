import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Ring } from "@/components/ui/Ring";
import { SKILLS } from "@/lib/engine/types";
import type { GuideDetail } from "@/lib/queries/games";
import { fmt, loginHref } from "./format";
import { Toc, type TocItem } from "./Toc";

const SKILL_NAME = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

function SideCard({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <div className="mb-1 border-b border-[#23252C] pb-3.5">
        <h2 className="text-[19px] leading-[1.05] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          {title}
        </h2>
      </div>
      {children}
    </Card>
  );
}

type GuideSidebarProps = {
  guide: GuideDetail;
  loggedIn: boolean;
  returnTo: string;
  /** True while the visitor's progress is still loading. */
  pending?: boolean;
};

export function GuideSidebar({ guide, loggedIn, returnTo, pending = false }: GuideSidebarProps) {
  const { game, totals } = guide;
  const progress = game.progress;
  const pct =
    progress && game.achievementCount > 0
      ? Math.round((progress.unlockedCount / game.achievementCount) * 100)
      : 0;

  const tocItems: TocItem[] = [
    { id: "g-visao", label: "Visão geral" },
    { id: "g-rota", label: "Rota para o 100%", count: `${guide.steps.length} etapas` },
    { id: "g-conq", label: "Conquistas", count: guide.achievements.length },
    ...(guide.collectibles.length > 0
      ? [{ id: "g-colet", label: "Coletáveis", count: guide.collectibles.length }]
      : []),
    guide.tips.length > 0
      ? { id: "g-dicas", label: "Dicas da comunidade", count: guide.tips.length }
      : { id: "g-dicas", label: "Deixe a primeira dica" },
    ...(guide.revisions.length > 0
      ? [{ id: "g-rev", label: "Revisões", count: guide.revisions.length }]
      : []),
    ...(guide.sources.length > 0 ? [{ id: "g-fontes", label: "Fontes", count: guide.sources.length }] : []),
  ];

  return (
    <aside className="flex flex-col gap-5 min-[1101px]:sticky min-[1101px]:top-24 max-[1100px]:order-first">
      <SideCard title="Seu progresso">
        {progress ? (
          <div className="flex items-center gap-4 pt-3.5">
            <Ring value={pct} size={72} />
            <p className="text-sm text-muted">
              <b className="text-text">
                {progress.unlockedCount} de {game.achievementCount}
              </b>{" "}
              conquistas. Faltam {game.achievementCount - progress.unlockedCount}
              {totals.pendingCount > 0 ? (
                <>
                  , e as {totals.pendingCount} pendentes deste guia valem{" "}
                  <b className="text-acc">+{fmt(totals.pendingXp)} XP</b>
                </>
              ) : null}
              .
            </p>
          </div>
        ) : pending ? (
          <p className="pt-3.5 text-sm text-muted" aria-busy="true">
            Carregando o seu progresso...
          </p>
        ) : loggedIn ? (
          <p className="pt-3.5 text-sm text-muted">
            Este jogo ainda não aparece na sua biblioteca. Sincronize seu perfil para acompanhar o
            progresso.
          </p>
        ) : (
          <p className="pt-3.5 text-sm text-muted">
            <a href={loginHref(returnTo)} className="text-acc underline underline-offset-2">
              Entre
            </a>{" "}
            para ver seu progresso neste jogo e quanto XP as conquistas pendentes valem.
          </p>
        )}
      </SideCard>

      <SideCard title="Este guia treina">
        <div className="flex flex-col gap-2.5 pt-3.5">
          {guide.skillLevels.map(({ skill, level }) => (
            <div key={skill} className="flex items-center justify-between text-[15px]">
              <span>{SKILL_NAME[skill]}</span>
              {level !== null ? (
                <b className="text-xl font-black font-stretch-[125%]">{level}</b>
              ) : null}
            </div>
          ))}
        </div>
      </SideCard>

      <SideCard title="Neste guia" className="max-[1100px]:hidden">
        <Toc items={tocItems} />
      </SideCard>
    </aside>
  );
}
