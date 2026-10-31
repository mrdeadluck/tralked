"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Explains a failed Google login (`?login=erro`, set by its callback) instead of a silent home page. */
export function LoginNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  if (params.get("login") !== "erro") return null;

  const dismiss = () => {
    const next = new URLSearchParams(params);
    next.delete("login");
    next.delete("motivo");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div role="alert" className="border-b border-line bg-surface-2">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-[15px]">
        <p className="flex-1 basis-[320px]">
          <b className="text-acc">Não deu para entrar.</b> O Google não confirmou o login. Tente de novo ou entre com e-mail e senha.
        </p>
        <Link
          href="/entrar?returnTo=%2Fjogador%2Fme"
          className="rounded-[2px] bg-acc px-4 py-2.5 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
        >
          Entrar
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="cursor-pointer font-mono text-xs tracking-[0.1em] text-text-3 uppercase hover:text-text"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
