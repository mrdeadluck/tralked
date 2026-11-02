import Link from "next/link";

export type ProfileTabId = "ficha" | "jogos" | "conquistas" | "estatisticas" | "desejos";

const TABS: { id: ProfileTabId; label: string; path: string }[] = [
  { id: "ficha", label: "Ficha", path: "" },
  { id: "jogos", label: "Jogos", path: "/jogos" },
  { id: "conquistas", label: "Conquistas", path: "/conquistas" },
  { id: "estatisticas", label: "Estatísticas", path: "/estatisticas" },
  { id: "desejos", label: "Lista de desejos", path: "/desejos" },
];

export const profilePath = (handle: string, tab: ProfileTabId = "ficha") =>
  `/jogador/${encodeURIComponent(handle)}${TABS.find((t) => t.id === tab)!.path}`;

/** Sections of a player's profile (Plano 4, F3), as links: each one is its own page. */
export function ProfileTabs({ handle, active }: { handle: string; active: ProfileTabId }) {
  return (
    <nav aria-label="Seções do perfil" className="overflow-x-auto border-b border-line">
      <ul className="m-0 flex min-w-max list-none gap-1 p-0">
        {TABS.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={profilePath(handle, tab.id)}
                aria-current={current ? "page" : undefined}
                className={`-mb-px inline-flex h-11 items-center border-b-2 px-3.5 font-mono text-xs tracking-[0.1em] uppercase ${
                  current ? "border-acc font-bold text-text" : "border-transparent text-text-3 hover:text-text"
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
