"use client";

import { useState, useTransition } from "react";
import { blockAction, friendAction } from "@/lib/social/actions";

type Op = "accept" | "decline" | "cancel" | "unblock";

const LABEL: Record<Op, string> = {
  accept: "Aceitar",
  decline: "Recusar",
  cancel: "Cancelar pedido",
  unblock: "Desbloquear",
};

const DONE: Record<Op, string> = {
  accept: "Agora vocês são amigos.",
  decline: "Pedido recusado.",
  cancel: "Pedido cancelado.",
  unblock: "Desbloqueado.",
};

/** Buttons next to a person in a list: answer a friend request, cancel one, or unblock. */
export function PersonActions({ userId, handle, ops }: { userId: string; handle: string; ops: Op[] }) {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (done) {
    return (
      <p role="status" className="font-mono text-[11px] text-acc">
        {done}
      </p>
    );
  }

  function run(op: Op) {
    startTransition(async () => {
      const result =
        op === "unblock" ? await blockAction({ userId, block: false }) : await friendAction({ userId, op });
      if (result.status === "ok") setDone(DONE[op]);
      else setError(result.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ops.map((op) => (
        <button
          key={op}
          type="button"
          disabled={busy}
          onClick={() => run(op)}
          aria-label={`${LABEL[op]} @${handle}`}
          className={`inline-flex h-9 cursor-pointer items-center rounded-[2px] border px-3 font-mono text-[11px] font-bold tracking-[0.08em] uppercase disabled:cursor-wait disabled:opacity-60 ${
            op === "accept" ? "border-acc bg-acc text-bg hover:brightness-[1.08]" : "border-line-2 text-text hover:border-text"
          }`}
        >
          {LABEL[op]}
        </button>
      ))}
      {error ? (
        <p role="alert" className="w-full text-[13px] text-nin">
          {error}
        </p>
      ) : null}
    </div>
  );
}
