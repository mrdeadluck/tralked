"use client";

import { useState, useTransition } from "react";
import { resendEmailConfirmationAction } from "@/app/conta/actions";
import { Button } from "@/components/ui/Button";

type EmailStatusProps = {
  email: string | null;
  verified: boolean;
  /** False in production without RESEND_API_KEY. */
  mailOn: boolean;
};

/**
 * "E-mail confirmado" badge of /conta, or the unconfirmed state with "Reenviar e-mail de
 * confirmação". Confirming never blocks anything.
 */
export function EmailStatus({ email, verified, mailOn }: EmailStatusProps) {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!email) return null;
  if (verified) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-[14.5px] text-text-2">
        <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-acc px-2 py-0.5 font-mono text-xs font-bold tracking-[0.08em] text-acc uppercase">
          <span aria-hidden="true">✓</span> E-mail confirmado
        </span>
        <span className="break-all">{email}</span>
      </p>
    );
  }

  function resend() {
    setResult(null);
    startTransition(async () => {
      try {
        const answer = await resendEmailConfirmationAction();
        setResult(answer.ok ? { ok: true, text: answer.message } : { ok: false, text: answer.error });
      } catch {
        setResult({ ok: false, text: "Não deu para enviar o e-mail agora. Tente de novo em alguns minutos." });
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="flex flex-wrap items-center gap-2 text-[14.5px] text-text-2">
        <span className="inline-flex items-center rounded-[2px] border border-line-2 px-2 py-0.5 font-mono text-xs font-bold tracking-[0.08em] text-muted uppercase">
          E-mail não confirmado
        </span>
        <span className="break-all">{email}</span>
      </p>
      {mailOn ? (
        <>
          <p className="max-w-[60ch] text-[14px] text-muted">
            Confirmar não é obrigatório: dá o selo “e-mail confirmado” à conta. Não achou o e-mail? Olhe o spam
            ou peça outro.
          </p>
          <Button variant="ghost" onClick={resend} disabled={pending}>
            {pending ? "Enviando…" : "Reenviar e-mail de confirmação"}
          </Button>
        </>
      ) : (
        <p className="max-w-[60ch] text-[14px] text-muted">
          O envio de e-mails do Tralked está desativado no momento, então a confirmação fica para depois. Nada
          muda no uso da conta.
        </p>
      )}
      {/* Always in the DOM, so screen readers announce the answer when it appears. */}
      <p role="status" className={`text-[14px] ${result?.ok === false ? "text-nin" : "text-text-2"}`}>
        {result?.text ?? ""}
      </p>
    </div>
  );
}
