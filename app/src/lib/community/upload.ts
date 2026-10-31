import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStorage, uploadKey, type Storage } from "@/lib/storage";
import { ImageRejectedError, MAX_UPLOAD_BYTES, processImage } from "./images";
import { RATE_LIMIT_MESSAGES, withinRateLimit } from "./limits";
import { captionSchema } from "./text";
import { TOO_LARGE_MESSAGE } from "./upload-limits";
import { awardPhotoXp, recomputeQuietly } from "./xp";

export const uploadFieldsSchema = z.object({
  gameSlug: z.string({ error: "Escolha o jogo da foto." }).trim().min(1, "Escolha o jogo da foto.").max(120),
  caption: captionSchema.optional(),
});

export type UploadResult =
  | { status: "ok"; photoId: string; xpAwarded: boolean }
  | { status: "invalid"; field: "foto" | "jogo" | "legenda"; message: string }
  | { status: "too_large"; message: string }
  | { status: "rate_limited"; message: string };

export type UploadInput = {
  userId: string;
  /** The uploaded file; anything that is not a file is rejected. */
  file: unknown;
  gameSlug: unknown;
  caption: unknown;
};

const INVALID_IMAGE = "Envie uma imagem JPEG, PNG ou WebP de verdade.";
const TOO_LARGE = TOO_LARGE_MESSAGE;

/**
 * Gallery upload: validates the fields, checks the daily upload limit, decodes and re-encodes the
 * image (real type check, WebP, max 2048 px, no metadata), stores it, creates the Photo (visible
 * right away) and credits `photo_approved` XP within the daily cap.
 */
export async function uploadPhoto(
  input: UploadInput,
  deps: { storage?: Storage; now?: Date } = {},
): Promise<UploadResult> {
  const fields = uploadFieldsSchema.safeParse({
    gameSlug: input.gameSlug ?? undefined,
    caption: typeof input.caption === "string" ? input.caption : undefined,
  });
  if (!fields.success) {
    const issue = fields.error.issues[0];
    return { status: "invalid", field: issue.path[0] === "caption" ? "legenda" : "jogo", message: issue.message };
  }
  if (!(input.file instanceof Blob) || input.file.size === 0) {
    return { status: "invalid", field: "foto", message: "Escolha uma foto para enviar." };
  }
  if (input.file.size > MAX_UPLOAD_BYTES) return { status: "too_large", message: TOO_LARGE };

  const game = await prisma.game.findUnique({ where: { slug: fields.data.gameSlug }, select: { id: true } });
  if (!game) return { status: "invalid", field: "jogo", message: "Esse jogo não existe no Tralked." };

  const now = deps.now ?? new Date();
  if (!(await withinRateLimit(prisma, "upload", input.userId, now))) {
    return { status: "rate_limited", message: RATE_LIMIT_MESSAGES.upload };
  }

  let image;
  try {
    image = await processImage(Buffer.from(await input.file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImageRejectedError) {
      return error.reason === "too_large"
        ? { status: "too_large", message: TOO_LARGE }
        : { status: "invalid", field: "foto", message: INVALID_IMAGE };
    }
    throw error;
  }

  const storage = deps.storage ?? getStorage();
  const photoId = randomUUID();
  const { url } = await storage.put(uploadKey(photoId, now), image.data, "image/webp");

  let xpAwarded: boolean;
  try {
    xpAwarded = await prisma.$transaction(async (tx) => {
      await tx.photo.create({
        data: {
          id: photoId,
          authorId: input.userId,
          gameId: game.id,
          url,
          width: image.width,
          height: image.height,
          caption: fields.data.caption || null,
          createdAt: now,
        },
      });
      return awardPhotoXp(tx, input.userId, photoId, now);
    });
  } catch (error) {
    await storage.remove(url).catch(() => {});
    throw error;
  }

  if (xpAwarded) await recomputeQuietly(input.userId);
  return { status: "ok", photoId, xpAwarded };
}
