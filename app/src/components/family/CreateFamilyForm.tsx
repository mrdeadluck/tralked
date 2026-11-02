"use client";

import { useActionState } from "react";
import { createFamilyAction, type FormState } from "@/app/familia/actions";
import { Button } from "@/components/ui/Button";

const INITIAL: FormState = {};

export function CreateFamilyForm({ defaultName }: { defaultName: string }) {
  const [state, formAction, pending] = useActionState(createFamilyAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label
        htmlFor="family-name"
        className="font-mono text-xs tracking-[0.14em] text-dim uppercase"
      >
        Nome da família
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="family-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          minLength={3}
          maxLength={40}
          required
          autoComplete="off"
          aria-describedby={state.error ? "family-name-error" : "family-name-hint"}
          className="h-11 min-w-[240px] flex-1 rounded-[2px] border border-line-2 bg-surface-2 px-3 text-text"
        />
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar família"}
        </Button>
      </div>
      <p id="family-name-hint" className="font-mono text-xs text-dim">
        De 3 a 40 caracteres. Você pode convidar até 5 pessoas.
      </p>
      {state.error ? (
        <p id="family-name-error" role="alert" className="text-sm text-nin">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
