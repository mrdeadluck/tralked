import type { LevelChange } from "@/lib/progression/reward";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { GALLERY_TAG } from "@/lib/community/cached";
import { MAX_UPLOAD_BYTES, TOO_LARGE_MESSAGE } from "@/lib/community/upload-limits";
import { uploadPhoto, type UploadResult } from "@/lib/community/upload";
import { readCapped } from "@/lib/api/read-capped";
import { postingBlock } from "@/lib/moderation/permissions";
import { StorageNotConfiguredError } from "@/lib/storage";

// Multipart overhead (boundaries, part headers, the text fields) on top of the image itself.
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export type UploadResponse =
  | { status: "ok"; photoId: string; xpAwarded: boolean; levelUp: LevelChange | null; href: string }
  | { status: "unauthenticated" | "forbidden" | "bad_request" | "unavailable"; message: string }
  | Exclude<UploadResult, { status: "ok" }>;

const STATUS_CODE: Record<UploadResponse["status"], number> = {
  ok: 201,
  unauthenticated: 401,
  forbidden: 403,
  bad_request: 400,
  invalid: 422,
  too_large: 413,
  rate_limited: 429,
  unavailable: 503,
};

const reply = (body: UploadResponse) => NextResponse.json(body, { status: STATUS_CODE[body.status] });

const TOO_LARGE: UploadResponse = { status: "too_large", message: TOO_LARGE_MESSAGE };

/** Same-origin check: the browser's Origin header must match the host this request came to. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Gallery upload (multipart: `foto`, `jogo`, `legenda`). A route handler instead of a Server
 * Action because Server Action bodies are capped at 1 MB. The browser compresses photos first
 * (WebP, 2048 px); the body stays under the 4.5 MB Vercel Functions request limit.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return reply({ status: "forbidden", message: "Envio recusado: origem diferente do site." });
  }
  const user = await getSessionUser();
  if (!user) return reply({ status: "unauthenticated", message: "Entre na sua conta para enviar fotos." });
  // Muted (or banned) by the moderation: no uploads until the sanction ends.
  const blocked = postingBlock(user);
  if (blocked) return reply({ status: "forbidden", message: blocked });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return reply(TOO_LARGE);
  const body = await readCapped(request, MAX_BODY_BYTES);
  if (!body) return reply(TOO_LARGE);

  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return reply({ status: "bad_request", message: "Envie o formulário de foto." });
  }

  let result: UploadResult;
  try {
    result = await uploadPhoto({
      userId: user.id,
      file: form.get("foto"),
      gameSlug: form.get("jogo"),
      caption: form.get("legenda"),
    });
  } catch (error) {
    // Production without BLOB_READ_WRITE_TOKEN: refuse clearly instead of writing to local disk.
    if (error instanceof StorageNotConfiguredError) {
      console.error("Gallery upload refused:", error.message);
      return reply({ status: "unavailable", message: "O envio de fotos está indisponível no momento. Tente de novo mais tarde." });
    }
    throw error;
  }
  if (result.status !== "ok") return reply(result);

  revalidateTag(GALLERY_TAG, { expire: 0 });
  return reply({ ...result, href: `/galeria/${result.photoId}` });
}
