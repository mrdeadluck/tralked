"use client";

import { useState, useTransition } from "react";
import { syncConnectionsAction } from "@/lib/accounts/actions";
import type { ClaimNotice } from "./ClaimPanel";

const LINK_BUTTON =
  "cursor-pointer font-semibold text-text underline underline-offset-4 hover:no-underline disabled:cursor-not-allowed disabled:opacity-60";

/** "Precisa sincronizar agora? Sincronizar": imports the latest progress of every connection. */
export function SyncNow() {
  const [busy, startBusy] = useTransition();
  const [notice, setNotice] = useState<ClaimNotice | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <p>
        Precisa sincronizar agora?{" "}
        <button
          type="button"
          disabled={busy}
          className={LINK_BUTTON}
          onClick={() => {
            setNotice(null);
            startBusy(async () => {
              const result = await syncConnectionsAction();
              setNotice(result.ok ? { tone: "ok", text: result.message ?? "Sincronização iniciada." } : { tone: "error", text: result.error });
            });
          }}
        >
          {busy ? "Sincronizando…" : "Sincronizar"}
        </button>
      </p>
      <p aria-live="polite" className="empty:hidden">
        {notice ? (
          <span role={notice.tone === "error" ? "alert" : undefined} className={notice.tone === "error" ? "text-nin" : "text-acc"}>
            {notice.text}
          </span>
        ) : null}
      </p>
    </div>
  );
}
