import { SectionHead } from "@/components/ui/SectionHead";
import type { Collectible } from "@/lib/queries/games";

export function Collectibles({ collectibles }: { collectibles: Collectible[] }) {
  if (collectibles.length === 0) return null;
  return (
    <section id="g-colet" data-sec className="scroll-mt-24">
      <SectionHead
        title="Coletáveis"
        aside={<span className="tracking-normal text-dim normal-case">Totais para o 100%</span>}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 pt-[18px]">
        {collectibles.map((item) => (
          <div
            key={item.name}
            className="flex flex-col gap-2.5 rounded-[4px] border border-line bg-surface p-[18px]"
          >
            <span className="font-mono text-xs tracking-[0.14em] text-dim-2 uppercase">
              {item.name}
            </span>
            <span className="text-[30px] leading-none font-black font-stretch-[125%] tracking-[-0.03em]">
              {item.total}
            </span>
            {item.description ? <p className="text-sm text-muted">{item.description}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
