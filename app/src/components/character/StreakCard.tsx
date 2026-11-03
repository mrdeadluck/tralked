import type { Character } from "@/lib/queries/players";
import { Panel } from "./Panel";

type StreakCardProps = { streak: Character["streak"] };

export function StreakCard({ streak }: StreakCardProps) {
  const shields =
    streak.shields === 0
      ? "Sem escudo"
      : `${streak.shields} ${streak.shields === 1 ? "escudo" : "escudos"}`;
  return (
    <Panel title="Sequência" aside={shields}>
      <div className="flex items-baseline gap-2.5">
        <b className="text-[34px] leading-none font-black font-stretch-[112%] text-acc tabular-nums">
          {streak.current}
        </b>
        <p className="text-[13.5px] text-text-2">
          {streak.current === 1 ? "dia seguido" : "dias seguidos"} com conquista. O escudo salva
          1 dia perdido sem quebrar a corrente.
          {streak.best > streak.current ? ` Melhor sequência: ${streak.best}.` : ""}
        </p>
      </div>
      <ol aria-label="Últimos 7 dias" className="m-0 mt-2.5 grid list-none grid-cols-7 gap-[3px] p-0">
        {streak.week.map((day) => (
          <li
            key={day.day}
            aria-label={`${day.day.split("-").reverse().slice(0, 2).join("/")}: ${
              day.active ? "com conquista" : "sem conquista"
            }${day.today ? " (hoje)" : ""}`}
            className={`grid h-[34px] place-items-center text-[12.5px] font-bold font-stretch-[80%] ${
              day.active
                ? "bg-acc text-acc-ink"
                : day.today
                  ? "bg-surface-2 text-text shadow-[inset_0_-2px_0_var(--acc)]"
                  : "bg-surface-2 text-muted"
            }`}
          >
            <span aria-hidden="true">{day.letter}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
