import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export type LinkChip = {
  id: string;
  label: string;
  href: string;
  /** Color dot (any CSS color, e.g. "var(--ps)"). */
  color?: string;
  /** Shown after the label ("Jogados · 412"). */
  count?: number;
};

type LinkChipsProps = {
  /** Accessible name of the group, e.g. "Filtrar por plataforma". */
  label: string;
  /** Visible caption before the chips ("Ordenar"). */
  caption?: string;
  options: LinkChip[];
  current: string;
  /** Rendered after the chips, inside the group (e.g. a "Mais" toggle). */
  trailing?: ReactNode;
};

/**
 * Filter/sort chips as plain links (same look as FilterChips): the choice lives in the URL, so
 * lists can be linked and filtered without JavaScript.
 */
export function LinkChips({ label, caption, options, current, trailing }: LinkChipsProps) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {caption ? (
        <span aria-hidden="true" className="mr-1 font-mono text-xs tracking-[0.12em] text-dim-2 uppercase">
          {caption}
        </span>
      ) : null}
      {options.map((option) => {
        const active = option.id === current;
        const style = option.color ? ({ "--c": option.color } as CSSProperties) : undefined;
        return (
          <Link
            key={option.id}
            href={option.href}
            style={style}
            aria-current={active ? "true" : undefined}
            scroll={false}
            className={`inline-flex h-11 items-center gap-[7px] rounded-[2px] border px-3 font-mono transition-colors duration-150 sm:h-[34px] text-xs tracking-[0.08em] uppercase ${
              option.color ? "before:size-1.5 before:bg-(--c) before:content-['']" : ""
            } ${active ? "border-text bg-text text-bg" : "border-line-2 text-text-3 hover:border-dim hover:text-text"}`}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={active ? "text-bg" : "text-dim"}>· {option.count.toLocaleString("pt-BR")}</span>
            ) : null}
          </Link>
        );
      })}
      {trailing}
    </div>
  );
}
