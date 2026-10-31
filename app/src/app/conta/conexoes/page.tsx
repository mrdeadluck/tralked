import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountLogin } from "@/components/account/AccountLogin";
import { AccountNav } from "@/components/account/AccountNav";
import { ConnectionCard, type ConnectionCardState } from "@/components/account/ConnectionCard";
import { ConnectionShell } from "@/components/account/ConnectionShell";
import type { LinkPlatform } from "@/components/account/platform-guides";
import { formatAgo } from "@/components/character/format";
import { PageHead } from "@/components/community/PageHead";
import { connectionState } from "@/lib/accounts/connection-state";
import { getLinkedAccounts, type LinkedAccountView } from "@/lib/accounts/queries";
import { googleLoginEnabled } from "@/lib/auth/google";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Conexões · Tralked",
  description: "Conecte Steam, PlayStation, Xbox e RetroAchievements ao seu personagem do Tralked.",
  robots: { index: false },
};

const PLATFORMS: LinkPlatform[] = ["steam", "psn", "xbox", "retro"];

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

/** `?erro=` codes set by the Google callback when a link is refused. */
const LINK_ERRORS: Record<string, string> = {
  google_diferente: "Esta conta já está conectada a outra conta Google.",
};

const NOTICE = "rounded-[3px] border bg-surface px-4 py-3 text-[14.5px] text-text";

export default function ConexoesPage({ searchParams }: PageProps<"/conta/conexoes">) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead
        title="Conexões"
        lede="Cada plataforma conectada soma conquistas, XP e atributos no mesmo personagem. O Tralked nunca pede a senha da Steam, da PSN ou do Xbox: você prova que a conta é sua colando um código no perfil."
      />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando conexões…</p>}>
        <ConexoesContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ConexoesContent({ searchParams }: { searchParams: PageProps<"/conta/conexoes">["searchParams"] }) {
  const user = await getSessionUser();
  if (!user) return <AccountLogin returnTo="/conta/conexoes" />;
  const { erro, bemvindo, historico } = await searchParams;
  const linkError = typeof erro === "string" ? LINK_ERRORS[erro] : undefined;
  const google = googleLoginEnabled();

  const now = new Date();
  const accounts = await getLinkedAccounts(user.id, now);
  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));
  const steamConnected = Boolean(byPlatform.get("steam")?.verified);

  // The Steam import's progress lives on the user (the cron and the character sheet share it).
  const view = (platform: LinkPlatform): LinkedAccountView | undefined => {
    const row = byPlatform.get(platform);
    if (platform !== "steam" || !row?.verified) return row;
    return { ...row, lastSyncedAt: user.lastSyncedAt, lastSyncAttemptAt: user.lastSyncAttemptAt };
  };

  const cardState = (platform: LinkPlatform): ConnectionCardState => {
    const state = connectionState(view(platform), now);
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
      {historico === "1" ? (
        <p role="status" className={`${NOTICE} border-acc`}>
          <b>Encontramos o seu histórico do Tralked.</b> Você está na sua conta de antes, @{user.handle}, com o
          XP e as conquistas de sempre. O e-mail e a senha que você criou agora entram nela.
        </p>
      ) : bemvindo === "1" && !steamConnected ? (
        <p role="status" className={`${NOTICE} border-acc`}>
          <b>Conta criada.</b> Conecte a sua Steam logo abaixo para importar biblioteca, conquistas e XP para o
          seu personagem.
        </p>
      ) : null}
      {linkError ? (
        <p role="alert" className={`${NOTICE} border-nin`}>
          {linkError}
        </p>
      ) : null}
      <div className="flex flex-col gap-5">
        {PLATFORMS.map((platform) => (
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
                  Conecte o Google para entrar nesta conta sem digitar a senha. Ele não traz conquistas:
                  serve só para o login.
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
