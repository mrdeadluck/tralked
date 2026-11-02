import { formatCompact } from "@/lib/xp-format";
import type { GuideFacts } from "@/lib/queries/games";
import { timeTo100Label } from "@/lib/queries/time-to-100";

type Fact = { label: string; value: string; note: string; bars?: number };

export function FactsStrip({ facts, totalXp }: { facts: GuideFacts; totalXp: number }) {
  // The same time to 100% as the game page, with its source; left out when there is none.
  const time = facts.timeTo100 ? timeTo100Label(facts.timeTo100) : null;
  const items: Fact[] = [
    {
      label: "Dificuldade",
      value: `${facts.difficulty} / 10`,
      note: "",
      bars: facts.difficulty,
    },
    ...(time ? [{ label: "Tempo para 100%", value: time.value, note: time.source }] : []),
    {
      label: "Jogadas mínimas",
      value: facts.playthroughs,
      note: "jogadas completas até o 100%",
    },
    {
      label: "Conquistas perdíveis",
      value: facts.missables === 0 ? "Nenhuma" : String(facts.missables),
      note: facts.missables === 0 ? "nenhuma fica para trás" : "ficam para trás: veja os avisos",
    },
    {
      label: "Online",
      value: facts.online === 0 ? "Nenhuma" : String(facts.online),
      note: facts.online === 0 ? "tudo offline" : "exigem partida online",
    },
    { label: "XP do guia", value: formatCompact(totalXp), note: "nas conquistas listadas" },
  ];

  return (
    <dl className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-px overflow-hidden rounded-[2px] border border-line bg-line max-[640px]:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="bg-surface px-4 py-3.5">
          <dt className="font-mono text-xs tracking-[0.12em] text-dim-2 uppercase">{item.label}</dt>
          <dd className="m-0 mt-1.5 text-[21px] leading-[1.1] font-extrabold font-stretch-[112%]">
            {item.value}
            {item.bars !== undefined ? (
              <div className="mt-2 flex gap-[3px]" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <i
                    key={i}
                    className={`block h-1 w-full ${i < (item.bars ?? 0) ? "bg-acc" : "bg-track"}`}
                  />
                ))}
              </div>
            ) : (
              <small className="mt-1 block font-mono text-xs font-normal font-stretch-100% text-dim">
                {item.note}
              </small>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
