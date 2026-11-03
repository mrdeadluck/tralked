import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Ai } from "../ai/client.js";
import { escapeAttr, escapeText } from "../ai/escape.js";
import type { SpendBucket } from "../db.js";
import type { ContentBlock } from "../tralked.js";
import { checkScopes, FRAME_SCOPE, jobSteps, type GuideProblem } from "./checker.js";
import type { GuideConfig } from "./config.js";
import { WALK_ITEM_KINDS, type GuidePayloadV2, type WalkChapter, type WalkItem, type WalkItemKind, type WalkSource } from "./contract.js";
import { deterministicProblems, dossierTexts } from "./copy-check.js";
import type { DossierAchievement, GuideDossier, GuideDossierSource } from "./dossier.js";
import { abortOnError, inPool, type Abort } from "./pool.js";
import { buildSkeleton, isMissable, untilOf, writeJobs, type GuideSkeleton, type SkelChapter, type SkelItem, type WriteJob } from "./skeleton.js";

export { copiedRuns } from "./copy-check.js";

/**
 * The guide writer. The CODE owns the structure (skeleton.ts: chapters, steps, items and their keys) and every
 * number and flag the site checks; numbers come only from the dossier, the catalog (time to beat) or the code. The
 * model only writes the text: one "frame" call (cover, ficha texts, overview, read-first, roadmap, chapter titles)
 * and one call per write job (a run of at most 20 steps of a chapter). After a check, only the frame and the jobs a
 * problem points at are rewritten. Images and the soundtrack are added later by the pipeline.
 */

export type GuideModels = Pick<GuideConfig, "MODEL_WRITER" | "MODEL_FAST">;
export const DEFAULT_GUIDE_MODELS: GuideModels = { MODEL_WRITER: "claude-opus-5-5", MODEL_FAST: "claude-haiku-5-5" };

const WRITER_MAX_TOKENS = 16000;
const CONCURRENCY = 3;
const MAX_ITEMS_PER_STEP = 40;
const HOURS_MAX = 5000;
/** What the guide shows where there is no source for a number. */
const NO_DATA = "—";

// ---------------------------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------------------------

let styleCache: string | undefined;
/** The guide manual (system prompt). Cached by the API, so it must stay byte-stable. */
export function loadGuideStyle(): string {
  styleCache ??= readFileSync(new URL("../../prompts/guia-estilo.md", import.meta.url), "utf8");
  return styleCache;
}

const attr = escapeAttr;
const body = escapeText;

// ---------------------------------------------------------------------------------------------
// What the model fills: text only (structured outputs drop length limits: they live in the descriptions)
// ---------------------------------------------------------------------------------------------

const BlockSchema = z.object({
  tipo: z.enum(["paragrafo", "aviso", "info", "spoiler"]),
  texto: z.string().describe("Até 3 frases curtas"),
});

export const FrameSchema = z.object({
  capa: z.object({
    chamadas: z
      .array(z.object({ valor: z.string().describe("Número da ficha, até 8 caracteres"), rotulo: z.string().describe("Até 28 caracteres") }))
      .describe("Exatamente 3 chamadas tiradas da ficha"),
    manchete: z.string().describe("Até 60 caracteres"),
    linhaFina: z.string().describe("Até 90 caracteres"),
  }),
  ficha: z.object({
    dificuldade: z.number().describe("Inteiro de 1 a 10, pelos critérios do manual"),
    justificativaDificuldade: z.string().describe("Uma frase, até 160 caracteres"),
    notaZeradas: z.string().describe("O que fazer em cada zerada, até 120 caracteres"),
    maisDificil: z.string().nullable().describe("apiName da conquista mais difícil, ou null"),
  }),
  visaoGeral: z.array(z.string()).describe("Dois ou três parágrafos sem spoiler"),
  leiaAntes: z
    .array(
      z.object({
        titulo: z.string().describe("Até 60 caracteres"),
        texto: z.string().describe("Até 400 caracteres"),
        tom: z.enum(["aviso", "info"]),
        spoiler: z.boolean(),
      }),
    )
    .describe("De 1 a 8 notas; pontos de não retorno primeiro"),
  etapas: z
    .array(z.object({ key: z.string().describe("Uma das keys de etapa dadas"), titulo: z.string().describe("Até 160 caracteres"), blocos: z.array(BlockSchema) }))
    .describe("Uma por etapa dada, na mesma ordem"),
  capitulos: z
    .array(
      z.object({
        key: z.string().describe("Uma das keys de capítulo dadas"),
        fase: z.string().describe("A key da etapa do roadmap a que o capítulo pertence"),
        titulo: z.string().describe("Até 80 caracteres"),
        prazo: z.string().nullable().describe("Ponto de não retorno do capítulo, até 200 caracteres; null se não houver"),
      }),
    )
    .describe("Um por capítulo dado, na mesma ordem"),
});
export type Frame = z.infer<typeof FrameSchema>;

export const ChapterTextSchema = z.object({
  passos: z
    .array(
      z.object({
        key: z.string().describe("Uma das keys de passo dadas"),
        blocos: z.array(BlockSchema).describe("O texto do passo, na ordem de leitura; aviso de perdível antes do ponto de não retorno"),
        conquistas: z.array(z.string()).describe("apiNames das conquistas sem lugar fixo que destravam neste passo"),
      }),
    )
    .describe("Um por passo dado, na mesma ordem"),
  itens: z
    .array(
      z.object({
        key: z.string().describe("Uma das keys de item ou de conquista dadas"),
        nome: z.string().describe("Até 80 caracteres"),
        local: z.string().describe("Onde fica e como pegar, até 400 caracteres"),
        spoiler: z.boolean(),
      }),
    )
    .describe("Um por item dado, e um por conquista que você pôs num passo"),
  depois: z.string().nullable().describe("O que dá para pegar depois deste capítulo; null se nada"),
});
export type ChapterText = z.infer<typeof ChapterTextSchema>;

// ---------------------------------------------------------------------------------------------
// The ficha: numbers from the dossier, the catalog and the code only
// ---------------------------------------------------------------------------------------------

const yes = (b: boolean) => (b ? "sim" : "não");
const pct = (n: number | null) => (n === null ? "?" : `${n}%`);
const achName = (a: DossierAchievement) => a.namePt ?? a.nameEn;
const clampHours = (n: number) => Math.min(HOURS_MAX, Math.max(0, Math.round(n)));

/** Hours until the Tralked: the sources' range, else the catalog's time to beat, else none. */
function hoursOf(dossier: GuideDossier, game: GuideDossierSource): { min: number; max: number } | null {
  const h = dossier.facts.hours?.value;
  if (h && Number.isFinite(h.min) && Number.isFinite(h.max)) {
    const min = clampHours(h.min);
    return { min, max: Math.max(min, clampHours(h.max)) };
  }
  const ttb = game.game.timeToBeatCompleteMin;
  if (ttb && ttb > 0) {
    const hours = clampHours(Math.floor(ttb / 60));
    return { min: hours, max: hours };
  }
  return null;
}

function fichaOf(skel: GuideSkeleton, dossier: GuideDossier, game: GuideDossierSource) {
  const achItems = skel.chapters.flatMap((c) => c.steps.flatMap((s) => s.items)).filter((i) => i.ach);
  return {
    achievements: dossier.achievements.length,
    hidden: dossier.achievements.filter((a) => a.hidden).length,
    missables: achItems.filter(isMissable).length,
    online: dossier.achievements.filter((a) => a.online).length,
    bugged: dossier.achievements.filter((a) => a.bugged).length,
    chapters: skel.chapters.filter((c) => !c.cleanup).length,
    regions: new Set(skel.chapters.map((c) => c.region).filter(Boolean)).size,
    hours: hoursOf(dossier, game),
    playthroughs: dossier.facts.playthroughs?.value.min,
  };
}

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------

function frameMessage(skel: GuideSkeleton, dossier: GuideDossier, game: GuideDossierSource): string {
  const ficha = fichaOf(skel, dossier, game);
  const f = dossier.facts;
  const rarest = [...dossier.achievements]
    .filter((a) => a.globalPct !== null)
    .sort((a, b) => a.globalPct! - b.globalPct!)
    .slice(0, 5);
  return [
    "Escreva a moldura do guia: capa, textos da ficha, visão geral, \"leia antes\", as etapas do roadmap e o título de cada capítulo. Os números da ficha são calculados pelo sistema; você só os cita.",
    [
      "## Jogo",
      `Nome: ${body(game.game.name)}`,
      `Desenvolvedora: ${body(game.game.developer ?? "?")}; publicadora: ${body(game.game.publisher ?? "?")}`,
      game.game.summary ? `Resumo do catálogo: ${body(game.game.summary)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    [
      "## Ficha (use só estes números)",
      `- Conquistas na Steam: ${ficha.achievements} (ocultas: ${ficha.hidden})`,
      `- Perdíveis: ${ficha.missables}`,
      `- Online: ${ficha.online}`,
      `- Com bug: ${ficha.bugged}`,
      `- Capítulos do detonado: ${ficha.chapters}; regiões: ${ficha.regions}`,
      `- Horas até o Tralked: ${ficha.hours ? `${ficha.hours.min} a ${ficha.hours.max}` : "sem dado (não cite horas)"}`,
      `- Zeradas mínimas: ${f.playthroughs ? `${f.playthroughs.value.min} (${body(f.playthroughs.value.note)})` : "sem dado"}`,
      `- Dificuldade segundo as fontes (escala delas): ${f.difficulty ? `${f.difficulty.value.value} (${body(f.difficulty.value.note)})` : "sem dado"}`,
      `- Compatibilidade: ${f.compat}`,
      `- Mais raras na Steam: ${rarest.map((a) => `${a.apiName} ${pct(a.globalPct)}`).join(", ") || "sem dado"}`,
    ].join("\n"),
    ["## Etapas do roadmap (keys prontas)", ...skel.phases.map((p) => `<etapa key="${p.key}" titulo="${attr(p.title)}">${body(p.summary)}</etapa>`)].join("\n"),
    [
      "## Capítulos (keys prontas, em ordem)",
      ...skel.chapters.map((c) => {
        const items = c.steps.flatMap((s) => s.items);
        return `<capitulo key="${c.key}" titulo="${attr(c.title)}"${c.region ? ` regiao="${attr(c.region)}"` : ""} itens="${items.length}" perdiveis="${items.filter(isMissable).length}"${c.deadlines.length ? ` prazo="${attr(c.deadlines.join("; "))}"` : ""}${c.cleanup ? ' limpeza="sim"' : ""}/>`;
      }),
    ].join("\n"),
    ["## Conquistas da Steam", ...dossier.achievements.map((a) => achievementLine(a))].join("\n"),
    dossier.divergences.length > 0 ? ["## Divergências entre as fontes", ...dossier.divergences.map((d) => `- ${body(d)}`)].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const missableAttr = (missable: boolean, until?: string) => `perdivel="${missable ? `sim${until ? `, até ${attr(until)}` : ""}` : "não"}"`;

/** An achievement with everything the writer needs to explain it (howTo included). */
function achievementLine(a: DossierAchievement, key?: string, tag = "conquista"): string {
  const attrs = [
    key ? `key="${key}"` : "",
    `apiName="${attr(a.apiName)}"`,
    `nome_pt="${attr(a.namePt ?? "")}"`,
    `nome_en="${attr(a.nameEn)}"`,
    `descricao="${attr(a.descriptionPt ?? a.description ?? "")}"`,
    `oculta="${yes(a.hidden)}"`,
    `raridade="${pct(a.globalPct)}"`,
    missableAttr(a.missable, a.missableUntil),
    a.bugged ? `bug="${attr(a.bugNote ?? "sim")}"` : "",
    a.online ? 'online="sim"' : "",
    `fontes="${a.sources.length}${!a.agreed || a.conflict ? " (revisar)" : ""}"`,
  ].filter(Boolean);
  return `<${tag} ${attrs.join(" ")}>${body(a.howTo ?? "")}</${tag}>`;
}

/** A loose achievement offered for placement: just enough to recognize where it unlocks (no howTo). */
function looseLine(l: SkelItem): string {
  const a = l.ach!;
  return `<conquista key="${l.key}" apiName="${attr(a.apiName)}" nome="${attr(achName(a))}" descricao="${attr(a.descriptionPt ?? a.description ?? "")}"${a.hidden ? ' oculta="sim"' : ""}${a.missable ? ` ${missableAttr(true, a.missableUntil)}` : ""}/>`;
}

function itemLine(s: SkelItem): string {
  if (!s.item) return achievementLine(s.ach!, s.key, "item");
  const i = s.item;
  const attrs = [
    `key="${s.key}"`,
    `tipo="${attr(i.kind)}"`,
    `nome_en="${attr(i.nameEn ?? i.name)}"`,
    i.collectibleType ? `tipo_coletavel="${attr(i.collectibleType)}"` : "",
    i.index !== undefined && i.total !== undefined ? `numero="${i.index}/${i.total}"` : "",
    missableAttr(i.missable, i.missableUntil),
    `volta_depois="${yes(i.returnLater)}"`,
    s.ach ? `conquista="${attr(s.ach.apiName)}" conquista_pt="${attr(s.ach.namePt ?? "")}" conquista_en="${attr(s.ach.nameEn)}" oculta="${yes(s.ach.hidden)}"` : "",
    `fontes="${i.sources.length}${!i.agreed || i.conflict ? " (revisar)" : ""}"`,
  ].filter(Boolean);
  return `<item ${attrs.join(" ")}>${body(i.location)}</item>`;
}

/** Loose achievements this chapter may hold: all of them, except missables whose milestone chapter came before. */
function placeableIn(skel: GuideSkeleton, chapter: SkelChapter): SkelItem[] {
  if (chapter.cleanup) return [];
  const at = skel.chapters.indexOf(chapter);
  return skel.loose.filter((l) => {
    const deadline = l.ach!.missable ? l.ach!.deadlineChapter : undefined;
    if (!deadline) return true;
    const d = skel.chapters.findIndex((c) => !c.cleanup && c.title === deadline);
    return d < 0 || at <= d;
  });
}

function jobMessage(skel: GuideSkeleton, job: WriteJob, game: GuideDossierSource): string {
  const { chapter, steps } = job;
  const at = skel.chapters.indexOf(chapter);
  const prev = skel.chapters[at - 1];
  const next = skel.chapters[at + 1];
  const loose = placeableIn(skel, chapter);
  return [
    `Escreva o texto dos passos abaixo, do capítulo "${body(chapter.title)}" do guia de ${body(game.game.name)}.`,
    `<capitulo key="${chapter.key}" titulo="${attr(chapter.title)}"${chapter.region ? ` regiao="${attr(chapter.region)}"` : ""}${chapter.deadlines.length ? ` prazo="${attr(chapter.deadlines.join("; "))}"` : ""}/>`,
    `Capítulo anterior: ${prev ? body(prev.title) : "nenhum"}. Próximo: ${next ? body(next.title) : "nenhum"}.`,
    chapter.cleanup
      ? "Este é o capítulo de limpeza: cada passo traz uma conquista que não tem um ponto fixo na história. Explique como fazê-la depois da história."
      : "",
    ["## Passos (keys prontas, em ordem)", ...steps.map((s) => [`<passo key="${s.key}">`, ...s.items.map(itemLine), "</passo>"].join("\n"))].join("\n"),
    loose.length > 0
      ? [
          "## Conquistas sem lugar fixo",
          "Hoje elas estão na limpeza. Se uma delas destrava num destes passos, ponha o apiName em `conquistas` desse passo e escreva o item dela em `itens`, com a key dada.",
          ...loose.map(looseLine),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function problemsMessage(problems: string[]): string {
  return [
    "## Correções obrigatórias",
    "A checagem encontrou estes problemas na versão anterior desta parte do guia. Reescreva-a corrigindo-os; o que o dossiê não sustenta sai do texto.",
    ...problems.map((p) => `- ${p}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Text cleanup (the site's ContentBlock text rules, and its length limits)
// ---------------------------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Inline text: **bold** and *italic* only, no HTML, no script schemes, no links. */
function inline(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const t = text
    .replace(/[\u0000-\u0008\u000B-\u001F]/g, " ")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1")
    .replace(/<(?=[a-zA-Z!/?])/g, "< ")
    .replace(/(javascript|vbscript)\s*:/gi, "$1 ")
    .trim();
  return truncate(t, max);
}

/** Plain text: no markup at all. */
function plain(text: string | null | undefined, max: number): string {
  return inline(text?.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/\n+/g, " "), max);
}

function toBlocks(blocks: { tipo: string; texto: string }[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.tipo === "paragrafo") {
      const text = inline(b.texto, 5000);
      if (text) out.push({ type: "paragraph", text });
    } else {
      const text = inline(b.texto, 2000);
      const tone = b.tipo === "aviso" || b.tipo === "spoiler" ? b.tipo : "info";
      if (text) out.push({ type: "callout", tone, text });
    }
  }
  return out;
}

const HTTP_URL = /^https?:\/\/[^\s<>]+$/i;

/** Unique http(s) links, at most `max` (an item takes 10). */
function walkSources(links: { name: string; url: string }[], max = 10): WalkSource[] {
  const seen = new Set<string>();
  const out: WalkSource[] = [];
  for (const l of links) {
    if (!HTTP_URL.test(l.url) || seen.has(l.url)) continue;
    seen.add(l.url);
    out.push({ name: plain(l.name, 120) || "Fonte", url: l.url });
  }
  return out.slice(0, max);
}

/** Every page the dossier read, for the guide's "Fontes" list (the site keeps at most 30). */
function guideSources(dossier: GuideDossier): { title: string; url: string }[] {
  const links = [...dossier.chapters.flatMap((c) => c.items.flatMap((i) => i.sourceLinks)), ...dossier.achievements.flatMap((a) => a.sourceLinks)];
  return walkSources(links, 30).map((s) => ({ title: plain(s.name, 200), url: s.url }));
}

function kindOf(s: SkelItem): WalkItemKind {
  if (s.ach) return "achievement";
  const k = (s.item?.kind ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if ((WALK_ITEM_KINDS as readonly string[]).includes(k)) return k as WalkItemKind;
  if (/trophy|conquista/.test(k)) return "achievement";
  if (/quest|miss/.test(k)) return "mission";
  if (/key/.test(k)) return "key_item";
  if (/boss|chefe/.test(k)) return "boss";
  if (/collect|colet/.test(k)) return "collectible";
  return "other";
}

// ---------------------------------------------------------------------------------------------
// Drafting: the model calls
// ---------------------------------------------------------------------------------------------

export type WriteGuideOpts = {
  models?: GuideModels;
  /** Server-side fallbacks; defaults to `bucket === "live"`. */
  fallbacks?: boolean;
};

type Ctx = {
  ai: Ai;
  dossier: GuideDossier;
  game: GuideDossierSource;
  bucket: SpendBucket;
  models: GuideModels;
  fallbacks: boolean;
  skel: GuideSkeleton;
  jobs: WriteJob[];
};

/** The model's texts: the frame and one answer per write job (by job id). */
type Texts = { frame: Frame; jobs: Map<string, ChapterText> };

function context(ai: Ai, dossier: GuideDossier, game: GuideDossierSource, bucket: SpendBucket, opts: WriteGuideOpts): Ctx {
  const skel = buildSkeleton(dossier);
  return {
    ai,
    dossier,
    game,
    bucket,
    models: opts.models ?? DEFAULT_GUIDE_MODELS,
    fallbacks: opts.fallbacks ?? bucket === "live",
    skel,
    jobs: writeJobs(skel),
  };
}

/**
 * Asks the model for the texts. Without `previous`, everything; with it, only the frame and the jobs some problem
 * points at (each call gets only its own problems), keeping the other texts. The first failing call stops the rest.
 */
async function draft(ctx: Ctx, previous?: Texts, problems: GuideProblem[] = []): Promise<Texts> {
  const own = (scope: string) => problems.filter((p) => p.scope === scope).map((p) => p.text);
  const call = <T>(purpose: string, user: string, schema: z.ZodType<T>, fixes: string[]) =>
    ctx.ai.structured({
      bucket: ctx.bucket,
      purpose: previous ? `${purpose}-retry` : purpose,
      model: ctx.models.MODEL_WRITER,
      effort: "high",
      system: loadGuideStyle(),
      user: fixes.length > 0 ? `${user}\n\n${problemsMessage(fixes)}` : user,
      schema,
      maxTokens: WRITER_MAX_TOKENS,
      fallbacks: ctx.fallbacks,
    });

  const redoFrame = !previous || own(FRAME_SCOPE).length > 0;
  const redoJobs = ctx.jobs.filter((j) => !previous || own(j.id).length > 0);
  const abort: Abort = { aborted: false };
  const [frame, answers] = await Promise.all([
    redoFrame
      ? abortOnError(call("guide-write-frame", frameMessage(ctx.skel, ctx.dossier, ctx.game), FrameSchema, own(FRAME_SCOPE)), abort)
      : Promise.resolve(previous!.frame),
    inPool(redoJobs, CONCURRENCY, (job) => call("guide-write-chapter", jobMessage(ctx.skel, job, ctx.game), ChapterTextSchema, own(job.id)), abort),
  ]);
  const jobs = new Map(previous?.jobs ?? []);
  redoJobs.forEach((job, n) => jobs.set(job.id, answers[n]!));
  return { frame, jobs };
}

// ---------------------------------------------------------------------------------------------
// Assembly: the model's text on the code's skeleton
// ---------------------------------------------------------------------------------------------

/** The payload plus what the code had to fill or correct, as problems scoped to the call that should fix it. */
export type WrittenGuide = { payload: GuidePayloadV2; repairs: GuideProblem[] };

function assemble(ctx: Ctx, texts: Texts): WrittenGuide {
  const { skel, dossier, game, jobs } = ctx;
  const frame = texts.frame;
  const repairs: GuideProblem[] = [];
  const jobOfStep = new Map(jobs.flatMap((j) => j.steps.map((s) => [s.key, j.id] as const)));
  const scopeOfStep = (stepKey: string) => jobOfStep.get(stepKey) ?? FRAME_SCOPE;
  const steamApiNames = new Set(dossier.achievements.map((a) => a.apiName));
  const itemKeys = new Set([...skel.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => i.key))), ...skel.loose.map((l) => l.key)]);
  const chapterAt = (title: string) => skel.chapters.findIndex((c) => !c.cleanup && c.title === title);

  // --- the model's texts, by key (unknown keys are dropped) -------------------------------------------------
  const stepBlocks = new Map<string, ContentBlock[]>();
  const itemText = new Map<string, ChapterText["itens"][number]>();
  const laterNote = new Map<string, string>();
  const answered = jobs.map((job) => ({ job, text: texts.jobs.get(job.id)! }));
  // Cleanup texts first: a loose achievement keeps the cleanup text unless a chapter places it (below).
  const ordered = [...answered.filter((a) => a.job.chapter.cleanup), ...answered.filter((a) => !a.job.chapter.cleanup)];
  for (const { job, text } of ordered) {
    const own = new Set(job.steps.map((s) => s.key));
    for (const step of text.passos) if (own.has(step.key)) stepBlocks.set(step.key, toBlocks(step.blocos));
    for (const i of text.itens) if (itemKeys.has(i.key) && !itemText.has(i.key)) itemText.set(i.key, i);
    if (text.depois) laterNote.set(job.chapter.key, text.depois);
  }

  // --- placement of the loose achievements --------------------------------------------------------------------
  const looseBy = new Map(skel.loose.map((l) => [l.ach!.apiName, l]));
  const stepsOf = new Map<string, SkelItem[]>();
  for (const c of skel.chapters) for (const s of c.steps) stepsOf.set(s.key, c.cleanup ? [] : [...s.items]);
  /** A step surely before the milestone's chapter: the end of the chapter before it, or the start of the first one. */
  const stepBefore = (title: string) => {
    const at = chapterAt(title);
    if (at < 0) return undefined;
    const prev = skel.chapters[at - 1];
    return prev && !prev.cleanup ? prev.steps[prev.steps.length - 1]?.key : skel.chapters[at]!.steps[0]?.key;
  };
  const hasRoom = (stepKey: string) => (stepsOf.get(stepKey)?.length ?? MAX_ITEMS_PER_STEP) < MAX_ITEMS_PER_STEP;
  /** `start`, or the nearest earlier story step that still has room for an item (earlier is still before the deadline). */
  const storySteps = skel.chapters.filter((c) => !c.cleanup).flatMap((c) => c.steps.map((s) => s.key));
  const withRoomFrom = (start: string | undefined) => {
    for (let i = start ? storySteps.indexOf(start) : -1; i >= 0; i--) if (hasRoom(storySteps[i]!)) return storySteps[i];
    return undefined;
  };
  const placement = new Map<string, string>(); // loose apiName -> step key
  // The first job (in reading order) that puts a loose achievement in one of its steps wins, with its text.
  for (const { job, text } of answered) {
    if (job.chapter.cleanup) continue;
    for (const step of text.passos) {
      if (!job.steps.some((s) => s.key === step.key)) continue;
      for (const apiName of step.conquistas) {
        const l = looseBy.get(apiName);
        if (!l || placement.has(apiName)) continue;
        const a = l.ach!;
        // A missable may not be placed after the chapter of its point of no return.
        const deadline = a.missable && a.deadlineChapter ? chapterAt(a.deadlineChapter) : -1;
        if (deadline >= 0 && skel.chapters.indexOf(job.chapter) > deadline) {
          repairs.push({
            scope: job.id,
            text: `A conquista perdível "${achName(a)}" (${a.apiName}) foi posta no passo ${step.key}, depois do capítulo "${a.deadlineChapter}" em que ela se perde. Tire-a deste capítulo.`,
          });
          continue;
        }
        // The site takes at most 40 items per step; placements count as soon as they are made.
        if (!hasRoom(step.key)) {
          repairs.push({
            scope: job.id,
            text: `O passo ${step.key} já tem ${MAX_ITEMS_PER_STEP} itens; a conquista "${achName(a)}" (${a.apiName}) não coube nele. Distribua as conquistas entre os passos.`,
          });
          continue;
        }
        placement.set(apiName, step.key);
        stepsOf.get(step.key)!.push(l);
        const own = text.itens.find((i) => i.key === l.key);
        if (own) itemText.set(l.key, own);
      }
    }
  }
  for (const l of skel.loose) {
    const a = l.ach!;
    if (placement.has(a.apiName)) continue;
    let target: string | undefined;
    if (a.missable && a.deadlineChapter) {
      target = withRoomFrom(stepBefore(a.deadlineChapter));
      repairs.push({
        scope: target ? scopeOfStep(target) : FRAME_SCOPE,
        text: target
          ? `A conquista perdível "${achName(a)}" (${a.apiName}) não foi posta num passo; o sistema a pôs no passo ${target}, antes do capítulo "${a.deadlineChapter}". Ponha-a no passo certo, antes do ponto de não retorno, e escreva o item dela.`
          : `A conquista perdível "${achName(a)}" (${a.apiName}) não coube em nenhum passo antes do capítulo "${a.deadlineChapter}" e ficou na limpeza.`,
      });
    }
    // Otherwise its default cleanup step (one loose achievement per step, so always with room).
    target ??= skel.chapters.find((c) => c.cleanup)!.steps.find((s) => s.items.includes(l))!.key;
    stepsOf.get(target)!.push(l);
  }

  // --- items ----------------------------------------------------------------------------------------------------
  const fallbackSources = (): WalkSource[] =>
    game.game.steamAppId ? [{ name: "Steam", url: `https://steamcommunity.com/stats/${game.game.steamAppId}/achievements` }] : [];
  const compatSteamOnly = dossier.facts.compat === "steam_only";

  const buildItem = (s: SkelItem, stepKey: string): WalkItem => {
    const t = itemText.get(s.key);
    const i = s.item;
    const a = s.ach;
    let name: string;
    let nameEn: string | undefined;
    if (a) {
      name = plain(achName(a), 80);
      nameEn = a.namePt && a.namePt !== a.nameEn ? plain(a.nameEn, 80) : undefined;
    } else {
      const en = i!.nameEn ?? i!.name;
      name = plain(t?.nome, 80) || plain(en, 80) || "Item";
      nameEn = name.toLowerCase() !== en.toLowerCase() ? plain(en, 80) || undefined : undefined;
    }
    let location = inline(t?.local, 400);
    if (!location) {
      repairs.push({ scope: scopeOfStep(stepKey), text: `O item "${name}" (${s.key}) ficou sem texto próprio de local; escreva onde fica e como pegar.` });
      location = inline(i?.location || a?.howTo || a?.descriptionPt || a?.description, 400);
    }
    const index = i?.index;
    const total = i?.total;
    const counted = index !== undefined && total !== undefined && Number.isInteger(index) && Number.isInteger(total) && index >= 1 && index <= total;
    const sources = walkSources([...(i?.sourceLinks ?? []), ...(a?.sourceLinks ?? [])]);
    const type = i?.collectibleType ? plain(i.collectibleType, 40) : "";
    return {
      key: s.key,
      kind: kindOf(s),
      name,
      ...(nameEn ? { nameEn } : {}),
      ...(type ? { collectibleType: type } : {}),
      ...(counted ? { index, total } : {}),
      ...(location ? { location } : {}),
      missable: isMissable(s),
      returnLater: Boolean(i?.returnLater),
      spoiler: Boolean(t?.spoiler || a?.hidden || i?.kind.toLowerCase() === "boss"),
      ...(a && steamApiNames.has(a.apiName) ? { achievement: a.apiName } : {}),
      countsFor: [...new Set(i?.countsFor ?? [])].filter((x) => steamApiNames.has(x)).slice(0, 20),
      alsoOn: a && compatSteamOnly && !a.steamOnly ? ["psn"] : [],
      sources: sources.length > 0 ? sources : fallbackSources(),
      review: Boolean((i && (!i.agreed || i.conflict)) || (a && (!a.agreed || a.conflict)) || sources.length === 0),
    };
  };

  // --- chapters -------------------------------------------------------------------------------------------------
  const phaseKeys = new Set(skel.phases.map((p) => p.key));
  const metaBy = new Map(frame.capitulos.map((c) => [c.key, c]));
  const chapters: WalkChapter[] = [];
  let lastPhase = skel.phases[0]!.key;
  for (const c of skel.chapters) {
    const meta = metaBy.get(c.key);
    const steps = c.steps.map((s) => ({ s, items: stepsOf.get(s.key)! })).filter(({ items }) => !c.cleanup || items.length > 0);
    if (steps.length === 0) continue;
    const phaseKey = meta && phaseKeys.has(meta.fase) ? meta.fase : c.cleanup ? skel.phases[skel.phases.length - 1]!.key : lastPhase;
    lastPhase = phaseKey;
    let deadline = c.deadlines.length > 0 ? plain(meta?.prazo, 200) : "";
    if (c.deadlines.length > 0 && !deadline) {
      repairs.push({ scope: FRAME_SCOPE, text: `O capítulo "${c.title}" (${c.key}) tem perdíveis, mas ficou sem o prazo (ponto de não retorno).` });
      deadline = plain(c.deadlines.join("; "), 200);
    }
    const walkSteps = steps.map(({ s, items }, n) => {
      const walkItems = items.map((item) => buildItem(item, s.key));
      // Room for the code's missable warning and "later" note within the site's 20 blocks.
      let blocks = (stepBlocks.get(s.key) ?? []).slice(0, 18);
      if (blocks.length === 0) {
        repairs.push({ scope: scopeOfStep(s.key), text: `O passo ${s.key} do capítulo "${c.title}" ficou sem texto; escreva o caminho deste passo.` });
        blocks = [{ type: "paragraph", text: walkItems.length > 0 ? `Neste ponto: ${walkItems.map((i) => i.name).join(", ")}.` : "Siga em frente pela história." }];
      }
      // The missable warning comes first in the step, before the text that leads past the point of no return.
      const warn = items.filter((x) => isMissable(x) && !x.item?.returnLater);
      if (warn.length > 0 && !blocks.some((b) => b.type === "callout" && b.tone === "aviso")) {
        const names = walkItems
          .filter((i) => warn.some((x) => x.key === i.key))
          .map((i) => (i.spoiler ? "o item deste passo" : `**${i.name}**`))
          .join(", ");
        // No milestone here: it often names a boss (spoiler). The chapter's `deadline` carries it.
        blocks = [{ type: "callout", tone: "aviso", text: inline(`Perdível: pegue ${names} agora, antes de seguir.`, 2000) }, ...blocks];
      }
      if (n === steps.length - 1 && laterNote.has(c.key)) {
        const text = inline(laterNote.get(c.key), 2000);
        if (text) blocks = [...blocks, { type: "callout", tone: "info", text }];
      }
      return { key: s.key, body: blocks, items: walkItems };
    });
    chapters.push({
      key: c.key,
      phaseKey,
      title: plain(meta?.titulo, 80) || plain(c.title, 80) || "Capítulo",
      ...(c.region && plain(c.region, 120) ? { region: plain(c.region, 120) } : {}),
      // The dossier has no per-chapter time: no source, no number.
      hours: NO_DATA,
      ...(deadline ? { deadline } : {}),
      steps: walkSteps,
    });
  }

  // --- roadmap (payload steps) --------------------------------------------------------------------------------
  const allItems = chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
  const phaseText = new Map(frame.etapas.map((e) => [e.key, e]));
  const steps = skel.phases.map((p) => {
    const t = phaseText.get(p.key);
    let blocks = t ? toBlocks(t.blocos) : [];
    if (blocks.length === 0) {
      repairs.push({ scope: FRAME_SCOPE, text: `A etapa "${p.title}" (${p.key}) do roadmap ficou sem texto.` });
      blocks = [{ type: "paragraph", text: "Siga os capítulos desta etapa, na ordem." }];
    }
    const achievements = [
      ...new Set(chapters.filter((c) => c.phaseKey === p.key).flatMap((c) => c.steps.flatMap((s) => s.items.flatMap((i) => (i.achievement ? [i.achievement] : []))))),
    ].slice(0, 200);
    return { key: p.key, title: plain(t?.titulo, 160) || plain(p.title, 160) || "Etapa", hours: NO_DATA, body: blocks.slice(0, 120), achievements };
  });

  // --- ficha and cover ----------------------------------------------------------------------------------------
  const ficha = fichaOf(skel, dossier, game);
  const missables = allItems.filter((i) => i.missable && i.kind === "achievement").length;
  // No source for the hours: zero, as the site's schema has no "unknown". Never a number from the model.
  const hours = ficha.hours ?? { min: 0, max: 0 };
  const difficulty = Math.min(10, Math.max(1, Math.round(Number.isFinite(frame.ficha.dificuldade) ? frame.ficha.dificuldade : 5)));

  // A call's number has to be one of the ficha's ("5/10" counts as 5; "1,5%" as a Steam rarity).
  const fichaNumbers = new Set(
    [
      ficha.achievements, ficha.hidden, missables, ficha.online, ficha.bugged, ficha.chapters, ficha.regions, difficulty,
      ...(ficha.hours ? [hours.min, hours.max] : []),
      ...(ficha.playthroughs !== undefined ? [ficha.playthroughs] : []),
      ...dossier.achievements.flatMap((a) => (a.globalPct === null ? [] : [a.globalPct])),
    ].map(Number),
  );
  const fromFicha = (value: string) => {
    const numbers = value.replace(/\/10\b/, "").replace(/(\d),(\d)/g, "$1.$2").match(/\d+(?:\.\d+)?/g) ?? [];
    return numbers.length > 0 && numbers.every((n) => fichaNumbers.has(Number(n)));
  };
  const calls = frame.capa.chamadas
    .map((c) => ({ value: plain(c.valor, 8), label: plain(c.rotulo, 28) }))
    .filter((c) => c.value && c.label && fromFicha(c.value))
    .slice(0, 3);
  if (calls.length < 3) repairs.push({ scope: FRAME_SCOPE, text: "A capa precisa de exatamente 3 chamadas com números da ficha." });
  const defaults = [
    ...(missables > 0 ? [{ value: String(missables), label: missables === 1 ? "Perdível" : "Perdíveis" }] : []),
    ...(ficha.online === 0 ? [{ value: "0", label: "Online" }] : []),
    ficha.regions > 1 ? { value: String(ficha.regions), label: "Regiões" } : { value: String(ficha.chapters), label: "Capítulos" },
    { value: String(ficha.achievements), label: "Conquistas" },
    { value: `${difficulty}/10`, label: "Dificuldade" },
  ];
  for (const d of defaults) {
    if (calls.length >= 3) break;
    if (!calls.some((c) => c.label.toLowerCase() === d.label.toLowerCase())) calls.push(d);
  }

  const sealHours = !ficha.hours ? NO_DATA : hours.min === hours.max ? `${hours.min} h` : `${hours.min}–${hours.max} h`.slice(0, 12);

  let hardest = frame.ficha.maisDificil && steamApiNames.has(frame.ficha.maisDificil) ? frame.ficha.maisDificil : null;
  if (!hardest) {
    const rarest = [...dossier.achievements].filter((a) => a.globalPct !== null).sort((a, b) => a.globalPct! - b.globalPct!)[0];
    hardest = rarest?.apiName ?? null;
  }

  const readFirst = frame.leiaAntes
    .map((r) => ({ title: plain(r.titulo, 60), text: inline(r.texto, 400), tone: r.tom, spoiler: r.spoiler }))
    .filter((r) => r.title && r.text)
    .slice(0, 8);
  if (readFirst.length === 0) {
    repairs.push({ scope: FRAME_SCOPE, text: 'O "leia antes" ficou vazio.' });
    readFirst.push({
      title: "Antes de começar",
      text: missables > 0 ? `Este guia tem ${missables} conquistas perdíveis. Os avisos aparecem antes de cada ponto de não retorno.` : "Nenhuma conquista é perdível: dá para voltar depois e pegar o que faltar.",
      tone: missables > 0 ? "aviso" : "info",
      spoiler: false,
    });
  }

  const need = (text: string, fallback: string, what: string) => {
    if (text) return text;
    repairs.push({ scope: FRAME_SCOPE, text: `Faltou ${what}.` });
    return fallback;
  };

  const payload: GuidePayloadV2 = {
    game: { slug: game.game.slug },
    format: 2,
    status: "review",
    facts: {
      difficulty,
      hoursMin: hours.min,
      hoursMax: hours.max,
      playthroughs: ficha.playthroughs !== undefined ? String(ficha.playthroughs) : NO_DATA,
      missables,
      online: ficha.online,
    },
    overview: frame.visaoGeral.map((p) => plain(p, 1000)).filter(Boolean).slice(0, 20),
    steps,
    sources: guideSources(dossier),
    walkthrough: {
      cover: {
        calls,
        sealHours,
        headline: need(plain(frame.capa.manchete, 60), plain(game.game.name, 60), "a manchete da capa"),
        deck: need(plain(frame.capa.linhaFina, 90), "Do início ao Tralked, na ordem do jogo.", "a linha fina da capa"),
      },
      extraFacts: {
        buggedCount: ficha.bugged,
        hardest: hardest ? { apiName: hardest } : null,
        playthroughsNote: need(plain(frame.ficha.notaZeradas, 120), "Veja o roadmap.", "a nota das zeradas"),
        difficultyNote: need(plain(frame.ficha.justificativaDificuldade, 160), `${difficulty}/10.`, "a justificativa da dificuldade"),
      },
      compat: dossier.facts.compat,
      readFirst,
      chapters,
    },
  };
  return { payload, repairs };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Writes the guide and reports what the code had to fill or correct (as scoped problems). */
export async function writeGuideDetailed(
  ai: Ai,
  dossier: GuideDossier,
  game: GuideDossierSource,
  bucket: SpendBucket,
  opts: WriteGuideOpts = {},
): Promise<WrittenGuide> {
  const ctx = context(ai, dossier, game, bucket, opts);
  return assemble(ctx, await draft(ctx));
}

/** Writes the guide: structure and numbers from the dossier, text from `MODEL_WRITER`. No images, no soundtrack. */
export async function writeGuide(
  ai: Ai,
  dossier: GuideDossier,
  game: GuideDossierSource,
  bucket: SpendBucket,
  opts: WriteGuideOpts = {},
): Promise<GuidePayloadV2> {
  return (await writeGuideDetailed(ai, dossier, game, bucket, opts)).payload;
}

export type GuideWriteResult = { ok: true; payload: GuidePayloadV2 } | { ok: false; problems: string[]; payload: GuidePayloadV2 };

export type WriteAndCheckOpts = WriteGuideOpts & {
  /** Text of the source pages, for the copy check; defaults to the source texts the dossier carries. */
  sourceTexts?: string[];
};

/** Item keys per job, as they ended up in the payload: a job whose items changed must be checked again. */
function jobSignature(payload: GuidePayloadV2, job: WriteJob): string {
  return jobSteps(payload, job)
    .map((s) => `${s.key}:${s.items.map((i) => i.key).join(",")}`)
    .join("|");
}

/**
 * Writes and checks: the code's repairs, the deterministic checks (copy, vocabulary), then the LLM checker per
 * frame and per job. With problems, rewrites once only the frame and the jobs they point at, then checks again
 * (the LLM only where the text or the items changed). `ok: false` after that: the pipeline marks the request
 * `failed`.
 */
export async function writeAndCheckGuide(
  ai: Ai,
  dossier: GuideDossier,
  game: GuideDossierSource,
  bucket: SpendBucket,
  opts: WriteAndCheckOpts = {},
): Promise<GuideWriteResult> {
  const ctx = context(ai, dossier, game, bucket, opts);
  const sources = opts.sourceTexts ?? dossierTexts(dossier);
  const checkOpts = { bucket, model: ctx.models.MODEL_FAST };

  const deterministic = (written: WrittenGuide): GuideProblem[] => {
    const stepOfItem = new Map(written.payload.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => [i.key, s.key] as const))));
    const jobOfStep = new Map(ctx.jobs.flatMap((j) => j.steps.map((s) => [s.key, j.id] as const)));
    const scopeOf = (key: string | null) => (key === null ? FRAME_SCOPE : (jobOfStep.get(stepOfItem.get(key) ?? key) ?? FRAME_SCOPE));
    return [...written.repairs, ...deterministicProblems(written.payload, sources).map((p) => ({ text: p.text, scope: scopeOf(p.key) }))];
  };

  const firstTexts = await draft(ctx);
  const first = assemble(ctx, firstTexts);
  const firstProblems = [
    ...deterministic(first),
    ...(await checkScopes(ai, first.payload, dossier, ctx.skel, { frame: true, jobs: ctx.jobs }, checkOpts)),
  ];
  if (firstProblems.length === 0) return { ok: true, payload: first.payload };

  const secondTexts = await draft(ctx, firstTexts, firstProblems);
  const second = assemble(ctx, secondTexts);
  const rewritten = new Set(firstProblems.map((p) => p.scope));
  const recheck = ctx.jobs.filter((j) => rewritten.has(j.id) || jobSignature(first.payload, j) !== jobSignature(second.payload, j));
  const secondProblems = [
    ...deterministic(second),
    ...(await checkScopes(ai, second.payload, dossier, ctx.skel, { frame: rewritten.has(FRAME_SCOPE), jobs: recheck }, checkOpts)),
  ];
  if (secondProblems.length === 0) return { ok: true, payload: second.payload };
  return { ok: false, problems: [...new Set(secondProblems.map((p) => p.text))], payload: second.payload };
}
