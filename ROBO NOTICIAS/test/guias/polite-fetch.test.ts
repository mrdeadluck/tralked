import { describe, expect, it, vi } from "vitest";
import { openGuideDb } from "../../src/guias/db.js";
import { createPoliteState, politeFetch, politeFetchImage } from "../../src/guias/polite-fetch.js";

const html = (body: string, title = "Guide") =>
  `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p></article></body></html>`;
const LONG = "Walk north and open the chest next to the old tree. ".repeat(12);
const ok = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/html", ...headers } });
const robots = (txt: string) => new Response(txt, { status: 200, headers: { "Content-Type": "text/plain" } });

function setup(routes: Record<string, Response[]>) {
  let t = Date.parse("2026-11-03T12:00:00Z");
  const sleeps: number[] = [];
  const calls: string[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    calls.push(url);
    return routes[url]?.shift() ?? new Response("nf", { status: 404 });
  });
  const db = openGuideDb(":memory:");
  const opts = {
    db,
    fetchFn,
    state: createPoliteState(),
    now: () => new Date(t),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
  return { db, opts, calls, sleeps, advance: (ms: number) => (t += ms) };
}

describe("politeFetch", () => {
  it("robots Disallow bloqueia", async () => {
    const s = setup({ "https://a.test/robots.txt": [robots("User-agent: *\nDisallow: /secret")] });
    const r = await politeFetch("https://a.test/secret/page", s.opts);
    expect(r.status).toBe("blocked");
    expect(s.calls).toEqual(["https://a.test/robots.txt"]);
  });

  it("robots Allow for our agent and no robots.txt let the page through", async () => {
    const s = setup({
      "https://a.test/robots.txt": [robots("User-agent: *\nDisallow: /\n\nUser-agent: TralkedBot\nAllow: /")],
      "https://a.test/p": [ok(html(LONG))],
    });
    expect((await politeFetch("https://a.test/p", s.opts)).status).toBe("ok");
    const s2 = setup({ "https://b.test/p": [ok(html(LONG))] });
    expect((await politeFetch("https://b.test/p", s2.opts)).status).toBe("ok");
  });

  it("returns text and html, stores the page, and sends the TralkedBot User-Agent", async () => {
    const s = setup({ "https://a.test/p": [ok(html(LONG))] });
    const r = await politeFetch("https://a.test/p", s.opts);
    expect(r.status).toBe("ok");
    expect(r.html).toContain("<article>");
    expect(r.text).toContain("open the chest");
    expect(s.db.getPage("https://a.test/p")).toMatchObject({ status: "ok", final_url: "https://a.test/p" });
    const init = s.opts.fetchFn.mock.calls.at(-1)![1]!;
    expect(new Headers(init.headers).get("User-Agent")).toMatch(/^TralkedBot\//);
  });

  it("segunda busca no mesmo host espera 5 s em steamcommunity", async () => {
    const s = setup({
      "https://steamcommunity.com/a": [ok(html(LONG))],
      "https://steamcommunity.com/b": [ok(html(LONG))],
      "https://other.test/a": [ok(html(LONG))],
      "https://other.test/b": [ok(html(LONG))],
    });
    await politeFetch("https://steamcommunity.com/a", s.opts);
    s.sleeps.length = 0;
    await politeFetch("https://steamcommunity.com/b", s.opts);
    expect(s.sleeps).toEqual([5000]);

    await politeFetch("https://other.test/a", s.opts);
    s.sleeps.length = 0;
    await politeFetch("https://other.test/b", s.opts);
    expect(s.sleeps).toEqual([2000]);
  });

  it("cache de 7 dias evita nova requisição", async () => {
    const s = setup({ "https://a.test/p": [ok(html(LONG)), ok(html(LONG + " new"))] });
    await politeFetch("https://a.test/p", s.opts);
    const before = s.calls.length;
    s.advance(6 * 86_400_000);
    const again = await politeFetch("https://a.test/p", s.opts);
    expect(again.status).toBe("ok");
    expect(s.calls.length).toBe(before);
    s.advance(2 * 86_400_000);
    await politeFetch("https://a.test/p", s.opts);
    expect(s.calls.length).toBe(before + 1);
  });

  it("página Cloudflare vira challenge", async () => {
    const s = setup({
      "https://a.test/p": [new Response(html("Checking", "Just a moment..."), { status: 403, headers: { "Content-Type": "text/html" } })],
    });
    const r = await politeFetch("https://a.test/p", s.opts);
    expect(r.status).toBe("challenge");
    expect(s.db.getPage("https://a.test/p")).toBeUndefined();
  });

  it("429 respeita Retry-After e tenta uma vez", async () => {
    const s = setup({
      "https://a.test/p": [new Response("slow", { status: 429, headers: { "Retry-After": "30" } }), ok(html(LONG))],
      "https://a.test/q": [
        new Response("slow", { status: 429, headers: { "Retry-After": "999" } }),
        new Response("slow", { status: 429 }),
      ],
    });
    expect((await politeFetch("https://a.test/p", s.opts)).status).toBe("ok");
    expect(s.sleeps).toContain(30_000);

    s.sleeps.length = 0;
    const r = await politeFetch("https://a.test/q", s.opts);
    expect(r.status).toBe("error");
    expect(s.sleeps).toContain(120_000);
    expect(s.calls.filter((u) => u === "https://a.test/q")).toHaveLength(2);
  });

  it("reports HTTP errors and network failures as error", async () => {
    const s = setup({ "https://a.test/p": [new Response("x", { status: 500 })] });
    const r = await politeFetch("https://a.test/p", s.opts);
    expect(r).toMatchObject({ status: "error", reason: "HTTP 500" });
    const failing = {
      ...s.opts,
      fetchFn: vi.fn<typeof fetch>(async () => {
        throw new Error("ECONNRESET");
      }),
    };
    expect(await politeFetch("https://z.test/p", failing)).toMatchObject({
      status: "error",
      reason: expect.stringContaining("ECONNRESET"),
    });
  });
});

describe("politeFetchImage", () => {
  const image = (bytes = "jpeg") => new Response(bytes, { status: 200, headers: { "Content-Type": "image/jpeg" } });

  it("devolve os bytes da imagem respeitando o intervalo do host", async () => {
    const s = setup({ "https://a.test/a.jpg": [image("one")], "https://a.test/b.jpg": [image("two")] });
    expect((await politeFetchImage("https://a.test/a.jpg", s.opts))?.toString()).toBe("one");
    expect((await politeFetchImage("https://a.test/b.jpg", s.opts))?.toString()).toBe("two");
    expect(s.sleeps).toContain(2_000);
  });

  it("robots.txt proibindo, página de desafio ou erro → null", async () => {
    const s = setup({
      "https://a.test/robots.txt": [robots("User-agent: *\nDisallow: /private")],
      "https://a.test/c.jpg": [new Response("<html>Just a moment...</html>", { status: 403, headers: { "Content-Type": "text/html" } })],
      "https://a.test/d.jpg": [new Response("x", { status: 500, headers: { "Content-Type": "image/jpeg" } })],
    });
    expect(await politeFetchImage("https://a.test/private/x.jpg", s.opts)).toBeNull();
    expect(s.calls).not.toContain("https://a.test/private/x.jpg");
    expect(await politeFetchImage("https://a.test/c.jpg", s.opts)).toBeNull();
    expect(await politeFetchImage("https://a.test/d.jpg", s.opts)).toBeNull();
    expect(await politeFetchImage("data:image/png;base64,AAAA", s.opts)).toBeNull();
  });
});
