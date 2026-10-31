"use client";

import { useId, useMemo, useState } from "react";
import type { GameOption } from "@/lib/admin/articles";
import { CloseIcon } from "./icons";
import { HINT, INPUT, LABEL } from "./ui";

const MAX_RESULTS = 8;

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Related games: search the catalog by name and toggle games on and off (up to `max`). */
export function GamePicker({
  games,
  value,
  onChange,
  max = 10,
  invalid,
}: {
  games: GameOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  invalid?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return [];
    return games.filter((g) => !value.includes(g.id) && (normalize(g.name).includes(q) || g.slug.includes(q))).slice(0, MAX_RESULTS);
  }, [games, query, value]);
  const full = value.length >= max;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-q`} className={LABEL}>
        Jogos relacionados
      </label>
      {value.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Jogos escolhidos">
          {value.map((gameId) => (
            <li key={gameId}>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== gameId))}
                aria-label={`Tirar ${byId.get(gameId)?.name ?? gameId}`}
                className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[2px] border border-acc/60 bg-hover px-2.5 text-[13px] hover:border-nin"
              >
                {byId.get(gameId)?.name ?? gameId}
                <CloseIcon width={12} height={12} className="text-dim" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={HINT}>Nenhum jogo escolhido.</p>
      )}
      <input
        id={`${id}-q`}
        type="search"
        value={query}
        disabled={full}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={full ? `Máximo de ${max} jogos` : "Buscar no catálogo…"}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        className={INPUT}
      />
      <span id={`${id}-hint`} className="sr-only">
        Digite parte do nome e escolha na lista abaixo.
      </span>
      {results.length > 0 ? (
        <ul className="m-0 flex list-none flex-col border border-line-2 p-0" aria-label="Resultados">
          {results.map((g) => (
            <li key={g.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  onChange([...value, g.id]);
                  setQuery("");
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-[14px] hover:bg-hover"
              >
                {g.name}
                <span className="font-mono text-[11px] text-dim">{g.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <p className={HINT} role="status">
          Nenhum jogo encontrado.
        </p>
      ) : null}
    </div>
  );
}
