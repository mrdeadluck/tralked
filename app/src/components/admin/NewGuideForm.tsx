"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { createGuideAction } from "@/app/admin/guias/actions";
import { Button } from "@/components/ui/Button";
import { HINT, LABEL, SELECT } from "./ui";

/** Picks a game without a guide and starts its draft guide (the action opens the editor). */
export function NewGuideForm({ games }: { games: { id: string; name: string }[] }) {
  const id = useId();
  const [gameId, setGameId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gameId) {
      setError("Escolha um jogo.");
      return;
    }
    setError(null);
    start(async () => {
      const result = await createGuideAction({ gameId });
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-[520px] flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-game`} className={LABEL}>
          Jogo
        </label>
        <select
          id={`${id}-game`}
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          aria-describedby={`${id}-hint`}
          aria-invalid={error ? true : undefined}
          className={SELECT}
        >
          <option value="">Escolha um jogo sem guia…</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <span id={`${id}-hint`} className={HINT}>
          O guia começa como rascunho, sem etapas. Ninguém fora da redação o vê até ser publicado.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar guia"}
        </Button>
        {error ? (
          <p role="alert" className="text-[14px] text-nin">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
