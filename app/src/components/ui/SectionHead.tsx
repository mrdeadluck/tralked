import type { ReactNode } from "react";

type SectionHeadProps = {
  title: string;
  /** Conteúdo à direita (ex.: link "VER TUDO →"). */
  aside?: ReactNode;
};

export function SectionHead({ title, aside }: SectionHeadProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-text pb-4">
      <h2 className="text-[28px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
        {title}
      </h2>
      {aside ? (
        <div className="font-mono text-xs tracking-[0.08em] text-acc uppercase">
          {aside}
        </div>
      ) : null}
    </div>
  );
}
