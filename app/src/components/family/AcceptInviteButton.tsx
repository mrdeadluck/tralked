"use client";

import { useActionState } from "react";
import { acceptInviteAction, type FormState } from "@/app/familia/actions";
import { Button } from "@/components/ui/Button";

const INITIAL: FormState = {};

export function AcceptInviteButton({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <div>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Entrando…" : "Entrar na família"}
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-nin">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
