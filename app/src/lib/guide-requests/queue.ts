import { Prisma, type GuideRequest } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { syncGame } from "@/lib/sync/catalog";

/**
 * Guide request queue: the admin asks for the guide of a Steam game, the robot claims requests one
 * at a time. Statuses: queued | researching | writing | review | published | waiting_sources |
 * failed | cancelled.
 */

export const OPEN_STATUSES = ["queued", "researching", "writing", "waiting_sources"] as const;
/** Statuses a robot may report. */
export const REPORTABLE_STATUSES = ["researching", "writing", "review", "waiting_sources", "failed"] as const;
export type ReportableStatus = (typeof REPORTABLE_STATUSES)[number];

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  researching: "Pesquisando",
  writing: "Escrevendo",
  review: "Em revisão",
  published: "Publicado",
  waiting_sources: "Aguardando fontes",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const DAY_MS = 86_400_000;
export const RETRY_DELAY_MS = 3 * DAY_MS;
export const GIVE_UP_AFTER_MS = 30 * DAY_MS;
export const INSUFFICIENT_SOURCES_REASON = "fontes insuficientes após 30 dias";

/** A refusal the admin can read (shown as is). */
export class GuideRequestError extends Error {}

export async function createGuideRequest(input: {
  steamAppId: number;
  requestedById: string | null;
  /** Accepts the request even when the game already has a guide (asks for an update). */
  update?: boolean;
}): Promise<GuideRequest> {
  const game = await syncGame(input.steamAppId);
  if (!game) throw new GuideRequestError("Este jogo está sem conquistas na Steam: não há guia a fazer.");

  const open = await prisma.guideRequest.findFirst({
    where: { steamAppId: input.steamAppId, status: { in: [...OPEN_STATUSES] } },
    select: { id: true },
  });
  if (open) throw new GuideRequestError("Já existe um pedido aberto para este jogo.");

  const guide = await prisma.guide.findUnique({ where: { gameId: game.id }, select: { id: true } });
  if (guide && !input.update) {
    throw new GuideRequestError('Este jogo já tem guia. Use "Atualizar guia existente" para pedir uma atualização.');
  }

  return prisma.guideRequest.create({
    data: {
      steamAppId: input.steamAppId,
      gameId: game.id,
      status: "queued",
      requestedById: input.requestedById,
      guideId: guide?.id,
    },
  });
}

const iso = (date: Date) => date.toISOString();

/**
 * Takes the next request for the robot: highest priority first, then oldest. `waiting_sources`
 * requests are claimable once their `nextAttemptAt` has passed. One statement with
 * FOR UPDATE SKIP LOCKED, so two robots never get the same request.
 */
export async function claimNextRequest(now: Date): Promise<GuideRequest | null> {
  // Columns are `timestamp(3)` in UTC: the parameter is cast explicitly, whatever the driver does with Dates.
  const rows = await prisma.$queryRaw<GuideRequest[]>(Prisma.sql`
    UPDATE "GuideRequest"
    SET "status" = 'researching',
        "attempts" = "attempts" + 1,
        "nextAttemptAt" = NULL,
        "updatedAt" = (${iso(now)}::timestamptz AT TIME ZONE 'UTC')
    WHERE "id" = (
      SELECT "id" FROM "GuideRequest"
      WHERE "status" = 'queued'
         OR ("status" = 'waiting_sources' AND "nextAttemptAt" <= (${iso(now)}::timestamptz AT TIME ZONE 'UTC'))
      ORDER BY "priority" DESC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`);
  return rows[0] ?? null;
}

export type ReportInput = {
  status: ReportableStatus;
  reason?: string;
  report?: Prisma.InputJsonValue;
  guideId?: string;
};

export type ReportResult = { ok: true; request: GuideRequest } | { ok: false; code: "not_found" | "closed"; message: string };

/** The robot's progress on a request (PATCH). A request cancelled or already published is not touched. */
export async function reportRequest(id: string, input: ReportInput, now: Date): Promise<ReportResult> {
  const current = await prisma.guideRequest.findUnique({ where: { id } });
  if (!current) return { ok: false, code: "not_found", message: "Pedido não encontrado." };
  if (current.status === "cancelled" || current.status === "published") {
    return {
      ok: false,
      code: "closed",
      message: `O pedido está ${REQUEST_STATUS_LABEL[current.status].toLowerCase()} e não aceita mais relatos.`,
    };
  }

  let status: string = input.status;
  let reason = input.reason;
  let firstWaitingAt = current.firstWaitingAt;
  let nextAttemptAt: Date | null = null;

  if (input.status === "waiting_sources") {
    firstWaitingAt ??= now;
    if (now.getTime() - firstWaitingAt.getTime() > GIVE_UP_AFTER_MS) {
      status = "failed";
      reason = INSUFFICIENT_SOURCES_REASON;
    } else {
      nextAttemptAt = new Date(now.getTime() + RETRY_DELAY_MS);
    }
  }

  const request = await prisma.guideRequest.update({
    where: { id },
    data: {
      status,
      nextAttemptAt,
      firstWaitingAt,
      ...(reason !== undefined && { reason }),
      ...(input.report !== undefined && { report: input.report }),
      ...(input.guideId !== undefined && { guideId: input.guideId }),
    },
  });
  return { ok: true, request };
}

/** Puts a waiting, failed or cancelled request back in the queue (a restart forgets the 30-day count). */
export async function retryNow(id: string): Promise<GuideRequest | null> {
  const current = await prisma.guideRequest.findUnique({ where: { id } });
  if (!current || !["waiting_sources", "failed", "cancelled"].includes(current.status)) return null;
  const other = await prisma.guideRequest.findFirst({
    where: { id: { not: id }, steamAppId: current.steamAppId, status: { in: [...OPEN_STATUSES] } },
    select: { id: true },
  });
  if (other) throw new GuideRequestError("Já existe outro pedido aberto para este jogo.");
  return prisma.guideRequest.update({
    where: { id },
    data: {
      status: "queued",
      nextAttemptAt: null,
      reason: null,
      ...(current.status === "waiting_sources" ? {} : { firstWaitingAt: null }),
    },
  });
}

/** Cancels a request that has not finished (a robot already working on it finds out on its next report). */
export async function cancelRequest(id: string): Promise<GuideRequest | null> {
  const result = await prisma.guideRequest.updateMany({
    where: { id, status: { in: [...OPEN_STATUSES] } },
    data: { status: "cancelled", nextAttemptAt: null },
  });
  return result.count ? prisma.guideRequest.findUnique({ where: { id } }) : null;
}

export async function bumpPriority(id: string, delta: 1 | -1): Promise<GuideRequest | null> {
  const result = await prisma.guideRequest.updateMany({ where: { id }, data: { priority: { increment: delta } } });
  return result.count ? prisma.guideRequest.findUnique({ where: { id } }) : null;
}

export type AdminGuideRequest = GuideRequest & { gameName: string | null; guideStatus: string | null };

/** Open requests on top, then newest first. */
export async function listGuideRequests(): Promise<AdminGuideRequest[]> {
  const rows = await prisma.guideRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const games = await prisma.game.findMany({
    where: { steamAppId: { in: [...new Set(rows.map((r) => r.steamAppId))] } },
    select: { steamAppId: true, name: true },
  });
  const nameByApp = new Map(games.map((g) => [g.steamAppId, g.name]));
  const guides = await prisma.guide.findMany({
    where: { id: { in: rows.flatMap((r) => (r.guideId ? [r.guideId] : [])) } },
    select: { id: true, status: true },
  });
  const guideStatus = new Map(guides.map((g) => [g.id, g.status]));
  const open = (r: GuideRequest) => (OPEN_STATUSES as readonly string[]).includes(r.status);
  return rows
    .map((r) => ({
      ...r,
      gameName: nameByApp.get(r.steamAppId) ?? null,
      guideStatus: r.guideId ? (guideStatus.get(r.guideId) ?? null) : null,
    }))
    .sort((a, b) => Number(open(b)) - Number(open(a)));
}

export async function openRequestCount(): Promise<number> {
  return prisma.guideRequest.count({ where: { status: { in: [...OPEN_STATUSES] } } });
}
