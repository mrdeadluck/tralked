"use server";

import { updateTag } from "next/cache";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { decideReport, moderateContent, moderationSchema, reportDecisionSchema } from "@/lib/admin/moderation";
import { recomputeQuietly } from "@/lib/community/xp";

/** Hide, remove, restore, lock or unlock community content (admin, editor or moderator). */
export async function moderateAction(raw: unknown): Promise<AdminResult<{ voided: number }>> {
  const ready = await authorizeAction("moderation", moderationSchema, raw);
  if (!ready.ok) return ready;
  const result = await moderateContent(ready.data, ready.user.id);
  if (!result.ok) return result;
  for (const tag of new Set(result.tags)) updateTag(tag);
  for (const userId of result.recompute) await recomputeQuietly(userId);
  return { ok: true, voided: result.voided };
}

/** Closes a report as resolved or dismissed. */
export async function decideReportAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("moderation", reportDecisionSchema, raw);
  if (!ready.ok) return ready;
  return decideReport(ready.data, ready.user.id);
}
