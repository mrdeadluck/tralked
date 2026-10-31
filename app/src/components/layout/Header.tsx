"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { LogoutForm } from "./LogoutForm";
import { MobileDrawer } from "./MobileDrawer";
import { SearchBox, type SearchSuggestion } from "./SearchBox";

export const NAV_ITEMS = [
  { href: "/", label: "Notícias" },
  { href: "/jogos", label: "Jogos e guias" },
  { href: "/jogador/me", label: "Personagem" },
  { href: "/highscores", label: "Highscores" },
  { href: "/familia", label: "Família" },
] as const;

const DRAWER_ID = "menu-mobile";

function isCurrent(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type HeaderProps = {
  user?: { handle: string; level: number };
  suggestions?: SearchSuggestion[];
};

export function Header({ user, suggestions }: HeaderProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const items = NAV_ITEMS.map((item) => ({
    ...item,
    current: isCurrent(pathname, item.href),
  }));

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/[.94] backdrop-blur-[10px]">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-6 px-5 py-3.5">
        <Link href="/" aria-label="GAMELOG, página inicial" className="flex-none">
          <Logo size={44} />
        </Link>

        <nav
          aria-label="Seções"
          className="flex gap-1 font-mono text-xs font-medium tracking-[0.08em] uppercase max-nav:hidden"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={`rounded-[2px] px-3 py-[9px] whitespace-nowrap ${
                item.current
                  ? "bg-text text-bg"
                  : "text-text-3 hover:bg-hover hover:text-text"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <SearchBox suggestions={suggestions} />

        <div className="ml-auto flex items-center gap-2.5">
          <Link
            href="/jogador/me"
            aria-label="Seu personagem"
            className="flex items-center gap-2.5"
          >
            <span className="flex flex-col items-end font-mono leading-[1.2] max-nav:hidden">
              <small className="text-[10px] tracking-[0.1em] text-dim uppercase">
                {user ? user.handle : "Personagem"}
              </small>
              <b className="text-[13px]">{user ? `NV ${user.level}` : "NV —"}</b>
            </span>
            <span
              aria-hidden="true"
              className="size-10 flex-none rounded-full border-2 border-acc bg-[repeating-linear-gradient(135deg,#1a1c22_0_5px,#22242b_5px_10px)]"
            />
          </Link>
          {user ? (
            <LogoutForm
              className="max-nav:hidden"
              buttonClassName="cursor-pointer rounded-[2px] border border-[#2a2c33] px-2.5 py-[7px] font-mono text-[10px] tracking-[0.1em] text-text-3 uppercase hover:border-acc hover:text-text"
            />
          ) : null}
          <button
            type="button"
            aria-expanded={drawerOpen}
            aria-controls={DRAWER_ID}
            aria-label={drawerOpen ? "Fechar menu" : "Abrir menu"}
            onClick={() => setDrawerOpen((open) => !open)}
            className="grid size-11 cursor-pointer place-items-center rounded-[2px] border border-[#2a2c33] bg-surface-2 hover:border-acc nav:hidden"
          >
            <span aria-hidden="true">{drawerOpen ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>

      <MobileDrawer
        id={DRAWER_ID}
        open={drawerOpen}
        items={items}
        loggedIn={Boolean(user)}
        onNavigate={() => setDrawerOpen(false)}
      />
    </header>
  );
}
