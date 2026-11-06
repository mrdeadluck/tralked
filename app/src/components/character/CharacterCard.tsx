import type { Character } from "@/lib/queries/players";
import { formatCompact } from "@/lib/xp-format";
import type { ProfileStat } from "@/components/profile/ProfileHeader";
import { formatNumber } from "./format";

/**
 * The Ficha's own numbers, after the header strip's shared three (Platinas (contam no XP), Listas
 * regionais extras, Jogos; components/profile/ProfileHeader): its platinums are the strip's.
 */
export function characterStats(stats: Character["stats"], week?: { total: number; community: number }): ProfileStat[] {
  return [
    {
      label: "Conquistas",
      value: formatNumber(stats.achievements),
      note: stats.pendingReview > 0 ? `+${formatNumber(stats.pendingReview)} em análise` : "todas as plataformas",
    },
    { label: "Jogos 100%", value: formatNumber(stats.perfectGames), note: "TRALKED!" },
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
}
