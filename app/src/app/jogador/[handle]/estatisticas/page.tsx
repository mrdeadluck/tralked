import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RARITY_COLOR, RARITY_LABEL } from "@/components/character/format";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { BarList } from "@/components/profile/BarList";
import { formatHours } from "@/components/profile/format";
import { PrivateProfile, SectionSkeleton } from "@/components/profile/PrivateProfile";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import type { PlatformId } from "@/lib/engine/trophies";
import { profileAccess, sectionMetadata } from "@/lib/profile/access";
import { getProfileStats, getProfileSummary, RARITY_TIERS } from "@/lib/profile/queries";
import type { PlayerHeader } from "@/lib/queries/players";
import { getPlayerHeaderCached } from "@/lib/queries/players-cached";

const PLATFORMS: PlatformId[] = ["steam", "psn", "xbox", "retro"];
const nf = (n: number) => n.toLocaleString("pt-BR");

export async function generateStaticParams() {
  return [{ handle: "exemplo" }];
}

export async function generateMetadata({ params }: PageProps<"/jogador/[handle]/estatisticas">): Promise<Metadata> {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  return sectionMetadata(header, "Estatísticas", "/estatisticas", "Horas por plataforma, jogos 100%, conclusão média e conquistas por ano.");
}

export default async function ProfileStatsPage({ params }: PageProps<"/jogador/[handle]/estatisticas">) {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  if (!header) notFound();
  return (
    <Suspense fallback={<SectionSkeleton label="Carregando estatísticas" />}>
      <ProfileStats header={header} />
    </Suspense>
  );
}

async function ProfileStats({ header }: { header: PlayerHeader }) {
  const { visible } = await profileAccess(header);
  if (!visible) return <PrivateProfile displayName={header.displayName} />;

  const [summary, stats] = await Promise.all([getProfileSummary(header.id), getProfileStats(header.id)]);
  if (!summary) notFound();
  const { playtime } = stats;

  const tiles: [string, string, string?][] = [
    ["Horas jogadas", formatHours(playtime.totalMin), playtime.last2WeeksMin > 0 ? `${formatHours(playtime.last2WeeksMin)} nas últimas 2 semanas` : undefined],
    ["Jogos possuídos", nf(playtime.gamesOwned)],
    ["Jogados", nf(playtime.gamesPlayed), `${nf(playtime.gamesNeverPlayed)} nunca jogados`],
    ["Jogos 100%", nf(stats.perfectGames)],
    [
      "Conclusão média",
      stats.averageCompletion === null ? "—" : `${stats.averageCompletion}%`,
      stats.startedGames > 0 ? `de ${nf(stats.startedGames)} jogos começados` : undefined,
    ],
    ["Conquistas", nf(stats.achievements)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader summary={summary} section="Estatísticas" />
      <ProfileTabs handle={header.handle} active="estatisticas" />

      <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line min-[641px]:grid-cols-3 min-[1000px]:grid-cols-6">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="bg-surface px-4 py-3.5">
            <dt className="font-mono text-[10px] tracking-[0.12em] text-dim-2 uppercase">{label}</dt>
            <dd className="m-0 mt-1 text-[26px] leading-none font-extrabold font-stretch-[112%] tabular-nums">
              {value}
              {note ? <small className="mt-1.5 block font-mono text-[10.5px] font-normal text-dim">{note}</small> : null}
            </dd>
          </div>
        ))}
      </dl>

      {playtime.mostPlayed ? (
        <p className="rounded-[4px] border border-line bg-surface px-5 py-4 text-[15px] text-text-2">
          Jogo mais jogado:{" "}
          <Link href={`/jogos/${playtime.mostPlayed.slug}`} className="font-extrabold text-text hover:text-acc">
            {playtime.mostPlayed.name}
          </Link>{" "}
          <span className="font-mono text-sm text-acc">{formatHours(playtime.mostPlayed.playtimeMin)}</span>
        </p>
      ) : null}

      <div className="grid gap-4 min-[901px]:grid-cols-2">
        <BarList
          title="Horas por plataforma"
          empty="Nenhuma hora registrada pelas plataformas ainda."
          bars={PLATFORMS.filter((p) => playtime.byPlatform[p] > 0).map((p) => ({
            label: PLATFORM_LABEL[p],
            value: playtime.byPlatform[p],
            display: formatHours(playtime.byPlatform[p]),
            color: PLATFORM_TOKEN[p],
          }))}
        />
        <BarList
          title="Conquistas por plataforma"
          empty="Nenhuma conquista ainda."
          bars={stats.achievementsByPlatform.map((r) => ({
            label: PLATFORM_LABEL[r.platform],
            value: r.count,
            display: nf(r.count),
            color: PLATFORM_TOKEN[r.platform],
          }))}
        />
        <BarList
          title="Conquistas por ano"
          empty="Nenhuma conquista ainda."
          bars={stats.achievementsByYear.map((r) => ({ label: String(r.year), value: r.count, display: nf(r.count) }))}
        />
        <BarList
          title="Conquistas por raridade"
          empty="Nenhuma conquista ainda."
          bars={RARITY_TIERS.map((r) => ({
            label: RARITY_LABEL[r],
            value: stats.rarityCounts[r],
            display: nf(stats.rarityCounts[r]),
            color: RARITY_COLOR[r],
          }))}
        />
      </div>
    </div>
  );
}
