import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { BudgetExceededError, createAi, type Ai } from "../ai/client.js";
import { TralkedError } from "../tralked-http.js";
import type { GuideApi, GuideRequest, GuideRequestReport } from "./api.js";
import { statedSequence } from "./chapter-order.js";
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
import {
  bodyBytes,
  estimatePayloadBytes,
  fitBody,
  imageBytes,
  imageOrder,
  kib,
  REPORT_SLACK_BYTES,
  SITE_LIMITS,
  skeletonLimitProblems,
  tooBigReason,
} from "./limits.js";
import { locateTarget } from "./locate.js";
import { PAGE_TEXT_MAX } from "./page-text.js";
import { buildReport, spendByPurpose, type RobotReport, type SourceRead } from "./report.js";
import { reusableDiscovery, saveRunContext } from "./run-context.js";
import { psnScope, type PsnWriteScope } from "./scope.js";
import { buildSkeleton } from "./skeleton.js";
import { findSoundtrack } from "./soundtrack.js";
import type { FetchPage, SourceRef } from "./sources.js";
import { guideAiConfig, guideSpend } from "./spend.js";
import { readSteamAliases, steamAliasUrl, steamLanguagesIn, type AliasLanguage } from "./steam-aliases.js";
import { createWebSearch, type SearchHit } from "./websearch.js";
import { plain, writeAndCheckGuide, type GuideWriteResult } from "./writer.js";
import { readWriting, saveWriting, writingKey } from "./writing-cache.js";

/**
 * One guide request, start to end: claim → dossier → sources → extraction → crossref → gate → site limits →
 * write/check → images → soundtrack → send → report. Robot guides always go to `review`. Whatever happens after
 * the claim, the request ends in `review`, `waiting_sources` or `failed` (never left in `researching` /
 * `writing`): the final report is retried for a while before giving up.
 *
 * The gate judges the Steam list first. When it fails and a complete PSN script gives the whole PSN trophy list
 * that passes the gate, the guide follows the PSN list instead (R22, scope "psn"); otherwise `waiting_sources`.
 * Before any money goes into writing, the guide's shape is checked against the site's limits (chapters, steps,
 * items, the 1 MiB body). Once the guide is written it is always sent: images and the soundtrack are left out when
 * the soft deadline passes or the spend cap is hit (the report says so).
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
    Partial<Pick<GuideConfig, "GUIDE_STEAM_REFERENCE_ID" | "GUIDE_SOFT_DEADLINE_MIN" | "GUIDE_FORCE_DISCOVERY">>;
  /** `politeFetch` bound to the GuideDb (robots.txt, host intervals, challenge pages as unread). */
  fetchPage: FetchPage;
  /** Bytes of an image, or null when it cannot be read. */
  fetchImage: (url: string) => Promise<Buffer | null>;
  now: () => Date;
  log: (line: string) => void;
  /** Waits between the final report's retries; real time by default. */
  sleep?: (ms: number) => Promise<void>;
  stages?: Partial<GuideStages>;
};

export const BUDGET_REASON = "teto de gasto";
export const DEADLINE_BEFORE_WRITING = "tempo esgotado antes da escrita";
const REASON_MAX = 2000;
const SOURCE_NAME_MAX = 120;
const CREDIT_MAX = 200;
const SOUNDTRACK_TEXT_MAX = 120;
const DEFAULT_SOFT_DEADLINE_MIN = 150;
/** Waits before each new try of the final report (about 2 minutes in all). */
const FINAL_REPORT_RETRIES_MS = [2_000, 10_000, 30_000, 60_000];

type Final = { status: "review" | "waiting_sources" | "failed"; reason?: string; report: RobotReport; guideId?: string };

/** The site closed the request (cancelled or published, 422) or it is gone (404): stop, report nothing more. */
class RequestClosedError extends Error {}

const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** PATCHes of the request. `send` throws RequestClosedError when the site no longer takes reports for it. */
type Sender = {
  /** A new idempotency key: one per attempt and report (a retry of the same report reuses its key). */
  nextKey(status: string): string;
  send(body: GuideRequestReport, key?: string): Promise<void>;
};

function sender(deps: GuidePipelineDeps, request: GuideRequest): Sender {
  let sent = 0;
  const nextKey = (status: string) => `guia-pedido-${request.id}-t${request.attempts}-${++sent}-${status}`;
  return {
    nextKey,
    async send(body, key = nextKey(body.status)) {
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

type Run = {
  deps: GuidePipelineDeps;
  stages: GuideStages;
  request: GuideRequest;
  ai: Ai;
  search: (query: string) => Promise<SearchHit[]>;
  /** What the failure report can still say. `notes`: what was left out to deliver the guide. */
  progress: {
    sourcesRead: SourceRead[];
    steamList?: GuideDossierSource["achievements"];
    dossier?: GuideDossier;
    /** null: neither gate passed, no scope was chosen. */
    scope?: GuideScope | null;
    notes: string[];
  };
  report(extra?: { missing?: string[]; problems?: string[]; internalErrors?: string[] }): RobotReport;
  send: Sender["send"];
  /** The soft deadline passed: no more images or soundtrack, send what there is. */
  pastDeadline(): boolean;
  deadlineMin: number;
};

export async function runGuideRequest(deps: GuidePipelineDeps): Promise<GuideOutcome> {
  const request = await deps.api.claimNext();
  if (!request) return "idle";
  const startedAt = deps.now();
  deps.log(`guia: pedido ${request.id} (appid ${request.steamAppId}, tentativa ${request.attempts})`);

  const reports = sender(deps, request);
  let run: Run | undefined;
  let final: Final | null = null;
  let closed = false;
  try {
    run = startRun(deps, request, reports, startedAt);
    final = await processRequest(run);
  } catch (error) {
    if (error instanceof RequestClosedError) {
      closed = true;
      deps.log(`guia: o site fechou o pedido ${request.id} (${error.message}); parei sem relatar de novo`);
    } else if (error instanceof BudgetExceededError) {
      deps.log(`guia: ${error.message}`);
      final = { status: "failed", reason: BUDGET_REASON, report: safeReport(deps, request, run) };
    } else {
      deps.log(`guia: erro no pedido ${request.id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      final = { status: "failed", reason: clip(messageOf(error) || "erro inesperado", REASON_MAX), report: safeReport(deps, request, run) };
    }
  } finally {
    if (!closed) {
      // Reached even if the catch above threw: the request must never stay in researching / writing.
      final ??= { status: "failed", reason: "erro inesperado", report: safeReport(deps, request, run) };
      closed = await sendFinal(deps, reports, request, final);
    }
    const outcome = closed ? "fechado no site" : (final?.status ?? "failed");
    deps.db.recordRun({ requestId: request.id, attempt: request.attempts, startedAt, finishedAt: deps.now(), outcome });
    const spend = safeReport(deps, request, run);
    deps.log(
      `guia: pedido ${request.id} → ${outcome}${final?.reason ? ` (${final.reason})` : ""}; gasto US$ ${spend.spendUsd.toFixed(2)} ` +
        `(${Object.entries(spend.spendByPurpose).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ") || "nada"})`,
    );
  }
  return final && !closed ? final.status : "failed";
}

/**
 * The final report, retried with growing waits (same idempotency key) so a passing outage of the site does not
 * leave the request in researching / writing. True when the site closed the request meanwhile.
 */
async function sendFinal(deps: GuidePipelineDeps, reports: Sender, request: GuideRequest, final: Final): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const key = reports.nextKey(final.status);
  const body: GuideRequestReport = { status: final.status, reason: final.reason, report: final.report, guideId: final.guideId };
  for (let attempt = 0; ; attempt++) {
    try {
      await reports.send(body, key);
      return false;
    } catch (error) {
      if (error instanceof RequestClosedError) {
        deps.log(`guia: o site fechou o pedido ${request.id} (${error.message})`);
        return true;
      }
      // The site refused this report (422 with issues, other 4xx): sending it again would get the same answer.
      if (error instanceof TralkedError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        deps.log(`guia: o site recusou o relato "${final.status}" do pedido ${request.id}: ${messageOf(error)}; não repito`);
        return false;
      }
      const wait = FINAL_REPORT_RETRIES_MS[attempt];
      if (wait === undefined) {
        deps.log(`guia: não consegui relatar "${final.status}" do pedido ${request.id}: ${messageOf(error)}`);
        return false;
      }
      deps.log(`guia: relato "${final.status}" do pedido ${request.id} falhou (${messageOf(error)}); tento de novo em ${wait / 1000} s`);
      await sleep(wait);
    }
  }
}

function startRun(deps: GuidePipelineDeps, request: GuideRequest, reports: Sender, startedAt: Date): Run {
  const { db, config, client } = deps;
  const cap = config.GUIDE_BUDGET_USD;
  // guideSpend alone does not apply the cap: createAi does, with the "backfill" bucket and guideAiConfig.
  const ai = createAi({ client, db: guideSpend(db, request.id, cap), config: guideAiConfig(cap), now: deps.now });
  const web = createWebSearch({
    client,
    model: config.MODEL_EXTRACT,
    recordSpend: (usd, purpose) => db.recordSpend(request.id, purpose, config.MODEL_EXTRACT, usd, deps.now()),
  });
  const progress: Run["progress"] = { sourcesRead: [], notes: [] };
  const deadlineMin = config.GUIDE_SOFT_DEADLINE_MIN ?? DEFAULT_SOFT_DEADLINE_MIN;
  const deadline = startedAt.getTime() + deadlineMin * 60_000;
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
        notes: progress.notes,
        ...extra,
      }),
    send: (body, key) => reports.send(body, key),
    pastDeadline: () => deps.now().getTime() >= deadline,
    deadlineMin,
  };
}

/** Test overrides given as `undefined` keep the real stage. */
function definedStages(stages: Partial<GuideStages> = {}): Partial<GuideStages> {
  return Object.fromEntries(Object.entries(stages).filter(([, fn]) => typeof fn === "function"));
}

/** The report for a failure; never throws (it runs while handling another error, maybe before the run exists). */
function safeReport(deps: GuidePipelineDeps, request: GuideRequest, run: Run | undefined): RobotReport {
  try {
    if (run) return run.report();
    return buildReport({ sourcesRead: [], spendUsd: deps.db.spentForRequest(request.id), spendByPurpose: spendByPurpose(deps.db, request.id) });
  } catch {
    return buildReport({ sourcesRead: run?.progress.sourcesRead ?? [], spendUsd: 0 });
  }
}

const failed = (run: Run, reason: string, extra?: Parameters<Run["report"]>[0]): Final => ({ status: "failed", reason, report: run.report(extra) });

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

  // Step 3: the sources. The web searches are paid: a discovery of the last 7 days for this request or game is reused
  // (unless GUIDE_FORCE_DISCOVERY). A failed search is reported as a source not read.
  const discovered = config.GUIDE_FORCE_DISCOVERY ? undefined : reusableDiscovery(db, request.id, request.steamAppId, deps.now());
  let sources: SourceRef[];
  if (discovered) {
    sources = discovered.sources;
    deps.log(`guia: fontes da descoberta reaproveitadas (salvas em ${discovered.savedAt}, ${sources.length} fontes); sem busca na web`);
  } else {
    sources = await stages.discoverSources(
      { name: source.game.name, steamAppId: request.steamAppId },
      {
        fetchPage: deps.fetchPage,
        search: run.search,
        onSearchFailure: (query, error) => progress.sourcesRead.push({ name: `Busca: ${query}`, url: "", ok: false, reason: messageOf(error) }),
      },
    );
  }
  // What this request runs on, for the free dry run (`pnpm guia -- --ensaio`); `savedAt` stays the discovery's date.
  saveRunContext(db, {
    requestId: request.id,
    steamAppId: request.steamAppId,
    gameSlug: slug,
    game: source.game,
    steamList: source.achievements,
    sources,
    savedAt: discovered?.savedAt ?? deps.now().toISOString(),
  });

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

  // Step 6: one vote per independent source, then the dossier (localized achievement names included); the
  // primary's pages in the order they state ("is the 2nd region").
  const aliases = await localizedNames(run, read, source.achievements);
  const groups = independentGroups(read.map((r) => ({ url: r.source.url, text: r.text })));
  const dossier = buildDossier(source.achievements, facts, groups, unread, aliases, pageSequence(read));
  progress.dossier = dossier;
  db.saveDossier(request.id, dossier, deps.now());

  // Step 7: the completeness gate, on the Steam list, else on the PSN list (R22). Nothing is sent when both fail.
  const verdict = gate(dossier, source.achievements);
  let toWrite = dossier;
  let scope: PsnWriteScope | undefined;
  if (!verdict.ok) {
    const psn = gate(dossier, source.achievements, { scope: "psn" });
    if (!psn.ok) {
      progress.scope = null;
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

  // Step 7b: the site's limits, before any money goes into writing.
  const skeleton = buildSkeleton(toWrite);
  const limits = skeletonLimitProblems(skeleton);
  if (limits.length > 0) {
    const more = limits.length > 1 ? ` (e mais ${limits.length - 1})` : "";
    return failed(run, `o guia não cabe nos limites do site: ${limits[0]}${more}`, { problems: limits });
  }
  const estimate = estimatePayloadBytes(skeleton, toWrite, bodyBytes(run.report()));
  if (estimate.withoutImages > SITE_LIMITS.bodyBytes) {
    return failed(run, `${tooBigReason(estimate.withoutImages)} (estimativa antes de escrever, sem imagens)`);
  }
  // Step 8: write and check, against the raw text of the pages read (copy check); an approved writing of the same
  // dossier is reused from the cache, without the AI.
  const models = { MODEL_WRITER: config.MODEL_WRITER, MODEL_FAST: config.MODEL_FAST };
  const cacheKey = writingKey({ dossier: toWrite, scope, game: source.game, models });
  const reused = readWriting(db, cacheKey);
  // The soft deadline already passed: writing is the long, paid part. Stop here (the caches stay for the retry);
  // a cached writing is free, so it still goes.
  if (!reused && run.pastDeadline()) return failed(run, DEADLINE_BEFORE_WRITING);
  await run.send({ status: "writing" });
  let written: GuideWriteResult;
  if (reused) {
    written = { ok: true, payload: reused.payload, ...(reused.internalErrors.length > 0 ? { internalErrors: reused.internalErrors } : {}) };
    progress.notes.push("escrita reaproveitada do cache");
    deps.log(`guia: escrita reaproveitada do cache (salva em ${reused.savedAt}); sem chamar a IA`);
  } else {
    written = await stages.writeAndCheckGuide(run.ai, toWrite, source, "backfill", {
      models,
      sourceTexts: read.map((r) => r.text),
      ...(scope ? { scope } : {}),
    });
    // Saved before images and soundtrack touch the payload.
    if (written.ok) saveWriting(db, cacheKey, written, deps.now());
  }
  const internalErrors = written.internalErrors ?? [];
  if (internalErrors.length > 0) deps.log(`guia: erro interno do escritor (ordem do código): ${internalErrors.join(" | ")}`);
  if (!written.ok) {
    return {
      status: "failed",
      reason: `o checador recusou o guia depois da reescrita (${written.problems.length} ${written.problems.length === 1 ? "problema" : "problemas"})`,
      report: run.report({ problems: written.problems, internalErrors }),
    };
  }
  const payload = written.payload;

  // Steps 9–10: the official soundtrack, then item images (each one optional), sized on the written guide. From
  // here on the guide is always sent, without them when the soft deadline passes or the spend cap is hit.
  const bodyOf = (report: RobotReport) => {
    const { game: _game, ...rest } = payload;
    return existing ? { ...rest, status: "review" as const, report } : { ...payload, status: "review" as const, report };
  };
  if (run.pastDeadline()) {
    progress.notes.push(`o prazo de ${run.deadlineMin} min passou depois de escrever: o guia saiu sem imagens e sem trilha sonora`);
  } else {
    await addSoundtrack(run, payload, source);
    // What is left of the 1 MiB for images (the report's last notes kept apart).
    const budget = SITE_LIMITS.bodyBytes - bodyBytes(bodyOf(run.report({ internalErrors }))) - REPORT_SLACK_BYTES;
    const pages: PagesInput = read.filter((r) => r.html).map((r) => ({ url: r.source.url, html: r.html!, sourceName: r.source.name }));
    await addImages(run, payload, pages, budget);
  }

  // Step 11: create, or update the robot's guide of the game. Always `review`, always under the body cap.
  const report = run.report({ internalErrors });
  const body = bodyOf(report);
  const fit = fitBody(body);
  if (!fit.ok) return failed(run, tooBigReason(fit.bytes), { internalErrors });
  const sentReport: RobotReport = fit.dropped.length > 0 ? { ...fit.body.report, notes: [...(fit.body.report.notes ?? []), ...fit.dropped] } : fit.body.report;
  const toSend = { ...fit.body, report: sentReport };
  if (bodyBytes(toSend) > SITE_LIMITS.bodyBytes) return failed(run, tooBigReason(bodyBytes(toSend)), { internalErrors });

  let guideId: string;
  if (existing) {
    const patch = toSend as Partial<GuidePayloadV2> & { report: RobotReport };
    const result = await api.patchGuide(existing.id, patch, `guia-${request.id}-t${request.attempts}-atualizar-${sha(JSON.stringify(patch)).slice(0, 16)}`);
    guideId = existing.id;
    deps.log(
      result.status === "pending_review"
        ? `guia: atualização do guia ${guideId} aguarda revisão (o guia no ar não muda até aprovar)`
        : `guia: guia ${guideId} atualizado, em revisão`,
    );
  } else {
    const created = toSend as GuidePayloadV2 & { report: RobotReport };
    const result = await api.createGuide(created, `guia-${request.id}-t${request.attempts}-criar-${sha(JSON.stringify(created)).slice(0, 16)}`);
    guideId = result.id;
    deps.log(`guia: guia ${guideId} criado, em revisão`);
  }

  // Step 12 (the final report) happens in runGuideRequest.
  return { status: "review", report: sentReport, guideId };
}

/** url -> the position each page states for itself in the game ("Crimson Forest is the 2nd region"). */
function pageSequence(read: { source: SourceRef; text: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of read) {
    const n = statedSequence(r.text);
    if (n !== undefined) out[r.source.url] = n;
  }
  return out;
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
    url: result.urls[language] ?? steamAliasUrl(appId, language),
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

/** The extraction cache key: the model, the prompt, the source's role and url, and the page text. */
export function extractionKey(model: string, source: SourceRef, text: string): string {
  return `fatos:${sha([model, sha(extractionPrompt()), source.role, source.url, text].join("\n"))}`;
}

/** The cached facts of a page, when the cached JSON is still sound; anything else is extracted again. */
export function readCachedFacts(db: GuideDb, key: string, source: SourceRef): ExtractedFacts | undefined {
  const cached = db.getMeta(key);
  if (!cached) return undefined;
  try {
    const parsed = extractedFactsSchema.safeParse(JSON.parse(cached));
    return parsed.success ? { ...parsed.data, source } : undefined;
  } catch {
    return undefined;
  }
}

async function extractCached(run: Run, source: SourceRef, page: { url: string; text: string; html?: string }): Promise<ExtractedFacts> {
  const { db, config } = run.deps;
  const key = extractionKey(config.MODEL_EXTRACT, source, page.text);
  const cached = readCachedFacts(db, key, source);
  if (cached) return cached;
  if (db.getMeta(key) !== undefined) run.deps.log(`guia: extração em cache de ${source.name} ilegível; extraio de novo`);
  const facts = await run.stages.extractFacts(page, source, { ai: run.ai, model: config.MODEL_EXTRACT, bucket: "backfill" });
  db.setMeta(key, JSON.stringify(facts));
  if (facts.shortfall) {
    run.deps.log(`guia: extração incompleta de ${source.name}: a página diz ${facts.shortfall.stated} entradas, vieram ${facts.shortfall.extracted} mesmo relendo em partes`);
  }
  return facts;
}

/**
 * Image of each item: picked in the pages read, located, composed (third party never cropped), uploaded. The most
 * useful first (missables, counted collectibles, then the rest, each in route order), only while they fit in
 * `budget` bytes of the body: no fetching, locating or uploading for an image that would be thrown away. Stops,
 * keeping what it has, when the soft deadline passes or the spend cap is hit (the guide is already written).
 */
async function addImages(run: Run, payload: GuidePayloadV2, pages: PagesInput, budget: number): Promise<void> {
  const { deps, stages, ai } = run;
  const bytesByUrl = new Map<string, Buffer | null>();
  let added = 0;
  let skipped = 0;
  let left = budget;
  const report = () => deps.log(`guia: ${added} ${added === 1 ? "imagem" : "imagens"} enviadas${skipped ? `, ${skipped} com erro` : ""}`);
  if (left <= 0) {
    run.progress.notes.push(`sem espaço para imagens: o guia escrito já ocupa quase os ${kib(SITE_LIMITS.bodyBytes)} KiB do envio`);
    report();
    return;
  }
  for (const item of imageOrder(payload.walkthrough.chapters)) {
    if (item.image) continue;
    if (run.pastDeadline()) {
      run.progress.notes.push(`o prazo de ${run.deadlineMin} min passou: as imagens pararam em ${added}, o resto do guia saiu sem imagem`);
      report();
      return;
    }
    try {
      const picked = stages.pickItemImage(item, pages);
      if (!picked) continue;
      // Names from the page: plain text, clipped to the site's limits (a stray "<" would refuse the guide).
      const sourceName = plain(picked.sourceName, SOURCE_NAME_MAX) || hostName(picked.sourceUrl) || "Fonte";
      const credit = plain(`Imagem: ${picked.sourceName}`, CREDIT_MAX) || `Imagem: ${sourceName}`;
      const sourceUrl = isHttpUrl(picked.sourceUrl) ? picked.sourceUrl : undefined;
      if (imageBytes({ credit, sourceName, ...(sourceUrl ? { sourceUrl } : {}) }) > left) {
        run.progress.notes.push(`o espaço do envio (${kib(SITE_LIMITS.bodyBytes)} KiB) acabou nas imagens: ${added} enviadas, as demais ficaram de fora`);
        report();
        return;
      }
      if (!bytesByUrl.has(picked.url)) bytesByUrl.set(picked.url, await deps.fetchImage(picked.url));
      const bytes = bytesByUrl.get(picked.url);
      if (!bytes) continue;
      const target = await stages.locateTarget(ai, bytes, item.nameEn ?? item.name, {
        model: deps.config.MODEL_FAST,
        bucket: "backfill",
      });
      const composed = await stages.composeImage(bytes, { target, thirdParty: picked.thirdParty });
      const uploaded = await deps.api.uploadImage(new Uint8Array(composed), "image/webp", `guia-img-${sha(composed).slice(0, 40)}`);
      item.image = { url: uploaded.url, credit, sourceName, ...(sourceUrl ? { sourceUrl } : {}) };
      left -= Buffer.byteLength(`,"image":${JSON.stringify(item.image)}`, "utf8");
      added++;
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        run.progress.notes.push(`teto de gasto atingido nas imagens: elas pararam em ${added}, o guia saiu assim`);
        deps.log(`guia: ${error.message}; imagens interrompidas`);
        report();
        return;
      }
      skipped++;
      deps.log(`guia: imagem de "${item.name}" ficou de fora: ${messageOf(error)}`);
    }
  }
  report();
}

const hostName = (url: string) => (URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : "");
const isHttpUrl = (url: string) => URL.canParse(url) && /^https?:$/.test(new URL(url).protocol);

async function addSoundtrack(run: Run, payload: GuidePayloadV2, source: GuideDossierSource): Promise<void> {
  const game = source.game;
  try {
    // Label / composer only with credits evidence; the dossier has developer and publisher only.
    const soundtrack = await run.stages.findSoundtrack(
      run.ai,
      { name: game.name, developer: game.developer ?? "", publisher: game.publisher ?? "" },
      { search: run.search, fetchPage: run.deps.fetchPage },
    );
    if (!soundtrack) {
      run.deps.log("guia: sem trilha oficial no YouTube; o guia sai sem música");
      return;
    }
    // oEmbed text: plain, clipped to the site's limits.
    const title = plain(soundtrack.title, SOUNDTRACK_TEXT_MAX);
    const channel = plain(soundtrack.channel, SOUNDTRACK_TEXT_MAX);
    if (!title || !channel) {
      run.deps.log("guia: a trilha achada não tem título ou canal legível; o guia sai sem música");
      return;
    }
    payload.walkthrough.soundtrack = { ...soundtrack, title, channel };
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      run.progress.notes.push("teto de gasto atingido na busca da trilha sonora: o guia saiu sem música");
      run.deps.log(`guia: ${error.message}; trilha interrompida`);
      return;
    }
    run.deps.log(`guia: a busca da trilha falhou: ${messageOf(error)}`);
  }
}
