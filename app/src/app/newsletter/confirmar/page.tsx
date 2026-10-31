import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHead } from "@/components/community/PageHead";
import { confirmSubscription, type ConfirmResult } from "@/lib/newsletter/subscribe";

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
};

export default function ConfirmarNewsletterPage({ searchParams }: PageProps<"/newsletter/confirmar">) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
      <Suspense fallback={<PageHead title="Newsletter" lede="Confirmando…" />}>
        <Confirmation searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Confirmation({ searchParams }: { searchParams: PageProps<"/newsletter/confirmar">["searchParams"] }) {
  const { email, token } = await searchParams;
  const result = await confirmSubscription(email, token);
  const message = MESSAGES[result];
  return (
    <>
      <PageHead title={message.title} />
      <p role="status" className="max-w-[60ch] text-[16px] text-text-2">
        {message.text}
      </p>
      <Link href="/" className="self-start font-mono text-[11px] tracking-[0.08em] text-acc uppercase hover:underline">
        Voltar para as notícias →
      </Link>
    </>
  );
}
