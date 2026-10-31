"use client";

import Link from "next/link";
import { saveConsent, useConsent } from "./consent-store";

const BUTTON =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-[2px] border px-[18px] font-mono text-xs font-bold tracking-[0.08em] uppercase";

/**
 * First-visit cookie notice. Only necessary cookies are used until the visitor accepts optional
 * ones; the choice is kept in the first-party `tk_consent` cookie. Not a modal: the page stays usable.
 */
export function CookieConsent() {
  const consent = useConsent();
  if (consent !== null) return null;

  return (
    <section
      aria-label="Aviso de cookies"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-2 bg-surface shadow-[0_-12px_32px_-16px_rgb(0_0_0/0.8)]"
    >
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4">
        <p className="max-w-[72ch] flex-[1_1_420px] text-[14.5px] text-text-2">
          O Tralked usa só os cookies necessários para funcionar: o da sua sessão e os do login. Cookies
          opcionais, como medição de audiência e publicidade, só com a sua permissão.{" "}
          <Link href="/privacidade#cookies" className="text-acc underline underline-offset-2">
            Como usamos cookies
          </Link>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => saveConsent("necessary")} className={`${BUTTON} border-line-2 text-text hover:border-text`}>
            Só os necessários
          </button>
          <button type="button" onClick={() => saveConsent("all")} className={`${BUTTON} border-acc bg-acc text-bg hover:brightness-[1.08]`}>
            Aceitar opcionais
          </button>
        </div>
      </div>
    </section>
  );
}

/** The current choice and buttons to change it (privacy page, #cookies). */
export function CookiePreferences() {
  const consent = useConsent();
  if (consent === "unknown") return null;
  const label =
    consent === "all"
      ? "Você aceitou cookies opcionais."
      : consent === "necessary"
        ? "Você escolheu só os cookies necessários."
        : "Você ainda não escolheu: valem só os cookies necessários.";

  return (
    <div className="flex flex-col items-start gap-3 rounded-[3px] border border-line bg-surface p-5">
      <p role="status" className="text-[15px] font-bold">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={consent === "necessary"}
          onClick={() => saveConsent("necessary")}
          className={`${BUTTON} border-line-2 text-text hover:border-text aria-pressed:border-acc`}
        >
          Só os necessários
        </button>
        <button
          type="button"
          aria-pressed={consent === "all"}
          onClick={() => saveConsent("all")}
          className={`${BUTTON} border-line-2 text-text hover:border-text aria-pressed:border-acc`}
        >
          Aceitar opcionais
        </button>
      </div>
    </div>
  );
}
