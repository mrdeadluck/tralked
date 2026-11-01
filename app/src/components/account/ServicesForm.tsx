"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { saveConnectionsAction, type FieldOutcome, type SaveConnectionsState } from "@/lib/accounts/actions";
import { ClaimStart, ClaimSteps, type ClaimNotice, type PendingClaimView } from "./ClaimPanel";
import { ConnectionBadge, type ConnectionTone } from "./ConnectionShell";
import { PLATFORM_GUIDES, type LinkPlatform } from "./platform-guides";

export type ServiceRowState =
  /** No credential for the platform on this server (production): the field is disabled. */
  | { kind: "unavailable"; handle: string | null }
  | { kind: "disconnected"; claim: PendingClaimView | null }
  | {
      kind: "connected";
      handle: string;
      /** The field's saved value (Steam: the SteamID64). */
      saved: string;
      verified: boolean;
      lastSyncedLabel: string | null;
      importing: boolean;
      failed: boolean;
    };

export type ServiceRow = { platform: LinkPlatform; state: ServiceRowState };

/** A field whose save would remove the XP of a connected account (asked in the dialog first). */
type RiskyChange = { platform: LinkPlatform; kind: "unlink" | "replace"; from: string; to: string };

const INITIAL: SaveConnectionsState = { version: 0, fields: {}, error: null };

/** How often the form asks the server for news while an import runs. */
const IMPORT_POLL_MS = 5000;

const PLATFORM_COLOR: Record<LinkPlatform, string> = {
  steam: "var(--pc)",
  psn: "var(--ps)",
  xbox: "var(--xbox)",
  retro: "var(--r-epico)",
};

const INPUT =
  "h-11 w-full min-w-0 rounded-[2px] border bg-bg px-3 text-[16px] text-text placeholder:text-dim focus:border-text disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-nin";

const DANGER =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-[2px] border border-nin bg-nin px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]";

function badge(state: ServiceRowState): { status: string; tone: ConnectionTone } {
  switch (state.kind) {
    case "unavailable":
      return { status: "Em breve", tone: "off" };
    case "disconnected":
      return state.claim ? { status: "Reivindicação pendente", tone: "wait" } : { status: "Não conectada", tone: "off" };
    case "connected":
      if (state.failed) return { status: "Erro na importação", tone: "error" };
      return state.verified ? { status: "Verificada", tone: "on" } : { status: "Não verificada", tone: "wait" };
  }
}

const savedValue = (state: ServiceRowState) => (state.kind === "connected" ? state.saved : "");

/**
 * The "Serviços" form of /conta/conexoes (Exophase model): one field per platform and one "Salvar
 * alterações". Each field is linked at once when saved (no code), with its own result under it.
 * Clearing a connected field, or typing another account in it, removes the XP that came from the
 * account, so a dialog asks first: before sending for a cleared field, and after the server found
 * the new account for a replacement (then the same submission goes again, confirmed). Without
 * JavaScript the form still posts; the server answers with a confirmation step (a submit button
 * carrying `confirmar`) instead of disconnecting. A connected platform shown as "Em breve" keeps a
 * "Desconectar…" button (`desconectar`), asked the same way.
 */
export function ServicesForm({ rows }: { rows: ServiceRow[] }) {
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  /** A submission held while the dialog asks about clearing fields. */
  const queued = useRef<FormData | null>(null);
  /** The last submission sent, sent again when the server asks to confirm a replacement. */
  const lastSent = useRef<FormData | null>(null);
  const [cleared, setCleared] = useState<RiskyChange[]>([]);
  const [state, formAction, pending] = useActionState(saveConnectionsAction, INITIAL);

  // A replacement is only asked about once the server found the new account (and it is free).
  const replacements = rows.flatMap<RiskyChange>(({ platform, state: row }) => {
    const outcome = state.fields[platform];
    return row.kind === "connected" && outcome?.confirm === "replace"
      ? [{ platform, kind: "replace", from: row.handle, to: outcome.typed ?? "" }]
      : [];
  });
  const risky = cleared.length > 0 ? cleared : replacements;
  // Every change the server is waiting to see confirmed (also rendered as a step without JavaScript).
  const toConfirm = rows.flatMap(({ platform, state: row }) => {
    const outcome = state.fields[platform];
    return outcome?.confirm ? [{ platform, kind: outcome.confirm, unavailable: row.kind === "unavailable" }] : [];
  });

  // Imports run in the background: refresh until no row reports "importing" (the state itself
  // ends after IMPORT_GRACE_MS, so this never polls forever).
  const importing = rows.some((r) => r.state.kind === "connected" && r.state.importing);
  useEffect(() => {
    if (!importing) return;
    const timer = setInterval(() => router.refresh(), IMPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [importing, router]);

  // After an answer, focus the first field that was refused (or the form-level message); when the
  // server asks to confirm a replacement, the dialog opens on top.
  useEffect(() => {
    if (state.version === 0) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const target = invalid ?? (state.error ? document.getElementById(`${id}-summary`) : null);
    target?.focus();
    const dialog = dialogRef.current;
    if (lastSent.current && Object.values(state.fields).some((o) => o.confirm === "replace") && !dialog?.open) {
      dialog?.showModal();
    }
  }, [state, id]);

  function submit(data: FormData) {
    lastSent.current = data;
    startTransition(() => formAction(data));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    // The confirmation step's own button already carries the confirmation.
    if (submitter?.getAttribute("name") === "confirmar") return submit(data);
    const disconnect = new Set(data.getAll("desconectar"));
    const clears = rows.flatMap<RiskyChange>(({ platform, state: row }) => {
      if (row.kind === "connected" && data.has(platform) && String(data.get(platform)).trim() === "") {
        return [{ platform, kind: "unlink", from: row.handle, to: "" }];
      }
      // A connected platform shown as "Em breve" (field disabled) is disconnected by its button.
      if (row.kind === "unavailable" && row.handle && disconnect.has(platform)) {
        return [{ platform, kind: "unlink", from: row.handle, to: "" }];
      }
      return [];
    });
    if (clears.length === 0) return submit(data);
    queued.current = data;
    setCleared(clears);
    dialogRef.current?.showModal();
  }

  function confirmRisky() {
    const source = cleared.length > 0 ? queued.current : lastSent.current;
    const listed = risky;
    queued.current = null;
    dialogRef.current?.close();
    if (!source) return;
    const data = new FormData();
    for (const [key, value] of source.entries()) data.append(key, value);
    const already = new Set(data.getAll("confirmar"));
    for (const change of listed) if (!already.has(change.platform)) data.append("confirmar", change.platform);
    submit(data);
  }

  const outcomes = Object.values(state.fields);
  const refused = outcomes.some((o) => o.tone === "error");
  const summary = state.error
    ? state.error
    : state.version === 0
      ? ""
      : outcomes.length === 0
        ? "Nada mudou."
        : refused
          ? "Algumas alterações não foram salvas: confira as mensagens abaixo de cada serviço."
          : "Alterações salvas.";

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${id}-title`}
      className="rounded-[4px] border border-line bg-surface"
    >
      <header className="flex flex-col gap-1.5 border-b border-line px-5 py-4">
        <h2 id={`${id}-title`} className="text-[19px] leading-none font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          Serviços
        </h2>
        <p className="max-w-[64ch] text-[14.5px] text-text-2">
          Informe o seu perfil em cada serviço e salve: a conexão vale na hora e a importação começa em seguida.
          Deixe um campo vazio para desconectar.
        </p>
      </header>

      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <ServiceField
            key={row.platform}
            formId={id}
            row={row}
            outcome={state.fields[row.platform]}
            version={state.version}
          />
        ))}
      </ul>

      {toConfirm.length > 0 && !pending ? (
        <div
          role="group"
          aria-labelledby={`${id}-confirm-step`}
          className="flex flex-col gap-3 border-t border-nin px-5 py-4"
        >
          <p id={`${id}-confirm-step`} className="text-[14.5px] text-text-2">
            <b className="text-text">Confirme antes de salvar:</b>{" "}
            {toConfirm
              .map((c) => `${c.kind === "unlink" ? "desconectar" : "trocar a conta"} ${PLATFORM_GUIDES[c.platform].name}`)
              .join(", ")}
            . O XP vindo dessas contas é anulado e as conquistas importadas delas saem do seu personagem.
          </p>
          {toConfirm
            .filter((c) => c.unavailable && c.kind === "unlink")
            .map((c) => (
              <input key={c.platform} type="hidden" name="desconectar" value={c.platform} />
            ))}
          <div>
            <button type="submit" name="confirmar" value={toConfirm.map((c) => c.platform).join(",")} className={DANGER}>
              Confirmar e salvar
            </button>
          </div>
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-5 py-4">
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar alterações"}
        </Button>
        <p
          id={`${id}-summary`}
          tabIndex={-1}
          aria-live="polite"
          className={`text-[14.5px] empty:hidden ${state.error || refused ? "text-nin" : "text-acc"}`}
        >
          {pending ? "" : summary}
        </p>
      </footer>

      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-confirm-title`}
        aria-describedby={`${id}-confirm-body`}
        onClose={() => {
          queued.current = null;
          setCleared([]);
        }}
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[4px] border border-nin bg-surface p-0 text-text backdrop:bg-bg/80"
      >
        <div className="flex flex-col gap-4 p-5">
          <h2 id={`${id}-confirm-title`} className="text-[19px] leading-tight font-black font-stretch-[125%] uppercase">
            {risky.length === 1 && risky[0].kind === "unlink"
              ? `Desconectar ${PLATFORM_GUIDES[risky[0].platform].name}?`
              : "Confirmar as alterações?"}
          </h2>
          <div id={`${id}-confirm-body`} className="flex flex-col gap-2 text-[14.5px] text-text-2">
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
              {risky.map((change) => (
                <li key={change.platform}>
                  {change.kind === "unlink" ? (
                    <>
                      Desconectar <b className="text-text">{PLATFORM_GUIDES[change.platform].name}</b> ({change.from})
                    </>
                  ) : (
                    <>
                      Trocar a conta <b className="text-text">{PLATFORM_GUIDES[change.platform].name}</b> {change.from} por{" "}
                      {change.to}
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p>
              O XP vindo dessa conta é anulado e as conquistas importadas dela saem do seu personagem. Você pode
              conectar de novo depois.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmRisky} className={DANGER}>
              {risky.some((c) => c.kind === "unlink") ? "Desconectar e salvar" : "Trocar e salvar"}
            </button>
            {/* Escape also closes the dialog; focus returns to "Salvar alterações". */}
            <Button variant="ghost" autoFocus onClick={() => dialogRef.current?.close()}>
              Cancelar
            </Button>
          </div>
        </div>
      </dialog>
    </form>
  );
}

function ServiceField({
  formId,
  row,
  outcome,
  version,
}: {
  formId: string;
  row: ServiceRow;
  outcome: FieldOutcome | undefined;
  version: number;
}) {
  const { platform, state } = row;
  const guide = PLATFORM_GUIDES[platform];
  const [notice, setNotice] = useState<ClaimNotice | null>(null);
  const inputId = `${formId}-${platform}`;
  const claim = state.kind === "disconnected" ? state.claim : null;
  // A pending claim supersedes the answer of the save that led to it.
  const shown = claim ? undefined : outcome;
  const invalid = shown?.tone === "error";
  const saved = savedValue(state);
  const { status, tone } = badge(state);

  const describedBy = [`${inputId}-status`, shown ? `${inputId}-outcome` : null, `${inputId}-hint`]
    .filter(Boolean)
    .join(" ");

  return (
    <li className="grid gap-x-6 gap-y-2.5 border-b border-line px-5 py-5 last:border-b-0 min-[761px]:grid-cols-[250px_minmax(0,1fr)]">
      <div className="flex items-center gap-3 min-[761px]:h-11">
        <span aria-hidden="true" className="size-2.5 flex-none" style={{ background: PLATFORM_COLOR[platform] }} />
        <label
          htmlFor={inputId}
          className="text-[15px] leading-tight font-black font-stretch-[125%] tracking-[-0.01em] uppercase"
        >
          {guide.name}
        </label>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <input
            // Remounted after each save (and when the saved account changes) with the new value.
            key={`${version}:${saved}`}
            id={inputId}
            name={platform}
            defaultValue={shown?.typed ?? claim?.handle ?? (state.kind === "unavailable" ? (state.handle ?? "") : saved)}
            disabled={state.kind === "unavailable"}
            maxLength={guide.maxLength}
            placeholder={state.kind === "unavailable" ? "Em breve" : guide.placeholder}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            className={`${INPUT} max-w-[440px] flex-[1_1_260px] ${invalid ? "border-nin" : "border-line-2"}`}
          />
          <ConnectionBadge status={status} tone={tone} />
        </div>

        <p id={`${inputId}-status`} className={`text-[14px] ${state.kind === "connected" && state.failed ? "text-nin" : "text-muted"}`}>
          <StatusLine platform={platform} state={state} />
        </p>
        {shown ? (
          <p id={`${inputId}-outcome`} className={`text-[14px] ${shown.tone === "error" ? "text-nin" : "text-acc"}`}>
            {shown.message}
            {shown.privacyHelp ? (
              <>
                {" "}
                <PrivacyHelpLink />
              </>
            ) : null}
          </p>
        ) : null}
        <p id={`${inputId}-hint`} className="text-[13px] text-dim">
          {guide.hint}
        </p>

        {state.kind === "unavailable" && state.handle ? (
          <div>
            <Button variant="ghost" type="submit" name="desconectar" value={platform}>
              Desconectar…
            </Button>
          </div>
        ) : null}
        {shown?.claimable && shown.typed ? <ClaimStart platform={platform} handle={shown.typed} onNotice={setNotice} /> : null}
        {claim ? <ClaimSteps platform={platform} claim={claim} onNotice={setNotice} /> : null}
        <p aria-live="polite" className="text-sm empty:hidden">
          {notice ? (
            <span role={notice.tone === "error" ? "alert" : undefined} className={notice.tone === "error" ? "text-nin" : "text-acc"}>
              {notice.text}
            </span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function StatusLine({ platform, state }: { platform: LinkPlatform; state: ServiceRowState }) {
  const guide = PLATFORM_GUIDES[platform];
  switch (state.kind) {
    case "unavailable":
      return state.handle
        ? `Conectada como ${state.handle}. A sincronização da ${guide.name} volta em breve.`
        : `A conexão com a ${guide.name} chega em breve.`;
    case "disconnected":
      return state.claim ? "Aguardando o código no perfil." : "Não conectada.";
    case "connected": {
      const who = `Conectada como ${state.handle}${state.verified ? " · verificada" : " · não verificada"}.`;
      if (state.failed) {
        return (
          <>
            {who} A última importação não terminou: confira se o perfil está público. <PrivacyHelpLink />
          </>
        );
      }
      if (state.importing) return `${who} Importando suas ${guide.unlocks}… isso pode levar alguns minutos.`;
      return `${who} ${state.lastSyncedLabel ? `Última sincronização: ${state.lastSyncedLabel}.` : "Ainda não sincronizada."}`;
    }
  }
}

function PrivacyHelpLink() {
  return (
    <a href="#ajuda-privacidade" className="font-semibold text-text underline underline-offset-4 hover:no-underline">
      Como deixar o perfil público
    </a>
  );
}
