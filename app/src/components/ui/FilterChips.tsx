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
      className="flex flex-wrap gap-1.5"
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
            className={`inline-flex h-[34px] cursor-pointer items-center gap-[7px] rounded-[2px] border px-3 font-mono text-[11px] tracking-[0.08em] uppercase disabled:cursor-not-allowed disabled:opacity-45 ${
              option.color
                ? "before:size-1.5 before:bg-(--c) before:content-['']"
                : ""
            } ${
              pressed
                ? "border-text bg-text text-bg"
                : "border-line-2 bg-transparent text-text-3 hover:border-dim hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
