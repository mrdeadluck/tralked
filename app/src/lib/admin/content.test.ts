import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { articleInputSchema, getArticleForEdit, saveArticle, setArticleStatus, type ArticleInput } from "./articles";
import { getGuideForEdit, guideInputSchema, saveGuide } from "./guides";

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
  await prisma.game.deleteMany({ where: { steamAppId: APP_ID } });
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
        { title: "Começo revisto", hours: "2 h", body: [{ type: "paragraph", text: "Novo começo." }], achievements: ["ACH_ONE"] },
        { title: "Meio", hours: "1 h", body: [{ type: "paragraph", text: "Meio." }], achievements: [] },
        { title: "Fim", hours: "3 h", body: [{ type: "list", ordered: false, items: ["a", "b"] }], achievements: ["ACH_TWO"] },
      ],
      changeSummary: "Etapa nova no meio",
      ...overrides,
    });

  it("turns plain-text steps into paragraph blocks for the editor", async () => {
    const guide = await getGuideForEdit(guideId);
    expect(guide?.steps[0].body).toEqual([
      { type: "paragraph", text: "Primeiro parágrafo." },
      { type: "paragraph", text: "Segundo parágrafo." },
    ]);
    expect(guide?.achievementNames.map((a) => a.apiName).sort()).toEqual(["ACH_ONE", "ACH_TWO"]);
  });

  it("saves fields and steps by position (reader progress survives) and writes a format 1 GuideVersion", async () => {
    const result = await saveGuide(guideInput(), editor.id, NOW);
    expect(result).toEqual({ ok: true, gameSlug: `${PREFIX}-game`, revision: 1 });

    const guide = await prisma.guide.findUniqueOrThrow({
      where: { id: guideId },
      include: { steps: { orderBy: { order: "asc" } }, versions: true, revisions: true },
    });
    expect(guide).toMatchObject({ status: "review", version: "v1.1", difficulty: 5, hoursMax: 20, overview: ["Visão nova"] });
    expect(guide.steps.map((s) => s.id).slice(0, 2)).toEqual(stepIds);
    expect(guide.steps[0]).toMatchObject({ title: "Começo revisto", body: "Novo começo.", achievementApiNames: ["ACH_ONE"] });
    expect(guide.steps[2].blocks).toEqual([{ type: "list", ordered: false, items: ["a", "b"] }]);
    expect(await prisma.guideStepProgress.count({ where: { stepId: stepIds[0] } })).toBe(1);

    expect(guide.versions).toHaveLength(1);
    expect(guide.versions[0]).toMatchObject({ version: 1, authorId: editor.id });
    expect(guide.versions[0].snapshot).toMatchObject({ format: 1, game: `${PREFIX}-game`, status: "review", version: "v1.1" });
    expect(guide.revisions).toEqual([expect.objectContaining({ summary: "Etapa nova no meio", version: "v1.1", authorId: editor.id })]);
  });

  it("every save adds a version, and publishing stamps publishedAt", async () => {
    const result = await saveGuide(guideInput({ status: "published", changeSummary: "" }), editor.id, NOW);
    expect(result).toMatchObject({ ok: true, revision: 2 });
    const guide = await prisma.guide.findUniqueOrThrow({ where: { id: guideId } });
    expect(guide.publishedAt).toEqual(NOW);
    expect(await prisma.guideRevision.count({ where: { guideId } })).toBe(1);
  });

  it("refuses step achievements the game does not have", async () => {
    const steps = [{ title: "X", hours: "1 h", body: [{ type: "paragraph", text: "x" }], achievements: ["NOPE"] }];
    const result = await saveGuide(guideInput({ steps }), editor.id, NOW);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("NOPE"), field: "steps.0.achievements" });
    expect(await prisma.guideVersion.count({ where: { guideId } })).toBe(2);
  });
});
