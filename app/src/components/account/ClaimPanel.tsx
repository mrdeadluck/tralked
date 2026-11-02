"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { cancelClaimAction, confirmClaimAction, startClaimAction } from "@/lib/accounts/actions";
import { PLATFORM_GUIDES, type LinkPlatform } from "./platform-guides";

export type ClaimNotice = { tone: "ok" | "error"; text: string };

/** A claim waiting for its code; `expiresLabel` ("14:32") is formatted on the server. */
export type PendingClaimView = { handle: string; code: string; expiresLabel: string };

/**
 * "É sua? Reivindicar": the account typed in is on another profile. Starting the claim gives a
 * code to paste in the platform profile (the only place Tralked asks for proof).
 */
export function ClaimStart({
  platform,
  handle,
  onNotice,
}: {
  platform: LinkPlatform;
  handle: string;
  onNotice: (notice: ClaimNotice | null) => void;
}) {
  const [busy, startBusy] = useTransition();
  return (
    <div>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          onNotice(null);
          startBusy(async () => {
            const result = await startClaimAction({ platform, handle });
            if (!result.ok) onNotice({ tone: "error", text: result.error });
          });
        }}
      >
        {busy ? "Gerando código…" : "É sua? Reivindicar"}
      </Button>
    </div>
  );
}

/** The steps of a pending claim: copy the code, paste it in the profile, confirm. */
export function ClaimSteps({
  platform,
  claim,
  onNotice,
}: {
  platform: LinkPlatform;
  claim: PendingClaimView;
  onNotice: (notice: ClaimNotice | null) => void;
}) {
  const guide = PLATFORM_GUIDES[platform];
  const router = useRouter();
  const [busy, startBusy] = useTransition();

  function run(action: () => Promise<ClaimNotice | null>) {
    onNotice(null);
    startBusy(async () => onNotice(await action()));
  }

  return (
    <section
      aria-label={`Reivindicar a conta ${guide.name} ${claim.handle}`}
      className="flex flex-col gap-4 rounded-[2px] border border-line-2 bg-bg p-4"
    >
      <p className="text-[14.5px] text-text-2">
        Reivindicando <b className="text-text">{claim.handle}</b>. Prove que a conta é sua: o código vale até{" "}
        {claim.expiresLabel}.
      </p>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        <Step n={1} title="Copie o código">
          <CopyCode code={claim.code} />
        </Step>
        <Step n={2} title={`Cole no campo "${guide.field}" do seu perfil e salve`}>
          <p className="text-[14px] text-muted">{guide.where}</p>
        </Step>
        <Step n={3} title="Volte aqui e confirme">
          <p className="text-[14px] text-muted">
            Confirmada, a conta passa para o seu personagem como verificada e sai do outro perfil. O perfil pode
            levar alguns minutos para atualizar; se não encontrarmos o código, é só tentar de novo.
          </p>
        </Step>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await confirmClaimAction({ platform });
              if (!result.ok) return { tone: "error", text: result.error };
              // The Steam belonged to an account of the old Steam login: this session is now that
              // account's, and the page says so.
              if (result.recovered) {
                router.push("/conta/conexoes?historico=1");
                return null;
              }
              return {
                tone: "ok",
                text: `${result.handle} agora é sua (verificada). Estamos importando suas ${guide.unlocks}; você já pode apagar o código do perfil.`,
              };
            })
          }
        >
          {busy ? "Verificando…" : "Já colei o código"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await startClaimAction({ platform, handle: claim.handle });
              return result.ok
                ? { tone: "ok", text: "Novo código gerado. Troque o código antigo no perfil." }
                : { tone: "error", text: result.error };
            })
          }
        >
          Gerar novo código
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await cancelClaimAction({ platform });
              return result.ok ? null : { tone: "error", text: result.error };
            })
          }
        >
          Cancelar
        </Button>
      </div>
    </section>
  );
}

/** One numbered step of a code flow (claim, verification). */
export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-full border border-line-2 font-mono text-xs text-text-3"
      >
        {n}
      </span>
      <div className="flex flex-col gap-1.5">
        <h3 className="pt-1 text-[15px] font-semibold">
          <span className="sr-only">Passo {n}: </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

/** The code, big, with a copy button (selects it when the clipboard is blocked). */
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard blocked: select the code so the user can copy it by hand.
      const node = codeRef.current;
      if (node) window.getSelection()?.selectAllChildren(node);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code
        ref={codeRef}
        className="rounded-[2px] border border-acc bg-bg px-4 py-2 font-mono text-[22px] font-bold tracking-[0.12em] text-acc select-all"
      >
        {code}
      </code>
      <Button variant="ghost" onClick={copy}>
        {copied ? "Copiado" : "Copiar código"}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Código copiado" : ""}
      </span>
    </div>
  );
}
