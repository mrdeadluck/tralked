import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Página não encontrada | Tralked",
  robots: { index: false },
};

const LINK =
  "inline-flex h-11 items-center justify-center rounded-[2px] border px-[18px] font-mono text-xs font-bold tracking-[0.1em] uppercase";

/** 404 of every route (unknown URLs and notFound() in pages). */
export default function NotFound() {
  return (
    <section className="mx-auto flex w-full max-w-[880px] flex-col gap-6 py-10">
      <p
        aria-hidden="true"
        className="text-[clamp(96px,18vw,200px)] leading-[0.8] font-black font-stretch-[125%] tracking-[-0.04em] text-ph"
      >
        4<span className="text-acc">0</span>4
      </p>
      <h1 className="text-[clamp(30px,4vw,44px)] leading-[0.95] font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
        Essa página não existe
      </h1>
      <p className="max-w-[60ch] text-[17px] text-muted">
        O link pode estar errado, ou o conteúdo saiu do ar. Volte para as notícias ou procure o jogo no
        catálogo.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/" className={`${LINK} border-acc bg-acc text-bg hover:brightness-[1.08]`}>
          Ir para as notícias
        </Link>
        <Link href="/jogos" className={`${LINK} border-line-2 text-text hover:border-text`}>
          Ver jogos e guias
        </Link>
      </div>
    </section>
  );
}
