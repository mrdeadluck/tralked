import type { ReactNode } from "react";

type PageHeadProps = {
  title: string;
  /** One line under the title. */
  lede?: ReactNode;
  /** Right side (counts, links). */
  aside?: ReactNode;
  /** Breadcrumb above the title. */
  trail?: ReactNode;
};

/** Page title (h1) in the SectionHead style: expanded uppercase Archivo over a 2px rule. */
export function PageHead({ title, lede, aside, trail }: PageHeadProps) {
  return (
    <header className="flex flex-col gap-3 border-b-2 border-text pb-4">
      {trail}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[clamp(30px,4vw,44px)] leading-[0.95] font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
          {title}
        </h1>
        {aside ? <div className="font-mono text-xs tracking-[0.06em] text-dim">{aside}</div> : null}
      </div>
      {lede ? <p className="max-w-[68ch] text-[16px] text-muted">{lede}</p> : null}
    </header>
  );
}

/** "Fórum / Ajuda e conquistas" breadcrumb. */
export function Trail({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Você está em" className="font-mono text-[11px] tracking-[0.08em] text-dim uppercase">
      {children}
    </nav>
  );
}
