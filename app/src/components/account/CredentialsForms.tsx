"use client";

import { useActionState, useId, useRef } from "react";
import { changeEmailAction, changePasswordAction } from "@/app/conta/actions";
import { AuthField, FormMessage, useFocusFirstError } from "@/components/auth/AuthField";
import { Button } from "@/components/ui/Button";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { EMAIL_MAX, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/limits";

type CredentialsProps = { email: string | null; hasPassword: boolean };

/** Login e-mail and password of the account (/conta). */
export function CredentialsForms({ email, hasPassword }: CredentialsProps) {
  return (
    <div className="flex flex-col gap-8">
      {!hasPassword ? (
        <p className="max-w-[60ch] text-[14.5px] text-text-2">
          Esta conta ainda não tem senha do Tralked. Defina um e-mail e uma senha para entrar com eles.
        </p>
      ) : null}
      <EmailForm email={email} hasPassword={hasPassword} />
      <PasswordForm hasPassword={hasPassword} />
    </div>
  );
}

function EmailForm({ email, hasPassword }: CredentialsProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(changeEmailAction, INITIAL_AUTH_FORM_STATE);
  useFocusFirstError(formRef, state);
  return (
    <form ref={formRef} action={formAction} noValidate aria-label="E-mail de login" className="flex max-w-[420px] flex-col gap-4">
      <AuthField
        id={id}
        name="email"
        label="E-mail de login"
        type="email"
        autoComplete="email"
        maxLength={EMAIL_MAX}
        spellCheck={false}
        defaultValue={state.values?.email ?? email ?? ""}
        error={state.errors?.email}
      />
      {hasPassword ? (
        <AuthField
          id={id}
          name="current"
          label="Senha atual"
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX}
          error={state.errors?.current}
          hint="Para trocar o e-mail, confirme a senha."
        />
      ) : null}
      <FormMessage state={state} />
      <div>
        <Button variant="ghost" type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar e-mail"}
        </Button>
      </div>
    </form>
  );
}

function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL_AUTH_FORM_STATE);
  useFocusFirstError(formRef, state);
  return (
    <form ref={formRef} action={formAction} noValidate aria-label="Senha" className="flex max-w-[420px] flex-col gap-4">
      {hasPassword ? (
        <AuthField
          id={id}
          name="current"
          label="Senha atual"
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX}
          error={state.errors?.current}
        />
      ) : null}
      <AuthField
        id={id}
        name="password"
        label={hasPassword ? "Nova senha" : "Senha do Tralked"}
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX}
        minLength={PASSWORD_MIN}
        error={state.errors?.password}
        hint={`Pelo menos ${PASSWORD_MIN} caracteres. Nunca use a senha da Steam, PSN, Xbox ou Google.`}
      />
      <AuthField
        id={id}
        name="confirm"
        label="Repita a senha"
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX}
        error={state.errors?.confirm}
      />
      <FormMessage state={state} />
      <div>
        <Button variant="ghost" type="submit" disabled={pending}>
          {pending ? "Salvando…" : hasPassword ? "Trocar senha" : "Criar senha"}
        </Button>
      </div>
    </form>
  );
}
