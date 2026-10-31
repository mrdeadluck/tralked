import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHead } from "@/components/community/PageHead";
import { confirmNewsletterAction } from "@/lib/newsletter/actions";
import { checkToken, subscriberConfirmed, TOKEN_TTL_DAYS, type ConfirmResult } from "@/lib/newsletter/subscribe";

export const metadata: Metadata = {
  title: "Confirmar newsletter · Tralked",
  robots: { index: false },
};

const MESSAGES: Record<ConfirmResult, { title: string; text: string }> = {
  confirmed: {
    title: "Inscrição confirmada",
    text: "Pronto! A partir da próxima semana as principais notícias e guias chegam no seu e-mail.",
  },
  already: {
    title: "Já estava confirmada",
    text: "Esse e-mail já recebe a newsletter do Tralked. Não precisa fazer mais nada.",
  },
  invalid: {
    title: "Link inválido",
    text: "Esse link de confirmação está incompleto ou não vale para este e-mail. Inscreva-se de novo pelo formulário no fim da página para receber outro link.",
  },
  expired: {
    title: "Link expirado",
    text: `O link de confirmação vale por ${TOKEN_TTL_DAYS} dias e este já passou do prazo. Inscreva-se de novo pelo formulário no fim da página para receber outro.`,
  },
};

const BACK = (
  <Link href="/" className="self-start font-mono text-[11px] tracking-[0.08em] text-acc uppercase hover:underline">
    Voltar para as notícias →
  </Link>
);

export default function ConfirmarNewsletterPage({ searchParams }: PageProps<"/newsletter/confirmar">) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
      <Suspense fallback={<PageHead title="Newsletter" lede="Verificando o link…" />}>
        <Confirmation searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Outcome({ result }: { result: ConfirmResult }) {
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

const isResult = (value: unknown): value is ConfirmResult => typeof value === "string" && value in MESSAGES;

/**
 * GET never confirms (mail scanners prefetch links): it checks the link and shows a button that
 * POSTs the confirmation. After the POST the action redirects here with `?resultado=`.
 */
async function Confirmation({ searchParams }: { searchParams: PageProps<"/newsletter/confirmar">["searchParams"] }) {
  const { email, token, resultado } = await searchParams;
  if (isResult(resultado)) return <Outcome result={resultado} />;

  const check = checkToken(email, token);
  if (check.status !== "valid") return <Outcome result={check.status} />;
  const confirmed = await subscriberConfirmed(check.email);
  if (confirmed === null) return <Outcome result="invalid" />;
  if (confirmed) return <Outcome result="already" />;

  return (
    <>
      <PageHead title="Confirmar inscrição" />
      <p className="max-w-[60ch] text-[16px] text-text-2">
        Confirme que quer receber as principais notícias e guias da semana em{" "}
        <strong className="text-text">{check.email}</strong>.
      </p>
      <form action={confirmNewsletterAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="email" value={check.email} />
        <input type="hidden" name="token" value={String(token)} />
        <button
          type="submit"
          className="inline-flex h-11 cursor-pointer items-center justify-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
        >
          Confirmar inscrição
        </button>
        <span className="text-[14px] text-muted">Não pediu? É só ignorar esta página.</span>
      </form>
      {BACK}
    </>
  );
}
