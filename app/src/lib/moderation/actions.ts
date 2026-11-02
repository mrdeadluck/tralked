"use server";

import { updateTag } from "next/cache";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { recomputeQuietly } from "@/lib/community/xp";
import { gameTag } from "@/lib/queries/games-cached";
import { articleTag, NEWS_TAG } from "@/lib/queries/news";
import { commentModerationSchema, discussionLockSchema, moderateComment, setDiscussionLock } from "./comments";
import { articleModerationSchema, guideRemovalSchema, moderateArticle, removeGuide } from "./content";
import { applySanction, liftSanction, liftSanctionSchema, sanctionSchema } from "./sanctions";

/**
 * Moderation from the public pages and /admin/moderacao. Every action reads the session and the
 * role from the database (authorizeAction): "moderation" = admin, editor or moderator;
 * "staff" (articles) = admin or editor.
 */

/** Remove, pin or unpin a comment from its discussion. */
export async function moderateCommentAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("moderation", commentModerationSchema, raw);
  if (!ready.ok) return ready;
  const result = await moderateComment(ready.data, ready.user.id);
  if (!result.ok) return result;
  for (const tag of new Set(result.tags)) updateTag(tag);
  for (const userId of result.recompute) await recomputeQuietly(userId);
  return { ok: true };
}

/** Lock or unlock the comments of an article, guide, photo or thread. */
export async function lockDiscussionAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("moderation", discussionLockSchema, raw);
  if (!ready.ok) return ready;
  return setDiscussionLock(ready.data, ready.user.id);
}

/** Unpublish an article, or change its category or highlight, from the article page. */
export async function moderateArticleAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", articleModerationSchema, raw);
  if (!ready.ok) return ready;
  const result = await moderateArticle(ready.data, ready.user.id);
  if (!result.ok) return result;
  updateTag(NEWS_TAG);
  updateTag(articleTag(result.slug));
  return { ok: true };
}

/** Take a published guide off the site (the author is told). */
export async function removeGuideAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("moderation", guideRemovalSchema, raw);
  if (!ready.ok) return ready;
  const result = await removeGuide(ready.data, ready.user.id);
  if (!result.ok) return result;
  updateTag(gameTag(result.gameSlug));
  return { ok: true };
}

/** Mute or ban a user until a date. */
export async function sanctionUserAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("moderation", sanctionSchema, raw);
  if (!ready.ok) return ready;
  return applySanction(ready.user, ready.data);
}

/** End a mute or ban before its date. */
export async function liftSanctionAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("moderation", liftSanctionSchema, raw);
  if (!ready.ok) return ready;
  return liftSanction(ready.user, ready.data);
}
