import type { Metadata } from "next";
import Link from "next/link";
import { AuthColumns, TEXT_LINK } from "@/components/auth/AuthPage";
import { ForgotPasswordForm } from "@/components/auth/PasswordResetForms";
import { PageHead } from "@/components/community/PageHead";

export const metadata: Metadata = {
  title: "Esqueci a senha · Tralked",
  description: "Receba um link para criar uma nova senha da sua conta do Tralked.",
  robots: { index: false },
};

export default function EsqueciSenhaPage() {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead title="Esqueci a senha" lede="Informe o e-mail da conta e enviamos um link para criar uma nova senha." />
      <AuthColumns
        aside={
          <>
            <p>O link vale 1 hora e funciona uma vez só. Se pedir de novo, use o link mais recente.</p>
            <p>
              Lembrou a senha?{" "}
              <Link href="/entrar" className={TEXT_LINK}>
                Entrar
              </Link>
              .
            </p>
          </>
        }
      >
        <ForgotPasswordForm />
      </AuthColumns>
    </div>
  );
}
