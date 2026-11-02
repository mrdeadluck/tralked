"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LogoutForm } from "./LogoutForm";

export type AccountUser = { handle: string; level: number; role: string; avatarUrl?: string | null };

export type AccountLink = { href: string; label: string };

const PRIVILEGED_ROLES = ["admin", "editor"];

/** Links of the account menu (besides "Sair"); Admin for admin/editor, Moderação for moderators. */
export function accountLinks(role: string): AccountLink[] {
  const links: AccountLink[] = [
    { href: "/conta", label: "Conta" },
    { href: "/conta/conexoes", label: "Conexões" },
  ];
  if (PRIVILEGED_ROLES.includes(role)) links.push({ href: "/admin", label: "Admin" });
  else if (role === "moderator") links.push({ href: "/admin/moderacao", label: "Moderação" });
  return links;
}

const LINK_CLASS =
  "flex min-h-11 items-center px-3.5 py-2 font-mono text-xs tracking-[0.08em] text-text-3 uppercase hover:bg-hover hover:text-text";

/** Disclosure menu on the avatar: closes with Escape, outside click or after navigating. */
export function AccountMenu({ user }: { user: AccountUser }) {
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
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[2px]"
      >
        {/* Phones show only the avatar; the handle and level stay for screen readers. */}
        <span className="flex flex-col items-end font-mono leading-[1.2] max-nav:sr-only">
          <small className="text-xs tracking-[0.1em] text-dim uppercase">{user.handle}</small>
          <b className="text-[13px]">NV {user.level}</b>
        </span>
        {user.avatarUrl?.startsWith("https://") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            width={40}
            height={40}
            decoding="async"
            className="size-10 flex-none rounded-full border-2 border-acc object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="size-10 flex-none rounded-full border-2 border-acc bg-[repeating-linear-gradient(135deg,#1a1c22_0_5px,#22242b_5px_10px)]"
          />
        )}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-[calc(100%+8px)] right-0 z-30 flex min-w-[200px] flex-col border border-line-2 bg-surface py-1.5"
      >
        {accountLinks(user.role).map((link) => (
          <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={LINK_CLASS}>
            {link.label}
          </Link>
        ))}
        <LogoutForm buttonClassName={`${LINK_CLASS} w-full cursor-pointer text-left`} />
      </div>
    </div>
  );
}
