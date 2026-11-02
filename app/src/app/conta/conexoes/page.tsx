import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountLogin } from "@/components/account/AccountLogin";
import { AccountNav } from "@/components/account/AccountNav";
import { ConnectionShell } from "@/components/account/ConnectionShell";
import { LINK_PLATFORMS, PLATFORM_GUIDES, type LinkPlatform } from "@/components/account/platform-guides";
import { ServicesForm, type ServiceRow, type ServiceRowState } from "@/components/account/ServicesForm";
import { SyncNow } from "@/components/account/SyncNow";
import { formatAgo } from "@/components/character/format";
import { PageHead } from "@/components/community/PageHead";
import { SetupStepper } from "@/components/onboarding/SetupStepper";
import { connectionState } from "@/lib/accounts/connection-state";
import { getLinkedAccounts, type LinkedAccountView } from "@/lib/accounts/queries";
import { verifyFailureMessage } from "@/lib/accounts/verify-messages";
import { googleLoginEnabled } from "@/lib/auth/google";
import { getSessionUser } from "@/lib/auth/session";
import { platformAvailable } from "@/lib/integrations/availability";

export const metadata: Metadata = {
  title: "Conexões · Tralked",
  description: "Conecte Steam, PlayStation, Xbox e RetroAchievements ao seu personagem do Tralked.",
  robots: { index: false },
};

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

/** A verification code lasts a day: its expiry carries the date too ("3 de nov., 14:32"). */
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "numeric",
  month: "short",
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
        lede="Cada plataforma conectada soma conquistas, XP e atributos no mesmo personagem. Basta informar o seu perfil em cada serviço: o Tralked nunca pede a senha da Steam, da PSN ou do Xbox."
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
  const steamConnected = Boolean(byPlatform.get("steam")?.active);
  const anyConnected = accounts.some((a) => a.active);
  // Right after sign-up, and until the first platform is connected: the three steps promised on
  // /cadastrar, with the account already done.
  const showSteps = bemvindo === "1" || !anyConnected;

  // The Steam import's progress lives on the user (the cron and the character sheet share it).
  const view = (platform: LinkPlatform): LinkedAccountView | undefined => {
    const row = byPlatform.get(platform);
    if (platform !== "steam" || !row?.active) return row;
    return { ...row, lastSyncedAt: user.lastSyncedAt, lastSyncAttemptAt: user.lastSyncAttemptAt };
  };

  const rowState = (platform: LinkPlatform): ServiceRowState => {
    const state = connectionState(view(platform), now);
    // Steam reads public pages; the others need Tralked's service account on this server.
    if (platform !== "steam" && !platformAvailable(platform)) {
      return { kind: "unavailable", handle: state.kind === "connected" ? state.handle : null };
    }
    switch (state.kind) {
      case "disconnected":
        return {
          kind: "disconnected",
          claim: state.claim
            ? { handle: state.claim.handle, code: state.claim.code, expiresLabel: timeFormatter.format(state.claim.expiresAt) }
            : null,
        };
      case "connected":
        return {
          kind: "connected",
          handle: state.handle,
          saved: state.value,
          verified: state.verified,
          verification: state.verification
            ? {
                code: state.verification.code,
                expiresLabel: dateTimeFormatter.format(state.verification.expiresAt),
                failure: state.verification.failure ? verifyFailureMessage(state.verification.failure, platform) : null,
              }
            : null,
          lastSyncedLabel: state.lastSyncedAt ? formatAgo(state.lastSyncedAt, now) : null,
          importing: state.importing,
          failed: state.failed,
        };
    }
  };
  const rows: ServiceRow[] = LINK_PLATFORMS.map((platform) => ({ platform, state: rowState(platform) }));

  return (
    <>
      <AccountNav current="/conta/conexoes" />
      {showSteps ? (
        <SetupStepper connected={anyConnected} sheetHref={`/jogador/${encodeURIComponent(user.handle)}`} />
      ) : null}
      {historico === "1" ? (
        <p role="status" className={`${NOTICE} border-acc`}>
          <b>Encontramos o seu histórico do Tralked.</b> Você está na sua conta de antes, @{user.handle}, com o
          XP e as conquistas de sempre. O e-mail e a senha que você criou agora entram nela.
        </p>
      ) : bemvindo === "1" && !steamConnected ? (
        <p role="status" className={`${NOTICE} border-acc`}>
          <b>Conta criada.</b> Informe o seu perfil Steam (e os outros serviços que você usa) logo abaixo e salve
          para importar biblioteca, conquistas e XP para o seu personagem.
        </p>
      ) : null}
      {linkError ? (
        <p role="alert" className={`${NOTICE} border-nin`}>
          {linkError}
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        <ServicesForm rows={rows} />
        <div className="flex flex-col gap-2 px-1 text-[14.5px] text-text-2">
          <p>
            Confira as suas configurações de privacidade se nenhum jogo aparecer.{" "}
            <a href="#ajuda-privacidade" className="font-semibold text-text underline underline-offset-4 hover:no-underline">
              Como deixar cada perfil público
            </a>
          </p>
          <SyncNow />
        </div>
      </div>

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
              Você também pode entrar nesta conta com o Google. O Google não traz conquistas: serve só para o
              login.
            </p>
          ) : (
            <>
              <p className="max-w-[62ch] text-[14.5px] text-text-2">
                Conecte o Google para entrar nesta conta sem digitar a senha. Ele não traz conquistas: serve só
                para o login.
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

      <PrivacyHelp />
    </>
  );
}

/** "Como deixar o perfil público": what each platform must show for the import to work. */
function PrivacyHelp() {
  return (
    <section
      id="ajuda-privacidade"
      aria-labelledby="ajuda-privacidade-titulo"
      className="flex scroll-mt-24 flex-col gap-4 border-t border-line pt-6"
    >
      <h2 id="ajuda-privacidade-titulo" className="text-[19px] leading-none font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
        Como deixar o perfil público
      </h2>
      <p className="max-w-[68ch] text-[14.5px] text-text-2">
        O Tralked lê só o que o seu perfil mostra para todo mundo, sem senha e sem login na plataforma. Se a
        conexão foi salva mas nenhum jogo aparece, quase sempre é privacidade: ajuste abaixo e use
        “Sincronizar”. A importação de um perfil grande pode levar alguns minutos.
      </p>
      <dl className="m-0 grid gap-x-6 gap-y-3 text-[14.5px] min-[761px]:grid-cols-[210px_minmax(0,1fr)]">
        {LINK_PLATFORMS.map((platform) => (
          <div key={platform} className="contents">
            <dt className="font-semibold text-text">{PLATFORM_GUIDES[platform].name}</dt>
            <dd className="m-0 max-w-[68ch] text-text-2">{PLATFORM_GUIDES[platform].privacy}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
