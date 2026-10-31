import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag,
}));

const { prisma } = await import("@/lib/db");
const { createApiKey, revokeApiKey } = await import("@/lib/api/keys");
const { consumeRateLimit, RATE_LIMIT, resetRateLimits } = await import("@/lib/api/rate-limit");
const { EXAMPLE_ARTICLE, EXAMPLE_GUIDE } = await import("@/lib/api/examples");
const articles = await import("./articles/route");
const articleById = await import("./articles/[id]/route");
const guides = await import("./guides/route");
const guideById = await import("./guides/[id]/route");
const games = await import("./games/route");
const openapi = await import("./openapi.json/route");
const articleSchema = await import("./schemas/article.json/route");
const guideSchema = await import("./schemas/guide.json/route");

type Key = { id: string; secret: string };
const keys: Record<"writer" | "publisher" | "guides" | "reader", Key> = {} as never;
const extraKeys: string[] = [];
let seq = 0;

const BASE = "http://localhost:3000";

function call(
  method: string,
  path: string,
  { key, body, idem, raw, headers }: { key?: Key | null; body?: unknown; idem?: string | null; raw?: string; headers?: Record<string, string> } = {},
) {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (key) h.authorization = `Bearer ${key.secret}`;
  if (idem !== null && method !== "GET") h["idempotency-key"] = idem ?? `t9-${Date.now()}-${seq++}`;
  return new Request(`${BASE}${path}`, {
    method,
    headers: h,
    body: method === "GET" ? undefined : (raw ?? JSON.stringify(body)),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** A small valid article with a unique slug. */
function article(overrides: Record<string, unknown> = {}) {
  return {
    title: `Robô testa a API ${seq++}`,
    category: "GAMES",
    blocks: [{ type: "paragraph", text: "Texto **simples** com [link](https://exemplo.com)." }],
    ...overrides,
  };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown> & {
    error?: { code: string; message: string; issues: { path: string; message: string }[] };
  };
}

async function cleanup() {
  const ids = [...Object.values(keys).map((k) => k.id), ...extraKeys];
  const names = await prisma.apiKey.findMany({ where: { id: { in: ids } }, select: { name: true } });
  await prisma.article.deleteMany({ where: { botKeyId: { in: ids } } });
  await prisma.guide.deleteMany({ where: { botKeyId: { in: ids } } });
  await prisma.author.deleteMany({ where: { handle: { in: names.map((n) => `Robô ${n.name}`) } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  keys.writer = await createApiKey({ name: "t9 redator", scopes: ["articles:write"] });
  keys.publisher = await createApiKey({ name: "t9 editor", scopes: ["articles:write", "guides:write", "publish"] });
  keys.guides = await createApiKey({ name: "t9 guias", scopes: ["guides:write"] });
  keys.reader = await createApiKey({ name: "t9 leitor", scopes: ["media:write"] });
});

afterAll(cleanup);

beforeEach(() => {
  resetRateLimits();
  revalidateTag.mockClear();
});

describe("authentication and scopes", () => {
  it("401 without a key, with a malformed key and with an unknown key", async () => {
    for (const key of [null, { id: "x", secret: "nada" }, { id: "x", secret: `tk_live_${"A".repeat(43)}` }]) {
      const response = await articles.POST(call("POST", "/api/v1/articles", { key, body: article() }));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
      expect((await json(response)).error).toMatchObject({ code: "unauthorized", issues: [] });
    }
  });

  it("401 once the key is revoked", async () => {
    const key = await createApiKey({ name: "t9 revogada", scopes: ["articles:write"] });
    extraKeys.push(key.id);
    expect((await articles.POST(call("POST", "/api/v1/articles", { key, body: article() }))).status).toBe(201);
    await revokeApiKey(key.id);
    const response = await articles.POST(call("POST", "/api/v1/articles", { key, body: article() }));
    expect(response.status).toBe(401);
  });

  it("403 without the endpoint's scope", async () => {
    const response = await articles.POST(call("POST", "/api/v1/articles", { key: keys.guides, body: article() }));
    expect(response.status).toBe(403);
    expect((await json(response)).error?.code).toBe("forbidden");
    const guide = await guides.POST(call("POST", "/api/v1/guides", { key: keys.writer, body: EXAMPLE_GUIDE }));
    expect(guide.status).toBe(403);
  });

  it("403 when asking to publish without the publish scope", async () => {
    const response = await articles.POST(
      call("POST", "/api/v1/articles", { key: keys.writer, body: article({ status: "published" }) }),
    );
    expect(response.status).toBe(403);
    expect((await json(response)).error?.issues).toEqual([{ path: "/status", message: expect.any(String) }]);
  });

  it("429 after 60 requests in a minute, with Retry-After", async () => {
    for (let i = 0; i < RATE_LIMIT; i++) consumeRateLimit(keys.reader.id);
    const response = await games.GET(call("GET", "/api/v1/games?q=hades", { key: keys.reader }));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await json(response)).error?.code).toBe("rate_limited");
  });
});

describe("POST /api/v1/articles", () => {
  it("201: the full example enters the review queue as a bot article", async () => {
    const response = await articles.POST(
      call("POST", "/api/v1/articles", { key: keys.writer, body: { ...EXAMPLE_ARTICLE, slug: "t9-exemplo-completo" } }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("x-ratelimit-remaining")).toBe(String(RATE_LIMIT - 1));
    const body = await json(response);
    expect(body).toEqual({
      id: expect.any(String),
      status: "review",
      url: expect.stringMatching(/\/noticias\/t9-exemplo-completo$/),
    });
    const row = await prisma.article.findUniqueOrThrow({
      where: { id: body.id as string },
      include: { author: true, games: { include: { game: true } } },
    });
    expect(row).toMatchObject({
      status: "review",
      source: "bot",
      botKeyId: keys.writer.id,
      humanAuthored: false,
      reviewedAt: null,
      category: "GAMES",
      imageLabel: "hades",
    });
    expect(row.author.handle).toBe("Robô t9 redator");
    expect(row.games.map((g) => g.game.slug)).toEqual(["hades"]);
    expect(row.blocks).toEqual(
      EXAMPLE_ARTICLE.blocks.map((b) => (b.type === "achievement" ? { ...b, platform: "steam" } : b)),
    );
    expect(revalidateTag).not.toHaveBeenCalled();
    const log = await prisma.ingestionLog.findFirstOrThrow({ where: { resultId: row.id } });
    expect(log).toMatchObject({ kind: "article", status: "created", requestHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("201 published directly with the publish scope, generating the slug and invalidating the news cache", async () => {
    const response = await articles.POST(
      call("POST", "/api/v1/articles", { key: keys.publisher, body: article({ title: "Ação: Ótimo título t9" }) }),
    );
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.status).toBe("published");
    expect(body.url).toMatch(/\/noticias\/acao-otimo-titulo-t9$/);
    expect(revalidateTag).toHaveBeenCalledWith("news", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("article:acao-otimo-titulo-t9", { expire: 0 });
  });

  it("normalizes CRLF and CR to LF before validating, so Windows line endings are the same request", async () => {
    const crlf = article({
      slug: "t9-crlf",
      blocks: [
        { type: "paragraph", text: "Linha um\r\nLinha dois\rLinha três" },
        { type: "list", ordered: false, items: ["a\r\nb"] },
      ],
    });
    const created = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: crlf, idem: "t9-crlf" }));
    expect(created.status).toBe(201);
    const { id } = (await json(created)) as { id: string };
    const row = await prisma.article.findUniqueOrThrow({ where: { id } });
    expect(row.blocks).toEqual([
      { type: "paragraph", text: "Linha um\nLinha dois\nLinha três" },
      { type: "list", ordered: false, items: ["a\nb"] },
    ]);

    const lf = {
      ...crlf,
      blocks: [
        { type: "paragraph", text: "Linha um\nLinha dois\nLinha três" },
        { type: "list", ordered: false, items: ["a\nb"] },
      ],
    };
    const replay = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: lf, idem: "t9-crlf" }));
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
  });

  it("422 for HTML, http images, script links, unknown fields and bad types, each with its JSON Pointer", async () => {
    const response = await articles.POST(
      call("POST", "/api/v1/articles", {
        key: keys.writer,
        body: {
          title: "<img src=x onerror=alert(1)>",
          category: "FOFOCA",
          html: "<p>oi</p>",
          blocks: [
            { type: "paragraph", text: "ok <script>alert(1)</script>" },
            { type: "image", url: "http://inseguro.com/a.jpg", alt: "a", credit: "b" },
            { type: "image", url: "javascript:alert(1)", alt: "a", credit: "b" },
            { type: "paragraph", text: "[clique](javascript:alert(1))" },
            { type: "video", youtubeId: "<iframe>" },
            { type: "embed", html: "<div/>" },
          ],
        },
      }),
    );
    expect(response.status).toBe(422);
    const { error } = await json(response);
    expect(error?.code).toBe("validation_failed");
    const paths = error!.issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/title",
        "/category",
        "/html",
        "/blocks/0/text",
        "/blocks/1/url",
        "/blocks/2/url",
        "/blocks/3/text",
        "/blocks/4/youtubeId",
        "/blocks/5/type",
      ]),
    );
    expect(error!.issues.find((i) => i.path === "/html")?.message).toBe("Campo desconhecido");
    expect(error!.issues.find((i) => i.path === "/blocks/1/url")?.message).toContain("https://");
  });

  it("422 for a game that does not exist, pointing at the game", async () => {
    const response = await articles.POST(
      call("POST", "/api/v1/articles", {
        key: keys.writer,
        body: article({ games: [{ slug: "hades" }, { slug: "jogo-que-nao-existe" }, { steamAppId: 999999999 }] }),
      }),
    );
    expect(response.status).toBe(422);
    const { error } = await json(response);
    expect(error?.issues.map((i) => i.path)).toEqual(["/games/1", "/games/2"]);
    expect(error?.issues[0].message).toContain('slug "jogo-que-nao-existe"');
  });

  it("409 when the slug is taken (chosen or generated)", async () => {
    const chosen = await articles.POST(
      call("POST", "/api/v1/articles", {
        key: keys.writer,
        body: article({ slug: "hollow-knight-guia-100-por-cento-em-7-etapas" }),
      }),
    );
    expect(chosen.status).toBe(409);
    expect((await json(chosen)).error).toMatchObject({ code: "slug_conflict", issues: [{ path: "/slug" }] });

    const first = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: article({ title: "Mesmo título t9" }) }));
    expect(first.status).toBe(201);
    const again = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: article({ title: "Mesmo título t9" }) }));
    expect(again.status).toBe(409);
  });

  it("400 for invalid JSON and for a missing Idempotency-Key; 413 for a huge body", async () => {
    const broken = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, raw: "{ nope" }));
    expect(broken.status).toBe(400);
    expect((await json(broken)).error?.code).toBe("invalid_json");

    const noKey = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: article(), idem: null }));
    expect(noKey.status).toBe(400);
    expect((await json(noKey)).error?.code).toBe("idempotency_key_required");

    const huge = await articles.POST(
      call("POST", "/api/v1/articles", { key: keys.writer, raw: JSON.stringify({ title: "x".repeat(1024 * 1024) }) }),
    );
    expect(huge.status).toBe(413);
  });
});

describe("idempotency", () => {
  it("same key and same body: the same answer, and only one article", async () => {
    const body = article({ slug: "t9-idempotente" });
    const first = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body, idem: "t9-idem-1" }));
    expect(first.status).toBe(201);
    const firstBody = await json(first);

    // Same content with keys in another order is the same request.
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    const second = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: reordered, idem: "t9-idem-1" }));
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(await json(second)).toEqual(firstBody);
    expect(await prisma.article.count({ where: { slug: "t9-idempotente" } })).toBe(1);
  });

  it("same key with another body (or endpoint): 409", async () => {
    await articles.POST(call("POST", "/api/v1/articles", { key: keys.publisher, body: article(), idem: "t9-idem-2" }));
    const other = await articles.POST(call("POST", "/api/v1/articles", { key: keys.publisher, body: article(), idem: "t9-idem-2" }));
    expect(other.status).toBe(409);
    expect((await json(other)).error?.code).toBe("idempotency_conflict");
    const elsewhere = await guides.POST(call("POST", "/api/v1/guides", { key: keys.publisher, body: EXAMPLE_GUIDE, idem: "t9-idem-2" }));
    expect(elsewhere.status).toBe(409);
  });

  it("the same Idempotency-Key on another API key is independent", async () => {
    const a = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: article(), idem: "t9-idem-shared" }));
    const b = await articles.POST(call("POST", "/api/v1/articles", { key: keys.publisher, body: article(), idem: "t9-idem-shared" }));
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it("a refused request does not use up the key: the fixed body goes through with the same key", async () => {
    const bad = await articles.POST(
      call("POST", "/api/v1/articles", { key: keys.writer, body: article({ blocks: [] }), idem: "t9-idem-3" }),
    );
    expect(bad.status).toBe(422);
    const log = await prisma.ingestionLog.findUniqueOrThrow({
      where: { keyId_idempotencyKey: { keyId: keys.writer.id, idempotencyKey: "t9-idem-3" } },
    });
    expect(log).toMatchObject({ status: "rejected", error: { code: "validation_failed", issues: [{ path: "/blocks" }] } });

    const fixed = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: article(), idem: "t9-idem-3" }));
    expect(fixed.status).toBe(201);
    const after = await prisma.ingestionLog.findUniqueOrThrow({
      where: { keyId_idempotencyKey: { keyId: keys.writer.id, idempotencyKey: "t9-idem-3" } },
    });
    expect(after.status).toBe("created");
  });

  it("concurrent requests with the same key create one article and give the same answer", async () => {
    const body = article({ slug: "t9-concorrente" });
    const responses = await Promise.all(
      [1, 2, 3].map(() => articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body, idem: "t9-idem-race" }))),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    const ids = new Set(await Promise.all(responses.map(async (r) => (await json(r)).id)));
    expect(ids.size).toBe(1);
    expect(await prisma.article.count({ where: { slug: "t9-concorrente" } })).toBe(1);
  });
});

describe("GET and PATCH /api/v1/articles/{id}", () => {
  it("shows and updates the key's own article; other keys get 404", async () => {
    const created = await json(
      await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: article({ slug: "t9-alteravel" }) })),
    );
    const id = created.id as string;

    const status = await articleById.GET(call("GET", `/api/v1/articles/${id}`, { key: keys.writer }), params(id));
    expect(status.status).toBe(200);
    expect(await json(status)).toMatchObject({ id, slug: "t9-alteravel", status: "review", reviewed: false, publishedAt: null });

    const foreign = await articleById.GET(call("GET", `/api/v1/articles/${id}`, { key: keys.publisher }), params(id));
    expect(foreign.status).toBe(404);
    const editorial = await prisma.article.findFirstOrThrow({ where: { source: "editorial" } });
    const notMine = await articleById.PATCH(
      call("PATCH", `/api/v1/articles/${editorial.id}`, { key: keys.writer, body: { title: "Sequestro" } }),
      params(editorial.id),
    );
    expect(notMine.status).toBe(404);

    const patched = await articleById.PATCH(
      call("PATCH", `/api/v1/articles/${id}`, { key: keys.writer, body: { title: "Título novo", games: [{ slug: "celeste" }] } }),
      params(id),
    );
    expect(patched.status).toBe(200);
    expect(await json(patched)).toMatchObject({ id, status: "review" });
    const row = await prisma.article.findUniqueOrThrow({ where: { id }, include: { games: { include: { game: true } } } });
    expect(row.title).toBe("Título novo");
    expect(row.slug).toBe("t9-alteravel");
    expect(row.games.map((g) => g.game.slug)).toEqual(["celeste"]);

    const unknownField = await articleById.PATCH(
      call("PATCH", `/api/v1/articles/${id}`, { key: keys.writer, body: { slug: "outro" } }),
      params(id),
    );
    expect(unknownField.status).toBe(422);
    expect((await json(unknownField)).error?.issues[0].path).toBe("/slug");
  });

  it("409 when the newsroom already published it and the key cannot publish", async () => {
    const { id } = (await json(
      await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: article() })),
    )) as { id: string };
    // The editor approves it in the admin.
    await prisma.article.update({ where: { id }, data: { status: "published", reviewedAt: new Date() } });
    const response = await articleById.PATCH(
      call("PATCH", `/api/v1/articles/${id}`, { key: keys.writer, body: { title: "Mudança tardia" } }),
      params(id),
    );
    expect(response.status).toBe(409);
    expect((await json(response)).error?.code).toBe("published_locked");
    const status = await json(await articleById.GET(call("GET", `/api/v1/articles/${id}`, { key: keys.writer }), params(id)));
    expect(status).toMatchObject({ status: "published", reviewed: true, publishedAt: expect.any(String) });

    // The article page reads it as a reviewed bot article by "Robô <key name>".
    const { getArticle } = await import("@/lib/queries/news");
    const page = await getArticle(status.slug as string);
    expect(page).toMatchObject({ source: "bot", reviewed: true, humanAuthored: false, authorHandle: "Robô t9 redator" });
  });

  it("a publish key can publish its review article with PATCH", async () => {
    const { id } = (await json(
      await articles.POST(call("POST", "/api/v1/articles", { key: keys.publisher, body: article({ status: "review" }) })),
    )) as { id: string };
    const response = await articleById.PATCH(
      call("PATCH", `/api/v1/articles/${id}`, { key: keys.publisher, body: { status: "published" } }),
      params(id),
    );
    expect(await json(response)).toMatchObject({ status: "published" });
    expect(revalidateTag).toHaveBeenCalledWith("news", { expire: 0 });
  });
});

describe("guides", () => {
  let guideId = "";

  it("201: creates the documented guide in review, with steps, notes and version 1", async () => {
    const response = await guides.POST(call("POST", "/api/v1/guides", { key: keys.guides, body: EXAMPLE_GUIDE }));
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body).toMatchObject({ status: "review", revision: 1, url: expect.stringMatching(/\/jogos\/hades\/guia$/) });
    guideId = body.id as string;

    const guide = await prisma.guide.findUniqueOrThrow({
      where: { id: guideId },
      include: { steps: { orderBy: { order: "asc" } }, notes: true, versions: true },
    });
    expect(guide).toMatchObject({ source: "bot", botKeyId: keys.guides.id, authorId: null, status: "review", version: "v1.0", difficulty: 6 });
    expect(guide.steps.map((s) => s.title)).toEqual(EXAMPLE_GUIDE.steps.map((s) => s.title));
    expect(guide.steps[0].body).toContain("Jogue no ritmo normal até completar a primeira fuga.");
    expect(guide.steps[0].body).not.toContain("**");
    expect(guide.steps[0].blocks).toEqual(EXAMPLE_GUIDE.steps[0].body);
    expect(guide.steps[1].achievementApiNames).toEqual(["HELLBENT"]);
    expect(guide.notes).toHaveLength(1);
    expect(guide.notes[0]).toMatchObject({ category: "desafio", tipBlocks: EXAMPLE_GUIDE.achievementNotes[0].tip });
    expect(guide.sources).toEqual(EXAMPLE_GUIDE.sources);
    expect(guide.versions.map((v) => v.version)).toEqual([1]);
    expect(guide.versions[0].snapshot).toMatchObject({ format: 1, game: "hades", steps: [{ title: EXAMPLE_GUIDE.steps[0].title }, {}] });
  });

  it("409 when the game already has a guide", async () => {
    const response = await guides.POST(
      call("POST", "/api/v1/guides", { key: keys.guides, body: { ...EXAMPLE_GUIDE, game: { slug: "hollow-knight" } } }),
    );
    expect(response.status).toBe(409);
    expect((await json(response)).error).toMatchObject({ code: "guide_exists", issues: [{ path: "/game" }] });
  });

  it("422 for an unknown game or achievement, by path", async () => {
    const game = await guides.POST(
      call("POST", "/api/v1/guides", { key: keys.guides, body: { ...EXAMPLE_GUIDE, game: { igdbId: 424242 } } }),
    );
    expect(game.status).toBe(422);
    expect((await json(game)).error?.issues).toEqual([{ path: "/game", message: expect.any(String) }]);

    const achievement = await guides.POST(
      call("POST", "/api/v1/guides", {
        key: keys.guides,
        body: {
          ...EXAMPLE_GUIDE,
          game: { slug: "celeste" },
          steps: [{ ...EXAMPLE_GUIDE.steps[0], achievements: ["NAO_EXISTE"] }],
        },
      }),
    );
    expect(achievement.status).toBe(422);
    expect((await json(achievement)).error?.issues.map((i) => i.path)).toEqual([
      "/steps/0/achievements/0",
      "/achievementNotes/0/apiName",
    ]);
  });

  it("PATCH replaces the fields sent, keeps step ids by position and saves version 2", async () => {
    const before = await prisma.guideStep.findMany({ where: { guideId }, orderBy: { order: "asc" } });
    const response = await guideById.PATCH(
      call("PATCH", `/api/v1/guides/${guideId}`, {
        key: keys.guides,
        body: {
          version: "1.1",
          warnings: ["Novo aviso."],
          steps: [EXAMPLE_GUIDE.steps[1]],
        },
      }),
      params(guideId),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ id: guideId, revision: 2, status: "review" });
    const guide = await prisma.guide.findUniqueOrThrow({
      where: { id: guideId },
      include: { steps: true, notes: true, versions: { orderBy: { version: "asc" } } },
    });
    expect(guide.version).toBe("v1.1");
    expect(guide.warnings).toEqual(["Novo aviso."]);
    expect(guide.overview).toEqual(EXAMPLE_GUIDE.overview);
    expect(guide.steps).toHaveLength(1);
    expect(guide.steps[0].id).toBe(before[0].id);
    expect(guide.steps[0].title).toBe(EXAMPLE_GUIDE.steps[1].title);
    expect(guide.notes).toHaveLength(1);
    expect(guide.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(guide.versions[1].snapshot).toMatchObject({ version: "v1.1", warnings: ["Novo aviso."] });

    const status = await guideById.GET(call("GET", `/api/v1/guides/${guideId}`, { key: keys.guides }), params(guideId));
    expect(await json(status)).toMatchObject({ id: guideId, revision: 2, steps: 1, game: { slug: "hades" } });
    const foreign = await guideById.GET(call("GET", `/api/v1/guides/${guideId}`, { key: keys.publisher }), params(guideId));
    expect(foreign.status).toBe(404);
  });

  it("PATCH of a published guide needs the publish scope", async () => {
    await prisma.guide.update({ where: { id: guideId }, data: { status: "published" } });
    const response = await guideById.PATCH(
      call("PATCH", `/api/v1/guides/${guideId}`, { key: keys.guides, body: { warnings: [] } }),
      params(guideId),
    );
    expect(response.status).toBe(409);
    expect((await json(response)).error?.code).toBe("published_locked");
  });
});

describe("GET /api/v1/games", () => {
  it("finds games by name, slug and Steam appid, with their guide", async () => {
    const byName = await json(await games.GET(call("GET", "/api/v1/games?q=hollow", { key: keys.reader })));
    expect(byName.games).toEqual([
      expect.objectContaining({ slug: "hollow-knight", steamAppId: 367520, guide: expect.objectContaining({ status: "published" }) }),
    ]);
    const bySlug = await json(await games.GET(call("GET", "/api/v1/games?slug=celeste", { key: keys.reader })));
    expect((bySlug.games as { slug: string }[]).map((g) => g.slug)).toEqual(["celeste"]);
    const byApp = await json(await games.GET(call("GET", "/api/v1/games?steamAppId=620", { key: keys.reader })));
    expect((byApp.games as { slug: string }[]).map((g) => g.slug)).toEqual(["portal-2"]);
  });

  it("400 for a bad parameter; 401 without a key", async () => {
    const bad = await games.GET(call("GET", "/api/v1/games?steamAppId=abc", { key: keys.reader }));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error?.issues).toEqual([{ path: "?steamAppId", message: expect.any(String) }]);
    expect((await games.GET(call("GET", "/api/v1/games?q=", { key: keys.reader }))).status).toBe(400);
    expect((await games.GET(call("GET", "/api/v1/games?q=hades"))).status).toBe(401);
  });
});

describe("public documents", () => {
  it("serve the OpenAPI document and both JSON Schemas", async () => {
    expect((await (await openapi.GET()).json()).openapi).toBe("3.1.0");
    const article = await articleSchema.GET();
    expect(article.headers.get("content-type")).toContain("application/schema+json");
    expect((await article.json()).$id).toBe("/api/v1/schemas/article.json");
    expect((await (await guideSchema.GET()).json()).$id).toBe("/api/v1/schemas/guide.json");
  });
});
