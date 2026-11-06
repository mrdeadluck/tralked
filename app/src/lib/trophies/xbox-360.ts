import { findBursts } from "@/lib/engine/fraud";
import type { XboxApi } from "@/lib/integrations/xbox/types";
import { describeError } from "@/lib/worker/errors";

export type X360TitleMeasure = {
  titleId: string;
  name: string;
  status: "ok" | "failed";
  /** The list as the sync would record it: its achievements, the earned ones, those with a date. */
  achievements: number;
  earned: number;
  dated: number;
  /** What the title history says (its totals are real for 360 titles). */
  history: { total: number; earned: number };
  error?: string;
};

export type X360Measure = {
  /** Xbox 360 titles with an unlock in the history (those a sync reads). */
  found: number;
  titles: X360TitleMeasure[];
  /** Titles left out by `maxTitles` (the request budget). */
  skipped: number;
  totals: { titles: number; achievements: number; earned: number; dated: number };
  /**
   * Earned 360 unlocks the burst rule (lib/engine/fraud findBursts) would flag on their dates,
   * together with the player's other Xbox unlocks (`others`).
   */
  bursts: number;
  /** One icon URL of the lists read (to check the 360 image CDN formula by hand). */
  sampleIcon: string | null;
};

/**
 * Read-only: what a sync would import of a player's Xbox 360 titles, through the client's 360
 * routes (one history request, then two per title). `maxTitles` bounds the requests (OpenXBL's
 * quota is shared with production).
 */
export async function measureX360(
  xbox: Pick<XboxApi, "getTitles" | "getAchievements">,
  xuid: string,
  { maxTitles = Infinity, others = [] }: { maxTitles?: number; others?: { achievementId: string; unlockedAt: Date }[] } = {},
): Promise<X360Measure | "private"> {
  const history = await xbox.getTitles(xuid);
  if (history === "private") return "private";
  const x360 = history.filter((t) => t.devices.includes("Xbox360") && t.currentAchievements > 0);
  const asked = x360.slice(0, maxTitles);
  const titles: X360TitleMeasure[] = [];
  const dated: { achievementId: string; unlockedAt: Date }[] = [];
  let sampleIcon: string | null = null;
  for (const t of asked) {
    const base = { titleId: t.titleId, name: t.name, history: { total: t.totalAchievements, earned: t.currentAchievements } };
    try {
      const list = await xbox.getAchievements(xuid, t.titleId, t.devices);
      if (list === "private") return "private";
      const earned = list.filter((a) => a.unlocked);
      sampleIcon ??= list.find((a) => a.iconUrl)?.iconUrl ?? null;
      for (const a of earned) if (a.unlockedAt) dated.push({ achievementId: `x360:${t.titleId}:${a.id}`, unlockedAt: a.unlockedAt });
      titles.push({ ...base, status: "ok", achievements: list.length, earned: earned.length, dated: earned.filter((a) => a.unlockedAt).length });
    } catch (error) {
      titles.push({ ...base, status: "failed", achievements: 0, earned: 0, dated: 0, error: describeError(error).slice(0, 200) });
    }
  }
  const ok = titles.filter((t) => t.status === "ok");
  const flagged = findBursts([...others, ...dated]);
  return {
    found: x360.length,
    titles,
    skipped: x360.length - asked.length,
    totals: {
      titles: ok.length,
      achievements: ok.reduce((sum, t) => sum + t.achievements, 0),
      earned: ok.reduce((sum, t) => sum + t.earned, 0),
      dated: ok.reduce((sum, t) => sum + t.dated, 0),
    },
    bursts: dated.filter((d) => flagged.has(d.achievementId)).length,
    sampleIcon,
  };
}
