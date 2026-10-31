"use server";

import { updateTag } from "next/cache";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { articleInputSchema, articleStatusSchema, saveArticle, setArticleStatus } from "@/lib/admin/articles";
import { gameTag } from "@/lib/queries/games-cached";
import { articleTag, NEWS_TAG } from "@/lib/queries/news";

/** Creates or updates an article (editor or admin). */
export async function saveArticleAction(raw: unknown): Promise<AdminResult<{ id: string; slug: string }>> {
  const ready = await authorizeAction("staff", articleInputSchema, raw);
  if (!ready.ok) return ready;
  const result = await saveArticle(ready.data, ready.user);
  if (!result.ok) return result;
  updateTag(NEWS_TAG);
  updateTag(articleTag(result.slug));
  if (result.previousSlug && result.previousSlug !== result.slug) updateTag(articleTag(result.previousSlug));
  for (const slug of result.gameSlugs) updateTag(gameTag(slug));
  return { ok: true, id: result.id, slug: result.slug };
}

/** Workflow move from the lists and the review queue (publish, back to draft, archive). */
export async function setArticleStatusAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", articleStatusSchema, raw);
  if (!ready.ok) return ready;
  const result = await setArticleStatus(ready.data);
  if (!result.ok) return result;
  updateTag(NEWS_TAG);
  updateTag(articleTag(result.slug));
  return { ok: true };
}
