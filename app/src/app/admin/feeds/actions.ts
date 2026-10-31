"use server";

import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { deleteFeed, feedIdSchema, feedSchema, saveFeed } from "@/lib/admin/catalog";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { NEWS_TAG } from "@/lib/queries/news";
import { syncExternalNews } from "@/lib/sync/external-news";

/** Creates or edits an RSS feed (https only; admin only). */
export async function saveFeedAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("admin", feedSchema, raw);
  if (!ready.ok) return ready;
  return saveFeed(ready.data);
}

export async function deleteFeedAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("admin", feedIdSchema, raw);
  if (!ready.ok) return ready;
  return deleteFeed(ready.data.id);
}

/** Reads every active feed now, after the response (same job as the cron; admin only). */
export async function syncNewsAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("admin", z.strictObject({}), raw ?? {});
  if (!ready.ok) return ready;
  after(async () => {
    try {
      const result = await syncExternalNews();
      if (result.created > 0) revalidateTag(NEWS_TAG, "max");
    } catch (error) {
      console.error("Admin: external news sync failed", error instanceof Error ? error.message : error);
    }
  });
  return { ok: true };
}
