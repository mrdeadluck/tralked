import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAi, type Ai, type StructuredOpts } from "../src/ai/client.js";
import { loadStyle, writePrompt, type Draft } from "../src/ai/writer.js";
import {
  BACKFILL_PAUTAS,
  backfillWindow,
  dayQuotas,
  estimateRequestUsd,
  runRetroativo,
  storyFromJson,
  type BackfillDeps,
  type BatchApi,
} from "../src/backfill.js";
import type { FamousGame } from "../src/pautas.js";
import { formatRetroativo } from "../src/commands/retroativo.js";
import { runColeta } from "../src/pipeline.js";
import { localDay, localHour } from "../src/clock.js";
import { loadConfig, type Source } from "../src/config.js";
import { openDb, type Db, type StoryRow } from "../src/db.js";
import { articleKey, slugify, TralkedError, type ArticlePayload, type FeedArticle, type Tralked } from "../src/tralked.js";

// America/Sao_Paulo is UTC-3 all year (no DST since 2019).
const local = (wall: string) => new Date(`${wall}:00-03:00`);
const NOW = local("2026-10-31T10:00");

type BatchRequest = Anthropic.Messages.Batches.BatchCreateParams.Request;
type BatchResponse = Anthropic.Messages.Batches.MessageBatchIndividualResponse;

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

const src = (id: string, name: string, tier: Source["tier"], over: Partial<Source> = {}): Source => ({
  id,
  name,
  kind: "rss",
  url: `https://feeds.test/${id}.xml`,
  tier,
  category: "GAMES",
  gamingFilter: false,
  active: true,
  ...over,
});

const SOURCES: Source[] = [
  src("ign", "IGN", "portal", { backfill: { kind: "sitemap", url: "https://ign.test/sitemap-index.xml" } }),
  src("kotaku", "Kotaku", "portal"),
  src("blog", "Blog Qualquer", "outro"),
];

// ---------------------------------------------------------------------------------------------
// Fake AI (live calls) and fake Batches API
// ---------------------------------------------------------------------------------------------

type Fact = { headline: string; importance: number; keep?: boolean };

const draftFor = (title: string): Draft => ({
  title,
  subtitle: "Linha fina.",
  excerpt: "Resumo.",
  pontos: ["Um.", "Dois.", "Três."],
  corpo: [{ p: "Texto da matéria." }],
  noTralked: null,
  pergunta: "O que você acha?",
  category: "GAMES",
  platforms: ["PC"],
  games: [],
  imageLabel: "capa",
  rumor: false,
});

function fakeStructured(facts: Map<string, Fact>) {
  const calls: StructuredOpts<unknown>[] = [];
  const state = { checks: [] as boolean[] };
  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    if (opts.purpose === "triage") {
      const items = JSON.parse(opts.user.slice(opts.user.indexOf("\n") + 1)) as { id: number; title: string }[];
      return opts.schema.parse({
        items: items.flatMap((it) => {
          const f = facts.get(it.title);
          if (!f) return [];
          return [
            {
              id: it.id,
              keep: f.keep ?? true,
              category: "GAMES",
              games: ["Hades II"],
              companies: [],
              rumor: false,
              importance: f.importance,
              headlinePt: f.headline,
              topic: "atualizacao",
              platforms: ["multi"],
              recurring: null,
            },
          ];
        }),
      });
    }
    if (opts.purpose === "cluster") {
      const [openPart, itemsPart] = opts.user.split("\n\nNew items:\n");
      const open = JSON.parse(openPart!.replace("Open stories:\n", "")) as { key: string; headline: string }[];
      const items = JSON.parse(itemsPart!) as { id: number; headlinePt: string }[];
      const groups = new Map<string, { storyKey: string | null; headline: string | null; itemIds: number[] }>();
      for (const it of items) {
        const match = open.find((o) => o.headline === it.headlinePt);
        const k = match ? `open:${match.key}` : `new:${it.headlinePt}`;
        const g = groups.get(k) ?? { storyKey: match?.key ?? null, headline: match ? null : it.headlinePt, itemIds: [] };
        g.itemIds.push(it.id);
        groups.set(k, g);
      }
      return opts.schema.parse({ groups: [...groups.values()] });
    }
    if (opts.purpose === "write" || opts.purpose === "write-retry") return opts.schema.parse(draftFor("Reescrita"));
    if (opts.purpose === "check") {
      const ok = state.checks.length > 0 ? state.checks.shift()! : true;
      return opts.schema.parse(ok ? { ok: true, problems: [] } : { ok: false, problems: ["Data errada."] });
    }
    throw new Error(`unexpected purpose ${opts.purpose}`);
  });
  return { structured, calls, state };
}

const succeeded = (customId: string, draft: Draft | string): BatchResponse =>
  ({
    custom_id: customId,
    result: {
      type: "succeeded",
      message: {
        id: `msg-${customId}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: typeof draft === "string" ? draft : JSON.stringify(draft) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10_000, output_tokens: 3_000 },
      },
    },
  }) as unknown as BatchResponse;

const errored = (customId: string): BatchResponse =>
  ({ custom_id: customId, result: { type: "errored", error: { type: "error", error: { type: "api_error", message: "boom" } } } }) as unknown as BatchResponse;

const expiredResult = (customId: string): BatchResponse => ({ custom_id: customId, result: { type: "expired" } }) as BatchResponse;

type ListedBatch = {
  id: string;
  created_at: string;
  processing_status: string;
  request_counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number };
};

function fakeBatches(clock: { now: Date }) {
  const state = {
    submitted: [] as BatchRequest[][],
    createdAt: [] as Date[],
    /** `retrieve` answers `in_progress` this many times before `ended`. */
    pollsBeforeEnd: 0,
    retrieveError: null as Error | null,
    /** "after": the API creates the batch, then the robot dies before reading the id. "before": it never reaches the API. */
    createCrash: null as "before" | "after" | null,
    /** Batches of other jobs on the same account, listed with ours. */
    foreign: [] as ListedBatch[],
    /** Builds the results from the submitted requests (default: every request succeeds, in reverse order). */
    respond: (requests: BatchRequest[]): BatchResponse[] =>
      [...requests].reverse().map((r) => succeeded(r.custom_id, draftFor(`Matéria ${r.custom_id}`))),
  };
  const create = vi.fn(async (params: { requests: BatchRequest[] }) => {
    if (state.createCrash === "before") throw new Error("crash before create");
    state.submitted.push(params.requests);
    state.createdAt.push(clock.now);
    if (state.createCrash === "after") throw new Error("crash after create");
    return { id: `msgbatch_${state.submitted.length}` };
  });
  const retrieve = vi.fn(async (id: string) => {
    if (state.retrieveError) throw state.retrieveError;
    const ended = state.pollsBeforeEnd <= 0;
    state.pollsBeforeEnd--;
    return { id, processing_status: ended ? "ended" : "in_progress" };
  });
  const results = vi.fn(async (id: string) => {
    const n = Number(id.replace("msgbatch_", ""));
    const responses = state.respond(state.submitted[n - 1] ?? []);
    return (async function* () {
      for (const r of responses) yield r;
    })();
  });
  const list = vi.fn((_params?: { limit?: number }) => {
    const ours: ListedBatch[] = state.submitted.map((reqs, i) => ({
      id: `msgbatch_${i + 1}`,
      created_at: state.createdAt[i]!.toISOString(),
      processing_status: "in_progress",
      request_counts: { processing: reqs.length, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    }));
    const all = [...ours, ...state.foreign].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return (async function* () {
      for (const b of all) yield b;
    })();
  });
  const api: BatchApi = { create, retrieve, results, list };
  return { api, state, create, retrieve, results, list };
}

// ---------------------------------------------------------------------------------------------
// Fake site: idempotent by key, like the real API
// ---------------------------------------------------------------------------------------------

function fakeSite() {
  const callsByKey = new Map<string, number>();
  const articlesByKey = new Map<string, { id: string; payload: ArticlePayload }>();
  const order: { key: string; payload: ArticlePayload }[] = [];
  const state = { failOnCall: 0, failWith: null as Error | null, calls: 0, feed: [] as FeedArticle[], feedError: null as Error | null, feedSince: [] as Date[] };
  const tralked: Tralked = {
    findGame: async (name) => ({ slug: slugify(name), name }),
    insights: async () => null,
    dossier: async () => null,
    media: async () => null,
    uploadImage: async () => ({ url: "https://blob.test/x.webp" }),
    recentArticles: async (since) => {
      state.feedSince.push(since);
      if (state.feedError) throw state.feedError;
      return state.feed;
    },
    createArticle: async (payload, key) => {
      state.calls++;
      callsByKey.set(key, (callsByKey.get(key) ?? 0) + 1);
      order.push({ key, payload });
      let article = articlesByKey.get(key);
      if (!article) {
        article = { id: `site-${articlesByKey.size + 1}`, payload };
        articlesByKey.set(key, article);
      }
      // The site created it, then the robot crashed before reading the answer.
      if (state.calls === state.failOnCall) throw state.failWith ?? new Error("crash");
      return { id: article.id, url: `https://tralked.com/noticias/${article.id}`, slug: article.id };
    },
    patchArticle: async () => {},
  };
  return { tralked, callsByKey, articlesByKey, order, state };
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

function harness(start = NOW) {
  const dir = mkdtempSync(join(tmpdir(), "robo-backfill-"));
  const config = loadConfig({ ANTHROPIC_API_KEY: "test", TRALKED_API_KEY: "test", DATA_DIR: dir });
  const db = openDb(dir);
  const clock = { now: start };
  const facts = new Map<string, Fact>();
  const files = new Map<string, string>();
  const real = createAi({ client: {} as Anthropic, db, config, now: () => clock.now });
  const fake = fakeStructured(facts);
  const ai: Ai = { ...real, structured: fake.structured as unknown as Ai["structured"] };
  const batches = fakeBatches(clock);
  const site = fakeSite();
  const sleep = vi.fn(async (_ms: number) => {});
  const fetchFn = vi.fn(async (input: string) => {
    const body = files.get(input);
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  });
  const deps: BackfillDeps = {
    db,
    ai,
    tralked: site.tralked,
    sources: SOURCES,
    config,
    now: () => clock.now,
    fetchFn,
    batches: batches.api,
    sleep,
    rand: () => 0.5,
  };
  return { dir, config, db, clock, facts, files, fake, batches, site, sleep, fetchFn, deps, ai };
}

type H = ReturnType<typeof harness>;

const stories = (db: Db) => db.raw.prepare("SELECT * FROM stories ORDER BY id").all() as unknown as StoryRow[];

let seq = 0;

/** A backfill story of `day` backed by one full-text portal item, in status `status`. */
function seedStory(
  h: H,
  day: string,
  headline: string,
  opts: { score?: number; status?: StoryRow["status"]; text?: string | null; sourceId?: string } = {},
): number {
  const url = `https://news.test/${++seq}/${slugify(headline)}`;
  const at = local(`${day}T12:00`);
  h.db.insertItemIfNew(
    { url, sourceId: opts.sourceId ?? "ign", title: headline, publishedAt: at.toISOString(), text: opts.text === undefined ? `${headline}. Texto completo. ${"Detalhes da matéria. ".repeat(25)}` : opts.text },
    at,
  );
  const item = h.db.raw.prepare("SELECT id FROM items WHERE url = ?").get(url) as { id: number };
  const triage = { id: item.id, keep: true, category: "GAMES", games: ["Hades II"], companies: [], rumor: false, importance: 60, headlinePt: headline };
  h.db.setItemStatus(item.id, "clustered", JSON.stringify(triage));
  const id = h.db.upsertStory(
    {
      key: `seed-${seq}`,
      headline,
      category: "GAMES",
      score: opts.score ?? 70,
      bomb: false,
      rumor: false,
      gamesJson: '["Hades II"]',
      mode: "backfill",
      storyDate: day,
      status: opts.status ?? "open",
      lastItemAt: at.toISOString(),
    },
    at,
  );
  h.db.attachItem(id, item.id);
  return id;
}

/** A backfill story whose checked article is `ready` to publish. */
function seedReady(h: H, day: string, headline: string): number {
  const id = seedStory(h, day, headline, { status: "written" });
  const payload: ArticlePayload = { title: headline, category: "GAMES", blocks: [{ type: "paragraph", text: "Texto." }], status: "published" };
  h.db.saveArticle({ storyId: id, payloadJson: JSON.stringify(payload), status: "ready" }, h.clock.now);
  return id;
}

/** Deterministic pseudo-random generator for the quota fixture. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function ninetyDays(rand: () => number): Map<string, number> {
  const counts = new Map<string, number>();
  const start = Date.UTC(2026, 7, 2);
  for (let i = 0; i < 90; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const r = rand();
    // Some empty days, many quiet ones, a few huge ones.
    counts.set(day, r < 0.08 ? 0 : r < 0.6 ? Math.floor(rand() * 8) + 1 : r < 0.95 ? Math.floor(rand() * 30) + 5 : 200);
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------
// dayQuotas
// ---------------------------------------------------------------------------------------------

describe("dayQuotas", () => {
  it("90 varied days: sum <= 750, at most 15 a day, at least 1 per non-empty day, deterministic", () => {
    for (const seed of [1, 7, 42, 1234]) {
      const counts = ninetyDays(lcg(seed));
      const q = dayQuotas(counts);
      const again = dayQuotas(new Map([...counts].reverse()));
      expect([...q.entries()].sort()).toEqual([...again.entries()].sort());
      expect([...dayQuotas(counts).entries()]).toEqual([...q.entries()]);

      const sum = [...q.values()].reduce((a, b) => a + b, 0);
      expect(sum).toBeLessThanOrEqual(750);
      for (const [day, n] of counts) {
        const quota = q.get(day) ?? 0;
        expect(quota).toBeLessThanOrEqual(15);
        expect(quota).toBeLessThanOrEqual(n);
        if (n > 0) expect(quota).toBeGreaterThanOrEqual(1);
        else expect(quota).toBe(0);
      }
      // Uses the whole allowance when there are enough stories.
      const capacity = [...counts.values()].reduce((a, n) => a + Math.min(n, 15), 0);
      expect(sum).toBe(Math.min(750, capacity));
    }
  });

  it("is proportional: a busier day never gets less than a quieter one", () => {
    const counts = new Map([
      ["2026-10-01", 2],
      ["2026-10-02", 10],
      ["2026-10-03", 40],
      ["2026-10-04", 6],
    ]);
    const q = dayQuotas(counts, 20);
    expect([...q.values()].reduce((a, b) => a + b, 0)).toBe(20);
    expect(q.get("2026-10-03")!).toBeGreaterThanOrEqual(q.get("2026-10-02")!);
    expect(q.get("2026-10-02")!).toBeGreaterThanOrEqual(q.get("2026-10-04")!);
    expect(q.get("2026-10-04")!).toBeGreaterThanOrEqual(q.get("2026-10-01")!);
    expect(q.get("2026-10-01")!).toBeGreaterThanOrEqual(1);
    expect(q.get("2026-10-03")!).toBeLessThanOrEqual(15);
  });

  it("gives every story when the total allows it", () => {
    const q = dayQuotas(new Map([["2026-10-01", 3], ["2026-10-02", 30]]));
    expect(q.get("2026-10-01")).toBe(3);
    expect(q.get("2026-10-02")).toBe(15);
  });
});

// ---------------------------------------------------------------------------------------------
// publicar
// ---------------------------------------------------------------------------------------------

describe("publicar", () => {
  it("running twice after a crash halfway leaves no duplicates", async () => {
    const h = harness();
    const ids = [
      seedReady(h, "2026-08-10", "A"),
      seedReady(h, "2026-08-11", "B"),
      seedReady(h, "2026-08-12", "C"),
      seedReady(h, "2026-08-13", "D"),
    ];
    h.site.state.failOnCall = 3;
    // A different draw every call: a retry must reuse the saved time, not draw a new one.
    let r = 0;
    h.deps.rand = () => (r = (r + 0.37) % 1);

    await expect(runRetroativo(h.deps, "publicar")).rejects.toThrow("crash");
    const second = await runRetroativo(h.deps, "publicar");
    expect(second.stopped).toBeNull();

    // Every key was sent with the story's backfill idempotency key; only the crashed one twice.
    expect([...h.site.callsByKey.keys()].sort()).toEqual(ids.map((id) => articleKey("backfill", id)).sort());
    expect(h.site.callsByKey.get(articleKey("backfill", ids[0]!))).toBe(1);
    expect(h.site.callsByKey.get(articleKey("backfill", ids[1]!))).toBe(1);
    expect(h.site.callsByKey.get(articleKey("backfill", ids[2]!))).toBe(2);
    expect(h.site.callsByKey.get(articleKey("backfill", ids[3]!))).toBe(1);
    expect(h.site.articlesByKey.size).toBe(4);

    // The retried POST carried the same backdated time.
    const retried = h.site.order.filter((o) => o.key === articleKey("backfill", ids[2]!));
    expect(retried[0]!.payload.publishedAt).toBe(retried[1]!.payload.publishedAt);

    const siteIds = ids.map((id) => h.db.articleForStory(id)!.site_id);
    expect(new Set(siteIds).size).toBe(4);
    for (const id of ids) {
      expect(h.db.articleForStory(id)!.status).toBe("published");
      expect(h.db.storyById(id)!.status).toBe("published");
    }

    // A third run has nothing left to send.
    await runRetroativo(h.deps, "publicar");
    expect(h.site.state.calls).toBe(5);
  });

  it("publishes oldest first, backdated to 06:00–23:59 local on the story date, 1 request every 2 s", async () => {
    const h = harness();
    const days = ["2026-09-15", "2026-08-03", "2026-10-20", "2026-08-03", "2026-10-30"];
    days.forEach((d, i) => seedReady(h, d, `Matéria ${i}`));
    const rands = [0, 0.99999, 0.5, 0.25, 0.75];
    let i = 0;
    h.deps.rand = () => rands[i++ % rands.length]!;

    const result = await runRetroativo(h.deps, "publicar");
    expect(result.stopped).toBeNull();
    expect(h.site.order).toHaveLength(5);

    const sent = h.site.order.map((o) => o.payload.publishedAt!);
    const storyDays = h.site.order.map((o) => h.db.storyById(Number(o.key.split("-").pop()))!.story_date!);
    expect(storyDays).toEqual([...storyDays].sort());
    sent.forEach((iso, k) => {
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/);
      const at = new Date(iso);
      expect(localDay(at)).toBe(storyDays[k]);
      expect(localHour(at)).toBeGreaterThanOrEqual(6);
      expect(at.getTime()).toBeLessThan(h.clock.now.getTime());
      expect(h.clock.now.getTime() - at.getTime()).toBeLessThanOrEqual(120 * 86_400_000);
    });

    // Paced: a 2 s wait between requests, none before the first.
    expect(h.sleep.mock.calls.map((c) => c[0])).toEqual([2000, 2000, 2000, 2000]);

    // The DB keeps the backdated time, so the day counts are right.
    for (const o of h.site.order) {
      const storyId = Number(o.key.split("-").pop());
      expect(Date.parse(h.db.articleForStory(storyId)!.published_at!)).toBe(Date.parse(o.payload.publishedAt!));
    }
  });

  it("never sends a time in the future for today's stories", async () => {
    const h = harness(local("2026-10-31T09:30"));
    seedReady(h, "2026-10-31", "Hoje");
    h.deps.rand = () => 0.99999;
    await runRetroativo(h.deps, "publicar");
    const at = new Date(h.site.order[0]!.payload.publishedAt!);
    expect(localDay(at)).toBe("2026-10-31");
    expect(at.getTime()).toBeLessThan(h.clock.now.getTime());
    expect(localHour(at)).toBeGreaterThanOrEqual(6);
  });

  it("does not publish a live story or a story already published, and respects PAUSADO", async () => {
    const h = harness();
    const ready = seedReady(h, "2026-08-10", "Pronta");
    const done = seedReady(h, "2026-08-11", "Publicada");
    h.db.saveArticle({ storyId: done, payloadJson: "{}", status: "published", siteId: "site-x", publishedAt: NOW.toISOString() }, NOW);
    h.db.setStoryStatus(done, "published");
    const live = seedReady(h, "2026-08-12", "Ao vivo");
    h.db.raw.prepare("UPDATE stories SET mode = 'live' WHERE id = ?").run(live);

    writeFileSync(join(h.dir, "PAUSADO"), "");
    await runRetroativo(h.deps, "publicar");
    expect(h.site.state.calls).toBe(0);

    const { rmSync } = await import("node:fs");
    rmSync(join(h.dir, "PAUSADO"));
    await runRetroativo(h.deps, "publicar");
    expect([...h.site.callsByKey.keys()]).toEqual([articleKey("backfill", ready)]);
  });

  it("a site validation error fails that article and goes on; an auth error stops the run", async () => {
    const h = harness();
    const a = seedReady(h, "2026-08-10", "A");
    const b = seedReady(h, "2026-08-11", "B");
    h.site.state.failOnCall = 1;
    h.site.state.failWith = new TralkedError(422, "validation", "invalid");
    await runRetroativo(h.deps, "publicar");
    expect(h.db.articleForStory(a)!.status).toBe("failed");
    expect(h.db.articleForStory(b)!.status).toBe("published");
    // One summary alert, raised through alerts.ts (it also writes the day's log file).
    expect(h.db.alerts().map((x) => x.kind)).toEqual(["api"]);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(join(h.dir, "logs")).length).toBe(1);

    const h2 = harness();
    seedReady(h2, "2026-08-10", "A");
    seedReady(h2, "2026-08-11", "B");
    h2.site.state.failOnCall = 1;
    h2.site.state.failWith = new TralkedError(403, "forbidden", "no scope");
    const r = await runRetroativo(h2.deps, "publicar");
    expect(r.stopped).toBe("api");
    expect(h2.site.state.calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// escrever
// ---------------------------------------------------------------------------------------------

describe("escrever", () => {
  it("a budget error stops before submitting the batch", async () => {
    const h = harness();
    const id = seedStory(h, "2026-09-01", "Hades II recebe arma nova");
    h.db.recordSpend("backfill", "triage", "claude-haiku-5-5", 70, NOW);
    const findGame = vi.spyOn(h.site.tralked, "findGame");

    const result = await runRetroativo(h.deps, "escrever");
    expect(result.stopped).toBe("orcamento");
    expect(h.batches.create).not.toHaveBeenCalled();
    // `assertBudget` runs before anything is built (no game lookups, no requests).
    expect(findGame).not.toHaveBeenCalled();
    expect(h.db.storyById(id)!.status).toBe("queued");
    expect(h.db.alerts().filter((a) => a.kind === "orcamento")).toHaveLength(1);

    // Budget raised: the next run submits.
    h.config.BACKFILL_BUDGET_USD = 200;
    await runRetroativo(h.deps, "escrever");
    expect(h.batches.create).toHaveBeenCalledTimes(1);
  });

  it("maps batch results back to stories by custom_id, never by order", async () => {
    const h = harness();
    const a = seedStory(h, "2026-09-01", "Alfa", { score: 90 });
    const b = seedStory(h, "2026-09-02", "Bravo", { score: 80 });
    const c = seedStory(h, "2026-09-03", "Charlie", { score: 70 });
    const d = seedStory(h, "2026-09-04", "Delta", { score: 60 });
    h.batches.state.respond = (requests) => {
      // Shuffled, one errored, one expired, one unparsable, one with an unknown id.
      const byId = new Map(requests.map((r) => [r.custom_id, r]));
      expect(byId.size).toBe(4);
      return [
        succeeded(`story-${c}`, draftFor("Texto de Charlie")),
        errored(`story-${b}`),
        succeeded("story-999999", draftFor("Intrusa")),
        succeeded(`story-${a}`, draftFor("Texto de Alfa")),
        succeeded(`story-${d}`, "{not json"),
      ];
    };

    const result = await runRetroativo(h.deps, "escrever");
    expect(result.stopped).toBeNull();

    const title = (id: number) => (JSON.parse(h.db.articleForStory(id)!.payload_json) as ArticlePayload).title;
    expect(h.db.articleForStory(a)!.status).toBe("ready");
    expect(title(a)).toBe("Texto de Alfa");
    expect(h.db.articleForStory(c)!.status).toBe("ready");
    expect(title(c)).toBe("Texto de Charlie");
    for (const failed of [b, d]) {
      expect(h.db.articleForStory(failed)!.status).toBe("failed");
      expect(h.db.storyById(failed)!.status).toBe("dropped");
    }
    expect(h.db.storyById(a)!.status).toBe("written");
    // No alarm storm: at most one summary alert for the run.
    expect(h.db.alerts().length).toBeLessThanOrEqual(1);

    // Usage recorded at batch prices for the two successes plus the unparsable one (paid anyway).
    const batchSpend = h.db.raw
      .prepare("SELECT COUNT(*) AS n, SUM(usd) AS usd FROM spend WHERE bucket = 'backfill' AND purpose = 'write-batch'")
      .get() as { n: number; usd: number };
    expect(batchSpend.n).toBe(3);
    expect(batchSpend.usd).toBeCloseTo(3 * ((10_000 * 4 + 3_000 * 20) / 1e6) * 0.5, 6);
  });

  it("submits one batch that mirrors the live writer request, with the batch id stored for resuming", async () => {
    const h = harness();
    const a = seedStory(h, "2026-09-01", "Alfa");
    const b = seedStory(h, "2026-09-02", "Bravo");
    h.batches.state.pollsBeforeEnd = 2;

    await runRetroativo(h.deps, "escrever");
    expect(h.batches.create).toHaveBeenCalledTimes(1);
    const requests = h.batches.state.submitted[0]!;
    expect(requests.map((r) => r.custom_id).sort()).toEqual([`story-${a}`, `story-${b}`].sort());
    for (const r of requests) {
      const p = r.params as unknown as Record<string, unknown> & { system: { text: string }[]; messages: { content: string }[]; output_config: { effort: string } };
      expect(p.model).toBe(h.config.MODEL_WRITER);
      expect(p.output_config.effort).toBe("high");
      expect(p.max_tokens as number).toBeLessThanOrEqual(16000);
      expect(p).not.toHaveProperty("fallbacks");
      expect(p).not.toHaveProperty("betas");
      expect(p.system[0]!.text).toBe(loadStyle());
      const id = Number(r.custom_id.replace("story-", ""));
      const story = h.db.storyById(id)!;
      // The same user prompt builder, dated on the story's own day.
      expect(p.messages[0]!.content).toContain("Pauta: " + story.headline);
      expect(p.messages[0]!.content).toMatch(new RegExp(`Hoje é ${story.story_date!.split("-").reverse().join("/")}`));
    }
    // Polled every 60 s until ended.
    expect(h.sleep.mock.calls.map((c) => c[0])).toEqual([60_000, 60_000]);
    expect(h.batches.retrieve).toHaveBeenCalledTimes(3);
  });

  it("a crash while polling resumes polling the stored batch instead of resubmitting", async () => {
    const h = harness();
    const a = seedStory(h, "2026-09-01", "Alfa");
    h.batches.state.retrieveError = new Error("network down");
    await expect(runRetroativo(h.deps, "escrever")).rejects.toThrow("network down");
    expect(h.batches.create).toHaveBeenCalledTimes(1);
    expect(h.db.articleForStory(a)).toBeUndefined();

    h.batches.state.retrieveError = null;
    await runRetroativo(h.deps, "escrever");
    expect(h.batches.create).toHaveBeenCalledTimes(1);
    expect(h.batches.retrieve).toHaveBeenLastCalledWith("msgbatch_1");
    expect(h.db.articleForStory(a)!.status).toBe("ready");

    // Processing again records nothing twice.
    await runRetroativo(h.deps, "escrever");
    const n = (h.db.raw.prepare("SELECT COUNT(*) AS n FROM spend WHERE purpose = 'write-batch'").get() as { n: number }).n;
    expect(n).toBe(1);
    expect(h.batches.create).toHaveBeenCalledTimes(1);
  });

  it("checks live with the fast model and rewrites once through the live writer (bucket backfill)", async () => {
    const h = harness();
    const a = seedStory(h, "2026-09-01", "Alfa");
    const b = seedStory(h, "2026-09-02", "Bravo");
    // a: first check fails, rewrite passes. b: fails twice.
    h.fake.state.checks = [false, true, false, false];
    h.batches.state.respond = (requests) =>
      [`story-${a}`, `story-${b}`].map((cid) => {
        expect(requests.some((r) => r.custom_id === cid)).toBe(true);
        return succeeded(cid, draftFor(`Lote ${cid}`));
      });

    await runRetroativo(h.deps, "escrever");
    const checks = h.fake.calls.filter((c) => c.purpose === "check");
    expect(checks).toHaveLength(4);
    for (const c of checks) {
      expect(c.model).toBe(h.config.MODEL_FAST);
      expect(c.bucket).toBe("backfill");
    }
    const rewrites = h.fake.calls.filter((c) => c.purpose === "write-retry");
    expect(rewrites).toHaveLength(2);
    for (const w of rewrites) {
      expect(w.bucket).toBe("backfill");
      expect(w.model).toBe(h.config.MODEL_WRITER);
      expect(w.effort).toBe("high");
      expect(w.fallbacks).toBe(true); // a live call: server-side fallbacks (only the batch omits them)
      expect(w.user).toContain("Correções obrigatórias");
    }
    expect(h.db.articleForStory(a)!.status).toBe("ready");
    expect((JSON.parse(h.db.articleForStory(a)!.payload_json) as ArticlePayload).title).toBe("Reescrita");
    expect(h.db.articleForStory(b)!.status).toBe("failed");
    expect(h.db.storyById(b)!.status).toBe("dropped");
  });

  it("selects the top stories of each day by quota and fetches texts only for them", async () => {
    const h = harness();
    h.config.BACKFILL_TOTAL = 3;
    // Day 1 has 4 stories, day 2 has 2: quotas 2 + 1.
    const d1 = [90, 80, 70, 60].map((s, i) => seedStory(h, "2026-09-01", `Dia1 ${i}`, { score: s, text: null }));
    const d2 = [50, 85].map((s, i) => seedStory(h, "2026-09-02", `Dia2 ${i}`, { score: s, text: null }));
    for (const id of [...d1, ...d2]) {
      const item = h.db.itemsForStory(id)[0]!;
      h.files.set(item.url, `<!DOCTYPE html><html><head><title>${item.title}</title></head><body><article><h1>${item.title}</h1>${"<p>Parágrafo longo com bastante texto corrido sobre o assunto da notícia, com detalhes e frases completas para o extrator.</p>".repeat(8)}</article></body></html>`);
    }
    // The best story of day 1 has no reachable page: the next one takes its place.
    h.files.delete(h.db.itemsForStory(d1[0]!)[0]!.url);

    await runRetroativo(h.deps, "escrever");
    const submitted = h.batches.state.submitted[0]!.map((r) => Number(r.custom_id.replace("story-", ""))).sort((x, y) => x - y);
    expect(submitted).toEqual([d1[1]!, d1[2]!, d2[1]!].sort((x, y) => x - y));
    expect(h.db.storyById(d1[0]!)!.status).toBe("dropped");
    expect(h.db.storyById(d1[3]!)!.status).toBe("dropped");
    expect(h.db.storyById(d2[0]!)!.status).toBe("dropped");
    const fetched = h.fetchFn.mock.calls.map((c) => c[0]);
    expect(fetched).not.toContain(h.db.itemsForStory(d1[3]!)[0]!.url);
    expect(fetched).not.toContain(h.db.itemsForStory(d2[0]!)[0]!.url);
  });

  it("drops stories the site already covered before the quotas, so the quota goes to the next story", async () => {
    const h = harness();
    // 2 slots for 2 days: without the coverage drop, day 1 (2 stories) would get 1 slot and give it to the covered one.
    h.config.BACKFILL_TOTAL = 2;
    const covered = seedStory(h, "2026-09-01", "Hades II recebe arma nova", { score: 95 });
    const next = seedStory(h, "2026-09-01", "Hades II ganha modo foto", { score: 80 });
    // Another fact about the same game, and the same title about another game: neither counts as coverage.
    const otherFact = seedStory(h, "2026-09-02", "Hades II chega ao Switch", { score: 70 });
    h.site.state.feed = [
      { id: "ed-1", slug: "arma", title: "Hades II recebe arma nova", category: "GAMES", publishedAt: local("2026-09-01T15:00").toISOString(), source: "editorial", games: ["hades-ii"] },
      { id: "ed-2", slug: "switch", title: "Hades II chega ao Switch", category: "GAMES", publishedAt: local("2026-09-02T15:00").toISOString(), source: "editorial", games: ["outro-jogo"] },
    ];

    const result = await runRetroativo(h.deps, "escrever");
    expect(result.covered).toBe(1);
    expect(h.db.storyById(covered)!.status).toBe("dropped");
    expect(h.db.storyById(next)!.status).toBe("written");
    expect(h.db.storyById(otherFact)!.status).toBe("written");
    // The feed reaches back to the start of the backfill window, read once.
    expect(h.site.state.feedSince).toEqual([backfillWindow(NOW, h.config.BACKFILL_DAYS).from]);
    // Coverage clustering is backfill spend on the fast model.
    const coverage = h.fake.calls.filter((c) => c.purpose === "cluster");
    expect(coverage.length).toBeGreaterThan(0);
    for (const c of coverage) {
      expect(c.bucket).toBe("backfill");
      expect(c.model).toBe(h.config.MODEL_FAST);
    }
    // Quotas were computed after the drop: day 1 keeps its 1 slot for the next story.
    expect(JSON.parse(h.db.getMeta("retroativo.cotas")!)).toEqual({ "2026-09-01": 1, "2026-09-02": 1 });
  });

  it("checks coverage in slices of 40 publishable candidates, each against the same feed only", async () => {
    const h = harness();
    // Room for every story (at most 4 a day), so only coverage drops anything.
    h.config.BACKFILL_TOTAL = 1000;
    h.config.BACKFILL_BUDGET_USD = 1000;
    const ids = Array.from({ length: 100 }, (_, i) =>
      seedStory(h, `2026-09-${String((i % 28) + 1).padStart(2, "0")}`, `Pauta ${i}`, { score: 50 + (i % 40) }),
    );
    // A single "outro" source is never publishable: it is not even sent to the coverage check.
    const unpublishable = seedStory(h, "2026-09-01", "Pauta de blog", { sourceId: "blog" });
    const coveredIdx = [3, 41, 50, 77, 99];
    const article = (n: number, title: string, games: string[]): FeedArticle => ({
      id: `ed-${n}`, slug: `ed-${n}`, title, category: "GAMES", publishedAt: local("2026-09-10T12:00").toISOString(), source: "editorial", games,
    });
    h.site.state.feed = [
      ...coveredIdx.map((i) => article(i, `Pauta ${i}`, ["hades-ii"])),
      article(1000, "Pauta 10", ["outro-jogo"]), // same title, another game: not coverage
      ...Array.from({ length: 20 }, (_, n) => article(2000 + n, `Outra matéria ${n}`, ["hades-ii"])),
    ];

    const result = await runRetroativo(h.deps, "escrever");
    expect(result.covered).toBe(5);
    for (const [i, id] of ids.entries()) {
      expect([i, h.db.storyById(id)!.status]).toEqual([i, coveredIdx.includes(i) ? "dropped" : "written"]);
    }

    const coverageCalls = h.fake.calls.filter((c) => c.purpose === "cluster");
    expect(coverageCalls).toHaveLength(3); // 40 + 40 + 20
    const seen: number[] = [];
    for (const c of coverageCalls) {
      const [openPart, itemsPart] = c.user.split("\n\nNew items:\n");
      const open = JSON.parse(openPart!.replace("Open stories:\n", "")) as { key: string }[];
      const items = JSON.parse(itemsPart!) as { id: number }[];
      expect(items.length).toBeLessThanOrEqual(40);
      // The feed and nothing else: no story opened by an earlier slice.
      expect(open.map((o) => o.key).sort()).toEqual(h.site.state.feed.map((a) => `feed-${a.id}`).sort());
      seen.push(...items.map((it) => it.id));
    }
    expect(seen.sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
    expect(seen).not.toContain(unpublishable);
    // A full-size feed was not returned: no limit alert.
    expect(h.db.alerts().filter((a) => a.message.includes("limitada"))).toHaveLength(0);
  });

  it("logs and raises one api alert when the site feed comes back at its 200-article limit", async () => {
    const h = harness();
    const log = vi.fn();
    h.deps.log = log;
    seedStory(h, "2026-09-01", "Alfa");
    h.site.state.feed = Array.from({ length: 200 }, (_, n) => ({
      id: `ed-${n}`, slug: `ed-${n}`, title: `Matéria ${n}`, category: "GAMES", publishedAt: local("2026-10-01T12:00").toISOString(), source: "editorial" as const, games: [],
    }));
    await runRetroativo(h.deps, "escrever");
    const limited = h.db.alerts().filter((a) => a.kind === "api" && a.message.includes("cobertura do site limitada a 200 matérias"));
    expect(limited).toHaveLength(1);
    expect(log.mock.calls.some((c) => String(c[0]).includes("200 matérias"))).toBe(true);
  });

  it("stops without choosing anything when the site feed cannot be read", async () => {
    const h = harness();
    const id = seedStory(h, "2026-09-01", "Alfa");
    h.site.state.feedError = new TralkedError(503, "unavailable", "down");
    const result = await runRetroativo(h.deps, "escrever");
    expect(result.stopped).toBe("api");
    expect(h.db.storyById(id)!.status).toBe("open");
    expect(h.batches.create).not.toHaveBeenCalled();
    expect(h.db.getMeta("retroativo.cotas")).toBeUndefined();
    expect(h.db.alerts().map((a) => a.kind)).toEqual(["api"]);
  });

  it("trims the lowest-scored stories until the estimated batch cost fits the budget", async () => {
    // Measure the estimate of each request with plenty of budget.
    const scores = [90, 80, 70];
    const h = harness();
    const ids = scores.map((s, i) => seedStory(h, "2026-09-01", `Pauta ${i}`, { score: s }));
    h.config.BACKFILL_BUDGET_USD = 1000;
    await runRetroativo(h.deps, "escrever");
    const requests = h.batches.state.submitted[0]!;
    const cost = new Map(requests.map((r) => [Number(r.custom_id.replace("story-", "")), estimateRequestUsd(r, h.config.MODEL_WRITER)]));
    // Upper bound: chars/4 input + max_tokens/2 output at batch prices.
    const r0 = requests[0]!;
    const chars = (r0.params.system as { text: string }[])[0]!.text.length + (r0.params.messages[0]!.content as string).length;
    expect(estimateRequestUsd(r0, "claude-opus-5-5")).toBeCloseTo(((Math.ceil(chars / 4) * 4 + 8000 * 20) / 1e6) * 0.5, 9);

    // Fresh run: spent so far leaves room for the two best stories only.
    const t = harness();
    const tIds = scores.map((s, i) => seedStory(t, "2026-09-01", `Pauta ${i}`, { score: s }));
    const twoBest = cost.get(ids[0]!)! + cost.get(ids[1]!)!;
    t.db.recordSpend("backfill", "triage", "claude-haiku-5-5", 10, NOW);
    t.config.BACKFILL_BUDGET_USD = 10 + twoBest + cost.get(ids[2]!)! / 2;
    const result = await runRetroativo(t.deps, "escrever");
    expect(result.trimmed).toBe(1);
    expect(t.batches.state.submitted[0]!.map((r) => r.custom_id).sort()).toEqual([`story-${tIds[0]}`, `story-${tIds[1]}`].sort());
    expect(t.db.storyById(tIds[2]!)!.status).toBe("queued"); // left for a later run

    // Nothing fits: one orcamento alert, no batch.
    const n = harness();
    seedStory(n, "2026-09-01", "Pauta 0", { score: 90 });
    n.db.recordSpend("backfill", "triage", "claude-haiku-5-5", 69.99, NOW);
    const stopped = await runRetroativo(n.deps, "escrever");
    expect(stopped.stopped).toBe("orcamento");
    expect(n.batches.create).not.toHaveBeenCalled();
    expect(n.db.alerts().filter((a) => a.kind === "orcamento")).toHaveLength(1);
    await runRetroativo(n.deps, "escrever");
    expect(n.db.alerts().filter((a) => a.kind === "orcamento")).toHaveLength(1);
  });

  it("a crash after the API created the batch is reconciled through batches.list, never paid twice", async () => {
    const h = harness();
    const a = seedStory(h, "2026-09-01", "Alfa");
    const b = seedStory(h, "2026-09-02", "Bravo");
    // Another job's batch with the same size, created earlier, must not be taken.
    h.batches.state.foreign.push({
      id: "msgbatch_other",
      created_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      processing_status: "in_progress",
      request_counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    });
    h.batches.state.createCrash = "after";
    await expect(runRetroativo(h.deps, "escrever")).rejects.toThrow("crash after create");
    expect(h.db.getMeta("retroativo.enviando")).toContain("pendente-");

    h.batches.state.createCrash = null;
    await runRetroativo(h.deps, "escrever");
    expect(h.batches.create).toHaveBeenCalledTimes(1);
    expect(h.batches.list).toHaveBeenCalledTimes(1);
    expect(h.batches.retrieve).toHaveBeenLastCalledWith("msgbatch_1");
    expect(h.db.articleForStory(a)!.status).toBe("ready");
    expect(h.db.articleForStory(b)!.status).toBe("ready");
    expect(h.db.getMeta("retroativo.enviando")).toBe("");
  });

  it("a crash before the batch reached the API resubmits once the list shows nothing", async () => {
    const h = harness();
    const a = seedStory(h, "2026-09-01", "Alfa");
    h.batches.state.createCrash = "before";
    await expect(runRetroativo(h.deps, "escrever")).rejects.toThrow("crash before create");

    h.batches.state.createCrash = null;
    await runRetroativo(h.deps, "escrever");
    expect(h.batches.list).toHaveBeenCalledTimes(1);
    expect(h.batches.create).toHaveBeenCalledTimes(2);
    expect(h.batches.state.submitted).toHaveLength(1);
    expect(h.db.articleForStory(a)!.status).toBe("ready");
  });

  it("logs and raises one api alert for days with stories but no stored quota", async () => {
    const h = harness();
    const log = vi.fn();
    h.deps.log = log;
    h.db.setMeta("retroativo.cotas", JSON.stringify({ "2026-09-01": 1 }));
    const kept = seedStory(h, "2026-09-01", "Alfa");
    const late1 = seedStory(h, "2026-09-05", "Bravo");
    const late2 = seedStory(h, "2026-09-06", "Charlie");
    await runRetroativo(h.deps, "escrever");
    expect(h.db.storyById(kept)!.status).toBe("written");
    expect(h.db.storyById(late1)!.status).toBe("dropped");
    expect(h.db.storyById(late2)!.status).toBe("dropped");
    const alerts = h.db.alerts().filter((a) => a.kind === "api");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toContain("2026-09-05, 2026-09-06");
    expect(log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("nenhuma cota"))).toHaveLength(2);
  });

  it("the stored writing context round-trips dates", () => {
    const story = storyFromJson(
      JSON.stringify({ id: 1, headline: "h", category: "GAMES", rumor: false, candidates: [], sources: [{ name: "IGN", tier: "portal", url: "https://x.test", publishedAt: "2026-09-01T12:00:00.000Z", text: "t" }] }),
    );
    expect(story.sources[0]!.publishedAt).toBeInstanceOf(Date);
    expect(writePrompt(story, NOW)).toContain("2026-09-01");
  });
});

// ---------------------------------------------------------------------------------------------
// descobrir, triar, agrupar
// ---------------------------------------------------------------------------------------------

const sitemapIndex = (children: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${children
    .map((c) => `<sitemap><loc>${c}</loc></sitemap>`)
    .join("")}</sitemapindex>`;

const urlset = (entries: { url: string; title: string; at: Date }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${entries
    .map(
      (e) =>
        `<url><loc>${e.url}</loc><news:news><news:publication_date>${e.at.toISOString()}</news:publication_date><news:title>${e.title}</news:title></news:news></url>`,
    )
    .join("")}</urlset>`;

const rss = (entries: { url: string; title: string; at: Date }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>t</title><link>https://feeds.test/</link>${entries
    .map((e) => `<item><title>${e.title}</title><link>${e.url}</link><pubDate>${e.at.toUTCString()}</pubDate></item>`)
    .join("")}</channel></rss>`;

describe("descobrir, triar and agrupar", () => {
  it("reads sitemaps (recursing into children) and RSS fallbacks inside the window; clusters per local day with yesterday open", async () => {
    const h = harness();
    const fact = (title: string, headline: string, importance = 60) => h.facts.set(title, { headline, importance });

    h.files.set("https://ign.test/sitemap-index.xml", sitemapIndex(["https://ign.test/sitemap-1.xml"]));
    h.files.set(
      "https://ign.test/sitemap-1.xml",
      urlset([
        { url: "https://ign.test/a", title: "Hades 2 patch day one", at: local("2026-09-01T23:30") },
        { url: "https://ign.test/b", title: "Hades 2 patch reactions", at: local("2026-09-02T08:00") },
        { url: "https://ign.test/c", title: "Hades 2 patch week later", at: local("2026-09-05T10:00") },
        { url: "https://ign.test/old", title: "Way too old", at: local("2026-07-01T10:00") },
      ]),
    );
    h.files.set(
      "https://feeds.test/kotaku.xml",
      rss([
        { url: "https://kotaku.test/x", title: "Kotaku on the patch", at: local("2026-09-02T09:00") },
        { url: "https://kotaku.test/old", title: "Kotaku too old", at: local("2026-06-01T09:00") },
      ]),
    );
    h.files.set("https://feeds.test/blog.xml", rss([{ url: "https://blog.test/deal", title: "Cheap deal", at: local("2026-09-03T09:00") }]));
    fact("Hades 2 patch day one", "Hades II recebe patch");
    fact("Hades 2 patch reactions", "Hades II recebe patch");
    fact("Kotaku on the patch", "Hades II recebe patch");
    fact("Hades 2 patch week later", "Hades II recebe patch");
    h.facts.set("Cheap deal", { headline: "Promoção", importance: 10, keep: false });

    // A live story about another fact, already published by the live pipeline.
    const liveId = h.db.upsertStory(
      { key: "live-1", headline: "GTA 6 ganha trailer", category: "GAMES", score: 80, bomb: false, rumor: false, gamesJson: "[]", mode: "live", status: "published", lastItemAt: local("2026-09-02T07:00").toISOString() },
      local("2026-09-02T07:00"),
    );
    h.fetchFn.mockClear();
    h.files.set("https://ign.test/sitemap-1.xml", h.files.get("https://ign.test/sitemap-1.xml")!.replace("</urlset>", `<url><loc>https://ign.test/gta</loc><news:news><news:publication_date>${local("2026-09-02T12:00").toISOString()}</news:publication_date><news:title>GTA trailer coverage</news:title></news:news></url></urlset>`));
    fact("GTA trailer coverage", "GTA 6 ganha trailer");

    const r1 = await runRetroativo(h.deps, "descobrir");
    expect(r1.stopped).toBeNull();
    const urls = (h.db.raw.prepare("SELECT url FROM items ORDER BY id").all() as { url: string }[]).map((x) => x.url);
    expect(urls).toEqual(expect.arrayContaining(["https://ign.test/a", "https://ign.test/b", "https://ign.test/c", "https://kotaku.test/x", "https://blog.test/deal", "https://ign.test/gta"]));
    expect(urls).not.toContain("https://ign.test/old");
    expect(urls).not.toContain("https://kotaku.test/old");
    // IGN has a sitemap: its RSS feed is not read.
    expect(h.fetchFn.mock.calls.map((c) => c[0])).not.toContain("https://feeds.test/ign.xml");

    await runRetroativo(h.deps, "triar");
    const triage = h.fake.calls.filter((c) => c.purpose === "triage");
    expect(triage.length).toBeGreaterThan(0);
    for (const c of triage) {
      expect(c.model).toBe(h.config.MODEL_FAST);
      expect(c.bucket).toBe("backfill");
    }

    await runRetroativo(h.deps, "agrupar");
    const cluster = h.fake.calls.filter((c) => c.purpose === "cluster");
    for (const c of cluster) {
      expect(c.model).toBe(h.config.MODEL_FAST);
      expect(c.bucket).toBe("backfill");
    }
    const backfill = stories(h.db).filter((s) => s.mode === "backfill");
    // Day one's story absorbs the next day's items (yesterday is open); the item three days later is a new story.
    expect(backfill.map((s) => [s.headline, s.story_date])).toEqual([
      ["Hades II recebe patch", "2026-09-01"],
      ["Hades II recebe patch", "2026-09-05"],
    ]);
    expect(h.db.itemsForStory(backfill[0]!.id).map((i) => i.url).sort()).toEqual(["https://ign.test/a", "https://ign.test/b", "https://kotaku.test/x"]);
    expect(backfill.every((s) => s.status === "open")).toBe(true);
    // The item about the live story joined it: the backfill never writes it again.
    expect(h.db.itemsForStory(liveId).map((i) => i.url)).toEqual(["https://ign.test/gta"]);
    expect(h.db.storyById(liveId)!.mode).toBe("live");
    // Scores are computed.
    expect(backfill[0]!.score).toBeGreaterThan(0);

    // Re-running every phase adds nothing.
    await runRetroativo(h.deps, "triar");
    await runRetroativo(h.deps, "agrupar");
    expect(stories(h.db).filter((s) => s.mode === "backfill")).toHaveLength(2);
  });

  it("items the live pipeline already holds are not taken over by the backfill", async () => {
    const h = harness();
    h.db.insertItemIfNew({ url: "https://ign.test/live", sourceId: "ign", title: "Live item", publishedAt: local("2026-10-28T10:00").toISOString() }, NOW);
    h.files.set("https://ign.test/sitemap-index.xml", urlset([{ url: "https://ign.test/live", title: "Live item", at: local("2026-10-28T10:00") }]));
    h.facts.set("Live item", { headline: "Item ao vivo", importance: 60 });
    await runRetroativo(h.deps, "descobrir");
    await runRetroativo(h.deps, "triar");
    expect(h.fake.calls.filter((c) => c.purpose === "triage")).toHaveLength(0);
  });

  it("the window ends where yesterday starts: yesterday's and today's facts stay with the live pipeline", async () => {
    const h = harness(); // 2026-10-31 10:00 local
    h.files.set(
      "https://ign.test/sitemap-index.xml",
      urlset([
        { url: "https://ign.test/before-yesterday", title: "Antes de ontem", at: local("2026-10-29T23:59") },
        { url: "https://ign.test/yesterday", title: "Ontem cedo", at: local("2026-10-30T00:00") },
        { url: "https://ign.test/today", title: "Hoje", at: local("2026-10-31T08:00") },
        { url: "https://ign.test/first-day", title: "Primeiro dia", at: local("2026-08-01T00:00") },
        { url: "https://ign.test/too-old", title: "Velho demais", at: local("2026-07-31T23:59") },
      ]),
    );
    // 90 full local days: 08-01 .. 10-29 (31 + 30 + 29).
    expect(backfillWindow(NOW, 90)).toEqual({ from: local("2026-08-01T00:00"), to: new Date(local("2026-10-30T00:00").getTime() - 1) });
    await runRetroativo(h.deps, "descobrir");
    const urls = (h.db.raw.prepare("SELECT url FROM items ORDER BY url").all() as { url: string }[]).map((x) => x.url);
    expect(urls).toEqual(["https://ign.test/before-yesterday", "https://ign.test/first-day"]);
  });

  it("a live coleta between triar and agrupar never touches the backfill items, and agrupar still clusters them", async () => {
    const h = harness();
    h.files.set(
      "https://ign.test/sitemap-index.xml",
      urlset([
        { url: "https://ign.test/a", title: "Old news A", at: local("2026-10-28T10:00") },
        { url: "https://ign.test/b", title: "Old news B", at: local("2026-10-28T11:00") },
      ]),
    );
    h.files.set("https://ign.test/a", "<html><body><article><p>texto</p></article></body></html>");
    h.files.set("https://ign.test/b", "<html><body><article><p>texto</p></article></body></html>");
    h.facts.set("Old news A", { headline: "Fato antigo", importance: 95 });
    h.facts.set("Old news B", { headline: "Fato antigo", importance: 95 });
    await runRetroativo(h.deps, "descobrir");
    // Right after discovery, the live pipeline sees nothing new.
    expect(h.db.itemsByStatus("new")).toHaveLength(0);
    await runRetroativo(h.deps, "triar");
    expect(h.db.itemsByStatus("bf_triaged").map((i) => i.url)).toEqual(["https://ign.test/a", "https://ign.test/b"]);

    const callsBefore = h.fake.calls.length;
    h.fetchFn.mockClear();
    h.clock.now = local("2026-10-31T10:30");
    const report = await runColeta(h.deps);
    expect(report.triaged + report.clustered + report.newStories + report.textsFetched).toBe(0);
    expect(h.fake.calls.length).toBe(callsBefore); // no live AI call
    expect(h.db.spentTotal("live")).toBe(0);
    const fetched = h.fetchFn.mock.calls.map((c) => c[0]);
    expect(fetched).not.toContain("https://ign.test/a");
    expect(fetched).not.toContain("https://ign.test/b");
    expect(stories(h.db)).toHaveLength(0);
    expect(h.db.itemsByStatus("bf_triaged")).toHaveLength(2);

    await runRetroativo(h.deps, "agrupar");
    const created = stories(h.db);
    expect(created.map((s) => [s.mode, s.story_date, s.status])).toEqual([["backfill", "2026-10-28", "open"]]);
    expect(h.db.itemsForStory(created[0]!.id)).toHaveLength(2);

    // And the next live coleta leaves the backfill story alone too.
    await runColeta(h.deps);
    expect(stories(h.db).map((s) => [s.mode, s.status])).toEqual([["backfill", "open"]]);
  });
});

// ---------------------------------------------------------------------------------------------
// Whole run
// ---------------------------------------------------------------------------------------------

describe("runRetroativo with no phase", () => {
  it("runs every phase until done and publishes backdated articles", async () => {
    const h = harness();
    const page = (t: string) =>
      `<!DOCTYPE html><html><head><title>${t}</title></head><body><article><h1>${t}</h1>${"<p>Parágrafo longo com bastante texto corrido sobre o assunto da notícia, com detalhes e frases completas para o extrator.</p>".repeat(8)}</article></body></html>`;
    h.files.set(
      "https://ign.test/sitemap-index.xml",
      urlset([
        { url: "https://ign.test/a", title: "Story A", at: local("2026-09-01T10:00") },
        { url: "https://ign.test/b", title: "Story B", at: local("2026-09-10T10:00") },
      ]),
    );
    h.files.set("https://ign.test/a", page("Story A"));
    h.files.set("https://ign.test/b", page("Story B"));
    h.facts.set("Story A", { headline: "Fato A", importance: 60 });
    h.facts.set("Story B", { headline: "Fato B", importance: 60 });

    const result = await runRetroativo(h.deps);
    expect(result.stopped).toBeNull();
    expect(h.site.order).toHaveLength(2);
    expect(h.site.order.map((o) => localDay(new Date(o.payload.publishedAt!)))).toEqual(["2026-09-01", "2026-09-10"]);
    expect(stories(h.db).filter((s) => s.mode === "backfill").every((s) => s.status === "published")).toBe(true);

    // Done: a second full run sends nothing and submits no batch.
    await runRetroativo(h.deps);
    expect(h.site.order).toHaveLength(2);
    expect(h.batches.create).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Pautas Tralked in the backfill
// ---------------------------------------------------------------------------------------------

describe("pautas in the backfill", () => {
  type PautaRowLite = { id: number; game_name: string; game_slug: string; format: string; status: string; mode: string; story_date: string; batch_id: string | null };
  const pautaRows = (db: Db) => db.raw.prepare("SELECT * FROM pautas WHERE status != 'skipped' ORDER BY story_date, id").all() as unknown as PautaRowLite[];

  /** `n` famous games, each in the catalog with 12 achievements and a Steam page. */
  function famous(h: H, n: number): FamousGame[] {
    const list = Array.from({ length: n }, (_, i) => ({ name: `Jogo Famoso ${i + 1}`, steamAppId: 1000 + i }));
    const byslug = new Map(list.map((g) => [slugify(g.name), g]));
    h.site.tralked.dossier = async (slug) => {
      const g = byslug.get(slug);
      if (!g) return null;
      return {
        game: { slug, name: g.name, steamAppId: g.steamAppId, summary: null, developer: null, publisher: null, releaseDate: "2020-01-01", platforms: ["PC"], criticScore: null, timeToBeatCompleteMin: 1200, achievementCount: 12 },
        tralked: { players: 5, avgPlaytimeMin: 600, completedPlayers: 1 },
        achievements: Array.from({ length: 12 }, (_, k) => ({ platform: "steam", apiName: `A${k}`, name: `C${k}`, description: `Faça ${k}.`, globalPct: 1 + k })),
      };
    };
    for (const g of list) {
      h.files.set(
        `https://store.steampowered.com/api/appdetails?appids=${g.steamAppId}&l=brazilian`,
        JSON.stringify({ [String(g.steamAppId)]: { success: true, data: { name: g.name, about_the_game: "<p>Um jogo famoso.</p>" } } }),
      );
    }
    h.deps.famousGames = list;
    return list;
  }

  /** Every local day of the backfill window, oldest first. */
  function windowDays(): string[] {
    const { from, to } = backfillWindow(NOW, 90);
    const days: string[] = [];
    for (let t = from.getTime() + 12 * 3600_000; t <= to.getTime(); t += 24 * 3600_000) days.push(localDay(new Date(t)));
    return days;
  }

  it(`plans exactly ${BACKFILL_PAUTAS} pautas, one per day, writes them in the news batch and publishes them backdated, oldest first`, async () => {
    const h = harness();
    famous(h, 150);
    const news = seedStory(h, "2026-09-01", "Notícia do dia");

    const written = await runRetroativo(h.deps, "escrever");
    expect(written.stopped).toBeNull();
    expect(written.pautasPlanned).toBe(BACKFILL_PAUTAS);
    const rows = pautaRows(h.db);
    expect(BACKFILL_PAUTAS).toBe(90);
    expect(rows).toHaveLength(90);
    expect(rows.map((r) => r.story_date)).toEqual(windowDays());
    // No game twice within 60 days.
    const dayMs = 24 * 3600_000;
    for (const a of rows) {
      for (const b of rows) {
        if (a.id === b.id || a.game_name !== b.game_name) continue;
        expect(Math.abs(Date.parse(a.story_date) - Date.parse(b.story_date)) / dayMs).toBeGreaterThanOrEqual(60);
      }
    }
    expect(rows.every((r) => r.mode === "backfill" && r.status === "ready")).toBe(true);

    // ONE batch with the news and the pautas; the pauta requests mirror the batch writer (no fallbacks).
    expect(h.batches.create).toHaveBeenCalledTimes(1);
    const requests = h.batches.state.submitted[0]!;
    expect(requests.map((r) => r.custom_id).sort()).toEqual([`story-${news}`, ...rows.map((r) => `pauta-${r.id}`)].sort());
    const pautaRequest = requests.find((r) => r.custom_id.startsWith("pauta-"))!;
    expect((pautaRequest.params.system as { text: string }[])[0]!.text).toContain("Pautas Tralked");
    expect(pautaRequest.params).not.toHaveProperty("fallbacks");
    expect(pautaRequest.params.max_tokens).toBeLessThanOrEqual(16000);
    // Their usage is recorded at batch prices like the news.
    expect(h.db.raw.prepare("SELECT COUNT(*) AS n FROM spend WHERE purpose = 'write-batch'").get()).toEqual({ n: 91 });

    const published = await runRetroativo(h.deps, "publicar");
    expect(published.pautasPublished).toBe(90);
    expect(published.published).toBe(1);
    const sent = h.site.order;
    expect(sent).toHaveLength(91);
    const days = sent.map((o) => localDay(new Date(o.payload.publishedAt!)));
    expect(days).toEqual([...days].sort()); // oldest first, news and pautas together
    for (const o of sent.filter((s) => s.key.startsWith("robo-pauta-"))) {
      const row = rows.find((r) => o.key === `robo-pauta-backfill-${r.id}`)!;
      expect(localDay(new Date(o.payload.publishedAt!))).toBe(row.story_date);
      expect(localHour(new Date(o.payload.publishedAt!))).toBeGreaterThanOrEqual(6);
      expect(o.payload.games).toEqual([{ slug: row.game_slug }]);
      expect(o.payload.category).toBe(row.format === "vale-o-100" || row.format === "mais-raras" ? "GAMES" : "GUIAS");
    }
    expect(pautaRows(h.db).every((r) => r.status === "published")).toBe(true);
    expect(h.db.publishedCountOn("2026-09-01")).toBe(2);

    // Done: nothing is planned, submitted or sent again.
    await runRetroativo(h.deps);
    expect(h.site.order).toHaveLength(91);
    expect(h.batches.create).toHaveBeenCalledTimes(1);
    expect(pautaRows(h.db)).toHaveLength(90);
  });

  it("never plans a pauta on a day that would go over 15 articles", async () => {
    const h = harness();
    famous(h, 150);
    // 09-01 has 20 publishable stories: the news quota keeps one place for the day's pauta (14 + 1 = 15).
    for (let i = 0; i < 20; i++) seedStory(h, "2026-09-01", `Notícia ${i}`, { score: 50 + i });
    // 09-02 already has 15 articles on the site: no pauta there.
    for (let i = 0; i < 15; i++) {
      const at = local(`2026-09-02T${String(7 + i).padStart(2, "0")}:00`);
      const id = h.db.upsertStory({ key: `full-${i}`, headline: `Cheio ${i}`, category: "GAMES", score: 50, bomb: false, rumor: false, gamesJson: "[]", mode: "live", status: "published", lastItemAt: at.toISOString() }, at);
      h.db.saveArticle({ storyId: id, payloadJson: "{}", status: "published", siteId: `full-${i}`, publishedAt: at.toISOString() }, at);
    }

    await runRetroativo(h.deps, "escrever");
    const rows = pautaRows(h.db);
    expect(rows.map((r) => r.story_date)).not.toContain("2026-09-02");
    expect(rows.filter((r) => r.story_date === "2026-09-01")).toHaveLength(1);
    expect(rows).toHaveLength(89);
    const newsOnFirst = stories(h.db).filter((s) => s.mode === "backfill" && s.story_date === "2026-09-01" && s.status === "written");
    expect(newsOnFirst).toHaveLength(14);

    await runRetroativo(h.deps, "publicar");
    expect(h.db.publishedCountOn("2026-09-01")).toBe(15);
    expect(h.db.publishedCountOn("2026-09-02")).toBe(15);
    for (const day of windowDays()) expect(h.db.publishedCountOn(day)).toBeLessThanOrEqual(15);
  });

  it("pautas are part of the pre-submit cost estimate: what does not fit stays planned for a later batch", async () => {
    // Measure one pauta request with plenty of budget.
    const m = harness();
    famous(m, 150);
    await runRetroativo(m.deps, "escrever");
    const first = m.batches.state.submitted[0]!.find((r) => r.custom_id === `pauta-${pautaRows(m.db)[0]!.id}`)!;
    const one = estimateRequestUsd(first, m.config.MODEL_WRITER);

    const h = harness();
    famous(h, 150);
    h.db.recordSpend("backfill", "triage", "claude-haiku-5-5", 10, NOW);
    h.config.BACKFILL_BUDGET_USD = 10 + one * 1.5;
    const result = await runRetroativo(h.deps, "escrever");
    expect(result.trimmed).toBe(89);
    expect(h.batches.state.submitted[0]!.map((r) => r.custom_id)).toEqual([`pauta-${pautaRows(h.db)[0]!.id}`]);
    const left = pautaRows(h.db).filter((r) => r.status === "bf_planned");
    expect(left).toHaveLength(89);
    expect(left.every((r) => r.batch_id === null)).toBe(true);
  });
});

describe("formatRetroativo", () => {
  it("stamps the report with the injected clock and shows coverage and trimming", async () => {
    const h = harness();
    const report = await runRetroativo(h.deps, "publicar");
    const text = formatRetroativo({ ...report, covered: 3, trimmed: 2, pautasPlanned: 90, pautasReady: 88, pautasPublished: 87 }, h.clock.now);
    expect(text.split("\n")[0]).toBe(`retroativo ${NOW.toISOString()}: fases publicar`);
    expect(text).toContain("3 já cobertas pelo site");
    expect(text).toContain("2 fora pelo teto");
    expect(text).toContain("pautas: 90 planejadas, 88 prontas, 87 publicadas");
  });
});
