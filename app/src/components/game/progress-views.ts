import { PLATFORM_TOKEN } from "@/components/character/platforms";
import type { TrophyTier } from "@/lib/engine/trophies";
import {
  PLATFORM_NAME,
  type CatalogPlatform,
  type GameUserProfile,
  type PlatformTrophies,
} from "@/lib/queries/game-profile";
import type { ProgressView } from "./progress-parts";

const fmt = (n: number) => n.toLocaleString("pt-BR");

/**
 * The game's own numbers per platform, for a visitor without progress in it: each tab is one
 * platform's achievements and trophies (never the sum of every platform), the main platform first
 * selected. `note` closes the line under the number (the sign-in or connect link).
 */
export function catalogViews(
  platforms: CatalogPlatform[],
  main: CatalogPlatform,
  note: { prefix?: string; link: { href: string; label: string } },
): { views: ProgressView[]; initial: string } {
  const views = platforms.map((p): ProgressView => {
    const name = PLATFORM_NAME[p.platform];
    return {
      id: p.platform,
      label: name,
      color: PLATFORM_TOKEN[p.platform],
      unlocked: 0,
      total: p.total,
      pct: 0,
      completed: false,
      badge: fmt(p.total),
      catalog: true,
      detail: `${note.prefix ?? ""}${p.total === 1 ? "conquista" : "conquistas"} na ${name} · `,
      link: note.link,
      platLabel: `PLATINADO · ${fmt(p.total)}/${fmt(p.total)}`,
      // Without a native platinum the 100% earns the Tralked one: "+1", outside the total.
      trophies: {
        platinum: p.nativePlatinum ? fmt(p.tiers.platinum) : "+1",
        gold: fmt(p.tiers.gold),
        silver: fmt(p.tiers.silver),
        bronze: fmt(p.tiers.bronze),
      },
      trophiesLabel: p.nativePlatinum
        ? `Troféus do jogo na ${name}, por nível`
        : `Troféus do jogo na ${name}, por nível, mais a platina do Tralked pelos 100%`,
      tralkedPlatinum: !p.nativePlatinum,
    };
  });
  return { views, initial: main.platform };
}

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
    detail: `conquistas somadas de ${progress.byPlatform.length} plataformas · ${combined.pct}% no total · ${
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
      tralkedPlatinum: !p.platinumTrophy,
    };
  });
  return { views: [all, ...platforms], initial: progress.best.platform };
}
