import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { BudgetExceededError, createAi, type Ai, type Effort } from "../ai/client.js";
import { TralkedError } from "../tralked-http.js";
import type { GuideApi, GuideRequest, GuideRequestReport } from "./api.js";
import { statedSequence } from "./chapter-order.js";
import { statedGameTotals, type StatedTotal } from "./completeness.js";
import { DEFAULT_EXTRACT_EFFORT, type GuideConfig } from "./config.js";
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
import { buildReport, pendingSentence, spendByPurpose, type RobotReport, type SourceRead } from "./report.js";
import { reusableDiscovery, saveRunContext } from "./run-context.js";
import { psnScope, type PsnWriteScope } from "./scope.js";
import { buildSkeleton, writeJobs } from "./skeleton.js";
import { findSoundtrack } from "./soundtrack.js";
import type { FetchPage, SourceRef } from "./sources.js";
import { guideAiConfig, guideSpend } from "./spend.js";
import { readSteamAliases, steamAliasUrl, steamLanguagesIn, type AliasLanguage } from "./steam-aliases.js";
import { createWebSearch, type SearchHit } from "./websearch.js";
import type { GuideProblem } from "./checker.js";
import { carriedDraft, groupProblems, problemHistory, resumableDraft, saveDraft, writeReportFile } from "./drafts.js";
import { plain, writeAndCheckGuide, type GuideWriteResult } from "./writer.js";
import { earlierBaseKeys, earlierDraftKeys, readWriting, saveWriting, writingBaseKey, writingKey } from "./writing-cache.js";

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

/** "probe": the cheap probe of the direct mode ended (nothing sent, see `direct.probe`). */
export type GuideOutcome = "idle" | "review" | "waiting_sources" | "failed" | "probe";

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
  config: Pick<GuideConfig, "MODEL_WRITER" | "MODEL_EXTRACT" | "MODEL_FAST" | "MODEL_CHECK" | "CHECK_EFFORT" | "GUIDE_BUDGET_USD"> &
    Partial<Pick<GuideConfig, "EXTRACT_EFFORT" | "GUIDE_STEAM_REFERENCE_ID" | "GUIDE_SOFT_DEADLINE_MIN" | "GUIDE_FORCE_DISCOVERY">>;
  /** `politeFetch` bound to the GuideDb (robots.txt, host intervals, challenge pages as unread). */
  fetchPage: FetchPage;
  /** Bytes of an image, or null when it cannot be read. */
  fetchImage: (url: string) => Promise<Buffer | null>;
  now: () => Date;
  log: (line: string) => void;
  /** Waits between the final report's retries; real time by default. */
  sleep?: (ms: number) => Promise<void>;
  stages?: Partial<GuideStages>;
  /**
   * Direct mode (`pnpm guia -- --appid <n>`): no request is claimed and none is reported to the site. The run uses the
   * synthetic request `direto-<appid>` for spend cap, caches and logs; an existing robot guide is updated only with `update`.
   * `probe` (Task 20, `--sonda`): write only the frame and the first `chapters` chapters, check them once, save and print
   * the problems, and stop (nothing sent, no images, no soundtrack). `updatePsn` (`--atualizar-psn`, Task 25 review):
   * an update may go out by the PSN list (otherwise an update whose Steam gate fails stops before writing).
   * `acceptPending` (`--aceitar-pendencias N`, R44): a guide left with at most N problems after the rewrite, all of
   * them the LLM checker's, still goes out (review / pending as always), its parts marked for review and the problems
   * listed in the report.
   */
  direct?: { appId: number; update: boolean; updatePsn?: boolean; acceptPending?: number; probe?: { chapters: number } };
  /** Where each run's report file goes (`relatorios/<request>-<attempt>.json`); default the GuideDb's folder. */
  reportDir?: string;
};

export const BUDGET_REASON = "teto de gasto";
export const DEADLINE_BEFORE_WRITING = "tempo esgotado antes da escrita";
export const UPDATE_NOT_BY_PSN = "o gate da Steam não passou; a atualização não reenvia o guia pela lista da PSN";
export const directRequestId = (appId: number) => `direto-${appId}`;
const REASON_MAX = 2000;
/** Problems the direct mode prints (the whole list is in the report file). */
const PRINTED_PROBLEMS = 30;
const SOURCE_NAME_MAX = 120;
const CREDIT_MAX = 200;
const SOUNDTRACK_TEXT_MAX = 120;
const DEFAULT_SOFT_DEADLINE_MIN = 150;
/** Waits before each new try of the final report (about 2 minutes in all). */
const FINAL_REPORT_RETRIES_MS = [2_000, 10_000, 30_000, 60_000];

type Final = {
  status: "review" | "waiting_sources" | "failed";
  reason?: string;
  report: RobotReport;
  guideId?: string;
  /** The probe ended: nothing to report anywhere but the local log and file. */
  probe?: boolean;
};

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
      if (deps.direct) {
        // Direct mode has no request on the site: the report is a local log line.
        deps.log(`guia: [direto] relato "${body.status}"${reason ? ` (${reason})` : ""}`);
        return;
      }
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
    /** The last write round's problems, with scope and kind (the report file keeps them; the site gets the texts). */
    problems?: GuideProblem[];
    /** The last write round's code repairs and notes (report file only). */
    repairs?: GuideProblem[];
    sourcesRead: SourceRead[];
    steamList?: GuideDossierSource["achievements"];
    dossier?: GuideDossier;
    /** null: neither gate passed, no scope was chosen. */
    scope?: GuideScope | null;
    notes: string[];
    /** R44: the checker's leftovers the guide goes out with (`--aceitar-pendencias`). */
    pendencias?: { scope: string; texto: string }[];
  };
  report(extra?: { missing?: string[]; problems?: string[]; internalErrors?: string[] }): RobotReport;
  send: Sender["send"];
  /** The soft deadline passed: no more images or soundtrack, send what there is. */
  pastDeadline(): boolean;
  deadlineMin: number;
};

export async function runGuideRequest(deps: GuidePipelineDeps): Promise<GuideOutcome> {
  // Direct mode: each run is a new attempt of `direto-<appid>` (drafts and report files are numbered by it).
  const request: GuideRequest | null = deps.direct
    ? {
        id: directRequestId(deps.direct.appId),
        steamAppId: deps.direct.appId,
        gameSlug: "",
        attempts: deps.db.runCount(directRequestId(deps.direct.appId)) + 1,
      }
    : await deps.api.claimNext();
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
      if (!final.probe) closed = await sendFinal(deps, reports, request, final);
    }
    if (final) saveReportFile(deps, request, final, run?.progress);
    const outcome = closed ? "fechado no site" : final?.probe ? "sonda" : (final?.status ?? "failed");
    deps.db.recordRun({ requestId: request.id, attempt: request.attempts, startedAt, finishedAt: deps.now(), outcome });
    const spend = safeReport(deps, request, run);
    deps.log(
      `guia: pedido ${request.id} → ${outcome}${final?.reason ? ` (${final.reason})` : ""}; gasto US$ ${spend.spendUsd.toFixed(2)} ` +
        `(${Object.entries(spend.spendByPurpose).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ") || "nada"})`,
    );
  }
  if (final?.probe && !closed) return "probe";
  return final && !closed ? final.status : "failed";
}

/**
 * Task 20: every run's report goes to `relatorios/<request>-<attempt>.json` (the problems with scope and kind); the
 * direct mode prints the first problems and the path. Never throws (a disk error is a log line).
 */
function saveReportFile(deps: GuidePipelineDeps, request: GuideRequest, final: Final, progress: Run["progress"] | undefined): void {
  const problems: GuideProblem[] = progress?.problems ?? (final.report.problems ?? []).map((text) => ({ text, scope: "?" }));
  const dir = deps.reportDir ?? (deps.db.dir === ":memory:" ? undefined : deps.db.dir);
  let path: string | undefined;
  try {
    if (dir) {
      path = writeReportFile(dir, request.id, request.attempts, {
        requestId: request.id,
        attempt: request.attempts,
        at: deps.now().toISOString(),
        status: final.probe ? "sonda" : final.status,
        ...(final.reason ? { reason: final.reason } : {}),
        problems,
        ...(progress?.repairs?.length ? { repairs: progress.repairs } : {}),
        report: final.report,
      });
    }
  } catch (error) {
    deps.log(`guia: não consegui salvar o relatório local: ${messageOf(error)}`);
  }
  if (!deps.direct) return;
  if (final.probe) {
    for (const line of groupProblems(problems)) deps.log(`guia: [sonda] ${line}`);
  } else if (problems.length > 0) {
    deps.log(`guia: ${problems.length} ${problems.length === 1 ? "problema" : "problemas"}${problems.length > PRINTED_PROBLEMS ? ` (os ${PRINTED_PROBLEMS} primeiros)` : ""}:`);
    for (const p of problems.slice(0, PRINTED_PROBLEMS)) deps.log(`  - [${p.scope}]${p.kind ? ` (${p.kind})` : ""} ${p.text}`);
    if (problems.length > PRINTED_PROBLEMS) deps.log(`  (e mais ${problems.length - PRINTED_PROBLEMS})`);
  }
  if (path) deps.log(`guia: relatório completo em ${path}`);
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
        ...(progress.pendencias ? { pendencias: progress.pendencias } : {}),
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
  if (existing && deps.direct && !deps.direct.update) {
    return failed(run, "o jogo já tem um guia do robô; use --atualizar para pedir uma nova versão");
  }
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
  const notRead = (s: SourceRef, reason: string, blocked = false) => {
    // Task 25 review: the role, and whether no retry can ever read it (R39 needs both).
    unread.push({ name: s.name, url: s.url, reason, role: s.role, ...(blocked ? { blocked } : {}) });
    progress.sourcesRead.push({ name: s.name, url: s.url, ok: false, reason });
  };
  const facts: ExtractedFacts[] = [];
  const robotErrors: string[] = [];
  for (const s of sources) {
    const page = await deps.fetchPage(s.url);
    if (page.status !== "ok" || !page.text?.trim()) {
      notRead(s, unreadReason(page), page.status === "challenge" || page.status === "blocked");
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
  const dossier = buildDossier(source.achievements, facts, groups, unread, aliases, pageSequence(read), pageTotals(read));
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
    // Task 25 review: an update exists to complete the guide by the Steam list; sending the PSN version again would pay
    // the whole writing for a guide already up by that list. Stop before any writing, unless asked on purpose.
    if (existing && !deps.direct?.updatePsn) {
      progress.scope = null;
      const head = verdict.missing.slice(0, 3).join(" ");
      const more = verdict.missing.length > 3 ? ` (e mais ${verdict.missing.length - 3})` : "";
      deps.log(`guia: ${UPDATE_NOT_BY_PSN} (use --atualizar-psn para isso de propósito)`);
      return {
        status: "waiting_sources",
        reason: `${UPDATE_NOT_BY_PSN}: ${verdict.missing.length} ${verdict.missing.length === 1 ? "lacuna" : "lacunas"} da Steam: ${head}${more}`,
        report: run.report({ missing: verdict.missing }),
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
  const models = { MODEL_WRITER: config.MODEL_WRITER, MODEL_CHECK: config.MODEL_CHECK, CHECK_EFFORT: config.CHECK_EFFORT };
  const cacheKey = writingKey({ dossier: toWrite, scope, game: source.game, models });
  const reused = readWriting(db, cacheKey);
  const probe = deps.direct?.probe;
  if (probe && reused) {
    deps.log(`guia: [sonda] já há uma escrita aprovada deste mesmo dossiê (salva em ${reused.savedAt}); nada a sondar`);
    return { status: "failed", reason: "sonda: escrita aprovada já em cache", report: run.report(), probe: true };
  }
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
    // Task 20: a failed (or probe) draft of the same writing key is the starting point: only what it still lacks or
    // what its problems point at is written again. Every round is saved as soon as it is checked.
    // Task 21: after a new version of the writer (or manual), only the job texts its checker accepted carry over.
    const writing = { dossier: toWrite, scope, game: source.game, models };
    const baseKey = writingBaseKey(writing);
    const same = resumableDraft(db, cacheKey);
    const previous =
      same ??
      carriedDraft(db, { writingKey: cacheKey, baseKey, earlierBaseKeys: earlierBaseKeys(writing), earlierKeys: earlierDraftKeys(writing) });
    if (same) {
      const parts = Object.keys(same.texts.jobs).length + (same.texts.frame ? 1 : 0);
      deps.log(
        `guia: rascunho anterior reaproveitado (${same.requestId}, ${same.createdAt}${same.probe ? ", sonda" : ""}): ` +
          `${parts} partes escritas, ${same.problems.length} problemas a corrigir`,
      );
    } else if (previous) {
      deps.log(
        `guia: rascunho de uma versão anterior do escritor (${previous.requestId}, ${previous.createdAt}${previous.probe ? ", sonda" : ""}): ` +
          `trechos aprovados reaproveitados (checados de novo): ${Object.keys(previous.texts.jobs).length}; o resto é escrito`,
      );
    }
    let rounds = 0;
    const saveRound = (draft: Parameters<typeof saveDraft>[1]["draft"]) =>
      saveDraft(db, { requestId: request.id, attempt: request.attempts, writingKey: cacheKey, baseKey, draft, at: deps.now() });
    written = await stages.writeAndCheckGuide(run.ai, toWrite, source, "backfill", {
      models,
      sourceTexts: read.map((r) => r.text),
      ...(scope ? { scope } : {}),
      ...(previous ? { resume: { texts: previous.texts, problems: previous.problems } } : {}),
      // Task 30: every problem already pointed at in this request's rounds of the same inputs (never the writing key).
      history: problemHistory(db, { requestId: request.id, baseKey }),
      ...(probe ? { probe } : {}),
      onRound: (round) => {
        rounds++;
        saveRound(round);
      },
    });
    // A stage that reported no round (a test fake) is still saved, without texts to resume from.
    if (rounds === 0) {
      saveRound({
        round: 1,
        ok: written.ok,
        probe: Boolean(probe),
        texts: null,
        payload: written.payload,
        problems: written.ok ? [] : written.problems.map((text) => ({ text, scope: "?" })),
        repairs: [],
        internalErrors: written.internalErrors ?? [],
        pending: [],
      });
    }
    progress.problems = written.draft?.problems ?? (written.ok ? [] : written.problems.map((text) => ({ text, scope: "?" })));
    progress.repairs = written.draft?.repairs ?? [];
    if (probe) {
      const n = progress.problems.length;
      return {
        status: "failed",
        reason: `sonda: ${n} ${n === 1 ? "problema" : "problemas"} na moldura e nos ${probe.chapters} primeiros capítulos`,
        report: run.report(written.ok ? {} : { problems: written.problems }),
        probe: true,
      };
    }
    // Saved before images and soundtrack touch the payload.
    if (written.ok) saveWriting(db, cacheKey, written, deps.now());
  }
  const internalErrors = written.internalErrors ?? [];
  if (internalErrors.length > 0) deps.log(`guia: erro interno do escritor (ordem do código): ${internalErrors.join(" | ")}`);
  // R44: with --aceitar-pendencias N, at most N leftovers, all of the LLM checker's, go out with the guide for review.
  const leftovers = written.ok ? [] : (written.draft?.problems ?? []);
  const accept = deps.direct?.acceptPending;
  if (
    !written.ok &&
    accept !== undefined &&
    leftovers.length > 0 &&
    leftovers.length <= accept &&
    leftovers.every((p) => p.kind === "checador") &&
    (written.draft?.pending.length ?? 0) === 0
  ) {
    markForReview(written.payload, leftovers, writeJobs(skeleton));
    progress.pendencias = leftovers.map((p) => ({ scope: p.scope, texto: p.text }));
    deps.log(
      `guia: ${pendingSentence(leftovers.length)}:\n${leftovers.map((p) => `  [${p.scope}] ${p.text}`).join("\n")}`,
    );
  } else if (!written.ok) {
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
    // Task 25: an update always says its scope: a Steam guide that replaces the PSN one has no psnList or steamOnly.
    return existing
      ? { ...rest, walkthrough: { ...rest.walkthrough, scope: rest.walkthrough.scope ?? ("steam" as const) }, status: "review" as const, report }
      : { ...payload, status: "review" as const, report };
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
    // A published guide answers 202: a pending version waits for an editor, and the guide on the air does not change.
    deps.log(
      result.status === "pending_review"
        ? `guia: versão pendente criada (aguarda aprovação) para o guia ${guideId}${result.pendingId ? ` (${String(result.pendingId)})` : ""}, escopo ${patch.walkthrough?.scope ?? "steam"}; o guia no ar não muda até aprovar`
        : `guia: guia em revisão atualizado (${guideId}, escopo ${patch.walkthrough?.scope ?? "steam"})`,
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

/**
 * R44: every item of a part the checker still objects to goes to review: a job's steps (its id is its first step;
 * it runs until the next job of the chapter), or a step named directly. The frame has no items: the report lists it.
 */
function markForReview(payload: GuidePayloadV2, problems: GuideProblem[], jobs: { id: string; steps: { key: string }[] }[]): void {
  const steps = new Set<string>();
  for (const p of problems) {
    const job = jobs.find((j) => j.id === p.scope);
    for (const key of job ? job.steps.map((s) => s.key) : [p.scope]) steps.add(key);
  }
  for (const c of payload.walkthrough.chapters) for (const s of c.steps) if (steps.has(s.key)) for (const i of s.items) i.review = true;
}

/** url -> the game's totals each page states ("contains 564 Collectibles Locations (… 40 Sha-Chi Amber Shards …)"): R39. */
export function pageTotals(read: { source: SourceRef; text: string }[]): Record<string, StatedTotal[]> {
  const out: Record<string, StatedTotal[]> = {};
  for (const r of read) {
    const totals = statedGameTotals(r.text);
    if (totals.length > 0) out[r.source.url] = totals;
  }
  return out;
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

/**
 * The extraction cache key: the model, the prompt, the source's role and url, and the page text; Task 25: and the
 * effort when it is not the default medium (the keys of the extractions already cached stay the same).
 */
export function extractionKey(model: string, source: SourceRef, text: string, effort: Effort = DEFAULT_EXTRACT_EFFORT): string {
  const reading = effort === DEFAULT_EXTRACT_EFFORT ? model : `${model}|esforço ${effort}`;
  return `fatos:${sha([reading, sha(extractionPrompt()), source.role, source.url, text].join("\n"))}`;
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
  const effort = config.EXTRACT_EFFORT ?? DEFAULT_EXTRACT_EFFORT;
  const key = extractionKey(config.MODEL_EXTRACT, source, page.text, effort);
  const cached = readCachedFacts(db, key, source);
  if (cached) return cached;
  if (db.getMeta(key) !== undefined) run.deps.log(`guia: extração em cache de ${source.name} ilegível; extraio de novo`);
  const facts = await run.stages.extractFacts(page, source, { ai: run.ai, model: config.MODEL_EXTRACT, effort, bucket: "backfill" });
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
