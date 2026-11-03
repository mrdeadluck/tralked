import type { CSSProperties, ReactNode } from "react";

type ChipProps = {
  /** Qualquer cor CSS (ex.: "var(--ps)"): só o quadradinho leva a cor. Padrão: muted. */
  color?: string;
  /** Sem o quadradinho de cor à esquerda. */
  plain?: boolean;
  children: ReactNode;
};

/** Graphite tag in condensed caps; the color lives only in the small square before the text. */
export function Chip({ color, plain = false, children }: ChipProps) {
  const style = color ? ({ "--c": color } as CSSProperties) : undefined;
  return (
    <span
      style={style}
      className={`inline-flex min-h-6 items-center gap-1.5 bg-track px-2 text-xs font-bold font-stretch-[80%] tracking-[0.06em] text-text-2 uppercase ${
        plain ? "" : "before:size-1.5 before:flex-none before:bg-(--c,var(--muted)) before:content-['']"
      }`}
    >
      {children}
    </span>
  );
}
