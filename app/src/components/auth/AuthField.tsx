"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { AuthFormState } from "@/lib/auth/form-state";

const INPUT =
  "h-11 w-full rounded-[2px] border bg-bg px-3 text-[16px] font-normal text-text placeholder:text-dim focus:border-text aria-invalid:border-nin";

type AuthFieldProps = {
  /** Unique per form (from useId). */
  id: string;
  name: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete: string;
  defaultValue?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  spellCheck?: boolean;
};

/** A labelled input whose hint and error are announced with it (aria-describedby). */
export function AuthField({
  id,
  name,
  label,
  type = "text",
  autoComplete,
  defaultValue,
  error,
  hint,
  required = true,
  maxLength,
  minLength,
  spellCheck,
}: AuthFieldProps) {
  const inputId = `${id}-${name}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        minLength={minLength}
        spellCheck={spellCheck}
        autoCapitalize={type === "text" ? undefined : "none"}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${INPUT} ${error ? "border-nin" : "border-line-2"}`}
      />
      {error ? (
        <p id={errorId} className="text-[13.5px] text-nin">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Form-level outcome: errors are alerts, successes are announced politely. */
export function FormMessage({ state }: { state: AuthFormState }) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {state.message ? (
        <p
          role={state.done ? "status" : "alert"}
          tabIndex={state.done ? undefined : -1}
          className={`rounded-[3px] border bg-bg px-4 py-3 text-[14.5px] ${state.done ? "border-acc text-text" : "border-nin text-text"}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * After a submission comes back with field errors, moves focus to the first invalid field (or
 * to the form message when there is only a message).
 */
export function useFocusFirstError(formRef: RefObject<HTMLFormElement | null>, state: AuthFormState) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const form = formRef.current;
    if (!form) return;
    const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid) invalid.focus();
    else if (state.message && !state.done) form.querySelector<HTMLElement>('[role="alert"]')?.focus();
  }, [formRef, state]);
}
