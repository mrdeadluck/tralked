import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ArticlePayload,
  articleKey,
  createTralked,
  slugify,
  TralkedError,
  updateKey,
} from "../src/tralked.js";

const BASE = "https://tralked.test";
const KEY = "tk_live_secret";

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function errorReply(status: number, code: string, issues: { path: string; message: string }[] = [], headers = {}) {
  return reply(status, { error: { code, message: `erro ${code}`, issues } }, headers);
}

function setup(...responses: (Response | Error)[]) {
  const queue = [...responses];
  const fetchFn = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    if (next instanceof Error) throw next;
    return next;
  });
  const client = createTralked({ baseUrl: `${BASE}/`, key: KEY, fetchFn });
  return { fetchFn, client };
}

const urlOf = (fetchFn: ReturnType<typeof setup>["fetchFn"], call: number) => String(fetchFn.mock.calls[call]![0]);
const initOf = (fetchFn: ReturnType<typeof setup>["fetchFn"], call: number) => fetchFn.mock.calls[call]![1]!;
const bodyOf = (fetchFn: ReturnType<typeof setup>["fetchFn"], call: number) =>
  JSON.parse(String(initOf(fetchFn, call).body)) as Record<string, unknown>;
const headerOf = (fetchFn: ReturnType<typeof setup>["fetchFn"], call: number, name: string) =>
  new Headers(initOf(fetchFn, call).headers).get(name);

const payload: ArticlePayload = {
  title: "Hades 2 chega ao Switch",
  category: "GAMES",
  platforms: ["NINTENDO"],
  games: [{ slug: "hades-2" }, { slug: "hades" }],
  blocks: [{ type: "paragraph", text: "Texto." }],
  status: "published",
};
const created = { id: "art_1", status: "published", url: `${BASE}/noticias/hades-2-chega-ao-switch` };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("slugify and keys", () => {
  it("matches the site's slugify", () => {
    expect(slugify("Ritual ou Banishment?")).toBe("ritual-ou-banishment");
    expect(slugify("Ação & Aventura: Édição Épica")).toBe("acao-aventura-edicao-epica");
    expect(slugify("???")).toBe("topico");
    const long = slugify("palavra ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });

  it("builds idempotency keys", () => {
    expect(articleKey("live", "abc123")).toBe("robo-live-story-abc123");
    expect(updateKey("art_1", 2)).toBe("robo-update-art_1-2");
  });
});

describe("auth and retries", () => {
  it("sends the bearer key on every call", async () => {
    const { client, fetchFn } = setup(reply(200, { games: [] }), reply(200, { articles: [] }));
    await client.findGame("Hades");
    await client.recentArticles(new Date("2026-10-01T00:00:00Z"));
    expect(headerOf(fetchFn, 0, "authorization")).toBe(`Bearer ${KEY}`);
    expect(headerOf(fetchFn, 1, "authorization")).toBe(`Bearer ${KEY}`);
  });

  it("retries after 429 honoring Retry-After", async () => {
    const { client, fetchFn } = setup(errorReply(429, "rate_limited", [], { "Retry-After": "7" }), reply(201, created));
    const promise = client.createArticle(payload, "robo-live-story-1");
    await vi.advanceTimersByTimeAsync(6_999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await expect(promise).resolves.toEqual({ id: "art_1", url: created.url, slug: "hades-2-chega-ao-switch" });
    expect(headerOf(fetchFn, 1, "idempotency-key")).toBe("robo-live-story-1");
  });

  it("retries 5xx 3 times with backoff, then throws", async () => {
    const { client, fetchFn } = setup(
      errorReply(503, "bad_request"),
      errorReply(500, "bad_request"),
      errorReply(502, "bad_request"),
      errorReply(500, "bad_request"),
    );
    const settled = client.insights("hades").then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const error = await settled;
    expect(error).toBeInstanceOf(TralkedError);
    expect((error as TralkedError).status).toBe(500);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("retries a network failure", async () => {
    const { client, fetchFn } = setup(new TypeError("fetch failed"), reply(200, { articles: [] }));
    const promise = client.recentArticles(new Date());
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws a 401 immediately without retrying", async () => {
    const { client, fetchFn } = setup(errorReply(401, "unauthorized"));
    const error = await client.createArticle(payload, "robo-live-story-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TralkedError);
    expect(error).toMatchObject({ status: 401, code: "unauthorized", issues: [] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("repairs", () => {
  it("retries a 422 on /games/1 without that game", async () => {
    const { client, fetchFn } = setup(
      errorReply(422, "validation_failed", [{ path: "/games/1", message: "Jogo não encontrado" }]),
      reply(201, created),
    );
    await client.createArticle(payload, "robo-live-story-1");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchFn, 0).games).toEqual([{ slug: "hades-2" }, { slug: "hades" }]);
    expect(bodyOf(fetchFn, 1).games).toEqual([{ slug: "hades-2" }]);
    expect(headerOf(fetchFn, 1, "idempotency-key")).toBe("robo-live-story-1");
  });

  it("repairs a 422 only once and does not touch other 422s", async () => {
    const again = errorReply(422, "validation_failed", [{ path: "/games/0", message: "Jogo não encontrado" }]);
    const { client, fetchFn } = setup(
      errorReply(422, "validation_failed", [{ path: "/games/1", message: "x" }]),
      again,
    );
    await expect(client.createArticle(payload, "k")).rejects.toMatchObject({ status: 422 });
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const other = setup(errorReply(422, "validation_failed", [{ path: "/blocks/0/text", message: "HTML" }]));
    await expect(other.client.createArticle(payload, "k")).rejects.toMatchObject({
      status: 422,
      issues: [{ path: "/blocks/0/text", message: "HTML" }],
    });
    expect(other.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries a 409 slug_conflict with a suffixed slug", async () => {
    const { client, fetchFn } = setup(
      errorReply(409, "slug_conflict", [{ path: "/slug", message: "Slug em uso" }]),
      reply(201, { ...created, url: `${BASE}/noticias/hades-2-chega-ao-switch-s42` }),
    );
    const result = await client.createArticle(payload, "robo-live-story-s42");
    expect(bodyOf(fetchFn, 1).slug).toBe("hades-2-chega-ao-switch-s42");
    expect(result.slug).toBe("hades-2-chega-ao-switch-s42");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("gives up when the suffixed slug conflicts too", async () => {
    const conflict = () => errorReply(409, "slug_conflict", [{ path: "/slug", message: "Slug em uso" }]);
    const { client, fetchFn } = setup(conflict(), conflict());
    await expect(client.createArticle(payload, "robo-live-story-s42")).rejects.toMatchObject({ code: "slug_conflict" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("reads and patch", () => {
  it("findGame prefers an exact alias match", async () => {
    const { client, fetchFn } = setup(
      reply(200, {
        games: [
          { slug: "god-of-war-ragnarok", name: "God of War Ragnarök", aliases: [] },
          { slug: "god-of-war-2018", name: "God of War (2018)", aliases: ["GoW"] },
        ],
      }),
    );
    await expect(client.findGame("gow")).resolves.toEqual({ slug: "god-of-war-2018", name: "God of War (2018)" });
    expect(urlOf(fetchFn, 0)).toBe(`${BASE}/api/v1/games?q=gow`);
  });

  it("findGame falls back to the first hit, then to null", async () => {
    const { client } = setup(
      reply(200, { games: [{ slug: "hades-2", name: "Hades II", aliases: [] }] }),
      reply(200, { games: [] }),
    );
    await expect(client.findGame("Hades")).resolves.toEqual({ slug: "hades-2", name: "Hades II" });
    await expect(client.findGame("Nada")).resolves.toBeNull();
  });

  it("findGame skips the request for names the site would reject", async () => {
    const { client, fetchFn } = setup();
    await expect(client.findGame(" a ")).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("insights and dossier return null on 404", async () => {
    const { client, fetchFn } = setup(errorReply(404, "not_found"), errorReply(404, "not_found"));
    await expect(client.insights("nope")).resolves.toBeNull();
    await expect(client.dossier("nope")).resolves.toBeNull();
    expect(urlOf(fetchFn, 0)).toBe(`${BASE}/api/v1/games/nope/insights`);
    expect(urlOf(fetchFn, 1)).toBe(`${BASE}/api/v1/games/nope/dossie`);
  });

  it("dossier returns the body", async () => {
    const dossier = { game: { slug: "hades" }, tralked: { players: 4 }, achievements: [] };
    const { client } = setup(reply(200, dossier));
    await expect(client.dossier("hades")).resolves.toEqual(dossier);
  });

  it("recentArticles sends since as UTC ISO with a Z and a limit", async () => {
    const feed = [{ id: "a", slug: "s", title: "t", category: "GAMES", publishedAt: "2026-10-30T10:00:00.000Z", source: "bot", games: [] }];
    const { client, fetchFn } = setup(reply(200, { articles: feed }));
    const since = new Date("2026-10-30T00:00:00-03:00");
    await expect(client.recentArticles(since)).resolves.toEqual(feed);
    const url = new URL(urlOf(fetchFn, 0));
    expect(url.pathname).toBe("/api/v1/articles");
    expect(url.searchParams.get("since")).toBe("2026-10-30T03:00:00.000Z");
    expect(url.search).not.toContain("%2B");
    expect(url.searchParams.get("limit")).toBe("200");
  });

  it("patchArticle sends PATCH with the key and resolves void", async () => {
    const { client, fetchFn } = setup(reply(200, { id: "art_1", status: "archived" }));
    await expect(client.patchArticle("art_1", { status: "archived" }, "robo-update-art_1-1")).resolves.toBeUndefined();
    expect(urlOf(fetchFn, 0)).toBe(`${BASE}/api/v1/articles/art_1`);
    expect(initOf(fetchFn, 0).method).toBe("PATCH");
    expect(headerOf(fetchFn, 0, "idempotency-key")).toBe("robo-update-art_1-1");
    expect(headerOf(fetchFn, 0, "content-type")).toBe("application/json");
    expect(bodyOf(fetchFn, 0)).toEqual({ status: "archived" });
  });
});
