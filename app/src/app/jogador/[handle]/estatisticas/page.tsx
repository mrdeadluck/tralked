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
import { YearChart } from "@/components/profile/YearChart";
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

  const peakYear = stats.achievementsByYear.reduce<{ year: number; count: number } | null>(
    (best, r) => (!best || r.count > best.count ? r : best),
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <ProfileHeader summary={summary} section="Estatísticas" />
        <ProfileTabs handle={header.handle} active="estatisticas" summary={summary} />
      </div>

      <dl className="m-0 grid grid-cols-2 gap-0.5 min-[641px]:grid-cols-3 min-[1000px]:grid-cols-6">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="bg-surface p-4">
            <dt className="tk-lbl">{label}</dt>
            <dd className="m-0 mt-1 text-[30px] leading-none font-black font-stretch-[112%] tabular-nums">
              {value}
              {note ? <small className="mt-1.5 block text-[13px] font-normal text-muted">{note}</small> : null}
            </dd>
          </div>
        ))}
      </dl>

      {playtime.mostPlayed ? (
        <p className="bg-surface px-[18px] py-3.5 text-[15px] text-text-2">
          Jogo mais jogado:{" "}
          <Link href={`/jogos/${playtime.mostPlayed.slug}`} className="font-extrabold text-text hover:text-acc">
            {playtime.mostPlayed.name}
          </Link>{" "}
          <b className="font-extrabold text-acc tabular-nums">{formatHours(playtime.mostPlayed.playtimeMin)}</b>
        </p>
      ) : null}

      <div className="grid gap-4 min-[901px]:grid-cols-2 min-[1101px]:grid-cols-3">
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

      <section className="relative bg-surface p-[18px] tk-cut before:absolute before:top-0 before:right-[10px] before:left-0 before:h-[2px] before:bg-line-2 before:content-['']">
        <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3.5 gap-y-1.5">
          <h3 className="text-[17px] leading-tight font-extrabold font-stretch-[80%] tracking-[0.06em] uppercase">Conquistas por ano</h3>
          {peakYear ? (
            <span className="text-[13.5px] text-muted">
              Pico em {peakYear.year}: {nf(peakYear.count)}
            </span>
          ) : null}
        </div>
        <YearChart rows={stats.achievementsByYear} />
      </section>
    </div>
  );
}
