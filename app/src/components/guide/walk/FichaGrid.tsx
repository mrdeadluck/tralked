import type { ReactNode } from "react";
import { pctText } from "@/components/guide/format";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";
import type { GuideDetail, WalkExtras } from "@/lib/queries/games";
import { timeTo100Label } from "@/lib/queries/time-to-100";
import { formatCompact } from "@/lib/xp-format";
import { SpoilerAchievement } from "./spoilers";

/*
 * "A tabelinha": the 8 numbers of a walkthrough (difficulty, time to the Tralked, achievements,
 * minimum playthroughs, missables, online, bugged, the hardest) and, under them, the guide's XP.
 * The hardest achievement's name stays blurred while spoilers are off.
 */

type Field = { label: string; value: ReactNode; note: ReactNode; warn?: boolean; extra?: ReactNode; name?: boolean };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function hoursText({ min, max }: WalkExtras["hours"]): string {
  return min === max ? String(min) : `${min}–${max}`;
}

type FichaGridProps = { guide: GuideDetail; walkthrough: Walkthrough; walk: WalkExtras };

export function FichaGrid({ guide, walkthrough, walk }: FichaGridProps) {
  const { facts, game } = guide;
  const { extraFacts } = walkthrough;
  const players = facts.timeTo100?.source === "tralked" ? timeTo100Label(facts.timeTo100) : null;
  const asOf = game.guide.updatedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const hardest = walk.hardest;

  const fields: Field[] = [
    {
      label: "Dificuldade",
      value: (
        <>
          {facts.difficulty}
          <small>/10</small>
        </>
      ),
      extra: (
        <span className="wk-diff" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} className={i < facts.difficulty ? "on" : undefined} />
          ))}
        </span>
      ),
      note: extraFacts.difficultyNote,
    },
    {
      label: "Tempo até o Tralked",
      value: (
        <>
          {hoursText(walk.hours)}
          <small> h</small>
        </>
      ),
      note: players ? `Jogadores do Tralked: ${players.value} (${players.source}).` : "Estimativa do guia, seguindo o detonado.",
    },
    {
      label: "Conquistas",
      value: game.achievementCount,
      note:
        walk.hiddenCount > 0
          ? `Lista oficial da Steam · ${walk.hiddenCount} ${plural(walk.hiddenCount, "oculta", "ocultas")}`
          : "Lista oficial da Steam · nenhuma oculta",
    },
    { label: "Zeradas mínimas", value: facts.playthroughs, note: extraFacts.playthroughsNote },
    {
      label: "Perdíveis",
      value: facts.missables,
      warn: facts.missables > 0,
      note: facts.missables > 0 ? "Avisadas no caminho, antes do ponto sem volta." : "Nada fica para trás.",
    },
    {
      label: "Online",
      value: facts.online,
      note: facts.online === 0 ? "Tralked 100% offline." : `${plural(facts.online, "Uma pede", "Pedem")} partida online.`,
    },
    {
      label: "Com bug",
      value: extraFacts.buggedCount,
      note: extraFacts.buggedCount === 0 ? `Nenhum relato até ${asOf}.` : "O detonado mostra como contornar.",
    },
    {
      label: "Mais difícil",
      name: true,
      value: hardest ? (
        <SpoilerAchievement id="ficha-hardest" achievement={hardest} what="a conquista mais difícil" />
      ) : (
        "—"
      ),
      note: hardest ? `${pctText(hardest.globalPct)} dos jogadores na Steam` : "Sem raridade da Steam ainda.",
    },
  ];

  return (
    <section className="wk-ficha tk-cut" aria-label="Ficha do guia">
      <dl>
        {fields.map((f) => (
          <div key={f.label} className={f.warn ? "wk-f warn" : "wk-f"}>
            <dt className="wk-lbl">{f.label}</dt>
            <dd>
              <span className={f.name ? "v name" : "v"}>{f.value}</span>
              {f.extra}
              <span className="d">{f.note}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="wk-xp">
        <span className="wk-lbl">XP do guia</span>
        <span>
          <b>+{formatCompact(guide.totals.xp)} XP</b> nas {game.achievementCount} conquistas da Steam. Só a Steam
          confirma: marcar no guia não dá XP.
        </span>
      </p>
    </section>
  );
}
