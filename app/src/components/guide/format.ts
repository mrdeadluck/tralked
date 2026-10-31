import type { RarityTier } from "@/lib/engine/types";

export const fmt = (n: number) => n.toLocaleString("pt-BR");

export const fmtK = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1).replace(".", ",")}M`
    : n >= 1e3
      ? `${Math.round(n / 1e3)}k`
      : String(n);

/** Share of players, e.g. 17.5 -> "17,5%". */
export const pctText = (pct: number | null) =>
  pct === null ? "--" : `${String(pct).replace(".", ",")}%`;

export const RARITY_UI: Record<RarityTier, { label: string; color: string }> = {
  comum: { label: "Comum", color: "var(--r-comum)" },
  incomum: { label: "Incomum", color: "var(--r-incomum)" },
  rara: { label: "Rara", color: "var(--r-raro)" },
  epica: { label: "Épica", color: "var(--r-epico)" },
  lendaria: { label: "Lendária", color: "var(--r-lendario)" },
};

export const CATEGORY_NAME: Record<string, string> = {
  historia: "História",
  chefes: "Chefe",
  coletaveis: "Coletável",
  desafio: "Desafio",
  dlc: "Expansão",
};

export const ACHIEVEMENT_FILTERS = [
  { id: "todas", label: "Todas" },
  { id: "pendentes", label: "Pendentes" },
  { id: "historia", label: "História" },
  { id: "chefes", label: "Chefes" },
  { id: "coletaveis", label: "Coletáveis" },
  { id: "desafio", label: "Desafio" },
  { id: "dlc", label: "Expansões" },
];

/** "hoje", "ontem", "há 3 dias", "há 2 meses", "há 1 ano". */
export function timeAgo(date: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
  if (days < 1) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `há ${months} ${months === 1 ? "mês" : "meses"}`;
  }
  const years = Math.floor(days / 365);
  return `há ${years} ${years === 1 ? "ano" : "anos"}`;
}

/** The Tralked login page, coming back to `path` afterwards. */
export const loginHref = (path: string) => `/entrar?returnTo=${encodeURIComponent(path)}`;
