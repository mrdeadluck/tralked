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
    <div role="group" aria-label={label} className="flex w-fit max-w-full flex-wrap items-center gap-x-0.5 gap-y-1 bg-bg shadow-[inset_0_0_0_1px_var(--border)]">
      {caption ? (
        <span aria-hidden="true" className="pr-1 pl-3 tk-lbl">
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
            className={`inline-flex h-11 items-center gap-1.5 px-3 text-[12.5px] font-bold font-stretch-[80%] tracking-[0.06em] uppercase transition-colors duration-150 sm:h-9 ${
              option.color ? "before:size-1.5 before:bg-(--c) before:content-['']" : ""
            } ${active ? "bg-track text-text shadow-[inset_0_-2px_0_var(--acc)]" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="font-semibold text-muted">{option.count.toLocaleString("pt-BR")}</span>
            ) : null}
          </Link>
        );
      })}
      {trailing}
    </div>
  );
}
