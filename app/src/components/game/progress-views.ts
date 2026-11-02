import { PLATFORM_TOKEN } from "@/components/character/platforms";
import type { TrophyTier } from "@/lib/engine/trophies";
import { PLATFORM_NAME, type GameUserProfile, type PlatformTrophies } from "@/lib/queries/game-profile";
import type { ProgressView } from "./progress-parts";

const fmt = (n: number) => n.toLocaleString("pt-BR");

function trophyValues(t: PlatformTrophies): Record<TrophyTier, string> {
  return { platinum: `${t.platinum}/${t.platinumOf}`, gold: fmt(t.gold), silver: fmt(t.silver), bronze: fmt(t.bronze) };
}

const left = (unlocked: number, total: number) => {
  const n = Math.max(0, total - unlocked);
  return n === 1 ? "falta 1" : `faltam ${fmt(n)}`;
};

/**
 * The game page's platform tabs for a player with the game on more than one platform: "Todas"
 * (every platform together) first, then each platform in PLATFORM_ORDER. Null with a single
 * platform (the page shows it as before, without tabs). `initial` is the platform with the most
 * progress.
 */
export function progressViews(
  progress: NonNullable<GameUserProfile["progress"]>,
): { views: ProgressView[]; initial: string } | null {
  if (progress.byPlatform.length < 2) return null;
  const { combined } = progress;
  const all: ProgressView = {
    id: "todas",
    label: "Todas",
    color: null,
    unlocked: combined.unlocked,
    total: combined.total,
    pct: combined.pct,
    completed: combined.completed,
    badge: combined.completed ? "100%" : null,
    detail: `conquistas em ${progress.byPlatform.length} plataformas · ${combined.pct}% no total · ${
      combined.completed ? "tudo platinado" : `${left(combined.unlocked, combined.total)} no total`
    }`,
    platLabel: `PLATINADO · ${combined.unlocked}/${combined.total}`,
    trophies: trophyValues(combined.trophies),
    trophiesLabel: "Seus troféus neste jogo em todas as plataformas, por nível",
  };
  const platforms = progress.byPlatform.map((p): ProgressView => {
    const name = PLATFORM_NAME[p.platform];
    return {
      id: p.platform,
      label: name,
      color: PLATFORM_TOKEN[p.platform],
      unlocked: p.unlocked,
      total: p.total,
      pct: p.pct,
      completed: p.completed,
      badge: p.completed ? (p.platinumTrophy ? "Platina" : "100%") : null,
      detail: p.completed
        ? `conquistas na ${name} · 100% · platinado`
        : `conquistas na ${name} · ${p.pct}% · ${left(p.unlocked, p.total)} para platinar`,
      platLabel: `PLATINADO · ${p.unlocked}/${p.total}`,
      trophies: trophyValues(p.trophies),
      trophiesLabel: `Seus troféus na ${name}, por nível`,
    };
  });
  return { views: [all, ...platforms], initial: progress.best.platform };
}
