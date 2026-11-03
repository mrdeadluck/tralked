import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/api/parse";
import { fail, handleWrite } from "@/lib/api/write";
import { REPORTABLE_STATUSES, reportRequest } from "@/lib/guide-requests/queue";

const reportSchema = z.object({
  status: z.enum(REPORTABLE_STATUSES),
  reason: z.string().max(2000).optional(),
  report: z.union([z.record(z.string(), z.json()), z.array(z.json())]).optional(),
  guideId: z.string().min(1).max(100).optional(),
});

/** PATCH /api/v1/guide-requests/{id}: the robot reports where a request is (progress, review, waiting for sources, failure). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/guide-requests/[id]">) {
  const { id } = await ctx.params;
  return handleWrite(request, {
    scope: "guides:write",
    kind: "guide_request",
    execute: async (write) => {
      const parsed = parseBody(reportSchema, write.body);
      if (!parsed.ok) return parsed;
      const result = await reportRequest(id, parsed.data, new Date());
      if (!result.ok) {
        return fail(result.code === "not_found" ? "not_found" : "validation_failed", result.message, [], id);
      }
      const body = {
        id: result.request.id,
        status: result.request.status,
        attempts: result.request.attempts,
        nextAttemptAt: result.request.nextAttemptAt?.toISOString() ?? null,
      };
      const success = { ok: true as const, httpStatus: 200 as const, body, resultId: id, logStatus: "updated" as const };
      // Logged for the Idempotency-Key replay (the report itself is a single row).
      await prisma.$transaction((tx) => write.record(tx, success));
      return success;
    },
  });
}
