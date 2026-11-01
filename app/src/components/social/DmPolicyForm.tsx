"use client";

import { useState, useTransition } from "react";
import { setDmPolicyAction } from "@/lib/social/actions";

const OPTIONS = [
  { value: "everyone", label: "Qualquer pessoa", hint: "Quem tem conta no Tralked pode começar uma conversa." },
  { value: "following", label: "Só quem eu sigo", hint: "Amigos também, porque amigos se seguem." },
  { value: "friends", label: "Só amigos", hint: "Quem aceitou (ou teve aceito) um pedido de amizade." },
] as const;

type Policy = (typeof OPTIONS)[number]["value"];

/** "Quem pode me mandar mensagem" (saved on change). */
export function DmPolicyForm({ policy }: { policy: Policy }) {
  const [value, setValue] = useState<Policy>(policy);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  function choose(next: Policy) {
    const before = value;
    setValue(next);
    setStatus(null);
    startTransition(async () => {
      const result = await setDmPolicyAction({ policy: next });
      if (result.status === "ok") setStatus({ tone: "ok", text: "Salvo." });
      else {
        setValue(before);
        setStatus({ tone: "error", text: result.message });
      }
    });
  }

  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" disabled={busy}>
      <legend className="mb-2 text-[15px] font-bold">Quem pode me mandar mensagem</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2.5 text-[14.5px] text-text-2">
          <input
            type="radio"
            name="dmPolicy"
            value={o.value}
            checked={value === o.value}
            onChange={() => choose(o.value)}
            className="mt-1 accent-acc"
          />
          <span>
            {o.label}
            <span className="block text-[13px] text-muted">{o.hint}</span>
          </span>
        </label>
      ))}
      {status ? (
        <p role={status.tone === "ok" ? "status" : "alert"} className={`text-[13px] ${status.tone === "ok" ? "text-acc" : "text-nin"}`}>
          {status.text}
        </p>
      ) : null}
    </fieldset>
  );
}
