"use server";

import { updateTag } from "next/cache";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { guideInputSchema, guideStatusSchema, saveGuide, setGuideStatus } from "@/lib/admin/guides";
import { gameTag } from "@/lib/queries/games-cached";

/** Saves a guide from the editor; every save writes a GuideVersion (editor or admin). */
export async function saveGuideAction(raw: unknown): Promise<AdminResult<{ revision: number }>> {
  const ready = await authorizeAction("staff", guideInputSchema, raw);
  if (!ready.ok) return ready;
  const result = await saveGuide(ready.data, ready.user.id);
  if (!result.ok) return result;
  updateTag(gameTag(result.gameSlug));
  return { ok: true, revision: result.revision };
}

/** Workflow move from the review queue. */
export async function setGuideStatusAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", guideStatusSchema, raw);
  if (!ready.ok) return ready;
  const result = await setGuideStatus(ready.data, ready.user.id);
  if (!result.ok) return result;
  updateTag(gameTag(result.gameSlug));
  return { ok: true };
}
