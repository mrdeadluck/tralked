"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markAllReadAction } from "@/lib/notifications/actions";

/** "Marcar todas como lidas" on /notificacoes: runs the action, then refreshes the page (and the bell). */
export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await markAllReadAction();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setError(null);
            router.refresh();
          })
        }
        className="inline-flex h-10 cursor-pointer items-center rounded-[2px] border border-line-2 px-4 font-mono text-xs tracking-[0.08em] text-text-3 uppercase hover:border-text hover:text-text disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Marcando…" : "Marcar todas como lidas"}
      </button>
      {error ? (
        <p role="alert" className="text-[13px] text-nin">
          {error}
        </p>
      ) : null}
    </div>
  );
}
