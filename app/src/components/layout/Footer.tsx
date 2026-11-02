import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { SLOGAN } from "@/components/brand/slogan";
import { GAME_MENU_OPTIONS } from "./game-menu";
import { NavLink } from "./NavLink";
import { Newsletter } from "./Newsletter";

const COLUMNS = [
  {
    title: "Explorar",
    links: [
      { href: "/noticias", label: "Notícias" },
      { href: "/jogos", label: "Catálogo" },
      { href: "/jogos?guia=1", label: "Guias 100%" },
      { href: "/lancamentos", label: "Lançamentos" },
      { href: "/calendario", label: "Calendário" },
      { href: "/jogador/me", label: "Personagem" },
    ],
  },
  {
    title: "Plataformas",
    links: GAME_MENU_OPTIONS.map(({ href, label }) => ({ href, label })),
  },
  {
    title: "Comunidade",
    links: [
      { href: "/forum", label: "Fórum" },
      { href: "/galeria", label: "Galeria" },
      { href: "/highscores", label: "Ranking" },
      { href: "/familia", label: "Família" },
    ],
  },
  {
    title: "Tralked",
    links: [
      { href: "/desenvolvedores", label: "Desenvolvedores" },
      { href: "/privacidade", label: "Privacidade" },
      { href: "/termos", label: "Termos" },
      { href: "/licencas", label: "Licenças" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-bg-deep">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-12 px-5 pt-14 pb-8">
        {/* One line everywhere; the news pages end on the lime block instead (see Newsletter). */}
        <div className="[body:has([data-newsletter-block])_&]:hidden">
          <Newsletter variant="line" />
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-6 gap-y-8 sm:gap-8">
          <div className="flex flex-col gap-2.5">
            <Logo size={34} />
            <p className="text-sm text-[#8a8d96]">{SLOGAN}</p>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col sm:gap-2.5">
              <span className="mb-1 font-mono text-xs tracking-[0.14em] text-dim-2 uppercase sm:mb-0">
                {column.title}
              </span>
              {column.links.map((link) => (
                <NavLink
                  key={link.href}
                  href={link.href}
                  className="inline-flex min-h-11 items-center self-start text-[14.5px] text-text-2 transition-colors duration-150 hover:text-acc sm:min-h-0"
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-between gap-3 border-t border-divider pt-5 font-mono text-xs text-dim-2">
          <div className="flex flex-col gap-1">
            <span>© 2026 Tralked</span>
            <span>Dados de jogos: Steam, IGDB, RAWG. Arte: Steam, SteamGridDB.</span>
          </div>
          <div className="flex gap-4">
            <Link href="/privacidade#cookies" className="inline-flex min-h-11 items-center hover:text-acc sm:min-h-0">
              Cookies
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
