"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { hrefWith, PAGE_PARAM } from "@/lib/pagination";
import { SEARCH_MAX_LENGTH } from "@/lib/search/fold";

/** Delay between the last keystroke and the search (ms). */
export const SEARCH_DEBOUNCE_MS = 350;

type ListSearchProps = {
  /** Path of the list page; the search goes to `basePath?q=…`. */
  basePath: string;
  /** Filters and page size to keep (not the page: a new search starts on page 1). */
  params: Record<string, string | undefined>;
  /** Current query (from the URL). */
  q?: string;
  /** Accessible name and visible label of the field. */
  label: string;
  placeholder?: string;
  /**
   * Element id a submission without JavaScript lands on (the list below other content). Searching
   * while typing stays in place instead.
   */
  anchor?: string;
};

/**
 * Name search of a list page (Plano 4, F11). A plain GET form, so it works without JavaScript
 * (Enter or the button); with JavaScript it also searches while typing (debounced), keeping the
 * filters and going back to page 1.
 */
export function ListSearch({ basePath, params, q = "", label, placeholder, anchor }: ListSearchProps) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState(q);
  const [lastQ, setLastQ] = useState(q);
  const [focused, setFocused] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The query changed from outside (a "clear search" link, back/forward): show it, unless the
  // person is typing (the URL then lags behind the field).
  if (q !== lastQ) {
    setLastQ(q);
    if (!focused) setValue(q);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const kept = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[0] !== "q" && entry[0] !== PAGE_PARAM && Boolean(entry[1]),
  );

  function search(text: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const query = text.trim().slice(0, SEARCH_MAX_LENGTH);
    if (query === q.trim()) return;
    const href = hrefWith(basePath, Object.fromEntries(kept), { q: query || undefined, [PAGE_PARAM]: undefined });
    startTransition(() => router.replace(href, { scroll: false }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    search(value);
  }

  return (
    <form role="search" action={anchor ? `${basePath}#${anchor}` : basePath} method="get" onSubmit={onSubmit} className="flex max-w-[560px] flex-col gap-1.5">
      <label htmlFor={inputId} className="font-mono text-xs tracking-[0.12em] text-dim-2 uppercase">
        {label}
      </label>
      <div className="flex gap-2">
        {kept.map(([key, val]) => (
          <input key={key} type="hidden" name={key} value={val} />
        ))}
        <span className="flex h-[42px] min-w-0 flex-1 items-center gap-2.5 rounded-[2px] border border-line-2 bg-surface-2 px-3.5 text-dim-2 focus-within:border-acc">
          <span aria-hidden="true" className="font-mono">
            ⌕
          </span>
          <input
            id={inputId}
            type="search"
            name="q"
            value={value}
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            placeholder={placeholder}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => search(next), SEARCH_DEBOUNCE_MS);
            }}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text outline-0"
          />
          {pending ? (
            <span className="font-mono text-xs text-dim" aria-hidden="true">
              …
            </span>
          ) : null}
        </span>
        <button
          type="submit"
          className="h-[42px] cursor-pointer rounded-[2px] border border-acc px-4 font-mono text-xs font-bold tracking-[0.1em] text-acc uppercase hover:bg-acc hover:text-bg"
        >
          Buscar
        </button>
      </div>
    </form>
  );
}
