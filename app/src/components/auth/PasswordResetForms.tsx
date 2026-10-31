"use client";

import { useActionState, useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { forgotPasswordAction, resetPasswordAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { EMAIL_MAX, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/limits";
import { AuthField, FormMessage, useFocusFirstError } from "./AuthField";

/** "Esqueci a senha": always the same answer, whether or not the e-mail has an account. */
export function ForgotPasswordForm() {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(forgotPasswordAction, INITIAL_AUTH_FORM_STATE);
  useFocusFirstError(formRef, state);

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-5">
      <FormMessage state={state} />
      <AuthField
        id={id}
        name="email"
        label="E-mail da conta"
        type="email"
        autoComplete="email"
        maxLength={EMAIL_MAX}
        spellCheck={false}
        defaultValue={state.values?.email}
        error={state.errors?.email}
      />
      <div>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Enviando…" : "Enviar link"}
        </Button>
      </div>
    </form>
  );
}

/** New password from a reset (or invite) link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL_AUTH_FORM_STATE);
  useFocusFirstError(formRef, state);

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      <AuthField
        id={id}
        name="password"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX}
        minLength={PASSWORD_MIN}
        error={state.errors?.password}
        hint={`Pelo menos ${PASSWORD_MIN} caracteres.`}
      />
      <AuthField
        id={id}
        name="confirm"
        label="Repita a nova senha"
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX}
        error={state.errors?.confirm}
      />
      <div>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar senha e entrar"}
        </Button>
      </div>
    </form>
  );
}
