import type { GuideDossier, SteamAchievement } from "./dossier.js";

/**
 * The completeness gate: the robot only sends a guide that passes. `missing` has one Portuguese sentence per gap.
 * Fails when (a) a Steam achievement (hidden ones included) has no source, (b) a Steam-only achievement has no
 * Steam source, (c) a "collect N" count does not add up, (d) a missable has no milestone tied to a chapter,
 * (e) the only script source is not complete. Divergences between sources never fail it on their own.
 */
export function gate(d: GuideDossier, steamList: SteamAchievement[]): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const byApiName = new Map(d.achievements.map((a) => [a.apiName, a]));

  for (const steam of steamList) {
    const a = byApiName.get(steam.apiName);
    const label = `"${steam.name}" (${steam.apiName})`;
    if (!a || a.sources.length === 0) {
      missing.push(`A conquista ${steam.hidden ? "oculta " : ""}${label} da Steam não aparece em nenhuma fonte.`);
      continue;
    }
    if (a.steamOnly && !a.steamSourced) {
      missing.push(`A conquista ${label} existe só na Steam e nenhuma fonte da Steam a cobre.`);
    }
    if (a.collect && Math.abs(a.collect.counted - a.collect.target) > 1e-6) {
      missing.push(`A conquista ${label} pede ${a.collect.target}, mas os itens encontrados somam ${a.collect.counted}.`);
    }
    if (a.missable && !a.deadlineChapter) {
      missing.push(`O perdível ${label} não tem um marco "até quando" ligado a um capítulo.`);
    }
  }

  for (const chapter of d.chapters) {
    for (const item of chapter.items) {
      // An item that is an achievement is judged through the achievement above.
      if (item.missable && !item.achievement && !item.deadlineChapter) {
        missing.push(`O perdível "${item.name}" (capítulo ${chapter.title}) não tem um marco "até quando" ligado a um capítulo.`);
      }
    }
  }

  if (d.scripts.length === 0) {
    missing.push("Nenhuma fonte de roteiro foi lida.");
  } else if (d.scripts.length === 1 && !d.scripts[0]!.complete) {
    missing.push(`A única fonte de roteiro (${d.scripts[0]!.name}) não está completa.`);
  }

  return { ok: missing.length === 0, missing };
}
