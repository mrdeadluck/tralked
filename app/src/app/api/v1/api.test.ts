import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag,
}));

const { prisma } = await import("@/lib/db");
const { createAchievements, testListId } = await import("@/lib/trophies/test-lists");
const { createApiKey, revokeApiKey } = await import("@/lib/api/keys");
const { consumeRateLimit, RATE_LIMIT, resetRateLimits } = await import("@/lib/api/rate-limit");
const { EXAMPLE_ARTICLE, EXAMPLE_GUIDE } = await import("@/lib/api/examples");
const articles = await import("./articles/route");
const articleById = await import("./articles/[id]/route");
const guides = await import("./guides/route");
const guideById = await import("./guides/[id]/route");
const games = await import("./games/route");
const { findGame } = await import("@/lib/api/games");
const insights = await import("./games/[slug]/insights/route");
const dossier = await import("./games/[slug]/dossie/route");
const media = await import("./games/[slug]/media/route");
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

  it.each(["MERCADO", "ENTRETENIMENTO", "TECNOLOGIA"])("201 accepts the %s category", async (category) => {
    const response = await articles.POST(
      call("POST", "/api/v1/articles", { key: keys.writer, body: article({ category }) }),
    );
    expect(response.status).toBe(201);
    const { id } = await json(response);
    const row = await prisma.article.findUniqueOrThrow({ where: { id: id as string } });
    expect(row.category).toBe(category);
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

  it("413 for a chunked body (no Content-Length) as soon as it passes 1 MiB, without reading the rest", async () => {
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let pulled = 0;
    // An endless stream: the request only ends because the reader stops at the limit.
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(`${BASE}/api/v1/articles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${keys.writer.secret}`,
        "idempotency-key": `t9-chunked-${seq++}`,
      },
      body: endless,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    const response = await articles.POST(request);
    expect(response.status).toBe(413);
    expect((await json(response)).error?.code).toBe("payload_too_large");
    expect(pulled).toBeLessThan(20); // 1 MiB is 16 chunks
  });

  it("422 without a stack overflow for JSON nested 3,000+ levels deep (articles and guides, POST and PATCH)", async () => {
    const deep = (levels: number) => `{"title":"fundo","blocks":${"[".repeat(levels)}${"]".repeat(levels)}}`;
    const created = await articles.POST(call("POST", "/api/v1/articles", { key: keys.publisher, body: article() }));
    const { id } = await json(created);
    const attempt = async (send: () => Promise<Response>) => {
      try {
        const response = await send();
        return { status: response.status, error: (await json(response)).error };
      } catch (error) {
        return { status: "threw", error: String(error) };
      }
    };
    const results = [
      await attempt(() => articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, raw: deep(3000) }))),
      await attempt(() => articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, raw: deep(50_000) }))),
      await attempt(() => guides.POST(call("POST", "/api/v1/guides", { key: keys.publisher, raw: deep(3000) }))),
      await attempt(() =>
        articleById.PATCH(call("PATCH", `/api/v1/articles/${id}`, { key: keys.publisher, raw: deep(3000) }), params(String(id))),
      ),
    ];
    const refused = { status: 422, error: { code: "validation_failed", message: expect.stringContaining("64 níveis"), issues: [] } };
    expect(results).toEqual([refused, refused, refused, refused]);
    // 64 levels is still fine (the body is then refused by the schema with a field path, not by depth).
    const atLimit = `{"title":"raso","blocks":${"[".repeat(63)}${"]".repeat(63)}}`;
    const shallow = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, raw: atLimit }));
    expect(shallow.status).toBe(422);
    expect((await json(shallow)).error?.issues.length).toBeGreaterThan(0);
  });
});

describe("backdated publishedAt", () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const post = (key: Key, body: Record<string, unknown>) =>
    articles.POST(call("POST", "/api/v1/articles", { key, body: article(body) }));

  it("201: a publish key backdates the article, which shows that date and is listed by it", async () => {
    const when = daysAgo(30);
    const response = await post(keys.publisher, { publishedAt: when, status: "published" });
    expect(response.status).toBe(201);
    const { id } = (await json(response)) as { id: string };
    const status = await json(await articleById.GET(call("GET", `/api/v1/articles/${id}`, { key: keys.publisher }), params(id)));
    expect(status.publishedAt).toBe(when);
    const row = await prisma.article.findUniqueOrThrow({ where: { id } });
    expect(row.publishedAt.toISOString()).toBe(when);
    expect(row.firstPublishedAt?.toISOString()).toBe(when);

    const { getNewsIndex } = await import("@/lib/queries/news");
    const { articles: list } = await getNewsIndex({ category: null, page: 1, pageSize: 100 });
    const dates = list.map((a) => a.publishedAt.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(list.find((a) => a.slug === row.slug)?.publishedAt.toISOString()).toBe(when);
  });

  it("accepts an offset other than Z and a time up to 5 minutes ahead", async () => {
    const instant = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const local = `${new Date(instant - 3 * 60 * 60 * 1000).toISOString().slice(0, 19)}-03:00`;
    const { id } = (await json(await post(keys.publisher, { publishedAt: local }))) as { id: string };
    expect((await prisma.article.findUniqueOrThrow({ where: { id } })).publishedAt.getTime()).toBe(Math.floor(instant / 1000) * 1000);
    const soon = await post(keys.publisher, { publishedAt: new Date(Date.now() + 2 * 60 * 1000).toISOString() });
    expect(soon.status).toBe(201);
  });

  it("defaults to published with the publish scope when only publishedAt is sent", async () => {
    const { id } = (await json(await post(keys.publisher, { publishedAt: daysAgo(3) }))) as { id: string };
    expect((await prisma.article.findUniqueOrThrow({ where: { id } })).status).toBe("published");
  });

  it("403 on /publishedAt for a key without the publish scope", async () => {
    const response = await post(keys.writer, { publishedAt: daysAgo(30) });
    expect(response.status).toBe(403);
    expect((await json(response)).error?.issues).toEqual([{ path: "/publishedAt", message: expect.any(String) }]);
  });

  it.each([
    ["200 days ago", () => daysAgo(200)],
    ["1 hour ahead", () => new Date(Date.now() + 60 * 60 * 1000).toISOString()],
    ["not a date", () => "ontem"],
    ["a date without offset", () => "2026-10-01T10:00:00"],
  ])("422 on /publishedAt for %s", async (_name, when) => {
    const response = await post(keys.publisher, { publishedAt: when() });
    expect(response.status).toBe(422);
    expect((await json(response)).error?.issues.map((i) => i.path)).toEqual(["/publishedAt"]);
  });

  it("422 on /publishedAt together with status review", async () => {
    const response = await post(keys.publisher, { publishedAt: daysAgo(2), status: "review" });
    expect(response.status).toBe(422);
    expect((await json(response)).error?.issues.map((i) => i.path)).toEqual(["/publishedAt"]);
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
    expect(page).toMatchObject({ source: "bot", reviewed: true, humanAuthored: false, authorHandle: "Robô t9 redator", authorLabel: "Equipe Tralked", bot: true });
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

describe("archiving with PATCH", () => {
  it("a publish key archives its published article, which leaves the public list", async () => {
    const created = await articles.POST(call("POST", "/api/v1/articles", { key: keys.publisher, body: article() }));
    const { id } = (await json(created)) as { id: string };
    const row = await prisma.article.findUniqueOrThrow({ where: { id } });
    const { getNewsIndex } = await import("@/lib/queries/news");
    const listed = async () =>
      (await getNewsIndex({ category: null, page: 1, pageSize: 100 })).articles.some((a) => a.slug === row.slug);
    expect(await listed()).toBe(true);

    revalidateTag.mockClear();
    const response = await articleById.PATCH(
      call("PATCH", `/api/v1/articles/${id}`, { key: keys.publisher, body: { status: "archived" } }),
      params(id),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ id, status: "archived" });
    expect(await listed()).toBe(false);
    expect(revalidateTag).toHaveBeenCalledWith("news", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`article:${row.slug}`, { expire: 0 });
    const archived = await prisma.article.findUniqueOrThrow({ where: { id } });
    expect(archived.publishedAt.getTime()).toBe(row.publishedAt.getTime());
  });

  it("republishing an archived article keeps its backdated publishedAt", async () => {
    const when = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const created = await articles.POST(
      call("POST", "/api/v1/articles", { key: keys.publisher, body: article({ publishedAt: when }) }),
    );
    const { id } = (await json(created)) as { id: string };
    const patch = (status: string) =>
      articleById.PATCH(call("PATCH", `/api/v1/articles/${id}`, { key: keys.publisher, body: { status } }), params(id));

    expect((await patch("archived")).status).toBe(200);
    expect((await patch("published")).status).toBe(200);
    const row = await prisma.article.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("published");
    expect(row.publishedAt.toISOString()).toBe(when);
    expect(row.firstPublishedAt?.toISOString()).toBe(when);
  });

  it("a review article published by PATCH still gets the current time", async () => {
    const created = await articles.POST(
      call("POST", "/api/v1/articles", { key: keys.publisher, body: article({ status: "review" }) }),
    );
    const { id } = (await json(created)) as { id: string };
    const before = Date.now();
    const response = await articleById.PATCH(
      call("PATCH", `/api/v1/articles/${id}`, { key: keys.publisher, body: { status: "published" } }),
      params(id),
    );
    expect(response.status).toBe(200);
    const row = await prisma.article.findUniqueOrThrow({ where: { id } });
    expect(row.publishedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.firstPublishedAt?.getTime()).toBe(row.publishedAt.getTime());
  });

  it("403 for a key without the publish scope, and POST still refuses archived", async () => {
    const created = await articles.POST(call("POST", "/api/v1/articles", { key: keys.writer, body: article() }));
    const { id } = (await json(created)) as { id: string };
    const response = await articleById.PATCH(
      call("PATCH", `/api/v1/articles/${id}`, { key: keys.writer, body: { status: "archived" } }),
      params(id),
    );
    expect(response.status).toBe(403);
    expect((await json(response)).error?.issues).toEqual([{ path: "/status", message: expect.any(String) }]);
    expect((await prisma.article.findUniqueOrThrow({ where: { id } })).status).toBe("review");

    const post = await articles.POST(call("POST", "/api/v1/articles", { key: keys.publisher, body: article({ status: "archived" }) }));
    expect(post.status).toBe(422);
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

  it("PATCH replaces the fields sent; without keys, steps keep their ids by position and version 2 is saved", async () => {
    const before = await prisma.guideStep.findMany({ where: { guideId }, orderBy: { order: "asc" } });
    const response = await guideById.PATCH(
      call("PATCH", `/api/v1/guides/${guideId}`, {
        key: keys.guides,
        body: {
          version: "1.1",
          warnings: ["Novo aviso."],
          steps: [EXAMPLE_GUIDE.steps[1], EXAMPLE_GUIDE.steps[0]],
        },
      }),
      params(guideId),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ id: guideId, revision: 2, status: "review" });
    const guide = await prisma.guide.findUniqueOrThrow({
      where: { id: guideId },
      include: { steps: { orderBy: { order: "asc" } }, notes: true, versions: { orderBy: { version: "asc" } } },
    });
    expect(guide.version).toBe("v1.1");
    expect(guide.warnings).toEqual(["Novo aviso."]);
    expect(guide.overview).toEqual(EXAMPLE_GUIDE.overview);
    expect(guide.steps.map((s) => s.id)).toEqual(before.map((s) => s.id));
    expect(guide.steps[0].title).toBe(EXAMPLE_GUIDE.steps[1].title);
    expect(guide.notes).toHaveLength(1);
    expect(guide.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(guide.versions[1].snapshot).toMatchObject({ version: "v1.1", warnings: ["Novo aviso."] });

    const status = await guideById.GET(call("GET", `/api/v1/guides/${guideId}`, { key: keys.guides }), params(guideId));
    expect(await json(status)).toMatchObject({ id: guideId, revision: 2, steps: 2, game: { slug: "hades" } });
    const foreign = await guideById.GET(call("GET", `/api/v1/guides/${guideId}`, { key: keys.publisher }), params(guideId));
    expect(foreign.status).toBe(404);
  });

  it("422 when the number of steps changes without keys, or keys are mixed (nothing is written)", async () => {
    const patch = async (steps: unknown[]) =>
      guideById.PATCH(call("PATCH", `/api/v1/guides/${guideId}`, { key: keys.guides, body: { steps } }), params(guideId));
    const fewer = await patch([EXAMPLE_GUIDE.steps[0]]);
    expect(fewer.status).toBe(422);
    expect((await json(fewer)).error?.issues).toEqual([{ path: "/steps", message: expect.stringContaining("key") }]);
    const mixed = await patch([{ ...EXAMPLE_GUIDE.steps[0], key: "a" }, EXAMPLE_GUIDE.steps[1]]);
    expect(mixed.status).toBe(422);
    // Keyed, but the stored steps have no keys yet and the count differs: adopting by position is
    // impossible, and matching nothing would delete every step (and every reader's checkmarks).
    const keyedOther = await patch([{ ...EXAMPLE_GUIDE.steps[0], key: "so-um" }]);
    expect(keyedOther.status).toBe(422);
    expect((await json(keyedOther)).error?.issues).toEqual([{ path: "/steps", message: expect.stringContaining("key") }]);
    expect(await prisma.guideStep.count({ where: { guideId } })).toBe(2);
    expect(await prisma.guideVersion.count({ where: { guideId } })).toBe(2);
  });

  it("with keys, reordering, inserting and removing steps keep readers' checkmarks on their steps", async () => {
    const reader = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const [first, second] = await prisma.guideStep.findMany({ where: { guideId }, orderBy: { order: "asc" } });
    await prisma.guideStepProgress.createMany({
      data: [
        { userId: reader.id, stepId: first.id },
        { userId: reader.id, stepId: second.id },
      ],
    });
    const step = (key: string, title: string) => ({ ...EXAMPLE_GUIDE.steps[0], key, title });
    const patch = async (steps: unknown[]) =>
      guideById.PATCH(call("PATCH", `/api/v1/guides/${guideId}`, { key: keys.guides, body: { steps } }), params(guideId));

    // First keyed update with the same count: the stored steps adopt the keys by position.
    expect((await patch([step("um", "Um"), step("dois", "Dois")])).status).toBe(200);
    let rows = await prisma.guideStep.findMany({ where: { guideId }, orderBy: { order: "asc" } });
    expect(rows.map((r) => [r.id, r.key])).toEqual([
      [first.id, "um"],
      [second.id, "dois"],
    ]);

    // Reorder and insert in the middle.
    expect((await patch([step("dois", "Dois"), step("novo", "Novo"), step("um", "Um")])).status).toBe(200);
    rows = await prisma.guideStep.findMany({ where: { guideId }, orderBy: { order: "asc" } });
    expect(rows.map((r) => r.key)).toEqual(["dois", "novo", "um"]);
    expect(rows[0].id).toBe(second.id);
    expect(rows[2].id).toBe(first.id);
    const marked = async () =>
      (await prisma.guideStepProgress.findMany({ where: { userId: reader.id, step: { guideId } }, select: { step: { select: { key: true } } } }))
        .map((p) => p.step.key)
        .sort();
    expect(await marked()).toEqual(["dois", "um"]);

    // Remove "dois": only its checkmark goes.
    expect((await patch([step("novo", "Novo"), step("um", "Um")])).status).toBe(200);
    expect(await marked()).toEqual(["um"]);
    const snapshot = (await prisma.guideVersion.findFirstOrThrow({ where: { guideId }, orderBy: { version: "desc" } })).snapshot;
    expect(snapshot).toMatchObject({ steps: [{ key: "novo" }, { key: "um" }] });
  });

  it("PATCH of a published guide without publish waits for an editor (202, guide untouched)", async () => {
    await prisma.guide.update({ where: { id: guideId }, data: { status: "published" } });
    const response = await guideById.PATCH(
      call("PATCH", `/api/v1/guides/${guideId}`, { key: keys.guides, body: { warnings: [] } }),
      params(guideId),
    );
    expect(response.status).toBe(202);
    expect(await json(response)).toMatchObject({ id: guideId, status: "pending_review", pendingId: expect.any(String) });
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

  describe("catalog stubs", () => {
    const created = ["t20-stub-saga", "t20-real-saga", "t20-pop-low", "t20-pop-high", "t20-stub-app"];
    const hits = async (query: string) =>
      ((await json(await games.GET(call("GET", `/api/v1/games${query}`, { key: keys.reader })))).games as { slug: string }[]).map((g) => g.slug);

    beforeAll(async () => {
      const base = { platforms: [], achievementCount: 0 };
      await prisma.game.createMany({
        data: [
          { ...base, slug: "t20-stub-saga", name: "T20 Zeta Saga", stub: true, steamAppId: 990020001, igdbId: 990020001 },
          { ...base, slug: "t20-real-saga", name: "T20 Zeta Saga Remastered" },
          { ...base, slug: "t20-pop-low", name: "T20 Popularity Alpha", popularity: 10 },
          { ...base, slug: "t20-pop-high", name: "T20 Popularity Beta", popularity: 5000 },
          { ...base, slug: "t20-stub-app", name: "T20 Stub App", stub: true, steamAppId: 990020002 },
        ],
      });
    });
    afterAll(async () => {
      await prisma.game.deleteMany({ where: { slug: { in: created } } });
    });

    it("q returns only the non-stub when a stub and a non-stub have similar names", async () => {
      expect(await hits("?q=t20 zeta saga")).toEqual(["t20-real-saga"]);
    });

    it("q orders by popularity descending, then by name", async () => {
      expect(await hits("?q=t20 popularity")).toEqual(["t20-pop-high", "t20-pop-low"]);
    });

    it("slug, steamAppId and igdbId lookups of a stub return an empty list", async () => {
      expect(await hits("?steamAppId=990020002")).toEqual([]);
      expect(await hits("?igdbId=990020001")).toEqual([]);
      expect(await hits("?slug=t20-stub-saga")).toEqual([]);
      expect(await hits("?slug=t20-real-saga")).toEqual(["t20-real-saga"]);
    });

    it("the IGDB id or old slug of a merged duplicate finds the game it was joined into", async () => {
      const target = await prisma.game.findUniqueOrThrow({ where: { slug: "t20-real-saga" }, select: { id: true } });
      await prisma.gameIgdbAlias.create({ data: { igdbId: 990020009, gameId: target.id } });
      await prisma.gameSlugRedirect.create({ data: { fromSlug: "t20-merged-saga", gameId: target.id } });
      try {
        expect(await hits("?igdbId=990020009")).toEqual(["t20-real-saga"]);
        expect(await hits("?slug=t20-merged-saga")).toEqual(["t20-real-saga"]);
        expect(await findGame({ igdbId: 990020009 })).toEqual(expect.objectContaining({ slug: "t20-real-saga" }));
        expect(await findGame({ slug: "t20-merged-saga" })).toEqual(expect.objectContaining({ slug: "t20-real-saga" }));
        expect(await findGame({ igdbId: 990020099 })).toBeNull();
      } finally {
        await prisma.gameIgdbAlias.deleteMany({ where: { igdbId: 990020009 } });
        await prisma.gameSlugRedirect.deleteMany({ where: { fromSlug: "t20-merged-saga" } });
      }
    });
  });

  it("400 for a bad parameter; 401 without a key", async () => {
    const bad = await games.GET(call("GET", "/api/v1/games?steamAppId=abc", { key: keys.reader }));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error?.issues).toEqual([{ path: "?steamAppId", message: expect.any(String) }]);
    expect((await games.GET(call("GET", "/api/v1/games?q=", { key: keys.reader }))).status).toBe(400);
    expect((await games.GET(call("GET", "/api/v1/games?q=hades"))).status).toBe(401);
  });
});

describe("GET /api/v1/articles (recent feed)", () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
  const feed = async (query = "", key: Key | null = keys.reader) =>
    articles.GET(call("GET", `/api/v1/articles${query}`, { key }));
  const slugs = async (query = "") =>
    ((await json(await feed(query))).articles as { slug: string }[]).map((a) => a.slug);

  const createdSlugs: string[] = [];
  afterAll(async () => {
    await prisma.article.deleteMany({ where: { slug: { in: createdSlugs } } });
  });

  async function insertArticle(slug: string, data: { status: string; source: string; publishedAt: Date; games?: string[] }) {
    createdSlugs.push(slug);
    const author = await prisma.author.findFirstOrThrow();
    const found = await prisma.game.findMany({ where: { slug: { in: data.games ?? [] } }, select: { id: true } });
    await prisma.article.create({
      data: {
        slug,
        title: `Feed ${slug}`,
        body: "",
        blocks: [],
        status: data.status,
        category: "GAMES",
        platforms: [],
        imageLabel: slug,
        authorId: author.id,
        source: data.source,
        publishedAt: data.publishedAt,
        games: { create: found.map((g) => ({ gameId: g.id })) },
      },
    });
  }

  beforeAll(async () => {
    await insertArticle("t4-feed-editorial", { status: "published", source: "editorial", publishedAt: hoursAgo(5), games: ["hades", "celeste"] });
    await insertArticle("t4-feed-bot", { status: "published", source: "bot", publishedAt: hoursAgo(2) });
    await insertArticle("t4-feed-draft", { status: "draft", source: "editorial", publishedAt: hoursAgo(1) });
    await insertArticle("t4-feed-review", { status: "review", source: "bot", publishedAt: hoursAgo(1) });
    await insertArticle("t4-feed-archived", { status: "archived", source: "bot", publishedAt: hoursAgo(3) });
    await insertArticle("t4-feed-old", { status: "published", source: "editorial", publishedAt: hoursAgo(24 * 10) });
  });

  it("lists editorial and bot articles of the last 7 days, newest first, without drafts, archived or older ones", async () => {
    const response = await feed();
    expect(response.status).toBe(200);
    const body = await json(response);
    const list = body.articles as { id: string; slug: string; title: string; category: string; publishedAt: string; source: string; games: string[] }[];
    const mine = list.filter((a) => a.slug.startsWith("t4-feed-"));
    expect(mine.map((a) => a.slug)).toEqual(["t4-feed-bot", "t4-feed-editorial"]);
    expect(mine[0]).toEqual({
      id: expect.any(String),
      slug: "t4-feed-bot",
      title: "Feed t4-feed-bot",
      category: "GAMES",
      publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      source: "bot",
      games: [],
    });
    expect(mine[1]).toMatchObject({ source: "editorial", games: ["celeste", "hades"] });
    const times = list.map((a) => Date.parse(a.publishedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(list.every((a) => Date.now() - Date.parse(a.publishedAt) <= 7 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  it("omits catalog stubs from an article's games", async () => {
    await prisma.game.create({
      data: { slug: "t20-feed-stub", name: "T20 Feed Stub", stub: true, platforms: [], achievementCount: 0 },
    });
    try {
      await insertArticle("t4-feed-stub", {
        status: "published",
        source: "editorial",
        publishedAt: hoursAgo(1),
        games: ["hades", "t20-feed-stub"],
      });
      const list = (await json(await feed())).articles as { slug: string; games: string[] }[];
      expect(list.find((a) => a.slug === "t4-feed-stub")?.games).toEqual(["hades"]);
    } finally {
      await prisma.article.deleteMany({ where: { slug: "t4-feed-stub" } });
      await prisma.game.deleteMany({ where: { slug: "t20-feed-stub" } });
    }
  });

  it("since moves the lower bound; limit caps the list", async () => {
    expect(await slugs(`?since=${hoursAgo(4).toISOString()}`)).toEqual(expect.arrayContaining(["t4-feed-bot"]));
    expect((await slugs(`?since=${hoursAgo(4).toISOString()}`)).includes("t4-feed-editorial")).toBe(false);
    expect(await slugs(`?since=${hoursAgo(24 * 11).toISOString()}`)).toContain("t4-feed-old");
    expect(await slugs("?limit=1")).toHaveLength(1);
  });

  it("400 on ?limit and ?since when malformed or out of range", async () => {
    for (const [query, param] of [
      ["?limit=500", "?limit"],
      ["?limit=0", "?limit"],
      ["?limit=abc", "?limit"],
      ["?since=ontem", "?since"],
      ["?since=2026-10-01", "?since"],
    ] as const) {
      const response = await feed(query);
      expect(response.status, query).toBe(400);
      expect((await json(response)).error?.issues).toEqual([{ path: param, message: expect.any(String) }]);
    }
  });

  it("401 without a key", async () => {
    expect((await feed("", null)).status).toBe(401);
  });
});

describe("GET /api/v1/games/{slug}/insights", () => {
  const slug = "t4-insights-game";
  const ask = (path: string, key: Key | null = keys.reader) =>
    insights.GET(call("GET", path, { key }), { params: Promise.resolve({ slug: path.split("/")[4] }) });
  let userIds: string[] = [];

  beforeAll(async () => {
    userIds = (await prisma.user.findMany({ take: 3, orderBy: { handle: "asc" }, select: { id: true } })).map((u) => u.id);
    const game = await prisma.game.create({
      data: {
        slug,
        name: "T4 Insights",
        platforms: ["PC"],
        achievementCount: 7,
        timeToBeatCompleteMin: 600,
        releaseDate: new Date("2024-05-06T00:00:00Z"),
      },
    });
    await createAchievements(game.id, [
      { apiName: "A_COMMON", name: "Comum", globalPct: 80 },
      { apiName: "A_RARE", name: "Rara", globalPct: 1.5 },
      { apiName: "A_HIDDEN", name: "Escondida", globalPct: 0.1, hidden: true },
      { apiName: "A_NULL", name: "Sem dado", globalPct: null },
      { apiName: "B_20", name: "Vinte", globalPct: 20 },
      { apiName: "B_10", name: "Dez", globalPct: 10 },
      { apiName: "B_5", name: "Cinco", globalPct: 5 },
      { apiName: "B_40", name: "Quarenta", globalPct: 40 },
    ]);
  });

  afterAll(async () => {
    await prisma.game.deleteMany({ where: { slug } });
  });

  const play = async (gameId: string, rows: [number, number][]) => {
    await prisma.userGame.deleteMany({ where: { gameId } });
    await prisma.userGame.createMany({
      data: rows.map(([i, playtimeMin]) => ({ userId: userIds[i], gameId, platform: "steam", playtimeMin, unlockedCount: 0 })),
    });
  };

  it("with 2 players the average playtime stays hidden", async () => {
    const { id } = await prisma.game.findUniqueOrThrow({ where: { slug } });
    await play(id, [[0, 100], [1, 300]]);
    const response = await ask(`/api/v1/games/${slug}/insights`);
    expect(response.status).toBe(200);
    expect((await json(response)).tralked).toEqual({ players: 2, avgPlaytimeMin: null });
  });

  it("with 3 players it is their average; zero-minute libraries count as players only", async () => {
    const { id } = await prisma.game.findUniqueOrThrow({ where: { slug } });
    await play(id, [[0, 100], [1, 300], [2, 500]]);
    expect((await json(await ask(`/api/v1/games/${slug}/insights`))).tralked).toEqual({ players: 3, avgPlaytimeMin: 300 });
    await play(id, [[0, 100], [1, 300], [2, 0]]);
    expect((await json(await ask(`/api/v1/games/${slug}/insights`))).tralked).toEqual({ players: 3, avgPlaytimeMin: null });
  });

  it("counts a user once even when they own the game on two platforms", async () => {
    const { id } = await prisma.game.findUniqueOrThrow({ where: { slug } });
    await play(id, [[0, 100], [1, 300]]);
    await prisma.userGame.create({ data: { userId: userIds[0], gameId: id, platform: "psn", playtimeMin: 50, unlockedCount: 0 } });
    expect((await json(await ask(`/api/v1/games/${slug}/insights`))).tralked).toEqual({ players: 2, avgPlaytimeMin: null });
  });

  it("describes the game and lists the 5 rarest visible achievements, ascending, with no user data", async () => {
    const { id } = await prisma.game.findUniqueOrThrow({ where: { slug } });
    await play(id, [[0, 100], [1, 300], [2, 500]]);
    const response = await ask(`/api/v1/games/${slug}/insights`);
    const body = await json(response);
    expect(body.game).toEqual({
      slug,
      name: "T4 Insights",
      releaseDate: "2024-05-06T00:00:00.000Z",
      platforms: ["PC"],
      achievementCount: 7,
      timeToBeatCompleteMin: 600,
    });
    expect(body.rarest).toEqual([
      { platform: "steam", apiName: "A_RARE", name: "Rara", globalPct: 1.5 },
      { platform: "steam", apiName: "B_5", name: "Cinco", globalPct: 5 },
      { platform: "steam", apiName: "B_10", name: "Dez", globalPct: 10 },
      { platform: "steam", apiName: "B_20", name: "Vinte", globalPct: 20 },
      { platform: "steam", apiName: "B_40", name: "Quarenta", globalPct: 40 },
    ]);
    expect(Object.keys(body).sort()).toEqual(["game", "rarest", "tralked"]);
    const text = JSON.stringify(body);
    const handles = (await prisma.user.findMany({ where: { id: { in: userIds } }, select: { handle: true } })).map((u) => u.handle);
    for (const forbidden of [...userIds, ...handles]) expect(text).not.toContain(forbidden);
  });

  it("a game with no data has null release and zero players", async () => {
    const bare = await prisma.game.create({ data: { slug: "t4-insights-bare", name: "T4 Bare", platforms: [], achievementCount: 0 } });
    try {
      const body = await json(await ask("/api/v1/games/t4-insights-bare/insights"));
      expect(body).toEqual({
        game: { slug: "t4-insights-bare", name: "T4 Bare", releaseDate: null, platforms: [], achievementCount: 0, timeToBeatCompleteMin: null },
        tralked: { players: 0, avgPlaytimeMin: null },
        rarest: [],
      });
    } finally {
      await prisma.game.delete({ where: { id: bare.id } });
    }
  });

  it("404 for a catalog stub", async () => {
    await prisma.game.create({ data: { slug: "t20-insights-stub", name: "T20 Stub", stub: true, platforms: [], achievementCount: 0 } });
    try {
      expect((await ask("/api/v1/games/t20-insights-stub/insights")).status).toBe(404);
    } finally {
      await prisma.game.deleteMany({ where: { slug: "t20-insights-stub" } });
    }
  });

  it("404 for an unknown slug, 401 without a key", async () => {
    const missing = await ask("/api/v1/games/jogo-que-nao-existe/insights");
    expect(missing.status).toBe(404);
    expect((await json(missing)).error?.code).toBe("not_found");
    expect((await ask(`/api/v1/games/${slug}/insights`, null)).status).toBe(401);
  });
});

describe("GET /api/v1/games/{slug}/dossie", () => {
  const slug = "t16-dossier-game";
  const ask = (path: string, key: Key | null = keys.reader) =>
    dossier.GET(call("GET", path, { key }), { params: Promise.resolve({ slug: path.split("/")[4] }) });
  let userIds: string[] = [];
  let gameId = "";

  beforeAll(async () => {
    userIds = (await prisma.user.findMany({ take: 3, orderBy: { handle: "asc" }, select: { id: true } })).map((u) => u.id);
    const game = await prisma.game.create({
      data: {
        slug,
        name: "T16 Dossier",
        steamAppId: 1600016,
        summary: "Um jogo de teste.",
        developer: "Estúdio T16",
        publisher: "Editora T16",
        criticScore: 88,
        platforms: ["PC", "PlayStation"],
        achievementCount: 5,
        timeToBeatCompleteMin: 900,
        releaseDate: new Date("2023-03-04T00:00:00Z"),
      },
    });
    await createAchievements(game.id, [
      { apiName: "D_COMMON", name: "Comum", description: "Faça o básico.", globalPct: 80 },
      { apiName: "D_RARE", name: "Rara", description: "Faça o difícil.", globalPct: 1.5 },
      { apiName: "D_HIDDEN", name: "Escondida", description: "Segredo.", globalPct: 0.1, hidden: true },
      { apiName: "D_NULL", name: "Sem dado", description: null, globalPct: null },
      { apiName: "D_MID", name: "Meio", description: "No meio.", globalPct: 20 },
      { platform: "psn", apiName: "D_PSN", name: "Troféu", description: "Troféu PSN.", globalPct: 5 },
    ]);
    gameId = game.id;
  });

  afterAll(async () => {
    await prisma.game.deleteMany({ where: { slug } });
  });

  const play = async (rows: [number, number, boolean?][]) => {
    await prisma.userGame.deleteMany({ where: { gameId } });
    await prisma.userGame.createMany({
      data: rows.map(([i, playtimeMin, done]) => ({
        userId: userIds[i],
        gameId,
        platform: "steam",
        playtimeMin,
        unlockedCount: 0,
        completedAt: done ? new Date("2025-01-01T00:00:00Z") : null,
      })),
    });
  };

  it("lists every visible achievement with its description, rarest first and unknown rarity last", async () => {
    const response = await ask(`/api/v1/games/${slug}/dossie`);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.achievements).toEqual([
      { platform: "steam", apiName: "D_RARE", name: "Rara", description: "Faça o difícil.", globalPct: 1.5 },
      { platform: "psn", apiName: "D_PSN", name: "Troféu", description: "Troféu PSN.", globalPct: 5 },
      { platform: "steam", apiName: "D_MID", name: "Meio", description: "No meio.", globalPct: 20 },
      { platform: "steam", apiName: "D_COMMON", name: "Comum", description: "Faça o básico.", globalPct: 80 },
      { platform: "steam", apiName: "D_NULL", name: "Sem dado", description: null, globalPct: null },
    ]);
    expect(JSON.stringify(body)).not.toContain("D_HIDDEN");
  });

  it("describes the game", async () => {
    const body = await json(await ask(`/api/v1/games/${slug}/dossie`));
    expect(body.game).toEqual({
      slug,
      name: "T16 Dossier",
      steamAppId: 1600016,
      summary: "Um jogo de teste.",
      developer: "Estúdio T16",
      publisher: "Editora T16",
      releaseDate: "2023-03-04T00:00:00.000Z",
      platforms: ["PC", "PlayStation"],
      criticScore: 88,
      timeToBeatCompleteMin: 900,
      achievementCount: 5,
    });
    expect(Object.keys(body).sort()).toEqual(["achievements", "game", "tralked"]);
  });

  it("with 2 players the average playtime stays hidden but completions are counted", async () => {
    await play([[0, 100, true], [1, 300]]);
    expect((await json(await ask(`/api/v1/games/${slug}/dossie`))).tralked).toEqual({
      players: 2,
      avgPlaytimeMin: null,
      completedPlayers: 1,
    });
  });

  it("with 3 players it is their average, with no user data in the response", async () => {
    await play([[0, 100, true], [1, 300, true], [2, 500]]);
    const body = await json(await ask(`/api/v1/games/${slug}/dossie`));
    expect(body.tralked).toEqual({ players: 3, avgPlaytimeMin: 300, completedPlayers: 2 });
    const text = JSON.stringify(body);
    const handles = (await prisma.user.findMany({ where: { id: { in: userIds } }, select: { handle: true } })).map((u) => u.handle);
    for (const forbidden of [...userIds, ...handles]) expect(text).not.toContain(forbidden);
  });

  it("a game with no data has nulls, no achievements and zero players", async () => {
    const bare = await prisma.game.create({ data: { slug: "t16-dossier-bare", name: "T16 Bare", platforms: [], achievementCount: 0 } });
    try {
      expect(await json(await ask("/api/v1/games/t16-dossier-bare/dossie"))).toEqual({
        game: {
          slug: "t16-dossier-bare",
          name: "T16 Bare",
          steamAppId: null,
          summary: null,
          developer: null,
          publisher: null,
          releaseDate: null,
          platforms: [],
          criticScore: null,
          timeToBeatCompleteMin: null,
          achievementCount: 0,
        },
        tralked: { players: 0, avgPlaytimeMin: null, completedPlayers: 0 },
        achievements: [],
      });
    } finally {
      await prisma.game.delete({ where: { id: bare.id } });
    }
  });

  it("404 for a catalog stub", async () => {
    await prisma.game.create({ data: { slug: "t20-dossier-stub", name: "T20 Stub", stub: true, platforms: [], achievementCount: 0 } });
    try {
      expect((await ask("/api/v1/games/t20-dossier-stub/dossie")).status).toBe(404);
    } finally {
      await prisma.game.deleteMany({ where: { slug: "t20-dossier-stub" } });
    }
  });

  it("caps the achievements at 500, keeping the rarest", async () => {
    const big = await prisma.game.create({ data: { slug: "t16-dossier-big", name: "T16 Big", platforms: ["PC"], achievementCount: 501 } });
    try {
      const listId = await testListId(big.id);
      await prisma.achievement.createMany({
        data: Array.from({ length: 501 }, (_, i) => ({ gameId: big.id, listId, apiName: `BIG_${i}`, name: `Big ${i}`, globalPct: i / 10 })),
      });
      const { achievements } = (await json(await ask("/api/v1/games/t16-dossier-big/dossie"))) as { achievements: { apiName: string }[] };
      expect(achievements).toHaveLength(500);
      expect(achievements[0].apiName).toBe("BIG_0");
      expect(achievements.some((a) => a.apiName === "BIG_500")).toBe(false);
    } finally {
      await prisma.game.delete({ where: { id: big.id } });
    }
  });

  it("404 for an unknown or malformed slug, 401 without a key", async () => {
    const missing = await ask("/api/v1/games/jogo-que-nao-existe/dossie");
    expect(missing.status).toBe(404);
    expect((await json(missing)).error?.code).toBe("not_found");
    expect((await ask("/api/v1/games/Slug%20Invalido!/dossie")).status).toBe(404);
    expect((await ask(`/api/v1/games/${slug}/dossie`, null)).status).toBe(401);
  });
});

describe("GET /api/v1/games/{slug}/media", () => {
  const slug = "g1-media-game";
  const ask = (path: string, key: Key | null = keys.reader) =>
    media.GET(call("GET", path, { key }), { params: Promise.resolve({ slug: path.split("/")[4] }) });
  const igdb = (kind: string, id: string) => `https://images.igdb.com/igdb/image/upload/t_${kind}/${id}.jpg`;

  beforeAll(async () => {
    await prisma.game.create({
      data: {
        slug,
        name: "G1 Media",
        developer: "Estúdio G1",
        publisher: "Editora G1",
        platforms: ["PC"],
        achievementCount: 0,
        heroUrl: "https://cdn2.steamgriddb.com/hero/g1.png",
        coverUrl: igdb("cover_big", "cover"),
        media: {
          create: [
            { kind: "cover", url: igdb("cover_big", "cover2"), source: "igdb", order: 0 },
            { kind: "logo", url: "https://cdn2.steamgriddb.com/logo/g1.png", source: "sgdb", order: 0 },
            { kind: "artwork", url: igdb("screenshot_big", "art1"), source: "igdb", order: 0, width: 1920, height: 1080 },
            { kind: "screenshot", url: igdb("screenshot_big", "shot2"), source: "igdb", order: 1 },
            { kind: "screenshot", url: igdb("screenshot_big", "shot1"), source: "igdb", order: 0, width: 1280, height: 720 },
            { kind: "screenshot", url: "http://insecure.example/shot.jpg", source: "steam", order: 2 },
            { kind: "screenshot", url: igdb("t_720p", "shot1"), source: "steam", order: 3 },
            { kind: "video", youtubeId: "BBBBBBBBBBB", source: "igdb", order: 1 },
            { kind: "video", youtubeId: "AAAAAAAAAAA", source: "igdb", order: 0 },
            { kind: "video", youtubeId: "not-an-id", source: "igdb", order: 2 },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.game.deleteMany({ where: { slug } });
  });

  it("lists the hero, then screenshots and artworks (1080p, https, no repeats), and the videos in order", async () => {
    const response = await ask(`/api/v1/games/${slug}/media`);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.game).toEqual({ slug, name: "G1 Media", developer: "Estúdio G1", publisher: "Editora G1" });
    expect(body.images).toEqual([
      { url: "https://cdn2.steamgriddb.com/hero/g1.png", kind: "hero", width: null, height: null, source: null },
      { url: igdb("1080p", "shot1"), kind: "screenshot", width: 1280, height: 720, source: "igdb" },
      { url: igdb("1080p", "shot2"), kind: "screenshot", width: null, height: null, source: "igdb" },
      { url: igdb("1080p", "art1"), kind: "artwork", width: 1920, height: 1080, source: "igdb" },
    ]);
    expect(body.videos).toEqual([{ youtubeId: "AAAAAAAAAAA" }, { youtubeId: "BBBBBBBBBBB" }]);
  });

  it("a game without media answers empty lists", async () => {
    const bare = await prisma.game.create({ data: { slug: "g1-media-bare", name: "G1 Bare", platforms: [], achievementCount: 0 } });
    try {
      const body = await json(await ask("/api/v1/games/g1-media-bare/media"));
      expect(body).toEqual({
        game: { slug: "g1-media-bare", name: "G1 Bare", developer: null, publisher: null },
        images: [],
        videos: [],
      });
    } finally {
      await prisma.game.delete({ where: { id: bare.id } });
    }
  });

  it("404 for a stub, an unknown or a malformed slug; 401 without a key", async () => {
    await prisma.game.create({ data: { slug: "g1-media-stub", name: "G1 Stub", stub: true, platforms: [], achievementCount: 0 } });
    try {
      expect((await ask("/api/v1/games/g1-media-stub/media")).status).toBe(404);
    } finally {
      await prisma.game.deleteMany({ where: { slug: "g1-media-stub" } });
    }
    const missing = await ask("/api/v1/games/jogo-que-nao-existe/media");
    expect(missing.status).toBe(404);
    expect((await json(missing)).error?.code).toBe("not_found");
    expect((await ask("/api/v1/games/Slug%20Invalido!/media")).status).toBe(404);
    expect((await ask(`/api/v1/games/${slug}/media`, null)).status).toBe(401);
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
