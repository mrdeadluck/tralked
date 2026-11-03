"use client";

import type { CSSProperties } from "react";

export type FilterOption = { id: string; label: string; color?: string };

type FilterChipsProps = {
  options: FilterOption[];
  value: string;
  onChange: (id: string) => void;
  /** Rótulo acessível do grupo, ex.: "Filtrar por plataforma". */
  ariaLabel?: string;
};

export function FilterChips({
  options,
  value,
  onChange,
  ariaLabel,
}: FilterChipsProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-x-0.5 gap-y-1 bg-bg shadow-[inset_0_0_0_1px_var(--border)]"
    >
      {options.map((option) => {
        const pressed = option.id === value;
        const style = option.color
          ? ({ "--c": option.color } as CSSProperties)
          : undefined;
        return (
          <button
            key={option.id}
            type="button"
            style={style}
            aria-pressed={pressed}
            onClick={() => onChange(option.id)}
            className={`inline-flex h-11 cursor-pointer items-center gap-1.5 px-3 text-[12.5px] font-bold font-stretch-[80%] tracking-[0.06em] uppercase transition-colors duration-150 sm:h-9 disabled:cursor-not-allowed disabled:opacity-45 ${
              option.color
                ? "before:size-1.5 before:bg-(--c) before:content-['']"
                : ""
            } ${
              pressed
                ? "bg-track text-text shadow-[inset_0_-2px_0_var(--acc)]"
                : "bg-transparent text-text-2 hover:bg-surface-2 hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
