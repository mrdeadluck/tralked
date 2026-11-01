"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { AccountMenu, accountLinks, type AccountUser } from "./AccountMenu";
import { GamesMenu } from "./GamesMenu";
import { MobileDrawer } from "./MobileDrawer";
import { NavLink } from "./NavLink";
import { NotificationBell, type BellProps } from "./NotificationBell";
import { SearchBox, type SearchSuggestion } from "./SearchBox";

export const NAV_ITEMS = [
  { href: "/", label: "Notícias" },
  { href: "/jogos", label: "Jogos" },
  { href: "/forum", label: "Fórum" },
  { href: "/galeria", label: "Galeria" },
  { href: "/jogador/me", label: "Personagem" },
  { href: "/highscores", label: "Highscores" },
  { href: "/familia", label: "Família" },
] as const;

const DRAWER_ID = "menu-mobile";
const LOGIN_HREF = "/entrar?returnTo=%2Fjogador%2Fme";

function isCurrent(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type HeaderProps = {
  user?: AccountUser;
  suggestions?: SearchSuggestion[];
  /** The logged-in user's bell (unread count + latest notifications). */
  notifications?: BellProps;
};

export function Header({ user, suggestions, notifications }: HeaderProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // "Personagem" points straight at the player's own sheet when logged in, and at the login
  // (which comes back to the sheet) otherwise: no redirect hop either way.
  const items = NAV_ITEMS.map((item) => {
    const href =
      item.href === "/jogador/me" ? (user ? `/jogador/${encodeURIComponent(user.handle)}` : LOGIN_HREF) : item.href;
    return { ...item, href, current: isCurrent(pathname, href) };
  });

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/[.94] backdrop-blur-[10px]">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5">
        <Link href="/" className="flex-none">
          <Logo size={44} />
        </Link>

        <nav
          aria-label="Seções"
          className="flex gap-1 font-mono text-xs font-medium tracking-[0.08em] uppercase max-nav:hidden"
        >
          {items.map((item) => {
            const className = `rounded-[2px] px-2 py-[9px] whitespace-nowrap min-[1440px]:px-3 ${
              item.current ? "bg-text text-bg" : "text-text-3 hover:bg-hover hover:text-text"
            }`;
            return item.href === "/jogos" ? (
              <GamesMenu key={item.href} href={item.href} label={item.label} current={item.current} linkClassName={className} />
            ) : (
              <NavLink
                key={item.href}
                href={item.href}
                aria-current={item.current ? "page" : undefined}
                className={className}
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <SearchBox suggestions={suggestions} />

        <div className="ml-auto flex items-center gap-2.5">
          {user && notifications ? <NotificationBell {...notifications} /> : null}
          {user ? (
            <AccountMenu user={user} />
          ) : (
            <Link
              href={LOGIN_HREF}
              className="inline-flex h-10 items-center rounded-[2px] border border-acc bg-acc px-4 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
            >
              Entrar
            </Link>
          )}
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
        accountItems={user ? accountLinks(user.role) : []}
        loggedIn={Boolean(user)}
        onNavigate={() => setDrawerOpen(false)}
      />
    </header>
  );
}
