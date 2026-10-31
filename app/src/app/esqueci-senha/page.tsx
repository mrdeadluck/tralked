import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthColumns, TEXT_LINK } from "@/components/auth/AuthPage";
import { ForgotPasswordForm } from "@/components/auth/PasswordResetForms";
import { PageHead } from "@/components/community/PageHead";
import { mailAvailable } from "@/lib/mail/mailer";

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
        <Suspense fallback={null}>
          <MailOffNotice />
        </Suspense>
        <ForgotPasswordForm />
      </AuthColumns>
    </div>
  );
}

/** Production without RESEND_API_KEY: say up front that no link can be sent. */
async function MailOffNotice() {
  // Request time: depends on the runtime env, not the build's.
  await connection();
  if (mailAvailable()) return null;
  return (
    <p className="rounded-[3px] border border-line-2 bg-bg px-4 py-3 text-[14.5px] text-text-2">
      O envio de e-mails do Tralked está desativado no momento, então o link para criar uma nova senha não
      pode ser enviado agora. Tente de novo mais tarde.
    </p>
  );
}
