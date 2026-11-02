"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { UploadGameSearch } from "@/app/galeria/jogos/route";
import type { UploadGameOption } from "@/lib/community/gallery";

/** Wait this long after the last keystroke before searching. */
const DEBOUNCE_MS = 180;
const MIN_QUERY = 2;

type Status = "idle" | "loading" | "done" | "error";

/**
 * The upload form's game field: type part of the name, pick from up to 20 catalog matches
 * (GET /galeria/jogos). An ARIA combobox: arrows move, Enter picks, Escape closes. The chosen
 * game's slug travels in the hidden `name` input.
 */
export function UploadGamePicker({
  name,
  defaultGame,
  invalid,
  errorId,
}: {
  name: string;
  defaultGame?: UploadGameOption | null;
  invalid?: boolean;
  errorId?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState(defaultGame?.name ?? "");
  const [chosen, setChosen] = useState<UploadGameOption | null>(defaultGame ?? null);
  const [results, setResults] = useState<UploadGameOption[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Search as the player types (debounced; a newer query cancels the one in flight).
  useEffect(() => {
    const q = query.trim();
    if (chosen || q.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const response = await fetch(`/galeria/jogos?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as UploadGameSearch;
        setResults(body.games);
        setActive(body.games.length > 0 ? 0 : -1);
        setStatus("done");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, chosen]);

  const typing = !chosen && query.trim().length >= MIN_QUERY;
  const expanded = open && typing && status === "done" && results.length > 0;

  function pick(game: UploadGameOption) {
    setChosen(game);
    setQuery(game.name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!expanded) {
        setOpen(true);
        return;
      }
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (event.key === "Enter" && expanded && active >= 0) {
      event.preventDefault();
      pick(results[active]);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const hint =
    chosen !== null
      ? null
      : query.trim().length < MIN_QUERY
        ? "Digite pelo menos 2 letras do nome."
        : status === "loading"
          ? "Buscando…"
          : status === "error"
            ? "A busca falhou. Confira sua conexão e digite de novo."
            : status === "done" && results.length === 0
              ? "Nenhum jogo com esse nome no catálogo."
              : null;

  return (
    <div className="relative flex flex-col gap-1.5 text-[13px] text-muted">
      <label htmlFor={`${id}-q`}>Jogo</label>
      <input type="hidden" name={name} value={chosen?.slug ?? ""} />
      <input
        id={`${id}-q`}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={[`${id}-hint`, invalid ? errorId : undefined].filter(Boolean).join(" ")}
        autoComplete="off"
        spellCheck={false}
        placeholder="Busque pelo nome do jogo"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setChosen(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-11 rounded-[2px] border border-line-2 bg-bg px-3 text-[14px] text-text placeholder:text-dim aria-[invalid=true]:border-nin"
      />
      <p id={`${id}-hint`} role="status" className="min-h-[18px] font-mono text-xs text-dim">
        {chosen ? <span className="text-acc">Jogo escolhido: {chosen.name}</span> : hint}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label="Jogos encontrados"
        hidden={!expanded}
        className="absolute top-[72px] right-0 left-0 z-10 m-0 max-h-[264px] list-none overflow-y-auto rounded-[2px] border border-line-2 bg-surface-2 p-0 shadow-[0_12px_28px_-8px_rgba(0,0,0,.8)]"
      >
        {results.map((game, i) => (
          <li
            key={game.slug}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            // mousedown: pick before the input's blur closes the list.
            onMouseDown={(event) => {
              event.preventDefault();
              pick(game);
            }}
            onMouseMove={() => setActive(i)}
            className={`flex min-h-11 cursor-pointer items-center px-3 text-[14px] ${i === active ? "bg-hover text-text" : "text-text-2"}`}
          >
            {game.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
