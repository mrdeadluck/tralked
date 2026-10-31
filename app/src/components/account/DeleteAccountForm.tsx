"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { deleteAccountAction } from "@/app/conta/actions";
import { Button } from "@/components/ui/Button";
import { DELETE_CONFIRMATION } from "@/lib/accounts/limits";

/**
 * Account deletion: a disclosure explaining what goes and what stays, then the typed word.
 * On success the action ends the session and redirects to the home page.
 */
export function DeleteAccountForm() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const matches = typed.trim() === DELETE_CONFIRMATION;

  if (!open) {
    return (
      <div>
        <Button variant="ghost" onClick={() => setOpen(true)} aria-expanded={false} className="hover:border-nin hover:text-nin">
          Excluir minha conta…
        </Button>
      </div>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches) return;
    setError(null);
    startDelete(async () => {
      const result = await deleteAccountAction({ confirmation: typed.trim() });
      // Success redirects; only failures come back here.
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-[4px] border border-nin bg-surface p-5"
    >
      <h3 id={`${id}-title`} className="text-[17px] font-extrabold font-stretch-[105%]">
        Excluir a conta para sempre
      </h3>
      <div className="grid gap-4 text-[14px] text-text-2 min-[641px]:grid-cols-2">
        <div>
          <p className="font-semibold text-text">Apagamos</p>
          <ul className="mt-1.5 list-disc pl-5 text-muted">
            <li>perfil, bio e e-mail</li>
            <li>contas conectadas e o progresso importado</li>
            <li>XP, nível, skills, atributos e missões</li>
            <li>curtidas, votos, notificações e família</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-text">Fica, sem o seu nome</p>
          <ul className="mt-1.5 list-disc pl-5 text-muted">
            <li>fotos, comentários e posts do fórum</li>
            <li>guias e dicas que você escreveu</li>
          </ul>
          <p className="mt-2 text-[13px] text-muted">Apague antes o que não quiser deixar.</p>
        </div>
      </div>
      <label htmlFor={`${id}-confirm`} className="flex flex-col gap-1.5 text-sm">
        <span>
          Digite <b className="font-mono text-text">{DELETE_CONFIRMATION}</b> para confirmar
        </span>
        <input
          id={`${id}-confirm`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          aria-invalid={error ? true : undefined}
          className="h-11 max-w-[280px] rounded-[2px] border border-line-2 bg-bg px-3 font-mono text-[16px] tracking-[0.08em] text-text focus:border-text"
        />
      </label>
      {error ? (
        <p role="alert" className="text-[13px] text-nin">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!matches || deleting}
          className="inline-flex h-11 cursor-pointer items-center justify-center rounded-[2px] border border-nin bg-nin px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {deleting ? "Excluindo…" : "Excluir conta"}
        </button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
