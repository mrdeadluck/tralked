import { z } from "zod";

// Pure reaction rules (item 17), safe to import from client components. The database side is in
// ./reactions.ts.

export const REACTION_TARGETS = ["article", "comment", "photo", "guide"] as const;
export type ReactionTargetType = (typeof REACTION_TARGETS)[number];
export type ReactionValue = 1 | -1;
/** The viewer's reaction to an item: 1 like, -1 dislike, 0 none. */
export type MyReaction = ReactionValue | 0;

export const reactSchema = z.object({
  targetType: z.enum(REACTION_TARGETS),
  targetId: z.string().min(1).max(64),
  value: z.union([z.literal(1), z.literal(-1)]),
});

export type ReactionCounts = { likes: number; dislikes: number };

/** What a click does: the same button again removes the reaction, the other one switches. */
export function nextReaction(current: MyReaction, clicked: ReactionValue): MyReaction {
  return current === clicked ? 0 : clicked;
}

/** Counts after moving from `before` to `after` (optimistic UI; the server recounts for real). */
export function applyReaction(counts: ReactionCounts, before: MyReaction, after: MyReaction): ReactionCounts {
  const likes = counts.likes - (before === 1 ? 1 : 0) + (after === 1 ? 1 : 0);
  const dislikes = counts.dislikes - (before === -1 ? 1 : 0) + (after === -1 ? 1 : 0);
  return { likes: Math.max(0, likes), dislikes: Math.max(0, dislikes) };
}

/**
 * Who may earn XP for a reaction (before the daily caps and the once-per-item rule): the reactor
 * for any reaction, the author only for a like; nobody when the reaction was removed or the item
 * is the reactor's own.
 */
export function reactionXpPlan(input: {
  reactorId: string;
  ownerId: string | null;
  value: MyReaction;
}): { giver: boolean; receiverId: string | null } {
  if (input.value === 0 || input.ownerId === input.reactorId) return { giver: false, receiverId: null };
  return { giver: true, receiverId: input.value === 1 ? input.ownerId : null };
}
