import type { DossierAchievement, GuideDossier, SteamAchievement } from "./dossier.js";

/**
 * The completeness gate: the robot only sends a guide that passes. `missing` has one Portuguese sentence per gap.
 *
 * Scope "steam" (the default) fails when (a) a Steam achievement (hidden ones included) has no source, (b) a
 * Steam-only achievement has no Steam source, (c) a "collect N" count does not add up (R23: at least N, each item
 * with a location and a unique number; exactly N only when a source says the game has N), (d) a missable cannot be
 * tied to any chapter (R20: with no milestone that points to a chapter, its own chapter is the deadline, so (d)
 * only catches a missable achievement that no item of the walkthrough is), (e) no script source is complete.
 * Divergences between sources never fail it on their own.
 *
 * Scope "psn" (R22) judges the PSN trophy list instead of the Steam one: it needs the whole list from a complete
 * PSN script (`facts.psnList`), at most one platinum, every other trophy matched to its own Steam achievement, and (a), (c), (d), (e)
 * on those. The Steam achievements outside the list are left out of the guide (`steamOnly`), so (b) does not apply.
 */

export type GateScope = "steam" | "psn";
export type GateResult = { ok: boolean; missing: string[] };

export const NO_PSN_LIST = "Nenhuma fonte de roteiro da PSN completa traz a lista inteira de troféus (o total e todos os nomes).";

const label = (name: string, apiName: string) => `"${name}" (${apiName})`;

/** Rules (a), (c) and (d) of one achievement of the list being judged; (b) only for the Steam list. */
function achievementGaps(steam: SteamAchievement, a: DossierAchievement | undefined, scope: GateScope): string[] {
  const name = label(steam.name, steam.apiName);
  if (!a || a.sources.length === 0) return [`A conquista ${steam.hidden ? "oculta " : ""}${name} da Steam não aparece em nenhuma fonte.`];
  const missing: string[] = [];
  if (scope === "steam" && a.steamOnly && !a.steamSourced) {
    missing.push(`A conquista ${name} existe só na Steam e nenhuma fonte da Steam a cobre.`);
  }
  const c = a.collect;
  if (c) {
    const short = c.exact ? Math.abs(c.counted - c.target) > 1e-6 : c.counted < c.target - 1e-6;
    if (c.conflictingTotals.length > 0) {
      missing.push(`As fontes discordam do total da conquista ${name}: ${c.conflictingTotals.join(" e ")}.`);
    } else if (short) {
      const parts = c.byType?.unconverted ?? 0;
      const why = parts > 0 ? ` (${parts} ${parts === 1 ? "fragmento" : "fragmentos"} sem regra de conversão nas fontes)` : "";
      missing.push(`A conquista ${name} pede ${c.target}, mas os itens encontrados somam ${c.counted}${why}.`);
    }
    for (const item of c.withoutLocation) missing.push(`O item "${item}" da conquista ${name} está sem localização.`);
    for (const problem of c.indexProblems) missing.push(`A contagem da conquista ${name} está errada: ${problem}.`);
  }
  if (a.missable && !a.deadlineChapter) {
    missing.push(
      `O perdível ${name} não está ligado a nenhum capítulo: o "até quando" das fontes não aponta para um capítulo e nenhum item do roteiro é ele.`,
    );
  }
  return missing;
}

/** Rule (d) for items that are no achievement, and rule (e): the same in both scopes. */
function walkthroughGaps(d: GuideDossier): string[] {
  const missing: string[] = [];
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
  return missing;
}

export function gate(d: GuideDossier, fullList: SteamAchievement[], opts: { scope?: GateScope } = {}): GateResult {
  const scope = opts.scope ?? "steam";
  const steamList = fullList.filter((s) => s.platform === "steam");
  const byApiName = new Map(d.achievements.map((a) => [a.apiName, a]));
  const missing: string[] = [];

  if (scope === "steam") {
    for (const steam of steamList) missing.push(...achievementGaps(steam, byApiName.get(steam.apiName), scope));
  } else {
    const list = d.facts.psnList;
    if (!list) return { ok: false, missing: [NO_PSN_LIST] };
    const top = list.matches.filter((m) => m.platinum);
    if (top.length > 1) {
      missing.push(
        `A lista da PSN marca ${top.length} troféus como o troféu máximo (${top.map((m) => `"${m.name}"`).join(", ")}); só pode haver um.`,
      );
    }
    const steamBy = new Map(steamList.map((s) => [s.apiName, s]));
    const trophyOf = new Map<string, string>();
    for (const trophy of list.matches) {
      if (trophy.platinum) continue;
      const steam = trophy.apiName ? steamBy.get(trophy.apiName) : undefined;
      if (!steam) {
        missing.push(`O troféu "${trophy.name}" da lista da PSN não casa com nenhuma conquista da Steam.`);
        continue;
      }
      // One Steam achievement per trophy: two trophies on one achievement would hide a missing one.
      const twin = trophyOf.get(steam.apiName);
      if (twin !== undefined) {
        missing.push(`Os troféus "${twin}" e "${trophy.name}" da lista da PSN casam com a mesma conquista da Steam (${steam.apiName}).`);
        continue;
      }
      trophyOf.set(steam.apiName, trophy.name);
      missing.push(...achievementGaps(steam, byApiName.get(steam.apiName), scope));
    }
  }

  missing.push(...walkthroughGaps(d));
  return { ok: missing.length === 0, missing };
}
