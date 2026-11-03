import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RARITY_COLOR, RARITY_LABEL } from "@/components/character/format";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { Panel, PANEL_LINK } from "@/components/character/Panel";
import { AchievementRow } from "@/components/profile/AchievementRow";
import { RareShowcase } from "@/components/profile/RareShowcase";
import { PlatformProgressStrip } from "@/components/profile/PlatformProgressStrip";
import { PrivateProfile, SectionSkeleton } from "@/components/profile/PrivateProfile";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { profilePath, ProfileTabs } from "@/components/profile/ProfileTabs";
import { LinkChips } from "@/components/ui/LinkChips";
import { Pagination } from "@/components/ui/Pagination";
import type { PlatformId } from "@/lib/engine/trophies";
import type { RarityTier } from "@/lib/engine/types";
import { hrefWith, PAGE_PARAM, parsePagination, perPageParam, pickParams } from "@/lib/pagination";
import { profileAccess, sectionMetadata } from "@/lib/profile/access";
import { getGameBackdrop } from "@/lib/profile/showcase";
import {
  ACHIEVEMENT_SORTS,
  getAchievementGameOptions,
  getProfileSummary,
  getRarestAchievements,
  listUserAchievements,
  RARITY_TIERS,
  type AchievementSort,
} from "@/lib/profile/queries";
import { getPlayerGamePlatforms } from "@/lib/queries/game-profile";
import type { PlayerHeader } from "@/lib/queries/players";
import { getPlayerHeaderCached } from "@/lib/queries/players-cached";

const KEYS = ["plataforma", "raridade", "jogo", "ordem", "por", PAGE_PARAM] as const;
const PLATFORMS: PlatformId[] = ["steam", "psn", "xbox", "retro"];
const SORT_LABEL: Record<AchievementSort, string> = { recentes: "Recentes", raras: "Mais raras", antigas: "Antigas" };

export async function generateStaticParams() {
  return [{ handle: "exemplo" }];
}

export async function generateMetadata({ params }: PageProps<"/jogador/[handle]/conquistas">): Promise<Metadata> {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  return sectionMetadata(header, "Conquistas", "/conquistas", "Todas as conquistas e troféus, com raridade e data, e as mais raras.");
}

export default async function ProfileAchievementsPage({ params, searchParams }: PageProps<"/jogador/[handle]/conquistas">) {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  if (!header) notFound();
  return (
    <Suspense fallback={<SectionSkeleton label="Carregando conquistas" />}>
      <ProfileAchievements header={header} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProfileAchievements({
  header,
  searchParams,
}: {
  header: PlayerHeader;
  searchParams: PageProps<"/jogador/[handle]/conquistas">["searchParams"];
}) {
  const { visible } = await profileAccess(header);
  if (!visible) return <PrivateProfile displayName={header.displayName} />;

  const params = await searchParams;
  const state = pickParams(params, KEYS);
  const platform = PLATFORMS.find((p) => p === state.plataforma);
  const rarity = RARITY_TIERS.find((r) => r === state.raridade) as RarityTier | undefined;
  const sort = (ACHIEVEMENT_SORTS as readonly string[]).includes(state.ordem ?? "") ? (state.ordem as AchievementSort) : "recentes";
  const { page: requested, perPage } = parsePagination(params);

  const [summary, games, rarest] = await Promise.all([
    getProfileSummary(header.id),
    getAchievementGameOptions(header.id),
    getRarestAchievements(header.id, 6),
  ]);
  if (!summary) notFound();
  const game = games.find((g) => g.slug === state.jogo)?.slug;

  const [result, gamePlatforms, backdrop] = await Promise.all([
    listUserAchievements(header.id, { platform, rarity, game }, { sort, page: requested, perPage }),
    // The player's view of one game: their progress there, by platform.
    game ? getPlayerGamePlatforms(game, header.id) : null,
    // The rarest trophy's game lights the showcase.
    rarest[0] ? getGameBackdrop(rarest[0].game.slug) : null,
  ]);

  const base = profilePath(header.handle, "conquistas");
  const kept: Record<string, string | undefined> = {
    plataforma: platform,
    raridade: rarity,
    jogo: game,
    ordem: sort === "recentes" ? undefined : sort,
    por: perPageParam(perPage),
  };
  const link = (changes: Record<string, string | undefined>) => hrefWith(base, kept, { ...changes, [PAGE_PARAM]: undefined });
  const hidden = Object.entries(kept).filter((e): e is [string, string] => e[0] !== "jogo" && Boolean(e[1]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <ProfileHeader summary={summary} section="Conquistas" />
        <ProfileTabs handle={header.handle} active="conquistas" summary={summary} />
      </div>

      {rarest.length > 0 ? (
        <Panel
          title="Mais raras"
          accent
          aside={
            <Link
              href={link({ ordem: "raras", raridade: undefined, jogo: undefined, plataforma: undefined })}
              className={PANEL_LINK}
            >
              Ver todas por raridade
            </Link>
          }
        >
          <p className="-mt-2 mb-3 text-[13.5px] text-muted">Porcentagem de jogadores que desbloquearam.</p>
          <RareShowcase achievements={rarest} backdrop={backdrop} />
        </Panel>
      ) : null}

      {gamePlatforms ? (
        <PlatformProgressStrip
          game={gamePlatforms}
          current={platform}
          hrefFor={(p) => link({ plataforma: p })}
        />
      ) : null}

      <section aria-labelledby="todas-conquistas" className="flex flex-col gap-3">
        <h2 id="todas-conquistas" className="mt-2 text-[17px] leading-tight font-extrabold font-stretch-[80%] tracking-[0.06em] uppercase">
          Todas as conquistas
        </h2>
        <div className="flex flex-wrap items-end gap-2 bg-surface p-3 tk-cut">
        <LinkChips
          label="Filtrar por plataforma"
          caption="Plataforma"
          options={[
            { id: "todas", label: "Todas", href: link({ plataforma: undefined }) },
            ...PLATFORMS.map((p) => ({ id: p, label: PLATFORM_LABEL[p], color: PLATFORM_TOKEN[p], href: link({ plataforma: p }) })),
          ]}
          current={platform ?? "todas"}
        />
        <LinkChips
          label="Filtrar por raridade"
          caption="Raridade"
          options={[
            { id: "todas", label: "Todas", href: link({ raridade: undefined }) },
            ...RARITY_TIERS.map((r) => ({ id: r, label: RARITY_LABEL[r], color: RARITY_COLOR[r], href: link({ raridade: r }) })),
          ]}
          current={rarity ?? "todas"}
        />
        <LinkChips
          label="Ordenar conquistas"
          caption="Ordenar"
          options={ACHIEVEMENT_SORTS.map((s) => ({ id: s, label: SORT_LABEL[s], href: link({ ordem: s === "recentes" ? undefined : s }) }))}
          current={sort}
        />
        {games.length > 0 ? (
          <form action={base} method="get" className="flex flex-wrap items-end gap-2">
            {hidden.map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <label className="flex flex-col gap-1.5">
              <span className="tk-lbl">Jogo</span>
              <select
                // Uncontrolled: remount when the URL's game changes (client navigation keeps the DOM).
                key={game ?? ""}
                name="jogo"
                defaultValue={game ?? ""}
                className="h-[38px] max-w-[min(420px,80vw)] border-0 bg-bg px-2.5 text-sm text-text shadow-[inset_0_0_0_1px_var(--border)]"
              >
                <option value="">Todos os jogos ({games.length.toLocaleString("pt-BR")})</option>
                {games.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.name} ({g.unlocks})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="h-[38px] cursor-pointer bg-acc px-4 text-[13px] font-extrabold font-stretch-[80%] tracking-[0.06em] text-acc-ink uppercase tk-cut-b hover:brightness-[1.08]"
            >
              Filtrar
            </button>
          </form>
        ) : null}
        </div>

        <p className="tk-lbl text-text-2" aria-live="polite">
          {result.total.toLocaleString("pt-BR")} {result.total === 1 ? "conquista" : "conquistas"}
        </p>
        {result.items.length > 0 ? (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {result.items.map((a) => (
              <AchievementRow key={a.id} achievement={a} />
            ))}
          </ul>
        ) : (
          <p className="py-6 text-muted">
            {games.length === 0 ?"Nenhuma conquista ainda." : "Nenhuma conquista com esses filtros."}
          </p>
        )}
        <Pagination
          basePath={base}
          params={kept}
          window={{ page: result.page, perPage, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / perPage)) }}
          noun={["conquista", "conquistas"]}
          label="Páginas de conquistas"
        />
      </section>
    </div>
  );
}
