import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { normalizeVersion, replaceSteps, saveGuideVersion } from "@/lib/api/guides";
import { guideFactsSchema, guideStepSchema, versionSchema } from "@/lib/content/guide-schema";
import { contentBlocksSchema, parseStoredBlocks, plainText, type ContentBlock } from "@/lib/content/schema";
import { prisma } from "@/lib/db";

/**
 * Newsroom side of guides: list, review queue and the editor (fact sheet, overview, warnings,
 * introduction blocks and steps). Achievement notes, collectibles and sources are kept as they
 * are. Every save writes a GuideVersion snapshot (format 1, the same one the bot API writes).
 */

export const GUIDE_STATUSES = ["draft", "review", "published"] as const;
export type GuideStatus = (typeof GUIDE_STATUSES)[number];

export const GUIDE_STATUS_LABEL: Record<GuideStatus, string> = {
  draft: "Rascunho",
  review: "Em revisão",
  published: "Publicado",
};

export const guideInputSchema = z.strictObject({
  id: z.string().min(1).max(64),
  status: z.enum(GUIDE_STATUSES),
  version: versionSchema,
  facts: guideFactsSchema,
  overview: z.array(plainText(1000)).max(20),
  warnings: z.array(plainText(1000)).max(20),
  /** Optional introduction (Guide.blocks). */
  body: contentBlocksSchema.max(120),
  steps: z.array(guideStepSchema).min(1, "O guia precisa de ao menos uma etapa").max(60),
  /** Optional line for the public "Revisões" list (GuideRevision). */
  changeSummary: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    plainText(300).optional(),
  ),
});

export type GuideInput = z.output<typeof guideInputSchema>;

export type SaveGuideResult =
  | { ok: true; gameSlug: string; revision: number }
  | { ok: false; error: string; field?: string };

export async function saveGuide(
  input: GuideInput,
  editorId: string,
  now: Date = new Date(),
): Promise<SaveGuideResult> {
  const guide = await prisma.guide.findUnique({
    where: { id: input.id },
    select: { id: true, gameId: true, status: true, game: { select: { slug: true } }, _count: { select: { steps: true } } },
  });
  if (!guide) return { ok: false, error: "Este guia não existe mais." };

  // Step achievements are Steam apiNames of the guide's game (same rule as the bot API).
  const wanted = [...new Set(input.steps.flatMap((s) => s.achievements))];
  const known = new Set(
    (
      await prisma.achievement.findMany({
        where: { gameId: guide.gameId, platform: "steam", apiName: { in: wanted } },
        select: { apiName: true },
      })
    ).map((a) => a.apiName),
  );
  for (const [i, step] of input.steps.entries()) {
    const missing = step.achievements.find((apiName) => !known.has(apiName));
    if (missing) {
      return {
        ok: false,
        error: `Etapa ${i + 1}: a conquista Steam "${missing}" não existe neste jogo.`,
        field: `steps.${i}.achievements`,
      };
    }
  }

  const publishing = input.status === "published" && guide.status !== "published";
  const version = normalizeVersion(input.version);
  const revision = await prisma.$transaction(
    async (tx) => {
      await tx.guide.update({
        where: { id: guide.id },
        data: {
          status: input.status,
          version,
          ...input.facts,
          overview: input.overview,
          warnings: input.warnings,
          blocks: input.body.length > 0 ? (input.body as Prisma.InputJsonValue) : Prisma.DbNull,
          ...(publishing ? { publishedAt: now } : {}),
        },
      });
      await replaceSteps(tx, guide.id, input.steps, guide._count.steps);
      if (input.changeSummary) {
        await tx.guideRevision.create({
          data: { guideId: guide.id, version, summary: input.changeSummary, authorId: editorId, createdAt: now },
        });
      }
      return saveGuideVersion(tx, guide.id, editorId);
    },
    { timeout: 30_000 },
  );
  return { ok: true, gameSlug: guide.game.slug, revision };
}

export const guideStatusSchema = z.strictObject({ id: z.string().min(1).max(64), status: z.enum(GUIDE_STATUSES) });

/** Moves a guide through the workflow from the review queue (also saves a GuideVersion). */
export async function setGuideStatus(
  input: z.output<typeof guideStatusSchema>,
  editorId: string,
  now: Date = new Date(),
): Promise<{ ok: true; gameSlug: string } | { ok: false; error: string }> {
  const guide = await prisma.guide.findUnique({
    where: { id: input.id },
    select: { status: true, game: { select: { slug: true } } },
  });
  if (!guide) return { ok: false, error: "Este guia não existe mais." };
  const publishing = input.status === "published" && guide.status !== "published";
  await prisma.$transaction(async (tx) => {
    await tx.guide.update({
      where: { id: input.id },
      data: { status: input.status, ...(publishing ? { publishedAt: now } : {}) },
    });
    await saveGuideVersion(tx, input.id, editorId);
  });
  return { ok: true, gameSlug: guide.game.slug };
}

// ---------- Reading ----------

export type AdminGuideRow = {
  id: string;
  gameName: string;
  gameSlug: string;
  status: string;
  source: string | null;
  botKeyName: string | null;
  author: string | null;
  version: string;
  revisions: number;
  updatedAt: Date;
};

const rowSelect = {
  id: true,
  status: true,
  source: true,
  version: true,
  updatedAt: true,
  game: { select: { name: true, slug: true } },
  author: { select: { handle: true } },
  botKey: { select: { name: true } },
  _count: { select: { versions: true } },
} as const;

const toRow = (g: Prisma.GuideGetPayload<{ select: typeof rowSelect }>): AdminGuideRow => ({
  id: g.id,
  gameName: g.game.name,
  gameSlug: g.game.slug,
  status: g.status,
  source: g.source,
  botKeyName: g.botKey?.name ?? null,
  author: g.author?.handle ?? null,
  version: g.version,
  revisions: g._count.versions,
  updatedAt: g.updatedAt,
});

export async function listAdminGuides(filter: { status?: GuideStatus | null; q?: string | null }) {
  const rows = await prisma.guide.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q ? { game: { name: { contains: filter.q, mode: "insensitive" } } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: rowSelect,
  });
  return rows.map(toRow);
}

/** Guides waiting for an editor (status review), bot ones first. */
export async function guidesInReview(): Promise<AdminGuideRow[]> {
  const rows = await prisma.guide.findMany({
    where: { status: "review" },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: rowSelect,
  });
  return rows.map(toRow).sort((a, b) => Number(b.source === "bot") - Number(a.source === "bot"));
}

export type GuideStepForEdit = { title: string; hours: string; body: ContentBlock[]; achievements: string[] };

export type GuideForEdit = {
  id: string;
  gameName: string;
  gameSlug: string;
  status: GuideStatus;
  version: string;
  facts: { difficulty: number; hoursMin: number; hoursMax: number; playthroughs: string; missables: number; online: number };
  overview: string[];
  warnings: string[];
  body: ContentBlock[];
  steps: GuideStepForEdit[];
  source: string | null;
  botKeyName: string | null;
  noteCount: number;
  collectibleCount: number;
  /** Steam apiNames of the game, for the step achievement field. */
  achievementNames: { apiName: string; name: string }[];
  versions: { version: number; createdAt: Date; author: string | null }[];
};

/** Plain text of a step written before blocks existed, as paragraphs (split on blank lines). */
function textToBlocks(text: string): ContentBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ type: "paragraph" as const, text: part }));
}

export async function getGuideForEdit(guideId: string): Promise<GuideForEdit | null> {
  const g = await prisma.guide.findUnique({
    where: { id: guideId },
    include: {
      game: { select: { name: true, slug: true, achievements: { where: { platform: "steam" }, select: { apiName: true, name: true }, orderBy: { name: "asc" } } } },
      steps: { orderBy: { order: "asc" } },
      botKey: { select: { name: true } },
      versions: { orderBy: { version: "desc" }, take: 10, select: { version: true, createdAt: true, author: { select: { handle: true } } } },
      _count: { select: { notes: true } },
    },
  });
  if (!g) return null;
  const collectibles = Array.isArray(g.collectibles) ? g.collectibles.length : 0;
  return {
    id: g.id,
    gameName: g.game.name,
    gameSlug: g.game.slug,
    status: (GUIDE_STATUSES as readonly string[]).includes(g.status) ? (g.status as GuideStatus) : "draft",
    version: g.version,
    facts: {
      difficulty: g.difficulty,
      hoursMin: g.hoursMin,
      hoursMax: g.hoursMax,
      playthroughs: g.playthroughs,
      missables: g.missables,
      online: g.online,
    },
    overview: g.overview,
    warnings: g.warnings,
    body: parseStoredBlocks(g.blocks ?? []) ?? [],
    steps: g.steps.map((s) => ({
      title: s.title,
      hours: s.hours,
      body: (s.blocks ? parseStoredBlocks(s.blocks) : null) ?? textToBlocks(s.body),
      achievements: s.achievementApiNames,
    })),
    source: g.source,
    botKeyName: g.botKey?.name ?? null,
    noteCount: g._count.notes,
    collectibleCount: collectibles,
    achievementNames: g.game.achievements,
    versions: g.versions.map((v) => ({ version: v.version, createdAt: v.createdAt, author: v.author?.handle ?? null })),
  };
}
