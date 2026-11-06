import Link from "next/link";
import type { ProfileSummary } from "@/lib/profile/queries";
import { formatHours } from "./format";

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

const nf = (n: number) => n.toLocaleString("pt-BR");

/**
 * Sections of a player's profile (Plano 4, F3), as links: each one is its own page. With the
 * summary, the tabs carry their counts and the bar ends with the hours and games.
 */
export function ProfileTabs({
  handle,
  active,
  summary,
}: {
  handle: string;
  active: ProfileTabId;
  summary?: ProfileSummary;
}) {
  const counts: Partial<Record<ProfileTabId, number>> = summary
    ? { jogos: summary.gamesCount, conquistas: summary.achievements, desejos: summary.wishlist }
    : {};
  return (
    <nav
      aria-label="Seções do perfil"
      className="flex overflow-x-auto overflow-y-hidden border-t border-line bg-surface"
    >
      <ul className="m-0 flex min-w-max flex-1 list-none gap-0.5 p-0">
        {TABS.map((tab) => {
          const current = tab.id === active;
          const count = counts[tab.id];
          return (
            <li key={tab.id}>
              <Link
                href={profilePath(handle, tab.id)}
                aria-current={current ? "page" : undefined}
                className={`inline-flex h-12 items-center gap-1.5 border-b-[3px] px-[18px] text-sm font-extrabold font-stretch-[80%] tracking-[0.06em] whitespace-nowrap uppercase ${
                  current
                    ? "border-acc bg-surface-2 text-text"
                    : "border-transparent text-text-2 hover:bg-surface-2 hover:text-text"
                }`}
              >
                {tab.label}
                {count ? <span className="font-semibold text-muted tabular-nums">{nf(count)}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {summary ? (
        <p className="m-0 flex flex-none items-center gap-5 px-[18px] text-[13.5px] whitespace-nowrap text-muted">
          <span>
            <b className="mr-1 font-extrabold text-text tabular-nums">{formatHours(summary.playtimeMin)}</b>jogadas
          </span>
          <span>
            <b className="mr-1 font-extrabold text-text tabular-nums">{nf(summary.gamesCount)}</b>
            {summary.gamesCount === 1 ? "jogo" : "jogos"}
          </span>
        </p>
      ) : null}
    </nav>
  );
}
