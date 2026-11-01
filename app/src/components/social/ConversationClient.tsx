"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ReportButton } from "@/components/community/ReportButton";
import { TextComposer } from "@/components/community/TextComposer";
import { UserText } from "@/components/community/UserText";
import { formatWhen } from "@/lib/community/format";
import { blockAction, sendMessageAction } from "@/lib/social/actions";
import { MESSAGE_MAX, type MessageView } from "@/lib/social/types";

/** How often an open conversation asks the server for new messages (no real-time channel). */
const POLL_MS = 15_000;

type ConversationClientProps = {
  other: { id: string; handle: string };
  messages: MessageView[];
  /** The latest page: polls and takes new messages. */
  live: boolean;
  canSend: boolean;
  cannotSendReason: string | null;
  /** The viewer blocked the other user. */
  blocked: boolean;
};

/** A private conversation: messages, composer, block and report. Refreshes itself while visible. */
export function ConversationClient({ other, messages, live, canSend, cannotSendReason, blocked }: ConversationClientProps) {
  const router = useRouter();
  const [list, setList] = useState(messages);
  // Fresh server data (polling, navigation) replaces the local copy.
  const [server, setServer] = useState(messages);
  if (server !== messages) {
    setServer(messages);
    setList(messages);
  }
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, router]);

  async function send(body: string) {
    const result = await sendMessageAction({ to: other.id, body });
    if (result.status !== "ok") return result.message;
    setList((current) => [...current, result.message]);
    return null;
  }

  function block(on: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await blockAction({ userId: other.id, block: on });
      if (result.status !== "ok") setError(result.message);
      setConfirmBlock(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {list.length === 0 ? (
        <p className="text-[15px] text-muted">Nenhuma mensagem ainda. Diga oi para @{other.handle}.</p>
      ) : (
        <ol aria-label={`Mensagens com @${other.handle}`} aria-live="polite" className="m-0 flex list-none flex-col gap-3 p-0">
          {list.map((m) => (
            <li key={m.id} className={`flex flex-col gap-1 ${m.mine ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[min(560px,88%)] rounded-[4px] border px-4 py-2.5 ${
                  m.mine ? "border-acc/50 bg-acc/[0.08]" : "border-line bg-surface"
                }`}
              >
                <span className="sr-only">{m.mine ? "Você" : m.senderHandle ? `@${m.senderHandle}` : "Conta removida"}: </span>
                <UserText text={m.body} className="text-[15px] leading-relaxed text-text" />
              </div>
              <span className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-dim">
                <time dateTime={new Date(m.createdAt).toISOString()}>{formatWhen(m.createdAt, true)}</time>
                {!m.mine && m.senderHandle ? (
                  <ReportButton
                    targetType="message"
                    targetId={m.id}
                    loggedIn
                    returnTo={`/mensagens/${encodeURIComponent(other.handle)}`}
                    what={`mensagem de @${m.senderHandle}`}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}

      {live && canSend ? (
        <TextComposer label={`Mensagem para @${other.handle}`} placeholder="Escreva sua mensagem" submitLabel="Enviar" maxLength={MESSAGE_MAX} rows={3} onSubmit={send} />
      ) : live && cannotSendReason ? (
        <p className="rounded-[4px] border border-line bg-surface px-4 py-3.5 text-[15px] text-muted">{cannotSendReason}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-[14px]">
        {blocked ? (
          <>
            <span className="text-text-2">Você bloqueou @{other.handle}.</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => block(false)}
              className="cursor-pointer font-mono text-[11px] tracking-[0.06em] text-dim uppercase hover:text-text"
            >
              Desbloquear
            </button>
          </>
        ) : confirmBlock ? (
          <span role="group" aria-label="Confirmar bloqueio" className="flex flex-wrap items-center gap-3">
            <span className="text-text-2">Bloquear @{other.handle}? Ninguém manda mensagem para o outro, e vocês deixam de se seguir.</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => block(true)}
              className="cursor-pointer font-mono text-[11px] font-bold tracking-[0.06em] text-nin uppercase hover:underline"
            >
              Sim, bloquear
            </button>
            <button
              type="button"
              onClick={() => setConfirmBlock(false)}
              className="cursor-pointer font-mono text-[11px] tracking-[0.06em] text-dim uppercase hover:text-text"
            >
              Cancelar
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmBlock(true)}
            className="cursor-pointer font-mono text-[11px] tracking-[0.06em] text-dim uppercase hover:text-text"
          >
            Bloquear @{other.handle}
          </button>
        )}
        {error ? (
          <p role="alert" className="w-full text-[13px] text-nin">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
