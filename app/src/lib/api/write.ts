import type { Prisma } from "@/generated/prisma/client";
import { authorize } from "./auth";
import { apiError, errorBody, ERROR_STATUS, type ApiErrorCode, type ApiIssue } from "./errors";
import {
  answerForExisting,
  clearRejection,
  findLog,
  logRejection,
  logSuccess,
  readIdempotencyKey,
  requestHash,
  type IngestionKind,
  type LogEntry,
} from "./idempotency";
import { jsonDepthExceeds, MAX_JSON_DEPTH } from "./json-depth";
import { readCapped } from "./read-capped";
import type { ApiKeyRecord, ApiScope } from "./keys";

/** Largest JSON body accepted (bytes). */
export const MAX_BODY_BYTES = 1024 * 1024;

export type WriteFailure = {
  ok: false;
  code: ApiErrorCode;
  message: string;
  issues?: ApiIssue[];
  /** The article/guide the refusal is about, when there is one. */
  resultId?: string;
};

export type WriteSuccess = {
  ok: true;
  httpStatus: 200 | 201 | 202;
  body: Record<string, unknown>;
  resultId: string;
  logStatus: "created" | "updated";
  /** Runs after the transaction committed (cache invalidation). */
  after?: () => void;
};

export type Recorder = (tx: Prisma.TransactionClient, success: WriteSuccess) => Promise<void>;

export type WriteContext = {
  key: ApiKeyRecord;
  body: unknown;
  /** Must be called inside the transaction that writes the content. */
  record: Recorder;
};

export const fail = (code: ApiErrorCode, message: string, issues: ApiIssue[] = [], resultId?: string): WriteFailure => ({
  ok: false,
  code,
  message,
  issues,
  resultId,
});

/**
 * Turns CRLF and lone CR into LF in every string of a JSON value. Robots on Windows send CRLF;
 * the content schemas refuse control characters other than \n and \t.
 */
export function normalizeLineEndings(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\r\n?/g, "\n");
  if (Array.isArray(value)) return value.map(normalizeLineEndings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalizeLineEndings(v)]),
    );
  }
  return value;
}

/** Reads a JSON body of at most MAX_BODY_BYTES (line endings normalized, see above). */
async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; code: ApiErrorCode; message: string }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, code: "payload_too_large", message: "O corpo passa de 1 MiB." };
  }
  // Capped while streaming: a chunked body (no Content-Length) is never buffered past the limit.
  const bytes = await readCapped(request, MAX_BODY_BYTES);
  if (!bytes) {
    return { ok: false, code: "payload_too_large", message: "O corpo passa de 1 MiB." };
  }
  const text = new TextDecoder().decode(bytes);
  // Checked on the raw text, before anything recursive touches the value.
  if (jsonDepthExceeds(text)) {
    return {
      ok: false,
      code: "validation_failed",
      message: `O JSON tem mais de ${MAX_JSON_DEPTH} níveis de listas e objetos aninhados.`,
    };
  }
  try {
    return { ok: true, body: normalizeLineEndings(JSON.parse(text)) };
  } catch {
    return { ok: false, code: "invalid_json", message: "O corpo não é um JSON válido (envie Content-Type: application/json)." };
  }
}

/**
 * The pipeline of every bot write (POST and PATCH): key and scope, rate limit, Idempotency-Key,
 * body, replay of a repeated request, then `execute`. Successes are logged in the same transaction
 * as the content; refusals are logged afterwards.
 */
export async function handleWrite(
  request: Request,
  options: {
    scope: ApiScope;
    kind: IngestionKind;
    execute: (ctx: WriteContext) => Promise<WriteSuccess | WriteFailure>;
  },
): Promise<Response> {
  const auth = await authorize(request, options.scope);
  if (!auth.ok) return auth.response;
  const { key, headers } = auth;

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return apiError(
      "idempotency_key_required",
      "Envie o cabeçalho Idempotency-Key (1 a 255 caracteres ASCII visíveis; um UUID por conteúdo).",
      [],
      headers,
    );
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return apiError(parsed.code, parsed.message, [], headers);

  const entry: LogEntry = {
    keyId: key.id,
    idempotencyKey,
    kind: options.kind,
    requestHash: requestHash(request.method, new URL(request.url).pathname, parsed.body),
  };

  const replay = answerForExisting(await findLog(key.id, idempotencyKey), entry.requestHash, headers);
  if (replay) return replay;
  await clearRejection(key.id, idempotencyKey);

  const record: Recorder = (tx, success) =>
    logSuccess(tx, entry, {
      status: success.logStatus,
      resultId: success.resultId,
      response: { status: success.httpStatus, body: success.body },
    });

  const outcome = await options.execute({ key, body: parsed.body, record });

  if (outcome.ok) {
    outcome.after?.();
    return Response.json(outcome.body, { status: outcome.httpStatus, headers });
  }

  // A concurrent request with the same key may have won the race: answer as it did.
  const raced = answerForExisting(await findLog(key.id, idempotencyKey), entry.requestHash, headers);
  if (raced) return raced;

  const body = errorBody(outcome.code, outcome.message, outcome.issues);
  const status = ERROR_STATUS[outcome.code];
  await logRejection(entry, { status, body }, outcome.resultId);
  return Response.json(body, { status, headers });
}

/** True for a unique-constraint violation (the content raced with another write). */
export const isUniqueViolation = (error: unknown) => (error as { code?: unknown })?.code === "P2002";
