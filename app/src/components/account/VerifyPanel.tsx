"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { cancelVerificationAction, checkVerificationAction, startVerificationAction } from "@/lib/accounts/actions";
import { CopyCode, Step, type ClaimNotice } from "./ClaimPanel";
import { PLATFORM_GUIDES, type LinkPlatform } from "./platform-guides";

/**
 * A "Verificar agora" in progress; `expiresLabel` ("3 nov., 14:32") and `failure` (why the last
 * check failed, already in words) come from the server.
 */
export type PendingVerificationView = { code: string; expiresLabel: string; failure: string | null };

/**
 * Ownership proof of a connection typed in ("não verificada"): "Verificar conta" gives a code to
 * paste in the profile's free text, then "Verificar agora" reads the public profile. States:
 * pendente (code waiting), verificando (the check runs), falhou (with the reason, kept after a
 * reload), verificada (the row's badge, after the page refreshes).
 */
export function VerifyPanel({
  platform,
  handle,
  verification,
  onNotice,
}: {
  platform: LinkPlatform;
  handle: string;
  verification: PendingVerificationView | null;
  onNotice: (notice: ClaimNotice | null) => void;
}) {
  const guide = PLATFORM_GUIDES[platform];
  const [busy, startBusy] = useTransition();
  // Which button is running, for its label ("Verificando…", "Gerando código…").
  const [checking, startChecking] = useTransition();

  function start() {
    onNotice(null);
    startBusy(async () => {
      const result = await startVerificationAction({ platform });
      onNotice(result.ok ? null : { tone: "error", text: result.error });
    });
  }

  if (!verification) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="max-w-[52ch] text-[14px] text-muted">
          Prove que a conta é sua para ela aparecer como verificada no seu perfil. Leva um minuto: um código no
          campo &ldquo;{guide.field}&rdquo; do seu perfil {guide.name}.
        </p>
        <Button variant="ghost" disabled={busy} onClick={start}>
          {busy ? "Gerando código…" : "Verificar conta"}
        </Button>
      </div>
    );
  }

  const status = checking ? "Verificando…" : verification.failure ? "Falhou" : "Pendente";
  return (
    <section
      aria-label={`Verificar a conta ${guide.name} ${handle}`}
      aria-busy={checking}
      className={`flex flex-col gap-4 rounded-[2px] border bg-bg p-4 ${verification.failure && !checking ? "border-nin" : "border-line-2"}`}
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px] text-text-2">
        <span>
          Verificando a posse de <b className="text-text">{handle}</b>. O código vale até {verification.expiresLabel}.
        </span>
        <span
          className={`border px-2 py-0.5 font-mono text-xs tracking-[0.1em] uppercase ${
            checking ? "border-line-2 text-text-3" : verification.failure ? "border-nin text-nin" : "border-rarity-lendario text-rarity-lendario"
          }`}
        >
          <span className="sr-only">Situação: </span>
          {status}
        </span>
      </p>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        <Step n={1} title="Copie o código">
          <CopyCode code={verification.code} />
        </Step>
        <Step n={2} title={`Cole no campo "${guide.field}" do seu perfil e salve`}>
          <p className="text-[14px] text-muted">{guide.where}</p>
        </Step>
        <Step n={3} title="Volte aqui e clique em Verificar agora">
          <p className="text-[14px] text-muted">
            Lemos o seu perfil público na {guide.name}; a conta continua conectada enquanto isso. Verificada, você já
            pode apagar o código do perfil.
          </p>
        </Step>
      </ol>
      {/* Live: the reason arrives with the refreshed page after a check (and is not read out on load). */}
      <p aria-live="polite" className="text-[14px] text-nin empty:hidden">
        {verification.failure && !checking ? (
          <>
            <b>Não deu certo:</b> {verification.failure}
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy || checking}
          onClick={() => {
            onNotice(null);
            startChecking(async () => {
              const result = await checkVerificationAction({ platform });
              onNotice(
                result.ok
                  ? { tone: "ok", text: `Conta ${guide.name} ${result.handle} verificada. Você já pode apagar o código do perfil.` }
                  : // The reason of a failed read is shown in the panel (it survives a reload).
                    ["code_missing", "not_found", "different", "private", "error"].includes(result.reason)
                    ? null
                    : { tone: "error", text: result.error },
              );
            });
          }}
        >
          {checking ? "Verificando…" : "Verificar agora"}
        </Button>
        <Button variant="ghost" disabled={busy || checking} onClick={start}>
          {busy ? "Gerando código…" : "Gerar novo código"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || checking}
          onClick={() => {
            onNotice(null);
            startBusy(async () => {
              const result = await cancelVerificationAction({ platform });
              onNotice(result.ok ? null : { tone: "error", text: result.error });
            });
          }}
        >
          Cancelar
        </Button>
      </div>
    </section>
  );
}
