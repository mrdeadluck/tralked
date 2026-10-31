"use client";

import Link from "next/link";
import { useActionState, useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { signupAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { DISPLAY_NAME_MAX, EMAIL_MAX, HANDLE_MAX, HANDLE_MIN, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/limits";
import { AuthField, FormMessage, useFocusFirstError } from "./AuthField";

/** Creates the Tralked account (name, @, e-mail, password, terms). */
export function SignupForm() {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(signupAction, INITIAL_AUTH_FORM_STATE);
  useFocusFirstError(formRef, state);
  const termsError = state.errors?.terms;

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-5">
      <FormMessage state={state} />
      <AuthField
        id={id}
        name="displayName"
        label="Nome de exibição"
        autoComplete="nickname"
        maxLength={DISPLAY_NAME_MAX}
        defaultValue={state.values?.displayName}
        error={state.errors?.displayName}
        hint="Como você aparece nos comentários, no fórum e nos rankings."
      />
      <AuthField
        id={id}
        name="handle"
        label="@ do personagem"
        autoComplete="username"
        maxLength={HANDLE_MAX}
        minLength={HANDLE_MIN}
        spellCheck={false}
        defaultValue={state.values?.handle}
        error={state.errors?.handle}
        hint={`Endereço da sua ficha: /jogador/seu_arroba. De ${HANDLE_MIN} a ${HANDLE_MAX} letras sem acento, números ou _.`}
      />
      <AuthField
        id={id}
        name="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        maxLength={EMAIL_MAX}
        spellCheck={false}
        defaultValue={state.values?.email}
        error={state.errors?.email}
      />
      <AuthField
        id={id}
        name="password"
        label="Senha do Tralked"
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX}
        minLength={PASSWORD_MIN}
        error={state.errors?.password}
        hint={`Pelo menos ${PASSWORD_MIN} caracteres. Crie uma senha só para o Tralked: nunca use a da Steam, PSN, Xbox ou Google.`}
      />
      <div className="flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-start gap-3 text-[14.5px] text-text-2">
          <input
            type="checkbox"
            name="terms"
            required
            aria-invalid={termsError ? true : undefined}
            aria-describedby={termsError ? `${id}-terms-error` : undefined}
            className="mt-1 size-4 flex-none accent-(--acc)"
          />
          <span>
            Li e aceito os{" "}
            <Link href="/termos" className="text-acc underline underline-offset-2 hover:no-underline">
              Termos de uso
            </Link>{" "}
            e a{" "}
            <Link href="/privacidade" className="text-acc underline underline-offset-2 hover:no-underline">
              Política de privacidade
            </Link>
            .
          </span>
        </label>
        {termsError ? (
          <p id={`${id}-terms-error`} className="text-[13.5px] text-nin">
            {termsError}
          </p>
        ) : null}
      </div>
      <div>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar conta"}
        </Button>
      </div>
    </form>
  );
}
