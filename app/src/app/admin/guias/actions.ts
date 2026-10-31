"use server";

import { updateTag } from "next/cache";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { redirect } from "next/navigation";
import {
  createGuideForGame,
  guideInputSchema,
  guideStatusSchema,
  newGuideSchema,
  saveGuide,
  setGuideStatus,
} from "@/lib/admin/guides";
import { gameTag } from "@/lib/queries/games-cached";

/** Saves a guide from the editor; every save writes a GuideVersion (editor or admin). */
export async function saveGuideAction(raw: unknown): Promise<AdminResult<{ revision: number; stepIds: string[] }>> {
  const ready = await authorizeAction("staff", guideInputSchema, raw);
  if (!ready.ok) return ready;
  const result = await saveGuide(ready.data, ready.user.id);
  if (!result.ok) return result;
  updateTag(gameTag(result.gameSlug));
  return { ok: true, revision: result.revision, stepIds: result.stepIds };
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

/** Starts a draft guide for a game without one and opens it in the editor (editor or admin). */
export async function createGuideAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", newGuideSchema, raw);
  if (!ready.ok) return ready;
  const result = await createGuideForGame(ready.data, ready.user.id);
  if (!result.ok) return result;
  redirect(`/admin/guias/${result.id}`);
}
