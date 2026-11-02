"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { MODERATION_REASON_MAX } from "@/lib/moderation/permissions";

type ConfirmWithReasonProps = {
  /** Visible label of the trigger ("Remover"). */
  label: string;
  /** Accessible name of the trigger when the label alone is ambiguous. */
  ariaLabel?: string;
  /** Question shown before confirming ("Remover este comentário?"). */
  prompt: string;
  /** Label of the confirm button ("Sim, remover"). */
  confirmLabel: string;
  /** Runs the action; resolves to an error message, or null when it worked. */
  onConfirm: (reason: string) => Promise<string | null>;
  /** text: inline link-like control (comments); button: bordered small button (bars). */
  variant?: "text" | "button";
};

const TEXT_BASE = "cursor-pointer font-mono text-xs tracking-[0.06em] uppercase disabled:cursor-wait disabled:opacity-60";
const BUTTON_BASE =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-[2px] border px-3 font-mono text-xs font-bold tracking-[0.08em] uppercase disabled:cursor-wait disabled:opacity-60";

/**
 * A moderation step that asks first: the trigger opens an inline confirmation with an optional
 * reason (kept in the moderation history and, for photos and guides, sent to the owner).
 */
export function ConfirmWithReason({ label, ariaLabel, prompt, confirmLabel, onConfirm, variant = "text" }: ConfirmWithReasonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const formId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    start(async () => {
      const failure = await onConfirm(reason);
      if (failure) setError(failure);
      else {
        setError(null);
        setOpen(false);
      }
    });
  }

  const trigger =
    variant === "text" ? `${TEXT_BASE} text-dim hover:text-nin` : `${BUTTON_BASE} border-line-2 text-text-2 hover:border-nin hover:text-nin`;

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={trigger}
      >
        {label}
      </button>
      {open ? (
        <form
          id={formId}
          onSubmit={submit}
          className="flex w-full max-w-[420px] flex-col gap-3 rounded-[4px] border border-line-2 bg-surface-2 p-4"
        >
          <p className="text-[14px] font-bold">{prompt}</p>
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">
            Motivo (opcional)
            <textarea
              name="reason"
              rows={2}
              maxLength={MODERATION_REASON_MAX}
              className="resize-y rounded-[2px] border border-line-2 bg-bg px-3 py-2 text-[14px] text-text"
            />
          </label>
          {error ? (
            <p role="alert" className="text-[13px] text-nin">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`${BUTTON_BASE} border-nin text-nin hover:bg-nin hover:text-bg`}>
              {busy ? "Aguarde…" : confirmLabel}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={`${BUTTON_BASE} border-line-2 font-normal text-text-3 hover:border-text`}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
