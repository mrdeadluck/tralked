import type { ReactNode } from "react";

type SectionHeadProps = {
  title: string;
  /** Conteúdo à direita (ex.: link "VER TUDO →"). */
  aside?: ReactNode;
};

/** Section title on a graphite rule with a short lime segment under its start. */
export function SectionHead({ title, aside }: SectionHeadProps) {
  return (
    <div className="relative flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-2 border-line-2 pb-2.5 after:absolute after:-bottom-[2px] after:left-0 after:h-[2px] after:w-16 after:bg-acc after:content-['']">
      <h2 className="text-[22px] leading-none font-black font-stretch-[112%] tracking-[-0.01em] uppercase">
        {title}
      </h2>
      {aside ? (
        <div className="text-[12.5px] font-extrabold font-stretch-[80%] tracking-[0.05em] text-acc uppercase [&_a:hover]:underline [&_a:hover]:underline-offset-4">
          {aside}
        </div>
      ) : null}
    </div>
  );
}
