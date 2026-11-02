"use client";

import Link from "next/link";
import { useEffect } from "react";

const BUTTON =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-[2px] border px-[18px] font-mono text-xs font-bold tracking-[0.1em] uppercase";

/** Error boundary of the pages (inside the root layout, so header and footer stay). */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Server errors arrive with only a digest in production: shown so support can find the log line.
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <section className="mx-auto flex w-full max-w-[880px] flex-col gap-6 py-10">
      <h1 className="text-[clamp(30px,4vw,44px)] leading-[0.95] font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
        Algo deu errado aqui
      </h1>
      <p className="max-w-[60ch] text-[17px] text-muted">
        Esta parte da página não carregou. Pode ser uma falha passageira: tente de novo. Se continuar,
        volte para as notícias e tente mais tarde.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => retry()} className={`${BUTTON} border-acc bg-acc text-bg hover:brightness-[1.08]`}>
          Tentar de novo
        </button>
        <Link href="/" className={`${BUTTON} border-line-2 text-text hover:border-text`}>
          Ir para as notícias
        </Link>
      </div>
      {digest ? <p className="font-mono text-xs text-dim">Código do erro: {digest}</p> : null}
    </section>
  );
}
