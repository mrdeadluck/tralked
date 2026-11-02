"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { AccountMenu, accountLinks, type AccountUser } from "./AccountMenu";
import {
  COMMUNITY_LINKS,
  GAME_MENU_OPTIONS,
  GAMES_LINKS,
  menuIsCurrent,
  underPath,
} from "./game-menu";
import { CloseIcon, MenuIcon, SearchIcon } from "./icons";
import { MobileDrawer } from "./MobileDrawer";
import { NavLink } from "./NavLink";
import { NavMenu, type MenuSide } from "./NavMenu";
import { NotificationBell, type BellProps } from "./NotificationBell";
import { SearchBox, type SearchSuggestion } from "./SearchBox";

/*
 * Header sections: Notícias, the "Jogos" and "Comunidade" menus (their pages in game-menu.ts),
 * Ranking and Personagem (the player's own sheet, or the showcase when logged out).
 */

const DRAWER_ID = "menu-mobile";
const SEARCH_ID = "busca-header";
const SEARCH_INPUT_ID = "busca-header-campo";
const LOGIN_HREF = "/entrar?returnTo=%2Fjogador%2Fme";
/** Logged-out "Personagem": what the character sheet is, with the way in. */
export const SHOWCASE_HREF = "/personagem";

export const PLATFORM_SIDE: MenuSide = { title: "Por plataforma", links: GAME_MENU_OPTIONS };

type HeaderProps = {
  user?: AccountUser;
  suggestions?: SearchSuggestion[];
  /** The logged-in user's bell (unread count + latest notifications). */
  notifications?: BellProps;
};

/** Link of the desktop bar; the current section reads as a lit key. */
const ITEM_CLASS =
  "relative rounded-[2px] px-2.5 py-[9px] whitespace-nowrap transition-colors duration-150 min-[1440px]:px-3";
const itemClass = (current: boolean) =>
  `${ITEM_CLASS} ${
    current
      ? "bg-text text-bg"
      : "text-text-3 hover:bg-hover hover:text-text aria-expanded:bg-hover aria-expanded:text-text"
  }`;

/** Square 44px icon button of the header (search, menu). */
const ICON_BUTTON =
  "grid size-11 cursor-pointer place-items-center rounded-[2px] border border-line-2 bg-surface-2 text-text transition-colors duration-150 hover:border-acc aria-expanded:border-acc aria-expanded:text-acc";

export function Header({ user, suggestions, notifications }: HeaderProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const drawerButton = useRef<HTMLButtonElement>(null);

  // Any navigation closes the drawer and the phone search.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setDrawerOpen(false);
    setSearchOpen(false);
  }

  // The phone search opens with the caret in the field.
  useEffect(() => {
    if (searchOpen) document.getElementById(SEARCH_INPUT_ID)?.focus();
  }, [searchOpen]);

  // Esc closes the drawer from anywhere, focus back on its button.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawerOpen(false);
      drawerButton.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const sheetHref = user ? `/jogador/${encodeURIComponent(user.handle)}` : SHOWCASE_HREF;
  const current = {
    noticias: underPath(pathname, "/noticias"),
    jogos: menuIsCurrent(pathname, GAMES_LINKS),
    comunidade: menuIsCurrent(pathname, COMMUNITY_LINKS),
    ranking: underPath(pathname, "/highscores"),
    personagem: user ? underPath(pathname, sheetHref) : pathname === SHOWCASE_HREF,
  };
  // /jogos has its own catalog search right under the header: no second field on phones.
  const pageHasSearch = pathname === "/jogos";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/[.94] backdrop-blur-[10px]">
      <div className="relative mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-2 px-4 py-2.5 nav:gap-x-5 nav:px-5 nav:py-3.5">
        <Link href="/" className="mr-auto flex-none rounded-[2px] nav:mr-0" aria-label="Tralked, página inicial">
          <Logo size={44} />
        </Link>

        <nav
          aria-label="Seções"
          className="flex gap-1 font-mono text-xs font-medium tracking-[0.08em] uppercase max-nav:hidden"
        >
          <NavLink href="/noticias" aria-current={current.noticias ? "page" : undefined} className={itemClass(current.noticias)}>
            Notícias
          </NavLink>
          <NavMenu
            label="Jogos"
            title="Explorar"
            links={GAMES_LINKS}
            side={PLATFORM_SIDE}
            current={current.jogos}
            triggerClassName={itemClass(current.jogos)}
          />
          <NavMenu
            label="Comunidade"
            title="Comunidade"
            links={COMMUNITY_LINKS}
            current={current.comunidade}
            triggerClassName={itemClass(current.comunidade)}
          />
          <NavLink href="/highscores" aria-current={current.ranking ? "page" : undefined} className={itemClass(current.ranking)}>
            Ranking
          </NavLink>
          <NavLink href={sheetHref} aria-current={current.personagem ? "page" : undefined} className={itemClass(current.personagem)}>
            Personagem
          </NavLink>
        </nav>

        <div
          id={SEARCH_ID}
          className={`min-w-0 nav:flex-[1_1_120px] max-nav:order-last max-nav:basis-full ${
            searchOpen ? "max-nav:pt-2.5 max-nav:pb-1" : "max-nav:hidden"
          }`}
        >
          <SearchBox suggestions={suggestions} inputId={SEARCH_INPUT_ID} onDismiss={() => setSearchOpen(false)} />
        </div>

        <div className="flex items-center gap-1.5 nav:ml-auto nav:gap-2.5">
          {pageHasSearch ? null : (
            <button
              type="button"
              aria-expanded={searchOpen}
              aria-controls={SEARCH_ID}
              aria-label={searchOpen ? "Fechar busca" : "Buscar jogos"}
              onClick={() => {
                setSearchOpen((open) => !open);
                setDrawerOpen(false);
              }}
              className={`${ICON_BUTTON} nav:hidden`}
            >
              {searchOpen ? <CloseIcon /> : <SearchIcon />}
            </button>
          )}
          {user && notifications ? <NotificationBell {...notifications} /> : null}
          {user ? (
            <AccountMenu user={user} />
          ) : (
            <Link
              href={LOGIN_HREF}
              className="inline-flex h-11 items-center rounded-[2px] border border-acc bg-acc px-3 font-mono nav:px-4 text-xs font-bold tracking-[0.1em] text-bg uppercase transition-[filter] duration-150 hover:brightness-[1.08]"
            >
              Entrar
            </Link>
          )}
          <button
            ref={drawerButton}
            type="button"
            aria-expanded={drawerOpen}
            aria-controls={DRAWER_ID}
            aria-label={drawerOpen ? "Fechar menu" : "Abrir menu"}
            onClick={() => {
              setDrawerOpen((open) => !open);
              setSearchOpen(false);
            }}
            className={`${ICON_BUTTON} nav:hidden`}
          >
            {drawerOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      <MobileDrawer
        id={DRAWER_ID}
        open={drawerOpen}
        pathname={pathname}
        current={current}
        sheetHref={sheetHref}
        accountItems={user ? accountLinks(user.role) : []}
        loggedIn={Boolean(user)}
        onNavigate={() => setDrawerOpen(false)}
      />
    </header>
  );
}
