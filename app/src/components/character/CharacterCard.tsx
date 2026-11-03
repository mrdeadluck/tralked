import type { Character } from "@/lib/queries/players";
import { formatCompact } from "@/lib/xp-format";
import { formatNumber } from "./format";

type CharacterStatsProps = {
  stats: Character["stats"];
  /** XP of the last 7 days and its community part (what the Esta semana ranking counts). */
  week?: { total: number; community: number };
};

/**
 * The six numbers of the character, as the bottom strip of the profile header: two rows of three
 * on tablets, three of two on phones, one row of six on wide screens.
 */
export function CharacterStats({ stats, week }: CharacterStatsProps) {
  const items: { label: string; value: string; note?: string; title?: string; hot?: boolean }[] = [
    {
      label: "Conquistas",
      value: formatNumber(stats.achievements),
      note: stats.pendingReview > 0 ? `+${formatNumber(stats.pendingReview)} em análise` : "todas as plataformas",
    },
    { label: "Jogos 100%", value: formatNumber(stats.perfectGames), note: "TRALKED!" },
    // Same rule and function as the Troféus card: a 100% per platform, or the PSN platinum trophy.
    { label: "Platinas", value: formatNumber(stats.platinums), note: "em todas as plataformas" },
    { label: "Lendárias", value: formatNumber(stats.legendary), note: "até 3% dos jogadores" },
    {
      label: "Ranking geral",
      value: stats.rank === null ? "—" : `#${formatNumber(stats.rank)}`,
      note: stats.rank === null ? "perfil privado" : "de todo o Tralked",
      hot: stats.rank !== null,
    },
    {
      label: "XP esta semana",
      value: week ? formatCompact(week.total) : "—",
      note: week && week.community > 0 ? `${formatCompact(week.community)} da comunidade` : "nos últimos 7 dias",
      title: week ? `${formatNumber(week.total)} XP nos últimos 7 dias` : undefined,
    },
  ];
  return (
    <dl className="m-0 grid grid-cols-2 gap-0.5 border-t border-line min-[761px]:grid-cols-3 min-[1101px]:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 bg-[color-mix(in_oklch,var(--bg)_55%,transparent)] px-4 py-3">
          <dt className="tk-lbl">{item.label}</dt>
          <dd
            className={`m-0 text-[22px] leading-[1.05] font-extrabold font-stretch-[110%] tabular-nums ${item.hot ? "text-acc" : ""}`}
            title={item.title}
          >
            {item.value}
          </dd>
          {item.note ? <dd className="m-0 text-[12.5px] text-muted">{item.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
