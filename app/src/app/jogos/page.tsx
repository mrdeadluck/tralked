import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CatalogFilters, type CatalogFilterId } from "@/components/games/CatalogFilters";
import { GameTile } from "@/components/games/GameTile";
import { loginHref } from "@/components/guide/format";
import { SectionHead } from "@/components/ui/SectionHead";
import { getSessionUser } from "@/lib/auth/session";
import { SKILLS, type SkillId } from "@/lib/engine/types";
import { GAME_MENU_OPTIONS } from "@/components/layout/game-menu";
import { CATALOG_PLATFORMS, countGames, listGames, type GameFilter } from "@/lib/queries/games";

export const metadata: Metadata = {
  title: "Jogos e guias | Tralked",
  description: "Catálogo de jogos com conquistas, guias 100% e o seu progresso em cada um.",
};

const PLATFORMS = new Set<string>(CATALOG_PLATFORMS);
const PLATFORM_LABEL = new Map(GAME_MENU_OPTIONS.map((o) => [new URL(o.href, "http://x").searchParams.get("plataforma"), o.label]));
const CATALOG_SKILLS = SKILLS.filter((s) => s.id !== "sabio");

const FILTER_OPTIONS = [
  { id: "todos", label: "Todos" },
  { id: "quase", label: "Quase 100%" },
  { id: "guia", label: "Com guia completo" },
  ...CATALOG_SKILLS.map((s) => ({ id: s.id, label: s.name })),
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function JogosPage({ searchParams }: PageProps<"/jogos">) {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <Catalog searchParams={searchParams} />
    </Suspense>
  );
}

async function Catalog({ searchParams }: Pick<PageProps<"/jogos">, "searchParams">) {
  const params = await searchParams;
  const user = await getSessionUser();

  const genero = first(params.genero);
  const skill = CATALOG_SKILLS.find((s) => s.id === genero)?.id as SkillId | undefined;
  const almost = first(params.quase) === "1";
  const withGuide = first(params.guia) === "1";
  const q = first(params.q)?.trim() || undefined;
  const plataforma = first(params.plataforma)?.toUpperCase();
  const platform = plataforma && PLATFORMS.has(plataforma) ? plataforma : undefined;

  const filter: GameFilter = { skill, almost, withGuide, q, platform };
  const current: CatalogFilterId = almost ? "quase" : withGuide ? "guia" : (skill ?? "todos");

  const [games, total] = await Promise.all([
    listGames(filter, user?.id),
    countGames(),
  ]);

  const returnTo = "/jogos?quase=1";

  return (
    <>
      <SectionHead
        title="Jogos e guias"
        aside={
          <span className="tracking-normal text-dim normal-case">
            {total.toLocaleString("pt-BR")} {total === 1 ? "jogo" : "jogos"} no catálogo
          </span>
        }
      />
      <div className="pt-4 pb-5">
        <CatalogFilters
          current={current}
          options={FILTER_OPTIONS}
          q={q}
          platform={platform}
          platformLabel={platform ? PLATFORM_LABEL.get(platform) : undefined}
        />
      </div>
      <p className="mb-3.5 font-mono text-[11px] tracking-[0.06em] text-dim" aria-live="polite">
        {games.length} {games.length === 1 ? "JOGO" : "JOGOS"}
      </p>
      {games.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {games.map((game) => (
            <GameTile key={game.id} game={game} />
          ))}
        </div>
      ) : almost && !user ? (
        <p className="py-10 text-[15px] text-[#8A8D96]">
          <a href={loginHref(returnTo)} className="text-acc underline underline-offset-2">
            Entre
          </a>{" "}
          para ver os jogos em que você está perto do 100%.
        </p>
      ) : (
        <p className="py-10 text-[15px] text-[#8A8D96]">
          Nenhum jogo com esse filtro.{" "}
          <Link href="/jogos" className="text-acc underline underline-offset-2">
            Ver todos os jogos
          </Link>
          .
        </p>
      )}
    </>
  );
}
