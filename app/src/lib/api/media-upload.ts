import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ImageRejectedError, processImage } from "@/lib/community/images";
import { getStorage, uploadKey, type Storage } from "@/lib/storage";
import { readCapped } from "./read-capped";
import { fail, type ReadBody, type WriteContext, type WriteFailure, type WriteSuccess } from "./write";

/**
 * Largest image a bot may upload (bytes), before it is re-encoded. Vercel refuses request bodies over
 * 4.5 MB before this code runs, so the limit stays under it (the 413 then comes from us, with JSON).
 */
export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

/** Blob folder (and local folder) of images uploaded by bots. */
export const BOT_MEDIA_PREFIX = "guias";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const TOO_LARGE = "A imagem passa de 4 MiB.";

/** What `readMediaBody` hands to `uploadMedia`. */
export type MediaBody = { bytes: Buffer };

/** Reads the raw image body (capped at 4 MiB while streaming); the digest of the bytes is what idempotency compares. */
export const readMediaBody: ReadBody = async (request) => {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!ACCEPTED_TYPES.has(type)) {
    return {
      ok: false,
      code: "unsupported_media_type",
      message: "Envie o corpo cru da imagem com Content-Type image/png, image/jpeg ou image/webp.",
    };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_MEDIA_BYTES) return { ok: false, code: "payload_too_large", message: TOO_LARGE };
  const bytes = await readCapped(request, MAX_MEDIA_BYTES);
  if (!bytes) return { ok: false, code: "payload_too_large", message: TOO_LARGE };
  const body: MediaBody = { bytes: Buffer.from(bytes) };
  return { ok: true, body, hashInput: { sha256: createHash("sha256").update(bytes).digest("hex"), type } };
};

/**
 * Decodes and re-encodes the image (real type check, WebP, at most 2048 px, no metadata), stores
 * it under `guias/` and answers `{ url, width, height }`. The storage write cannot be rolled back
 * with the log row, so a failed log write removes the stored file.
 */
export async function uploadMedia(
  ctx: WriteContext,
  deps: { storage?: Storage; now?: Date } = {},
): Promise<WriteSuccess | WriteFailure> {
  const { bytes } = ctx.body as MediaBody;
  let image;
  try {
    image = await processImage(bytes, MAX_MEDIA_BYTES);
  } catch (error) {
    if (error instanceof ImageRejectedError) {
      return error.reason === "too_large"
        ? fail("payload_too_large", TOO_LARGE)
        : fail("unsupported_media_type", "O corpo não é uma imagem PNG, JPEG ou WebP válida.");
    }
    throw error;
  }

  const storage = deps.storage ?? getStorage(BOT_MEDIA_PREFIX);
  const id = randomUUID();
  const { url } = await storage.put(uploadKey(id, deps.now), image.data, "image/webp");

  const success: WriteSuccess = {
    ok: true,
    httpStatus: 201,
    body: { url, width: image.width, height: image.height },
    resultId: id,
    logStatus: "created",
  };
  try {
    await prisma.$transaction((tx) => ctx.record(tx, success));
  } catch (error) {
    await storage.remove(url).catch(() => {});
    throw error;
  }
  return success;
}
