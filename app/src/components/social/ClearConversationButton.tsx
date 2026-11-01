"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearConversationAction } from "@/lib/social/actions";

/** "Apagar conversa para mim", with a confirmation step. Goes back to the inbox afterwards. */
export function ClearConversationButton({ conversationId, redirectTo }: { conversationId: string; redirectTo?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function clear() {
    startTransition(async () => {
      const result = await clearConversationAction({ conversationId });
      if (result.status !== "ok") {
        setError(result.message);
        return;
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  const quiet = "cursor-pointer font-mono text-[11px] tracking-[0.06em] uppercase disabled:cursor-wait disabled:opacity-60";
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`${quiet} text-dim hover:text-text`}>
        Apagar conversa para mim
      </button>
    );
  }
  return (
    <div role="group" aria-label="Confirmar exclusão da conversa" className="flex flex-wrap items-center gap-3 text-[14px]">
      <span className="text-text-2">Apagar as mensagens desta conversa só para você? A outra pessoa continua vendo as dela.</span>
      <button type="button" onClick={clear} disabled={busy} className={`${quiet} font-bold text-nin hover:underline`}>
        {busy ? "Apagando…" : "Sim, apagar"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={`${quiet} text-dim hover:text-text`}>
        Cancelar
      </button>
      {error ? (
        <p role="alert" className="w-full text-[13px] text-nin">
          {error}
        </p>
      ) : null}
    </div>
  );
}
