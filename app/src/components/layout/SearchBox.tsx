"use client";

import Link from "next/link";
import { SearchIcon } from "./icons";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

export type SearchSuggestion = { text: string; href: string };

type SearchBoxProps = {
  /** Itens do grupo "EM ALTA". Vazio: o painel não aparece. */
  suggestions?: SearchSuggestion[];
  /** Id of the field (the header focuses it when the phone search opens). */
  inputId?: string;
  /** Esc with nothing left to close: the header folds the phone search away. */
  onDismiss?: () => void;
};

const NO_SUGGESTIONS: SearchSuggestion[] = [];

export function SearchBox({ suggestions = NO_SUGGESTIONS, inputId, onDismiss }: SearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  // Evita reabrir o painel quando o Escape devolve o foco ao input.
  const skipNextOpen = useRef(false);
  const listboxId = useId();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
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

  // Typing hides "EM ALTA": Enter searches the catalog (/jogos?q=…).
  const expanded = open && suggestions.length > 0 && value.trim() === "";

  function handleFocus() {
    if (skipNextOpen.current) {
      skipNextOpen.current = false;
      return;
    }
    setOpen(true);
  }

  // O painel fica aberto enquanto o foco estiver dentro do container.
  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  function focusOption(index: number) {
    optionRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    const optionIndex = optionRefs.current.indexOf(
      target as HTMLAnchorElement,
    );

    if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
        if (target !== inputRef.current) {
          skipNextOpen.current = true;
          inputRef.current?.focus();
        }
      } else {
        inputRef.current?.blur();
        onDismiss?.();
      }
      return;
    }

    if (!expanded) {
      if (event.key === "ArrowDown" && target === inputRef.current) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (target === inputRef.current) focusOption(0);
      else if (optionIndex >= 0) {
        focusOption(Math.min(optionIndex + 1, suggestions.length - 1));
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (optionIndex === 0) inputRef.current?.focus();
      else if (optionIndex > 0) focusOption(optionIndex - 1);
    }
  }

  return (
    <form
      role="search"
      action="/jogos"
      method="get"
      onSubmit={(event) => {
        if (!value.trim()) event.preventDefault();
      }}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="relative min-w-0"
    >
      <label className="flex h-11 items-center gap-2.5 rounded-[2px] border border-[#23252c] bg-surface-2 px-3.5 text-dim-2 transition-colors duration-150 focus-within:border-acc nav:h-[42px]">
        <SearchIcon width={16} height={16} />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          name="q"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={expanded ? listboxId : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          autoComplete="off"
          placeholder="Buscar jogos"
          aria-label="Buscar jogos"
          className="min-w-0 flex-1 border-0 bg-transparent text-base text-text outline-0 nav:text-sm"
        />
        <span
          aria-hidden="true"
          className="rounded-[2px] border border-line-2 px-1.5 py-0.5 font-mono text-xs max-nav:hidden"
        >
          /
        </span>
      </label>
      {expanded ? (
        // Safari não foca links ao clicar: sem isso o blur do input fecharia o painel antes do clique.
        <div
          onMouseDown={(event) => event.preventDefault()}
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-30 flex flex-col gap-3 rounded-[4px] border border-[#2a2c33] bg-surface-2 p-2.5 shadow-[0_20px_40px_rgba(0,0,0,.5)]">
          <div className="flex flex-col gap-0.5">
            <div
              id={`${listboxId}-label`}
              className="px-2 py-1 font-mono text-xs tracking-[0.14em] text-dim-2"
            >
              EM ALTA
            </div>
            <div
              id={listboxId}
              role="listbox"
              aria-labelledby={`${listboxId}-label`}
              className="flex flex-col gap-0.5"
            >
              {suggestions.map((item, index) => (
                <Link
                  key={item.href + item.text}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  href={item.href}
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setValue(item.text);
                    setOpen(false);
                  }}
                  className="flex min-h-11 items-center rounded-[2px] px-2 text-sm nav:min-h-0 nav:py-[9px] hover:bg-hover-2 hover:text-acc focus-visible:bg-hover-2 focus-visible:text-acc"
                >
                  {item.text}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
