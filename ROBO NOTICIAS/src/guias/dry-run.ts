import { PRICES } from "../ai/client.js";
import { statedSequence } from "./chapter-order.js";
import type { DryRunConfig } from "./config.js";
import { independentGroups } from "./crossref.js";
import type { GuideDb } from "./db.js";
import { buildDossier, UNPLACED_MARK, type DossierAchievement, type GuideDossier, type GuideDossierSource, type SteamAchievement } from "./dossier.js";
import { extractedFactsSchema, type ExtractedFacts } from "./facts.js";
import { gate } from "./gate.js";
import { estimatePayloadBytes, IMAGE_BYTES, kib, REPORT_SLACK_BYTES, SITE_LIMITS, skeletonLimitProblems } from "./limits.js";
import { PAGE_TEXT_VERSION, pageText } from "./page-text.js";
import { extractionKey, readCachedFacts } from "./pipeline.js";
import { buildReport, STAGE_ONLY_TITLE, UNPLACED_TITLE } from "./report.js";
import { latestRunContext, loadRunContext, type RunContext } from "./run-context.js";
import { psnScope, type PsnWriteScope } from "./scope.js";
import { buildSkeleton } from "./skeleton.js";
import type { FetchPage, SourceRef } from "./sources.js";
import { readSteamAliases, steamLanguagesIn } from "./steam-aliases.js";
import { writerPlan } from "./writer.js";
import { readWriting, writingKey } from "./writing-cache.js";

/**
 * The free dry run (`pnpm guia -- --ensaio --appid <n>` or `--pedido <id>`): replays a request on what the robot
 * already has (the cached pages and the cached extraction), with no AI call and no network, and says what a real
 * run would do before spending: the scope, the chapters in order, the agreed / single-source items, the gate's
 * gaps, the site limits, the estimated size of the guide and the estimated cost of writing it.
 */

export type DryRunInput = {
  db: GuideDb;
  config: Pick<DryRunConfig, "MODEL_WRITER" | "MODEL_EXTRACT" | "MODEL_FAST" | "GUIDE_STEAM_REFERENCE_ID">;
  requestId?: string;
  appId?: number;
  log: (line: string) => void;
};

/** A page from the cache only (any age), with the current extractor's text; never the network, never a write. */
export function cachedPage(db: GuideDb): FetchPage {
  return async (url) => {
    const row = db.getPage(url);
    if (!row || row.status !== "ok") return { status: "error", finalUrl: url, reason: "fora do cache (o ensaio não usa a rede)" };
    const text = row.text_version === PAGE_TEXT_VERSION || !row.html ? (row.text ?? "") : pageText(row.html).text;
    return { status: "ok", text, html: row.html ?? undefined, finalUrl: row.final_url };
  };
}

type CachedFacts = { facts: ExtractedFacts; stale: boolean };

/** Every cached extraction of a url, newest last. */
function extractionsOf(db: GuideDb): Map<string, ExtractedFacts> {
  const rows = db.raw.prepare("SELECT value FROM meta WHERE key LIKE 'fatos:%' ORDER BY rowid").all() as unknown as { value: string }[];
  const byUrl = new Map<string, ExtractedFacts>();
  for (const row of rows) {
    try {
      const parsed = extractedFactsSchema.safeParse(JSON.parse(row.value));
      if (parsed.success) byUrl.set(parsed.data.source.url, parsed.data);
    } catch {
      // A corrupt row is skipped (a real run extracts that page again).
    }
  }
  return byUrl;
}

/** A request saved before contexts existed: what its saved dossier still tells (the Steam list, the sources). */
function legacyContext(db: GuideDb, requestId: string): { context: RunContext; note: string } | undefined {
  const saved = db.getDossier(requestId) as GuideDossier | undefined;
  if (!saved) return undefined;
  const steamList: SteamAchievement[] = saved.achievements.map((a: DossierAchievement) => ({
    platform: "steam",
    apiName: a.apiName,
    name: a.nameEn,
    description: a.description,
    globalPct: a.globalPct,
    hidden: a.hidden,
    namePt: a.namePt,
    descriptionPt: a.descriptionPt,
  }));
  const urls = new Set([
    ...saved.chapters.flatMap((c) => c.items.flatMap((i) => i.sourceLinks.map((l) => l.url))),
    ...saved.achievements.flatMap((a) => a.sourceLinks.map((l) => l.url)),
    ...saved.unreadSources.map((u) => u.url),
  ]);
  const cached = extractionsOf(db);
  const sources: SourceRef[] = [];
  for (const url of urls) {
    const facts = cached.get(url);
    if (facts) sources.push(facts.source);
    else {
      const unread = saved.unreadSources.find((u) => u.url === url);
      if (unread) sources.push({ name: unread.name, url, role: "confirmacao" });
    }
  }
  const context: RunContext = {
    requestId,
    steamAppId: 0,
    gameSlug: "",
    game: {
      slug: "",
      name: `(jogo do pedido ${requestId})`,
      steamAppId: null,
      summary: null,
      developer: null,
      publisher: null,
      releaseDate: null,
      platforms: [],
      criticScore: null,
      timeToBeatCompleteMin: null,
      achievementCount: steamList.length,
    },
    steamList,
    sources,
    savedAt: "",
  };
  return {
    context,
    note: "pedido de antes do contexto salvo: lista da Steam e fontes tiradas do dossiê salvo (sem appid: nomes localizados não lidos)",
  };
}

const usd = (n: number) => `US$ ${n.toFixed(2)}`;
const tokens = (chars: number) => Math.ceil(chars / 3.5);

function cost(model: string, input: number, output: number): number | undefined {
  const price = PRICES[model] ?? Object.entries(PRICES).find(([k]) => model.startsWith(`${k}-`))?.[1];
  return price ? (input * price.in + output * price.out) / 1e6 : undefined;
}

/**
 * The writer's estimated cost (rough): the frame and every write job on MODEL_WRITER, the system prompt cached
 * after the first call, about 220 tokens of text per step and 110 per item, effort high (thinking counted as half
 * the output again); each call checked once on MODEL_FAST. Worst case: all of it a second time (the rewrite).
 */
function writerCost(dossier: GuideDossier, game: GuideDossierSource, models: DryRunInput["config"], scope?: PsnWriteScope) {
  const plan = writerPlan(dossier, game, scope);
  const system = tokens(plan.system.length);
  const calls = [
    { input: tokens(plan.frame.length), output: 4_000 },
    ...plan.jobs.map((j) => ({ input: tokens(j.message.length), output: j.steps * 220 + j.items * 110 })),
  ];
  // Cache write once (x1.25), cache reads after (x0.1), billed as input tokens.
  const writeIn = Math.round(system * 1.25 + system * 0.1 * (calls.length - 1)) + calls.reduce((n, c) => n + c.input, 0);
  const writeOut = calls.reduce((n, c) => n + c.output, 0) * 1.5;
  const checkIn = calls.reduce((n, c) => n + 1_500 + c.input + c.output, 0);
  const checkOut = calls.length * 600;
  const write = cost(models.MODEL_WRITER, writeIn, writeOut);
  const check = cost(models.MODEL_FAST, checkIn, checkOut);
  const onePass = write !== undefined && check !== undefined ? write + check : undefined;
  return { calls: calls.length, writeIn, writeOut, onePass, worst: onePass === undefined ? undefined : onePass * 2 };
}

export async function dryRun(input: DryRunInput): Promise<{ ok: boolean }> {
  const { db, config, log } = input;
  let context: RunContext | undefined;
  let note: string | undefined;
  if (input.requestId) {
    context = loadRunContext(db, input.requestId);
    if (!context) ({ context, note } = legacyContext(db, input.requestId) ?? {});
  } else if (input.appId !== undefined) {
    context = latestRunContext(db, input.appId);
  }
  if (!context) {
    const known = (db.raw.prepare("SELECT request_id FROM dossiers ORDER BY updated_at DESC").all() as unknown as { request_id: string }[]).map((r) => r.request_id);
    log(
      `ensaio: nada salvo para ${input.requestId ? `o pedido ${input.requestId}` : `o appid ${input.appId}`}.` +
        (known.length > 0 ? ` Pedidos com dossiê salvo: ${known.join(", ")} (use --pedido <id>).` : " Rode o pedido de verdade uma vez."),
    );
    return { ok: false };
  }

  log(`ensaio (sem IA, sem rede, só o cache): pedido ${context.requestId}${context.steamAppId ? `, appid ${context.steamAppId}` : ""}, ${context.game.name}`);
  if (note) log(`  aviso: ${note}`);

  // Pages and extractions, from the cache only.
  const fetchPage = cachedPage(db);
  const byUrl = extractionsOf(db);
  const facts: ExtractedFacts[] = [];
  const read: { source: SourceRef; text: string }[] = [];
  const unread: GuideDossier["unreadSources"] = [];
  let stale = 0;
  let missing = 0;
  let reextractChars = 0;
  log(`fontes (${context.sources.length}):`);
  for (const source of context.sources) {
    const page = await fetchPage(source.url);
    if (page.status !== "ok" || !page.text?.trim()) {
      unread.push({ name: source.name, url: source.url, reason: page.reason ?? "fora do cache" });
      log(`  - ${source.name}: página fora do cache`);
      continue;
    }
    const current = readCachedFacts(db, extractionKey(config.MODEL_EXTRACT, source, page.text), source);
    const old = byUrl.get(source.url);
    const found: CachedFacts | undefined = current ? { facts: current, stale: false } : old ? { facts: { ...old, source }, stale: true } : undefined;
    if (!found) {
      missing++;
      reextractChars += page.text.length;
      unread.push({ name: source.name, url: source.url, reason: "sem extração no cache" });
      log(`  - ${source.name}: sem extração no cache (a execução real pagaria a extração)`);
      continue;
    }
    if (found.stale) {
      stale++;
      reextractChars += page.text.length;
    }
    facts.push(found.facts);
    read.push({ source, text: page.text });
    const items = found.facts.chapters.reduce((n, c) => n + c.items.length, 0);
    log(
      `  - ${source.name} [${source.role}${found.facts.complete ? ", completo" : ""}]: ${found.facts.chapters.length} capítulos, ${items} itens, ` +
        `${found.facts.achievements.length} conquistas — extração ${found.stale ? "ANTIGA (prompt ou texto mudaram: a execução real extrai de novo)" : "atual"}`,
    );
  }
  if (stale + missing > 0) {
    const est = cost(config.MODEL_EXTRACT, tokens(reextractChars), Math.ceil(tokens(reextractChars) * 0.35));
    log(
      `  extração a refazer na execução real: ${stale + missing} página(s), ~${kib(reextractChars)} KiB de texto` +
        `${est !== undefined ? `, ~${usd(est)}` : ""}; os números abaixo vêm da extração antiga e vão mudar`,
    );
  }

  // Localized achievement names, from cached Steam pages only.
  let aliases = {};
  if (context.steamAppId) {
    const languages = steamLanguagesIn(read.map((r) => ({ text: r.text, language: r.source.language })));
    if (languages.length > 0) {
      const steam = context.steamList.filter((a) => a.platform === "steam");
      const result = await readSteamAliases(context.steamAppId, languages, steam, fetchPage, config.GUIDE_STEAM_REFERENCE_ID);
      aliases = result.aliases;
      for (const f of result.failed) log(`  nomes da Steam em ${f.language}: fora do cache`);
    }
  }

  const sequence: Record<string, number> = {};
  for (const r of read) {
    const n = statedSequence(r.text);
    if (n !== undefined) sequence[r.source.url] = n;
  }
  const dossier = buildDossier(context.steamList, facts, independentGroups(read.map((r) => ({ url: r.source.url, text: r.text }))), unread, aliases, sequence);

  // Gate, scope.
  const steamGate = gate(dossier, context.steamList);
  const psnGate = steamGate.ok ? undefined : gate(dossier, context.steamList, { scope: "psn" });
  const chosen = steamGate.ok ? "steam" : psnGate?.ok ? "psn" : undefined;
  log(`gate steam: ${steamGate.ok ? "passa" : `${steamGate.missing.length} lacuna(s)`}${psnGate ? `; gate psn: ${psnGate.ok ? "passa" : `${psnGate.missing.length} lacuna(s)`}` : ""}`);
  log(`escopo escolhido: ${chosen ?? "nenhum (o pedido ficaria em waiting_sources)"}`);
  for (const line of steamGate.missing) log(`  falta (steam): ${line}`);
  for (const line of psnGate?.missing ?? []) log(`  falta (psn): ${line}`);

  let toWrite = dossier;
  let scope: PsnWriteScope | undefined;
  if (chosen === "psn") ({ dossier: toWrite, scope } = psnScope(dossier, context.steamList));

  // Chapters, in order.
  const items = toWrite.chapters.flatMap((c) => c.items);
  log(`roteiro principal: ${toWrite.primaryScript?.name ?? "nenhum (nenhuma fonte de roteiro completa)"}`);
  log(`etapas do roadmap (${toWrite.facts.roadmap.length}): ${toWrite.facts.roadmap.map((r) => r.title).join(" | ") || "—"}`);
  log(`capítulos (${toWrite.chapters.length}, em ordem):`);
  for (const c of toWrite.chapters) {
    const agreed = c.items.filter((i) => i.agreed).length;
    const flags = [c.revisit ? "revisita" : "", c.orderAssumed ? "posição assumida, revisão" : ""].filter(Boolean).join(", ");
    log(`  ${String(c.order).padStart(2)}. ${c.title} — ${c.items.length} itens (${agreed} confirmados)${flags ? ` [${flags}]` : ""}`);
  }
  log(
    `itens: ${items.length}; confirmados por 2+ fontes: ${items.filter((i) => i.agreed).length}; de uma fonte só: ` +
      `${items.filter((i) => i.sources.length === 1).length}; itens de fontes secundárias sem par (só corroboram): ${toWrite.corroborationOnly.length}`,
  );
  if (toWrite.corroborationOnly.length > 0) {
    log(`${UNPLACED_TITLE} (${toWrite.corroborationOnly.length}; fora da rota, no relatório):`);
    for (const c of toWrite.corroborationOnly) {
      const flags = [
        c.missable ? `PERDÍVEL${c.missableUntil ? ` até "${c.missableUntil}"` : ""}` : "",
        c.returnLater ? "volta depois" : "",
        c.countsFor.length > 0 ? `conta para ${c.countsFor.join(", ")}` : c.countsForEn.length > 0 ? `conta para "${c.countsForEn.join('", "')}" (sem conquista da Steam que case)` : "",
      ].filter(Boolean);
      log(`  - ${c.name}${c.nameEn && c.nameEn !== c.name ? ` (${c.nameEn})` : ""} — ${c.source}, capítulo "${c.chapter}"${flags.length > 0 ? ` [${flags.join("; ")}]` : ""}`);
    }
  }
  if (toWrite.stageOnly.length > 0) {
    log(`${STAGE_ONLY_TITLE} (${toWrite.stageOnly.length}):`);
    for (const c of toWrite.stageOnly) log(`  - ${c.name} — ${c.source}, etapa "${c.chapter}"${c.missable ? " [PERDÍVEL]" : ""}`);
  }
  const warnings = toWrite.divergences.filter((d) => d.includes(UNPLACED_MARK));
  for (const w of warnings) log(`aviso: ${w}`);

  // Site limits, size, cost.
  const skeleton = buildSkeleton(toWrite);
  const limits = skeletonLimitProblems(skeleton);
  const maxSteps = Math.max(0, ...skeleton.chapters.map((c) => c.steps.length));
  const maxItems = Math.max(0, ...skeleton.chapters.flatMap((c) => c.steps.map((s) => s.items.length)));
  log(
    `limites do site: ${skeleton.chapters.length}/${SITE_LIMITS.chapters} capítulos (com a limpeza), até ${maxSteps}/${SITE_LIMITS.stepsPerChapter} passos ` +
      `por capítulo, até ${maxItems}/${SITE_LIMITS.itemsPerStep} itens por passo → ${limits.length === 0 ? "cabe" : limits.join(" ")}`,
  );
  const reportBytes = Buffer.byteLength(JSON.stringify(buildReport({ sourcesRead: [], dossier: toWrite, steamList: context.steamList, spendUsd: 0 })));
  const size = estimatePayloadBytes(skeleton, toWrite, reportBytes);
  log(
    `tamanho estimado do guia: ~${kib(size.withoutImages)} KiB sem imagens, ~${kib(size.withImages)} KiB com imagens ` +
      `(limite ${kib(SITE_LIMITS.bodyBytes)} KiB)${size.withoutImages > SITE_LIMITS.bodyBytes ? " → NÃO CABE" : ""}`,
  );
  if (size.withoutImages <= SITE_LIMITS.bodyBytes) {
    // Images are decided after writing, on the real size: the most useful first, while they fit.
    const room = Math.max(0, Math.floor((SITE_LIMITS.bodyBytes - REPORT_SLACK_BYTES - size.withoutImages) / IMAGE_BYTES));
    log(
      `imagens (decididas depois da escrita, pelo tamanho real): cabem ~${Math.min(room, items.length)} de ${items.length} pela estimativa; perdíveis primeiro, depois coletáveis contados, depois o resto`,
    );
  }
  const cached = readWriting(db, writingKey({ dossier: toWrite, scope, game: context.game, models: config }));
  log(
    cached
      ? `escrita reaproveitável do cache: sim (salva em ${cached.savedAt}); a execução real não chama a IA para escrever`
      : "escrita reaproveitável do cache: não (nenhuma escrita aprovada deste mesmo dossiê, escopo, estilo e modelos)",
  );
  const writer = writerCost(toWrite, { game: context.game, tralked: { players: 0, avgPlaytimeMin: null, completedPlayers: 0 }, achievements: context.steamList }, config, scope);
  log(
    `custo estimado da escrita: ${writer.calls} chamadas de ${config.MODEL_WRITER} (~${Math.round(writer.writeIn / 1000)}k tokens de entrada, ` +
      `~${Math.round(writer.writeOut / 1000)}k de saída) + checagem em ${config.MODEL_FAST} (estimativa grosseira): ` +
      (writer.onePass === undefined ? "sem preço para o modelo" : `~${usd(writer.onePass)} numa passada, até ~${usd(writer.worst!)} com a reescrita`),
  );
  return { ok: chosen !== undefined && limits.length === 0 && size.withoutImages <= SITE_LIMITS.bodyBytes };
}
