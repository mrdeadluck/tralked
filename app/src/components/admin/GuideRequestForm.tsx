"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { createGuideRequestAction, searchCatalogAction } from "@/app/admin/guias/pedidos/actions";
import { Button } from "@/components/ui/Button";
import { HINT, INPUT, LABEL } from "./ui";

type Match = { steamAppId: number; name: string };

/** Asks for a guide: search the catalog by name, or paste the Steam appid (or the store link). */
export function GuideRequestForm() {
  const id = useId();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [update, setUpdate] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [searching, startSearch] = useTransition();

  function onChange(next: string) {
    setValue(next);
    setMessage(null);
    const q = next.trim();
    // An appid or a link is not searched by name.
    if (q.length < 2 || /^\d+$/.test(q) || q.includes("/")) {
      setMatches([]);
      return;
    }
    startSearch(async () => {
      const result = await searchCatalogAction({ q });
      setMatches(result.ok ? result.games : []);
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim()) {
      setMessage({ ok: false, text: "Informe o appid da Steam, o link da loja ou escolha um jogo." });
      return;
    }
    setMessage(null);
    start(async () => {
      const result = await createGuideRequestAction({ steam: value, update });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setValue("");
      setMatches([]);
      setMessage({ ok: true, text: "Pedido na fila." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-[560px] flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-q`} className={LABEL}>
          Jogo
        </label>
        <input
          id={`${id}-q`}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nome no catálogo, appid da Steam ou link da loja"
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          className={INPUT}
        />
        <span id={`${id}-hint`} className={HINT}>
          Um jogo novo é importado da Steam. Só entram jogos com conquistas.
        </span>
        {matches.length > 0 ? (
          <ul className="m-0 flex list-none flex-col border border-line-2 p-0" aria-label="Resultados">
            {matches.map((g) => (
              <li key={g.steamAppId} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    setValue(String(g.steamAppId));
                    setMatches([]);
                  }}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-[14px] hover:bg-hover"
                >
                  {g.name}
                  <span className="font-mono text-xs text-dim">{g.steamAppId}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : searching ? (
          <p className={HINT} role="status">
            Buscando…
          </p>
        ) : null}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[14px]">
        <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
        Atualizar guia existente
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Pedindo…" : "Pedir guia"}
        </Button>
        {message ? (
          <p role={message.ok ? "status" : "alert"} className={`text-[14px] ${message.ok ? "text-acc" : "text-nin"}`}>
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
