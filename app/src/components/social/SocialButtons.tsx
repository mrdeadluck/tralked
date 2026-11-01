"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MailIcon } from "@/components/community/icons";
import { ReportButton } from "@/components/community/ReportButton";
import { loginHref } from "@/components/guide/format";
import { blockAction, followAction, friendAction } from "@/lib/social/actions";
import type { Relationship, SocialCounts } from "@/lib/social/relations";

type SocialButtonsProps = {
  user: { id: string; handle: string; displayName: string };
  counts: SocialCounts;
  /** Null for visitors; the owner sees only the counts. */
  relationship: Relationship | null;
  loggedIn: boolean;
  isOwner: boolean;
  /** The lists (followers, following, friends) are visible to the visitor. */
  listsVisible: boolean;
};

const BTN =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[2px] border px-4 font-mono text-[11px] font-bold tracking-[0.1em] uppercase disabled:cursor-wait disabled:opacity-60";
const PRIMARY = `${BTN} border-acc bg-acc text-bg hover:brightness-[1.08]`;
const SECONDARY = `${BTN} border-line-2 text-text hover:border-text`;
const QUIET =
  "cursor-pointer font-mono text-[11px] tracking-[0.06em] text-dim uppercase hover:text-text disabled:cursor-wait disabled:opacity-60";

const nf = (n: number) => n.toLocaleString("pt-BR");

/** Follow, friendship, message, block and report buttons of a profile, with the social counts. */
export function SocialButtons({ user, counts, relationship, loggedIn, isOwner, listsVisible }: SocialButtonsProps) {
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"unfriend" | "block" | null>(null);
  const [busy, startTransition] = useTransition();
  const base = `/jogador/${encodeURIComponent(user.handle)}/amigos`;

  function run(action: () => Promise<{ status: "ok"; message?: string } | { status: "error"; message: string }>, ok?: string) {
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      setConfirm(null);
      if (result.status === "ok") {
        const text = result.message ?? ok;
        if (text) setNotice({ tone: "ok", text });
      } else setNotice({ tone: "error", text: result.message });
    });
  }

  const countLinks: [string, number, string][] = [
    ["seguidores", counts.followers, counts.followers === 1 ? "seguidor" : "seguidores"],
    ["seguindo", counts.following, "seguindo"],
    ["amigos", counts.friends, counts.friends === 1 ? "amigo" : "amigos"],
  ];

  const r = relationship;
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Rede social" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 font-mono text-[12px] text-text-3">
        {countLinks.map(([list, value, label]) => (
          <li key={list}>
            {listsVisible ? (
              <Link href={`${base}?lista=${list}`} className="hover:text-acc">
                <b className="text-text tabular-nums">{nf(value)}</b> {label}
              </Link>
            ) : (
              <span>
                <b className="text-text tabular-nums">{nf(value)}</b> {label}
              </span>
            )}
          </li>
        ))}
      </ul>

      {!isOwner && !loggedIn ? (
        <p className="text-[14px] text-muted">
          <a href={loginHref(`/jogador/${encodeURIComponent(user.handle)}`)} className="text-acc underline underline-offset-2">
            Entre na sua conta
          </a>{" "}
          para seguir, adicionar como amigo ou mandar mensagem.
        </p>
      ) : null}

      {!isOwner && r && r.blockedBy && !r.blocked ? (
        <p className="text-[14px] text-muted">Você não pode interagir com este perfil.</p>
      ) : null}

      {!isOwner && r && !r.blockedBy && !r.blocked ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            aria-pressed={r.following}
            onClick={() => run(() => followAction({ userId: user.id, follow: !r.following }))}
            className={r.following ? SECONDARY : PRIMARY}
          >
            {r.following ? "Seguindo" : "Seguir"}
          </button>

          {r.friendship === "none" ? (
            <button type="button" disabled={busy} onClick={() => run(() => friendAction({ userId: user.id, op: "request" }))} className={SECONDARY}>
              Adicionar amigo
            </button>
          ) : r.friendship === "sent" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => friendAction({ userId: user.id, op: "cancel" }), "Pedido cancelado.")}
              className={SECONDARY}
            >
              Pedido enviado · cancelar
            </button>
          ) : r.friendship === "received" ? (
            <>
              <button type="button" disabled={busy} onClick={() => run(() => friendAction({ userId: user.id, op: "accept" }))} className={PRIMARY}>
                Aceitar amizade
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => friendAction({ userId: user.id, op: "decline" }), "Pedido recusado.")}
                className={SECONDARY}
              >
                Recusar
              </button>
            </>
          ) : confirm === "unfriend" ? (
            <span role="group" aria-label="Confirmar fim da amizade" className="flex flex-wrap items-center gap-2 text-[14px]">
              <span className="text-text-2">Desfazer a amizade? Vocês continuam se seguindo.</span>
              <button type="button" disabled={busy} onClick={() => run(() => friendAction({ userId: user.id, op: "remove" }))} className={SECONDARY}>
                Desfazer
              </button>
              <button type="button" onClick={() => setConfirm(null)} className={QUIET}>
                Manter
              </button>
            </span>
          ) : (
            <>
              <span className="inline-flex h-10 items-center gap-1.5 rounded-[2px] border border-acc px-3 font-mono text-[11px] font-bold tracking-[0.1em] text-acc uppercase">
                Amigos <span aria-hidden="true">✓</span>
              </span>
              <button type="button" onClick={() => setConfirm("unfriend")} className={QUIET}>
                Desfazer amizade
              </button>
            </>
          )}

          <Link href={`/mensagens/${encodeURIComponent(user.handle)}`} className={SECONDARY}>
            <MailIcon width={15} height={15} /> Mensagem
          </Link>
        </div>
      ) : null}

      {!isOwner && r ? (
        <div className="flex flex-wrap items-start gap-4">
          {r.blocked ? (
            <>
              <p className="text-[14px] text-muted">Você bloqueou este perfil.</p>
              <button type="button" disabled={busy} onClick={() => run(() => blockAction({ userId: user.id, block: false }), "Desbloqueado.")} className={QUIET}>
                Desbloquear
              </button>
            </>
          ) : confirm === "block" ? (
            <span role="group" aria-label="Confirmar bloqueio" className="flex flex-wrap items-center gap-2 text-[14px]">
              <span className="text-text-2">
                Bloquear @{user.handle}? Vocês deixam de se seguir, a amizade acaba e ninguém manda mensagem, responde ou menciona o outro.
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => blockAction({ userId: user.id, block: true }), "Bloqueado.")}
                className="cursor-pointer font-mono text-[11px] font-bold tracking-[0.06em] text-nin uppercase hover:underline"
              >
                Sim, bloquear
              </button>
              <button type="button" onClick={() => setConfirm(null)} className={QUIET}>
                Cancelar
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirm("block")} className={`${QUIET} pt-0.5`}>
              Bloquear
            </button>
          )}
          <ReportButton
            targetType="user"
            targetId={user.id}
            loggedIn={loggedIn}
            returnTo={`/jogador/${encodeURIComponent(user.handle)}`}
            what={`perfil de @${user.handle}`}
          />
        </div>
      ) : null}

      {notice ? (
        <p role={notice.tone === "ok" ? "status" : "alert"} className={`text-[13px] ${notice.tone === "ok" ? "text-acc" : "text-nin"}`}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
