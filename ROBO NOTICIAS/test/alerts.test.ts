import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alert, checkSourceHealth, crashAlert, sendPendingAlerts } from "../src/alerts.js";
import { runDespublicar } from "../src/commands/despublicar.js";
import { buildResumo, formatResumo } from "../src/commands/resumo.js";
import { loadConfig, type Config, type Source } from "../src/config.js";
import { openDb, type Db } from "../src/db.js";
import type { ArticlePatch } from "../src/tralked.js";

const local = (wall: string) => new Date(`${wall}:00-03:00`);
const HOUR = 60 * 60 * 1000;

const baseEnv = { ANTHROPIC_API_KEY: "test", TRALKED_API_KEY: "test" };
const withEmail = (dir: string): Config =>
  loadConfig({ ...baseEnv, DATA_DIR: dir, RESEND_API_KEY: "re_test", ALERT_EMAIL: "dono@example.com" });

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "robo-alerts-"));
  db = openDb(dir);
});

describe("alert", () => {
  it("inserts a row and appends a line to data/logs/YYYY-MM-DD.log (local day)", () => {
    alert(db, "orcamento", "Teto de gasto atingido", local("2026-10-31T23:30"));
    alert(db, "pausado", "Arquivo PAUSADO presente", local("2026-11-01T00:30"));

    expect(db.alerts().map((a) => [a.kind, a.message, a.emailed])).toEqual([
      ["orcamento", "Teto de gasto atingido", 0],
      ["pausado", "Arquivo PAUSADO presente", 0],
    ]);
    const first = readFileSync(join(dir, "logs", "2026-10-31.log"), "utf8");
    expect(first).toContain("orcamento");
    expect(first).toContain("Teto de gasto atingido");
    expect(readFileSync(join(dir, "logs", "2026-11-01.log"), "utf8")).toContain("Arquivo PAUSADO presente");
  });

  it("writes no log file for an in-memory database", () => {
    const mem = openDb(":memory:");
    alert(mem, "api", "falha");
    expect(mem.alerts()).toHaveLength(1);
    expect(existsSync(join(dir, "logs"))).toBe(false);
  });
});

describe("sendPendingAlerts", () => {
  it("e-mails all unsent alerts in one request, once", async () => {
    const config = withEmail(dir);
    alert(db, "orcamento", "Teto de gasto atingido", local("2026-10-31T10:00"));
    alert(db, "checagem", "História 3 reprovada", local("2026-10-31T10:05"));
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"id":"x"}', { status: 200 }));

    await sendPendingAlerts(db, config, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init?.body as string) as { from: string; to: string[]; subject: string; text: string };
    expect(body.from).toBe("no-reply@tralked.com");
    expect(body.to).toEqual(["dono@example.com"]);
    expect(body.subject).toMatch(/2 alertas/);
    expect(body.text).toContain("Teto de gasto atingido");
    expect(body.text).toContain("História 3 reprovada");
    expect(db.alerts().every((a) => a.emailed === 1)).toBe(true);

    await sendPendingAlerts(db, config, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    alert(db, "api", "Falha na API", local("2026-10-31T11:00"));
    await sendPendingAlerts(db, config, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchFn.mock.calls[1]![1]?.body as string) as { text: string; subject: string };
    expect(second.text).toContain("Falha na API");
    expect(second.text).not.toContain("Teto de gasto");
    expect(second.subject).toMatch(/1 alerta\b/);
  });

  it("does not fetch without RESEND_API_KEY or ALERT_EMAIL, and leaves the alerts pending", async () => {
    alert(db, "api", "Falha na API");
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));

    await sendPendingAlerts(db, loadConfig({ ...baseEnv, DATA_DIR: dir }), fetchFn);
    await sendPendingAlerts(db, loadConfig({ ...baseEnv, DATA_DIR: dir, RESEND_API_KEY: "re_test" }), fetchFn);
    await sendPendingAlerts(db, loadConfig({ ...baseEnv, DATA_DIR: dir, ALERT_EMAIL: "a@b.com" }), fetchFn);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(db.alerts()[0]!.emailed).toBe(0);
  });

  it("keeps the alerts pending when Resend answers an error or the request throws, and never throws", async () => {
    const config = withEmail(dir);
    alert(db, "api", "Falha na API");

    await sendPendingAlerts(db, config, async () => new Response('{"message":"bad"}', { status: 422 }));
    expect(db.alerts()[0]!.emailed).toBe(0);

    await sendPendingAlerts(db, config, async () => {
      throw new Error("offline");
    });
    expect(db.alerts()[0]!.emailed).toBe(0);

    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendPendingAlerts(db, config, ok);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(db.alerts()[0]!.emailed).toBe(1);
  });
});

describe("checkSourceHealth", () => {
  const source = (id: string, active = true): Source => ({
    id,
    name: id.toUpperCase(),
    kind: "rss",
    url: `https://feeds.test/${id}.xml`,
    tier: "portal",
    category: "GAMES",
    gamingFilter: false,
    active,
  });

  it("alerts when a source has had no success for more than 24 h, once a day per source", () => {
    const sources = [source("ign"), source("kotaku"), source("off", false)];
    const t0 = local("2026-10-31T10:00");
    db.markSourceOk("ign", t0);
    db.markSourceOk("kotaku", t0);
    db.markSourceError("ign", "HTTP 500", new Date(t0.getTime() + HOUR));

    // 23 h later: still within 24 h.
    const t1 = new Date(t0.getTime() + 23 * HOUR);
    db.markSourceOk("kotaku", t1);
    expect(checkSourceHealth(db, sources, t1)).toBe(0);

    // 25 h later: ign has been silent for 25 h; kotaku was fine 2 h ago.
    const t2 = new Date(t0.getTime() + 25 * HOUR);
    db.markSourceOk("kotaku", t2);
    expect(checkSourceHealth(db, sources, t2)).toBe(1);
    // Same local day, later run: no second alert for ign.
    const t3 = new Date(t2.getTime() + 30 * 60 * 1000);
    expect(checkSourceHealth(db, sources, t3)).toBe(0);
    const fonte = db.alerts().filter((a) => a.kind === "fonte");
    expect(fonte).toHaveLength(1);
    expect(fonte[0]!.message).toContain("IGN");
    expect(fonte[0]!.message).toContain("HTTP 500");

    // Next local day: alerts again.
    const t4 = new Date(t0.getTime() + 49 * HOUR);
    db.markSourceOk("kotaku", t4);
    expect(checkSourceHealth(db, sources, t4)).toBe(1);
    expect(db.alerts().filter((a) => a.kind === "fonte")).toHaveLength(2);
  });

  it("counts a never-successful source from the first time it was seen", () => {
    const sources = [source("new")];
    const t0 = local("2026-10-31T10:00");
    db.markSourceError("new", "HTTP 404", t0);
    expect(checkSourceHealth(db, sources, t0)).toBe(0);
    expect(checkSourceHealth(db, sources, new Date(t0.getTime() + 25 * HOUR))).toBe(1);
  });
});

describe("despublicar", () => {
  type Seeded = { storyId: number; siteId: string };

  function seed(sourceId: string, siteId: string, publishedAt: Date, status: "published" | "ready" = "published"): Seeded {
    const itemUrl = `https://news.test/${siteId}`;
    db.insertItemIfNew({ url: itemUrl, sourceId, title: siteId }, publishedAt);
    const item = db.raw.prepare("SELECT id FROM items WHERE url = ?").get(itemUrl) as { id: number };
    const storyId = db.upsertStory(
      { key: `k-${siteId}`, headline: siteId, category: "GAMES", score: 50, bomb: false, rumor: false, gamesJson: "[]", mode: "live", status: "published" },
      publishedAt,
    );
    db.attachItem(storyId, item.id);
    db.saveArticle({ storyId, payloadJson: "{}", status, siteId, publishedAt: publishedAt.toISOString() }, publishedAt);
    return { storyId, siteId };
  }

  function setup() {
    const a = seed("ign", "site-aug-ign", local("2026-08-10T12:00"));
    const b = seed("kotaku", "site-aug-kotaku", local("2026-08-20T12:00"));
    const c = seed("ign", "site-sep-ign", local("2026-09-02T12:00"));
    const d = seed("ign", "site-aug-ready", local("2026-08-15T12:00"), "ready");
    const patches: { id: string; patch: ArticlePatch; key: string }[] = [];
    const tralked = {
      patchArticle: vi.fn(async (id: string, patch: ArticlePatch, key: string) => {
        patches.push({ id, patch, key });
      }),
    };
    const lines: string[] = [];
    return { a, b, c, d, patches, tralked, lines, log: (l: string) => lines.push(l) };
  }

  it("without --confirmar only lists and makes no PATCH", async () => {
    const s = setup();
    const result = await runDespublicar(
      { db, tralked: s.tralked, log: s.log },
      { de: "2026-08-01", ate: "2026-08-31", confirmar: false },
    );
    expect(s.tralked.patchArticle).not.toHaveBeenCalled();
    expect(result).toMatchObject({ matched: 2, archived: 0, failed: 0 });
    expect(s.lines.join("\n")).toContain("site-aug-ign");
    expect(s.lines.join("\n")).toContain("site-aug-kotaku");
    expect(s.lines.join("\n")).not.toContain("site-sep-ign");
    expect(s.lines.join("\n")).toMatch(/--confirmar/);
    expect(db.articleForStory(s.a.storyId)!.status).toBe("published");
  });

  it("with --confirmar archives each matching published article and marks it archived locally", async () => {
    const s = setup();
    const result = await runDespublicar(
      { db, tralked: s.tralked, log: s.log },
      { de: "2026-08-01", ate: "2026-08-31", fonte: "ign", confirmar: true },
    );
    expect(result).toMatchObject({ matched: 1, archived: 1, failed: 0 });
    expect(s.patches).toHaveLength(1);
    expect(s.patches[0]!.id).toBe("site-aug-ign");
    expect(s.patches[0]!.patch).toEqual({ status: "archived" });
    expect(db.articleForStory(s.a.storyId)!.status).toBe("archived");
    expect(db.articleForStory(s.b.storyId)!.status).toBe("published");
    expect(db.articleForStory(s.c.storyId)!.status).toBe("published");
    expect(db.articleForStory(s.d.storyId)!.status).toBe("ready");
  });

  it("keeps an article published locally when its PATCH fails, and carries on", async () => {
    const s = setup();
    s.tralked.patchArticle.mockRejectedValueOnce(new Error("HTTP 500"));
    const result = await runDespublicar(
      { db, tralked: s.tralked, log: s.log },
      { de: "2026-08-01", ate: "2026-08-31", confirmar: true },
    );
    expect(result).toMatchObject({ matched: 2, archived: 1, failed: 1 });
    const statuses = [s.a, s.b].map((x) => db.articleForStory(x.storyId)!.status).sort();
    expect(statuses).toEqual(["archived", "published"]);
  });
});

describe("resumo", () => {
  const sources: Source[] = ["ign", "kotaku"].map((id) => ({
    id,
    name: id.toUpperCase(),
    kind: "rss" as const,
    url: `https://feeds.test/${id}.xml`,
    tier: "portal" as const,
    category: "GAMES" as const,
    gamingFilter: false,
    active: true,
  }));

  it("counts the local day: collected, dropped, queued, published, updated, check failures, spend and broken sources", () => {
    const day = "2026-10-30";
    const inDay = local("2026-10-30T14:00");
    const outside = local("2026-10-31T14:00");

    db.insertItemIfNew({ url: "https://n.test/1", sourceId: "ign", title: "um" }, inDay);
    db.insertItemIfNew({ url: "https://n.test/2", sourceId: "ign", title: "dois" }, inDay);
    db.insertItemIfNew({ url: "https://n.test/3", sourceId: "ign", title: "tres" }, outside);
    db.setItemStatus(2, "dropped");

    const story = db.upsertStory(
      { key: "k1", headline: "H1", category: "GAMES", score: 50, bomb: false, rumor: false, gamesJson: "[]", mode: "live", status: "published" },
      inDay,
    );
    db.saveArticle({ storyId: story, payloadJson: "{}", status: "published", siteId: "s1", publishedAt: inDay.toISOString() }, inDay);
    db.recordUpdate(story, inDay);
    db.upsertStory(
      { key: "k2", headline: "H2", category: "GAMES", score: 50, bomb: false, rumor: false, gamesJson: "[]", mode: "live", status: "queued" },
      inDay,
    );

    alert(db, "checagem", "reprovada", inDay);
    alert(db, "checagem", "reprovada de novo", outside);
    db.recordSpend("live", "writer", "claude-opus-5-5", 1.25, inDay);
    db.recordSpend("live", "triage", "claude-haiku-5-5", 0.25, inDay);
    db.recordSpend("backfill", "writer", "claude-opus-5-5", 3, inDay);
    db.recordSpend("live", "writer", "claude-opus-5-5", 9, outside);

    db.markSourceOk("ign", local("2026-10-31T10:00"));
    db.markSourceOk("kotaku", local("2026-10-28T10:00"));
    db.markSourceError("kotaku", "HTTP 503", local("2026-10-31T09:00"));

    const r = buildResumo(db, sources, day, local("2026-10-31T00:10"));
    expect(r).toMatchObject({
      day,
      collected: 2,
      dropped: 1,
      queued: 1,
      published: 1,
      updated: 1,
      checkFailures: 1,
      spend: { live: 1.5, backfill: 3 },
    });
    expect(r.brokenSources.map((b) => b.id)).toEqual(["kotaku"]);

    const text = formatResumo(r);
    expect(text).toContain("2026-10-30");
    expect(text).toContain("KOTAKU");
    expect(text).toContain("HTTP 503");
    expect(text).toMatch(/US\$ ?1[.,]50/);
  });
});

describe("crashAlert", () => {
  it("raises one erro alert a day per command when a run crashes, without the stack", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-11-06T15:00:00Z");
    crashAlert(db, "coleta", new Error("claude -p: tempo esgotado"), now);
    crashAlert(db, "coleta", new Error("claude -p: tempo esgotado"), new Date(now.getTime() + 30 * 60_000));
    crashAlert(db, "publica", "boom", now);
    const errors = db.alerts().filter((a) => a.kind === "erro");
    expect(errors.map((a) => a.message)).toEqual([
      "coleta parou com erro: claude -p: tempo esgotado",
      "publica parou com erro: boom",
    ]);
  });
});
