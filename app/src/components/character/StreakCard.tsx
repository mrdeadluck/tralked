import { Card } from "@/components/ui/Card";
import type { Character } from "@/lib/queries/players";
import { CardHead } from "./CardHead";

type StreakCardProps = { streak: Character["streak"] };

export function StreakCard({ streak }: StreakCardProps) {
  const shields =
    streak.shields === 0
      ? "Sem escudo"
      : `${streak.shields} ${streak.shields === 1 ? "escudo" : "escudos"}`;
  return (
    <Card>
      <CardHead title="Sequência" aside={shields} />
      <div className="flex items-center gap-4 pt-3.5">
        <b className="text-[40px] leading-none font-black font-stretch-[125%] text-acc tabular-nums">
          {streak.current}
        </b>
        <p className="text-sm text-muted">
          {streak.current === 1 ? "dia seguido" : "dias seguidos"} com conquista. O escudo salva
          1 dia perdido sem quebrar a corrente.
        </p>
      </div>
      <ol
        aria-label="Últimos 7 dias"
        className="m-0 mt-4 grid list-none grid-cols-7 gap-1 p-0"
      >
        {streak.week.map((day) => (
          <li
            key={day.day}
            aria-label={`${day.day.split("-").reverse().slice(0, 2).join("/")}: ${
              day.active ? "com conquista" : "sem conquista"
            }${day.today ? " (hoje)" : ""}`}
            className={`grid h-[30px] place-items-center rounded-[2px] border font-mono text-[10px] ${
              day.today && day.active
                ? "border-acc bg-acc font-bold text-bg"
                : day.today
                  ? "border-acc font-bold text-acc"
                  : day.active
                    ? "border-acc/40 bg-acc/12 text-acc"
                    : "border-line-2 text-dim-2"
            }`}
          >
            <span aria-hidden="true">{day.letter}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
