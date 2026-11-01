"use client";

import { useState, type ReactNode } from "react";

/**
 * Hides a heavily disliked item (or one by a blocked user) behind "Ver mesmo assim". The content is
 * still there for whoever chooses to read it; nothing is deleted.
 */
export function Collapsible({ reason, children }: { reason: "disliked" | "blocked"; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <>{children}</>;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-dim">
      <span>
        {reason === "blocked"
          ? "Recolhido: você e o autor estão bloqueados."
          : "Recolhido por receber muitas descurtidas."}
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-acc underline underline-offset-2 hover:no-underline"
      >
        Ver mesmo assim
      </button>
    </p>
  );
}
