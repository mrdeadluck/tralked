import type { ReactNode } from "react";

type CardHeadProps = {
  title: string;
  /** Texto discreto à direita (ex.: "1 escudo"). */
  aside?: ReactNode;
};

/** Cabeçalho de card da ficha do personagem (variante compacta do SectionHead). */
export function CardHead({ title, aside }: CardHeadProps) {
  return (
    <div className="mb-1 flex items-end justify-between gap-3 border-b border-[#23252c] pb-3.5">
      <h2 className="text-[19px] leading-[1.05] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
        {title}
      </h2>
      {aside ? (
        <span className="font-mono text-xs tracking-[0.08em] text-dim uppercase">
          {aside}
        </span>
      ) : null}
    </div>
  );
}
