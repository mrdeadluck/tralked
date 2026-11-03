import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { apiError, type ApiErrorBody } from "./errors";

/**
 * Idempotency of bot writes, stored in IngestionLog (unique per key + Idempotency-Key):
 * - same key + same request (method, path, JSON body) after a success -> the stored answer again;
 * - same key + another request -> 409 `idempotency_conflict`;
 * - a refused request (409/422) does not use up the key: fixing the body and resending with the
 *   same key runs it again (the rejected log row is replaced).
 */

export const IDEMPOTENCY_HEADER = "idempotency-key";
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export type IngestionKind = "article" | "guide" | "guide_request" | "media";
export type StoredResponse = { status: number; body: unknown };

export function readIdempotencyKey(request: Request): string | null {
  const value = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  return value && KEY_PATTERN.test(value) ? value : null;
}

/** JSON with object keys sorted, so `{"a":1,"b":2}` and `{"b":2,"a":1}` are the same request. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`).digest("hex");
}

type LogRow = { status: string; requestHash: string | null; response: Prisma.JsonValue };

/** The answer to a repeated key, or null when the request should run. */
export function answerForExisting(
  existing: LogRow | null,
  hash: string,
  headers: Record<string, string>,
): Response | null {
  if (!existing || existing.status === "rejected") return null;
  if (existing.requestHash !== hash) {
    return apiError(
      "idempotency_conflict",
      "Este Idempotency-Key já foi usado com outro corpo ou em outro endpoint. Gere uma chave nova para cada conteúdo novo.",
      [],
      headers,
    );
  }
  const stored = existing.response as StoredResponse | null;
  return Response.json(stored?.body ?? null, {
    status: stored?.status ?? 200,
    headers: { ...headers, "Idempotent-Replayed": "true" },
  });
}

export function findLog(keyId: string, idempotencyKey: string) {
  return prisma.ingestionLog.findUnique({
    where: { keyId_idempotencyKey: { keyId, idempotencyKey } },
    select: { status: true, requestHash: true, response: true },
  });
}

/** Removes an earlier refusal under this key, so the request can run again. */
export async function clearRejection(keyId: string, idempotencyKey: string) {
  await prisma.ingestionLog.deleteMany({ where: { keyId, idempotencyKey, status: "rejected" } });
}

export type LogEntry = {
  keyId: string;
  idempotencyKey: string;
  kind: IngestionKind;
  requestHash: string;
};

/** Records a success inside the transaction that wrote the content. */
export async function logSuccess(
  tx: Prisma.TransactionClient,
  entry: LogEntry,
  outcome: { status: "created" | "updated"; resultId: string; response: StoredResponse },
) {
  await tx.ingestionLog.create({
    data: {
      ...entry,
      status: outcome.status,
      resultId: outcome.resultId,
      response: outcome.response as Prisma.InputJsonValue,
    },
  });
}

/**
 * Records a refusal for the admin's ingestion log. If a success raced in under the same key, the
 * success is kept (only a rejected row is overwritten).
 */
export async function logRejection(
  entry: LogEntry,
  response: { status: number; body: ApiErrorBody },
  resultId?: string,
) {
  const data = {
    status: "rejected",
    requestHash: entry.requestHash,
    kind: entry.kind,
    resultId: resultId ?? null,
    error: { code: response.body.error.code, issues: response.body.error.issues } as Prisma.InputJsonValue,
    response: response as unknown as Prisma.InputJsonValue,
  };
  const updated = await prisma.ingestionLog.updateMany({
    where: { keyId: entry.keyId, idempotencyKey: entry.idempotencyKey, status: "rejected" },
    data,
  });
  if (updated.count > 0) return;
  try {
    await prisma.ingestionLog.create({
      data: { ...data, keyId: entry.keyId, idempotencyKey: entry.idempotencyKey },
    });
  } catch (error) {
    if ((error as { code?: unknown }).code !== "P2002") throw error;
  }
}
