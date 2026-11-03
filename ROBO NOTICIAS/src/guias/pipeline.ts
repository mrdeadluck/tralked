import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { BudgetExceededError, createAi, type Ai } from "../ai/client.js";
import { TralkedError } from "../tralked-http.js";
import type { GuideApi, GuideRequest, GuideRequestReport } from "./api.js";
import type { GuideConfig } from "./config.js";
import type { GuidePayloadV2, GuideScope } from "./contract.js";
import { independentGroups } from "./crossref.js";
import type { GuideDb } from "./db.js";
import { discoverSources } from "./discover.js";
import { buildDossier, type AchievementAliases, type GuideDossier, type GuideDossierSource } from "./dossier.js";
import { extractFacts, extractionPrompt } from "./extract.js";
import { extractedFactsSchema, type ExtractedFacts } from "./facts.js";
import { gate, type GateResult } from "./gate.js";
import { composeImage, pickItemImage, type PagesInput } from "./images.js";
import { locateTarget } from "./locate.js";
import { PAGE_TEXT_MAX } from "./page-text.js";
import { buildReport, spendByPurpose, type RobotReport, type SourceRead } from "./report.js";
import { psnScope, type PsnWriteScope } from "./scope.js";
import { findSoundtrack } from "./soundtrack.js";
import type { FetchPage, SourceRef } from "./sources.js";
import { guideAiConfig, guideSpend } from "./spend.js";
import { readSteamAliases, steamAliasUrl, steamLanguagesIn, type AliasLanguage } from "./steam-aliases.js";
import { createWebSearch, type SearchHit } from "./websearch.js";
import { writeAndCheckGuide } from "./writer.js";

/**
 * One guide request, start to end: claim → dossier → sources → extraction → crossref → gate → write/check →
 * images → soundtrack → send → report. Robot guides always go to `review`. Whatever happens after the claim,
 * the request ends in `review`, `waiting_sources` or `failed` (never left in `researching` / `writing`).
 *
 * The gate judges the Steam list first. When it fails and a complete PSN script gives the whole PSN trophy list
 * that passes the gate, the guide follows the PSN list instead (R22, scope "psn"); otherwise `waiting_sources`.
 */

export type GuideOutcome = "idle" | "review" | "waiting_sources" | "failed";

/** The modules the pipeline calls; tests swap them for fakes. */
export type GuideStages = {
  discoverSources: typeof discoverSources;
  extractFacts: typeof extractFacts;
  writeAndCheckGuide: typeof writeAndCheckGuide;
  pickItemImage: typeof pickItemImage;
  locateTarget: typeof locateTarget;
  composeImage: typeof composeImage;
  findSoundtrack: typeof findSoundtrack;
};

const REAL_STAGES: GuideStages = {
  discoverSources,
  extractFacts,
  writeAndCheckGuide,
  pickItemImage,
  locateTarget,
  composeImage,
  findSoundtrack,
};

export type GuidePipelineDeps = {
  api: GuideApi;
  db: GuideDb;
  /** Anthropic client: the AI calls go through `createAi` with the request's spend cap. */
  client: Anthropic;
  config: Pick<GuideConfig, "MODEL_WRITER" | "MODEL_EXTRACT" | "MODEL_FAST" | "GUIDE_BUDGET_USD"> &
    Partial<Pick<GuideConfig, "GUIDE_STEAM_REFERENCE_ID">>;
  /** `politeFetch` bound to the GuideDb (robots.txt, host intervals, challenge pages as unread). */
  fetchPage: FetchPage;
  /** Bytes of an image, or null when it cannot be read. */
  fetchImage: (url: string) => Promise<Buffer | null>;
  now: () => Date;
  log: (line: string) => void;
  stages?: Partial<GuideStages>;
};

export const BUDGET_REASON = "teto de gasto";
const REASON_MAX = 2000;
const SOURCE_NAME_MAX = 120;
const CREDIT_MAX = 200;

type Final = { status: "review" | "waiting_sources" | "failed"; reason?: string; report: RobotReport; guideId?: string };

/** The site closed the request (cancelled or published, 422) or it is gone (404): stop, report nothing more. */
class RequestClosedError extends Error {}

const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Run = {
  deps: GuidePipelineDeps;
  stages: GuideStages;
  request: GuideRequest;
  ai: Ai;
  search: (query: string) => Promise<SearchHit[]>;
  /** What the failure report can still say. */
  progress: { sourcesRead: SourceRead[]; steamList?: GuideDossierSource["achievements"]; dossier?: GuideDossier; scope?: GuideScope };
  report(extra?: { missing?: string[]; problems?: string[] }): RobotReport;
  /** PATCH of the request; throws RequestClosedError when the site no longer takes reports for it. */
  send(body: GuideRequestReport): Promise<void>;
};

export async function runGuideRequest(deps: GuidePipelineDeps): Promise<GuideOutcome> {
  const request = await deps.api.claimNext();
  if (!request) return "idle";
  const startedAt = deps.now();
  deps.log(`guia: pedido ${request.id} (appid ${request.steamAppId}, tentativa ${request.attempts})`);

  const run = startRun(deps, request);
  let final: Final | null = null;
  let closed = false;
  try {
    final = await processRequest(run);
  } catch (error) {
    if (error instanceof RequestClosedError) {
      closed = true;
      deps.log(`guia: o site fechou o pedido ${request.id} (${error.message}); parei sem relatar de novo`);
    } else if (error instanceof BudgetExceededError) {
      deps.log(`guia: ${error.message}`);
      final = { status: "failed", reason: BUDGET_REASON, report: safeReport(run) };
    } else {
      deps.log(`guia: erro no pedido ${request.id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      final = { status: "failed", reason: clip(messageOf(error) || "erro inesperado", REASON_MAX), report: safeReport(run) };
    }
  } finally {
    if (!closed) {
      // Reached even if the catch above threw: the request must never stay in researching / writing.
      final ??= { status: "failed", reason: "erro inesperado", report: safeReport(run) };
      try {
        await run.send({ status: final.status, reason: final.reason, report: final.report, guideId: final.guideId });
      } catch (error) {
        deps.log(`guia: não consegui relatar "${final.status}" do pedido ${request.id}: ${messageOf(error)}`);
      }
    }
    const outcome = closed ? "fechado no site" : (final?.status ?? "failed");
    deps.db.recordRun({ requestId: request.id, attempt: request.attempts, startedAt, finishedAt: deps.now(), outcome });
    const spend = safeReport(run);
    deps.log(
      `guia: pedido ${request.id} → ${outcome}${final?.reason ? ` (${final.reason})` : ""}; gasto US$ ${spend.spendUsd.toFixed(2)} ` +
        `(${Object.entries(spend.spendByPurpose).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ") || "nada"})`,
    );
  }
  return final && !closed ? final.status : "failed";
}

function startRun(deps: GuidePipelineDeps, request: GuideRequest): Run {
  const { db, config, client } = deps;
  const cap = config.GUIDE_BUDGET_USD;
  // guideSpend alone does not apply the cap: createAi does, with the "backfill" bucket and guideAiConfig.
  const ai = createAi({ client, db: guideSpend(db, request.id, cap), config: guideAiConfig(cap), now: deps.now });
  const web = createWebSearch({
    client,
    model: config.MODEL_EXTRACT,
    recordSpend: (usd, purpose) => db.recordSpend(request.id, purpose, config.MODEL_EXTRACT, usd, deps.now()),
  });
  const progress: Run["progress"] = { sourcesRead: [] };
  let sent = 0;
  return {
    deps,
    stages: { ...REAL_STAGES, ...definedStages(deps.stages) },
    request,
    ai,
    progress,
    // Searches are billed outside createAi: check the cap before each one.
    search: async (query) => {
      ai.assertBudget("backfill");
      return web.search(query);
    },
    report: (extra = {}) =>
      buildReport({
        sourcesRead: progress.sourcesRead,
        dossier: progress.dossier,
        steamList: progress.steamList,
        scope: progress.scope,
        spendUsd: db.spentForRequest(request.id),
        spendByPurpose: spendByPurpose(db, request.id),
        ...extra,
      }),
    async send(body) {
      // One key per attempt and report: a replay answers the same, a new attempt is a new write.
      const key = `guia-pedido-${request.id}-t${request.attempts}-${++sent}-${body.status}`;
      const reason = body.reason === undefined ? undefined : clip(body.reason, REASON_MAX);
      try {
        await deps.api.reportRequest(request.id, { ...body, ...(reason !== undefined ? { reason } : {}) }, key);
      } catch (error) {
        if (error instanceof TralkedError && (error.status === 404 || (error.status === 422 && error.issues.length === 0))) {
          throw new RequestClosedError(error.message);
        }
        throw error;
      }
    },
  };
}

/** Test overrides given as `undefined` keep the real stage. */
function definedStages(stages: Partial<GuideStages> = {}): Partial<GuideStages> {
  return Object.fromEntries(Object.entries(stages).filter(([, fn]) => typeof fn === "function"));
}

/** The report for a failure; never throws (it runs while handling another error). */
function safeReport(run: Run): RobotReport {
  try {
    return run.report();
  } catch {
    return buildReport({ sourcesRead: run.progress.sourcesRead, spendUsd: 0 });
  }
}

const failed = (run: Run, reason: string): Final => ({ status: "failed", reason, report: run.report() });

async function processRequest(run: Run): Promise<Final> {
  const { deps, stages, request, progress } = run;
  const { api, db, config } = deps;

  // Steps 1–2: the game, its guide (an update PATCHes the robot's guide) and the full Steam list.
  const hit = await api.findGameByAppId(request.steamAppId);
  if (hit?.guide && hit.guide.source !== "bot") {
    return failed(run, "o jogo já tem um guia feito pela equipe; o robô não substitui guia humano");
  }
  const existing = hit?.guide ?? null;
  const slug = request.gameSlug || hit?.slug;
  if (!slug) return failed(run, "o jogo não está no catálogo do site");
  const source = await api.dossier(slug);
  if (!source) return failed(run, `o site não devolveu o dossiê de ${slug}`);
  progress.steamList = source.achievements;
  if (!source.achievements.some((a) => a.platform === "steam")) return failed(run, "o jogo não tem conquistas na Steam");

  // Step 3: the sources. A failed search is reported as a source not read.
  const sources = await stages.discoverSources(
    { name: source.game.name, steamAppId: request.steamAppId },
    {
      fetchPage: deps.fetchPage,
      search: run.search,
      onSearchFailure: (query, error) => progress.sourcesRead.push({ name: `Busca: ${query}`, url: "", ok: false, reason: messageOf(error) }),
    },
  );

  // Steps 4–5: read each page, then extract its facts (cached by content: a retry only pays for what changed).
  const unread: GuideDossier["unreadSources"] = [];
  const read: { source: SourceRef; text: string; html?: string }[] = [];
  const notRead = (s: SourceRef, reason: string) => {
    unread.push({ name: s.name, url: s.url, reason });
    progress.sourcesRead.push({ name: s.name, url: s.url, ok: false, reason });
  };
  const facts: ExtractedFacts[] = [];
  const robotErrors: string[] = [];
  for (const s of sources) {
    const page = await deps.fetchPage(s.url);
    if (page.status !== "ok" || !page.text?.trim()) {
      notRead(s, unreadReason(page));
      continue;
    }
    try {
      facts.push(await extractCached(run, s, { url: s.url, text: page.text, html: page.html }));
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      robotErrors.push(messageOf(error));
      notRead(s, `extração falhou: ${messageOf(error)}`);
      continue;
    }
    read.push({ source: s, text: page.text, html: page.html });
    progress.sourcesRead.push({ name: s.name, url: s.url, ok: true, ...(page.truncated ? { reason: TRUNCATED } : {}) });
  }

  // Every page that could be read failed in the robot itself (AI / extraction): a systemic fault, not a gap in the sources.
  if (facts.length === 0 && robotErrors.length > 0) {
    const reason = clip(`falha do robô: ${robotErrors[0]}`, REASON_MAX);
    db.addAlert("guia-falha-robo", `pedido ${request.id}: ${reason} (${robotErrors.length} fonte(s) com erro do robô)`, deps.now());
    return { status: "failed", reason, report: run.report() };
  }

  // Step 6: one vote per independent source, then the dossier (localized achievement names included).
  const aliases = await localizedNames(run, read, source.achievements);
  const groups = independentGroups(read.map((r) => ({ url: r.source.url, text: r.text })));
  const dossier = buildDossier(source.achievements, facts, groups, unread, aliases);
  progress.dossier = dossier;
  db.saveDossier(request.id, dossier, deps.now());

  // Step 7: the completeness gate, on the Steam list, else on the PSN list (R22). Nothing is sent when both fail.
  const verdict = gate(dossier, source.achievements);
  let toWrite = dossier;
  let scope: PsnWriteScope | undefined;
  if (!verdict.ok) {
    const psn = gate(dossier, source.achievements, { scope: "psn" });
    if (!psn.ok) {
      const missing = [...verdict.missing, psnFailure(psn)];
      const head = missing.slice(0, 3).join(" ");
      const more = missing.length > 3 ? ` (e mais ${missing.length - 3})` : "";
      return {
        status: "waiting_sources",
        reason: `${missing.length} ${missing.length === 1 ? "lacuna" : "lacunas"}: ${head}${more}`,
        report: run.report({ missing }),
      };
    }
    ({ dossier: toWrite, scope } = psnScope(dossier, source.achievements));
    progress.scope = "psn";
    deps.log(
      `guia: a lista da Steam não fecha (${verdict.missing.length} ${verdict.missing.length === 1 ? "lacuna" : "lacunas"}); ` +
        `o guia sai pela lista da PSN (${scope.psnList.total} troféus, ${scope.steamOnly.length} só na Steam sem roteiro)`,
    );
  }

  // Step 8: write and check, against the raw text of the pages read (copy check).
  await run.send({ status: "writing" });
  const written = await stages.writeAndCheckGuide(run.ai, toWrite, source, "backfill", {
    models: { MODEL_WRITER: config.MODEL_WRITER, MODEL_FAST: config.MODEL_FAST },
    sourceTexts: read.map((r) => r.text),
    ...(scope ? { scope } : {}),
  });
  if (!written.ok) {
    return {
      status: "failed",
      reason: `o checador recusou o guia depois da reescrita (${written.problems.length} ${written.problems.length === 1 ? "problema" : "problemas"})`,
      report: run.report({ problems: written.problems }),
    };
  }
  const payload = written.payload;

  // Steps 9–10: item images and the official soundtrack (each one is optional).
  const pages: PagesInput = read.filter((r) => r.html).map((r) => ({ url: r.source.url, html: r.html!, sourceName: r.source.name }));
  await addImages(run, payload, pages);
  await addSoundtrack(run, payload, source);

  // Step 11: create, or update the robot's guide of the game. Always `review`.
  const report = run.report();
  let guideId: string;
  if (existing) {
    const { game: _game, ...rest } = payload;
    const patch: Partial<GuidePayloadV2> & { report: RobotReport } = { ...rest, status: "review", report };
    const result = await api.patchGuide(existing.id, patch, `guia-${request.id}-t${request.attempts}-atualizar-${sha(JSON.stringify(patch)).slice(0, 16)}`);
    guideId = existing.id;
    deps.log(
      result.status === "pending_review"
        ? `guia: atualização do guia ${guideId} aguarda revisão (o guia no ar não muda até aprovar)`
        : `guia: guia ${guideId} atualizado, em revisão`,
    );
  } else {
    const body: GuidePayloadV2 & { report: RobotReport } = { ...payload, status: "review", report };
    const result = await api.createGuide(body, `guia-${request.id}-t${request.attempts}-criar-${sha(JSON.stringify(body)).slice(0, 16)}`);
    guideId = result.id;
    deps.log(`guia: guia ${guideId} criado, em revisão`);
  }

  // Step 12 (the final report) happens in runGuideRequest.
  return { status: "review", report, guideId };
}

/** One line of `missing` saying why the PSN list could not stand in for the Steam one. */
function psnFailure(psn: GateResult): string {
  const n = psn.missing.length;
  const head = psn.missing.slice(0, 3).join(" ");
  const more = n > 3 ? ` (e mais ${n - 3})` : "";
  return `O guia pela lista da PSN também não sai (${n} ${n === 1 ? "lacuna" : "lacunas"}): ${head}${more}`;
}

const TRUNCATED = `a página passa de ${PAGE_TEXT_MAX.toLocaleString("pt-BR")} caracteres; só o começo foi lido`;

/**
 * The Steam names of the achievements in the languages of the pages read: Chinese and Russian guides cite them by
 * their localized names. A list that cannot be read is reported and skipped (those guides just match less).
 */
async function localizedNames(
  run: Run,
  read: { source: SourceRef; text: string }[],
  steamList: GuideDossierSource["achievements"],
): Promise<AchievementAliases> {
  const languages = steamLanguagesIn(read.map((r) => ({ text: r.text, language: r.source.language })));
  if (languages.length === 0) return {};
  const appId = run.request.steamAppId;
  const steam = steamList.filter((a) => a.platform === "steam");
  const profile = run.deps.config.GUIDE_STEAM_REFERENCE_ID;
  const result = await readSteamAliases(appId, languages, steam, run.deps.fetchPage, profile);
  const entry = (language: AliasLanguage) => ({
    name: `Steam: nomes das conquistas (${language})`,
    url: steamAliasUrl(appId, language, profile),
  });
  for (const language of result.read) run.progress.sourcesRead.push({ ...entry(language), ok: true });
  for (const { language, reason } of result.failed) run.progress.sourcesRead.push({ ...entry(language), ok: false, reason });
  return result.aliases;
}

function unreadReason(page: Awaited<ReturnType<FetchPage>>): string {
  switch (page.status) {
    case "challenge":
      return "página de desafio (proteção contra robôs), não contornada";
    case "blocked":
      return `bloqueada pelo ${page.reason ?? "robots.txt"}`;
    case "error":
      return page.reason ?? "erro ao ler";
    default:
      return "página sem texto";
  }
}

async function extractCached(run: Run, source: SourceRef, page: { url: string; text: string; html?: string }): Promise<ExtractedFacts> {
  const { db, config } = run.deps;
  const key = `fatos:${sha([config.MODEL_EXTRACT, sha(extractionPrompt()), source.role, source.url, page.text].join("\n"))}`;
  const cached = db.getMeta(key);
  if (cached) {
    const parsed = extractedFactsSchema.safeParse(JSON.parse(cached));
    if (parsed.success) return { ...parsed.data, source };
  }
  const facts = await run.stages.extractFacts(page, source, { ai: run.ai, model: config.MODEL_EXTRACT, bucket: "backfill" });
  db.setMeta(key, JSON.stringify(facts));
  return facts;
}

/** Image of each item: picked in the pages read, located, composed (third party never cropped), uploaded. */
async function addImages(run: Run, payload: GuidePayloadV2, pages: PagesInput): Promise<void> {
  const { deps, stages, ai } = run;
  const bytesByUrl = new Map<string, Buffer | null>();
  let added = 0;
  let skipped = 0;
  for (const chapter of payload.walkthrough.chapters) {
    for (const step of chapter.steps) {
      for (const item of step.items) {
        if (item.image) continue;
        try {
          const picked = stages.pickItemImage(item, pages);
          if (!picked) continue;
          if (!bytesByUrl.has(picked.url)) bytesByUrl.set(picked.url, await deps.fetchImage(picked.url));
          const bytes = bytesByUrl.get(picked.url);
          if (!bytes) continue;
          const target = await stages.locateTarget(ai, bytes, item.nameEn ?? item.name, {
            model: deps.config.MODEL_FAST,
            bucket: "backfill",
          });
          const composed = await stages.composeImage(bytes, { target, thirdParty: picked.thirdParty });
          const uploaded = await deps.api.uploadImage(new Uint8Array(composed), "image/webp", `guia-img-${sha(composed).slice(0, 40)}`);
          const sourceName = clip(picked.sourceName, SOURCE_NAME_MAX);
          item.image = {
            url: uploaded.url,
            credit: clip(`Imagem: ${picked.sourceName}`, CREDIT_MAX),
            sourceName,
            sourceUrl: picked.sourceUrl,
          };
          added++;
        } catch (error) {
          if (error instanceof BudgetExceededError) throw error;
          skipped++;
          deps.log(`guia: imagem de "${item.name}" ficou de fora: ${messageOf(error)}`);
        }
      }
    }
  }
  deps.log(`guia: ${added} ${added === 1 ? "imagem" : "imagens"} enviadas${skipped ? `, ${skipped} com erro` : ""}`);
}

async function addSoundtrack(run: Run, payload: GuidePayloadV2, source: GuideDossierSource): Promise<void> {
  const game = source.game;
  try {
    // Label / composer only with credits evidence; the dossier has developer and publisher only.
    const soundtrack = await run.stages.findSoundtrack(
      run.ai,
      { name: game.name, developer: game.developer ?? "", publisher: game.publisher ?? "" },
      { search: run.search },
    );
    if (soundtrack) payload.walkthrough.soundtrack = soundtrack;
    else run.deps.log("guia: sem trilha oficial no YouTube; o guia sai sem música");
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    run.deps.log(`guia: a busca da trilha falhou: ${messageOf(error)}`);
  }
}
