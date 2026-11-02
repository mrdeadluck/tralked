"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { BODY_MAX } from "@/lib/community/text";

type TextComposerProps = {
  /** Accessible name of the text box. */
  label: string;
  placeholder?: string;
  submitLabel: string;
  initialValue?: string;
  maxLength?: number;
  rows?: number;
  /** Resolves to an error message to show, or null on success (the box is then cleared). */
  onSubmit: (body: string) => Promise<string | null>;
  onCancel?: () => void;
};

/** Plain-text box with a character counter, used for comments and forum replies. */
export function TextComposer({
  label,
  placeholder,
  submitLabel,
  initialValue = "",
  maxLength = BODY_MAX,
  rows = 3,
  onSubmit,
  onCancel,
}: TextComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const id = useId();
  const length = value.length;
  const empty = value.trim().length === 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (empty) {
      setError("Escreva alguma coisa antes de enviar.");
      return;
    }
    startTransition(async () => {
      const message = await onSubmit(value);
      setError(message);
      if (message === null) setValue("");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={`${id}-text`} className="sr-only">
        {label}
      </label>
      <textarea
        id={`${id}-text`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
        aria-invalid={error ? true : undefined}
        className="w-full resize-y rounded-[4px] border border-line-2 bg-surface px-4 py-3 text-[15.5px] leading-relaxed text-text transition-colors focus:border-dim"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id={`${id}-count`} className="font-mono text-xs text-dim tabular-nums">
          {length.toLocaleString("pt-BR")} / {maxLength.toLocaleString("pt-BR")}
        </span>
        <div className="flex gap-2">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="h-10 cursor-pointer rounded-[2px] border border-line-2 px-4 font-mono text-xs tracking-[0.08em] text-text-3 uppercase hover:border-text"
            >
              Cancelar
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="h-10 cursor-pointer rounded-[2px] border border-acc bg-acc px-4 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08] disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Enviando…" : submitLabel}
          </button>
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-nin">
          {error}
        </p>
      ) : null}
    </form>
  );
}
