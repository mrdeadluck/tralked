import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import {
  collectiblesData,
  noteData,
  normalizeVersion,
  saveGuideVersion,
  stepData,
  writeSteps,
} from "@/lib/api/guides";
import {
  checkUniqueNotes,
  guideAchievementNoteSchema,
  guideCollectibleSchema,
  guideFactsSchema,
  guideSourceSchema,
  guideStepSchema,
  versionSchema,
} from "@/lib/content/guide-schema";
import { contentBlocksSchema, parseStoredBlocks, plainText, type ContentBlock } from "@/lib/content/schema";
import { prisma } from "@/lib/db";

/**
 * Newsroom side of guides: list, review queue, creating a draft guide for a game without one,
 * and the editor (fact sheet, overview, warnings, introduction, steps, achievement notes,
 * collectibles and sources). Steps are written by id, so readers' checkmarks follow their step
 * when steps are reordered, inserted or removed. Every save writes a GuideVersion snapshot
 * (format 1, the same one the bot API writes).
 */

export const GUIDE_STATUSES = ["draft", "review", "published"] as const;
export type GuideStatus = (typeof GUIDE_STATUSES)[number];

export const GUIDE_STATUS_LABEL: Record<GuideStatus, string> = {
  draft: "Rascunho",
  review: "Em revisão",
  published: "Publicado",
};

const ID = z.string().min(1).max(64);

/** A step of the editor: `id` of an existing step of this guide, or none for a new step. */
const editorStepSchema = guideStepSchema.omit({ key: true }).extend({ id: ID.optional() });

export const guideInputSchema = z
  .strictObject({
    id: ID,
    status: z.enum(GUIDE_STATUSES),
    version: versionSchema,
    facts: guideFactsSchema,
    overview: z.array(plainText(1000)).max(20),
    warnings: z.array(plainText(1000)).max(20),
    /** Optional introduction (Guide.blocks). */
    body: contentBlocksSchema.max(120),
    steps: z.array(editorStepSchema).min(1, "O guia precisa de ao menos uma etapa").max(60),
    notes: z.array(guideAchievementNoteSchema).max(1000),
    collectibles: z.array(guideCollectibleSchema).max(60),
    sources: z.array(guideSourceSchema).max(30),
    /** Optional line for the public "Revisões" list (GuideRevision). */
    changeSummary: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      plainText(300).optional(),
    ),
  })
  .superRefine((guide, ctx) => {
    checkUniqueNotes(guide.notes, ctx, "notes");
    const ids = guide.steps.flatMap((s) => (s.id ? [s.id] : []));
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["steps"], message: "Etapa repetida" });
  });

export type GuideInput = z.output<typeof guideInputSchema>;

export type SaveGuideResult =
  | { ok: true; gameSlug: string; revision: number; stepIds: string[] }
  | { ok: false; error: string; field?: string };

const PLATFORM_LABEL: Record<string, string> = { steam: "Steam", psn: "PlayStation", xbox: "Xbox", retro: "RetroAchievements" };

export async function saveGuide(
  input: GuideInput,
  editorId: string,
  now: Date = new Date(),
): Promise<SaveGuideResult> {
  const guide = await prisma.guide.findUnique({
    where: { id: input.id },
    select: { id: true, gameId: true, status: true, game: { select: { slug: true } }, steps: { select: { id: true } } },
  });
  if (!guide) return { ok: false, error: "Este guia não existe mais." };

  // A step id must be one of this guide's steps (a stale editor may still list a removed one).
  const own = new Set(guide.steps.map((s) => s.id));
  const foreign = input.steps.findIndex((s) => s.id !== undefined && !own.has(s.id));
  if (foreign >= 0) {
    return { ok: false, error: `A etapa ${foreign + 1} não existe mais neste guia. Recarregue a página.`, field: `steps.${foreign}` };
  }

  // Step achievements are Steam apiNames of the guide's game (same rule as the bot API); notes
  // name an achievement of any platform of the game.
  const achievements = await prisma.achievement.findMany({
    where: { gameId: guide.gameId },
    select: { id: true, platform: true, apiName: true },
  });
  const byKey = new Map(achievements.map((a) => [`${a.platform}:${a.apiName}`, a.id]));
  for (const [i, step] of input.steps.entries()) {
    const missing = step.achievements.find((apiName) => !byKey.has(`steam:${apiName}`));
    if (missing) {
      return {
        ok: false,
        error: `Etapa ${i + 1}: a conquista Steam "${missing}" não existe neste jogo.`,
        field: `steps.${i}.achievements`,
      };
    }
  }
  const noteIds: string[] = [];
  for (const [i, note] of input.notes.entries()) {
    const id = byKey.get(`${note.platform}:${note.apiName}`);
    if (!id) {
      return {
        ok: false,
        error: `Nota ${i + 1}: a conquista "${note.apiName}" (${PLATFORM_LABEL[note.platform]}) não existe neste jogo.`,
        field: `notes.${i}.apiName`,
      };
    }
    noteIds.push(id);
  }

  const publishing = input.status === "published" && guide.status !== "published";
  const version = normalizeVersion(input.version);
  const { revision, stepIds } = await prisma.$transaction(
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
          collectibles: collectiblesData(input.collectibles),
          sources: input.sources,
          ...(publishing ? { publishedAt: now } : {}),
        },
      });
      await writeSteps(
        tx,
        guide.id,
        input.steps.map(({ id, ...step }) => ({ id, data: stepData(step) })),
      );
      await tx.guideAchievementNote.deleteMany({ where: { guideId: guide.id } });
      await tx.guideAchievementNote.createMany({
        data: input.notes.map((note, i) => ({ guideId: guide.id, ...noteData(note, noteIds[i]) })),
      });
      if (input.changeSummary) {
        await tx.guideRevision.create({
          data: { guideId: guide.id, version, summary: input.changeSummary, authorId: editorId, createdAt: now },
        });
      }
      const saved = await tx.guideStep.findMany({ where: { guideId: guide.id }, orderBy: { order: "asc" }, select: { id: true } });
      return { revision: await saveGuideVersion(tx, guide.id, editorId), stepIds: saved.map((s) => s.id) };
    },
    { timeout: 30_000 },
  );
  return { ok: true, gameSlug: guide.game.slug, revision, stepIds };
}

export const newGuideSchema = z.strictObject({ gameId: ID });

/**
 * Starts a guide for a game that has none: an editorial draft with an empty fact sheet and no
 * steps (the editor asks for at least one step before the next save). Saves version 1.
 */
export async function createGuideForGame(
  input: z.output<typeof newGuideSchema>,
  editorId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const game = await prisma.game.findUnique({ where: { id: input.gameId }, select: { id: true, guide: { select: { id: true } } } });
  if (!game) return { ok: false, error: "Este jogo não existe mais." };
  if (game.guide) return { ok: false, error: "Este jogo já tem guia." };
  try {
    const id = await prisma.$transaction(async (tx) => {
      const guide = await tx.guide.create({
        data: {
          gameId: game.id,
          authorId: editorId,
          source: "editorial",
          status: "draft",
          version: "v1.0",
          difficulty: 5,
          hoursMin: 0,
          hoursMax: 0,
          playthroughs: "1",
          missables: 0,
          online: 0,
          overview: [],
          warnings: [],
        },
        select: { id: true },
      });
      await saveGuideVersion(tx, guide.id, editorId);
      return guide.id;
    });
    return { ok: true, id };
  } catch (error) {
    if ((error as { code?: unknown })?.code === "P2002") return { ok: false, error: "Este jogo já tem guia." };
    throw error;
  }
}

/** Catalog games without a guide, for "Novo guia". */
export async function gamesWithoutGuide(): Promise<{ id: string; name: string; slug: string }[]> {
  return prisma.game.findMany({
    where: { guide: { is: null }, stub: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
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

export type GuideStepForEdit = { id: string; title: string; hours: string; body: ContentBlock[]; achievements: string[] };

export type GuideNoteForEdit = {
  apiName: string;
  platform: "steam" | "psn" | "xbox" | "retro";
  category: string;
  spoiler: boolean;
  tip: ContentBlock[];
  steps: string[];
};

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
  notes: GuideNoteForEdit[];
  collectibles: { name: string; total: number; description: string }[];
  sources: { title: string; url: string }[];
  /** Achievements of the game (every platform), for the step and note fields. */
  achievementNames: { apiName: string; name: string; platform: string }[];
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
      game: {
        select: {
          name: true,
          slug: true,
          achievements: { select: { apiName: true, name: true, platform: true }, orderBy: [{ platform: "asc" }, { name: "asc" }] },
        },
      },
      notes: { include: { achievement: { select: { apiName: true, platform: true } } }, orderBy: { id: "asc" } },
      steps: { orderBy: { order: "asc" } },
      botKey: { select: { name: true } },
      versions: { orderBy: { version: "desc" }, take: 10, select: { version: true, createdAt: true, author: { select: { handle: true } } } },
    },
  });
  if (!g) return null;
  const collectibles = (Array.isArray(g.collectibles) ? g.collectibles : []).flatMap((c) => {
    const item = c as { name?: unknown; total?: unknown; description?: unknown };
    return typeof item.name === "string" && typeof item.total === "number"
      ? [{ name: item.name, total: item.total, description: typeof item.description === "string" ? item.description : "" }]
      : [];
  });
  const sources = (Array.isArray(g.sources) ? g.sources : []).flatMap((x) => {
    const item = x as { title?: unknown; url?: unknown };
    return typeof item.title === "string" && typeof item.url === "string" ? [{ title: item.title, url: item.url }] : [];
  });
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
      id: s.id,
      title: s.title,
      hours: s.hours,
      body: (s.blocks ? parseStoredBlocks(s.blocks) : null) ?? textToBlocks(s.body),
      achievements: s.achievementApiNames,
    })),
    source: g.source,
    botKeyName: g.botKey?.name ?? null,
    notes: g.notes.map((n) => ({
      apiName: n.achievement.apiName,
      platform: n.achievement.platform as GuideNoteForEdit["platform"],
      category: n.category,
      spoiler: n.spoiler,
      tip: (n.tipBlocks ? parseStoredBlocks(n.tipBlocks) : null) ?? textToBlocks(n.tip),
      steps: n.steps,
    })),
    collectibles,
    sources,
    achievementNames: g.game.achievements,
    versions: g.versions.map((v) => ({ version: v.version, createdAt: v.createdAt, author: v.author?.handle ?? null })),
  };
}
