import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthColumns, GoogleButton, TEXT_LINK } from "@/components/auth/AuthPage";
import { LoginForm } from "@/components/auth/LoginForm";
import { PageHead } from "@/components/community/PageHead";
import { googleLoginEnabled } from "@/lib/auth/google";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Entrar · Tralked",
  description: "Entre na sua conta do Tralked com e-mail e senha.",
  robots: { index: false },
};

/** `?erro=` codes set by the Google callback. */
const ERRORS: Record<string, string> = {
  google_email:
    "Já existe uma conta do Tralked com o e-mail desse Google. Entre com e-mail e senha e conecte o Google em Conexões.",
  suspensa: "Esta conta está suspensa pela moderação.",
};

export default function EntrarPage({ searchParams }: PageProps<"/entrar">) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead title="Entrar" lede="Entre com o e-mail e a senha da sua conta do Tralked." />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando…</p>}>
        <EntrarContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function EntrarContent({ searchParams }: { searchParams: PageProps<"/entrar">["searchParams"] }) {
  const { returnTo: rawReturnTo, erro } = await searchParams;
  const returnTo = sanitizeReturnTo(typeof rawReturnTo === "string" ? rawReturnTo : undefined);
  if (await getSessionUser()) redirect(returnTo);
  const error = typeof erro === "string" ? ERRORS[erro] : undefined;
  const signupHref = returnTo === "/jogador/me" ? "/cadastrar" : `/cadastrar?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <AuthColumns
      aside={
        <>
          <p>
            Ainda não tem conta?{" "}
            <Link href={signupHref} className={TEXT_LINK}>
              Crie a sua
            </Link>
            . Depois você conecta Steam, PlayStation, Xbox e RetroAchievements em Conexões.
          </p>
          <p>
            Já usava o Tralked entrando pela Steam? Crie uma conta e conecte a mesma Steam: o Tralked
            encontra o seu histórico (XP, conquistas e @) e passa para a conta nova.
          </p>
          <p className="text-muted">
            O Tralked só pede a senha do Tralked. Nunca digite aqui a senha da Steam, da PSN, do Xbox ou do
            Google.
          </p>
        </>
      }
    >
      {error ? (
        <p role="alert" className="rounded-[3px] border border-nin bg-bg px-4 py-3 text-[14.5px]">
          {error}
        </p>
      ) : null}
      <LoginForm returnTo={returnTo} />
      {googleLoginEnabled() ? (
        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <p className="text-[13.5px] text-muted">
            Ou entre com o Google. Sem conta ainda? Ela é criada na hora, sem senha.
          </p>
          <div>
            <GoogleButton returnTo={returnTo} label="Entrar com o Google" />
          </div>
        </div>
      ) : null}
    </AuthColumns>
  );
}
