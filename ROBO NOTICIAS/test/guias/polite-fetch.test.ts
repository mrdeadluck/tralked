import { describe, expect, it, vi } from "vitest";
import { openGuideDb } from "../../src/guias/db.js";
import { PAGE_TEXT_MAX, PAGE_TEXT_VERSION } from "../../src/guias/page-text.js";
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
    // After 7 days robots.txt is asked again too.
    expect(s.calls.slice(before)).toEqual(["https://a.test/robots.txt", "https://a.test/p"]);
  });

  it("texto de guia: tabela mantida e página guardada com a versão do extrator", async () => {
    const page = `<html><body><h1>Trophies</h1><table><tr><th>Trophy</th><th>How</th></tr><tr><td>Lost and Found</td><td>Give all treasures to Zhang</td></tr></table></body></html>`;
    const s = setup({ "https://a.test/t": [ok(page)] });
    const r = await politeFetch("https://a.test/t", s.opts);
    expect(r.text).toContain("Trophy | How\nLost and Found | Give all treasures to Zhang");
    expect(r.truncated).toBe(false);
    expect(s.db.getPage("https://a.test/t")).toMatchObject({ text_version: PAGE_TEXT_VERSION, text: r.text });
  });

  it("página em cache de um extrator antigo: texto refeito do HTML guardado, sem buscar de novo", async () => {
    const s = setup({});
    const fetchedAt = new Date(Date.parse("2026-11-03T12:00:00Z") - 86_400_000);
    const page = `<html><body><p>Intro</p><table><tr><td>Lost and Found</td><td>Give all treasures to Zhang</td></tr></table></body></html>`;
    s.db.savePage({ url: "https://a.test/old", fetchedAt, status: "ok", finalUrl: "https://a.test/old", text: "Intro", html: page, contentHash: "x" });
    const r = await politeFetch("https://a.test/old", s.opts);
    expect(s.calls).toEqual([]);
    expect(r).toMatchObject({ status: "ok", text: "Intro\nLost and Found | Give all treasures to Zhang", html: page });
    const row = s.db.getPage("https://a.test/old")!;
    expect(row).toMatchObject({ text: r.text, text_version: PAGE_TEXT_VERSION, fetched_at: fetchedAt.toISOString() });
    expect(row.content_hash).not.toBe("x");

    // Same version: the stored text is used as is.
    s.db.savePage({ url: "https://a.test/old", fetchedAt, status: "ok", finalUrl: "https://a.test/old", html: page, text: "kept", textVersion: PAGE_TEXT_VERSION });
    expect((await politeFetch("https://a.test/old", s.opts)).text).toBe("kept");
    expect(s.calls).toEqual([]);
  });

  it("página maior que o teto: texto cortado e marcado, também quando vem do cache", async () => {
    const rows = Array.from({ length: Math.ceil(PAGE_TEXT_MAX / 100) + 50 }, (_, i) => `<p>${String(i).padStart(6, "0")}${"x".repeat(93)}</p>`);
    const s = setup({ "https://a.test/big": [ok(`<html><body>${rows.join("")}</body></html>`)] });
    const first = await politeFetch("https://a.test/big", s.opts);
    expect(first.truncated).toBe(true);
    expect(first.text!.length).toBeLessThanOrEqual(PAGE_TEXT_MAX);
    const cached = await politeFetch("https://a.test/big", s.opts);
    expect(cached).toMatchObject({ truncated: true, text: first.text });
    expect(s.calls.filter((u) => u === "https://a.test/big")).toHaveLength(1);
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

describe("politeFetch: robots.txt fora do ar e redirecionamentos (RFC 9309)", () => {
  it("robots.txt com 5xx (também na nova tentativa): nada é lido do host, e só por alguns minutos", async () => {
    const s = setup({
      "https://a.test/robots.txt": [new Response("down", { status: 503 }), new Response("down", { status: 503 }), robots("User-agent: *\nAllow: /")],
      "https://a.test/p": [ok(html(LONG))],
    });
    const r = await politeFetch("https://a.test/p", s.opts);
    expect(r).toMatchObject({ status: "error", reason: "robots.txt inacessível (HTTP 503)" });
    // One more try a few seconds later before blocking the host.
    expect(s.calls).toEqual(["https://a.test/robots.txt", "https://a.test/robots.txt"]);
    expect(s.sleeps).toContain(5_000);
    // Still within the short cache: no new robots.txt request, still nothing read.
    s.advance(5 * 60_000);
    expect((await politeFetch("https://a.test/p", s.opts)).status).toBe("error");
    expect(s.calls).toHaveLength(2);
    // A few minutes later robots.txt is asked again, and now the page is read.
    s.advance(10 * 60_000);
    expect((await politeFetch("https://a.test/p", s.opts)).status).toBe("ok");
    expect(s.calls).toEqual(["https://a.test/robots.txt", "https://a.test/robots.txt", "https://a.test/robots.txt", "https://a.test/p"]);
  });

  it("robots.txt com 5xx que volta na nova tentativa: o host não é bloqueado", async () => {
    const s = setup({
      "https://a.test/robots.txt": [new Response("down", { status: 502 }), robots("User-agent: *\nAllow: /")],
      "https://a.test/p": [ok(html(LONG))],
    });
    expect((await politeFetch("https://a.test/p", s.opts)).status).toBe("ok");
    expect(s.calls).toEqual(["https://a.test/robots.txt", "https://a.test/robots.txt", "https://a.test/p"]);
  });

  it("robots.txt inalcançável (erro de rede) também bloqueia; a mesma cache curta vale entre execuções (banco)", async () => {
    const s = setup({});
    const failing = {
      ...s.opts,
      fetchFn: vi.fn<typeof fetch>(async () => {
        throw new Error("ETIMEDOUT");
      }),
    };
    expect(await politeFetch("https://z.test/p", failing)).toMatchObject({ status: "error", reason: expect.stringContaining("ETIMEDOUT") });
    expect(failing.fetchFn).toHaveBeenCalledTimes(2);
    // A new run (new state), same database: the short cache still holds.
    const again = { ...failing, state: createPoliteState() };
    expect((await politeFetch("https://z.test/p", again)).status).toBe("error");
    expect(failing.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("robots.txt com 4xx: tudo liberado (e fica 7 dias)", async () => {
    const s = setup({ "https://a.test/robots.txt": [new Response("gone", { status: 410 })], "https://a.test/p": [ok(html(LONG))] });
    expect((await politeFetch("https://a.test/p", s.opts)).status).toBe("ok");
  });

  it("redirecionamento para caminho proibido no outro host: bloqueado, sem ler o destino", async () => {
    const s = setup({
      "https://a.test/p": [new Response(null, { status: 301, headers: { Location: "https://b.test/private/q" } })],
      "https://b.test/robots.txt": [robots("User-agent: *\nDisallow: /private")],
    });
    const r = await politeFetch("https://a.test/p", s.opts);
    expect(r).toMatchObject({ status: "blocked", reason: "robots.txt" });
    expect(s.calls).toEqual(["https://a.test/robots.txt", "https://a.test/p", "https://b.test/robots.txt"]);
  });

  it("redirecionamento permitido: segue à mão, respeitando o intervalo do novo host", async () => {
    const s = setup({
      "https://b.test/x": [ok(html(LONG))],
      "https://a.test/p": [new Response(null, { status: 302, headers: { Location: "https://b.test/q" } })],
      "https://b.test/q": [ok(html(LONG))],
    });
    await politeFetch("https://b.test/x", s.opts);
    s.sleeps.length = 0;
    const r = await politeFetch("https://a.test/p", s.opts);
    expect(r).toMatchObject({ status: "ok", finalUrl: "https://b.test/q" });
    expect(s.sleeps).toEqual([2000]);
    for (const [, init] of s.opts.fetchFn.mock.calls) expect(init?.redirect).toBe("manual");
  });

  it("mais de 5 redirecionamentos: erro", async () => {
    const hop = (n: number) => new Response(null, { status: 301, headers: { Location: `https://a.test/h${n + 1}` } });
    const s = setup(Object.fromEntries([["https://a.test/h0", [hop(0)]], ...Array.from({ length: 7 }, (_, n) => [`https://a.test/h${n + 1}`, [hop(n + 1)]])]));
    const r = await politeFetch("https://a.test/h0", s.opts);
    expect(r).toMatchObject({ status: "error", reason: expect.stringContaining("redirecionamentos") });
    expect(s.calls.filter((u) => u.startsWith("https://a.test/h"))).toHaveLength(6);
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

  it("imagem redirecionada para caminho proibido → null, sem buscar", async () => {
    const s = setup({
      "https://a.test/i.jpg": [new Response(null, { status: 301, headers: { Location: "https://b.test/private/i.jpg" } })],
      "https://b.test/robots.txt": [robots("User-agent: *\nDisallow: /private")],
    });
    expect(await politeFetchImage("https://a.test/i.jpg", s.opts)).toBeNull();
    expect(s.calls).not.toContain("https://b.test/private/i.jpg");
  });
});
