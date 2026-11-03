"use server";

import { updateTag } from "next/cache";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { redirect } from "next/navigation";
import {
  createGuideForGame,
  guideInputSchema,
  guideStatusSchema,
  newGuideSchema,
  pendingUpdateSchema,
  saveGuide,
  setGuideStatus,
} from "@/lib/admin/guides";
import { applyPendingUpdate, discardPendingUpdate, PendingUpdateError } from "@/lib/api/guide-pending";
import { gameTag } from "@/lib/queries/games-cached";
import { GUIDES_TAG } from "@/lib/queries/home-guides";

/** The game's pages and the home's list of guides, read fresh by the editor's next request. */
function refreshGuide(gameSlug: string) {
  updateTag(gameTag(gameSlug));
  updateTag(GUIDES_TAG);
}

/** Saves a guide from the editor; every save writes a GuideVersion (editor or admin). */
export async function saveGuideAction(raw: unknown): Promise<AdminResult<{ revision: number; stepIds: string[] }>> {
  const ready = await authorizeAction("staff", guideInputSchema, raw);
  if (!ready.ok) return ready;
  const result = await saveGuide(ready.data, ready.user.id);
  if (!result.ok) return result;
  refreshGuide(result.gameSlug);
  return { ok: true, revision: result.revision, stepIds: result.stepIds };
}

/** Workflow move from the review queue. */
export async function setGuideStatusAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", guideStatusSchema, raw);
  if (!ready.ok) return ready;
  const result = await setGuideStatus(ready.data, ready.user.id);
  if (!result.ok) return result;
  refreshGuide(result.gameSlug);
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

/** Applies a bot update of a published guide: the guide changes and a GuideVersion is saved. */
export async function applyPendingUpdateAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", pendingUpdateSchema, raw);
  if (!ready.ok) return ready;
  try {
    const { gameSlug } = await applyPendingUpdate(ready.data.id, ready.user.id);
    refreshGuide(gameSlug);
    return { ok: true };
  } catch (error) {
    if (error instanceof PendingUpdateError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Throws away a bot update of a published guide; the guide stays as it is. */
export async function discardPendingUpdateAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", pendingUpdateSchema, raw);
  if (!ready.ok) return ready;
  const discarded = await discardPendingUpdate(ready.data.id);
  if (discarded) updateTag(gameTag(discarded.gameSlug));
  return { ok: true };
}
