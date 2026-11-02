"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { loginHref } from "@/components/guide/format";
import { reportContent } from "@/lib/community/actions";
import { REPORT_DETAILS_MAX, REPORT_REASONS, type ReportTargetType } from "@/lib/community/reports";
import { FlagIcon } from "./icons";

type ReportButtonProps = {
  targetType: ReportTargetType;
  targetId: string;
  loggedIn: boolean;
  returnTo: string;
  /** What is being reported, for screen readers: "comentário de @kairobr". */
  what: string;
  /** Disabled while the anonymous fallback is shown (before the session is known). */
  pending?: boolean;
};

type State = { kind: "closed" } | { kind: "open"; error?: string } | { kind: "done"; message: string };

/** "Denunciar": an inline form (reason + optional details) that files a Report for the moderators. */
export function ReportButton({ targetType, targetId, loggedIn, returnTo, what, pending = false }: ReportButtonProps) {
  const [state, setState] = useState<State>({ kind: "closed" });
  const [busy, startTransition] = useTransition();
  const formId = useId();

  if (state.kind === "done") {
    return (
      <p role="status" className="font-mono text-xs text-dim">
        {state.message}
      </p>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await reportContent({
        targetType,
        targetId,
        reason: data.get("reason"),
        details: String(data.get("details") ?? ""),
      });
      if (result.status === "ok") setState({ kind: "done", message: "Denúncia enviada. A moderação vai avaliar." });
      else if (result.status === "already_reported") setState({ kind: "done", message: "Você já denunciou isto. A moderação vai avaliar." });
      else if ("message" in result) setState({ kind: "open", error: result.message });
    });
  }

  const open = state.kind === "open";
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending}
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        aria-label={`Denunciar ${what}`}
        onClick={() => setState(open ? { kind: "closed" } : { kind: "open" })}
        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[2px] font-mono text-xs tracking-[0.06em] text-dim uppercase hover:text-text disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-6"
      >
        <FlagIcon width={13} height={13} /> Denunciar
      </button>
      {open && !loggedIn ? (
        <p id={formId} className="font-mono text-xs">
          <a href={loginHref(returnTo)} className="text-acc underline underline-offset-2">
            Entre na sua conta para denunciar
          </a>
        </p>
      ) : null}
      {open && loggedIn ? (
        <form
          id={formId}
          onSubmit={onSubmit}
          className="flex w-full max-w-[420px] flex-col gap-3 rounded-[4px] border border-line-2 bg-surface-2 p-4"
        >
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-2 text-[14px] font-bold">Por que você está denunciando?</legend>
            {REPORT_REASONS.map((reason, i) => (
              <label key={reason} className="flex cursor-pointer items-center gap-2 text-[14px] text-text-2">
                <input type="radio" name="reason" value={reason} defaultChecked={i === 0} className="accent-acc" />
                {reason}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">
            Detalhes (opcional)
            <textarea
              name="details"
              rows={2}
              maxLength={REPORT_DETAILS_MAX}
              className="resize-y rounded-[2px] border border-line-2 bg-bg px-3 py-2 text-[14px] text-text"
            />
          </label>
          {state.error ? (
            <p role="alert" className="text-[13px] text-nin">
              {state.error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="h-9 cursor-pointer rounded-[2px] border border-text bg-text px-3 font-mono text-xs font-bold tracking-[0.08em] text-bg uppercase disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Enviando…" : "Enviar denúncia"}
            </button>
            <button
              type="button"
              onClick={() => setState({ kind: "closed" })}
              className="h-9 cursor-pointer rounded-[2px] border border-line-2 px-3 font-mono text-xs tracking-[0.08em] text-text-3 uppercase hover:border-text"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
