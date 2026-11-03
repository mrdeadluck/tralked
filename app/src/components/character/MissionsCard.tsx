import type { CharacterMission } from "@/lib/queries/players";
import { formatCompact } from "@/lib/xp-format";
import { Bar, Panel } from "./Panel";

type MissionsCardProps = {
  missions: CharacterMission[];
  /** Pronto no servidor: "Renovam em 6 h". */
  resetLabel: string;
};

/**
 * Daily and weekly missions. A finished mission is paid on the next sync (there is no claim
 * button): it turns moss with its reward marked as earned.
 */
export function MissionsCard({ missions, resetLabel }: MissionsCardProps) {
  return (
    <Panel title="Missões" aside={resetLabel}>
      {missions.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhuma missão ativa agora. Sincronize suas conquistas para receber as próximas.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {missions.map((mission) => {
            const shown = Math.min(mission.progress, mission.goal);
            return (
              <li
                key={mission.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 px-3 py-2.5 ${
                  mission.done ? "bg-[linear-gradient(90deg,var(--moss),var(--surface-2))]" : "bg-surface-2"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold">
                    {mission.done ? <span className="text-acc">Concluída: </span> : null}
                    {mission.title}
                  </p>
                  <small className="block text-[12.5px] text-muted">
                    {mission.kind === "daily" ? "Diária" : "Semanal"} · {shown} de {mission.goal}
                  </small>
                </div>
                <span className="text-right text-[13.5px] font-extrabold whitespace-nowrap text-acc tabular-nums">
                  {mission.done ? <span className="sr-only">Recompensa ganha: </span> : null}+{formatCompact(mission.rewardXp)} XP
                </span>
                <div
                  role="progressbar"
                  aria-label={mission.title}
                  aria-valuemin={0}
                  aria-valuemax={mission.goal}
                  aria-valuenow={shown}
                  className="col-span-full"
                >
                  {mission.goal <= 10 ? (
                    <span aria-hidden="true" className="flex gap-0.5">
                      {Array.from({ length: mission.goal }, (_, i) => (
                        <i key={i} className={`h-1 flex-1 ${i < shown ? "bg-acc" : "bg-track"}`} />
                      ))}
                    </span>
                  ) : (
                    <Bar fraction={shown / mission.goal} hot className="h-1" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
