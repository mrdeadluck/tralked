import { fmtK } from "@/components/guide/format";
import type { GuideFacts } from "@/lib/queries/games";

type Fact = { label: string; value: string; note: string; bars?: number };

export function FactsStrip({ facts, totalXp }: { facts: GuideFacts; totalXp: number }) {
  const items: Fact[] = [
    {
      label: "Dificuldade",
      value: `${facts.difficulty} / 10`,
      note: "",
      bars: facts.difficulty,
    },
    {
      label: "Tempo para 100%",
      value: `${facts.hoursMin} a ${facts.hoursMax} h`,
      note: "média da comunidade",
    },
    {
      label: "Jogadas mínimas",
      value: facts.playthroughs,
      note: "jogadas completas até o 100%",
    },
    {
      label: "Perdíveis",
      value: facts.missables === 0 ? "Nenhuma" : String(facts.missables),
      note: facts.missables === 0 ? "nada se perde de vez" : "veja os avisos antes de começar",
    },
    {
      label: "Online",
      value: facts.online === 0 ? "Nenhuma" : String(facts.online),
      note: facts.online === 0 ? "tudo offline" : "exigem partida online",
    },
    { label: "XP do guia", value: fmtK(totalXp), note: "nas conquistas listadas" },
  ];

  return (
    <dl className="mt-6 grid grid-cols-6 gap-px overflow-hidden rounded-[2px] border border-line bg-line max-[1100px]:grid-cols-3 max-[640px]:grid-cols-2">
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
