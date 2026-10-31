import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountLogin } from "@/components/account/AccountLogin";
import { AccountNav } from "@/components/account/AccountNav";
import { ConnectionCard, type ConnectionCardState } from "@/components/account/ConnectionCard";
import { ConnectionShell } from "@/components/account/ConnectionShell";
import type { CodePlatform } from "@/components/account/platform-guides";
import { formatAgo } from "@/components/character/format";
import { PageHead } from "@/components/community/PageHead";
import { connectionState } from "@/lib/accounts/connection-state";
import { getLinkedAccounts } from "@/lib/accounts/queries";
import { googleLoginEnabled } from "@/lib/auth/google";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Conexões · Tralked",
  description: "Conecte Steam, PlayStation, Xbox e RetroAchievements ao seu personagem do Tralked.",
  robots: { index: false },
};

const CODE_PLATFORMS: CodePlatform[] = ["psn", "xbox", "retro"];

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

export default function ConexoesPage() {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead
        title="Conexões"
        lede="Cada plataforma conectada soma conquistas, XP e atributos no mesmo personagem. O Tralked nunca pede sua senha: você prova que a conta é sua colando um código no perfil."
      />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando conexões…</p>}>
        <ConexoesContent />
      </Suspense>
    </div>
  );
}

async function ConexoesContent() {
  const user = await getSessionUser();
  const google = googleLoginEnabled();
  if (!user) return <AccountLogin returnTo="/conta/conexoes" google={google} />;

  const now = new Date();
  const accounts = await getLinkedAccounts(user.id, now);
  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));
  const steam = byPlatform.get("steam");
  const steamConnected = Boolean(steam?.verified);

  const cardState = (platform: CodePlatform): ConnectionCardState => {
    const state = connectionState(byPlatform.get(platform), now);
    switch (state.kind) {
      case "disconnected":
        return state;
      case "pending":
        return { kind: "pending", handle: state.handle, code: state.code, expiresLabel: timeFormatter.format(state.expiresAt) };
      case "connected":
        return {
          kind: "connected",
          handle: state.handle,
          lastSyncedLabel: state.lastSyncedAt ? formatAgo(state.lastSyncedAt, now) : null,
          importing: state.importing,
          failed: state.failed,
        };
    }
  };

  return (
    <>
      <AccountNav current="/conta/conexoes" />
      <div className="flex flex-col gap-5">
        <ConnectionShell
          id="conexao-steam"
          name="Steam"
          color="var(--pc)"
          status={steamConnected ? "Conectada" : "Não conectada"}
          tone={steamConnected ? "on" : "off"}
        >
          {steamConnected && steam ? (
            <>
              <dl className="m-0 grid gap-x-6 gap-y-1 text-[14.5px] min-[641px]:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="text-muted">Perfil Steam</dt>
                <dd className="m-0 font-semibold break-words">{steam.handle}</dd>
              </dl>
              <p className="text-[14px] text-muted">
                Conectada pelo login com a Steam.{" "}
                {user.lastSyncedAt
                  ? `Última sincronização: ${formatAgo(user.lastSyncedAt, now)}.`
                  : "A primeira importação está em andamento."}{" "}
                Para sincronizar agora, use o botão na sua{" "}
                <Link href={`/jogador/${user.handle}`} className="text-acc underline underline-offset-2">
                  ficha de personagem
                </Link>
                .
              </p>
            </>
          ) : (
            <p className="max-w-[62ch] text-[14.5px] text-text-2">
              A Steam é conectada pelo login com a Steam. Esta conta foi criada com o Google, então
              ainda não tem Steam: entrar com a Steam agora abriria outra conta.
            </p>
          )}
        </ConnectionShell>

        {CODE_PLATFORMS.map((platform) => (
          <ConnectionCard key={platform} platform={platform} state={cardState(platform)} />
        ))}

        {google ? (
          <ConnectionShell
            id="conexao-google"
            name="Google"
            color="var(--text-3)"
            status={user.googleSub ? "Conectada" : "Não conectada"}
            tone={user.googleSub ? "on" : "off"}
          >
            {user.googleSub ? (
              <p className="text-[14.5px] text-text-2">
                Você também pode entrar nesta conta com o Google. O Google não traz conquistas: serve só
                para o login.
              </p>
            ) : (
              <>
                <p className="max-w-[62ch] text-[14.5px] text-text-2">
                  Conecte o Google para entrar nesta conta sem a Steam. Ele não traz conquistas: serve
                  só para o login.
                </p>
                <div>
                  {/* A route handler redirect (OAuth), so a plain anchor. */}
                  <a
                    href="/api/auth/google?returnTo=%2Fconta%2Fconexoes"
                    className="inline-flex h-11 items-center justify-center rounded-[2px] border border-line-2 px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-text uppercase hover:border-text"
                  >
                    Conectar Google
                  </a>
                </div>
              </>
            )}
          </ConnectionShell>
        ) : null}
      </div>
    </>
  );
}
