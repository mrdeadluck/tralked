"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type SearchSuggestion = { text: string; href: string };

type SearchBoxProps = {
  /** Itens do grupo "EM ALTA". Vazio: o painel não aparece. */
  suggestions?: SearchSuggestion[];
};

const NO_SUGGESTIONS: SearchSuggestion[] = [];

export function SearchBox({ suggestions = NO_SUGGESTIONS }: SearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(target?.tagName ?? "");
      if (typing) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const showPanel = focused && suggestions.length > 0;

  return (
    <div role="search" className="relative min-w-0 flex-[1_1_160px] max-nav:order-5 max-nav:basis-full">
      <label className="flex h-[42px] items-center gap-2.5 rounded-[2px] border border-[#23252c] bg-surface-2 px-3.5 text-dim-2 focus-within:border-acc">
        <span aria-hidden="true" className="font-mono">
          ⌕
        </span>
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur();
          }}
          autoComplete="off"
          placeholder="Buscar notícias, jogos, autores"
          aria-label="Buscar notícias, jogos, autores"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text outline-0"
        />
        <span
          aria-hidden="true"
          className="rounded-[2px] border border-line-2 px-1.5 py-0.5 font-mono text-[10px]"
        >
          /
        </span>
      </label>
      {showPanel ? (
        // mousedown não pode tirar o foco do input, senão o painel some antes do clique.
        <div
          onMouseDown={(event) => event.preventDefault()}
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-30 flex flex-col gap-3 rounded-[4px] border border-[#2a2c33] bg-surface-2 p-2.5 shadow-[0_20px_40px_rgba(0,0,0,.5)]"
        >
          <div className="flex flex-col gap-0.5">
            <div className="px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-dim-2">
              EM ALTA
            </div>
            {suggestions.map((item) => (
              <Link
                key={item.href + item.text}
                href={item.href}
                onClick={() => {
                  setValue(item.text);
                  inputRef.current?.blur();
                }}
                className="rounded-[2px] px-2 py-[9px] text-sm hover:bg-hover-2 hover:text-acc"
              >
                {item.text}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
