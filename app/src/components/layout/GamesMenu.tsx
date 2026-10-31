"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { GAME_MENU_ALL, GAME_MENU_OPTIONS } from "./game-menu";
import { NavLink } from "./NavLink";

/*
 * "Jogos" in the header: the link to the catalog plus a disclosure button that shows the catalog
 * by platform (Steam / PC first). It opens on mouse hover and when the link gets keyboard focus;
 * the button toggles it (touch, or to close it); Esc closes it and returns focus to the button;
 * tabbing out closes it. The panel follows the button in the DOM, so Tab walks into its links.
 * Without JS the link still goes to the catalog.
 */

const CLOSE_DELAY_MS = 160;

export function GamesMenu({
  href,
  label,
  current,
  linkClassName,
}: {
  href: string;
  label: string;
  current: boolean;
  linkClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const group = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef(0);
  /** A focus that follows a pointer press is a click, not keyboard navigation. */
  const pressing = useRef(false);

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancelClose();
    setOpen(true);
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const onBlur = (e: FocusEvent) => {
    if (!group.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };
  const close = () => setOpen(false);

  return (
    <div
      ref={group}
      className="relative flex"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={() => {
        pressing.current = true;
        window.setTimeout(() => (pressing.current = false), 0);
      }}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <NavLink
        href={href}
        aria-current={current ? "page" : undefined}
        className={linkClassName}
        onFocus={() => {
          if (!pressing.current) setOpen(true);
        }}
      >
        {label}
      </NavLink>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Jogos por plataforma"
        onClick={() => {
          cancelClose();
          setOpen((o) => !o);
        }}
        className={`-ml-1 grid w-7 cursor-pointer place-items-center rounded-[2px] ${
          current ? "bg-text text-bg" : "text-text-3 hover:bg-hover hover:text-text"
        }`}
      >
        <svg viewBox="0 0 12 12" className={`size-3 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true">
          <path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <div id={panelId} hidden={!open} className="absolute top-full left-0 z-30 pt-2">
        <div className="w-[320px] rounded-[2px] border border-line-2 bg-surface p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,.85)]">
          <p className="px-3 pt-2 pb-1.5 text-[10.5px] tracking-[0.14em] text-dim">
            Catálogo por plataforma
          </p>
          <ul className="m-0 flex list-none flex-col p-0">
            {GAME_MENU_OPTIONS.map((option) => (
              <li key={option.href}>
                <Link
                  href={option.href}
                  onClick={close}
                  className="flex min-h-11 items-center gap-3 rounded-[2px] px-3 py-2 normal-case tracking-normal hover:bg-hover focus-visible:bg-hover"
                  style={{ "--c": option.color } as CSSProperties}
                >
                  <span className="size-2 flex-none bg-(--c)" aria-hidden="true" />
                  <span className="flex flex-col gap-0.5">
                    <b className="font-sans text-[15px] font-bold text-text">{option.label}</b>
                    <span className="font-sans text-[12.5px] font-normal text-muted">{option.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={GAME_MENU_ALL.href}
            onClick={close}
            className="mt-1 flex min-h-11 items-center border-t border-divider px-3 pt-2 text-acc hover:underline"
          >
            {GAME_MENU_ALL.label} →
          </Link>
        </div>
      </div>
    </div>
  );
}
