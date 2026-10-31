import { SectionHead } from "@/components/ui/SectionHead";

type OverviewProps = { overview: string[]; warnings: string[] };

export function Overview({ overview, warnings }: OverviewProps) {
  return (
    <section id="g-visao" data-sec className="scroll-mt-24">
      <SectionHead title="Visão geral" />
      <div className="flex max-w-[72ch] flex-col gap-3.5 pt-[18px]">
        {overview.map((paragraph) => (
          <p key={paragraph} className="text-[17px] leading-[1.6] text-text-2">
            {paragraph}
          </p>
        ))}
        {warnings.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-[2px] border border-line-2 border-l-[3px] border-l-rarity-lendario bg-surface px-[18px] py-4">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-rarity-lendario uppercase">
              Antes de começar
            </span>
            <ul className="m-0 flex flex-col gap-1.5 pl-[18px] text-[15.5px] text-text-2">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
