import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { GALLERY_TAG } from "@/lib/community/cached";
import { MAX_UPLOAD_BYTES } from "@/lib/community/images";
import { uploadPhoto, type UploadResult } from "@/lib/community/upload";

// Multipart overhead (boundaries, part headers, the text fields) on top of the image itself.
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export type UploadResponse =
  | { status: "ok"; photoId: string; xpAwarded: boolean; href: string }
  | { status: "unauthenticated" | "forbidden" | "bad_request"; message: string }
  | Exclude<UploadResult, { status: "ok" }>;

const STATUS_CODE: Record<UploadResponse["status"], number> = {
  ok: 201,
  unauthenticated: 401,
  forbidden: 403,
  bad_request: 400,
  invalid: 422,
  too_large: 413,
  rate_limited: 429,
};

const reply = (body: UploadResponse) => NextResponse.json(body, { status: STATUS_CODE[body.status] });

const TOO_LARGE: UploadResponse = { status: "too_large", message: "A foto pode ter no máximo 8 MB." };

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

/** Reads the body but stops as soon as it exceeds `limit` bytes. Returns null when too large. */
async function readCapped(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Gallery upload (multipart: `foto`, `jogo`, `legenda`). A route handler instead of a Server
 * Action because Server Action bodies are capped at 1 MB and photos may have up to 8 MB.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return reply({ status: "forbidden", message: "Envio recusado: origem diferente do site." });
  }
  const user = await getSessionUser();
  if (!user) return reply({ status: "unauthenticated", message: "Entre na sua conta para enviar fotos." });

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

  const result = await uploadPhoto({
    userId: user.id,
    file: form.get("foto"),
    gameSlug: form.get("jogo"),
    caption: form.get("legenda"),
  });
  if (result.status !== "ok") return reply(result);

  revalidateTag(GALLERY_TAG, { expire: 0 });
  return reply({ ...result, href: `/galeria/${result.photoId}` });
}
