import { Card } from "@/components/ui/Card";
import type { CharacterMission } from "@/lib/queries/players";
import { CardHead } from "./CardHead";
import { formatNumber } from "./format";

type MissionsCardProps = {
  missions: CharacterMission[];
  /** Pronto no servidor: "Renovam em 6 h". */
  resetLabel: string;
};

export function MissionsCard({ missions, resetLabel }: MissionsCardProps) {
  return (
    <Card>
      <CardHead title="Missões" aside={resetLabel} />
      {missions.length === 0 ? (
        <p className="pt-3.5 text-sm text-muted">
          Nenhuma missão ativa agora. Sincronize suas conquistas para receber as próximas.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {missions.map((mission) => {
            const shown = Math.min(mission.progress, mission.goal);
            return (
              <li
                key={mission.id}
                className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 border-b border-divider py-3.5 last:border-b-0 last:pb-0"
              >
                <div>
                  <p className={`text-[15px] font-semibold ${mission.done ? "text-acc" : ""}`}>
                    {mission.done ? "Concluída: " : ""}
                    {mission.title}
                  </p>
                  <small className="font-mono text-xs text-dim">
                    {mission.kind === "daily" ? "Diária" : "Semanal"}, {shown} de {mission.goal}
                  </small>
                </div>
                <span className="text-right font-mono text-xs font-bold text-acc">
                  +{formatNumber(mission.rewardXp)} XP
                </span>
                <div
                  role="progressbar"
                  aria-label={mission.title}
                  aria-valuemin={0}
                  aria-valuemax={mission.goal}
                  aria-valuenow={shown}
                  className="col-span-full h-[3px] overflow-hidden rounded-[2px] bg-track"
                >
                  <i
                    className="block h-full bg-acc transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] starting:w-0"
                    style={{ width: `${Math.min(100, (mission.progress / mission.goal) * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
