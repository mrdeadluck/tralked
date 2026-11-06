import type { Character } from "@/lib/queries/players";
import { formatCompact } from "@/lib/xp-format";
import type { ProfileStat } from "@/components/profile/ProfileHeader";
import { formatNumber } from "./format";

/**
 * The Ficha's own numbers, after the header strip's shared numbers (Tralked, Platinas, Jogos;
 * components/profile/ProfileHeader): "Jogos 100%" is each game once, however many platforms/lists (not the strip's Tralked).
 */
export function characterStats(stats: Character["stats"], week?: { total: number; community: number }): ProfileStat[] {
  return [
    {
      label: "Conquistas",
      value: formatNumber(stats.achievements),
      note: stats.pendingReview > 0 ? `+${formatNumber(stats.pendingReview)} em análise` : "todas as plataformas",
    },
    { label: "Jogos 100%", value: formatNumber(stats.perfectGames), note: "cada jogo uma vez" },
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
