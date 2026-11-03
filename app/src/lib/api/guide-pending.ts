import type { Prisma } from "@/generated/prisma/client";
import { guidePatchSchema } from "@/lib/content/guide-schema";
import { prisma } from "@/lib/db";
import { applyGuidePatch, patchIssues } from "./guides";

/**
 * Updates of a PUBLISHED guide sent by a key without `publish`: they wait here (the guide on the
 * site does not change) until an editor applies or discards them in the admin.
 */

type Tx = Prisma.TransactionClient;

/** Raised when a pending update cannot be applied any more (the message is for the editor). */
export class PendingUpdateError extends Error {}

/** Stores the whole patch the bot sent. Runs inside the write transaction. */
export async function queuePendingUpdate(
  tx: Tx,
  guideId: string,
  botKeyId: string,
  payload: Prisma.InputJsonValue,
): Promise<{ pendingId: string }> {
  const row = await tx.guidePendingUpdate.create({ data: { guideId, botKeyId, payload }, select: { id: true } });
  return { pendingId: row.id };
}

/**
 * Applies a pending update to its guide (the guide keeps its status) and saves a GuideVersion
 * authored by the editor. The patch is validated again against the guide as it is NOW; readers'
 * item ticks whose key left the walkthrough are removed. Returns the game slug (cache tag).
 */
export async function applyPendingUpdate(pendingId: string, editorId: string): Promise<{ gameSlug: string }> {
  const pending = await prisma.guidePendingUpdate.findUnique({
    where: { id: pendingId },
    select: {
      id: true,
      payload: true,
      guide: {
        select: { id: true, status: true, gameId: true, format: true, walkthrough: true, missables: true, game: { select: { slug: true } } },
      },
    },
  });
  if (!pending) throw new PendingUpdateError("Esta atualização não existe mais.");
  const parsed = guidePatchSchema.safeParse(pending.payload);
  if (!parsed.success) throw new PendingUpdateError("A atualização guardada não é mais válida. Descarte-a.");
  // The guide stays as it is (published): applyGuidePatch takes the status from its options, so a
  // status in the patch is not the editor's decision.
  const patch = parsed.data;
  const guide = pending.guide;

  const { noteIds, issues } = await patchIssues(guide, patch);
  if (issues.length > 0) {
    throw new PendingUpdateError(`A atualização não bate mais com o guia: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
  }
  await prisma.$transaction(
    async (tx) => {
      const written = await applyGuidePatch(tx, guide, patch, noteIds, { status: guide.status, authorId: editorId });
      if (!written.ok) throw new PendingUpdateError(written.issues?.[0]?.message ?? written.message);
      await tx.guidePendingUpdate.delete({ where: { id: pendingId } });
    },
    { timeout: 30_000 },
  );
  return { gameSlug: guide.game.slug };
}

/** Throws away a pending update; the guide is not touched. */
export async function discardPendingUpdate(pendingId: string): Promise<void> {
  await prisma.guidePendingUpdate.deleteMany({ where: { id: pendingId } });
}
