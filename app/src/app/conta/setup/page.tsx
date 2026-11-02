import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountLogin } from "@/components/account/AccountLogin";
import { AccountNav } from "@/components/account/AccountNav";
import { SetupForm } from "@/components/account/SetupForm";
import { PageHead } from "@/components/community/PageHead";
import { getSessionUser } from "@/lib/auth/session";
import { getPlayerSetup } from "@/lib/setup/queries";

export const metadata: Metadata = {
  title: "Setup · Tralked",
  description: "Os consoles que você tem e a ficha técnica do seu PC, mostrados na sua ficha de personagem.",
  robots: { index: false },
};

export default function SetupPage() {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead
        title="Setup"
        lede="Seus consoles viram selos na ficha de personagem, e a ficha técnica do PC aparece logo ao lado."
      />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando o setup…</p>}>
        <SetupContent />
      </Suspense>
    </div>
  );
}

async function SetupContent() {
  const user = await getSessionUser();
  if (!user) return <AccountLogin returnTo="/conta/setup" />;
  const setup = await getPlayerSetup(user.id);

  return (
    <>
      <AccountNav current="/conta/setup" />
      <p className="-mt-2 text-sm text-muted">
        Veja como fica em{" "}
        <Link
          href={`/jogador/${encodeURIComponent(user.handle)}`}
          className="font-semibold text-acc underline underline-offset-4 hover:no-underline"
        >
          /jogador/{user.handle}
        </Link>
        {user.profilePublic ? "." : " (seu perfil está privado: só você vê)."}
      </p>
      <SetupForm platforms={setup.platforms} pc={setup.pc} />
    </>
  );
}
