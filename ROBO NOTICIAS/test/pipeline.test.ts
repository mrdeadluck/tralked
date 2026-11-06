import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BudgetExceededError, UsageLimitError, type Ai, type StructuredOpts } from "../src/ai/client.js";
import type { Draft } from "../src/ai/writer.js";
import { inSlotWindow, localDay } from "../src/clock.js";
import { loadConfig, type Source } from "../src/config.js";
import { openDb, type Db, type StoryRow } from "../src/db.js";
import { recordPauta } from "../src/pautas.js";
import { publishStory, runColeta, runPublica, storyForWriting, type PipelineDeps } from "../src/pipeline.js";
import {
  TralkedError,
  slugify,
  updateKey,
  type ArticlePatch,
  type ArticlePayload,
  type Dossier,
  type FeedArticle,
  type GameMedia,
  type Tralked,
} from "../src/tralked.js";

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
  src("yt", "PlayStation (YouTube channel)", "oficial", {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC-2Y8dQb0S6DtpxNgAKoJKA",
    video: true,
    lang: "en",
  }),
  src("ytbr", "PlayStation Brasil (YouTube channel)", "oficial", {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC6i4mzH3OPrZV0p64zoz-Ww",
    video: true,
    lang: "pt",
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
  const state = {
    checkOk: true,
    writeError: null as Error | null,
    triageError: null as Error | null,
    novelty: { hasNewFacts: true, newFacts: ["A Supergiant confirmou o patch para sexta-feira."] },
    /** Forces items with this headline into the open story with this key (when it is open). */
    route: new Map<string, string>(),
    /** Resolves when released: lets a test hold the writer mid-call. */
    writeGate: null as Promise<void> | null,
    visionError: null as Error | null,
  };

  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    if (opts.purpose === "triage") {
      if (state.triageError) throw state.triageError;
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
        const routed = state.route.get(it.headlinePt);
        const match = (routed ? open.find((o) => o.key === routed) : undefined) ?? open.find((o) => o.headline === it.headlinePt);
        const k = match ? `open:${match.key}` : `new:${it.headlinePt}`;
        const g = groups.get(k) ?? { storyKey: match?.key ?? null, headline: match ? null : it.headlinePt, itemIds: [] };
        g.itemIds.push(it.id);
        groups.set(k, g);
      }
      return opts.schema.parse({ groups: [...groups.values()] });
    }
    if (opts.purpose === "write" || opts.purpose === "write-retry") {
      if (state.writeGate) await state.writeGate;
      if (state.writeError) throw state.writeError;
      return opts.schema.parse(DRAFT);
    }
    if (opts.purpose === "check") {
      return opts.schema.parse(state.checkOk ? { ok: true, problems: [] } : { ok: false, problems: ["Data errada."] });
    }
    if (opts.purpose === "novelty") return opts.schema.parse(state.novelty);
    if (opts.purpose === "vision") {
      if (state.visionError) throw state.visionError;
      const ids = [...opts.user.matchAll(/^Imagem \d+: (img\d+)/gm)].map((m) => m[1]!);
      return opts.schema.parse({ verdicts: ids.map((id) => ({ id, ok: true, depicts: "cena de Hades II", reason: "ok" })) });
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
  const uploads: string[] = [];
  const state = {
    feed: [] as FeedArticle[],
    feedError: null as Error | null,
    /** Catalog media by game slug (`GET /api/v1/games/{slug}/media`). */
    media: new Map<string, GameMedia>(),
    mediaError: null as Error | null,
  };
  const tralked: Tralked = {
    findGame: async (name) => ({ slug: slugify(name), name }),
    insights: async () => null,
    dossier: async () => null,
    media: async (slug) => {
      if (state.mediaError) throw state.mediaError;
      return state.media.get(slug) ?? null;
    },
    recentArticles: async () => {
      if (state.feedError) throw state.feedError;
      return state.feed;
    },
    createArticle: async (payload, key) => {
      created.push({ payload, key });
      const n = created.length;
      return { id: `site-${n}`, url: `https://tralked.com/noticias/materia-${n}`, slug: `materia-${n}` };
    },
    patchArticle: async (id, patch, key) => {
      patches.push({ id, patch, key });
    },
    uploadImage: async (_bytes, _type, key) => {
      uploads.push(key);
      return { url: `https://blob.test/${uploads.length}.webp` };
    },
  };
  return { tralked, created, patches, uploads, state };
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
  /** Image bytes served by URL (catalog art, source images). */
  const pictures = new Map<string, Buffer>();
  /** YouTube oEmbed answers by video id. */
  const oembeds = new Map<string, { title: string; author_name: string }>();

  const fetchFn = vi.fn(async (input: string) => {
    const source = SOURCES.find((s) => s.url === input);
    if (source) return new Response(rss(feeds.get(source.id) ?? []), { status: 200 });
    if (input.startsWith("https://www.youtube.com/oembed?")) {
      const id = new URL(new URL(input).searchParams.get("url")!).searchParams.get("v")!;
      const meta = oembeds.get(id);
      return meta ? new Response(JSON.stringify(meta), { status: 200 }) : new Response("no", { status: 404 });
    }
    const picture = pictures.get(input);
    if (picture) return new Response(new Uint8Array(picture), { status: 200, headers: { "content-type": "image/jpeg" } });
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
    pictures,
    oembeds,
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
    publica: (over: { rand?: () => number; agora?: boolean; foraDoHorario?: boolean; ignorarLimite?: boolean; revisao?: boolean } = {}) =>
      runPublica({ ...deps, sleep, rand: over.rand ?? (() => 0.5), ...over }),
  };
}

type H = ReturnType<typeof harness>;

const stories = (db: Db) => db.raw.prepare("SELECT * FROM stories ORDER BY id").all() as unknown as StoryRow[];

/** A queued live story backed by one full-text portal item. */
function seedQueued(
  h: H,
  headline: string,
  opts: { score?: number; firstSeenAt?: Date; itemAt?: Date; bomb?: boolean; status?: StoryRow["status"] } = {},
): number {
  const seen = opts.firstSeenAt ?? h.clock.now;
  const itemAt = opts.itemAt ?? seen;
  const url = `https://news.test/seed/${slugify(headline)}`;
  h.db.insertItemIfNew(
    { url, sourceId: "ign", title: headline, publishedAt: itemAt.toISOString(), text: `${headline}. Texto completo da fonte.` },
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
      status: opts.status ?? "queued",
      lastItemAt: itemAt.toISOString(),
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
      expect(h.sleep).toHaveBeenCalledWith(30 * 1000); // 0.25 * 2 min
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

  it("--fora-do-horario publishes at 02:00 local without waiting, still 21 min apart", async () => {
    const h = harness(local("2026-10-31T02:00"));
    seedQueued(h, "Hades II recebe arma nova");
    seedQueued(h, "Hades II ganha modo novo");
    const result = await h.publica({ foraDoHorario: true });
    expect(result.published).toBe("site-1");
    expect(h.sleep).not.toHaveBeenCalled();
    expect(h.db.publishedCountOn("2026-10-31")).toBe(1);
    expect((await h.publica({ foraDoHorario: true })).reason).toMatch(/intervalo mínimo de 21 min/);
  });

  it("--fora-do-horario still honors the daily cap; --ignorar-limite overrides it", async () => {
    const h = harness(local("2026-10-31T23:30"));
    h.at(local("2026-11-01T01:00"));
    seedPublished(h, minutesBefore(h.clock.now, 15));
    seedQueued(h, "Hades II recebe arma nova");
    expect((await h.publica({ foraDoHorario: true })).reason).toMatch(/limite/);
    expect(h.site.created).toHaveLength(0);
    const forced = await h.publica({ foraDoHorario: true, ignorarLimite: true });
    expect(forced.published).toBe("site-1");
  });

  it("--ignorar-limite alone still refuses outside the window", async () => {
    const h = harness(local("2026-10-31T03:00"));
    seedQueued(h, "Hades II recebe arma nova");
    const result = await h.publica({ ignorarLimite: true });
    expect(result.published).toBeNull();
    expect(result.reason).toMatch(/--fora-do-horario/);
  });
});

describe("publica: command flags", () => {
  it("parses the flags; --fora-do-horario implies --agora; unknown flags throw", async () => {
    const { parsePublicaArgs } = await import("../src/commands/publica.js");
    expect(parsePublicaArgs([])).toEqual({ agora: false, foraDoHorario: false, ignorarLimite: false, revisao: false });
    expect(parsePublicaArgs(["--agora"])).toEqual({ agora: true, foraDoHorario: false, ignorarLimite: false, revisao: false });
    expect(parsePublicaArgs(["--fora-do-horario"])).toEqual({ agora: true, foraDoHorario: true, ignorarLimite: false, revisao: false });
    expect(parsePublicaArgs(["--agora", "--fora-do-horario", "--ignorar-limite", "--revisao"])).toEqual({
      agora: true,
      foraDoHorario: true,
      ignorarLimite: true,
      revisao: true,
    });
    expect(() => parsePublicaArgs(["--fora-de-horario"])).toThrow();
  });
});

describe("publica: 21 minutes apart", () => {
  it("publishes again once 21 min have passed since the last article, in the same hour", async () => {
    const h = harness(local("2026-10-31T10:00"));
    seedQueued(h, "Primeira", { score: 90 });
    seedQueued(h, "Segunda", { score: 80 });
    seedQueued(h, "Terceira", { score: 70 });
    expect((await h.publica({ agora: true })).published).toBe("site-1");
    h.at(local("2026-10-31T10:20"));
    expect((await h.publica({ agora: true })).reason).toMatch(/faltam 1 min/);
    h.at(local("2026-10-31T10:21"));
    expect((await h.publica({ agora: true })).published).toBe("site-2");
    h.at(local("2026-10-31T10:42"));
    expect((await h.publica({ agora: true })).published).toBe("site-3");
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

    // The novelty check ran first on the fast model, with the published text and the new item.
    const novelty = h.fake.calls.find((c) => c.purpose === "novelty")!;
    expect(novelty.model).toBe(h.config.MODEL_FAST);
    expect(novelty.effort).toBe("low");
    expect(novelty.user).toContain("materia_publicada");
    expect(novelty.user).toContain("Hades II weapon patch notes");
    // The writer got the published article as context, and the new facts to add.
    const update = h.fake.calls.filter((c) => c.purpose === "write").at(-1)!;
    expect(update.user).toContain("materia_anterior");
    expect(update.user).toContain("A Supergiant confirmou o patch para sexta-feira.");
    expect(h.db.updateTimes(stories(h.db)[0]!.id)).toHaveLength(1);
  });

  it("repeated coverage without a new fact makes no PATCH and no rewrite", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact = await publishedStory(h);
    h.fake.state.novelty = { hasNewFacts: false, newFacts: [] };
    const writesBefore = h.fake.calls.filter((c) => c.purpose === "write").length;

    h.at(local("2026-10-31T14:00"));
    h.post("pub", "Hades II gets a new weapon, again", { ...fact, importance: 60 });
    const report = await h.coleta();
    expect(report.updated).toBe(0);
    expect(h.fake.calls.filter((c) => c.purpose === "novelty")).toHaveLength(1);
    expect(h.fake.calls.filter((c) => c.purpose === "write")).toHaveLength(writesBefore);
    expect(h.site.patches).toHaveLength(0);
  });

  it("waits 60 min between changes, and carries held-back items into the next update", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact = await publishedStory(h); // published at 10:00

    h.at(local("2026-10-31T10:30"));
    h.post("pub", "Hades II patch date confirmed", { ...fact, importance: 60 });
    await h.coleta();
    expect(h.site.patches).toHaveLength(0); // 30 min after publication
    expect(h.fake.calls.filter((c) => c.purpose === "novelty")).toHaveLength(0);

    h.at(local("2026-10-31T11:00"));
    h.post("blog", "Hades II patch is out", { ...fact, importance: 60 });
    await h.coleta();
    expect(h.site.patches).toHaveLength(1);
    const novelty = h.fake.calls.filter((c) => c.purpose === "novelty").at(-1)!;
    expect(novelty.user).toContain("Hades II patch date confirmed");
    expect(novelty.user).toContain("Hades II patch is out");

    h.at(local("2026-10-31T11:59"));
    h.post("kotaku", "Hades II patch notes detailed", { ...fact, importance: 60 });
    await h.coleta();
    expect(h.site.patches).toHaveLength(1); // 59 min after the update

    h.at(local("2026-10-31T12:00"));
    h.post("ign", "Hades II patch fixes crash", { ...fact, importance: 60 });
    await h.coleta();
    expect(h.site.patches).toHaveLength(2);
  });

  it("updates a story at most 3 times a day", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact = await publishedStory(h);
    const sources = ["pub", "blog", "pub", "blog"];
    for (const [i, hour] of ["11", "12", "13", "14"].entries()) {
      h.at(local(`2026-10-31T${String(hour).padStart(2, "0")}:00`));
      h.post(sources[i]!, `Hades II novidade ${hour}`, { ...fact, importance: 60 });
      await h.coleta();
    }
    expect(h.site.patches).toHaveLength(3);
    expect(h.db.publishedCountOn("2026-10-31")).toBe(1);
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

    // Linked to the earlier article: the writer saw it as context, and the link follows "Em 3 pontos".
    const write = h.fake.calls.filter((c) => c.purpose === "write").at(-1)!;
    expect(write.user).toContain("caso_anterior");
    expect(write.user).toContain("Matéria do robô");
    const check = h.fake.calls.filter((c) => c.purpose === "check").at(-1)!;
    expect(check.user).toContain("Matéria anterior do Tralked");
    const blocks = h.site.created[1]!.payload.blocks;
    expect(blocks[0]).toEqual({
      type: "paragraph",
      text: "Entenda o caso: [Matéria do robô](https://tralked.com/noticias/materia-1)",
    });
  });

  it("starts no second follow-up while one is pending or once one was created today", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const fact = await publishedStory(h);
    const parent = stories(h.db)[0]!;
    const route = (headline: string) => h.fake.state.route.set(headline, parent.key);

    h.at(local("2026-11-01T09:00"));
    route("GTA rebalance");
    h.post("ign", "Hades II weapon rebalance", { ...fact, headline: "GTA rebalance", importance: 75 });
    expect((await h.coleta()).followUps).toBe(1);
    const followUp = stories(h.db).find((s) => s.parent_article_id !== null)!;
    expect(followUp.status).toBe("queued");

    // Still queued: a new item about the parent joins it.
    h.at(local("2026-11-01T09:30"));
    route("Outro desenvolvimento");
    h.post("kotaku", "Hades II rebalance detailed", { ...fact, headline: "Outro desenvolvimento", importance: 80 });
    expect((await h.coleta()).followUps).toBe(0);
    expect(h.db.itemIdsForStory(followUp.id)).toHaveLength(2);

    // Published today: no new follow-up of the same parent until tomorrow.
    h.at(local("2026-11-01T10:00"));
    expect((await h.publica()).published).toBe("site-2");
    h.at(local("2026-11-01T14:00"));
    route("Terceiro desenvolvimento");
    h.post("pub", "Hades II rebalance reverted", { ...fact, headline: "Terceiro desenvolvimento", importance: 85 });
    expect((await h.coleta()).followUps).toBe(0);
    expect(stories(h.db).filter((s) => s.parent_article_id !== null)).toHaveLength(1);
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

describe("game destinations", () => {
  it("news about Mass Effect 1-3 (any edition) is written for the Legendary Edition, named or found", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const found = vi.fn(async (name: string) =>
      name === "Documentário da BioWare" ? { slug: "mass-effect-2-collectors-edition", name: "Mass Effect 2: Collector's Edition" } : null,
    );
    h.deps.tralked = { ...h.deps.tralked, findGame: found };
    const id = seedQueued(h, "Massive Effect sai em 2027");
    h.db.raw
      .prepare("UPDATE stories SET games_json = ? WHERE id = ?")
      .run(JSON.stringify(["Mass Effect", "Mass Effect 3", "Documentário da BioWare", "Mass Effect: Andromeda"]), id);
    const story = stories(h.db).find((s) => s.id === id)!;

    const writing = await storyForWriting(story, h.deps);
    expect(writing.candidates.map((c) => c.slug)).toEqual(["mass-effect-legendary-edition"]);
    // Named Mass Effect games never hit the catalog search; Andromeda is searched as itself.
    expect(found.mock.calls.map((c) => c[0])).toEqual(["Documentário da BioWare", "Mass Effect: Andromeda"]);
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

  it("the subscription limit stops publishing like the budget: story queued, limit alert, reason says so", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const id = seedQueued(h, "Primeira", { score: 90 });
    h.fake.state.writeError = new UsageLimitError("Mon 12:00am");

    const result = await h.publica();
    expect(result.published).toBeNull();
    expect(result.reason).toMatch(/limite da assinatura do Claude \(Mon 12:00am\)/);
    expect(stories(h.db).find((s) => s.id === id)!.status).toBe("queued");
    const alert = h.db.alerts().find((a) => a.kind === "orcamento")!;
    expect(JSON.stringify(alert)).toMatch(/limite da assinatura/i);
  });

  it("--revisao sends the article as a draft (status review)", async () => {
    const h = harness(local("2026-10-31T10:00"));
    seedQueued(h, "Primeira", { score: 90 });
    const result = await h.publica({ revisao: true });
    expect(result.published).not.toBeNull();
    expect(h.site.created[0]!.payload.status).toBe("review");
  });

  it("a failed check drops the story, raises an alert and tries the next ones, up to 4 rejections an hour", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const ids = ["A", "B", "C", "D", "E"].map((name, i) => seedQueued(h, name, { score: 90 - i * 5 }));
    h.fake.state.checkOk = false;

    const result = await h.publica();
    expect(result.published).toBeNull();
    const status = (id: number) => stories(h.db).find((s) => s.id === id)!.status;
    expect(ids.slice(0, 4).map(status)).toEqual(["dropped", "dropped", "dropped", "dropped"]);
    expect(status(ids[4]!)).toBe("queued");
    expect(h.db.alerts().filter((x) => x.kind === "checagem")).toHaveLength(4);
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

describe("concurrency", () => {
  it("two concurrent claims of one story make one write", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const id = seedQueued(h, "Uma história");
    const story = h.db.storyById(id)!;
    const results = await Promise.all([publishStory(story, h.deps), publishStory(story, h.deps)]);
    expect(results.filter((r) => r !== null)).toEqual(["site-1"]);
    expect(h.fake.calls.filter((c) => c.purpose === "write")).toHaveLength(1);
    expect(h.site.created).toHaveLength(1);
  });

  it("holds the cap at 14 + 1 with two publishers at once", async () => {
    const h = harness(local("2026-10-31T10:00"));
    seedPublished(h, minutesBefore(h.clock.now, 14));
    seedQueued(h, "Primeira", { score: 90 });
    seedQueued(h, "Segunda", { score: 80 });
    const results = await Promise.all([h.publica({ agora: true }), h.publica({ agora: true })]);
    expect(results.map((r) => r.published).filter(Boolean)).toEqual(["site-1"]);
    expect(results.map((r) => r.reason)).toContain("outra publicação em andamento");
    expect(h.db.publishedCountOn("2026-10-31")).toBe(15);
  });

  it("re-checks the cap inside the lock: a bomb waiting on publica does not make the 16th", async () => {
    const h = harness(local("2026-10-31T10:00"));
    seedPublished(h, minutesBefore(h.clock.now, 14));
    seedQueued(h, "Na fila", { score: 60 });
    const fact: Fact = { headline: "GTA 6 ganha data de lançamento", importance: 95, games: ["Grand Theft Auto VI"] };
    h.post("pub", "GTA VI release date announced", fact);
    h.post("ign", "GTA 6 tem data de lançamento", fact);
    h.post("kotaku", "GTA 6 finally has a release date", fact);
    // Hold the writer so publica keeps the lock while coleta reaches its bomb step.
    let release!: () => void;
    h.fake.state.writeGate = new Promise<void>((r) => (release = r));
    const publica = h.publica({ agora: true });
    const coleta = h.coleta();
    await new Promise((r) => setTimeout(r, 50));
    release();
    const [p, c] = await Promise.all([publica, coleta]);
    expect(p.published).toBe("site-1");
    expect(c.published).toEqual([]);
    expect(h.site.created).toHaveLength(1);
    expect(h.db.publishedCountOn("2026-10-31")).toBe(15);
  });

  it("leaves at least 21 min between articles, but bombs are exempt", async () => {
    const h = harness(local("2026-10-31T10:05"));
    seedQueued(h, "Primeira", { score: 90 });
    seedQueued(h, "Segunda", { score: 80 });
    expect((await h.publica()).published).toBe("site-1");

    h.at(local("2026-10-31T10:20"));
    const again = await h.publica({ agora: true });
    expect(again.published).toBeNull();
    expect(again.reason).toBe("intervalo mínimo de 21 min entre matérias: faltam 6 min");

    h.at(local("2026-10-31T10:45"));
    const fact: Fact = { headline: "GTA 6 ganha data de lançamento", importance: 95, games: ["Grand Theft Auto VI"] };
    h.post("pub", "GTA VI release date announced", fact);
    h.post("ign", "GTA 6 tem data de lançamento", fact);
    h.post("kotaku", "GTA 6 finally has a release date", fact);
    expect((await h.coleta()).published).toEqual(["site-2"]);

    h.at(local("2026-10-31T11:00"));
    expect((await h.publica()).published).toBe("site-3");
  });

  it("respects a fresh publish lock, takes over a stale one and requeues the story it left written", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const id = seedQueued(h, "Uma história");
    const lockPath = join(h.dir, "publica.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 1, at: new Date(h.clock.now.getTime() - 5 * 60 * 1000).toISOString(), token: "x" }));
    expect((await h.publica()).reason).toBe("outra publicação em andamento");

    // The crashed run had claimed the story and left a 31-min-old lock.
    h.db.setStoryStatus(id, "written");
    writeFileSync(lockPath, JSON.stringify({ pid: 1, at: new Date(h.clock.now.getTime() - 31 * 60 * 1000).toISOString(), token: "x" }));
    expect((await h.publica()).published).toBe("site-1");
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe("coverage and feed", () => {
  it("does not re-check a queued story whose article is already written (ready)", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const id = seedQueued(h, "Hades II recebe arma nova");
    h.db.saveArticle({ storyId: id, payloadJson: JSON.stringify({ title: "x", blocks: [] }), status: "ready" });
    h.site.state.feed = [
      { id: "ed-1", slug: "x", title: "Hades II recebe arma nova", category: "GAMES", publishedAt: h.clock.now.toISOString(), source: "editorial", games: ["hades-ii"] },
    ];
    const report = await h.coleta();
    expect(report.covered).toBe(0);
    expect(h.db.storyById(id)!.status).toBe("queued");
    expect(h.fake.calls.filter((c) => c.purpose === "cluster")).toHaveLength(0);
  });

  it("a feed failure queues nothing new but does not stop the run", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.site.state.feedError = new TralkedError(503, "unavailable", "fora do ar");
    h.post("ign", "Hades II ganha arma nova", { headline: "Hades II recebe arma nova", importance: 60 });
    h.post("kotaku", "Hades II adds a new weapon", { headline: "Hades II recebe arma nova", importance: 60 });
    const report = await h.coleta();
    expect(report.feedUnavailable).toBe(true);
    expect(report.stopped).toBeNull();
    expect(report.queued).toBe(0);
    expect(stories(h.db)[0]!.status).toBe("open");
    expect(h.db.alerts().map((a) => a.kind)).toContain("api");

    h.site.state.feedError = null;
    h.at(local("2026-10-31T09:30"));
    expect((await h.coleta()).queued).toBe(1);
  });
});

describe("expiry from the earliest item", () => {
  it("a story first seen now but built on a 30-hour-old item is expired, never picked", async () => {
    const h = harness(local("2026-10-31T10:00"));
    const id = seedQueued(h, "Velha", { score: 60, itemAt: new Date(h.clock.now.getTime() - 30 * HOUR) });
    expect((await h.publica()).published).toBeNull();
    expect(h.db.storyById(id)!.status).toBe("expired");
  });

  it("coleta never queues a story whose items are already past the expiry window", async () => {
    const h = harness(local("2026-10-31T10:00"));
    // Score 45 + 10 (portal) + 5 (second source) = 60 < 70: the 24 h window applies.
    const old = new Date(h.clock.now.getTime() - 30 * HOUR);
    h.post("ign", "Hades II ganha arma nova", { headline: "Hades II recebe arma nova", importance: 45 }, { pub: old });
    h.post("kotaku", "Hades II adds a new weapon", { headline: "Hades II recebe arma nova", importance: 45 }, { pub: old });
    const report = await h.coleta();
    expect(report.queued).toBe(0);
    expect(stories(h.db)[0]!.status).toBe("expired");
  });
});

describe("coleta: budget and absorbing", () => {
  it("a budget error during triage stops the run, keeps the items new and raises one alert", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.fake.state.triageError = new BudgetExceededError("live", 5.2, 5);
    h.post("ign", "Hades II ganha arma nova", { headline: "Hades II recebe arma nova", importance: 60 });
    const report = await h.coleta();
    expect(report.stopped).toBe("orcamento");
    expect(report.inserted).toBe(1);
    expect(h.db.itemsByStatus("new")).toHaveLength(1);
    h.at(local("2026-10-31T09:30"));
    await h.coleta();
    expect(h.db.alerts().filter((a) => a.kind === "orcamento")).toHaveLength(1);

    h.fake.state.triageError = null;
    h.at(local("2026-10-31T10:00"));
    await h.coleta();
    expect(h.db.itemsByStatus("new")).toHaveLength(0);
  });

  it("dropped and expired stories absorb new items without being re-queued", async () => {
    const h = harness(local("2026-10-31T09:00"));
    const dropped = seedQueued(h, "História descartada", { status: "dropped" });
    const expiredId = seedQueued(h, "História vencida", { status: "expired" });
    h.post("pub", "Dropped story follow", { headline: "História descartada", importance: 95 });
    h.post("ign", "Dropped story again", { headline: "História descartada", importance: 95 });
    h.post("kotaku", "Expired story follow", { headline: "História vencida", importance: 95 });
    const report = await h.coleta();
    expect(report.newStories).toBe(0);
    expect(report.queued).toBe(0);
    expect(report.published).toEqual([]);
    expect(h.db.storyById(dropped)!.status).toBe("dropped");
    expect(h.db.storyById(expiredId)!.status).toBe("expired");
    expect(h.db.itemIdsForStory(dropped)).toHaveLength(3);
    expect(h.db.itemIdsForStory(expiredId)).toHaveLength(2);
    expect(h.site.created).toHaveLength(0);
  });
});

describe("alerts", () => {
  it("PAUSADO raises one pausado alert a day across both commands", async () => {
    const h = harness(local("2026-10-31T10:00"));
    writeFileSync(join(h.dir, "PAUSADO"), "");
    await h.coleta();
    await h.publica();
    await h.coleta();
    expect(h.db.alerts().filter((a) => a.kind === "pausado")).toHaveLength(1);

    h.at(local("2026-11-01T10:00"));
    await h.publica();
    expect(h.db.alerts().filter((a) => a.kind === "pausado")).toHaveLength(2);
  });

  it("coleta raises a fonte alert for a source silent for more than 24 h, once a day", async () => {
    const h = harness(local("2026-10-30T08:00"));
    await h.coleta(); // every source answers: all marked ok
    expect(h.db.alerts().filter((a) => a.kind === "fonte")).toHaveLength(0);

    h.fetchFn.mockImplementation(async (input: string) =>
      input === "https://feeds.test/blog.xml" ? new Response("boom", { status: 500 }) : new Response(rss([]), { status: 200 }),
    );
    h.at(local("2026-10-31T07:00")); // 23 h later
    await h.coleta();
    expect(h.db.alerts().filter((a) => a.kind === "fonte")).toHaveLength(0);

    h.at(local("2026-10-31T09:00")); // 25 h later
    await h.coleta();
    await h.coleta();
    const fonte = h.db.alerts().filter((a) => a.kind === "fonte");
    expect(fonte).toHaveLength(1);
    expect(fonte[0]!.message).toContain("Blog Qualquer");
  });
});

// ---------------------------------------------------------------------------------------------
// Pautas Tralked in the publish slot
// ---------------------------------------------------------------------------------------------

describe("publica: pautas", () => {
  const STEAM = "https://store.steampowered.com/api/appdetails?appids=367520&l=brazilian";

  function dossier(slug: string, name: string): Dossier {
    return {
      game: {
        slug,
        name,
        steamAppId: 367520,
        summary: "Metroidvania.",
        developer: "Team Cherry",
        publisher: "Team Cherry",
        releaseDate: "2017-02-24",
        platforms: ["PC"],
        criticScore: 87,
        timeToBeatCompleteMin: 3720,
        achievementCount: 12,
      },
      tralked: { players: 10, avgPlaytimeMin: 2400, completedPlayers: 2 },
      achievements: Array.from({ length: 12 }, (_, i) => ({
        platform: "steam",
        apiName: `ACH_${i}`,
        name: `Conquista ${i}`,
        description: `Faça ${i}.`,
        globalPct: 1 + i,
      })),
    };
  }

  /** Turns pautas on: one famous game whose catalog page, dossier and Steam text are all available. */
  function withPautas(h: H): void {
    h.deps.famousGames = [{ name: "Hollow Knight", steamAppId: 367520 }];
    h.site.tralked.dossier = async (slug) => (slug === "hollow-knight" ? dossier(slug, "Hollow Knight") : null);
    const base = h.fetchFn.getMockImplementation()!;
    h.fetchFn.mockImplementation(async (input: string) =>
      input === STEAM
        ? new Response(JSON.stringify({ "367520": { success: true, data: { name: "Hollow Knight", about_the_game: "<p>Explore cavernas.</p>" } } }), { status: 200 })
        : base(input),
    );
  }

  type PautaRowLite = { status: string; mode: string; site_id: string | null; story_date: string; game_slug: string | null };
  const pautaRows = (db: Db) => db.raw.prepare("SELECT * FROM pautas ORDER BY id").all() as unknown as PautaRowLite[];
  const isPauta = (key: string | undefined) => /^robo-pauta-live-\d+$/.test(key ?? "");

  /** Pautas already published today, at the given instants. */
  function seedPublishedPautas(h: H, times: Date[]): void {
    times.forEach((t, i) =>
      recordPauta(
        h.db,
        {
          gameName: `Antigo ${i}`,
          gameSlug: `antigo-${i}`,
          format: "iniciantes",
          status: "published",
          mode: "live",
          storyDate: localDay(t),
          siteId: `old-pauta-${i}`,
          publishedAt: t.toISOString(),
        },
        t,
      ),
    );
  }

  it("with a top news score of 80 it publishes the news", async () => {
    const h = harness(local("2026-10-31T10:00"));
    withPautas(h);
    seedQueued(h, "Notícia forte", { score: 80 });
    const result = await h.publica();
    expect(result.published).toBe("site-1");
    expect(h.site.created[0]!.key).toMatch(/^robo-live-story-\d+$/);
    expect(pautaRows(h.db)).toHaveLength(0);
  });

  it("with a top news score of 55 it publishes a pauta through the lock, the slot rule and the cap", async () => {
    const h = harness(local("2026-10-31T10:00"));
    withPautas(h);
    const news = seedQueued(h, "Notícia fraca", { score: 55 });
    const result = await h.publica();
    expect(result.published).toBe("site-1");
    expect(result.reason).toMatch(/pauta/);
    const sent = h.site.created[0]!;
    expect(isPauta(sent.key)).toBe(true);
    expect(sent.payload.games).toEqual([{ slug: "hollow-knight" }]);
    expect(["GAMES", "GUIAS"]).toContain(sent.payload.category);
    expect(JSON.stringify(sent.payload.blocks)).toContain("https://tralked.com/jogos/hollow-knight");
    expect(h.sleep).toHaveBeenCalledTimes(1); // the same jitter as news
    // The pauta writer gets the pauta prompt on top of the house style.
    const write = h.fake.calls.find((c) => c.purpose === "write")!;
    expect(write.system).toContain("Pautas Tralked");
    expect(write.fallbacks).toBe(true);

    expect(pautaRows(h.db)).toMatchObject([
      { status: "published", mode: "live", site_id: "site-1", story_date: "2026-10-31", game_slug: "hollow-knight" },
    ]);
    expect(h.db.storyById(news)!.status).toBe("queued");
    expect(h.db.publishedCountOn("2026-10-31")).toBe(1);

    // At least 21 min between articles, pauta or not.
    h.at(local("2026-10-31T10:15"));
    expect((await h.publica()).reason).toMatch(/intervalo mínimo/);
    expect(h.site.created).toHaveLength(1);
  });

  it("at 20:00 with no pauta yet today it publishes a pauta even when the news scores 80", async () => {
    const h = harness(local("2026-10-31T20:00"));
    withPautas(h);
    seedQueued(h, "Notícia forte", { score: 80 });
    await h.publica();
    expect(isPauta(h.site.created[0]?.key)).toBe(true);

    // 19:00 is not the pauta hour: news wins.
    const early = harness(local("2026-10-31T19:00"));
    withPautas(early);
    seedQueued(early, "Notícia forte", { score: 80 });
    await early.publica();
    expect(early.site.created[0]!.key).toMatch(/^robo-live-story-/);

    // 21:00 with one pauta already out: news at 80 wins.
    const later = harness(local("2026-10-31T21:00"));
    withPautas(later);
    seedPublishedPautas(later, [local("2026-10-31T09:10")]);
    seedQueued(later, "Notícia forte", { score: 80 });
    await later.publica();
    expect(later.site.created[0]!.key).toMatch(/^robo-live-story-/);
  });

  it("refuses a third pauta in one day", async () => {
    const h = harness(local("2026-10-31T15:00"));
    withPautas(h);
    seedPublishedPautas(h, [local("2026-10-31T08:10"), local("2026-10-31T11:10")]);
    seedQueued(h, "Notícia fraca", { score: 55 });
    await h.publica();
    expect(h.site.created[0]!.key).toMatch(/^robo-live-story-/);

    h.at(local("2026-10-31T16:00"));
    const result = await h.publica();
    expect(result.published).toBeNull();
    expect(result.reason).toMatch(/fila vazia/);
    expect(h.site.created).toHaveLength(1);
    expect(pautaRows(h.db)).toHaveLength(2);
  });

  it("pautas count toward the daily cap of 15", async () => {
    const h = harness(local("2026-10-31T15:00"));
    withPautas(h);
    seedPublished(h, minutesBefore(local("2026-10-31T14:00"), 13));
    seedPublishedPautas(h, [local("2026-10-31T09:10")]);
    expect(h.db.publishedCountOn("2026-10-31")).toBe(14);
    // An empty queue: the slot goes to a pauta, the 15th article of the day.
    await h.publica();
    expect(isPauta(h.site.created[0]?.key)).toBe(true);
    expect(h.db.publishedCountOn("2026-10-31")).toBe(15);

    h.at(local("2026-10-31T16:00"));
    seedQueued(h, "Notícia fraca", { score: 55 });
    const result = await h.publica();
    expect(result.published).toBeNull();
    expect(result.reason).toMatch(/limite/);
  });

  it("falls back to news when no pauta can be made, and never makes one without the famous games list", async () => {
    const h = harness(local("2026-10-31T10:00"));
    withPautas(h);
    h.site.tralked.dossier = async () => null; // the game is not in the catalog
    seedQueued(h, "Notícia fraca", { score: 55 });
    await h.publica();
    expect(h.site.created[0]!.key).toMatch(/^robo-live-story-/);
    expect(pautaRows(h.db)).toMatchObject([{ status: "skipped", game_slug: null }]);

    const plain = harness(local("2026-10-31T10:00"));
    seedQueued(plain, "Notícia fraca", { score: 55 });
    await plain.publica();
    expect(plain.site.created[0]!.key).toMatch(/^robo-live-story-/);
  });

  it("a bomb is unaffected by pautas", async () => {
    const h = harness(local("2026-10-31T10:00"));
    withPautas(h);
    const fact: Fact = { headline: "GTA 6 ganha data de lançamento", importance: 95, games: ["Grand Theft Auto VI"] };
    h.post("pub", "GTA VI release date announced", fact);
    h.post("ign", "GTA 6 tem data de lançamento", fact);
    h.post("kotaku", "GTA 6 finally has a release date", fact);
    const report = await h.coleta();
    expect(report.published).toEqual(["site-1"]);
    expect(h.site.created[0]!.key).toMatch(/^robo-live-story-/);
    expect(pautaRows(h.db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Media: official videos and catalog art
// ---------------------------------------------------------------------------------------------

describe("video stories (official YouTube channels)", () => {
  const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
  const trailer: Fact = { headline: "Hades II ganha trailer de lançamento", importance: 70 };

  it("collects only trailers and gameplay, queues a relevant one and publishes it with the video after the lede", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.post("yt", "Hades II - Launch Trailer | PS5 Games", trailer, { url: watch("AAAAAAAAAAA") });
    h.post("yt", "Hades II Launch Livestream", { headline: "Live", importance: 80 }, { url: watch("BBBBBBBBBBB") });
    h.post("yt", "Hades II is out now #shorts", { headline: "Short", importance: 80 }, { url: "https://www.youtube.com/shorts/CCCCCCCCCCC" });
    const report = await h.coleta();
    expect(report.inserted).toBe(1);
    expect(report.queued).toBe(1);
    const item = h.db.raw.prepare("SELECT video_id, text_unavailable FROM items").get() as { video_id: string; text_unavailable: number };
    expect({ ...item }).toEqual({ video_id: "AAAAAAAAAAA", text_unavailable: 1 });
    // The watch page is never downloaded.
    expect(h.fetchFn.mock.calls.some(([u]) => String(u).startsWith("https://www.youtube.com/watch"))).toBe(false);

    h.at(local("2026-10-31T10:00"));
    expect((await h.publica()).published).toBe("site-1");
    const { blocks } = h.site.created[0]!.payload;
    expect(blocks[0]).toEqual({ type: "paragraph", text: "Texto da matéria." });
    expect(blocks[1]).toEqual({ type: "video", youtubeId: "AAAAAAAAAAA", title: "Hades II - Launch Trailer | PS5 Games" });
    expect(blocks.filter((b) => b.type === "video" || b.type === "image")).toHaveLength(1);

    const write = h.fake.calls.find((c) => c.purpose === "write")!;
    expect(write.user).toContain("## Vídeo oficial");
    expect(write.user).toContain("Esta é uma matéria sobre o vídeo");
    expect(write.user).toContain("Título do vídeo: Hades II - Launch Trailer | PS5 Games");
    expect(write.user).not.toContain("Fontes de manchete apenas");
  });

  it("does not queue a video below importance 60", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.post("yt", "Small Game - Trailer", { headline: "Jogo pequeno ganha trailer", importance: 55, games: ["Small Game"] }, { url: watch("AAAAAAAAAAA") });
    const report = await h.coleta();
    expect(report.queued).toBe(0);
    expect(stories(h.db)[0]!.status).toBe("open");
  });

  it("drops a video story when the site published about the game in the last 24 h", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.site.state.feed = [
      { id: "ed-1", slug: "x", title: "Outra coisa de Hades II", category: "GAMES", publishedAt: local("2026-10-31T01:00").toISOString(), source: "bot", games: ["hades-ii"] },
    ];
    h.post("yt", "Hades II - Launch Trailer", trailer, { url: watch("AAAAAAAAAAA") });
    const report = await h.coleta();
    expect(report.videoDuplicates).toBe(1);
    expect(report.queued).toBe(0);
    expect(stories(h.db)[0]!.status).toBe("dropped");
  });

  it("merges the video into a queued text story about the same game, which then embeds it", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.post("ign", "Hades II sai da versão antecipada", { headline: "Hades II sai do acesso antecipado", importance: 75 });
    await h.coleta();
    h.at(local("2026-10-31T09:30"));
    h.post("yt", "Hades II - Launch Trailer", trailer, { url: watch("AAAAAAAAAAA") });
    const report = await h.coleta();
    expect(report.videoDuplicates).toBe(1);
    const [text, video] = stories(h.db);
    expect(text!.status).toBe("queued");
    expect(video!.status).toBe("dropped");
    expect(h.db.itemsForStory(text!.id).some((i) => i.video_id === "AAAAAAAAAAA")).toBe(true);

    h.at(local("2026-10-31T10:00"));
    await h.publica();
    expect(h.site.created[0]!.payload.blocks[1]).toMatchObject({ type: "video", youtubeId: "AAAAAAAAAAA" });
    const write = h.fake.calls.find((c) => c.purpose === "write")!;
    expect(write.user).toContain("O vídeo complementa a notícia");
  });

  it("the same trailer on two channels becomes one story that embeds the pt channel's video", async () => {
    const h = harness(local("2026-10-31T09:00"));
    h.post("yt", "Hades II - Launch Trailer", trailer, { url: watch("AAAAAAAAAAA") });
    h.post("ytbr", "Hades II - Trailer de Lançamento", { ...trailer, headline: "Trailer de lançamento de Hades II" }, { url: watch("BBBBBBBBBBB") });
    const report = await h.coleta();
    expect(report.queued + report.videoDuplicates).toBe(2);
    expect(stories(h.db).filter((s) => s.status === "queued")).toHaveLength(1);

    h.at(local("2026-10-31T10:00"));
    await h.publica();
    expect(h.site.created[0]!.payload.blocks[1]).toMatchObject({ type: "video", youtubeId: "BBBBBBBBBBB" });
  });

  it("publishes at most 4 video stories a day; text news still goes out", async () => {
    const h = harness(local("2026-10-31T08:00"));
    const games = ["Alpha", "Beta", "Gama", "Delta", "Epsilon"];
    games.forEach((g, i) =>
      h.post("yt", `${g} - Official Trailer`, { headline: `${g} ganha trailer`, importance: 70, games: [g] }, { url: watch(`${"V".repeat(10)}${i}`) }),
    );
    await h.coleta();
    for (let hour = 9; hour <= 12; hour++) {
      h.at(local(`2026-10-31T${String(hour).padStart(2, "0")}:00`));
      expect((await h.publica()).published).not.toBeNull();
    }
    h.at(local("2026-10-31T12:30"));
    h.post("ign", "Hades II ganha arma nova", { headline: "Hades II recebe arma nova", importance: 50 });
    await h.coleta();
    h.at(local("2026-10-31T13:00"));
    const fifth = await h.publica();
    expect(fifth.reason).toContain("Hades II recebe arma nova");
    h.at(local("2026-10-31T14:00"));
    expect((await h.publica()).reason).toBe("fila vazia");
    expect(stories(h.db).filter((s) => s.status === "queued")).toHaveLength(1);
  });
});

/** A distinct 1920×1080 JPEG per `n`. */
async function scene(n: number): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const w = 1920;
  const hgt = 1080;
  const raw = Buffer.alloc(w * hgt * 3);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const v = Math.round((255 * ((n % 2 ? 1 - x / w : x / w) + (n % 3 === 2 ? 1 - y / hgt : y / hgt))) / 2);
      raw[i] = v;
      raw[i + 1] = (v + n * 70) % 256;
      raw[i + 2] = 255 - v;
    }
  }
  return sharp(raw, { raw: { width: w, height: hgt, channels: 3 } }).jpeg().toBuffer();
}

describe("catalog media for articles without their own", () => {
  const media = (over: Partial<GameMedia> = {}): GameMedia => ({
    game: { slug: "hades-ii", name: "Hades II", developer: "Supergiant Games", publisher: "Supergiant Games" },
    images: [
      { url: "https://images.igdb.com/igdb/image/upload/t_1080p/hero.jpg", kind: "hero", width: null, height: null, source: null },
      { url: "https://images.igdb.com/igdb/image/upload/t_1080p/s1.jpg", kind: "screenshot", width: 1920, height: 1080, source: "igdb" },
      { url: "https://images.igdb.com/igdb/image/upload/t_1080p/s2.jpg", kind: "screenshot", width: 1920, height: 1080, source: "igdb" },
    ],
    videos: [{ youtubeId: "TTTTTTTTTTT" }],
    ...over,
  });

  it("adds catalog scenes of the exact game, hosted by the site, and the game's trailer after the body", async () => {
    const h = harness();
    h.site.state.media.set("hades-ii", media());
    for (const [n, url] of media().images.map((i) => i.url).entries()) h.pictures.set(url, await scene(n));
    const id = seedQueued(h, "Hades II recebe arma nova");
    await h.publica({ agora: true });
    const { blocks } = h.site.created[0]!.payload;
    expect(blocks[1]).toEqual({ type: "image", url: "https://blob.test/1.webp", alt: "Cena de Hades II", credit: "Divulgação/Supergiant Games" });
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(2);
    expect(blocks.find((b) => b.type === "video")).toEqual({ type: "video", youtubeId: "TTTTTTTTTTT", title: "Vídeo de Hades II" });
    expect(blocks.at(-2)).toEqual({ type: "heading", level: 2, text: "Fontes" });
    // The scene is picked by story id, so articles of one game vary.
    const vision = h.fake.calls.find((c) => c.purpose === "vision")!;
    expect(vision.user).toContain(`img1 (de Tralked)`);
    expect(h.site.uploads).toHaveLength(2);
    expect(id).toBeGreaterThan(0);
  });

  it("a story about a trailer never gets the catalog's gameplay in its place", async () => {
    const h = harness();
    h.site.state.media.set("hades-ii", media());
    seedQueued(h, "Hades II ganha trailer de lançamento");
    await h.publica({ agora: true });
    expect(h.site.created[0]!.payload.blocks.some((b) => b.type === "video")).toBe(false);
  });

  it("embeds the official video a source page carries, right after the lede", async () => {
    const h = harness();
    h.oembeds.set("SSSSSSSSSSS", { title: "Hades II - Official Launch Trailer", author_name: "PlayStation" });
    h.oembeds.set("RRRRRRRRRRR", { title: "Hades II trailer reaction", author_name: "Canal Qualquer" });
    const id = seedQueued(h, "Hades II ganha trailer de lançamento");
    const [item] = h.db.itemsForStory(id);
    h.db.setItemMedia(item!.id, { images: [], youtube: ["RRRRRRRRRRR", "SSSSSSSSSSS"], posts: [] });
    await h.publica({ agora: true });
    const { blocks } = h.site.created[0]!.payload;
    expect(blocks[1]).toEqual({ type: "video", youtubeId: "SSSSSSSSSSS", title: "Hades II - Official Launch Trailer" });
    const write = h.fake.calls.find((c) => c.purpose === "write")!;
    expect(write.user).toContain("O vídeo complementa a notícia");
  });

  it("a vision failure publishes without images; the subscription limit puts the story back in the queue", async () => {
    const h = harness();
    h.site.state.media.set("hades-ii", media());
    for (const [n, url] of media().images.map((i) => i.url).entries()) h.pictures.set(url, await scene(n));
    seedQueued(h, "Hades II recebe arma nova");
    h.fake.state.visionError = new Error("timeout");
    await h.publica({ agora: true });
    expect(h.site.created[0]!.payload.blocks.some((b) => b.type === "image")).toBe(false);

    const limited = harness();
    limited.site.state.media.set("hades-ii", media());
    for (const [n, url] of media().images.map((i) => i.url).entries()) limited.pictures.set(url, await scene(n));
    const id = seedQueued(limited, "Hades II recebe arma nova");
    limited.fake.state.visionError = new UsageLimitError("3:45pm");
    await limited.publica({ agora: true }).catch(() => null);
    expect(limited.site.created).toHaveLength(0);
    expect(limited.db.storyById(id)!.status).toBe("queued");
  });

  it("publishes without media when the catalog has none or fails", async () => {
    const h = harness();
    seedQueued(h, "Hades II recebe arma nova");
    await h.publica({ agora: true });
    expect(h.site.created[0]!.payload.blocks.some((b) => b.type === "image" || b.type === "video")).toBe(false);

    const failing = harness();
    failing.site.state.mediaError = new TralkedError(500, "server_error", "boom");
    seedQueued(failing, "Hades II recebe arma nova");
    expect((await failing.publica({ agora: true })).published).toBe("site-1");
  });
});
