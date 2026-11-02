import Link from "next/link";

const TABS = [
  { href: "/conta", label: "Perfil e dados" },
  { href: "/conta/setup", label: "Setup" },
  { href: "/conta/conexoes", label: "Conexões" },
] as const;

/** Tabs between the account pages (links, the current one marked with aria-current). */
export function AccountNav({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Seções da conta">
      <ul className="m-0 flex list-none gap-1 border-b border-line p-0">
        {TABS.map((tab) => {
          const active = tab.href === current;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex min-h-11 items-center border-b-2 px-3.5 font-mono text-xs tracking-[0.08em] uppercase ${
                  active ? "border-acc text-text" : "border-transparent text-dim hover:text-text"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
