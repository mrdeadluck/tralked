import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { parseReport } from "@/lib/admin/guide-report";
import { guidePatchSchema, guidePayloadSchema } from "@/lib/content/guide-schema";
import type { GameSearchHit, GuideApi, GuideRequest, GuideRequestReport } from "../../src/guias/api.js";
import type { GuidePayloadV2 } from "../../src/guias/contract.js";
import { openGuideDb, type GuideDb } from "../../src/guias/db.js";
import type { GuideDossierSource, SteamAchievement } from "../../src/guias/dossier.js";
import type { ExtractedFacts, LlmFacts } from "../../src/guias/facts.js";
import { runGuideRequest, type GuidePipelineDeps, type GuideStages } from "../../src/guias/pipeline.js";
import { buildReport } from "../../src/guias/report.js";
import type { FetchPage, SourceRef } from "../../src/guias/sources.js";
import { TralkedError } from "../../src/tralked-http.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const REQUEST: GuideRequest = { id: "req-1", steamAppId: 4115450, gameSlug: "phantom-test", attempts: 1 };

const STEAM: SteamAchievement[] = [steamAch("ACH_END", "The End", "Finish the story.")];

const DOSSIER_SOURCE: GuideDossierSource = {
  game: {
    slug: "phantom-test",
    name: "Phantom Test",
    steamAppId: 4115450,
    summary: null,
    developer: "S-Game",
    publisher: "S-Game",
    releaseDate: null,
    platforms: ["PC"],
    criticScore: null,
    timeToBeatCompleteMin: null,
    achievementCount: 1,
  },
  tralked: { players: 0, avgPlaytimeMin: null, completedPlayers: 0 },
  achievements: STEAM,
};

const STEAM_GUIDE: SourceRef = {
  name: "Steam: All Achievements (Ana)",
  url: "https://steamcommunity.com/sharedfiles/filedetails/?id=1",
  role: "roteiro_steam",
};
const POWERPYX: SourceRef = {
  name: "PowerPyx",
  url: "https://www.powerpyx.com/phantom-test-trophy-guide-roadmap/",
  role: "roteiro_psn",
  language: "en",
};

const STEAM_GUIDE_TEXT = "Golden Feather: climb the old tower in Chapter 1. The End: finish the story.";
const STEAM_GUIDE_HTML =
  "<html><body><article><h2>Golden Feather</h2>" +
  '<img src="https://images.steamusercontent.com/ugc/feather.jpg" width="800" height="450">' +
  "<p>Climb the old tower in Chapter 1.</p></article></body></html>";

/** One complete Steam script that covers the whole list: the gate passes. */
const steamFacts = (source: SourceRef): ExtractedFacts => ({
  ...fact("x", "roteiro_steam", {
    achievements: [ach("The End")],
    chapters: [chapter("Chapter 1", [item("Golden Feather")])],
  }),
  source,
});

/** A small guide format 2 that the site schema accepts. */
function writtenPayload(): GuidePayloadV2 {
  return {
    game: { slug: "phantom-test" },
    format: 2,
    status: "review",
    facts: { difficulty: 3, hoursMin: 5, hoursMax: 6, playthroughs: "1", missables: 0, online: 0 },
    overview: ["Um jogo curto."],
    steps: [{ key: "historia", title: "História", hours: "5 h", body: [{ type: "paragraph", text: "Jogue a história." }] }],
    sources: [{ title: "Steam: All Achievements (Ana)", url: STEAM_GUIDE.url }],
    walkthrough: {
      cover: {
        calls: [
          { value: "3/10", label: "Dificuldade" },
          { value: "5–6 h", label: "Tempo até o Tralked" },
          { value: "1", label: "Conquistas" },
        ],
        sealHours: "5–6 h",
        headline: "O caminho até o Tralked",
        deck: "Tudo na ordem do jogo.",
      },
      extraFacts: { buggedCount: 0, hardest: null, playthroughsNote: "Uma jogada basta.", difficultyNote: "Fácil." },
      compat: "steam_only",
      readFirst: [{ title: "Saves", text: "Salve sempre.", tone: "info", spoiler: false }],
      chapters: [
        {
          key: "capitulo-1",
          phaseKey: "historia",
          title: "Capítulo 1",
          hours: "1 h",
          steps: [
            {
              key: "torre",
              body: [{ type: "paragraph", text: "Suba a torre velha." }],
              items: [
                {
                  key: "golden-feather",
                  kind: "collectible",
                  name: "Pena Dourada",
                  nameEn: "Golden Feather",
                  location: "Topo da torre velha",
                  missable: false,
                  returnLater: false,
                  spoiler: false,
                  countsFor: [],
                  alsoOn: [],
                  sources: [{ name: "Steam: All Achievements (Ana)", url: STEAM_GUIDE.url }],
                  review: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

type Calls = {
  reports: { id: string; body: GuideRequestReport; key: string }[];
  created: { payload: GuidePayloadV2 & { report?: unknown }; key: string }[];
  patched: { id: string; patch: Partial<GuidePayloadV2> & { report?: unknown }; key: string }[];
  uploads: { contentType: string; key: string }[];
};

function fakeApi(over: Partial<GuideApi> & { hit?: GameSearchHit | null } = {}) {
  const calls: Calls = { reports: [], created: [], patched: [], uploads: [] };
  const { hit, ...rest } = over;
  const api: GuideApi = {
    claimNext: vi.fn(async () => ({ ...REQUEST })),
    reportRequest: vi.fn(async (id: string, body: GuideRequestReport, key: string) => {
      calls.reports.push({ id, body, key });
    }),
    dossier: vi.fn(async () => DOSSIER_SOURCE),
    media: vi.fn(async () => null),
    uploadImage: vi.fn(async (_bytes: Uint8Array, contentType: string, key: string) => {
      calls.uploads.push({ contentType, key });
      return { url: "https://cdn.tralked.com/guias/feather.webp", width: 1600, height: 900 };
    }),
    createGuide: vi.fn(async (payload: GuidePayloadV2, key: string) => {
      calls.created.push({ payload, key });
      return { id: "guide-new", status: "review" };
    }),
    patchGuide: vi.fn(async (id: string, patch: Partial<GuidePayloadV2>, key: string) => {
      calls.patched.push({ id, patch, key });
      return { id, status: "pending_review", pendingId: "pending-1" };
    }),
    findGameByAppId: vi.fn(async () =>
      hit === undefined
        ? { id: "game-1", slug: "phantom-test", name: "Phantom Test", steamAppId: 4115450, igdbId: null, aliases: [], guide: null }
        : hit,
    ),
    ...rest,
  };
  return { api, calls };
}

/** Pages by url: the Steam guide is readable, PowerPyx answers with a bot-protection page. */
const fetchPage: FetchPage = async (url) => {
  if (url === STEAM_GUIDE.url) return { status: "ok", text: STEAM_GUIDE_TEXT, html: STEAM_GUIDE_HTML, finalUrl: url };
  if (url === POWERPYX.url) return { status: "challenge", finalUrl: url, reason: "bot-protection page" };
  return { status: "error", finalUrl: url, reason: "HTTP 404" };
};

/** An Anthropic client no test expects to be called (every AI stage is faked). */
const unusedClient = {
  messages: {
    create: vi.fn(async () => {
      throw new Error("unexpected messages.create");
    }),
    parse: vi.fn(async () => {
      throw new Error("unexpected messages.parse");
    }),
  },
} as unknown as Anthropic;

/** Stages that never reach the network or a model. */
function fakeStages(over: Partial<GuideStages> = {}): Partial<GuideStages> & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const spy = <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    ((...args: A) => {
      (calls[name] ??= []).push(args);
      return fn(...args);
    }) as (...args: A) => R;
  return {
    calls,
    discoverSources: spy("discoverSources", async (_game, deps) => {
      deps.onSearchFailure?.("Phantom Test trophy guide site:psnprofiles.com", new Error("search overloaded"));
      return [POWERPYX, STEAM_GUIDE];
    }),
    extractFacts: spy("extractFacts", async (_page, source) => steamFacts(source)),
    writeAndCheckGuide: spy("writeAndCheckGuide", async () => ({ ok: true as const, payload: writtenPayload() })),
    locateTarget: spy("locateTarget", async () => ({ x: 0.5, y: 0.5, r: 0.1 })),
    composeImage: spy("composeImage", async () => Buffer.from("webp-bytes")),
    findSoundtrack: spy("findSoundtrack", async () => ({ youtubeId: "abcdefghijk", title: "Phantom Test OST", channel: "S-Game" })),
    ...over,
  };
}

function makeDeps(over: Partial<GuidePipelineDeps> = {}): GuidePipelineDeps & { db: GuideDb; lines: string[] } {
  const lines: string[] = [];
  const { api } = fakeApi();
  return {
    api,
    db: openGuideDb(":memory:"),
    client: unusedClient,
    config: { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "claude-sonnet-5-5", MODEL_FAST: "claude-haiku-5-5", GUIDE_BUDGET_USD: 25 },
    fetchPage,
    fetchImage: vi.fn(async () => Buffer.from("jpeg-bytes")),
    now: () => new Date("2026-11-03T12:00:00Z"),
    log: (line) => lines.push(line),
    stages: fakeStages(),
    ...over,
    lines,
  } as GuidePipelineDeps & { db: GuideDb; lines: string[] };
}

const statuses = (calls: Calls) => calls.reports.map((r) => r.body.status);

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe("runGuideRequest", () => {
  it("fila vazia → idle", async () => {
    const { api, calls } = fakeApi({ claimNext: vi.fn(async () => null) });
    const stages = fakeStages();
    const outcome = await runGuideRequest(makeDeps({ api, stages }));
    expect(outcome).toBe("idle");
    expect(calls.reports).toEqual([]);
    expect(stages.calls.discoverSources).toBeUndefined();
  });

  it("gate falha → waiting_sources com report e nada enviado", async () => {
    const { api, calls } = fakeApi();
    // The only source covers no achievement: "The End" has no source.
    const stages = fakeStages({ extractFacts: async (_page, source) => ({ ...fact("x", "roteiro_steam"), source }) });
    const deps = makeDeps({ api, stages });

    const outcome = await runGuideRequest(deps);

    expect(outcome).toBe("waiting_sources");
    expect(statuses(calls)).toEqual(["waiting_sources"]);
    const sent = calls.reports[0]!.body;
    expect(sent.reason).toContain("The End");
    const report = sent.report as { missing: string[]; coverage: unknown; sourcesRead: unknown[] };
    expect(report.missing).toHaveLength(1);
    expect(report.missing[0]).toContain('"The End" (ACH_END)');
    expect(report.coverage).toEqual({ steam: 1, covered: 0, steamOnly: 1 });
    expect(report.sourcesRead).toContainEqual({
      name: "PowerPyx",
      url: POWERPYX.url,
      ok: false,
      reason: expect.stringContaining("desafio"),
    });
    expect(stages.calls.writeAndCheckGuide).toBeUndefined();
    expect(calls.created).toEqual([]);
    expect(calls.patched).toEqual([]);
    expect(calls.uploads).toEqual([]);
    expect(deps.db.getDossier(REQUEST.id)).toBeDefined();
  });

  it("caminho feliz envia guia formato 2 em review e reporta review com guideId", async () => {
    const { api, calls } = fakeApi();
    const stages = fakeStages();
    const deps = makeDeps({ api, stages });

    const outcome = await runGuideRequest(deps);

    expect(outcome).toBe("review");
    expect(statuses(calls)).toEqual(["writing", "review"]);
    expect(calls.reports.at(-1)!.body.guideId).toBe("guide-new");

    // The writer got the raw text of the pages read, for the copy check.
    const writerOpts = stages.calls.writeAndCheckGuide![0]![4] as { sourceTexts: string[] };
    expect(writerOpts.sourceTexts).toEqual([STEAM_GUIDE_TEXT]);

    expect(calls.created).toHaveLength(1);
    const { payload } = calls.created[0]!;
    expect(payload.format).toBe(2);
    expect(payload.status).toBe("review");
    const parsed = guidePayloadSchema.safeParse(payload);
    expect(parsed.error?.issues).toBeUndefined();

    // Image: picked from the Steam guide, third party (never cropped), uploaded as WebP, credited.
    const image = payload.walkthrough.chapters[0]!.steps[0]!.items[0]!.image;
    expect(image).toEqual({
      url: "https://cdn.tralked.com/guias/feather.webp",
      credit: "Imagem: Steam: All Achievements (Ana)",
      sourceName: "Steam: All Achievements (Ana)",
      sourceUrl: STEAM_GUIDE.url,
    });
    expect(stages.calls.composeImage![0]![1]).toMatchObject({ thirdParty: true, target: { x: 0.5, y: 0.5, r: 0.1 } });
    expect(calls.uploads).toEqual([{ contentType: "image/webp", key: expect.stringMatching(/^guia-img-/) }]);
    expect(payload.walkthrough.soundtrack).toEqual({ youtubeId: "abcdefghijk", title: "Phantom Test OST", channel: "S-Game" });
    expect(stages.calls.findSoundtrack![0]![1]).toEqual({ name: "Phantom Test", developer: "S-Game", publisher: "S-Game" });

    // The same report goes with the guide and with the request, in the shape the admin reads.
    const report = payload.report as Record<string, unknown>;
    expect(calls.reports.at(-1)!.body.report).toEqual(report);
    expect(parseReport(report)).toEqual({
      sourcesRead: [
        { name: "Busca: Phantom Test trophy guide site:psnprofiles.com", url: "", ok: false, reason: "search overloaded" },
        { name: "PowerPyx", url: POWERPYX.url, ok: false, reason: expect.stringContaining("desafio") },
        { name: STEAM_GUIDE.name, url: STEAM_GUIDE.url, ok: true, reason: null },
      ],
      divergences: [],
      singleSource: expect.arrayContaining([expect.stringContaining("The End")]),
      coverage: { steam: 1, covered: 1, steamOnly: 1 },
      spendUsd: 0,
    });
  });

  it("teto de gasto → failed", async () => {
    const { api, calls } = fakeApi();
    // Real createAi + guideSpend: every call costs US$ 2 (1M Sonnet input tokens), the cap is US$ 1.
    const facts: LlmFacts = { chapters: [], achievements: [], platform: "steam", complete: true };
    const parse = vi.fn(async () => ({
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
      stop_reason: "end_turn",
      parsed_output: facts,
    }));
    const client = { messages: { parse, create: vi.fn() } } as unknown as Anthropic;
    const second: SourceRef = { ...STEAM_GUIDE, name: "Steam: Outro", url: "https://steamcommunity.com/sharedfiles/filedetails/?id=2" };
    const stages = fakeStages({ discoverSources: async () => [STEAM_GUIDE, second], extractFacts: undefined });
    const pages: FetchPage = async (url) => ({ status: "ok", text: `${STEAM_GUIDE_TEXT} ${url}`, html: "", finalUrl: url });
    const deps = makeDeps({
      api,
      client,
      stages,
      fetchPage: pages,
      config: { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "claude-sonnet-5-5", MODEL_FAST: "claude-haiku-5-5", GUIDE_BUDGET_USD: 1 },
    });

    const outcome = await runGuideRequest(deps);

    expect(outcome).toBe("failed");
    expect(parse).toHaveBeenCalledTimes(1); // the second extraction is refused before calling the model
    expect(statuses(calls)).toEqual(["failed"]);
    expect(calls.reports[0]!.body.reason).toBe("teto de gasto");
    expect((calls.reports[0]!.body.report as { spendUsd: number }).spendUsd).toBe(2);
    expect(calls.created).toEqual([]);
  });

  it("erro no meio nunca deixa o pedido em researching", async () => {
    const { api, calls } = fakeApi();
    const stages = fakeStages({
      writeAndCheckGuide: async () => {
        throw new Error("disco cheio");
      },
    });
    const deps = makeDeps({ api, stages });

    const outcome = await runGuideRequest(deps);

    expect(outcome).toBe("failed");
    expect(statuses(calls)).toEqual(["writing", "failed"]);
    expect(calls.reports.at(-1)!.body.reason).toContain("disco cheio");
    expect(calls.reports.at(-1)!.body.report).toMatchObject({ coverage: { steam: 1, covered: 1 } });
    expect(calls.created).toEqual([]);
    const run = deps.db.raw.prepare("SELECT outcome, finished_at FROM runs WHERE request_id = ?").get(REQUEST.id) as {
      outcome: string;
      finished_at: string | null;
    };
    expect(run.outcome).toBe("failed");
    expect(run.finished_at).not.toBeNull();
  });

  it("erro antes de qualquer etapa também termina em failed", async () => {
    const { api, calls } = fakeApi({
      dossier: vi.fn(async () => {
        throw new TralkedError(500, "internal", "HTTP 500");
      }),
    });
    const outcome = await runGuideRequest(makeDeps({ api }));
    expect(outcome).toBe("failed");
    expect(statuses(calls)).toEqual(["failed"]);
    expect(calls.reports[0]!.body.reason).toContain("HTTP 500");
  });

  it("jogo com guia do robô usa patchGuide", async () => {
    const { api, calls } = fakeApi({
      hit: {
        id: "game-1",
        slug: "phantom-test",
        name: "Phantom Test",
        steamAppId: 4115450,
        igdbId: null,
        aliases: [],
        guide: { id: "guide-old", status: "published", source: "bot" },
      },
    });

    const outcome = await runGuideRequest(makeDeps({ api }));

    expect(outcome).toBe("review");
    expect(calls.created).toEqual([]);
    expect(calls.patched).toHaveLength(1);
    const { id, patch } = calls.patched[0]!;
    expect(id).toBe("guide-old");
    expect(patch).not.toHaveProperty("game");
    expect(patch.status).toBe("review");
    expect(patch.report).toBeDefined();
    expect(guidePatchSchema.safeParse(patch).error?.issues).toBeUndefined();
    expect(calls.reports.at(-1)!.body).toMatchObject({ status: "review", guideId: "guide-old" });
  });

  it("jogo com guia da equipe → failed sem pesquisar", async () => {
    const { api, calls } = fakeApi({
      hit: {
        id: "game-1",
        slug: "phantom-test",
        name: "Phantom Test",
        steamAppId: 4115450,
        igdbId: null,
        aliases: [],
        guide: { id: "guide-human", status: "published", source: null },
      },
    });
    const stages = fakeStages();
    const outcome = await runGuideRequest(makeDeps({ api, stages }));
    expect(outcome).toBe("failed");
    expect(stages.calls.discoverSources).toBeUndefined();
    expect(statuses(calls)).toEqual(["failed"]);
    expect(calls.patched).toEqual([]);
  });

  it("pedido cancelado no site (422) para sem relatar de novo", async () => {
    const reports: string[] = [];
    const { api, calls } = fakeApi({
      reportRequest: vi.fn(async (_id: string, body: GuideRequestReport) => {
        reports.push(body.status);
        throw new TralkedError(422, "validation_failed", "O pedido está cancelado e não aceita mais relatos.");
      }),
    });
    const stages = fakeStages();
    const outcome = await runGuideRequest(makeDeps({ api, stages }));
    expect(outcome).toBe("failed");
    expect(reports).toEqual(["writing"]);
    expect(stages.calls.writeAndCheckGuide).toBeUndefined();
    expect(calls.created).toEqual([]);
  });

  it("a mesma página não é extraída de novo na próxima tentativa", async () => {
    const db = openGuideDb(":memory:");
    const first = fakeStages();
    await runGuideRequest(makeDeps({ db, stages: first }));
    const second = fakeStages();
    await runGuideRequest(makeDeps({ db, stages: second }));
    expect(first.calls.extractFacts).toHaveLength(1);
    expect(second.calls.extractFacts).toBeUndefined();
  });
});

describe("buildReport", () => {
  it("tem o formato que o admin e o selo de compatibilidade leem", () => {
    const report = buildReport({
      sourcesRead: [
        { name: "PowerPyx", url: "https://www.powerpyx.com/x/", ok: true },
        { name: "TSA", url: "https://www.truesteamachievements.com/x", ok: false, reason: "HTTP 403" },
      ],
      steamList: STEAM,
      spendUsd: 1.23456,
      spendByPurpose: { "guia-extracao": 1.23456 },
    });
    expect(report).toMatchObject({
      sourcesRead: [
        { name: "PowerPyx", url: "https://www.powerpyx.com/x/", ok: true },
        { name: "TSA", url: "https://www.truesteamachievements.com/x", ok: false, reason: "HTTP 403" },
      ],
      divergences: [],
      singleSource: [],
      coverage: { steam: 1, covered: 0, steamOnly: 0 },
      spendUsd: 1.2346,
    });
    expect(parseReport(report)).toEqual({
      sourcesRead: [
        { name: "PowerPyx", url: "https://www.powerpyx.com/x/", ok: true, reason: null },
        { name: "TSA", url: "https://www.truesteamachievements.com/x", ok: false, reason: "HTTP 403" },
      ],
      divergences: [],
      singleSource: [],
      coverage: { steam: 1, covered: 0, steamOnly: 0 },
      spendUsd: 1.2346,
    });
  });
});
