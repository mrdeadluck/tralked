/**
 * The daily mix (spec "Variedade"): each slot still goes to the best story, but the score is nudged by
 * what already came out today, so the day is varied:
 * - Steam/PC gets a small bonus (the site's main platform, without dominating);
 * - Nintendo gets a bigger one while it has not come out today, for a story at least `nintendoMinScore`;
 * - a topic that came out `topicCap` times today, or a platform that came out `platformCap` times (except
 *   `multi`), is penalized while other stories exist.
 * Bombs do not go through the mix (`nextQueued` puts them first).
 */
export const MIX = {
  steamPcBonus: 6,
  nintendoBonus: 15,
  nintendoMinScore: 50,
  topicCap: 3,
  platformCap: 6,
  overCapPenalty: 25,
} as const;

export type DayMix = { topics: Record<string, number>; platforms: Record<string, number> };

export function mixScore(story: { score: number; topic: string | null; platforms: string[] }, today: DayMix): number {
  const platforms = [...new Set(story.platforms)];
  let score = story.score;
  if (platforms.includes("steam-pc")) score += MIX.steamPcBonus;
  if (platforms.includes("nintendo") && !(today.platforms.nintendo ?? 0) && story.score >= MIX.nintendoMinScore) {
    score += MIX.nintendoBonus;
  }
  if (story.topic && (today.topics[story.topic] ?? 0) >= MIX.topicCap) score -= MIX.overCapPenalty;
  for (const p of platforms) {
    if (p !== "multi" && (today.platforms[p] ?? 0) >= MIX.platformCap) score -= MIX.overCapPenalty;
  }
  return score;
}
