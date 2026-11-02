import { NavLink } from "@/components/layout/NavLink";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { TodayMission } from "@/lib/queries/news";

const xpFormat = new Intl.NumberFormat("pt-BR");

/** `mission` is null when there is none for today (or nobody is logged in). */
export function DailyQuestCard({
  mission,
  loggedIn,
}: {
  mission: TodayMission | null;
  loggedIn: boolean;
}) {
  return (
    <Card>
      <div className="mb-1 flex items-end justify-between gap-3 border-b border-[#23252c] pb-3.5">
        <h2 className="text-[19px] leading-[1.05] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          Missão de hoje
        </h2>
        {loggedIn ? (
          <NavLink
            href="/jogador/me"
            className="font-mono text-xs tracking-[0.08em] text-acc uppercase"
          >
            Ver todas →
          </NavLink>
        ) : null}
      </div>
      <div className="flex flex-col gap-2.5 pt-3">
        {mission ? (
          <>
            <p className="text-[15px] font-semibold">{mission.title}</p>
            <ProgressBar
              value={(mission.progress / mission.goal) * 100}
              label={mission.title}
            />
            <div className="flex justify-between font-mono text-xs text-dim">
              <span>
                {mission.progress} de {mission.goal}
              </span>
              <b className="text-acc">+{xpFormat.format(mission.rewardXp)} XP</b>
            </div>
          </>
        ) : loggedIn ? (
          <p className="text-[15px] text-muted">
            Nenhuma missão para hoje. Volte amanhã.
          </p>
        ) : (
          <>
            <p className="text-[15px] text-muted">
              Missões diárias rendem XP extra.
            </p>
            <NavLink
              href="/entrar?returnTo=%2F"
              className="font-mono text-xs font-bold tracking-[0.1em] text-acc uppercase"
            >
              Entre para receber missões →
            </NavLink>
          </>
        )}
      </div>
    </Card>
  );
}
