"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import {
  confirmLinkAction,
  startLinkAction,
  syncLinkedAccountAction,
  unlinkAction,
} from "@/lib/accounts/actions";
import { ConnectionShell, type ConnectionTone } from "./ConnectionShell";
import { PLATFORM_GUIDES, type CodePlatform } from "./platform-guides";

export type ConnectionCardState =
  | { kind: "disconnected"; expiredHandle: string | null }
  | { kind: "pending"; handle: string; code: string; /** "14:32", formatted on the server. */ expiresLabel: string }
  | {
      kind: "connected";
      handle: string;
      lastSyncedLabel: string | null;
      importing: boolean;
      failed: boolean;
    };

type Notice = { tone: "ok" | "error"; text: string };

/** How often a card with an import in progress asks the server for the new state. */
const IMPORT_POLL_MS = 5000;

const PLATFORM_COLOR: Record<CodePlatform, string> = {
  psn: "var(--ps)",
  xbox: "var(--xbox)",
  retro: "var(--r-epico)",
};

function badge(state: ConnectionCardState): { status: string; tone: ConnectionTone } {
  switch (state.kind) {
    case "disconnected":
      return state.expiredHandle
        ? { status: "Código expirado", tone: "wait" }
        : { status: "Não conectada", tone: "off" };
    case "pending":
      return { status: "Aguardando código", tone: "wait" };
    case "connected":
      return state.failed ? { status: "Erro na importação", tone: "error" } : { status: "Conectada", tone: "on" };
  }
}

const INPUT =
  "h-11 w-full max-w-[320px] rounded-[2px] border border-line-2 bg-bg px-3 text-[16px] text-text focus:border-text";

/**
 * PSN / Xbox / RetroAchievements card: link with a code pasted in the platform profile
 * (Exophase model), confirm, sync now and unlink with an inline confirmation.
 */
export function ConnectionCard({ platform, state }: { platform: CodePlatform; state: ConnectionCardState }) {
  const guide = PLATFORM_GUIDES[platform];
  const router = useRouter();
  const id = useId();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, startBusy] = useTransition();
  const { status, tone } = badge(state);

  function run(action: () => Promise<Notice | null>) {
    setNotice(null);
    startBusy(async () => {
      const result = await action();
      setNotice(result);
      router.refresh();
    });
  }

  return (
    <ConnectionShell id={id} name={guide.name} color={PLATFORM_COLOR[platform]} status={status} tone={tone}>
      {state.kind === "disconnected" ? (
        <StartForm
          id={id}
          platform={platform}
          defaultHandle={state.expiredHandle ?? ""}
          expired={state.expiredHandle !== null}
          busy={busy}
          onStart={(handle) =>
            run(async () => {
              const result = await startLinkAction({ platform, handle });
              return result.ok ? null : { tone: "error", text: result.error };
            })
          }
        />
      ) : null}

      {state.kind === "pending" ? (
        <PendingSteps
          platform={platform}
          state={state}
          busy={busy}
          onConfirm={() =>
            run(async () => {
              const result = await confirmLinkAction({ platform });
              return result.ok
                ? { tone: "ok", text: `${result.handle} conectada. Estamos importando seus troféus; você já pode apagar o código do perfil.` }
                : { tone: "error", text: result.error };
            })
          }
          onNewCode={() =>
            run(async () => {
              const result = await startLinkAction({ platform, handle: state.handle });
              return result.ok
                ? { tone: "ok", text: "Novo código gerado. Troque o código antigo no perfil." }
                : { tone: "error", text: result.error };
            })
          }
          onCancel={() =>
            run(async () => {
              const result = await unlinkAction({ platform });
              return result.ok ? null : { tone: "error", text: result.error };
            })
          }
        />
      ) : null}

      {state.kind === "connected" ? (
        <Connected
          platform={platform}
          state={state}
          busy={busy}
          onSync={() =>
            run(async () => {
              const result = await syncLinkedAccountAction({ platform });
              if (!result.ok) return { tone: "error", text: result.error };
              // The import runs in the background: after the refresh the card shows "Importando…"
              // and keeps refreshing until it ends.
              return { tone: "ok", text: `${result.message}. As conquistas novas aparecem aqui em instantes.` };
            })
          }
          onUnlink={() =>
            run(async () => {
              const result = await unlinkAction({ platform });
              return result.ok
                ? { tone: "ok", text: `${guide.name} desconectada.` }
                : { tone: "error", text: result.error };
            })
          }
        />
      ) : null}

      <p aria-live="polite" className="-mt-4 text-sm [&:not(:empty)]:mt-0">
        {notice ? (
          <span role={notice.tone === "error" ? "alert" : undefined} className={notice.tone === "error" ? "text-nin" : "text-acc"}>
            {notice.text}
          </span>
        ) : null}
      </p>
    </ConnectionShell>
  );
}

function StartForm({
  id,
  platform,
  defaultHandle,
  expired,
  busy,
  onStart,
}: {
  id: string;
  platform: CodePlatform;
  defaultHandle: string;
  expired: boolean;
  busy: boolean;
  onStart: (handle: string) => void;
}) {
  const guide = PLATFORM_GUIDES[platform];
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onStart(String(new FormData(event.currentTarget).get("handle") ?? ""));
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="max-w-[62ch] text-[14.5px] text-text-2">
        {expired
          ? "O código anterior expirou antes da verificação. Gere um novo e cole no perfil."
          : `Você cola um código temporário no campo "${guide.field}" do seu perfil ${guide.name} e a gente confere. Sem senha, sem login na ${guide.name}.`}
      </p>
      <label htmlFor={`${id}-handle`} className="flex flex-col gap-1.5 text-sm font-semibold">
        {guide.handleLabel}
        <input
          id={`${id}-handle`}
          name="handle"
          required
          maxLength={40}
          defaultValue={defaultHandle}
          placeholder={guide.placeholder}
          autoComplete="off"
          spellCheck={false}
          className={`${INPUT} font-normal`}
        />
      </label>
      <div>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Gerando…" : "Gerar código"}
        </Button>
      </div>
    </form>
  );
}

function PendingSteps({
  platform,
  state,
  busy,
  onConfirm,
  onNewCode,
  onCancel,
}: {
  platform: CodePlatform;
  state: Extract<ConnectionCardState, { kind: "pending" }>;
  busy: boolean;
  onConfirm: () => void;
  onNewCode: () => void;
  onCancel: () => void;
}) {
  const guide = PLATFORM_GUIDES[platform];
  return (
    <>
      <p className="text-[14.5px] text-text-2">
        Conectando <b className="text-text">{state.handle}</b>. O código vale até {state.expiresLabel}.
      </p>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        <Step n={1} title="Copie o código">
          <CopyCode code={state.code} />
        </Step>
        <Step n={2} title={`Cole no campo "${guide.field}" do seu perfil e salve`}>
          <p className="text-[14px] text-muted">{guide.where}</p>
          <p className="text-[14px] text-muted">{guide.privacy}</p>
        </Step>
        <Step n={3} title="Volte aqui e confirme">
          <p className="text-[14px] text-muted">
            O perfil pode levar alguns minutos para atualizar. Se não encontrarmos o código, é só tentar de novo.
          </p>
        </Step>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onConfirm} disabled={busy}>
          {busy ? "Verificando…" : "Já colei o código"}
        </Button>
        <Button variant="ghost" onClick={onNewCode} disabled={busy}>
          Gerar novo código
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
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

function CopyCode({ code }: { code: string }) {
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

function Connected({
  platform,
  state,
  busy,
  onSync,
  onUnlink,
}: {
  platform: CodePlatform;
  state: Extract<ConnectionCardState, { kind: "connected" }>;
  busy: boolean;
  onSync: () => void;
  onUnlink: () => void;
}) {
  const guide = PLATFORM_GUIDES[platform];
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Imports run in the background: refresh until the server stops reporting "importing" (the
  // state itself ends after IMPORT_GRACE_MS, so this never polls forever).
  useEffect(() => {
    if (!state.importing) return;
    const timer = setInterval(() => router.refresh(), IMPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [state.importing, router]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (confirming) panelRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  const syncLine = state.failed
    ? `A última importação não terminou. Confira se o perfil está público. ${guide.privacy}`
    : state.importing
      ? "Importando seus troféus… isso pode levar alguns minutos."
      : state.lastSyncedLabel
        ? `Última sincronização: ${state.lastSyncedLabel}.`
        : "Ainda não sincronizada.";

  return (
    <>
      <dl className="m-0 grid gap-x-6 gap-y-1 text-[14.5px] min-[641px]:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted">{guide.handleLabel}</dt>
        <dd className="m-0 font-semibold break-words">{state.handle}</dd>
      </dl>
      <p className={`text-[14px] ${state.failed ? "text-nin" : "text-muted"}`}>{syncLine}</p>

      {confirming ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-label={`Confirmar desconexão da ${guide.name}`}
          className="flex flex-col gap-3 rounded-[2px] border border-nin p-4"
        >
          <p className="text-[14.5px] text-text-2">
            Desconectar remove do seu personagem as conquistas e o XP importados da {guide.name}. Você pode
            conectar de novo depois, com um novo código.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onUnlink}
              disabled={busy}
              className="inline-flex h-11 cursor-pointer items-center justify-center rounded-[2px] border border-nin bg-nin px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? "Desconectando…" : "Desconectar"}
            </button>
            <Button
              variant="ghost"
              onClick={() => {
                restoreFocus.current = true;
                setConfirming(false);
              }}
            >
              Manter conectada
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onSync} disabled={busy || state.importing}>
            {busy ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
          <Button ref={triggerRef} variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
            Desconectar…
          </Button>
        </div>
      )}
    </>
  );
}
