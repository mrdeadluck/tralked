import Link from "next/link";
import { Fragment, type CSSProperties } from "react";
import { PlatformChips } from "@/components/ui/PlatformChips";
import type { AccountLink } from "./AccountMenu";
import { GAME_MENU_OPTIONS } from "./game-menu";
import { LogoutForm } from "./LogoutForm";
import { NavLink } from "./NavLink";

export type DrawerItem = { href: string; label: string; current: boolean };

type MobileDrawerProps = {
  id: string;
  open: boolean;
  items: DrawerItem[];
  /** Links da conta (Conexões, Admin...) e o "Sair" para quem está logado. */
  accountItems?: AccountLink[];
  loggedIn?: boolean;
  /** Chamado ao navegar por um link, para o Header fechar a gaveta. */
  onNavigate: () => void;
};

const LINK_CLASS = "flex min-h-11 items-center border-b border-divider py-3.5";

export function MobileDrawer({
  id,
  open,
  items,
  accountItems = [],
  loggedIn = false,
  onNavigate,
}: MobileDrawerProps) {
  return (
    <nav
      id={id}
      hidden={!open}
      aria-label="Menu"
      className="flex flex-col border-t border-line px-5 pt-2 pb-5 text-[22px] font-extrabold font-stretch-[115%] tracking-[-0.02em] nav:hidden"
    >
      {items.map((item) => (
        <Fragment key={item.href}>
          <NavLink
            href={item.href}
            onClick={onNavigate}
            aria-current={item.current ? "page" : undefined}
            className={`${LINK_CLASS} ${item.current ? "text-acc" : ""}`}
          >
            {item.label}
          </NavLink>
          {item.href === "/jogos" ? (
            // The header's "Jogos" menu, as a sub-list: the catalog by platform, Steam / PC first.
            <ul aria-label="Jogos por plataforma" className="m-0 flex list-none flex-col border-b border-divider py-1 pl-4">
              {GAME_MENU_OPTIONS.map((option) => (
                <li key={option.href}>
                  <Link
                    href={option.href}
                    onClick={onNavigate}
                    className="flex min-h-11 items-center gap-3 text-[16px] font-semibold font-stretch-[100%] tracking-normal text-text-2 hover:text-acc"
                    style={{ "--c": option.color } as CSSProperties}
                  >
                    <span className="size-2 flex-none bg-(--c)" aria-hidden="true" />
                    {option.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Fragment>
      ))}
      {accountItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={`${LINK_CLASS} text-text-3 hover:text-acc`}
        >
          {item.label}
        </Link>
      ))}
      {loggedIn ? (
        <LogoutForm buttonClassName="flex min-h-11 w-full cursor-pointer items-center border-b border-divider py-3.5 text-left text-text-3 hover:text-acc" />
      ) : null}
      <div className="flex flex-wrap gap-1.5 pt-4">
        <PlatformChips
          platforms={["PLAYSTATION", "XBOX", "NINTENDO", "PC"]}
        />
      </div>
    </nav>
  );
}
