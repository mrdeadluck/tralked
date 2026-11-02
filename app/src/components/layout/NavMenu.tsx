"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { MenuLink } from "./game-menu";
import { underPath } from "./game-menu";

/*
 * A header section with sub-pages ("Jogos", "Comunidade"): a disclosure button and its panel.
 * Click (or Enter / Space) toggles it; a mouse hover opens it too. ArrowDown on the button opens
 * it and moves into the links; arrows walk the links; Esc closes it from anywhere and returns
 * focus to the button when focus was inside; tabbing out, a tap or click outside and any
 * navigation close it. The panel follows the button in the DOM, so Tab walks into its links.
 */

const CLOSE_DELAY_MS = 160;

export type MenuSide = { title: string; links: { href: string; label: string; hint: string; color: string }[] };

type NavMenuProps = {
  label: string;
  /** Title of the main column ("Explorar"). */
  title: string;
  links: MenuLink[];
  /** Optional second column (the catalog by platform under "Jogos"). */
  side?: MenuSide;
  /** One of the menu's sections is the current page. */
  current: boolean;
  triggerClassName: string;
};

export function NavMenu({ label, title, links, side, current, triggerClassName }: NavMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const group = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);
  const focusFirst = useRef(false);
  /** Opened by the mouse arriving: the click that follows pins it open instead of closing it. */
  const hoverOpened = useRef(false);

  // A navigation (a link here, the back button) closes it.
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setOpen(false);
  }

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Opened with ArrowDown: focus lands on the first link once the panel is visible.
  useEffect(() => {
    if (!open) hoverOpened.current = false;
    if (open && focusFirst.current) {
      focusFirst.current = false;
      panel.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    }
  }, [open]);

  // While open: a tap or click anywhere else closes it (iOS never blurs on an outside tap), and Esc
  // closes it wherever focus is (WCAG 1.4.13), returning focus to the button when it was inside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (!group.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = group.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (inside) button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancelClose();
    if (!open) hoverOpened.current = true;
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

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    if (open) panel.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    else {
      focusFirst.current = true;
      setOpen(true);
    }
  };

  // Arrow keys walk the panel's links (wrapping), Home / End jump to the ends.
  const onPanelKey = (e: KeyboardEvent) => {
    const items = [...(panel.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (index < 0 || items.length === 0) return;
    const next =
      e.key === "ArrowDown"
        ? (index + 1) % items.length
        : e.key === "ArrowUp"
          ? (index - 1 + items.length) % items.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };

  const close = () => setOpen(false);
  const isHere = (link: MenuLink) => link.match?.some((prefix) => underPath(pathname, prefix)) ?? false;

  return (
    <div ref={group} className="relative flex" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-current={current || undefined}
        onClick={() => {
          cancelClose();
          if (hoverOpened.current) {
            hoverOpened.current = false;
            setOpen(true);
          } else setOpen((o) => !o);
        }}
        onKeyDown={onButtonKey}
        className={`${triggerClassName} inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs font-medium tracking-[0.08em] uppercase`}
      >
        {label}
        {current ? <span className="sr-only"> (seção atual)</span> : null}
        <svg
          viewBox="0 0 12 12"
          className={`size-3 transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <div
        ref={panel}
        id={panelId}
        hidden={!open}
        onKeyDown={onPanelKey}
        className="absolute top-full left-0 z-30 pt-2 transition-[opacity,translate] duration-200 ease-[cubic-bezier(.16,1,.3,1)] starting:-translate-y-1.5 starting:opacity-0 motion-reduce:transition-none"
      >
        <div
          className={`grid gap-1 rounded-[3px] border border-line-2 bg-surface p-2 shadow-[0_24px_48px_-18px_rgba(0,0,0,.9)] ${
            side ? "w-[600px] grid-cols-2" : "w-[300px]"
          }`}
        >
          <MenuColumn title={title}>
            {links.map((link) => {
              const here = isHere(link);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={close}
                    aria-current={here ? "page" : undefined}
                    className={`${ITEM} ${here ? "bg-hover-2" : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-[7px] size-1.5 flex-none rounded-full ${here ? "bg-acc" : "bg-line-2 group-hover:bg-acc group-focus-visible:bg-acc"}`}
                    />
                    <span className="flex flex-col gap-0.5">
                      <b className="font-sans text-[15px] font-bold text-text">{link.label}</b>
                      <span className="font-sans text-[13px] font-normal text-muted">{link.hint}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </MenuColumn>
          {side ? (
            <MenuColumn title={side.title} divided>
              {side.links.map((option) => (
                <li key={option.href}>
                  <Link
                    href={option.href}
                    onClick={close}
                    className={ITEM}
                    style={{ "--c": option.color } as CSSProperties}
                  >
                    <span aria-hidden="true" className="mt-[7px] size-2 flex-none bg-(--c)" />
                    <span className="flex flex-col gap-0.5">
                      <b className="font-sans text-[15px] font-bold text-text">{option.label}</b>
                      <span className="font-sans text-[13px] font-normal text-muted">{option.hint}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </MenuColumn>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const ITEM =
  "group flex min-h-11 items-start gap-3 rounded-[2px] px-3 py-2.5 normal-case tracking-normal transition-colors duration-150 hover:bg-hover-2 focus-visible:bg-hover-2 focus-visible:outline-offset-[-2px]";

function MenuColumn({ title, divided = false, children }: { title: string; divided?: boolean; children: ReactNode }) {
  const titleId = useId();
  return (
    <div className={`flex flex-col ${divided ? "border-l border-divider pl-1" : ""}`}>
      <p id={titleId} className="px-3 pt-2 pb-1.5 text-xs tracking-[0.14em] text-dim">
        {title}
      </p>
      <ul aria-labelledby={titleId} className="m-0 flex list-none flex-col p-0">
        {children}
      </ul>
    </div>
  );
}
