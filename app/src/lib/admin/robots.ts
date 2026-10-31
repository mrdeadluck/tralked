import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/** Ingestion log of the bot API, for the "Robôs" page (filters: key, status, kind). */

export const INGESTION_STATUSES = ["created", "updated", "rejected"] as const;
export const INGESTION_KINDS = ["article", "guide"] as const;

export const INGESTION_STATUS_LABEL: Record<(typeof INGESTION_STATUSES)[number], string> = {
  created: "Criado",
  updated: "Atualizado",
  rejected: "Recusado",
};

export const ingestionFilterSchema = z.object({
  key: z.string().min(1).max(64).optional().catch(undefined),
  status: z.enum(INGESTION_STATUSES).optional().catch(undefined),
  kind: z.enum(INGESTION_KINDS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});
export type IngestionFilter = z.output<typeof ingestionFilterSchema>;

export const INGESTION_PER_PAGE = 50;

export type IngestionRow = {
  id: string;
  createdAt: Date;
  keyId: string;
  keyName: string;
  kind: string;
  status: string;
  idempotencyKey: string;
  resultId: string | null;
  /** HTTP status given to the bot. */
  httpStatus: number | null;
  /** First problems of a rejected request ("/path: message"). */
  issues: string[];
  requestHash: string | null;
};

type StoredError = { code?: unknown; message?: unknown; issues?: { path?: unknown; message?: unknown }[] };

/** Readable lines of a stored error (plain text only). */
export function errorLines(error: unknown, max = 3): string[] {
  if (!error || typeof error !== "object") return [];
  const e = error as StoredError;
  const lines: string[] = [];
  if (Array.isArray(e.issues)) {
    for (const issue of e.issues.slice(0, max)) {
      const path = typeof issue?.path === "string" && issue.path ? `${issue.path}: ` : "";
      if (typeof issue?.message === "string") lines.push(`${path}${issue.message}`);
    }
  }
  if (lines.length === 0 && typeof e.message === "string") lines.push(e.message);
  return lines;
}

function httpStatusOf(response: unknown): number | null {
  const status = (response as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

export async function listIngestion(filter: IngestionFilter) {
  const where: Prisma.IngestionLogWhereInput = {
    ...(filter.key ? { keyId: filter.key } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
  };
  const total = await prisma.ingestionLog.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / INGESTION_PER_PAGE));
  const page = Math.min(filter.page, pageCount);
  const logs = await prisma.ingestionLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * INGESTION_PER_PAGE,
    take: INGESTION_PER_PAGE,
    select: {
      id: true,
      createdAt: true,
      keyId: true,
      kind: true,
      status: true,
      idempotencyKey: true,
      resultId: true,
      error: true,
      response: true,
      requestHash: true,
      key: { select: { name: true } },
    },
  });
  const rows: IngestionRow[] = logs.map((l) => ({
    id: l.id,
    createdAt: l.createdAt,
    keyId: l.keyId,
    keyName: l.key.name,
    kind: l.kind,
    status: l.status,
    idempotencyKey: l.idempotencyKey,
    resultId: l.resultId,
    httpStatus: httpStatusOf(l.response),
    issues: errorLines(l.error),
    requestHash: l.requestHash,
  }));
  return { rows, total, page, pageCount };
}
