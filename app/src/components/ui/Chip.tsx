import type { CSSProperties, ReactNode } from "react";

type ChipProps = {
  /** Qualquer cor CSS (ex.: "var(--ps)"). Padrão: text-3. */
  color?: string;
  /** Sem o quadradinho de cor à esquerda. */
  plain?: boolean;
  children: ReactNode;
};

export function Chip({ color, plain = false, children }: ChipProps) {
  const style = color ? ({ "--c": color } as CSSProperties) : undefined;
  return (
    <span
      style={style}
      className={`inline-flex items-center gap-[5px] border border-line-2 px-1.5 py-0.5 font-mono text-xs tracking-[0.1em] text-(--c,var(--text-3)) uppercase ${
        plain
          ? ""
          : "before:size-[5px] before:bg-(--c,var(--text-3)) before:content-['']"
      }`}
    >
      {children}
    </span>
  );
}
