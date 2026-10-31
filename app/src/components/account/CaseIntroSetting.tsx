"use client";

import { useId, useState, useTransition } from "react";
import { setCaseIntroAction } from "@/app/conta/actions";
import { writeIntroOff } from "@/components/game/case-intro-pref";

/**
 * Turns the sealed-case intro of game pages back on (or off): saved on the account, so every
 * device follows it, and on this browser at once.
 */
export function CaseIntroSetting({ off: initialOff }: { off: boolean }) {
  const id = useId();
  const [off, setOff] = useState(initialOff);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSave] = useTransition();

  const change = (show: boolean) => {
    const next = !show;
    setOff(next);
    setStatus(null);
    startSave(async () => {
      const result = await setCaseIntroAction({ off: next });
      if (!result.ok) {
        setOff(!next);
        setStatus({ ok: false, message: result.error });
        return;
      }
      writeIntroOff(next);
      setStatus({
        ok: true,
        message: next ? "Animação desligada nos próximos jogos." : "Animação ligada: ela abre na primeira visita a cada jogo.",
      });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={`${id}-intro`}
        className="flex cursor-pointer items-start gap-3 rounded-[2px] border border-line-2 px-4 py-3 hover:border-text-3 has-focus-visible:outline-2 has-focus-visible:outline-acc"
      >
        <input
          id={`${id}-intro`}
          type="checkbox"
          checked={!off}
          disabled={saving}
          onChange={(event) => change(event.target.checked)}
          aria-describedby={`${id}-intro-hint`}
          className="mt-1 size-4 flex-none accent-(--acc)"
        />
        <span className="flex flex-col gap-0.5">
          <b className="text-[15px] font-semibold">Mostrar a animação da capinha</b>
          <span id={`${id}-intro-hint`} className="text-[13.5px] text-muted">
            Na primeira vez que você abre um jogo, a capinha lacrada se abre e o disco voa para a página. O botão
            &ldquo;Abrir a capinha de novo&rdquo; continua na página de cada jogo.
          </span>
        </span>
      </label>
      <p aria-live="polite" className="text-sm">
        {status ? (
          <span role={status.ok ? undefined : "alert"} className={status.ok ? "text-acc" : "text-nin"}>
            {status.message}
          </span>
        ) : null}
      </p>
    </div>
  );
}
