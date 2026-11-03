import type { GuideDossier, SteamAchievement } from "./dossier.js";

/**
 * The completeness gate: the robot only sends a guide that passes. `missing` has one Portuguese sentence per gap.
 * Fails when (a) a Steam achievement (hidden ones included) has no source, (b) a Steam-only achievement has no
 * Steam source, (c) a "collect N" count does not add up, (d) a missable cannot be tied to any chapter (R20: with no
 * milestone that points to a chapter, its own chapter is the deadline, so (d) only catches a missable achievement
 * that no item of the walkthrough is), (e) no script source is complete. Divergences between sources never fail it
 * on their own.
 */
export function gate(d: GuideDossier, fullList: SteamAchievement[]): { ok: boolean; missing: string[] } {
  const steamList = fullList.filter((s) => s.platform === "steam");
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
    const c = a.collect;
    if (c) {
      if (c.conflictingTotals.length > 0) {
        missing.push(`As fontes discordam do total da conquista ${label}: ${c.conflictingTotals.join(" e ")}.`);
      } else if (Math.abs(c.counted - c.target) > 1e-6) {
        missing.push(`A conquista ${label} pede ${c.target}, mas os itens encontrados somam ${c.counted}.`);
      }
      for (const name of c.withoutLocation) missing.push(`O item "${name}" da conquista ${label} está sem localização.`);
      for (const problem of c.indexProblems) missing.push(`A contagem da conquista ${label} está errada: ${problem}.`);
    }
    if (a.missable && !a.deadlineChapter) {
      missing.push(
        `O perdível ${label} não está ligado a nenhum capítulo: o "até quando" das fontes não aponta para um capítulo e nenhum item do roteiro é ele.`,
      );
    }
  }

  for (const chapter of d.chapters) {
    for (const item of chapter.items) {
      // An item that is an achievement is judged through the achievement above.
      if (item.missable && !item.achievement && !item.deadlineChapter) {
        missing.push(`O perdível "${item.name}" (capítulo ${chapter.title}) não está ligado a nenhum capítulo.`);
      }
    }
  }

  if (d.scripts.length === 0) {
    missing.push("Nenhuma fonte de roteiro foi lida.");
  } else if (!d.scripts.some((s) => s.complete)) {
    // A work-in-progress script is a secondary source, never the only one.
    missing.push(
      d.scripts.length === 1
        ? `A única fonte de roteiro (${d.scripts[0]!.name}) não está completa.`
        : `Nenhuma fonte de roteiro está completa (${d.scripts.map((s) => s.name).join(", ")}).`,
    );
  }

  return { ok: missing.length === 0, missing };
}
