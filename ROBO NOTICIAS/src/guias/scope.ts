import type { GuideDossier, SteamAchievement } from "./dossier.js";

/**
 * The PSN-list scope of a guide (R22): when no source covers the Steam-only achievements but a complete PSN script
 * (PowerPyx) gives the whole trophy list and the gate passes on it, the guide follows that list. The Steam
 * achievements outside it go to `steamOnly`: listed on the page, never given an invented how-to.
 */

/** What the writer needs to write a guide with scope "psn". */
export type PsnWriteScope = {
  /** The PSN list the guide follows (platinum included), names as the source lists them. */
  psnList: { total: number; names: string[] };
  /** Steam apiNames the guide has no route for, in Steam list order. */
  steamOnly: string[];
  /** Size of the Steam list (for honest numbers: "36 troféus na PSN, 66 conquistas na Steam"). */
  steamTotal: number;
};

/**
 * The dossier restricted to the PSN list, and the scope to write it with. Achievements outside the list leave the
 * dossier; an item that IS one of them leaves its chapter, and items stop counting toward them. A chapter that only
 * held such items goes too. Throws when the dossier has no full PSN list (the gate never passes without one).
 */
export function psnScope(d: GuideDossier, fullList: SteamAchievement[]): { dossier: GuideDossier; scope: PsnWriteScope } {
  const list = d.facts.psnList;
  if (!list) throw new Error("o dossiê não tem a lista inteira da PSN");
  const onList = new Set(list.matches.flatMap((m) => (m.apiName ? [m.apiName] : [])));
  const steam = fullList.filter((s) => s.platform === "steam");
  const steamOnly = steam.map((s) => s.apiName).filter((apiName) => !onList.has(apiName));
  const off = new Set(steamOnly);

  const chapters = d.chapters
    .map((c) => ({
      ...c,
      items: c.items
        .filter((i) => !(i.achievement && off.has(i.achievement)))
        .map((i) => ({ ...i, countsFor: i.countsFor.filter((apiName) => !off.has(apiName)) })),
    }))
    .filter((c, n) => c.items.length > 0 || d.chapters[n]!.items.length === 0)
    .map((c, at) => ({ ...c, order: at + 1 }));
  const kept = new Set(chapters.map((c) => c.title));

  return {
    dossier: {
      ...d,
      chapters,
      achievements: d.achievements.filter((a) => onList.has(a.apiName)),
      ...(d.primaryScript ? { primaryScript: { ...d.primaryScript, chapters: d.primaryScript.chapters.filter((t) => kept.has(t)) } } : {}),
    },
    scope: { psnList: { total: list.total, names: [...list.names] }, steamOnly, steamTotal: steam.length },
  };
}
