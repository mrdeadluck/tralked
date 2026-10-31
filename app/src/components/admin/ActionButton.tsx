"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SMALL_BUTTON } from "./ui";

type Result = { ok: true } | { ok: false; error: string };

type ActionButtonProps<I> = {
  /** A Server Action (it re-checks the session and role itself). */
  action: (input: I) => Promise<Result>;
  input: I;
  label: string;
  /** Accessible name when the visible label is ambiguous in a list ("Ocultar comentário de @x"). */
  ariaLabel?: string;
  /** Asks before running (destructive or final actions). */
  confirm?: string;
  tone?: "default" | "danger" | "primary";
  /** Shown after success (the list refreshes either way). */
  done?: string;
};

const TONES = {
  default: "",
  danger: "hover:border-nin hover:text-nin",
  primary: "border-acc text-acc hover:bg-acc hover:text-bg",
} as const;

/** One admin action on one row: runs the Server Action, then refreshes the page's data. */
export function ActionButton<I>({ action, input, label, ariaLabel, confirm, tone = "default", done }: ActionButtonProps<I>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    if (confirm && !window.confirm(confirm)) return;
    setMessage(null);
    start(async () => {
      const result = await action(input);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      if (done) setMessage({ ok: true, text: done });
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-label={ariaLabel}
        className={`${SMALL_BUTTON} ${TONES[tone]}`}
      >
        {pending ? `${label}…` : label}
      </button>
      {message ? (
        <span role={message.ok ? "status" : "alert"} className={`max-w-[28ch] text-[12px] ${message.ok ? "text-acc" : "text-nin"}`}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
