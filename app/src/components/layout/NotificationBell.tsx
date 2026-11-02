"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { markAllReadAction, markReadAction } from "@/lib/notifications/actions";
import { NotificationKindIcon } from "./NotificationKindIcon";

export type BellItem = {
  id: string;
  /** Notification.kind: picks the icon (level_up, like, rank_passed…). */
  kind?: string;
  title: string;
  body: string | null;
  /** Same-site path, or null when the notification has no link. */
  href: string | null;
  read: boolean;
  /** "há 2 horas", computed on the server. */
  when: string;
};

export type BellProps = { unread: number; items: BellItem[] };

function BellIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.6 6.6 2.4 7.4.3.3.1.8-.3.8H3.9c-.4 0-.6-.5-.3-.8C4.4 15.6 6 13.5 6 9Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

const countLabel = (n: number) => (n > 99 ? "99+" : String(n));

/**
 * Header bell (dynamic island: rendered with the session): unread count, a disclosure panel with
 * the latest notifications, "marcar todas como lidas" and a link to /notificacoes.
 */
export function NotificationBell({ unread: serverUnread, items: serverItems }: BellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(serverItems);
  const [unread, setUnread] = useState(serverUnread);
  // Fresh server data (navigation, router.refresh() after "marcar todas" on /notificacoes)
  // replaces the local copy; the local copy only carries optimistic marks in between.
  const [server, setServer] = useState({ unread: serverUnread, items: serverItems });
  if (server.unread !== serverUnread || server.items !== serverItems) {
    setServer({ unread: serverUnread, items: serverItems });
    setItems(serverItems);
    setUnread(serverUnread);
  }
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function markAll() {
    setError(null);
    startTransition(async () => {
      const result = await markAllReadAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems((list) => list.map((n) => ({ ...n, read: true })));
      setUnread(0);
      // Other views of the same data (/notificacoes) re-render from the server.
      router.refresh();
    });
  }

  function openItem(item: BellItem) {
    setOpen(false);
    if (item.read) return;
    setItems((list) => list.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - 1));
    // Fire and forget: navigation continues even if the mark fails.
    void markReadAction(item.id);
  }

  const label = unread > 0 ? `Notificações, ${unread} não ${unread === 1 ? "lida" : "lidas"}` : "Notificações";

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="relative grid size-11 cursor-pointer place-items-center rounded-[2px] border border-line-2 bg-surface-2 text-text-3 hover:border-acc hover:text-text"
      >
        <BellIcon />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-acc px-1 font-mono text-xs font-bold text-bg tabular-nums"
          >
            {countLabel(unread)}
          </span>
        ) : null}
      </button>
      <div
        id={panelId}
        hidden={!open}
        role="region"
        aria-labelledby={titleId}
        className="absolute top-[calc(100%+8px)] right-0 z-30 flex w-[min(380px,calc(100vw-40px))] flex-col border border-line-2 bg-surface shadow-[0_18px_40px_-12px_rgb(0_0_0/0.7)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="font-mono text-xs tracking-[0.12em] text-dim uppercase">
            Notificações
          </h2>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAll}
              disabled={pending}
              className="min-h-8 cursor-pointer font-mono text-xs tracking-[0.06em] text-acc hover:underline hover:underline-offset-3 disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Marcando…" : "Marcar todas como lidas"}
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="px-4 pt-3 text-[13px] text-nin">
            {error}
          </p>
        ) : null}
        {items.length === 0 ? (
          <p className="px-4 py-6 text-[14px] text-muted">
            Nada por aqui ainda. Respostas, curtidas, missões, subidas de nível e quem te passou no ranking aparecem neste sino.
          </p>
        ) : (
          <ul className="m-0 max-h-[min(440px,70vh)] list-none overflow-y-auto p-0">
            {items.map((item) => {
              const content = (
                <>
                  <span className="flex items-start gap-3">
                    <span className="relative mt-0.5 flex-none">
                      <NotificationKindIcon kind={item.kind ?? "system"} size={30} dim={item.read} />
                      {item.read ? null : (
                        <span
                          aria-hidden="true"
                          className="absolute -top-1 -right-1 size-2 rounded-full bg-acc ring-2 ring-surface"
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={`text-[14px] leading-snug ${item.read ? "text-text-3" : "font-bold text-text"}`}>
                        {item.title}
                        {item.read ? null : <span className="sr-only"> (não lida)</span>}
                      </span>
                      {item.body ? <span className="line-clamp-2 text-[13px] text-muted">{item.body}</span> : null}
                      <span className="font-mono text-xs text-dim">{item.when}</span>
                    </span>
                  </span>
                </>
              );
              return (
                <li key={item.id} className="border-b border-divider last:border-b-0">
                  {item.href ? (
                    <Link href={item.href} onClick={() => openItem(item)} className="block px-4 py-3 hover:bg-hover">
                      {content}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/notificacoes"
          onClick={() => setOpen(false)}
          className="flex min-h-11 items-center justify-center border-t border-line font-mono text-xs tracking-[0.1em] text-text-3 uppercase hover:bg-hover hover:text-text"
        >
          Ver todas
        </Link>
      </div>
    </div>
  );
}
