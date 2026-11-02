"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { BUTTON_TONE, HINT, INPUT, LABEL, SELECT, SMALL_BUTTON_SHAPE, TEXTAREA } from "@/components/admin/ui";
import { sanctionUserAction } from "@/lib/moderation/actions";
import { MODERATION_REASON_MAX } from "@/lib/moderation/permissions";

/** "Silenciar ou banir" form of /admin/moderacao (aba Punições). */
export function SanctionForm({ handle = "", minDate }: { handle?: string; minDate: string }) {
  const router = useRouter();
  const id = useId();
  const [busy, start] = useTransition();
  const [state, setState] = useState<{ ok: boolean; text: string; field?: string } | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    start(async () => {
      const result = await sanctionUserAction({
        handle: String(data.get("handle") ?? ""),
        kind: String(data.get("kind") ?? ""),
        until: String(data.get("until") ?? ""),
        reason: String(data.get("reason") ?? ""),
      });
      if (!result.ok) {
        setState({ ok: false, text: result.error, field: result.field });
        return;
      }
      setState({ ok: true, text: "Punição aplicada." });
      form.reset();
      router.refresh();
    });
  }

  const invalid = (field: string) => (state && !state.ok && state.field === field ? true : undefined);

  return (
    <form onSubmit={submit} className="grid max-w-[720px] gap-4 rounded-[2px] border border-line bg-surface p-5 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-handle`} className={LABEL}>
          Usuário
        </label>
        <input id={`${id}-handle`} name="handle" defaultValue={handle} placeholder="@handle" required aria-invalid={invalid("handle")} className={INPUT} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-kind`} className={LABEL}>
          Punição
        </label>
        <select id={`${id}-kind`} name="kind" defaultValue="mute" className={SELECT}>
          <option value="mute">Silenciar (não comenta nem publica)</option>
          <option value="ban">Banir (não entra nem interage)</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-until`} className={LABEL}>
          Até (inclusive)
        </label>
        <input id={`${id}-until`} name="until" type="date" min={minDate} required aria-invalid={invalid("until")} className={INPUT} />
        <p className={HINT}>Termina às 23h59 desse dia (horário de Brasília).</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-reason`} className={LABEL}>
          Motivo
        </label>
        <textarea id={`${id}-reason`} name="reason" rows={2} maxLength={MODERATION_REASON_MAX} className={TEXTAREA} />
        <p className={HINT}>O usuário vê o motivo na notificação.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={busy} className={`${SMALL_BUTTON_SHAPE} h-10 ${BUTTON_TONE.primary}`}>
          {busy ? "Aplicando…" : "Aplicar punição"}
        </button>
        {state ? (
          <p role={state.ok ? "status" : "alert"} className={`text-[13px] ${state.ok ? "text-acc" : "text-nin"}`}>
            {state.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
