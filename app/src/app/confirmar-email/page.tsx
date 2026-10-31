import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHead } from "@/components/community/PageHead";
import { confirmEmailAction } from "@/lib/auth/email-actions";
import {
  checkEmailVerificationToken,
  readConfirmResult,
  VERIFY_TTL_DAYS,
  type ConfirmEmailResult,
} from "@/lib/auth/email-verification";

export const metadata: Metadata = {
  title: "Confirmar e-mail · Tralked",
  robots: { index: false },
};

const MESSAGES: Record<ConfirmEmailResult, { title: string; text: string }> = {
  confirmed: {
    title: "E-mail confirmado",
    text: "Pronto! A sua conta agora mostra o selo “e-mail confirmado”.",
  },
  already: {
    title: "E-mail já confirmado",
    text: "Este e-mail já estava confirmado. Não precisa fazer mais nada.",
  },
  invalid: {
    title: "Link inválido",
    text: "Este link de confirmação está incompleto ou não vale mais para o e-mail da conta (ele muda quando o e-mail é trocado). Peça outro em Conta → E-mail e senha.",
  },
  expired: {
    title: "Link expirado",
    text: `O link de confirmação vale por ${VERIFY_TTL_DAYS} dias e este já passou do prazo. Peça outro em Conta → E-mail e senha.`,
  },
};

const BACK = (
  <Link href="/conta" className="self-start font-mono text-[11px] tracking-[0.08em] text-acc uppercase hover:underline">
    Ir para a conta →
  </Link>
);

export default function ConfirmarEmailPage({ searchParams }: PageProps<"/confirmar-email">) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
      <Suspense fallback={<PageHead title="Confirmar e-mail" lede="Verificando o link…" />}>
        <Confirmation searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Outcome({ result }: { result: ConfirmEmailResult }) {
  const message = MESSAGES[result];
  return (
    <>
      <PageHead title={message.title} />
      <p role="status" className="max-w-[60ch] text-[16px] text-text-2">
        {message.text}
      </p>
      {BACK}
    </>
  );
}

/** `?resultado=` that is not the fresh, signed one from the POST: no claim either way. */
function NeutralOutcome() {
  return (
    <>
      <PageHead title="Confirmação de e-mail" />
      <p role="status" className="max-w-[60ch] text-[16px] text-text-2">
        Veja em Conta → E-mail e senha se o seu e-mail está confirmado. Se não estiver, peça um link novo por lá.
      </p>
      {BACK}
    </>
  );
}

/**
 * GET never confirms (mail scanners prefetch links): it checks the link and shows a button that
 * POSTs the confirmation. After the POST the action redirects here with a signed, short-lived
 * `?resultado=`.
 */
async function Confirmation({ searchParams }: { searchParams: PageProps<"/confirmar-email">["searchParams"] }) {
  const { token, resultado } = await searchParams;
  if (resultado !== undefined) {
    const result = readConfirmResult(resultado);
    return result ? <Outcome result={result} /> : <NeutralOutcome />;
  }

  const check = await checkEmailVerificationToken(token);
  if (check.status !== "valid") return <Outcome result={check.status} />;

  return (
    <>
      <PageHead title="Confirmar e-mail" />
      <p className="max-w-[60ch] text-[16px] text-text-2">
        Confirme que <strong className="text-text">{check.email}</strong> é o e-mail da sua conta no Tralked.
      </p>
      <form action={confirmEmailAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="token" value={String(token)} />
        <button
          type="submit"
          className="inline-flex h-11 cursor-pointer items-center justify-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
        >
          Confirmar e-mail
        </button>
        <span className="text-[14px] text-muted">Não pediu? É só ignorar esta página.</span>
      </form>
      {BACK}
    </>
  );
}
