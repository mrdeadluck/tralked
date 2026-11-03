import { readMediaBody, uploadMedia } from "@/lib/api/media-upload";
import { handleWrite } from "@/lib/api/write";

/**
 * POST /api/v1/media: a bot uploads one image (raw body, Content-Type image/png|jpeg|webp, up to
 * 4 MiB) and gets back the public URL of its WebP version to use in a guide.
 */
export function POST(request: Request) {
  return handleWrite(request, {
    scope: "media:write",
    kind: "media",
    readBody: readMediaBody,
    execute: (ctx) => uploadMedia(ctx),
  });
}
