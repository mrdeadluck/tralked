import { describe, expect, it, vi } from "vitest";
import { createGuideApi } from "../../src/guias/api.js";
import { TralkedError } from "../../src/tralked.js";

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(...responses: Response[]) {
  const queue = [...responses];
  const fetchFn = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return next;
  });
  return { fetchFn, api: createGuideApi({ baseUrl: "https://tralked.test/", key: "tk", fetchFn }) };
}
const call = (f: ReturnType<typeof setup>["fetchFn"], n = 0) => ({
  url: String(f.mock.calls[n]![0]),
  init: f.mock.calls[n]![1]!,
  header: (h: string) => new Headers(f.mock.calls[n]![1]!.headers).get(h),
});

describe("createGuideApi", () => {
  it("claimNext 204 → null", async () => {
    const { api, fetchFn } = setup(reply(204));
    expect(await api.claimNext()).toBeNull();
    expect(call(fetchFn).url).toBe("https://tralked.test/api/v1/guide-requests/next");
    expect(call(fetchFn).init.method).toBe("POST");
    expect(call(fetchFn).header("Authorization")).toBe("Bearer tk");
  });

  it("claimNext 200 returns the request", async () => {
    const { api } = setup(reply(200, { request: { id: "r1", steamAppId: 10, gameSlug: "g", attempts: 1 } }));
    expect(await api.claimNext()).toEqual({ id: "r1", steamAppId: 10, gameSlug: "g", attempts: 1 });
  });

  it("reportRequest PATCHes with the idempotency key", async () => {
    const { api, fetchFn } = setup(reply(200, { ok: true }));
    await api.reportRequest("r 1", { status: "waiting_sources", reason: "x" }, "k1");
    const c = call(fetchFn);
    expect(c.url).toBe("https://tralked.test/api/v1/guide-requests/r%201");
    expect(c.init.method).toBe("PATCH");
    expect(c.header("Idempotency-Key")).toBe("k1");
    expect(JSON.parse(String(c.init.body))).toEqual({ status: "waiting_sources", reason: "x" });
  });

  it("dossier asks for all achievements and media reads the catalog", async () => {
    const { api, fetchFn } = setup(reply(200, { game: {} }), reply(404, { error: { code: "not_found", message: "x" } }));
    await api.dossier("elden-ring");
    expect(call(fetchFn).url).toBe("https://tralked.test/api/v1/games/elden-ring/dossie?all=1");
    expect(await api.media("elden-ring")).toBeNull();
    expect(call(fetchFn, 1).url).toBe("https://tralked.test/api/v1/games/elden-ring/media");
  });

  it("uploadImage manda o corpo binário com Content-Type", async () => {
    const { api, fetchFn } = setup(reply(201, { url: "https://cdn.test/a.png", width: 10, height: 20 }));
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const out = await api.uploadImage(bytes, "image/png", "img-1");
    expect(out.url).toBe("https://cdn.test/a.png");
    const c = call(fetchFn);
    expect(c.url).toBe("https://tralked.test/api/v1/media");
    expect(c.header("Content-Type")).toBe("image/png");
    expect(c.header("Idempotency-Key")).toBe("img-1");
    expect(c.init.body).toBe(bytes);
  });

  it("createGuide and patchGuide (202 pending review)", async () => {
    const { api, fetchFn } = setup(reply(201, { id: "g1" }), reply(202, { id: "g1", status: "pending_review", pendingId: "p1" }));
    expect(await api.createGuide({ game: { slug: "a" } } as never, "c1")).toMatchObject({ id: "g1" });
    expect(call(fetchFn).url).toBe("https://tralked.test/api/v1/guides");
    const patched = await api.patchGuide("g1", { version: "2" } as never, "p-1");
    expect(patched).toEqual({ id: "g1", status: "pending_review", pendingId: "p1" });
    expect(call(fetchFn, 1).init.method).toBe("PATCH");
    expect(call(fetchFn, 1).url).toBe("https://tralked.test/api/v1/guides/g1");
  });

  it("findGameByAppId searches by steamAppId", async () => {
    const hit = { id: "i", slug: "hades", name: "Hades", steamAppId: 1145360, igdbId: null, aliases: [], guide: null };
    const { api, fetchFn } = setup(reply(200, { games: [hit] }), reply(200, { games: [] }));
    expect(await api.findGameByAppId(1145360)).toEqual(hit);
    expect(call(fetchFn).url).toBe("https://tralked.test/api/v1/games?steamAppId=1145360");
    expect(await api.findGameByAppId(1)).toBeNull();
  });

  it("surfaces API errors as TralkedError", async () => {
    const { api } = setup(reply(422, { error: { code: "invalid", message: "bad" } }));
    await expect(api.createGuide({} as never, "k")).rejects.toBeInstanceOf(TralkedError);
  });
});
