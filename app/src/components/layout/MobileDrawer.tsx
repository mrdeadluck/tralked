import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { AccountLink } from "./AccountMenu";
import { COMMUNITY_LINKS, GAME_MENU_OPTIONS, GAMES_LINKS, underPath, type MenuLink } from "./game-menu";
import { LogoutForm } from "./LogoutForm";
import { NavLink } from "./NavLink";

export type DrawerCurrent = {
  noticias: boolean;
  jogos: boolean;
  comunidade: boolean;
  ranking: boolean;
  personagem: boolean;
};

type MobileDrawerProps = {
  id: string;
  open: boolean;
  pathname: string;
  current: DrawerCurrent;
  /** The player's own sheet, or the showcase when logged out. */
  sheetHref: string;
  /** Account links (Conexões, Admin...) and "Sair" for a logged-in user. */
  accountItems?: AccountLink[];
  loggedIn?: boolean;
  /** Called when a link is followed, so the Header closes the drawer. */
  onNavigate: () => void;
};

const TOP_LINK =
  "flex min-h-12 items-center justify-between gap-3 border-b border-divider py-3 text-[22px] font-extrabold font-stretch-[115%] tracking-[-0.02em] transition-colors duration-150 hover:text-acc";
const SUB_LINK =
  "flex min-h-11 items-center gap-3 py-2 text-[17px] font-semibold transition-colors duration-150 hover:text-acc";

/** The phone menu: the same sections as the desktop bar, the two menus opened as groups. */
export function MobileDrawer({
  id,
  open,
  pathname,
  current,
  sheetHref,
  accountItems = [],
  loggedIn = false,
  onNavigate,
}: MobileDrawerProps) {
  const here = (link: MenuLink) => link.match?.some((prefix) => underPath(pathname, prefix)) ?? false;
  return (
    <>
      {/* Dims the page under the drawer; a tap on it closes the drawer. */}
      <div
        aria-hidden="true"
        hidden={!open}
        onClick={onNavigate}
        className="absolute inset-x-0 top-full h-[100dvh] bg-black/60 transition-opacity duration-200 starting:opacity-0 nav:hidden"
      />
      <nav
        id={id}
        hidden={!open}
        aria-label="Menu"
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-64px)] overflow-y-auto overscroll-contain border-b border-line bg-bg px-5 pt-1 pb-6 shadow-[0_28px_48px_-24px_rgba(0,0,0,.9)] transition-[opacity,translate] duration-200 ease-[cubic-bezier(.16,1,.3,1)] starting:-translate-y-2 starting:opacity-0 motion-reduce:transition-none nav:hidden"
      >
        <TopLink href="/noticias" current={current.noticias} onNavigate={onNavigate}>
          Notícias
        </TopLink>

        <Group title="Jogos" current={current.jogos}>
          <SubLinks links={GAMES_LINKS} here={here} onNavigate={onNavigate} />
          <ul aria-label="Jogos por plataforma" className="m-0 mt-2 grid list-none grid-cols-2 gap-1.5 p-0">
            {GAME_MENU_OPTIONS.map((option) => (
              <li key={option.href}>
                <Link
                  href={option.href}
                  onClick={onNavigate}
                  className="flex min-h-11 items-center gap-2.5 rounded-[2px] border border-line px-3 text-[15px] font-semibold text-text-2 transition-colors duration-150 hover:border-(--c) hover:text-text"
                  style={{ "--c": option.color } as CSSProperties}
                >
                  <span className="size-2 flex-none bg-(--c)" aria-hidden="true" />
                  {option.label}
                </Link>
              </li>
            ))}
          </ul>
        </Group>

        <Group title="Comunidade" current={current.comunidade}>
          <SubLinks links={COMMUNITY_LINKS} here={here} onNavigate={onNavigate} />
        </Group>

        <TopLink href="/highscores" current={current.ranking} onNavigate={onNavigate}>
          Ranking
        </TopLink>
        <TopLink href={sheetHref} current={current.personagem} onNavigate={onNavigate}>
          Personagem
        </TopLink>

        {accountItems.length > 0 || loggedIn ? (
          <div className="mt-4 flex flex-col">
            {accountItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className="flex min-h-11 items-center border-b border-divider font-mono text-xs tracking-[0.1em] text-text-3 uppercase hover:text-acc"
              >
                {item.label}
              </Link>
            ))}
            {loggedIn ? (
              <LogoutForm buttonClassName="flex min-h-11 w-full cursor-pointer items-center border-b border-divider text-left font-mono text-xs tracking-[0.1em] text-text-3 uppercase hover:text-acc" />
            ) : null}
          </div>
        ) : null}
      </nav>
    </>
  );
}

function TopLink({
  href,
  current,
  onNavigate,
  children,
}: {
  href: string;
  current: boolean;
  onNavigate: () => void;
  children: ReactNode;
}) {
  return (
    <NavLink
      href={href}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      className={`${TOP_LINK} ${current ? "text-acc" : ""}`}
    >
      {children}
      {current ? <span aria-hidden="true" className="size-2 flex-none bg-acc" /> : null}
    </NavLink>
  );
}

function Group({ title, current, children }: { title: string; current: boolean; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-divider pt-4 pb-3">
      <h2
        className={`font-mono text-xs font-medium tracking-[0.14em] uppercase ${current ? "text-acc" : "text-dim"}`}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubLinks({
  links,
  here,
  onNavigate,
}: {
  links: MenuLink[];
  here: (link: MenuLink) => boolean;
  onNavigate: () => void;
}) {
  return (
    <ul className="m-0 mt-1 flex list-none flex-col p-0">
      {links.map((link) => {
        const isHere = here(link);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              onClick={onNavigate}
              aria-current={isHere ? "page" : undefined}
              className={`${SUB_LINK} ${isHere ? "text-acc" : "text-text"}`}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 flex-none rounded-full ${isHere ? "bg-acc" : "bg-line-2"}`}
              />
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
