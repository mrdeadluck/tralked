import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { articleInputSchema, getArticleForEdit, saveArticle, setArticleStatus, type ArticleInput } from "./articles";
import { createGuideForGame, getGuideForEdit, guideInputSchema, saveGuide } from "./guides";

// Uses the test database (vitest.db-guard.ts). Everything is created with a `test-admin-c` prefix
// and removed afterwards, so the seeded counts other tests check stay intact.

const PREFIX = "test-admin-c";
const APP_ID = 97100001;
const NOW = new Date("2026-10-31T15:00:00Z");

let editor: { id: string; handle: string };
let gameId: string;
let guideId: string;
let stepIds: string[];

async function cleanup() {
  await prisma.article.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.author.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { steamAppId: { in: [APP_ID, APP_ID + 1] } } });
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
}

const input = (overrides: Partial<ArticleInput> = {}): ArticleInput =>
  articleInputSchema.parse({
    title: "Notícia de teste da redação",
    slug: `${PREFIX}-noticia`,
    subtitle: "",
    excerpt: "",
    category: "GAMES",
    platforms: ["PC"],
    imageLabel: "",
    featured: 0,
    status: "draft",
    gameIds: [gameId],
    blocks: [{ type: "paragraph", text: "Primeiro parágrafo com **negrito**." }],
    ...overrides,
  });

beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({
    data: { handle: `${PREFIX}-editor`, displayName: "Editora", role: "editor" },
  });
  editor = { id: user.id, handle: user.handle };
  const game = await prisma.game.create({
    data: {
      slug: `${PREFIX}-game`,
      name: "Jogo de teste do admin",
      steamAppId: APP_ID,
      achievementCount: 2,
      platforms: ["PC"],
      achievements: {
        create: [
          { apiName: "ACH_ONE", name: "Primeira" },
          { apiName: "ACH_TWO", name: "Segunda" },
        ],
      },
    },
  });
  gameId = game.id;
  const guide = await prisma.guide.create({
    data: {
      gameId,
      status: "draft",
      version: "v1.0",
      difficulty: 4,
      hoursMin: 10,
      hoursMax: 15,
      playthroughs: "1",
      missables: 0,
      online: 0,
      overview: ["Visão"],
      warnings: [],
      steps: {
        create: [
          { order: 0, title: "Começo", hours: "2 h", body: "Primeiro parágrafo.\n\nSegundo parágrafo.", achievementApiNames: ["ACH_ONE"] },
          { order: 1, title: "Fim", hours: "3 h", body: "Termine.", achievementApiNames: [] },
        ],
      },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  guideId = guide.id;
  stepIds = guide.steps.map((s) => s.id);
  await prisma.guideStepProgress.create({ data: { userId: editor.id, stepId: stepIds[0] } });
});

afterAll(cleanup);

describe("saveArticle", () => {
  it("creates an editorial article with the editor's byline and related games", async () => {
    const result = await saveArticle(input(), editor, NOW);
    expect(result).toMatchObject({ ok: true, slug: `${PREFIX}-noticia`, previousSlug: null, gameSlugs: [`${PREFIX}-game`] });
    const row = await prisma.article.findUniqueOrThrow({
      where: { slug: `${PREFIX}-noticia` },
      include: { author: true, games: true },
    });
    expect(row).toMatchObject({ status: "draft", source: "editorial", humanAuthored: true, gameId, body: "" });
    expect(row.author).toMatchObject({ userId: editor.id });
    expect(row.games.map((g) => g.gameId)).toEqual([gameId]);
    expect(row.blocks).toEqual([{ type: "paragraph", text: "Primeiro parágrafo com **negrito**." }]);
  });

  it("refuses a slug another article already uses", async () => {
    const clash = await saveArticle(input({ title: "Outra" }), editor, NOW);
    expect(clash).toEqual({ ok: false, error: expect.stringContaining("Já existe"), field: "slug" });
  });

  it("publishes (stamping publishedAt) and then freezes the slug", async () => {
    const { id } = (await prisma.article.findUniqueOrThrow({ where: { slug: `${PREFIX}-noticia` } }));
    const published = await saveArticle(input({ id, status: "published" }), editor, NOW);
    expect(published.ok).toBe(true);
    const row = await prisma.article.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("published");
    expect(row.publishedAt).toEqual(NOW);
    expect(row.reviewedAt).toBeNull(); // only bot articles get the review stamp

    const moved = await saveArticle(input({ id, status: "published", slug: `${PREFIX}-novo-endereco` }), editor, NOW);
    expect(moved).toMatchObject({ ok: false, field: "slug" });
    expect(row.firstPublishedAt).toEqual(NOW);
  });

  it("the slug stays frozen after the article goes back to draft (it was published once)", async () => {
    const { id } = await prisma.article.findUniqueOrThrow({ where: { slug: `${PREFIX}-noticia` } });
    expect(await setArticleStatus({ id, status: "draft" }, NOW)).toMatchObject({ ok: true });
    const moved = await saveArticle(input({ id, status: "draft", slug: `${PREFIX}-novo-endereco` }), editor, NOW);
    expect(moved).toMatchObject({ ok: false, field: "slug" });
    expect((await getArticleForEdit(id))?.slugLocked).toBe(true);
    // A draft that never went live can still change its address.
    const fresh = await saveArticle(input({ title: "Rascunho novo", slug: `${PREFIX}-rascunho` }), editor, NOW);
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(await saveArticle(input({ id: fresh.id, slug: `${PREFIX}-rascunho-2` }), editor, NOW)).toMatchObject({ ok: true });
    }
  });

  it("publishing a bot article from the review queue stamps reviewedAt", async () => {
    const author = await prisma.author.create({ data: { handle: `${PREFIX}-robo` } });
    const bot = await prisma.article.create({
      data: {
        slug: `${PREFIX}-robo`,
        title: "Do robô",
        body: "",
        blocks: [{ type: "paragraph", text: "Gerado." }],
        status: "review",
        category: "GAMES",
        platforms: [],
        imageLabel: "robô",
        authorId: author.id,
        source: "bot",
        humanAuthored: false,
      },
    });
    expect(await setArticleStatus({ id: bot.id, status: "published" }, NOW)).toEqual({ ok: true, slug: `${PREFIX}-robo` });
    const row = await prisma.article.findUniqueOrThrow({ where: { id: bot.id } });
    expect(row).toMatchObject({ status: "published", reviewedAt: NOW, publishedAt: NOW, humanAuthored: false, source: "bot" });
    expect((await getArticleForEdit(bot.id))?.reviewedAt).toEqual(NOW);
  });

  it("the editor path also stamps reviewedAt on a bot article it publishes", async () => {
    const author = await prisma.author.findUniqueOrThrow({ where: { handle: `${PREFIX}-robo` } });
    const bot = await prisma.article.create({
      data: {
        slug: `${PREFIX}-robo-2`,
        title: "Do robô 2",
        body: "",
        blocks: [],
        status: "review",
        category: "GAMES",
        platforms: [],
        imageLabel: "robô",
        authorId: author.id,
        source: "bot",
        humanAuthored: false,
      },
    });
    const result = await saveArticle(input({ id: bot.id, slug: `${PREFIX}-robo-2`, status: "published" }), editor, NOW);
    expect(result.ok).toBe(true);
    expect(await prisma.article.findUniqueOrThrow({ where: { id: bot.id } })).toMatchObject({ reviewedAt: NOW, source: "bot" });
  });

  it("an article without content cannot leave draft through the queue", async () => {
    const author = await prisma.author.findUniqueOrThrow({ where: { handle: `${PREFIX}-robo` } });
    const empty = await prisma.article.create({
      data: { slug: `${PREFIX}-vazia`, title: "Vazia", body: "", category: "GAMES", platforms: [], imageLabel: "x", authorId: author.id },
    });
    expect(await setArticleStatus({ id: empty.id, status: "published" }, NOW)).toMatchObject({ ok: false });
  });
});

describe("saveGuide", () => {
  const body = (text: string) => [{ type: "paragraph", text }];
  const guideInput = (overrides: Record<string, unknown> = {}) =>
    guideInputSchema.parse({
      id: guideId,
      status: "review",
      version: "1.1",
      facts: { difficulty: 5, hoursMin: 10, hoursMax: 20, playthroughs: "1", missables: 1, online: 0 },
      overview: ["Visão nova"],
      warnings: ["Cuidado"],
      body: [],
      steps: [
        { id: stepIds[0], title: "Começo revisto", hours: "2 h", body: body("Novo começo."), achievements: ["ACH_ONE"] },
        { title: "Meio", hours: "1 h", body: body("Meio."), achievements: [] },
        { id: stepIds[1], title: "Fim", hours: "3 h", body: [{ type: "list", ordered: false, items: ["a", "b"] }], achievements: ["ACH_TWO"] },
      ],
      notes: [{ apiName: "ACH_TWO", platform: "steam", category: "chefes", spoiler: true, tip: body("Use o escudo."), steps: ["Vá ao norte"] }],
      collectibles: [{ name: "Máscaras", total: 4 }],
      sources: [{ title: "Wiki", url: "https://exemplo.com/wiki" }],
      changeSummary: "Etapa nova no meio",
      ...overrides,
    });

  /** Step ids in order, and which step each of the two readers' checkmarks sits on. */
  async function stepState() {
    const steps = await prisma.guideStep.findMany({ where: { guideId }, orderBy: { order: "asc" }, select: { id: true, title: true } });
    const marks = await prisma.guideStepProgress.findMany({
      where: { userId: { in: [editor.id, reader] } },
      select: { userId: true, step: { select: { title: true } } },
    });
    return { ids: steps.map((s) => s.id), titles: steps.map((s) => s.title), marks: marks.map((m) => `${m.userId === editor.id ? "editor" : "reader"}:${m.step.title}`).sort() };
  }

  let reader: string;
  beforeAll(async () => {
    reader = (await prisma.user.create({ data: { handle: `${PREFIX}-leitor`, displayName: "Leitor" } })).id;
    await prisma.guideStepProgress.create({ data: { userId: reader, stepId: stepIds[1] } });
  });

  it("turns plain-text steps into paragraph blocks for the editor, with their ids", async () => {
    const guide = await getGuideForEdit(guideId);
    expect(guide?.steps.map((s) => s.id)).toEqual(stepIds);
    expect(guide?.steps[0].body).toEqual([
      { type: "paragraph", text: "Primeiro parágrafo." },
      { type: "paragraph", text: "Segundo parágrafo." },
    ]);
    expect(guide?.achievementNames.map((a) => a.apiName).sort()).toEqual(["ACH_ONE", "ACH_TWO"]);
  });

  it("inserting a step in the middle keeps every reader's checkmark on its own step; writes a format 1 GuideVersion", async () => {
    const result = await saveGuide(guideInput(), editor.id, NOW);
    expect(result).toMatchObject({ ok: true, gameSlug: `${PREFIX}-game`, revision: 1 });

    const state = await stepState();
    expect(state.titles).toEqual(["Começo revisto", "Meio", "Fim"]);
    expect(state.ids[0]).toBe(stepIds[0]);
    expect(state.ids[2]).toBe(stepIds[1]);
    expect(result.ok && result.stepIds).toEqual(state.ids);
    expect(state.marks).toEqual(["editor:Começo revisto", "reader:Fim"]);

    const guide = await prisma.guide.findUniqueOrThrow({
      where: { id: guideId },
      include: { steps: { orderBy: { order: "asc" } }, versions: true, revisions: true, notes: true },
    });
    expect(guide).toMatchObject({ status: "review", version: "v1.1", difficulty: 5, hoursMax: 20, overview: ["Visão nova"] });
    expect(guide.steps[0]).toMatchObject({ title: "Começo revisto", body: "Novo começo.", achievementApiNames: ["ACH_ONE"] });
    expect(guide.steps[2].blocks).toEqual([{ type: "list", ordered: false, items: ["a", "b"] }]);
    expect(guide.notes).toEqual([
      expect.objectContaining({ category: "chefes", spoiler: true, tip: "Use o escudo.", tipBlocks: body("Use o escudo."), steps: ["Vá ao norte"] }),
    ]);
    expect(guide.collectibles).toEqual([{ name: "Máscaras", total: 4, description: "" }]);
    expect(guide.sources).toEqual([{ title: "Wiki", url: "https://exemplo.com/wiki" }]);

    expect(guide.versions).toHaveLength(1);
    expect(guide.versions[0]).toMatchObject({ version: 1, authorId: editor.id });
    expect(guide.versions[0].snapshot).toMatchObject({
      format: 1,
      game: `${PREFIX}-game`,
      status: "review",
      version: "v1.1",
      achievementNotes: [expect.objectContaining({ apiName: "ACH_TWO", category: "chefes" })],
      collectibles: [{ name: "Máscaras", total: 4, description: "" }],
    });
    expect(guide.revisions).toEqual([expect.objectContaining({ summary: "Etapa nova no meio", version: "v1.1", authorId: editor.id })]);
  });

  it("reordering moves the checkmarks with their steps", async () => {
    const { ids } = await stepState();
    const steps = [
      { id: ids[2], title: "Fim", hours: "3 h", body: body("Fim."), achievements: [] },
      { id: ids[0], title: "Começo revisto", hours: "2 h", body: body("Começo."), achievements: [] },
      { id: ids[1], title: "Meio", hours: "1 h", body: body("Meio."), achievements: [] },
    ];
    expect((await saveGuide(guideInput({ steps, changeSummary: "" }), editor.id, NOW)).ok).toBe(true);
    const state = await stepState();
    expect(state.ids).toEqual([ids[2], ids[0], ids[1]]);
    expect(state.marks).toEqual(["editor:Começo revisto", "reader:Fim"]);
  });

  it("removing a step deletes only that step's checkmarks", async () => {
    const { ids } = await stepState();
    const steps = [
      { id: ids[1], title: "Começo revisto", hours: "2 h", body: body("Começo."), achievements: [] },
      { id: ids[2], title: "Meio", hours: "1 h", body: body("Meio."), achievements: [] },
    ];
    expect((await saveGuide(guideInput({ steps, changeSummary: "" }), editor.id, NOW)).ok).toBe(true);
    const state = await stepState();
    expect(state.ids).toEqual([ids[1], ids[2]]);
    expect(state.marks).toEqual(["editor:Começo revisto"]);
  });

  it("every save adds a version, and publishing stamps publishedAt", async () => {
    const { ids } = await stepState();
    const steps = ids.map((id, i) => ({ id, title: `Etapa ${i}`, hours: "1 h", body: body("x"), achievements: [] }));
    const request = await prisma.guideRequest.create({ data: { steamAppId: APP_ID, gameId, guideId, status: "review" } });
    try {
      const result = await saveGuide(guideInput({ steps, status: "published", changeSummary: "" }), editor.id, NOW);
      expect(result).toMatchObject({ ok: true, revision: 4 });
      const guide = await prisma.guide.findUniqueOrThrow({ where: { id: guideId } });
      expect(guide.publishedAt).toEqual(NOW);
      expect(await prisma.guideRevision.count({ where: { guideId } })).toBe(1);
      // The robot's request for the guide is done once the guide is published.
      expect((await prisma.guideRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("published");
    } finally {
      await prisma.guideRequest.delete({ where: { id: request.id } });
    }
  });

  it("refuses unknown achievements in steps and notes, and steps of another guide", async () => {
    const steps = [{ title: "X", hours: "1 h", body: body("x"), achievements: ["NOPE"] }];
    expect(await saveGuide(guideInput({ steps }), editor.id, NOW)).toEqual({
      ok: false,
      error: expect.stringContaining("NOPE"),
      field: "steps.0.achievements",
    });
    const notes = [{ apiName: "ACH_ONE", platform: "psn", category: "historia", tip: body("x") }];
    expect(await saveGuide(guideInput({ steps: [{ title: "X", hours: "1 h", body: body("x") }], notes }), editor.id, NOW)).toMatchObject({
      ok: false,
      field: "notes.0.apiName",
    });
    const foreign = [{ id: "outro-guia-step", title: "X", hours: "1 h", body: body("x") }];
    expect(await saveGuide(guideInput({ steps: foreign }), editor.id, NOW)).toMatchObject({ ok: false, field: "steps.0" });
    expect(await prisma.guideVersion.count({ where: { guideId } })).toBe(4);
  });
});

describe("createGuideForGame", () => {
  it("starts an editorial draft (version 1) only for a game without a guide", async () => {
    const other = await prisma.game.create({
      data: { slug: `${PREFIX}-sem-guia`, name: "Sem guia", steamAppId: APP_ID + 1, achievementCount: 0, platforms: [] },
    });
    try {
      const created = await createGuideForGame({ gameId: other.id }, editor.id);
      expect(created.ok).toBe(true);
      const guide = await prisma.guide.findUniqueOrThrow({ where: { gameId: other.id }, include: { versions: true, steps: true } });
      expect(guide).toMatchObject({ status: "draft", source: "editorial", authorId: editor.id });
      expect(guide.steps).toHaveLength(0);
      expect(guide.versions).toEqual([expect.objectContaining({ version: 1, authorId: editor.id })]);
      expect(await createGuideForGame({ gameId: other.id }, editor.id)).toMatchObject({ ok: false });
    } finally {
      await prisma.game.delete({ where: { id: other.id } });
    }
  });
});
