import Link from "next/link";
import { PlatformChips } from "@/components/ui/PlatformChips";
import type { AccountLink } from "./AccountMenu";
import { LogoutForm } from "./LogoutForm";
import { prefetchFor } from "./prefetch";

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
        <Link
          key={item.href}
          href={item.href}
          prefetch={prefetchFor(item.href)}
          onClick={onNavigate}
          aria-current={item.current ? "page" : undefined}
          className={`${LINK_CLASS} ${item.current ? "text-acc" : ""}`}
        >
          {item.label}
        </Link>
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
