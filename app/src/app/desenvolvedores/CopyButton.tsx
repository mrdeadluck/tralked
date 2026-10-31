"use client";

import { useState } from "react";

/** Copies a code sample. Without JS (or clipboard access) the code stays selectable as usual. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copiar ${label}`}
      className="rounded-[3px] border border-line-2 px-2.5 py-1 font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase transition-colors hover:border-acc hover:text-acc"
    >
      <span aria-live="polite">{state === "copied" ? "Copiado" : state === "failed" ? "Selecione e copie" : "Copiar"}</span>
    </button>
  );
}
