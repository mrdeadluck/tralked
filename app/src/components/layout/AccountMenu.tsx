"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LogoutForm } from "./LogoutForm";

export type AccountUser = { handle: string; level: number; role: string };

export type AccountLink = { href: string; label: string };

const PRIVILEGED_ROLES = ["admin", "editor"];

/** Links of the account menu (besides "Sair"); Admin only for admin/editor. */
export function accountLinks(role: string): AccountLink[] {
  const links: AccountLink[] = [
    { href: "/feed", label: "Feed" },
    { href: "/mensagens", label: "Mensagens" },
    { href: "/conta", label: "Conta" },
    { href: "/conta/conexoes", label: "Conexões" },
  ];
  if (PRIVILEGED_ROLES.includes(role)) links.push({ href: "/admin", label: "Admin" });
  return links;
}

const LINK_CLASS =
  "flex min-h-11 items-center px-3.5 py-2 font-mono text-xs tracking-[0.08em] text-text-3 uppercase hover:bg-hover hover:text-text";

/** Disclosure menu on the avatar: closes with Escape, outside click or after navigating. */
export function AccountMenu({ user, unreadMessages = 0 }: { user: AccountUser; unreadMessages?: number }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Conta"
      className="relative max-nav:hidden"
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
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-2.5"
      >
        <span className="flex flex-col items-end font-mono leading-[1.2]">
          <small className="text-[10px] tracking-[0.1em] text-dim uppercase">{user.handle}</small>
          <b className="text-[13px]">NV {user.level}</b>
        </span>
        <span className="relative flex-none">
          <span
            aria-hidden="true"
            className="block size-10 rounded-full border-2 border-acc bg-[repeating-linear-gradient(135deg,#1a1c22_0_5px,#22242b_5px_10px)]"
          />
          {unreadMessages > 0 ? (
            // The desktop header has no envelope (see MessagesLink): the avatar carries the count.
            <span className="absolute -top-1 -right-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-acc px-1 font-mono text-[10px] font-bold text-bg tabular-nums">
              {unreadMessages > 99 ? "99+" : unreadMessages}
              <span className="sr-only"> {unreadMessages === 1 ? "conversa não lida" : "conversas não lidas"}</span>
            </span>
          ) : null}
        </span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-[calc(100%+8px)] right-0 z-30 flex min-w-[200px] flex-col border border-line-2 bg-surface py-1.5"
      >
        {accountLinks(user.role).map((link) => (
          <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={LINK_CLASS}>
            {link.label}
            {link.href === "/mensagens" && unreadMessages > 0 ? (
              <span className="ml-2 rounded-full bg-acc px-1.5 font-bold text-bg tabular-nums">
                {unreadMessages}
                <span className="sr-only"> não lidas</span>
              </span>
            ) : null}
          </Link>
        ))}
        <LogoutForm buttonClassName={`${LINK_CLASS} w-full cursor-pointer text-left`} />
      </div>
    </div>
  );
}
