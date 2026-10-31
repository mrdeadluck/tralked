import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthColumns, TEXT_LINK } from "@/components/auth/AuthPage";
import { ResetPasswordForm } from "@/components/auth/PasswordResetForms";
import { PageHead } from "@/components/community/PageHead";
import { isResetTokenValid } from "@/lib/auth/password-reset";

export const metadata: Metadata = {
  title: "Nova senha · Tralked",
  robots: { index: false },
  // The token is in the URL: never send it to another site as a referrer.
  referrer: "no-referrer",
};

export default function RedefinirSenhaPage({ searchParams }: PageProps<"/redefinir-senha">) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead title="Nova senha" lede="Crie a senha que você vai usar para entrar no Tralked." />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Conferindo o link…</p>}>
        <RedefinirContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function RedefinirContent({ searchParams }: { searchParams: PageProps<"/redefinir-senha">["searchParams"] }) {
  const { token } = await searchParams;
  const value = typeof token === "string" && token.length <= 200 ? token : "";
  const valid = value !== "" && (await isResetTokenValid(value));

  return (
    <AuthColumns
      aside={
        <p className="text-muted">
          Use uma senha só para o Tralked, diferente da senha da Steam, da PSN, do Xbox ou do Google.
        </p>
      }
    >
      {valid ? (
        <ResetPasswordForm token={value} />
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-[19px] font-extrabold font-stretch-[105%]">Este link não vale mais</h2>
          <p className="text-[14.5px] text-text-2">
            Ele expirou (vale 1 hora), já foi usado ou está incompleto.{" "}
            <Link href="/esqueci-senha" className={TEXT_LINK}>
              Peça um novo link
            </Link>
            .
          </p>
        </div>
      )}
    </AuthColumns>
  );
}
