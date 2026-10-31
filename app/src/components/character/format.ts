import { toLocalDay } from "@/lib/engine/streak";
import type { RarityTier } from "@/lib/engine/types";

export const formatNumber = (n: number) => n.toLocaleString("pt-BR");

export const formatPercent = (p: number) => String(p).replace(".", ",") + "%";

/** Short Portuguese relative time: "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias". */
export function formatAgo(date: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && toLocalDay(date) === toLocalDay(now)) return `há ${hours} h`;
  const dayDiff = Math.round(
    (new Date(`${toLocalDay(now)}T12:00:00Z`).getTime() -
      new Date(`${toLocalDay(date)}T12:00:00Z`).getTime()) /
      86_400_000,
  );
  if (dayDiff <= 0) return `há ${hours} h`;
  if (dayDiff === 1) return "ontem";
  return `há ${dayDiff} dias`;
}

export const RARITY_LABEL: Record<RarityTier, string> = {
  comum: "Comum",
  incomum: "Incomum",
  rara: "Rara",
  epica: "Épica",
  lendaria: "Lendária",
};

export const RARITY_COLOR: Record<RarityTier, string> = {
  comum: "var(--r-comum)",
  incomum: "var(--r-incomum)",
  rara: "var(--r-raro)",
  epica: "var(--r-epico)",
  lendaria: "var(--r-lendario)",
};
