import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Every admin Server Action re-checks the session and the role before touching anything, then
 * validates its input with zod. The libraries behind them are mocked: a refused call must never
 * reach them.
 */

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
const updateTag = vi.fn();
const revalidateTag = vi.fn();
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag,
  revalidateTag,
}));
const after = vi.fn();
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after }));

const lib = {
  saveArticle: vi.fn(async () => ({ ok: true, id: "a1", slug: "s", previousSlug: null, gameSlugs: [] })),
  setArticleStatus: vi.fn(async () => ({ ok: true, slug: "s" })),
  saveGuide: vi.fn(async () => ({ ok: true, gameSlug: "g", revision: 2 })),
  setGuideStatus: vi.fn(async () => ({ ok: true, gameSlug: "g" })),
  moderateContent: vi.fn(async () => ({ ok: true, tags: ["photo:p1"], recompute: [], voided: 0 })),
  decideReport: vi.fn(async () => ({ ok: true })),
  confirmFraud: vi.fn(async () => ({ ok: true, entries: 1, levelBefore: 2, levelAfter: 1, gameSlug: "g", handle: "h" })),
  releaseFraud: vi.fn(async () => ({ ok: true, entries: 1, levelBefore: 1, levelAfter: 2, gameSlug: "g", handle: "h" })),
  updateGameOverrides: vi.fn(async () => ({ ok: true, slug: "g", owners: [], skillsChanged: false })),
  saveFeed: vi.fn(async () => ({ ok: true })),
  deleteFeed: vi.fn(async () => ({ ok: true })),
  changeRole: vi.fn(async () => ({ ok: true })),
  createApiKey: vi.fn(async () => ({ id: "k1", secret: "tk_live_x", prefix: "tk_live_x" })),
  revokeApiKey: vi.fn(async () => {}),
};
const partial = (path: string, names: (keyof typeof lib)[]) =>
  vi.doMock(path, async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ...Object.fromEntries(names.map((n) => [n, lib[n]])),
  }));
partial("@/lib/admin/articles", ["saveArticle", "setArticleStatus"]);
partial("@/lib/admin/guides", ["saveGuide", "setGuideStatus"]);
partial("@/lib/admin/moderation", ["moderateContent", "decideReport"]);
partial("@/lib/admin/fraud", ["confirmFraud", "releaseFraud"]);
partial("@/lib/admin/catalog", ["updateGameOverrides", "saveFeed", "deleteFeed"]);
partial("@/lib/admin/users", ["changeRole"]);
partial("@/lib/api/keys", ["createApiKey", "revokeApiKey"]);
const findGame = vi.fn(async () => ({ id: "g1", slug: "g" }));
const findKey = vi.fn(async () => ({ id: "k1" }));
vi.mock("@/lib/db", () => ({ prisma: { game: { findUnique: findGame }, apiKey: { findUnique: findKey } } }));

const noticias = await import("./noticias/actions");
const guias = await import("./guias/actions");
const moderacao = await import("./moderacao/actions");
const fraude = await import("./fraude/actions");
const jogos = await import("./jogos/actions");
const feeds = await import("./feeds/actions");
const robos = await import("./robos/actions");
const usuarios = await import("./usuarios/actions");
const { FORBIDDEN_MESSAGE } = await import("@/lib/admin/guard");

const article = {
  title: "Nova notícia",
  slug: "nova-noticia",
  subtitle: "",
  excerpt: "",
  category: "GAMES",
  platforms: ["PC"],
  imageLabel: "",
  featured: 0,
  status: "draft",
  gameIds: [],
  blocks: [{ type: "paragraph", text: "Oi." }],
};
const guide = {
  id: "g1",
  status: "review",
  version: "v1.1",
  facts: { difficulty: 5, hoursMin: 10, hoursMax: 20, playthroughs: "1", missables: 0, online: 0 },
  overview: [],
  warnings: [],
  body: [],
  steps: [{ title: "Etapa", hours: "2 h", body: [{ type: "paragraph", text: "Faça." }], achievements: [] }],
};
const fraudCase = { userId: "u2", gameId: "g1", platform: "steam" };

type Call = { name: string; run: () => Promise<{ ok: boolean }>; reaches: (keyof typeof lib)[] };

const STAFF_ACTIONS: Call[] = [
  { name: "saveArticle", run: () => noticias.saveArticleAction(article), reaches: ["saveArticle"] },
  { name: "setArticleStatus", run: () => noticias.setArticleStatusAction({ id: "a1", status: "published" }), reaches: ["setArticleStatus"] },
  { name: "saveGuide", run: () => guias.saveGuideAction(guide), reaches: ["saveGuide"] },
  { name: "setGuideStatus", run: () => guias.setGuideStatusAction({ id: "g1", status: "published" }), reaches: ["setGuideStatus"] },
  { name: "moderate", run: () => moderacao.moderateAction({ targetType: "photo", targetId: "p1", action: "remove" }), reaches: ["moderateContent"] },
  { name: "decideReport", run: () => moderacao.decideReportAction({ reportId: "r1", decision: "dismissed" }), reaches: ["decideReport"] },
];

const ADMIN_ACTIONS: Call[] = [
  { name: "confirmFraud", run: () => fraude.confirmFraudAction(fraudCase), reaches: ["confirmFraud"] },
  { name: "releaseFraud", run: () => fraude.releaseFraudAction(fraudCase), reaches: ["releaseFraud"] },
  { name: "saveGameOverrides", run: () => jogos.saveGameOverridesAction({ gameId: "g1", skills: ["rpg"], aliases: ["HK"] }), reaches: ["updateGameOverrides"] },
  { name: "syncGameMedia", run: () => jogos.syncGameMediaAction({ gameId: "g1" }), reaches: [] },
  { name: "saveFeed", run: () => feeds.saveFeedAction({ name: "Feed", url: "https://exemplo.com/rss", active: true }), reaches: ["saveFeed"] },
  { name: "deleteFeed", run: () => feeds.deleteFeedAction({ id: "f1" }), reaches: ["deleteFeed"] },
  { name: "syncNews", run: () => feeds.syncNewsAction({}), reaches: [] },
  { name: "createKey", run: () => robos.createKeyAction({ name: "redator", scopes: ["articles:write"] }), reaches: ["createApiKey"] },
  { name: "revokeKey", run: () => robos.revokeKeyAction({ id: "k1" }), reaches: ["revokeApiKey"] },
  { name: "changeRole", run: () => usuarios.changeRoleAction({ userId: "u2", role: "editor" }), reaches: ["changeRole"] },
];

const as = (role: string | null) =>
  getSessionUser.mockResolvedValue(role === null ? null : { id: "u1", handle: "eu", role });

function expectNothingRan() {
  for (const fn of Object.values(lib)) expect(fn).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
  expect(updateTag).not.toHaveBeenCalled();
}

beforeEach(() => vi.clearAllMocks());

describe("admin actions refuse anyone without the role", () => {
  for (const role of [null, "user", "author"]) {
    it.each([...STAFF_ACTIONS, ...ADMIN_ACTIONS].map((c) => [c.name, c] as const))(
      `%s: refused for ${role ?? "a visitor"}`,
      async (_, call) => {
        as(role);
        expect(await call.run()).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
        expectNothingRan();
      },
    );
  }

  it.each(ADMIN_ACTIONS.map((c) => [c.name, c] as const))("%s: refused for an editor (admin only)", async (_, call) => {
    as("editor");
    expect(await call.run()).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    expectNothingRan();
  });
});

describe("admin actions run for the right role", () => {
  it.each(STAFF_ACTIONS.map((c) => [c.name, c] as const))("%s: an editor may run it", async (_, call) => {
    as("editor");
    expect((await call.run()).ok).toBe(true);
    for (const name of call.reaches) expect(lib[name]).toHaveBeenCalledOnce();
  });

  it.each(ADMIN_ACTIONS.map((c) => [c.name, c] as const))("%s: an admin may run it", async (_, call) => {
    as("admin");
    expect((await call.run()).ok).toBe(true);
    for (const name of call.reaches) expect(lib[name]).toHaveBeenCalledOnce();
  });

  it("background syncs are scheduled with after()", async () => {
    as("admin");
    await jogos.syncGameMediaAction({ gameId: "g1" });
    await feeds.syncNewsAction({});
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("publishing invalidates the news caches; moderation the content's own tags", async () => {
    as("editor");
    await noticias.setArticleStatusAction({ id: "a1", status: "published" });
    expect(updateTag).toHaveBeenCalledWith("news");
    expect(updateTag).toHaveBeenCalledWith("article:s");
    await moderacao.moderateAction({ targetType: "photo", targetId: "p1", action: "remove" });
    expect(updateTag).toHaveBeenCalledWith("photo:p1");
  });
});

describe("admin actions validate their input", () => {
  it.each([
    ["HTML in a block", () => noticias.saveArticleAction({ ...article, blocks: [{ type: "paragraph", text: "<script>x</script>" }] })],
    ["unknown article status", () => noticias.setArticleStatusAction({ id: "a1", status: "live" })],
    ["review without blocks", () => noticias.saveArticleAction({ ...article, status: "review", blocks: [] })],
    ["bad slug", () => noticias.saveArticleAction({ ...article, slug: "Com Espaço" })],
    ["http image", () => noticias.saveArticleAction({ ...article, blocks: [{ type: "image", url: "http://x.com/a.png", alt: "a", credit: "b" }] })],
    ["unknown moderation action", () => moderacao.moderateAction({ targetType: "photo", targetId: "p1", action: "delete" })],
    ["guide without steps", () => guias.saveGuideAction({ ...guide, steps: [] })],
    ["http feed", () => feeds.saveFeedAction({ name: "Feed", url: "http://exemplo.com/rss", active: true })],
    ["javascript feed", () => feeds.saveFeedAction({ name: "Feed", url: "javascript:alert(1)", active: true })],
    ["unknown scope", () => robos.createKeyAction({ name: "x", scopes: ["admin"] })],
    ["no scope", () => robos.createKeyAction({ name: "x", scopes: [] })],
    ["unknown role", () => usuarios.changeRoleAction({ userId: "u2", role: "root" })],
    ["unknown skill", () => jogos.saveGameOverridesAction({ gameId: "g1", skills: ["sabio"], aliases: [] })],
    ["extra field", () => fraude.confirmFraudAction({ ...fraudCase, achievementIds: ["a"] })],
    ["not an object", () => noticias.saveArticleAction("nope")],
  ])("%s is refused before anything runs", async (_, run) => {
    as("admin");
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result).not.toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    expectNothingRan();
  });
});
