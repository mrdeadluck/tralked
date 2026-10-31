import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthColumns, GoogleButton, TEXT_LINK } from "@/components/auth/AuthPage";
import { SignupForm } from "@/components/auth/SignupForm";
import { PageHead } from "@/components/community/PageHead";
import { googleLoginEnabled } from "@/lib/auth/google";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Criar conta · Tralked",
  description: "Crie a sua conta do Tralked e conecte Steam, PlayStation, Xbox e RetroAchievements.",
  robots: { index: false },
};

export default function CadastrarPage() {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead
        title="Criar conta"
        lede="Uma conta do Tralked junta as conquistas de todas as suas plataformas no mesmo personagem."
      />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando…</p>}>
        <CadastrarContent />
      </Suspense>
    </div>
  );
}

async function CadastrarContent() {
  if (await getSessionUser()) redirect("/conta/conexoes");
  return (
    <AuthColumns
      aside={
        <>
          <p>
            Já tem conta?{" "}
            <Link href="/entrar" className={TEXT_LINK}>
              Entre
            </Link>
            .
          </p>
          <p>
            Depois de criar a conta, conecte a sua Steam: você cola um código temporário no Resumo do
            perfil Steam e o Tralked importa biblioteca, conquistas e XP. PlayStation, Xbox e
            RetroAchievements funcionam do mesmo jeito.
          </p>
          <p>
            Já usava o Tralked entrando pela Steam? Conecte a mesma Steam a esta conta nova: o Tralked
            encontra o seu histórico e você continua de onde parou.
          </p>
          <p className="text-muted">
            O Tralked nunca pede a senha da Steam, da PSN, do Xbox ou do Google. A única senha é a do
            próprio Tralked.
          </p>
        </>
      }
    >
      <SignupForm />
      {googleLoginEnabled() ? (
        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <p className="text-[13.5px] text-muted">Prefere não criar uma senha?</p>
          <div>
            <GoogleButton returnTo="/conta/conexoes" label="Criar conta com o Google" />
          </div>
        </div>
      ) : null}
    </AuthColumns>
  );
}
