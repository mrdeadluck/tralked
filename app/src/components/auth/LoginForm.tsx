"use client";

import Link from "next/link";
import { useActionState, useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { loginAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { PASSWORD_MAX } from "@/lib/auth/limits";
import { AuthField, FormMessage, useFocusFirstError } from "./AuthField";

/** E-mail + password of the Tralked account. */
export function LoginForm({ returnTo }: { returnTo: string }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_AUTH_FORM_STATE);
  useFocusFirstError(formRef, state);

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="returnTo" value={returnTo} />
      <FormMessage state={state} />
      <AuthField
        id={id}
        name="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        maxLength={254}
        spellCheck={false}
        defaultValue={state.values?.email}
        error={state.errors?.email}
      />
      <AuthField
        id={id}
        name="password"
        label="Senha"
        type="password"
        autoComplete="current-password"
        maxLength={PASSWORD_MAX}
        error={state.errors?.password}
        hint={
          <Link href="/esqueci-senha" className="text-acc underline underline-offset-2 hover:no-underline">
            Esqueci a senha
          </Link>
        }
      />
      <div>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </Button>
      </div>
    </form>
  );
}
