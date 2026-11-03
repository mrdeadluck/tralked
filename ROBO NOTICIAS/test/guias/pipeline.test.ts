import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { parseReport } from "@/lib/admin/guide-report";
import { guidePatchSchema, guidePayloadSchema } from "@/lib/content/guide-schema";
import type { GameSearchHit, GuideApi, GuideRequest, GuideRequestReport } from "../../src/guias/api.js";
import type { GuidePayloadV2 } from "../../src/guias/contract.js";
import { openGuideDb, type GuideDb } from "../../src/guias/db.js";
import type { GuideDossier, GuideDossierSource, SteamAchievement } from "../../src/guias/dossier.js";
import type { ExtractedFacts, LlmFacts } from "../../src/guias/facts.js";
import { BudgetExceededError } from "../../src/ai/client.js";
import { extractionKey, runGuideRequest, type GuidePipelineDeps, type GuideStages } from "../../src/guias/pipeline.js";
import { dryRun } from "../../src/guias/dry-run.js";
import { PAGE_TEXT_VERSION } from "../../src/guias/page-text.js";
import { bodyBytes, imageBytes, REPORT_SLACK_BYTES, SITE_LIMITS } from "../../src/guias/limits.js";
import { loadRunContext } from "../../src/guias/run-context.js";
import { buildReport, type RobotReport } from "../../src/guias/report.js";
import type { FetchPage, SourceRef } from "../../src/guias/sources.js";
import { steamAliasUrl } from "../../src/guias/steam-aliases.js";
import { writeAndCheckGuide } from "../../src/guias/writer.js";
import { TralkedError } from "../../src/tralked-http.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";
import { fakeAi } from "./helpers-writer.js";

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
    sleep: async () => {},
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
    const report = sent.report as { missing: string[]; coverage: unknown; sourcesRead: unknown[]; scope: string };
    // Neither scope: the Steam gaps, then why the PSN list could not be used either.
    expect(report.missing).toHaveLength(2);
    expect(report.missing[0]).toContain('"The End" (ACH_END)');
    expect(report.missing[1]).toBe(
      "O guia pela lista da PSN também não sai (1 lacuna): Nenhuma fonte de roteiro da PSN completa traz a lista inteira de troféus (o total e todos os nomes).",
    );
    expect(report.scope).toBe("steam");
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
    const writerOpts = stages.calls.writeAndCheckGuide![0]![4] as { sourceTexts: string[]; scope?: unknown };
    expect(writerOpts.sourceTexts).toEqual([STEAM_GUIDE_TEXT]);
    // The Steam gate passed: the guide covers the Steam list.
    expect(writerOpts.scope).toBeUndefined();

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
    expect(report.scope).toBe("steam");
    expect(report.psnCoverage).toBeUndefined();
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
    const facts: LlmFacts = { chapters: [], achievements: [], platform: "steam", claimsComplete: true, workInProgress: false };
    const parse = vi.fn(async () => ({
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
      stop_reason: "end_turn",
      parsed_output: facts,
    }));
    const client = { messages: { parse, create: vi.fn(), stream: (p: unknown) => ({ finalMessage: () => (parse as (x: unknown) => unknown)(p) }) } } as unknown as Anthropic;
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

  it("toda extração falha por erro do robô → failed 'falha do robô' + alerta, não waiting_sources", async () => {
    const { api, calls } = fakeApi();
    const stages = fakeStages({
      extractFacts: async () => {
        throw new Error("Streaming is required");
      },
    });
    const deps = makeDeps({ api, stages });

    const outcome = await runGuideRequest(deps);

    expect(outcome).toBe("failed");
    expect(statuses(calls)).toEqual(["failed"]);
    expect(calls.reports[0]!.body.reason).toBe("falha do robô: Streaming is required");
    const alerts = deps.db.alerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toContain("falha do robô: Streaming is required");
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

  it("guia russo cita as conquistas pelo nome russo: a lista da Steam em russo (do perfil configurado) faz casar", async () => {
    const REF_ID = "76561197960287930";
    const { api, calls } = fakeApi();
    const ruText = "Конец: пройдите сюжет до финала. Золотое перо: заберитесь на старую башню в первой главе.".repeat(2);
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><playerstats><achievements>' +
      "<achievement><name><![CDATA[Конец]]></name><apiname><![CDATA[ach_end]]></apiname></achievement>" +
      "</achievements></playerstats>";
    const asked: string[] = [];
    const pages: FetchPage = async (url) => {
      asked.push(url);
      if (url === STEAM_GUIDE.url) return { status: "ok", text: ruText, html: STEAM_GUIDE_HTML, finalUrl: url, truncated: true };
      if (url === steamAliasUrl(4115450, "russian", REF_ID)) return { status: "ok", text: "", html: xml, finalUrl: url };
      return { status: "error", finalUrl: url, reason: "HTTP 404" };
    };
    const stages = fakeStages({
      extractFacts: async (_page, source) => ({
        ...fact("x", "roteiro_steam", { achievements: [ach("Конец")], chapters: [chapter("Глава 1", [item("Золотое перо")])] }),
        source,
      }),
    });
    const base = makeDeps();
    const deps = makeDeps({ api, stages, fetchPage: pages, config: { ...base.config, GUIDE_STEAM_REFERENCE_ID: REF_ID } });

    expect(await runGuideRequest(deps)).toBe("review");
    expect(asked).toContain(steamAliasUrl(4115450, "russian", REF_ID));
    const dossier = deps.db.getDossier(REQUEST.id) as GuideDossier;
    expect(dossier.achievements[0]).toMatchObject({ apiName: "ACH_END", sources: [STEAM_GUIDE.name], steamSourced: true });
    const report = calls.reports.at(-1)!.body.report as RobotReport;
    expect(report.sourcesRead).toContainEqual({ name: "Steam: nomes das conquistas (russian)", url: steamAliasUrl(4115450, "russian", REF_ID), ok: true });
    // A page over the text limit is read, and the report says only its start was.
    expect(report.sourcesRead).toContainEqual({
      name: STEAM_GUIDE.name,
      url: STEAM_GUIDE.url,
      ok: true,
      reason: expect.stringContaining("400.000"),
    });
  });
});

describe("scope psn: a Steam não fecha, a lista da PSN do PowerPyx fecha (R22)", () => {
  const STEAM_PLUS: SteamAchievement[] = [...STEAM, steamAch("ACH_ARENA", "Arena Master", "Win every arena fight.")];
  const POWERPYX_TEXT = "PowerPyx roadmap: The End. Golden Feather on the old tower. Lord of the Phantoms at the end.";
  const pages: FetchPage = async (url) =>
    url === POWERPYX.url ? { status: "ok", text: POWERPYX_TEXT, finalUrl: url } : fetchPage(url);
  /** PowerPyx: complete PSN script with the whole trophy list (The End + platinum). */
  const powerpyxFacts = (source: SourceRef): ExtractedFacts => ({
    ...fact("x", "roteiro_psn", {
      trophyListSize: 2,
      achievements: [ach("The End"), ach("Lord of the Phantoms", { grade: "platinum" })],
      chapters: [chapter("Chapter 1", [item("Golden Feather")])],
      roadmap: [{ title: "Story", summary: "Play the story once." }],
    }),
    source,
  });

  function setup(extract: GuideStages["extractFacts"]) {
    const { api, calls } = fakeApi({ dossier: vi.fn(async () => ({ ...DOSSIER_SOURCE, achievements: STEAM_PLUS })) });
    // Cover calls with numbers of this small guide's ficha (0 online, 2 PSN trophies, 1 chapter).
    const writer = fakeAi({
      frame: (out) => {
        out.capa.chamadas = [
          { valor: "0", rotulo: "Online" },
          { valor: "2", rotulo: "Troféus PSN" },
          { valor: "1", rotulo: "Capítulos" },
        ];
      },
    });
    const stages = fakeStages({
      extractFacts: extract,
      // The real writer (fake model): the payload is what the robot would send.
      writeAndCheckGuide: async (_ai, d, src, bucket, opts) => writeAndCheckGuide(writer.ai, d, src, bucket, opts),
    });
    return { api, calls, stages, deps: makeDeps({ api, stages, fetchPage: pages }) };
  }

  it("Steam reprova pela exclusiva sem fonte, a lista inteira da PSN passa → guia scope psn em review", async () => {
    const { calls, deps } = setup(async (_page, source) => (source.url === POWERPYX.url ? powerpyxFacts(source) : steamFacts(source)));
    const outcome = await runGuideRequest(deps);

    expect(outcome).toBe("review");
    expect(calls.created).toHaveLength(1);
    const { payload } = calls.created[0]!;
    const parsed = guidePayloadSchema.safeParse(payload);
    expect(parsed.error?.issues).toBeUndefined();
    expect(payload.walkthrough).toMatchObject({
      scope: "psn",
      psnList: { total: 2, names: ["The End", "Lord of the Phantoms"] },
      steamOnly: ["ACH_ARENA"],
    });
    const items = payload.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
    expect(items.some((i) => i.achievement === "ACH_END")).toBe(true);
    expect(items.some((i) => i.achievement === "ACH_ARENA")).toBe(false);
    expect(payload.report).toMatchObject({ scope: "psn", psnCoverage: { total: 2, covered: 2 } });
    expect(deps.lines.some((l) => l.includes("pela lista da PSN"))).toBe(true);
  });

  it("nem a Steam nem a lista da PSN fecham → waiting_sources com as duas razões", async () => {
    // PowerPyx says the list has 3 trophies but names 2: not the whole list.
    const { calls, deps } = setup(async (_page, source) =>
      source.url === POWERPYX.url ? { ...powerpyxFacts(source), trophyListSize: 3 } : steamFacts(source),
    );
    const outcome = await runGuideRequest(deps);

    expect(outcome).toBe("waiting_sources");
    expect(calls.created).toEqual([]);
    const report = calls.reports.at(-1)!.body.report as { missing: string[]; scope: string };
    expect(report.scope).toBe("steam");
    expect(report.missing).toEqual([
      'A conquista "Arena Master" (ACH_ARENA) da Steam não aparece em nenhuma fonte.',
      "O guia pela lista da PSN também não sai (1 lacuna): Nenhuma fonte de roteiro da PSN completa traz a lista inteira de troféus (o total e todos os nomes).",
    ]);
  });

  it("a lista da PSN existe mas tem lacuna → as duas razões, com a lacuna da PSN", async () => {
    const { calls, deps } = setup(async (_page, source) =>
      source.url === POWERPYX.url
        ? { ...powerpyxFacts(source), trophyListSize: 3, achievements: [...powerpyxFacts(source).achievements, ach("Only On PlayStation")] }
        : steamFacts(source),
    );
    expect(await runGuideRequest(deps)).toBe("waiting_sources");
    const report = calls.reports.at(-1)!.body.report as { missing: string[] };
    expect(report.missing.at(-1)).toBe(
      'O guia pela lista da PSN também não sai (1 lacuna): O troféu "Only On PlayStation" da lista da PSN não casa com nenhuma conquista da Steam.',
    );
  });
});

describe("erro interno do escritor", () => {
  it("a ordem errada feita pelo código vai para o relatório como erro interno e o guia segue para revisão", async () => {
    const { api, calls } = fakeApi();
    const stages = fakeStages({
      writeAndCheckGuide: async () => ({ ok: true as const, payload: writtenPayload(), internalErrors: ["O capítulo x veio depois de y."] }),
    });
    const deps = makeDeps({ api, stages });
    expect(await runGuideRequest(deps)).toBe("review");
    expect(calls.created[0]!.payload.report).toMatchObject({ internalErrors: ["O capítulo x veio depois de y."] });
    expect(deps.lines.some((l) => l.includes("erro interno") && l.includes("O capítulo x veio depois de y."))).toBe(true);
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
      scope: "steam",
    });
    expect(report.psnCoverage).toBeUndefined();
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

describe("pedido nunca preso em researching / writing (I1)", () => {
  it("erro ao montar a execução (modelo sem preço) também termina em failed", async () => {
    const { api, calls } = fakeApi();
    const deps = makeDeps({
      api,
      config: { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "modelo-sem-preco", MODEL_FAST: "claude-haiku-5-5", GUIDE_BUDGET_USD: 25 },
    });
    expect(await runGuideRequest(deps)).toBe("failed");
    expect(statuses(calls)).toEqual(["failed"]);
    expect(calls.reports[0]!.body.reason).toContain("No price configured");
  });

  it("o relato final é tentado de novo, com a mesma chave, quando o site falha", async () => {
    let failures = 0;
    const keys: string[] = [];
    const { api } = fakeApi({
      reportRequest: vi.fn(async (_id: string, body: GuideRequestReport, key: string) => {
        keys.push(key);
        if (body.status === "waiting_sources" && failures < 2) {
          failures++;
          throw new Error("fetch failed");
        }
      }),
    });
    const stages = fakeStages({ extractFacts: async (_page, source) => ({ ...fact("x", "roteiro_steam"), source }) });
    const sleeps: number[] = [];
    const deps = makeDeps({ api, stages, sleep: async (ms) => void sleeps.push(ms) });
    expect(await runGuideRequest(deps)).toBe("waiting_sources");
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(sleeps).toEqual([2_000, 10_000]);
  });

  it("prazo suave: passou depois de escrever → o guia sai sem imagens e sem trilha, e o relatório diz", async () => {
    const { api, calls } = fakeApi();
    let t = Date.parse("2026-11-03T12:00:00Z");
    const stages = fakeStages({
      writeAndCheckGuide: async () => {
        t += 151 * 60_000;
        return { ok: true as const, payload: writtenPayload() };
      },
    });
    const deps = makeDeps({ api, stages, now: () => new Date(t) });
    expect(await runGuideRequest(deps)).toBe("review");
    const { payload } = calls.created[0]!;
    expect(stages.calls.locateTarget).toBeUndefined();
    expect(stages.calls.findSoundtrack).toBeUndefined();
    expect(payload.walkthrough.soundtrack).toBeUndefined();
    expect((payload.report as RobotReport).notes).toEqual(["o prazo de 150 min passou depois de escrever: o guia saiu sem imagens e sem trilha sonora"]);
    expect(calls.reports.at(-1)!.body.report).toMatchObject({ notes: (payload.report as RobotReport).notes });
  });
});

describe("teto de gasto depois do guia escrito (I3)", () => {
  it("nas imagens: para as imagens e envia o guia, com a nota", async () => {
    const { api, calls } = fakeApi();
    const stages = fakeStages({
      locateTarget: async () => {
        throw new BudgetExceededError("backfill", 25.1, 25);
      },
    });
    const deps = makeDeps({ api, stages });
    expect(await runGuideRequest(deps)).toBe("review");
    expect(calls.created).toHaveLength(1);
    const { payload } = calls.created[0]!;
    expect(payload.walkthrough.chapters[0]!.steps[0]!.items[0]!.image).toBeUndefined();
    expect((payload.report as RobotReport).notes).toEqual([expect.stringContaining("teto de gasto atingido nas imagens")]);
    expect(statuses(calls)).toEqual(["writing", "review"]);
  });

  it("na trilha sonora: envia o guia sem música, com a nota", async () => {
    const { api, calls } = fakeApi();
    const stages = fakeStages({
      findSoundtrack: async () => {
        throw new BudgetExceededError("backfill", 25.1, 25);
      },
    });
    expect(await runGuideRequest(makeDeps({ api, stages }))).toBe("review");
    const { payload } = calls.created[0]!;
    expect(payload.walkthrough.soundtrack).toBeUndefined();
    expect((payload.report as RobotReport).notes).toEqual(["teto de gasto atingido na busca da trilha sonora: o guia saiu sem música"]);
  });
});

describe("limites do site antes de gastar com a escrita (C2)", () => {
  it("guia com mais de 60 capítulos: failed com o motivo, sem escrever", async () => {
    const { api, calls } = fakeApi();
    const stages = fakeStages({
      extractFacts: async (_page, source) => ({
        ...fact("x", "roteiro_steam", {
          achievements: [ach("The End")],
          chapters: Array.from({ length: 61 }, (_, i) => chapter(`Capítulo ${i + 1}`, [item(`Item ${i + 1}`)], i + 1)),
        }),
        source,
      }),
    });
    expect(await runGuideRequest(makeDeps({ api, stages }))).toBe("failed");
    expect(stages.calls.writeAndCheckGuide).toBeUndefined();
    expect(statuses(calls)).toEqual(["failed"]);
    expect(calls.reports[0]!.body.reason).toBe("o guia não cabe nos limites do site: O guia teria 62 capítulos; o site aceita até 60.");
  });

  it("corpo final acima de 1 MiB mesmo sem imagens: failed, nada enviado", async () => {
    const { api, calls } = fakeApi();
    const huge = writtenPayload();
    huge.walkthrough.chapters[0]!.steps[0]!.items[0]!.location = "x".repeat(1_100_000);
    const stages = fakeStages({ writeAndCheckGuide: async () => ({ ok: true as const, payload: huge }) });
    expect(await runGuideRequest(makeDeps({ api, stages }))).toBe("failed");
    expect(calls.created).toEqual([]);
    expect(calls.reports.at(-1)!.body.reason).toMatch(/^o guia ficaria com \d+ KiB e o site aceita até 1024 KiB \(1 MiB\) por envio$/);
  });
});

describe("pequenos consertos do pipeline", () => {
  it("cache de extração corrompido: extrai de novo em vez de marcar a página como não lida", async () => {
    const db = openGuideDb(":memory:");
    const key = extractionKey("claude-sonnet-5-5", STEAM_GUIDE, STEAM_GUIDE_TEXT);
    db.setMeta(key, "{corrompido");
    const stages = fakeStages();
    expect(await runGuideRequest(makeDeps({ db, stages }))).toBe("review");
    expect(stages.calls.extractFacts).toHaveLength(1);
    expect(() => JSON.parse(db.getMeta(key)!)).not.toThrow();
  });

  it("nome de fonte e textos do oEmbed com '<' saem como texto puro, dentro dos limites do site", async () => {
    const { api, calls } = fakeApi();
    const odd: SourceRef = { ...STEAM_GUIDE, name: `Steam: <Mod> ${"Guia ".repeat(40)}` };
    const stages = fakeStages({
      discoverSources: async () => [odd],
      findSoundtrack: async () => ({ youtubeId: "abcdefghijk", title: `<b>OST</b> ${"x".repeat(200)}`, channel: "S-Game <official>" }),
    });
    expect(await runGuideRequest(makeDeps({ api, stages }))).toBe("review");
    const { payload } = calls.created[0]!;
    const image = payload.walkthrough.chapters[0]!.steps[0]!.items[0]!.image!;
    expect(image.credit).not.toMatch(/<[A-Za-z]/);
    expect(image.sourceName.length).toBeLessThanOrEqual(120);
    expect(payload.walkthrough.soundtrack!.title.length).toBeLessThanOrEqual(120);
    expect(payload.walkthrough.soundtrack!.channel).not.toMatch(/<[A-Za-z]/);
    expect(guidePayloadSchema.safeParse(payload).error?.issues).toBeUndefined();
  });

  it("guarda o contexto do pedido (fontes e lista da Steam) para o ensaio", async () => {
    const deps = makeDeps();
    await runGuideRequest(deps);
    expect(loadRunContext(deps.db, REQUEST.id)).toMatchObject({
      requestId: REQUEST.id,
      steamAppId: REQUEST.steamAppId,
      gameSlug: "phantom-test",
      sources: [POWERPYX, STEAM_GUIDE],
      steamList: STEAM,
    });
  });
});

describe("Task 17: escrita em cache e confiabilidade", () => {
  it("a escrita aprovada fica no cache: outra tentativa do mesmo jogo reaproveita sem chamar a IA, e o ensaio mostra", async () => {
    const db = openGuideDb(":memory:");
    const first = fakeStages();
    const one = fakeApi();
    expect(await runGuideRequest(makeDeps({ db, api: one.api, stages: first }))).toBe("review");
    expect(first.calls.writeAndCheckGuide).toHaveLength(1);

    const second = fakeStages();
    const two = fakeApi({ claimNext: vi.fn(async () => ({ ...REQUEST, id: "req-2" })) });
    expect(await runGuideRequest(makeDeps({ db, api: two.api, stages: second }))).toBe("review");
    expect(second.calls.writeAndCheckGuide).toBeUndefined();
    const { payload } = two.calls.created[0]!;
    expect((payload.report as RobotReport).notes).toContain("escrita reaproveitada do cache");
    // Images and soundtrack are per send: the media URLs belong to each site.
    expect(second.calls.findSoundtrack).toHaveLength(1);
    expect(payload.walkthrough.chapters[0]!.steps[0]!.items[0]!.image).toBeDefined();

    // The dry run sees it (the page it read must be in the cache: the fake fetch does not store pages).
    db.savePage({ url: STEAM_GUIDE.url, fetchedAt: new Date(), status: "ok", finalUrl: STEAM_GUIDE.url, text: STEAM_GUIDE_TEXT, html: STEAM_GUIDE_HTML, textVersion: PAGE_TEXT_VERSION });
    const lines: string[] = [];
    await dryRun({ db, config: { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "claude-sonnet-5-5", MODEL_FAST: "claude-haiku-5-5", GUIDE_STEAM_REFERENCE_ID: "76561198012210783" }, requestId: "req-2", log: (l) => lines.push(l) });
    expect(lines).toContainEqual(expect.stringMatching(/^escrita reaproveitável do cache: sim/));
  });

  it("prazo suave já passou antes da escrita: failed 'tempo esgotado antes da escrita', sem escrever", async () => {
    const { api, calls } = fakeApi();
    let t = Date.parse("2026-11-03T12:00:00Z");
    const stages = fakeStages({
      extractFacts: async (_page, source) => {
        t += 151 * 60_000;
        return steamFacts(source);
      },
    });
    expect(await runGuideRequest(makeDeps({ api, stages, now: () => new Date(t) }))).toBe("failed");
    expect(stages.calls.writeAndCheckGuide).toBeUndefined();
    expect(statuses(calls)).toEqual(["failed"]);
    expect(calls.reports[0]!.body.reason).toBe("tempo esgotado antes da escrita");
  });

  it("relato final recusado com 422 e issues: não repete", async () => {
    let tries = 0;
    const { api } = fakeApi({
      reportRequest: vi.fn(async (_id: string, body: GuideRequestReport) => {
        if (body.status !== "waiting_sources") return;
        tries++;
        throw new TralkedError(422, "validation_failed", "relatório inválido", [{ path: "report", message: "muito grande" }]);
      }),
    });
    const stages = fakeStages({ extractFacts: async (_page, source) => ({ ...fact("x", "roteiro_steam"), source }) });
    const sleeps: number[] = [];
    expect(await runGuideRequest(makeDeps({ api, stages, sleep: async (ms) => void sleeps.push(ms) }))).toBe("waiting_sources");
    expect(tries).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe("Task 17 fix round 1", () => {
  it("imagens decididas depois da escrita pelo tamanho real: sem espaço, nenhuma busca nem envio, e o guia sai", async () => {
    // The guide's size without images, measured once.
    const probe = fakeApi();
    await runGuideRequest(makeDeps({ api: probe.api, stages: fakeStages({ pickItemImage: () => null }) }));
    const bare = bodyBytes(probe.calls.created[0]!.payload);

    const { api, calls } = fakeApi();
    const full = writtenPayload();
    // Room for the text, not for one image more.
    full.walkthrough.chapters[0]!.steps[0]!.items[0]!.location = `Topo da torre velha${"x".repeat(SITE_LIMITS.bodyBytes - bare - REPORT_SLACK_BYTES / 2)}`;
    const stages = fakeStages({ writeAndCheckGuide: async () => ({ ok: true as const, payload: full }) });
    const deps = makeDeps({ api, stages });
    expect(await runGuideRequest(deps)).toBe("review");
    expect(stages.calls.locateTarget).toBeUndefined();
    expect(calls.uploads).toEqual([]);
    expect(calls.created).toHaveLength(1);
    expect((calls.created[0]!.payload.report as RobotReport).notes).toContainEqual(expect.stringContaining("sem espaço para imagens"));
  });

  it("imagens: as perdíveis primeiro, e a busca para quando o orçamento de tamanho acaba", async () => {
    /** A guide of two items (the second missable), with `pad` more characters of text, and what it sent. */
    const send = async (pad: number, withImages = true) => {
      const { api, calls } = fakeApi();
      const payload = writtenPayload();
      const step = payload.walkthrough.chapters[0]!.steps[0]!;
      const base = step.items[0]!;
      step.items = [
        { ...base, key: "comum", name: "Comum", nameEn: "Plain", location: `Comum ${"x".repeat(pad)}` },
        { ...base, key: "perdivel", name: "Perdível", nameEn: "Lost", missable: true },
      ];
      const located: string[] = [];
      const stages = fakeStages({
        writeAndCheckGuide: async () => ({ ok: true as const, payload }),
        pickItemImage: (item) =>
          withImages ? { url: `https://images.example/${item.nameEn}.jpg`, sourceName: "Wiki", sourceUrl: "https://wiki.example/x", thirdParty: true } : null,
        locateTarget: async (_ai, _bytes, name) => {
          located.push(name);
          return { x: 0.5, y: 0.5, r: 0.1 };
        },
      });
      expect(await runGuideRequest(makeDeps({ api, stages }))).toBe("review");
      return { located, bytes: bodyBytes(calls.created[0]!.payload) };
    };
    // Plenty of room: both, the missable first.
    const both = await send(0);
    expect(both.located).toEqual(["Lost", "Plain"]);
    const none = await send(0, false);
    const perImage = (both.bytes - none.bytes) / 2;
    // Room for the first image (as the robot estimates it) and half of a second: only the missable's is fetched.
    const estimate = imageBytes({ credit: "Imagem: Wiki", sourceName: "Wiki", sourceUrl: "https://wiki.example/x" });
    const pad = SITE_LIMITS.bodyBytes - REPORT_SLACK_BYTES - none.bytes - estimate - Math.round(perImage / 2);
    expect((await send(pad)).located).toEqual(["Lost"]);
  });

  it("escrita no cache é de graça: o prazo flexível passado não impede reaproveitar", async () => {
    const db = openGuideDb(":memory:");
    await runGuideRequest(makeDeps({ db, stages: fakeStages() }));
    let t = Date.parse("2026-11-03T12:00:00Z");
    const stages = fakeStages({
      discoverSources: async () => {
        t += 151 * 60_000;
        return [POWERPYX, STEAM_GUIDE];
      },
    });
    const { api, calls } = fakeApi({ claimNext: vi.fn(async () => ({ ...REQUEST, id: "req-3" })) });
    expect(await runGuideRequest(makeDeps({ db, api, stages, now: () => new Date(t) }))).toBe("review");
    expect(stages.calls.writeAndCheckGuide).toBeUndefined();
    expect(calls.created).toHaveLength(1);
  });
});
