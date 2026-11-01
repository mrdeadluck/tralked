import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BudgetExceededError, type Ai, type StructuredOpts } from "../src/ai/client.js";
import type { Draft } from "../src/ai/writer.js";
import { inSlotWindow, localDay } from "../src/clock.js";
import { loadConfig, type Source } from "../src/config.js";
import { openDb, type Db, type StoryRow } from "../src/db.js";
import { runColeta, runPublica, type PipelineDeps } from "../src/pipeline.js";
import { slugify, updateKey, type ArticlePatch, type ArticlePayload, type FeedArticle, type Tralked } from "../src/tralked.js";

// ---------------------------------------------------------------------------------------------
// Clock: America/Sao_Paulo is UTC-3 all year (no DST since 2019).
// ---------------------------------------------------------------------------------------------

/** A São Paulo wall-clock time, e.g. `local("2026-10-31T06:00")`. */
const local = (wall: string) => new Date(`${wall}:00-03:00`);
const HOUR = 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------------
// Sources and feeds
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
  src("pub", "Rockstar Newswire", "oficial"),
  src("ign", "IGN Brasil", "portal"),
  src("kotaku", "Kotaku", "portal"),
  src("blog", "Blog Qualquer", "outro"),
  src("gnews", "Eurogamer (via Google News)", "portal", {
    url: "https://news.google.com/rss/search?q=eurogamer",
    linkResolve: "google-news",
  }),
];

type FeedItem = { title: string; url: string; pub: Date; publisher?: string };

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function rss(items: FeedItem[]): string {
  const body = items
    .map(
      (i) =>
        `<item><title>${xml(i.title)}</title><link>${xml(i.url)}</link><pubDate>${i.pub.toUTCString()}</pubDate>${
          i.publisher ? `<source url="https://pub.test">${xml(i.publisher)}</source>` : ""
        }</item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>t</title><link>https://feeds.test/</link>${body}</channel></rss>`;
}

function page(title: string): string {
  const paragraphs = [1, 2, 3]
    .map(
      (n) =>
        `<p>${xml(title)}: parágrafo ${n} com detalhes suficientes para o leitor entender o que aconteceu, quem anunciou, quando e onde, com frases completas e bastante texto corrido sobre o assunto principal da notícia.</p>`,
    )
    .join("");
  return `<!DOCTYPE html><html><head><title>${xml(title)}</title></head><body><nav><a href="/">Home</a></nav><article><h1>${xml(title)}</h1>${paragraphs}</article></body></html>`;
}

// ---------------------------------------------------------------------------------------------
// Fake AI: triage, clustering, writer and checker, answered by purpose
// ---------------------------------------------------------------------------------------------

type Fact = { headline: string; importance: number; games?: string[]; keep?: boolean; rumor?: boolean };

const DRAFT: Draft = {
  title: "Matéria do robô",
  subtitle: "Linha fina.",
  excerpt: "Resumo.",
  pontos: ["Um.", "Dois.", "Três."],
  corpo: [{ p: "Texto da matéria." }],
  noTralked: null,
  pergunta: "O que você acha?",
  category: "GAMES",
  platforms: ["PC"],
  games: ["hades-ii"],
  imageLabel: "capa",
  rumor: false,
};

function fakeAi(facts: Map<string, Fact>) {
  const calls: StructuredOpts<unknown>[] = [];
  const state = { checkOk: true, writeError: null as Error | null };

  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    if (opts.purpose === "triage") {
      const items = JSON.parse(opts.user.slice(opts.user.indexOf("\n") + 1)) as { id: number; title: string }[];
      return opts.schema.parse({
        items: items.flatMap((it) => {
          const f = facts.get(it.title);
          if (!f) return []; // unanswered: stays "new"
          return [
            {
              id: it.id,
              keep: f.keep ?? true,
              category: "GAMES",
              games: f.games ?? ["Hades II"],
              companies: [],
              rumor: f.rumor ?? false,
              importance: f.importance,
              headlinePt: f.headline,
            },
          ];
        }),
      });
    }
    if (opts.purpose === "cluster") {
      // Same headline = same fact. Open stories first, then new stories inside the call.
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
    if (opts.purpose === "write" || opts.purpose === "write-retry") {
      if (state.writeError) throw state.writeError;
      return opts.schema.parse(DRAFT);
    }
    if (opts.purpose === "check") {
      return opts.schema.parse(state.checkOk ? { ok: true, problems: [] } : { ok: false, problems: ["Data errada."] });
    }
    throw new Error(`unexpected purpose ${opts.purpose}`);
  });

  return { ai: { structured, assertBudget: vi.fn() } as unknown as Ai, calls, state };
}

// ---------------------------------------------------------------------------------------------
// Fake site
// ---------------------------------------------------------------------------------------------

function fakeTralked() {
  const created: { payload: ArticlePayload; key: string }[] = [];
  const patches: { id: string; patch: ArticlePatch; key: string }[] = [];
  const state = { feed: [] as FeedArticle[] };
  const tralked: Tralked = {
    findGame: async (name) => ({ slug: slugify(name), name }),
    insights: async () => null,
    dossier: async () => null,
    recentArticles: async () => state.feed,
    createArticle: async (payload, key) => {
      created.push({ payload, key });
      const n = created.length;
      return { id: `site-${n}`, url: `https://tralked.com/noticias/materia-${n}`, slug: `materia-${n}` };
    },
    patchArticle: async (id, patch, key) => {
      patches.push({ id, patch, key });
    },
  };
  return { tralked, created, patches, state };
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

function harness(start = local("2026-10-31T10:00")) {
  const dir = mkdtempSync(join(tmpdir(), "robo-pipeline-"));
  const config = loadConfig({ ANTHROPIC_API_KEY: "test", TRALKED_API_KEY: "test", DATA_DIR: dir });
  const db = openDb(dir);
  const clock = { now: start };
  const feeds = new Map<string, FeedItem[]>();
  const facts = new Map<string, Fact>();
  const brokenPages = new Set<string>();

  const fetchFn = vi.fn(async (input: string) => {
    const source = SOURCES.find((s) => s.url === input);
    if (source) return new Response(rss(feeds.get(source.id) ?? []), { status: 200 });
    if (input.startsWith("https://news.test/") && !brokenPages.has(input)) {
      const item = [...feeds.values()].flat().find((i) => i.url === input);
      return new Response(page(item?.title ?? "Página"), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });

  const fake = fakeAi(facts);
  const site = fakeTralked();
  const deps: PipelineDeps = {
    db,
    ai: fake.ai,
    tralked: site.tralked,
    sources: SOURCES,
    config,
    now: () => clock.now,
    fetchFn,
  };
  const sleep = vi.fn(async (_ms: number) => {});

  /** Adds an item to a source's feed, with its triage answer. */
  const post = (sourceId: string, title: string, fact: Fact, over: Partial<FeedItem> = {}) => {
    const list = feeds.get(sourceId) ?? [];
    list.push({ title, url: `https://news.test/${sourceId}/${slugify(title)}`, pub: new Date(clock.now.getTime() - 30 * 60 * 1000), ...over });
    feeds.set(sourceId, list);
    facts.set(title, fact);
  };

  return {
    dir,
    config,
    db,
    clock,
    feeds,
    facts,
    brokenPages,
    fetchFn,
    fake,
    site,
    deps,
    sleep,
    post,
    at: (d: Date) => {
      clock.now = d;
    },
    coleta: () => runColeta(deps),
    publica: (over: { rand?: () => number; agora?: boolean } = {}) =>
      runPublica({ ...deps, sleep, rand: over.rand ?? (() => 0.5), agora: over.agora }),
  };
}

type H = ReturnType<typeof harness>;

const stories = (db: Db) => db.raw.prepare("SELECT * FROM stories ORDER BY id").all() as unknown as StoryRow[];

/** A queued live story backed by one full-text portal item. */
function seedQueued(h: H, headline: string, opts: { score?: number; firstSeenAt?: Date; bomb?: boolean } = {}): number {
  const seen = opts.firstSeenAt ?? h.clock.now;
  const url = `https://news.test/seed/${slugify(headline)}`;
  h.db.insertItemIfNew(
    { url, sourceId: "ign", title: headline, publishedAt: seen.toISOString(), text: `${headline}. Texto completo da fonte.` },
    seen,
  );
  const item = h.db.raw.prepare("SELECT id FROM items WHERE url = ?").get(url) as { id: number };
  const triage = { id: item.id, keep: true, category: "GAMES", games: ["Hades II"], companies: [], rumor: false, importance: 60, headlinePt: headline };
  h.db.setItemStatus(item.id, "clustered", JSON.stringify(triage));
  const id = h.db.upsertStory(
    {
      key: `seed-${slugify(headline)}`,
      headline,
      category: "GAMES",
      score: opts.score ?? 70,
      bomb: opts.bomb ?? false,
      rumor: false,
      gamesJson: '["Hades II"]',
      mode: "live",
      status: "queued",
      lastItemAt: seen.toISOString(),
    },
    seen,
  );
  h.db.attachItem(id, item.id);
  return id;
}

/** `n` articles already published at the given instants. */
function seedPublished(h: H, times: Date[]): void {
  times.forEach((t, i) => {
    const id = h.db.upsertStory(
      { key: `old-${i}-${t.getTime()}`, headline: `Antiga ${i}`, category: "GAMES", score: 50, bomb: false, rumor: false, gamesJson: "[]", mode: "live", status: "published", lastItemAt: t.toISOString() },
      t,
    );
    h.db.saveArticle({ storyId: id, payloadJson: "{}", status: "published", siteId: `old-${i}`, publishedAt: t.toISOString() }, t);
  });
}

const minutesBefore = (d: Date, n: number) => Array.from({ length: n }, (_, i) => new Date(d.getTime() - (i + 1) * 60 * 1000));

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe("publica: slot window", () => {
  it.each([
    ["2026-10-31T05:59", false],
    ["2026-10-31T06:00", true],
    ["2026-10-31T23:59", true],
    ["2026-11-01T00:03", false],
  ])("at %s local publishes: %s", async (wall, inside) => {
    const h = harness(local(wall));
    expect(inSlotWindow(h.clock.now)).toBe(inside);
    seedQueued(h, "Hades II recebe arma nova");
    const result = await h.publica({ rand: () => 0.25 });
    if (inside) {
      expect(result.published).toBe("site-1");
      expect(h.sleep).toHaveBeenCalledWith(3 * 60 * 1000); // 0.25 * 12 min
    } else {
      expect(result.published).toBeNull();
      expect(result.reason).toMatch(/grade/);
      expect(h.sleep).not.toHaveBeenCalled();
    }
    expect(h.site.created).toHaveLength(inside ? 1 : 0);
  });

  it("--agora skips the jitter wait", async () => {
    const h = harness();
    seedQueued(h, "Hades II recebe arma nova");
    const result = await h.publica({ agora: true });
    expect(result.published).toBe("site-1");
    expect(h.sleep).not.toHaveBeenCalled();
  });
});

describe("publica: daily cap", () => {
  it("publishes the 15th article of the day and refuses the 16th", async () => {
    const h = harness(local("2026-10-31T10:00"));
    seedPublished(h, minutesBefore(h.clock.now, 14));
    seedQueued(h, "Primeira história");
    seedQueued(h, "Segunda história");
    expect(h.db.publishedCountOn("2026-10-31")).toBe(14);

    expect((await h.publica()).published).toBe("site-1");
    expect(h.db.publishedCountOn("2026-10-31")).toBe(15);

    h.at(local("2026-10-31T11:00"));
    const result = await h.publica();
    expect(result.published).toBeNull();
    expect(result.reason).toMatch(/limite/);
    expect(h.site.created).toHaveLength(1);
    expect(h.sleep).toHaveBeenCalledTimes(1);
  });

  it("counts by the São Paulo day, not the UTC day", async () => {
    // 22:00 local on the 31st is 01:00 UTC on Nov 1st; 15 articles earlier that local day fill the cap.
    const h = harness(local("2026-10-31T22:00"));
    seedPublished(h, minutesBefore(h.clock.now, 15));
    seedQueued(h, "Uma história");
    expect((await h.publica()).reason).toMatch(/limite/);
  });
});

describe("coleta: bombs", () => {
  function postBomb(h: H) {
    const fact: Fact = { headline: "GTA 6 ganha data de lançamento", importance: 95, games: ["Grand Theft Auto VI"] };
    h.post("pub", "GTA VI release date announced", fact);
    h.post("ign", "GTA 6 tem data de lançamento", fact);
    h.post("kotaku", "GTA 6 finally has a release date", fact);
  }

  it("publishes a bomb at 03:00 local once, outside the slot window", async () => {
    const h = harness(local("2026-10-31T03:00"));
    postBomb(h);
    const first = await h.coleta();
    expect(first.published).toEqual(["site-1"]);
    expect(h.site.created).toHaveLength(1);
    expect(h.site.created[0]!.key).toMatch(/^robo-live-story-\d+$/);
    expect(h.db.publishedCountOn("2026-10-31")).toBe(1);

    h.at(local("2026-10-31T03:30"));
    const second = await h.coleta();
    expect(second.published).toEqual([]);
    expect(h.site.created).toHaveLength(1);
    expect((await h.publica()).reason).toMatch(/grade/);
  });

  it("does not publish a bomb when 15 were already published today", async () => {
    const h = harness(local("2026-10-31T03:00"));
    seedPublished(h, minutesBefore(h.clock.now, 15));
    postBomb(h);
    const report = await h.coleta();
    expect(report.published).toEqual([]);
    expect(h.site.created).toHaveLength(0);
    const bomb = stories(h.db).find((s) => s.headline === "GTA 6 ganha data de lançamento")!;
    expect(bomb.bomb).toBe(1);
    expect(bomb.status).toBe("queued");
  });
});

describe("coleta + publica", () => {
  it("two coleta runs with overlapping items publish one article, not two", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact: Fact = { headline: "Hades II recebe arma nova", importance: 60 };
    h.post("ign", "Hades II ganha arma nova", fact);
    h.post("kotaku", "Hades II adds a new weapon", fact);
    const first = await h.coleta();
    expect(first.inserted).toBe(2);
    expect(first.queued).toBe(1);

    h.at(local("2026-10-31T09:30"));
    h.post("pub", "Hades II: new weapon update", fact);
    const second = await h.coleta();
    expect(second.inserted).toBe(1);

    expect(stories(h.db)).toHaveLength(1);
    const [story] = stories(h.db);
    expect(h.db.itemIdsForStory(story!.id)).toHaveLength(3);
    expect(story!.status).toBe("queued");

    h.at(local("2026-10-31T10:00"));
    expect((await h.publica()).published).toBe("site-1");
    h.at(local("2026-10-31T11:00"));
    const again = await h.publica();
    expect(again.published).toBeNull();
    expect(h.site.created).toHaveLength(1);
    expect(h.db.articleForStory(story!.id)?.status).toBe("published");
  });

  it("passes the fast model to triage and clustering, and calls the AI sequentially", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.post("ign", "Hades II ganha arma nova", { headline: "Hades II recebe arma nova", importance: 60 });
    await h.coleta();
    const fast = h.fake.calls.filter((c) => c.purpose === "triage" || c.purpose === "cluster");
    expect(fast.length).toBeGreaterThanOrEqual(2);
    for (const c of fast) expect(c.model).toBe(h.config.MODEL_FAST);
  });

  it("leaves items the triage model did not answer as new, and drops items it did not keep", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.post("ign", "Hades II ganha arma nova", { headline: "Hades II recebe arma nova", importance: 60 });
    h.post("kotaku", "Top 10 jogos de terror", { headline: "Lista", importance: 10, keep: false });
    h.feeds.get("kotaku")!.push({ title: "Sem resposta", url: "https://news.test/kotaku/sem-resposta", pub: h.clock.now });
    await h.coleta();
    const status = (title: string) =>
      (h.db.raw.prepare("SELECT status FROM items WHERE title = ?").get(title) as { status: string }).status;
    expect(status("Sem resposta")).toBe("new");
    expect(status("Top 10 jogos de terror")).toBe("dropped");
    expect(status("Hades II ganha arma nova")).toBe("clustered");
  });

  it("drops a story already covered by an editorial article in the site feed", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.site.state.feed = [
      {
        id: "ed-1",
        slug: "hades-ii-recebe-arma-nova",
        title: "Hades II recebe arma nova",
        category: "GAMES",
        publishedAt: local("2026-10-30T18:00").toISOString(),
        source: "editorial",
        games: ["hades-ii"],
      },
    ];
    h.post("ign", "Hades II ganha arma nova", { headline: "Hades II recebe arma nova", importance: 60 });
    h.post("kotaku", "Hades II adds a new weapon", { headline: "Hades II recebe arma nova", importance: 60 });
    const report = await h.coleta();
    expect(report.covered).toBe(1);
    expect(report.queued).toBe(0);
    expect(stories(h.db)[0]!.status).toBe("dropped");
    const coverage = h.fake.calls.filter((c) => c.purpose === "cluster").at(-1)!;
    expect(coverage.user).toContain("feed-ed-1");

    h.at(local("2026-10-31T10:00"));
    expect((await h.publica()).published).toBeNull();
  });

  it("keeps a story whose title matches a feed article about another game", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.site.state.feed = [
      { id: "ed-1", slug: "x", title: "Hades II recebe arma nova", category: "GAMES", publishedAt: h.clock.now.toISOString(), source: "editorial", games: ["outro-jogo"] },
    ];
    h.post("ign", "Hades II ganha arma nova", { headline: "Hades II recebe arma nova", importance: 60 });
    h.post("kotaku", "Hades II adds a new weapon", { headline: "Hades II recebe arma nova", importance: 60 });
    const report = await h.coleta();
    expect(report.covered).toBe(0);
    expect(stories(h.db)[0]!.status).toBe("queued");
  });

  it("does not queue a story whose only sources are title-only, and cites a title-only source by its publisher", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact: Fact = { headline: "Hades II recebe arma nova", importance: 60 };
    // Google News link that cannot be resolved: the item is title-only (R15).
    h.post("gnews", "Hades II gets a new weapon - Eurogamer", fact, {
      url: "https://news.google.com/rss/articles/CBMiXYZ",
      publisher: "Eurogamer",
    });
    h.facts.set("Hades II gets a new weapon", fact);
    h.post("kotaku", "Hades II adds a new weapon", fact);
    h.brokenPages.add("https://news.test/kotaku/hades-ii-adds-a-new-weapon");
    await h.coleta();
    expect(stories(h.db)[0]!.status).toBe("open");

    // A portal with full text arrives: now it is publishable.
    h.at(local("2026-10-31T09:30"));
    h.post("ign", "Hades II ganha arma nova", fact);
    await h.coleta();
    expect(stories(h.db)[0]!.status).toBe("queued");

    h.at(local("2026-10-31T10:00"));
    await h.publica();
    const write = h.fake.calls.find((c) => c.purpose === "write")!;
    expect(write.user).toContain('segundo Eurogamer');
    expect(write.user).toContain("Fontes de manchete apenas");
  });
});

describe("updates and follow-ups", () => {
  async function publishedStory(h: H) {
    const fact: Fact = { headline: "Hades II recebe arma nova", importance: 60 };
    h.post("ign", "Hades II ganha arma nova", fact);
    h.post("kotaku", "Hades II adds a new weapon", fact);
    await h.coleta();
    h.at(local(`${localDay(h.clock.now)}T10:00`));
    expect((await h.publica()).published).toBe("site-1");
    return fact;
  }

  it("a same-day update PATCHes with the 'Atualizado às' note and does not count toward the cap", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact = await publishedStory(h);
    expect(h.db.publishedCountOn("2026-10-31")).toBe(1);

    h.at(local("2026-10-31T14:00"));
    h.post("pub", "Hades II weapon patch notes", { ...fact, importance: 60 });
    const report = await h.coleta();
    expect(report.updated).toBe(1);
    expect(h.site.patches).toHaveLength(1);
    const { id, patch, key } = h.site.patches[0]!;
    expect(id).toBe("site-1");
    expect(key).toBe(updateKey("site-1", 3));
    expect(patch.blocks?.[0]).toEqual({ type: "paragraph", text: "*Atualizado às 14:00*" });
    expect(h.site.created).toHaveLength(1);
    expect(h.db.publishedCountOn("2026-10-31")).toBe(1);

    // The writer got the published article as context.
    const update = h.fake.calls.filter((c) => c.purpose === "write").at(-1)!;
    expect(update.user).toContain("materia_anterior");
  });

  it("a minor same-day item (importance < 50) does not trigger an update", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact = await publishedStory(h);
    h.at(local("2026-10-31T14:00"));
    h.post("pub", "Hades II weapon footnote", { ...fact, importance: 40 });
    await h.coleta();
    expect(h.site.patches).toHaveLength(0);
  });

  it("a follow-up on a later day becomes a new queued story linked to the parent article", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact = await publishedStory(h);
    const parent = stories(h.db)[0]!;
    const parentArticle = h.db.articleForStory(parent.id)!;

    h.at(local("2026-11-01T09:00"));
    h.post("ign", "Hades II weapon gets a big rebalance", { ...fact, importance: 75 });
    const report = await h.coleta();
    expect(report.followUps).toBe(1);
    expect(h.site.patches).toHaveLength(0);

    const followUp = stories(h.db).find((s) => s.id !== parent.id)!;
    expect(followUp.status).toBe("queued");
    expect(followUp.parent_article_id).toBe(parentArticle.id);
    expect(stories(h.db).find((s) => s.id === parent.id)!.status).toBe("published");

    h.at(local("2026-11-01T10:00"));
    expect((await h.publica()).published).toBe("site-2");
    expect(h.db.articleForStory(followUp.id)?.parent_article_id).toBe(parentArticle.id);
    expect(h.db.publishedCountOn("2026-11-01")).toBe(1);
  });

  it("a later-day item below 70 creates no follow-up", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact = await publishedStory(h);
    h.at(local("2026-11-01T09:00"));
    h.post("ign", "Hades II weapon minor note", { ...fact, importance: 65 });
    const report = await h.coleta();
    expect(report.followUps).toBe(0);
    expect(stories(h.db)).toHaveLength(1);
  });
});

describe("PAUSADO", () => {
  it("stops both commands", async () => {
    const h = harness(local("2026-10-31T10:00"));
    writeFileSync(join(h.dir, "PAUSADO"), "");
    h.post("ign", "Hades II ganha arma nova", { headline: "Hades II recebe arma nova", importance: 95 });
    seedQueued(h, "Uma história na fila");

    const report = await h.coleta();
    expect(report.paused).toBe(true);
    expect(h.fetchFn).not.toHaveBeenCalled();
    expect(h.fake.calls).toHaveLength(0);

    const result = await h.publica();
    expect(result.published).toBeNull();
    expect(result.reason).toMatch(/pausad/i);
    expect(h.sleep).not.toHaveBeenCalled();
    expect(h.site.created).toHaveLength(0);
  });
});

describe("failures", () => {
  it("a budget error during writing stops publishing, keeps the story queued and raises an alert", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const first = seedQueued(h, "Primeira", { score: 90 });
    const second = seedQueued(h, "Segunda", { score: 80 });
    h.fake.state.writeError = new BudgetExceededError("live", 5.01, 5);

    const result = await h.publica();
    expect(result.published).toBeNull();
    expect(result.reason).toMatch(/orçamento/);
    expect(h.fake.calls.filter((c) => c.purpose === "write")).toHaveLength(1);
    expect(h.site.created).toHaveLength(0);
    const status = (id: number) => stories(h.db).find((s) => s.id === id)!.status;
    expect(status(first)).toBe("queued");
    expect(status(second)).toBe("queued");
    expect(h.db.alerts().map((a) => a.kind)).toContain("orcamento");
  });

  it("a failed check drops the story, raises an alert and tries the next story once", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const a = seedQueued(h, "A", { score: 90 });
    const b = seedQueued(h, "B", { score: 80 });
    const c = seedQueued(h, "C", { score: 70 });
    h.fake.state.checkOk = false;

    const result = await h.publica();
    expect(result.published).toBeNull();
    const status = (id: number) => stories(h.db).find((s) => s.id === id)!.status;
    expect(status(a)).toBe("dropped");
    expect(status(b)).toBe("dropped");
    expect(status(c)).toBe("queued");
    expect(h.db.alerts().filter((x) => x.kind === "checagem")).toHaveLength(2);
    expect(h.site.created).toHaveLength(0);
  });
});

describe("expiry", () => {
  it("never picks an expired story", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const old = seedQueued(h, "Velha", { score: 60, firstSeenAt: new Date(h.clock.now.getTime() - 25 * HOUR) });
    const fresh = seedQueued(h, "Nova", { score: 50 });

    expect((await h.publica()).published).toBe("site-1");
    const status = (id: number) => stories(h.db).find((s) => s.id === id)!.status;
    expect(status(old)).toBe("expired");
    expect(status(fresh)).toBe("published");
    expect(h.fake.calls.find((c) => c.purpose === "write")!.user).toContain("Pauta: Nova");
  });

  it("publishes nothing when only expired stories are queued", async () => {
    const h = harness(local("2026-10-31T10:00"));
    seedQueued(h, "Velha", { score: 60, firstSeenAt: new Date(h.clock.now.getTime() - 25 * HOUR) });
    const result = await h.publica();
    expect(result.published).toBeNull();
    expect(h.site.created).toHaveLength(0);
  });

  it("coleta expires stale queued stories", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const old = seedQueued(h, "Velha", { score: 60, firstSeenAt: new Date(h.clock.now.getTime() - 25 * HOUR) });
    const report = await h.coleta();
    expect(report.expired).toBe(1);
    expect(stories(h.db).find((s) => s.id === old)!.status).toBe("expired");
  });
});
