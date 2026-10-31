"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  estado: "O login demorou demais ou foi aberto em outra aba, e não deu para confirmar que era você.",
  steam: "A Steam não confirmou o login.",
  conta: "A Steam confirmou quem você é, mas não conseguimos abrir a sua conta agora.",
};

/** Explains a failed login (`?login=erro&motivo=…`, set by the auth callbacks) instead of a silent home page. */
export function LoginNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  if (params.get("login") !== "erro") return null;

  const message = MESSAGES[params.get("motivo") ?? ""] ?? "Não foi possível entrar.";
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
          <b className="text-acc">Não deu para entrar.</b> {message} Tente de novo.
        </p>
        {/* A route handler redirect: a plain anchor, not next/link. */}
        <a
          href="/api/auth/steam?returnTo=/jogador/me"
          className="rounded-[2px] bg-acc px-4 py-2.5 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
        >
          Entrar com a Steam
        </a>
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
