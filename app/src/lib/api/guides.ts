import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import {
  blocksToPlainText,
  guidePatchSchema,
  guidePayloadSchema,
  type GuideNotePayload,
  type GuidePatch,
  type GuideStepPayload,
} from "@/lib/content/guide-schema";
import { prisma } from "@/lib/db";
import { gameTag } from "@/lib/queries/games-cached";
import { toPointer, type ApiIssue } from "./errors";
import { findGame, guideUrl } from "./games";
import type { ApiKeyRecord } from "./keys";
import { parseBody } from "./parse";
import { fail, isUniqueViolation, type WriteContext, type WriteFailure, type WriteSuccess } from "./write";

/**
 * Bot guides: one guide per game (`source = bot`, no human author). Without the `publish` scope
 * they wait in review. Every write saves a full GuideVersion snapshot (version 1, 2, 3…).
 */

type Tx = Prisma.TransactionClient;

const canPublish = (key: ApiKeyRecord) => key.scopes.includes("publish");

const publishForbidden = (id?: string): WriteFailure =>
  fail(
    "forbidden",
    "Publicar direto exige o escopo publish. Sem status, o guia entra na fila de revisão.",
    [{ path: "/status", message: "Esta chave não tem o escopo publish" }],
    id,
  );

const concurrentWrite = (id?: string): WriteFailure =>
  fail("idempotency_conflict", "Outra requisição com o mesmo Idempotency-Key foi concluída antes.", [], id);

export const normalizeVersion = (version: string) => (version.startsWith("v") ? version : `v${version}`);

const invalidateGuide = (gameSlug: string) => revalidateTag(gameTag(gameSlug), { expire: 0 });

/**
 * Maps the achievements a guide refers to onto the game's Achievement rows: step achievements are
 * Steam apiNames, notes carry their platform. Unknown ones become issues.
 */
async function resolveAchievements(
  gameId: string,
  steps: GuideStepPayload[] | undefined,
  notes: GuideNotePayload[] | undefined,
): Promise<{ noteIds: string[]; issues: ApiIssue[] }> {
  const wanted = [
    ...(steps ?? []).flatMap((s) => s.achievements.map((apiName) => ({ platform: "steam", apiName }))),
    ...(notes ?? []).map((n) => ({ platform: n.platform, apiName: n.apiName })),
  ];
  const rows = wanted.length
    ? await prisma.achievement.findMany({
        where: { gameId, OR: wanted.map((w) => ({ platform: w.platform, apiName: w.apiName })) },
        select: { id: true, platform: true, apiName: true },
      })
    : [];
  const byKey = new Map(rows.map((r) => [`${r.platform}:${r.apiName}`, r.id]));
  const issues: ApiIssue[] = [];
  steps?.forEach((step, i) =>
    step.achievements.forEach((apiName, j) => {
      if (!byKey.has(`steam:${apiName}`)) {
        issues.push({
          path: toPointer(["steps", i, "achievements", j]),
          message: `Conquista Steam "${apiName}" não existe neste jogo`,
        });
      }
    }),
  );
  const noteIds: string[] = [];
  notes?.forEach((note, i) => {
    const id = byKey.get(`${note.platform}:${note.apiName}`);
    if (id) noteIds.push(id);
    else {
      issues.push({
        path: toPointer(["achievementNotes", i, "apiName"]),
        message: `Conquista "${note.apiName}" (${note.platform}) não existe neste jogo`,
      });
    }
  });
  return { noteIds, issues };
}

/** Columns of a step from its payload. The key is written only when the payload has one. */
export const stepData = (step: Omit<GuideStepPayload, "key"> & { key?: string }) => ({
  title: step.title,
  hours: step.hours,
  body: blocksToPlainText(step.body),
  blocks: step.body as Prisma.InputJsonValue,
  achievementApiNames: step.achievements,
  ...(step.key !== undefined ? { key: step.key } : {}),
});

export const noteData = (note: GuideNotePayload, achievementId: string) => ({
  achievementId,
  category: note.category,
  spoiler: note.spoiler,
  tip: blocksToPlainText(note.tip),
  tipBlocks: note.tip as Prisma.InputJsonValue,
  steps: note.steps,
});

export const collectiblesData = (collectibles: NonNullable<GuidePatch["collectibles"]>) =>
  collectibles.map((c) => ({ name: c.name, total: c.total, description: c.description ?? "" }));

/** Full snapshot of a guide as stored now (fields, steps, notes), for GuideVersion. */
async function snapshot(tx: Tx, guideId: string): Promise<Prisma.InputJsonValue> {
  // Sequential reads: Prisma loads the relations of one query in parallel, and on the
  // transaction's single pg connection that is deprecated (pg warns).
  const guide = await tx.guide.findUniqueOrThrow({ where: { id: guideId } });
  const game = await tx.game.findUniqueOrThrow({ where: { id: guide.gameId }, select: { slug: true } });
  const steps = await tx.guideStep.findMany({ where: { guideId }, orderBy: { order: "asc" } });
  const notes = await tx.guideAchievementNote.findMany({ where: { guideId }, orderBy: { id: "asc" } });
  const achievements = await tx.achievement.findMany({
    where: { id: { in: notes.map((n) => n.achievementId) } },
    select: { id: true, apiName: true, platform: true },
  });
  const achievementById = new Map(achievements.map((a) => [a.id, a]));
  return {
    format: 1,
    game: game.slug,
    status: guide.status,
    version: guide.version,
    source: guide.source,
    botKeyId: guide.botKeyId,
    facts: {
      difficulty: guide.difficulty,
      hoursMin: guide.hoursMin,
      hoursMax: guide.hoursMax,
      playthroughs: guide.playthroughs,
      missables: guide.missables,
      online: guide.online,
    },
    overview: guide.overview,
    warnings: guide.warnings,
    body: guide.blocks ?? null,
    steps: steps.map((s) => ({
      key: s.key,
      title: s.title,
      hours: s.hours,
      body: s.blocks ?? s.body,
      achievements: s.achievementApiNames,
    })),
    achievementNotes: notes.map((n) => ({
      apiName: achievementById.get(n.achievementId)?.apiName ?? null,
      platform: achievementById.get(n.achievementId)?.platform ?? null,
      category: n.category,
      spoiler: n.spoiler,
      tip: n.tipBlocks ?? n.tip,
      steps: n.steps,
    })),
    collectibles: guide.collectibles,
    sources: guide.sources,
  } as Prisma.InputJsonValue;
}

/**
 * Saves the next GuideVersion (format 1 snapshot) of a guide. Shared with the admin editor, which
 * passes the editor as `authorId`; bot writes have none.
 */
export async function saveGuideVersion(tx: Tx, guideId: string, authorId: string | null = null): Promise<number> {
  const last = await tx.guideVersion.aggregate({ where: { guideId }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  await tx.guideVersion.create({
    data: { guideId, version, authorId, snapshot: await snapshot(tx, guideId) },
  });
  return version;
}

const saveVersion = (tx: Tx, guideId: string) => saveGuideVersion(tx, guideId);

export async function createGuide(ctx: WriteContext): Promise<WriteSuccess | WriteFailure> {
  const parsed = parseBody(guidePayloadSchema, ctx.body);
  if (!parsed.ok) return parsed;
  const payload = parsed.data;
  if (payload.status === "published" && !canPublish(ctx.key)) return publishForbidden();
  const status = payload.status ?? (canPublish(ctx.key) ? "published" : "review");

  const game = await findGame(payload.game);
  if (!game) {
    return fail("validation_failed", "O jogo não existe no catálogo.", [
      { path: "/game", message: "Jogo não encontrado. Procure o jogo em GET /api/v1/games?q=…" },
    ]);
  }
  const existing = await prisma.guide.findUnique({ where: { gameId: game.id }, select: { id: true } });
  if (existing) return guideExists(existing.id);

  const { noteIds, issues } = await resolveAchievements(game.id, payload.steps, payload.achievementNotes);
  if (issues.length > 0) return fail("validation_failed", "Há conquistas que não existem neste jogo.", issues);

  try {
    return await prisma.$transaction(async (tx) => {
      const guide = await tx.guide.create({
        data: {
          gameId: game.id,
          status,
          version: normalizeVersion(payload.version ?? "v1.0"),
          difficulty: payload.facts.difficulty,
          hoursMin: payload.facts.hoursMin,
          hoursMax: payload.facts.hoursMax,
          playthroughs: payload.facts.playthroughs,
          missables: payload.facts.missables,
          online: payload.facts.online,
          overview: payload.overview,
          warnings: payload.warnings,
          collectibles: collectiblesData(payload.collectibles),
          sources: payload.sources,
          blocks: payload.body?.length ? (payload.body as Prisma.InputJsonValue) : undefined,
          source: "bot",
          botKeyId: ctx.key.id,
          publishedAt: status === "published" ? new Date() : null,
        },
        select: { id: true },
      });
      await tx.guideStep.createMany({
        data: payload.steps.map((step, order) => ({ guideId: guide.id, order, ...stepData(step) })),
      });
      await tx.guideAchievementNote.createMany({
        data: payload.achievementNotes.map((note, i) => ({ guideId: guide.id, ...noteData(note, noteIds[i]) })),
      });
      const revision = await saveVersion(tx, guide.id);
      const success: WriteSuccess = {
        ok: true,
        httpStatus: 201,
        body: { id: guide.id, status, url: guideUrl(game.slug), revision },
        resultId: guide.id,
        logStatus: "created",
        after: status === "published" ? () => invalidateGuide(game.slug) : undefined,
      };
      await ctx.record(tx, success);
      return success;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Either the game got a guide meanwhile, or the same Idempotency-Key committed first.
    const raced = await prisma.guide.findUnique({ where: { gameId: game.id }, select: { id: true } });
    return raced ? guideExists(raced.id) : concurrentWrite();
  }
}

function guideExists(id: string): WriteFailure {
  return fail(
    "guide_exists",
    `Este jogo já tem um guia (id ${id}). Para alterar um guia criado por esta chave, use PATCH /api/v1/guides/${id}.`,
    [{ path: "/game", message: "O jogo já tem guia" }],
    id,
  );
}

function ownGuide(key: ApiKeyRecord, id: string) {
  return prisma.guide.findFirst({
    where: { id, botKeyId: key.id },
    select: {
      id: true,
      status: true,
      version: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      gameId: true,
      game: { select: { slug: true, name: true } },
      _count: { select: { steps: true } },
    },
  });
}

/** One step to write, in order: update the existing step `id`, or create a new one. */
export type StepWrite = { id?: string; data: Omit<ReturnType<typeof stepData>, "key"> & { key?: string | null } };

/**
 * Writes a guide's steps in the given order. Steps listed by id keep their id, so readers'
 * checkmarks (GuideStepProgress) follow the step wherever it moves; steps left out are deleted
 * with only their own checkmarks; new steps get new ids.
 */
export async function writeSteps(tx: Tx, guideId: string, steps: StepWrite[]): Promise<void> {
  const existing = await tx.guideStep.findMany({ where: { guideId }, select: { id: true } });
  const kept = steps.flatMap((s) => (s.id ? [s.id] : []));
  const keptSet = new Set(kept);
  const removed = existing.filter((e) => !keptSet.has(e.id)).map((e) => e.id);
  if (removed.length > 0) await tx.guideStep.deleteMany({ where: { guideId, id: { in: removed } } });
  // Park the kept steps on negative orders first, so no final order collides with (guideId, order).
  for (const [i, id] of kept.entries()) {
    await tx.guideStep.update({ where: { id, guideId }, data: { order: -(i + 1) } });
  }
  for (const [order, step] of steps.entries()) {
    if (step.id) await tx.guideStep.update({ where: { id: step.id, guideId }, data: { ...step.data, order } });
    else await tx.guideStep.create({ data: { guideId, order, ...step.data } });
  }
}

/**
 * How a bot update maps its steps onto the stored ones (documented in /desenvolvedores):
 * - every step has a `key`: steps match by key (reorder, insert and remove keep checkmarks);
 *   a guide whose steps have no keys yet adopts them by position, which needs the same count
 *   (otherwise 422: matching nothing would delete every step and every reader's checkmarks);
 * - no step has a key: steps match by position, only when the number of steps is unchanged;
 *   otherwise 422 (send keys to insert, remove or reorder steps).
 * Runs inside the write transaction, so the plan matches the steps it rewrites.
 */
async function planBotSteps(
  tx: Tx,
  guideId: string,
  steps: GuidePatch["steps"] & object,
): Promise<{ ok: true; plan: StepWrite[] } | { ok: false; issue: ApiIssue }> {
  const existing = await tx.guideStep.findMany({
    where: { guideId },
    orderBy: { order: "asc" },
    select: { id: true, key: true },
  });
  const keyed = steps.length > 0 && steps.every((s) => s.key !== undefined);
  if (keyed) {
    const byKey = new Map(existing.flatMap((e) => (e.key ? [[e.key, e.id] as const] : [])));
    const adopt = byKey.size === 0 && existing.length > 0;
    if (adopt && existing.length !== steps.length) {
      return {
        ok: false,
        issue: {
          path: "/steps",
          message: `As ${existing.length} etapas do guia ainda não têm key e o envio tem ${steps.length}. Na primeira atualização com key, mande o mesmo número de etapas (elas recebem as keys pela posição); depois inclua, tire ou reordene à vontade.`,
        },
      };
    }
    return {
      ok: true,
      plan: steps.map((step, i) => ({ id: adopt ? existing[i].id : byKey.get(step.key as string), data: stepData(step) })),
    };
  }
  if (existing.length !== steps.length) {
    return {
      ok: false,
      issue: {
        path: "/steps",
        message: `O guia tem ${existing.length} etapas e o envio tem ${steps.length}. Para incluir, tirar ou reordenar etapas, mande key em cada etapa.`,
      },
    };
  }
  // Same count, no keys: position i updates stored step i (stored keys are kept).
  return {
    ok: true,
    plan: steps.map((step, i) => ({ id: existing[i].id, data: { ...stepData(step), key: existing[i].key } })),
  };
}

export async function updateGuide(ctx: WriteContext, id: string): Promise<WriteSuccess | WriteFailure> {
  const guide = await ownGuide(ctx.key, id);
  if (!guide) return fail("not_found", "Guia não encontrado para esta chave.");

  const parsed = parseBody(guidePatchSchema, ctx.body);
  if (!parsed.ok) return { ...parsed, resultId: id };
  const patch = parsed.data;

  if (guide.status === "published" && !canPublish(ctx.key)) {
    return fail(
      "published_locked",
      "O guia já foi publicado pela redação; só chaves com o escopo publish podem alterá-lo.",
      [],
      id,
    );
  }
  if (patch.status === "published" && !canPublish(ctx.key)) return publishForbidden(id);

  const { noteIds, issues } = await resolveAchievements(guide.gameId, patch.steps, patch.achievementNotes);
  if (issues.length > 0) return fail("validation_failed", "Há conquistas que não existem neste jogo.", issues, id);

  const status = patch.status ?? guide.status;
  const publishing = status === "published" && guide.status !== "published";

  try {
    return await prisma.$transaction(async (tx): Promise<WriteSuccess | WriteFailure> => {
      let stepPlan: StepWrite[] | null = null;
      if (patch.steps) {
        // Planned before any write: a refusal leaves the guide untouched.
        const planned = await planBotSteps(tx, id, patch.steps);
        if (!planned.ok) return fail("validation_failed", "As etapas não batem com as do guia.", [planned.issue], id);
        stepPlan = planned.plan;
      }
      await tx.guide.update({
        where: { id },
        data: {
          status,
          version: patch.version === undefined ? undefined : normalizeVersion(patch.version),
          ...(patch.facts ?? {}),
          overview: patch.overview,
          warnings: patch.warnings,
          collectibles: patch.collectibles ? collectiblesData(patch.collectibles) : undefined,
          sources: patch.sources,
          blocks:
            patch.body === undefined
              ? undefined
              : patch.body.length > 0
                ? (patch.body as Prisma.InputJsonValue)
                : Prisma.DbNull,
          ...(publishing ? { publishedAt: new Date() } : {}),
        },
      });
      if (stepPlan) await writeSteps(tx, id, stepPlan);
      if (patch.achievementNotes) {
        const notes = patch.achievementNotes;
        await tx.guideAchievementNote.deleteMany({ where: { guideId: id } });
        await tx.guideAchievementNote.createMany({
          data: notes.map((note, i) => ({ guideId: id, ...noteData(note, noteIds[i]) })),
        });
      }
      const revision = await saveVersion(tx, id);
      const success: WriteSuccess = {
        ok: true,
        httpStatus: 200,
        body: { id, status, url: guideUrl(guide.game.slug), revision },
        resultId: id,
        logStatus: "updated",
        after:
          status === "published" || guide.status === "published"
            ? () => invalidateGuide(guide.game.slug)
            : undefined,
      };
      await ctx.record(tx, success);
      return success;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return concurrentWrite(id);
    // A planned step vanished under a concurrent update of the same guide.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return fail("idempotency_conflict", "Outra atualização deste guia terminou antes. Consulte o guia e envie de novo.", [], id);
    }
    throw error;
  }
}

/** Status of one of the key's guides (GET /api/v1/guides/{id}). */
export async function guideStatus(key: ApiKeyRecord, id: string) {
  const guide = await ownGuide(key, id);
  if (!guide) return null;
  const last = await prisma.guideVersion.aggregate({ where: { guideId: id }, _max: { version: true } });
  return {
    id: guide.id,
    game: guide.game,
    status: guide.status,
    version: guide.version,
    revision: last._max.version ?? 0,
    steps: guide._count.steps,
    url: guideUrl(guide.game.slug),
    publishedAt: guide.status === "published" ? (guide.publishedAt?.toISOString() ?? null) : null,
    createdAt: guide.createdAt.toISOString(),
    updatedAt: guide.updatedAt.toISOString(),
  };
}
