import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthColumns, AuthNotes, GoogleButton, TEXT_LINK } from "@/components/auth/AuthPage";
import { SignupForm } from "@/components/auth/SignupForm";
import { PageHead } from "@/components/community/PageHead";
import { OnboardingSteps, SampleCharacterCard } from "@/components/onboarding/SampleCharacter";
import { googleLoginEnabled } from "@/lib/auth/google";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Criar conta · Tralked",
  description: "Crie a sua conta do Tralked e conecte Steam, PlayStation, Xbox e RetroAchievements.",
  robots: { index: false },
};

export default function CadastrarPage() {
  return (
    <div className="flex w-full flex-col gap-8">
      <PageHead
        title="Criar conta"
        lede="Suas conquistas da Steam, do PlayStation e do Xbox viram um personagem só: nível, platinas e skills por gênero."
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
          <SampleCharacterCard />
          <OnboardingSteps current={1} />
          <AuthNotes>
            <p>
              Já tem conta?{" "}
              <Link href="/entrar" className={TEXT_LINK}>
                Entre
              </Link>
              . Já usava o Tralked entrando pela Steam? Conecte a mesma Steam a esta conta nova: o Tralked
              encontra o seu histórico e você continua de onde parou.
            </p>
            <p className="text-muted">
              O Tralked nunca pede a senha da Steam, da PSN, do Xbox ou do Google. A única senha é a do
              próprio Tralked.
            </p>
          </AuthNotes>
        </>
      }
    >
      <SignupForm />
      {googleLoginEnabled() ? (
        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <p className="text-[13.5px] text-muted">Prefere não criar uma senha?</p>
          <div>
            <GoogleButton returnTo="/conta/conexoes?bemvindo=1" label="Criar conta com o Google" />
          </div>
        </div>
      ) : null}
    </AuthColumns>
  );
}
