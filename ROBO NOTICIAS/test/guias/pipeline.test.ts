import type Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { imageUsed } from "../../src/guias/images.js";
import { loadRunContext } from "../../src/guias/run-context.js";
import { buildReport, type RobotReport } from "../../src/guias/report.js";
import type { FetchPage, SourceRef } from "../../src/guias/sources.js";
import { steamAliasUrl, steamProfileXmlUrl } from "../../src/guias/steam-aliases.js";
import type { GuideProblem } from "../../src/guias/checker.js";
import { latestDraft } from "../../src/guias/drafts.js";
import { writeAndCheckGuide, type DraftRound, type SavedTexts, type WriteAndCheckOpts } from "../../src/guias/writer.js";
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
    config: { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "claude-sonnet-5-5", MODEL_FAST: "claude-haiku-5-5", MODEL_CHECK: "claude-sonnet-5-5", CHECK_EFFORT: "high", GUIDE_BUDGET_USD: 25 },
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
    const report = sent.report as { missing: string[]; coverage: unknown; sourcesRead: unknown[]; scope: string | null };
    // Neither scope: the Steam gaps, then why the PSN list could not be used either.
    expect(report.missing).toHaveLength(2);
    expect(report.missing[0]).toContain('"The End" (ACH_END)');
    expect(report.missing[1]).toBe(
      "O guia pela lista da PSN também não sai (1 lacuna): Nenhuma fonte de roteiro da PSN completa traz a lista inteira de troféus (o total e todos os nomes).",
    );
    // Neither gate passed: no scope was chosen (F).
    expect(report.scope).toBeNull();
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
    const writerOpts = stages.calls.writeAndCheckGuide![0]![4] as { sourceTexts: string[]; scope?: unknown; pages?: { url: string; name: string; text: string }[] };
    expect(writerOpts.sourceTexts).toEqual([STEAM_GUIDE_TEXT]);
    // Task 5: and the pages themselves (url, name, text), for the excerpts of each item.
    expect(writerOpts.pages).toEqual([expect.objectContaining({ text: STEAM_GUIDE_TEXT, url: expect.stringMatching(/^https:/), name: expect.any(String) })]);
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
      config: { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "claude-sonnet-5-5", MODEL_FAST: "claude-haiku-5-5", MODEL_CHECK: "claude-sonnet-5-5", CHECK_EFFORT: "high", GUIDE_BUDGET_USD: 1 },
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
      if (url === steamProfileXmlUrl(4115450, "russian", REF_ID)) return { status: "ok", text: "", html: xml, finalUrl: url };
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
    // The game's public achievement page first (404 here), then the configured profile's XML.
    expect(asked).toContain(steamAliasUrl(4115450, "russian"));
    expect(asked).toContain(steamProfileXmlUrl(4115450, "russian", REF_ID));
    const dossier = deps.db.getDossier(REQUEST.id) as GuideDossier;
    expect(dossier.achievements[0]).toMatchObject({ apiName: "ACH_END", sources: [STEAM_GUIDE.name], steamSourced: true });
    const report = calls.reports.at(-1)!.body.report as RobotReport;
    expect(report.sourcesRead).toContainEqual({ name: "Steam: nomes das conquistas (russian)", url: steamProfileXmlUrl(4115450, "russian", REF_ID), ok: true });
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
    const report = calls.reports.at(-1)!.body.report as { missing: string[]; scope: string | null };
    // Neither gate passed: no scope was chosen (F).
    expect(report.scope).toBeNull();
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

  describe("Task 25 revisão 1: uma atualização não reenvia o guia pela lista da PSN", () => {
    const botGuide = { id: "guide-bot", source: "bot", status: "published" } as unknown as NonNullable<GameSearchHit["guide"]>;
    const hit: GameSearchHit = { id: "game-1", slug: "phantom-test", name: "Phantom Test", steamAppId: 4115450, igdbId: null, aliases: [], guide: botGuide };
    const extract: GuideStages["extractFacts"] = async (_page, source) => (source.url === POWERPYX.url ? powerpyxFacts(source) : steamFacts(source));
    const run = (direct?: GuidePipelineDeps["direct"]) => {
      const { api, calls } = fakeApi({ hit, dossier: vi.fn(async () => ({ ...DOSSIER_SOURCE, achievements: STEAM_PLUS })) });
      const stages = fakeStages({ extractFacts: extract });
      const deps = makeDeps({ api, stages, fetchPage: pages, ...(direct ? { direct } : {}) });
      return { api, calls, stages, deps };
    };

    it("--atualizar, Steam reprova e PSN aprova → para antes da escrita: nenhuma chamada ao escritor, nenhum PATCH", async () => {
      const { calls, stages, deps } = run({ appId: 4115450, update: true });
      expect(await runGuideRequest(deps)).toBe("waiting_sources");
      expect(stages.calls.writeAndCheckGuide).toBeUndefined();
      expect(calls.patched).toEqual([]);
      expect(calls.created).toEqual([]);
      expect(deps.lines.some((l) => l.includes("o gate da Steam não passou; a atualização não reenvia o guia pela lista da PSN"))).toBe(true);
    });

    it("pedido da fila para um jogo com guia do robô: o mesmo, com as lacunas da Steam no relato", async () => {
      const { calls, stages, deps } = run();
      expect(await runGuideRequest(deps)).toBe("waiting_sources");
      expect(stages.calls.writeAndCheckGuide).toBeUndefined();
      expect(calls.patched).toEqual([]);
      const last = calls.reports.at(-1)!.body;
      expect(last.reason).toContain("a atualização não reenvia o guia pela lista da PSN");
      expect((last.report as { missing: string[] }).missing).toContain('A conquista "Arena Master" (ACH_ARENA) da Steam não aparece em nenhuma fonte.');
    });

    it("--atualizar-psn: de propósito, a atualização sai pela lista da PSN", async () => {
      const { calls, stages, deps } = run({ appId: 4115450, update: true, updatePsn: true });
      expect(await runGuideRequest(deps)).toBe("review");
      expect(stages.calls.writeAndCheckGuide).toHaveLength(1);
      expect(calls.patched).toHaveLength(1);
    });
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

describe("buildReport: escopo", () => {
  it("nenhum escopo escolhido (os dois gates falharam) → scope null, que o admin lê como antes", () => {
    const report = buildReport({ sourcesRead: [], steamList: STEAM, spendUsd: 0, scope: null });
    expect(report.scope).toBeNull();
    expect(parseReport(report)).not.toHaveProperty("psnScope");
  });
});

describe("cache da descoberta (E): a busca na web não é paga de novo por 7 dias", () => {
  const SAVED_AT = "2026-11-01T12:00:00.000Z";
  const saved = (db: GuideDb, requestId: string, savedAt = SAVED_AT) =>
    db.setMeta(
      `guia-contexto:${requestId}`,
      JSON.stringify({ requestId, steamAppId: 4115450, gameSlug: "phantom-test", game: DOSSIER_SOURCE.game, steamList: STEAM, sources: [STEAM_GUIDE], savedAt }),
    );

  it("tentativa nova do mesmo pedido, descoberta de 2 dias atrás → reaproveita as fontes, sem busca", async () => {
    const db = openGuideDb(":memory:");
    saved(db, REQUEST.id);
    const stages = fakeStages();
    const deps = makeDeps({ db, stages });
    expect(await runGuideRequest(deps)).toBe("review");
    expect(stages.calls.discoverSources).toBeUndefined();
    expect(stages.calls.extractFacts).toHaveLength(1);
    expect(deps.lines.some((l) => l.includes("fontes da descoberta reaproveitadas") && l.includes(SAVED_AT))).toBe(true);
    // The saved context keeps the discovery's date: the cache still expires 7 days after the search.
    expect(loadRunContext(db, REQUEST.id)!.savedAt).toBe(SAVED_AT);
  });

  it("outro pedido do mesmo jogo também reaproveita (e ganha o contexto para o ensaio)", async () => {
    const db = openGuideDb(":memory:");
    saved(db, "req-antigo");
    const stages = fakeStages();
    await runGuideRequest(makeDeps({ db, stages }));
    expect(stages.calls.discoverSources).toBeUndefined();
    expect(loadRunContext(db, REQUEST.id)).toMatchObject({ requestId: REQUEST.id, sources: [STEAM_GUIDE], savedAt: SAVED_AT });
  });

  it("descoberta com mais de 7 dias → busca de novo", async () => {
    const db = openGuideDb(":memory:");
    saved(db, REQUEST.id, "2026-10-27T11:59:00.000Z");
    const stages = fakeStages();
    await runGuideRequest(makeDeps({ db, stages }));
    expect(stages.calls.discoverSources).toHaveLength(1);
    expect(loadRunContext(db, REQUEST.id)!.savedAt).toBe("2026-11-03T12:00:00.000Z");
  });

  it("GUIDE_FORCE_DISCOVERY → busca de novo mesmo com a descoberta recente", async () => {
    const db = openGuideDb(":memory:");
    saved(db, REQUEST.id);
    const stages = fakeStages();
    const base = makeDeps();
    await runGuideRequest(makeDeps({ db, stages, config: { ...base.config, GUIDE_FORCE_DISCOVERY: true } }));
    expect(stages.calls.discoverSources).toHaveLength(1);
  });
});

describe("pedido nunca preso em researching / writing (I1)", () => {
  it("erro ao montar a execução (modelo sem preço) também termina em failed", async () => {
    const { api, calls } = fakeApi();
    const deps = makeDeps({
      api,
      config: { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "modelo-sem-preco", MODEL_FAST: "claude-haiku-5-5", MODEL_CHECK: "claude-sonnet-5-5", CHECK_EFFORT: "high", GUIDE_BUDGET_USD: 25 },
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

describe("localização da imagem falhou", () => {
  it("a imagem vai sem a marcação do item, não fica de fora", async () => {
    const { api, calls } = fakeApi();
    const stages = fakeStages({
      locateTarget: async () => {
        throw new Error("No structured output for guia-locate (stop_reason max_tokens)");
      },
    });
    const deps = makeDeps({ api, stages });
    expect(await runGuideRequest(deps)).toBe("review");
    const { payload } = calls.created[0]!;
    expect(payload.walkthrough.chapters[0]!.steps[0]!.items[0]!.image).toMatchObject({ url: "https://cdn.tralked.com/guias/feather.webp" });
    expect(stages.calls.composeImage![0]![1]).toMatchObject({ target: null });
    expect(deps.lines).toContainEqual(expect.stringContaining("sem a marcação do item (a localização falhou)"));
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
    await dryRun({ db, config: { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "claude-sonnet-5-5", MODEL_FAST: "claude-haiku-5-5", MODEL_CHECK: "claude-sonnet-5-5", CHECK_EFFORT: "high", GUIDE_STEAM_REFERENCE_ID: "76561198012210783" }, requestId: "req-2", log: (l) => lines.push(l) });
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
      // Each image its own bytes (the same bytes twice would be one picture: Task 28).
      expect(await runGuideRequest(makeDeps({ api, stages, fetchImage: async (url) => Buffer.from(url) }))).toBe("review");
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

describe("Task 19: modo direto por appid, sem pedido na fila", () => {
  const direct = { appId: 4115450, update: false };
  const botGuide = { id: "guide-bot", source: "bot", status: "published" } as unknown as NonNullable<GameSearchHit["guide"]>;
  const hitWith = (guide: GameSearchHit["guide"]): GameSearchHit => ({
    id: "game-1",
    slug: "phantom-test",
    name: "Phantom Test",
    steamAppId: 4115450,
    igdbId: null,
    aliases: [],
    guide,
  });

  it("caminho feliz: createGuide em review, sem claimNext nem reportRequest", async () => {
    const { api, calls } = fakeApi();
    const deps = makeDeps({ api, direct });

    const outcome = await runGuideRequest(deps);

    expect(outcome).toBe("review");
    expect(api.claimNext).not.toHaveBeenCalled();
    expect(api.reportRequest).not.toHaveBeenCalled();
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]!.payload.status).toBe("review");
    expect(calls.created[0]!.key).toContain("direto-4115450");
    expect(deps.lines.some((l) => l.includes('[direto] relato "review"'))).toBe(true);
    expect(deps.lines.some((l) => l.includes("direto-4115450 → review"))).toBe(true);
    expect(deps.db.getDossier("direto-4115450")).toBeDefined();
  });

  it("jogo ausente → failed com mensagem clara, nada criado", async () => {
    const { api, calls } = fakeApi({ hit: null });
    const deps = makeDeps({ api, direct });
    expect(await runGuideRequest(deps)).toBe("failed");
    expect(api.reportRequest).not.toHaveBeenCalled();
    expect(calls.created).toEqual([]);
    expect(deps.lines.some((l) => l.includes("o jogo não está no catálogo do site"))).toBe(true);
  });

  it("guia do robô já existente sem --atualizar → recusado; com --atualizar → patchGuide", async () => {
    const refused = fakeApi({ hit: hitWith(botGuide) });
    const depsA = makeDeps({ api: refused.api, direct });
    expect(await runGuideRequest(depsA)).toBe("failed");
    expect(depsA.lines.some((l) => l.includes("--atualizar"))).toBe(true);
    expect(refused.calls.created).toEqual([]);
    expect(refused.calls.patched).toEqual([]);

    const updated = fakeApi({ hit: hitWith(botGuide) });
    const depsB = makeDeps({ api: updated.api, direct: { appId: 4115450, update: true } });
    expect(await runGuideRequest(depsB)).toBe("review");
    expect(updated.calls.patched).toHaveLength(1);
    expect(updated.calls.created).toEqual([]);
  });

  it("guia editorial → recusado mesmo com --atualizar", async () => {
    const { api, calls } = fakeApi({ hit: hitWith({ ...botGuide, source: "editorial" } as never) });
    const deps = makeDeps({ api, direct: { appId: 4115450, update: true } });
    expect(await runGuideRequest(deps)).toBe("failed");
    expect(calls.patched).toEqual([]);
    expect(deps.lines.some((l) => l.includes("guia feito pela equipe"))).toBe(true);
  });

  it("teto de gasto vale para direto-<appid>, contando o gasto anterior", async () => {
    const { api, calls } = fakeApi();
    const db = openGuideDb(":memory:");
    db.recordSpend("direto-4115450", "extract", "claude-sonnet-5-5", 1, new Date("2026-11-02T12:00:00Z"));
    const facts: LlmFacts = { chapters: [], achievements: [], platform: "steam", claimsComplete: true, workInProgress: false };
    const parse = vi.fn(async () => ({
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
      stop_reason: "end_turn",
      parsed_output: facts,
    }));
    const client = { messages: { parse, create: vi.fn(), stream: (p: unknown) => ({ finalMessage: () => (parse as (x: unknown) => unknown)(p) }) } } as unknown as Anthropic;
    const deps = makeDeps({
      api,
      db,
      client,
      direct,
      stages: fakeStages({ discoverSources: async () => [STEAM_GUIDE], extractFacts: undefined }),
      config: { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "claude-sonnet-5-5", MODEL_FAST: "claude-haiku-5-5", MODEL_CHECK: "claude-sonnet-5-5", CHECK_EFFORT: "high", GUIDE_BUDGET_USD: 1 },
    });

    expect(await runGuideRequest(deps)).toBe("failed");
    expect(parse).not.toHaveBeenCalled(); // US$ 1 already spent under direto-4115450 = the cap: the first extraction is refused
    expect(deps.lines.some((l) => l.includes("teto de gasto"))).toBe(true);
    expect(calls.created).toEqual([]);
  });
});

describe("Task 20: nenhuma escrita paga se perde", () => {
  const direct = { appId: 4115450, update: false };
  const tempDb = () => openGuideDb(mkdtempSync(join(tmpdir(), "guias-t20-")));
  const scoped = (n: number): GuideProblem[] =>
    Array.from({ length: n }, (_, i) => ({ text: `Problema ${i + 1} do trecho.`, scope: i % 2 ? "cap-2" : "cap-1", kind: "checador" as const }));
  const savedTexts: SavedTexts = { frame: null, jobs: { "cap-1": { passos: [], itens: [], depois: null } } };
  /** A writer stage that fails the check, reporting its rounds like the real one. */
  const failingWriter = (problems: GuideProblem[], texts: SavedTexts = savedTexts) =>
    vi.fn(async (_ai, _d, _g, _b, opts) => {
      const draft: DraftRound = {
        round: 2,
        ok: false,
        probe: Boolean(opts?.probe),
        texts,
        payload: writtenPayload(),
        problems,
        repairs: [
          { text: "O sistema pôs a conquista X.", scope: "cap-1", kind: "nota" },
          { text: "O chefe é o do dossiê.", scope: "cap-1", kind: "checador-correto" },
        ],
        internalErrors: [],
        pending: [],
      };
      opts?.onRound?.(draft);
      return { ok: false as const, problems: problems.map((p) => p.text), payload: writtenPayload(), draft };
    }) as unknown as GuideStages["writeAndCheckGuide"] & { mock: { calls: unknown[][] } };

  it("checador recusa → rascunho salvo no banco e relatório com problemas (escopo e tipo) em relatorios/", async () => {
    const { api, calls } = fakeApi();
    const db = tempDb();
    const deps = makeDeps({ api, db, stages: fakeStages({ writeAndCheckGuide: failingWriter(scoped(3)) }) });

    expect(await runGuideRequest(deps)).toBe("failed");

    const draft = latestDraft(db, REQUEST.id)!;
    expect(draft).toMatchObject({ attempt: 1, round: 2, ok: false });
    expect(draft.problems).toEqual(scoped(3));
    expect(draft.repairs[0]!.kind).toBe("nota");
    expect(draft.texts).toEqual(savedTexts);
    const file = JSON.parse(readFileSync(join(db.dir, "relatorios", `${REQUEST.id}-1.json`), "utf8"));
    expect(file).toMatchObject({ requestId: REQUEST.id, attempt: 1, status: "failed" });
    expect(file.problems).toEqual(scoped(3));
    // Task 21 review: what the checker listed as right is in the report file too (audit), never a problem.
    expect(file.repairs).toEqual([
      { text: "O sistema pôs a conquista X.", scope: "cap-1", kind: "nota" },
      { text: "O chefe é o do dossiê.", scope: "cap-1", kind: "checador-correto" },
    ]);
    expect(draft.repairs[1]!.kind).toBe("checador-correto");
    expect(file.report.problems).toEqual(scoped(3).map((p) => p.text));
    // The queue mode still sends the problems to the site.
    expect((calls.reports.at(-1)!.body.report as RobotReport).problems).toEqual(scoped(3).map((p) => p.text));
  });

  it("modo direto imprime os 30 primeiros problemas e o caminho do arquivo; cada execução é uma tentativa nova", async () => {
    const db = tempDb();
    const stages = fakeStages({ writeAndCheckGuide: failingWriter(scoped(35)) });
    const first = makeDeps({ db, direct, stages });
    await runGuideRequest(first);
    const printed = first.lines.join("\n");
    expect(printed).toContain("Problema 30 do trecho.");
    expect(printed).not.toContain("Problema 31 do trecho.");
    expect(printed).toContain("(e mais 5)");
    expect(printed).toContain("[cap-2] (checador) Problema 2 do trecho.");
    expect(printed).toContain(join(db.dir, "relatorios", "direto-4115450-1.json"));

    const second = makeDeps({ db, direct, stages });
    await runGuideRequest(second);
    expect(second.lines[0]).toContain("tentativa 2");
    expect(second.lines.join("\n")).toContain(join(db.dir, "relatorios", "direto-4115450-2.json"));
  });

  it("uma escrita sem rodadas informadas (estágio falso) ainda é salva como rascunho", async () => {
    const db = openGuideDb(":memory:");
    const deps = makeDeps({ db });
    expect(await runGuideRequest(deps)).toBe("review");
    expect(latestDraft(db, REQUEST.id)).toMatchObject({ ok: true, texts: null });
  });

  it("nova tentativa com a mesma chave de escrita recomeça do último rascunho reprovado", async () => {
    const db = openGuideDb(":memory:");
    const stagesA = fakeStages({ writeAndCheckGuide: failingWriter(scoped(2)) });
    await runGuideRequest(makeDeps({ db, stages: stagesA }));
    const writerB = failingWriter(scoped(1));
    const deps = makeDeps({ db, stages: fakeStages({ writeAndCheckGuide: writerB }) });
    await runGuideRequest(deps);
    const opts = writerB.mock.calls[0]![4] as WriteAndCheckOpts;
    expect(opts.resume).toEqual({ texts: savedTexts, problems: scoped(2) });
    expect(deps.lines.some((l) => l.includes("rascunho anterior reaproveitado"))).toBe(true);
  });

  describe("Task 31 (R44): --aceitar-pendencias envia um guia quase aprovado para revisão humana", () => {
    const leftovers: GuideProblem[] = [
      { text: "Mirage Estate não está no dossiê.", scope: "torre", kind: "checador" },
      { text: "A moldura diz 'dá para voltar'.", scope: "frame", kind: "checador" },
    ];

    it("com a flag e 2 problemas do checador → envia, com review nos itens do trecho e as pendências no relatório", async () => {
      const { api, calls } = fakeApi();
      const deps = makeDeps({ api, direct: { ...direct, acceptPending: 2 }, stages: fakeStages({ writeAndCheckGuide: failingWriter(leftovers) }) });
      expect(await runGuideRequest(deps)).toBe("review");
      expect(calls.created).toHaveLength(1);
      const { payload } = calls.created[0]!;
      const torre = payload.walkthrough.chapters[0]!.steps.find((s) => s.key === "torre")!;
      expect(torre.items.every((i) => i.review)).toBe(true);
      const report = payload.report as RobotReport;
      expect(report.pendencias).toEqual([
        { scope: "torre", texto: "Mirage Estate não está no dossiê." },
        { scope: "frame", texto: "A moldura diz 'dá para voltar'." },
      ]);
      expect(report.divergences[0]).toBe("enviado com 2 pendências do checador para revisão humana (R44)");
      expect(report.problems).toBeUndefined();
      expect(parseReport(report)?.pendencias).toHaveLength(2);
      const log = deps.lines.join("\n");
      expect(log).toContain("2 pendências do checador");
      expect(log).toContain("[torre] Mirage Estate não está no dossiê.");
    });

    it("um problema de cópia (ou de outro tipo) entre as sobras → não envia", async () => {
      for (const kind of ["copia", "vocabulario", "cronologia", "reparo"] as const) {
        const { api, calls } = fakeApi();
        const problems = [leftovers[0]!, { text: "Outro.", scope: "torre", kind }];
        const deps = makeDeps({ api, direct: { ...direct, acceptPending: 5 }, stages: fakeStages({ writeAndCheckGuide: failingWriter(problems) }) });
        expect(await runGuideRequest(deps)).toBe("failed");
        expect(calls.created).toEqual([]);
      }
    });

    it("sem a flag, ou com mais sobras que N → não envia", async () => {
      for (const d of [direct, { ...direct, acceptPending: 1 }]) {
        const { api, calls } = fakeApi();
        const deps = makeDeps({ api, direct: d, stages: fakeStages({ writeAndCheckGuide: failingWriter(leftovers) }) });
        expect(await runGuideRequest(deps)).toBe("failed");
        expect(calls.created).toEqual([]);
      }
    });
  });

  it("Task 30: a escrita recebe todos os problemas já apontados nas rodadas salvas do pedido (duas tentativas), sem mudar a chave", async () => {
    const db = openGuideDb(":memory:");
    const writerA = failingWriter([{ text: "Ouça Cada Flor é tradução inventada.", scope: "cap-1", kind: "checador" }]);
    await runGuideRequest(makeDeps({ db, stages: fakeStages({ writeAndCheckGuide: writerA }) }));
    const writerB = failingWriter([{ text: "Mirage Estate não está no dossiê.", scope: "cap-1", kind: "checador" }]);
    await runGuideRequest(makeDeps({ db, stages: fakeStages({ writeAndCheckGuide: writerB }) }));
    const writerC = failingWriter(scoped(1));
    await runGuideRequest(makeDeps({ db, stages: fakeStages({ writeAndCheckGuide: writerC }) }));
    const opts = writerC.mock.calls[0]![4] as WriteAndCheckOpts;
    expect(opts.history!.get("cap-1")).toEqual({ problems: ["Ouça Cada Flor é tradução inventada.", "Mirage Estate não está no dossiê."], flagged: 2 });
    // Same writing key every time: the last draft is still the one resumed.
    const keys = db.raw.prepare("SELECT DISTINCT writing_key FROM drafts").all();
    expect(keys).toHaveLength(1);
    expect(opts.resume!.problems).toEqual([{ text: "Mirage Estate não está no dossiê.", scope: "cap-1", kind: "checador" }]);
  });

  it("Task 21: depois de mudar a versão do escritor, recomeça só dos trechos que o checador aprovou, checados de novo", async () => {
    const db = openGuideDb(":memory:");
    const job = { passos: [], itens: [], depois: null };
    const texts: SavedTexts = { frame: savedTexts.frame, jobs: { "cap-1": job, "cap-2": job } };
    await runGuideRequest(makeDeps({ db, stages: fakeStages({ writeAndCheckGuide: failingWriter(scoped(1), texts) }) }));
    // The same inputs written by an earlier version of the writer: another writing key, the same base key.
    db.raw.prepare("UPDATE drafts SET writing_key = 'escrita:versao-anterior'").run();
    const writerB = failingWriter(scoped(1));
    const deps = makeDeps({ db, stages: fakeStages({ writeAndCheckGuide: writerB }) });
    await runGuideRequest(deps);
    const opts = writerB.mock.calls[0]![4] as WriteAndCheckOpts;
    expect(opts.resume).toEqual({
      texts: { frame: null, jobs: { "cap-2": job } },
      problems: [{ scope: "cap-2", kind: "checagem-devida", text: "O trecho cap-2 vem de uma versão anterior do escritor e precisa ser checado de novo." }],
    });
    expect(deps.lines.some((l) => l.includes("rascunho de uma versão anterior do escritor"))).toBe(true);
  });

  it("voz v2: um rascunho das mesmas entradas escrito antes da v7 não é carregado: a escrita recomeça do zero", async () => {
    const db = openGuideDb(":memory:");
    const job = { passos: [], itens: [], depois: null };
    const texts: SavedTexts = { frame: savedTexts.frame, jobs: { "cap-1": job, "cap-2": job } };
    await runGuideRequest(makeDeps({ db, stages: fakeStages({ writeAndCheckGuide: failingWriter(scoped(1), texts) }) }));
    db.raw.prepare("UPDATE drafts SET writing_key = 'escrita:v6', writer_version = 6").run();
    const writerB = failingWriter(scoped(1));
    await runGuideRequest(makeDeps({ db, stages: fakeStages({ writeAndCheckGuide: writerB }) }));
    expect((writerB.mock.calls[0]![4] as WriteAndCheckOpts).resume).toBeUndefined();
  });

  it("sonda: escreve só a moldura e N capítulos, salva e imprime os problemas agrupados, não envia nada", async () => {
    const { api, calls } = fakeApi();
    const db = tempDb();
    const writer = failingWriter(scoped(4));
    const stages = fakeStages({ writeAndCheckGuide: writer });
    const deps = makeDeps({ api, db, direct: { ...direct, probe: { chapters: 2 } }, stages });

    expect(await runGuideRequest(deps)).toBe("probe");

    const opts = writer.mock.calls[0]![4] as WriteAndCheckOpts;
    expect(opts.probe).toEqual({ chapters: 2 });
    expect(calls.created).toEqual([]);
    expect(calls.patched).toEqual([]);
    expect(stages.calls.findSoundtrack).toBeUndefined();
    expect(stages.calls.composeImage).toBeUndefined();
    expect(latestDraft(db, "direto-4115450")).toMatchObject({ probe: true });
    const printed = deps.lines.join("\n");
    expect(printed).toContain("4 problemas");
    expect(printed).toContain("checador (4):");
    expect(printed).toContain("  cap-1 (2):");
    expect(printed).toContain(join(db.dir, "relatorios", "direto-4115450-1.json"));
    expect(deps.lines.some((l) => l.includes("direto-4115450 → sonda"))).toBe(true);
    // Never written to the writing cache as an approved guide.
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'escrita:%'").get()).toMatchObject({ n: 0 });
  });
});

// ---------------------------------------------------------------------------------------------
// Task 25: Opus extraction effort, R39 in the run, the Steam update as a pending version
// ---------------------------------------------------------------------------------------------

describe("Task 25", () => {
  const botGuide = { id: "guide-bot", source: "bot", status: "published" } as unknown as NonNullable<GameSearchHit["guide"]>;
  const hit: GameSearchHit = { id: "game-1", slug: "phantom-test", name: "Phantom Test", steamAppId: 4115450, igdbId: null, aliases: [], guide: botGuide };
  const update = { appId: 4115450, update: true };

  it("a extração usa EXTRACT_EFFORT (padrão medium) e o esforço fora do padrão muda a chave do cache", async () => {
    const stages = fakeStages();
    const deps = makeDeps({ stages });
    deps.config = { ...deps.config, MODEL_EXTRACT: "claude-opus-5-5", EXTRACT_EFFORT: "high" };
    await runGuideRequest(deps);
    expect(stages.calls.extractFacts![0]![2]).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
    const plain = fakeStages();
    await runGuideRequest(makeDeps({ stages: plain }));
    expect(plain.calls.extractFacts![0]![2]).toMatchObject({ effort: "medium" });
    // medium keeps the keys the caches already hold; another effort is another reading.
    expect(extractionKey("m", STEAM_GUIDE, "t", "medium")).toBe(extractionKey("m", STEAM_GUIDE, "t"));
    expect(extractionKey("m", STEAM_GUIDE, "t", "high")).not.toBe(extractionKey("m", STEAM_GUIDE, "t"));
  });

  it("R39 no pipeline: o total declarado na página entra no dossiê e a contagem quase completa passa no gate", async () => {
    const steam = [steamAch("ACH_043", "Complete Mastery", "Collect 10 Sha-Chi Ambers")];
    const { api, calls } = fakeApi({ dossier: vi.fn(async () => ({ ...DOSSIER_SOURCE, achievements: steam })) });
    const shards = Array.from({ length: 38 }, (_, i) => item("Sha-Chi Amber Shard", { collectibleType: "Sha-Chi Amber Shard", location: `Ponto ${i + 1}` }));
    const stages = fakeStages({
      extractFacts: async (_page, source) => ({
        ...fact("x", "roteiro_steam", {
          achievements: [ach("Complete Mastery", { howTo: "Collect 10 Sha-Chi Ambers; 4 shards combine into a whole Amber." })],
          chapters: [chapter("Chapter 1", shards)],
        }),
        source,
      }),
    });
    const page: FetchPage = async (url) =>
      url === STEAM_GUIDE.url
        ? { status: "ok", text: "The game contains 400 Collectibles Locations (40 Sha-Chi Amber Shards, 40 Blackstone Shards).", html: STEAM_GUIDE_HTML, finalUrl: url }
        : fetchPage(url);
    const deps = makeDeps({ api, stages, fetchPage: page });
    expect(await runGuideRequest(deps)).toBe("review");
    expect(calls.created).toHaveLength(1);
    const dossier = deps.db.getDossier(REQUEST.id) as GuideDossier;
    expect(dossier.achievements[0]!.collect!.shortfallAccepted).toMatchObject({ located: 38, stated: 40, missing: 2 });
    expect(dossier.divergences.some((d) => d.includes("contagem incompleta aceita (R39)"))).toBe(true);
  });

  it("--atualizar com o gate da Steam passando: PATCH com scope steam (sem psnList/steamOnly); 202 → versão pendente criada", async () => {
    const { api, calls } = fakeApi({ hit });
    const deps = makeDeps({ api, direct: update });
    expect(await runGuideRequest(deps)).toBe("review");
    expect(calls.created).toEqual([]);
    expect(calls.patched).toHaveLength(1);
    const { id, patch } = calls.patched[0]!;
    expect(id).toBe("guide-bot");
    expect(patch.walkthrough!.scope).toBe("steam");
    expect(patch.walkthrough).not.toHaveProperty("psnList");
    expect(patch.walkthrough).not.toHaveProperty("steamOnly");
    expect(guidePatchSchema.safeParse(patch).error?.issues).toBeUndefined();
    expect(deps.lines.some((l) => l.includes("versão pendente criada (aguarda aprovação)") && l.includes("guide-bot"))).toBe(true);
    expect(deps.lines.some((l) => l.includes("guia em revisão atualizado"))).toBe(false);
  });

  it("--atualizar num guia ainda em revisão: o site atualiza direto → 'guia em revisão atualizado'", async () => {
    const { api } = fakeApi({
      hit: { ...hit, guide: { ...botGuide, status: "review" } as never },
      patchGuide: vi.fn(async (id: string) => ({ id, status: "review" })),
    });
    const deps = makeDeps({ api, direct: update });
    expect(await runGuideRequest(deps)).toBe("review");
    expect(deps.lines.some((l) => l.includes("guia em revisão atualizado") && l.includes("guide-bot"))).toBe(true);
    expect(deps.lines.some((l) => l.includes("versão pendente criada"))).toBe(false);
  });
});

describe("Task 28: imagens por item, únicas e de fontes variadas", () => {
  /** A written guide of `n` collectibles in one step, the first one keyed as the skeleton keys "Golden Feather". */
  const guideOf = (names: string[]) => {
    const payload = writtenPayload();
    const step = payload.walkthrough.chapters[0]!.steps[0]!;
    const base = step.items[0]!;
    step.items = names.map((name, n) => ({ ...base, key: n === 0 ? "chapter-1-golden-feather" : `item-${n}`, name, nameEn: name }));
    return payload;
  };
  /** A pick stage over fixed candidates per item name that, like the real one, never offers a used image again. */
  const candidatesStage =
    (byName: Record<string, { url: string; sourceName: string; sourceUrl: string }[]>): GuideStages["pickItemImage"] =>
    (item, _pages, usage) =>
      (byName[item.nameEn ?? item.name] ?? []).map((c) => ({ ...c, thirdParty: true })).find((c) => !usage || !imageUsed(usage, c.url)) ?? null;

  it("bytes iguais em URLs diferentes: o segundo item leva o próximo candidato; o relatório conta por fonte e as repetições evitadas", async () => {
    const { api, calls } = fakeApi();
    const wiki = { sourceName: "Wiki", sourceUrl: "https://wiki.example/a" };
    const steam = { sourceName: "Steam: guia", sourceUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=9" };
    const stages = fakeStages({
      writeAndCheckGuide: async () => ({ ok: true as const, payload: guideOf(["Golden Feather", "Silver Coin"]) }),
      pickItemImage: candidatesStage({
        "Golden Feather": [{ url: "https://img.example/gf.jpg", ...wiki }],
        "Silver Coin": [
          { url: "https://img.example/gf-copy.jpg", ...wiki },
          { url: "https://img.example/coin.jpg", ...steam },
        ],
      }),
    });
    const bytes: Record<string, string> = {
      "https://img.example/gf.jpg": "feather",
      "https://img.example/gf-copy.jpg": "feather",
      "https://img.example/coin.jpg": "coin",
    };
    const deps = makeDeps({ api, stages, fetchImage: vi.fn(async (url: string) => Buffer.from(bytes[url]!)) });
    expect(await runGuideRequest(deps)).toBe("review");
    const items = calls.created[0]!.payload.walkthrough.chapters[0]!.steps[0]!.items;
    expect(items.map((i) => i.image?.sourceUrl)).toEqual([wiki.sourceUrl, steam.sourceUrl]);
    expect(items.map((i) => i.image?.credit)).toEqual(["Imagem: Wiki", "Imagem: Steam: guia"]);
    expect(calls.uploads).toHaveLength(2);
    const report = calls.created[0]!.payload.report as RobotReport;
    expect(report.images).toEqual({ placed: 2, bySource: { "wiki.example": 1, "steamcommunity.com": 1 }, duplicatesAvoided: 1 });
    expect(deps.lines.some((l) => l.includes("2 imagens enviadas") && l.includes("wiki.example 1") && l.includes("1 repetição evitada"))).toBe(true);
  });

  it("revisão 1: a fonte só conta depois do envio dar certo; a mesma imagem repetida conta uma vez só", async () => {
    const { api, calls } = fakeApi({ uploadImage: vi.fn(async () => { throw new Error("upload 500"); }) } as never);
    const src = { sourceName: "Wiki", sourceUrl: "https://wiki.example/a" };
    const stages = fakeStages({
      writeAndCheckGuide: async () => ({ ok: true as const, payload: guideOf(["Golden Feather"]) }),
      pickItemImage: candidatesStage({ "Golden Feather": [{ url: "https://img.example/gf.jpg", ...src }] }),
    });
    expect(await runGuideRequest(makeDeps({ api, stages, fetchImage: vi.fn(async (url: string) => Buffer.from(url)) }))).toBe("review");
    const report = calls.created[0]!.payload.report as RobotReport;
    expect(report.images).toEqual({ placed: 0, bySource: {}, duplicatesAvoided: 0 });
  });

  it("imagem com menos de 300 px de largura nos bytes baixados: recusada, vai para o próximo candidato", async () => {
    const { api, calls } = fakeApi();
    const narrow = await sharp({ create: { width: 200, height: 120, channels: 3, background: "#222" } }).png().toBuffer();
    const wide = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#444" } }).png().toBuffer();
    const src = { sourceName: "Wiki", sourceUrl: "https://wiki.example/a" };
    const stages = fakeStages({
      writeAndCheckGuide: async () => ({ ok: true as const, payload: guideOf(["Golden Feather"]) }),
      pickItemImage: candidatesStage({ "Golden Feather": [{ url: "https://img.example/small.png", ...src }, { url: "https://img.example/big.png", ...src }] }),
    });
    const fetchImage = vi.fn(async (url: string) => (url.endsWith("small.png") ? narrow : wide));
    expect(await runGuideRequest(makeDeps({ api, stages, fetchImage }))).toBe("review");
    expect(fetchImage.mock.calls.map(([u]) => u)).toEqual(["https://img.example/small.png", "https://img.example/big.png"]);
    expect(stages.calls.composeImage![0]![0]).toBe(wide);
    expect(calls.created[0]!.payload.walkthrough.chapters[0]!.steps[0]!.items[0]!.image).toBeDefined();
  });

  it("a escolha recebe a pista do dossiê (o local nas palavras da fonte) e as páginas que listam o item", async () => {
    const seen: unknown[] = [];
    const stages = fakeStages({
      writeAndCheckGuide: async () => ({ ok: true as const, payload: guideOf(["Pena Dourada"]) }),
      pickItemImage: (item) => {
        seen.push(item);
        return null;
      },
    });
    expect(await runGuideRequest(makeDeps({ stages }))).toBe("review");
    expect(seen[0]).toMatchObject({
      name: "Pena Dourada",
      aliases: expect.arrayContaining(["Golden Feather"]),
      hint: "perto da entrada",
      sourceUrls: [STEAM_GUIDE.url],
    });
  });

  it("com as páginas reais: cada item leva uma imagem diferente e o crédito aponta a página exata", async () => {
    const { api, calls } = fakeApi();
    const html = readFileSync(new URL("./fixtures/powerpyx-pbz-weeping-creek.html", import.meta.url), "utf8");
    const page = "https://www.powerpyx.com/phantom-blade-zero-weeping-creek-valley-collectible-locations/";
    const fetchWith: FetchPage = async (url) => (url === STEAM_GUIDE.url ? { status: "ok", text: STEAM_GUIDE_TEXT, html, finalUrl: page } : fetchPage(url));
    const names = ["Bell (The Beginning)", "Bell (The Lady's Rift)", "Triple Threat", "Sanguine Twin"];
    const stages = fakeStages({ writeAndCheckGuide: async () => ({ ok: true as const, payload: guideOf(names) }) });
    const fetchImage = vi.fn(async (url: string) => Buffer.from(url));
    expect(await runGuideRequest(makeDeps({ api, stages, fetchPage: fetchWith, fetchImage }))).toBe("review");
    const items = calls.created[0]!.payload.walkthrough.chapters[0]!.steps[0]!.items;
    const fetched = fetchImage.mock.calls.map(([u]) => u);
    expect(new Set(fetched).size).toBe(names.length);
    expect(fetched[0]).toContain("phantom-blade-zero-weeping-creek-valley-1-1.jpg");
    expect(items.every((i) => i.image?.sourceUrl === STEAM_GUIDE.url)).toBe(true);
  });
});
