import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Ai } from "../ai/client.js";
import { escapeAttr, escapeText } from "../ai/escape.js";
import type { SpendBucket } from "../db.js";
import type { ContentBlock } from "../tralked.js";
import { checkGuide } from "./checker.js";
import type { GuideConfig } from "./config.js";
import { WALK_ITEM_KINDS, type GuidePayloadV2, type WalkChapter, type WalkItem, type WalkItemKind, type WalkSource } from "./contract.js";
import type { DossierAchievement, DossierChapter, DossierItem, GuideDossier, GuideDossierSource } from "./dossier.js";

/**
 * The guide writer. The CODE owns the structure: chapters, steps and items come from the dossier, with keys made
 * here (slug of the title + index), so the same dossier always gives the same keys and readers' checkmarks survive
 * an update. Every flag the site checks (achievement, countsFor, missable, review, sources) is also set here. The
 * model only writes the text: one "frame" call (cover, ficha, overview, read-first, roadmap, chapter titles) and one
 * call per batch of steps of a chapter (step bodies, item names and locations, where each loose achievement unlocks).
 * Images and the soundtrack are added later by the pipeline.
 */

export type GuideModels = Pick<GuideConfig, "MODEL_WRITER" | "MODEL_FAST">;
export const DEFAULT_GUIDE_MODELS: GuideModels = { MODEL_WRITER: "claude-opus-5-5", MODEL_FAST: "claude-haiku-5-5" };

/** Steps written per model call: keeps each answer far below the non-streaming output limit. */
const STEPS_PER_CALL = 20;
const WRITER_MAX_TOKENS = 16000;
const CONCURRENCY = 3;
const MAX_STEPS_PER_CHAPTER = 80;
const MAX_ITEMS_PER_STEP = 40;
const KEY_MAX = 80;

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
// Keys
// ---------------------------------------------------------------------------------------------

/** Lowercase ASCII letters, digits and single hyphens (the site's STEP_KEY_PATTERN), at most `max` characters. */
export function slugify(text: string, max = 40): string {
  const slug = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug;
}

/** One key namespace: a repeated base gets "-2", "-3"... in claim order, which is the dossier order. */
function keyClaimer() {
  const used = new Set<string>();
  return (base: string, fallback: string) => {
    const root = (slugify(base, KEY_MAX - 4) || fallback).slice(0, KEY_MAX - 4).replace(/-+$/g, "");
    let key = root;
    for (let n = 2; used.has(key); n++) key = `${root}-${n}`;
    used.add(key);
    return key;
  };
}

// ---------------------------------------------------------------------------------------------
// Skeleton: the guide's structure, from the dossier only
// ---------------------------------------------------------------------------------------------

type SkelItem = { key: string; item: DossierItem | null; ach: DossierAchievement | null };
type SkelStep = { key: string; items: SkelItem[] };
type SkelChapter = {
  key: string;
  title: string;
  region?: string;
  cleanup: boolean;
  steps: SkelStep[];
  /** "Until X" milestones after which this chapter's missables are lost (the site's `chapter.deadline`). */
  deadlines: string[];
};
type SkelPhase = { key: string; title: string; summary: string };

export type GuideSkeleton = {
  phases: SkelPhase[];
  chapters: SkelChapter[];
  /** Achievements no dossier item IS: they start in the cleanup chapter and the model may move them. */
  loose: SkelItem[];
};

function chunk<T>(list: T[], parts: number): T[][] {
  const size = Math.max(1, Math.ceil(list.length / parts));
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Deterministic: the same dossier always gives the same keys. */
export function buildSkeleton(dossier: GuideDossier): GuideSkeleton {
  const claim = keyClaimer();
  const achBy = new Map(dossier.achievements.map((a) => [a.apiName, a]));

  /** The milestones after which the missables OF this chapter are lost (the site's `chapter.deadline`). */
  const deadlinesOf = (chapter: DossierChapter) => {
    const set = new Set<string>();
    for (const i of chapter.items) {
      const until = untilOf(i, i.achievement ? achBy.get(i.achievement) : undefined);
      if (until) set.add(until);
    }
    return [...set];
  };

  const itemKey = (chapter: DossierChapter, item: DossierItem) => {
    if (item.achievement) return claim(`conq-${item.achievement}`, "conq");
    const what = item.index !== undefined ? `${item.collectibleType ?? item.nameEn ?? item.name} ${item.index}` : (item.nameEn ?? item.name);
    return claim(`${slugify(chapter.title, 30)}-${slugify(what, 44)}`, "item");
  };

  const chapters: SkelChapter[] = [...dossier.chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => {
      const key = claim(slugify(chapter.title, 50), "capitulo");
      const groups = chapter.items.length === 0 ? [[]] : chunk(chapter.items, MAX_STEPS_PER_CHAPTER);
      const steps = groups.map((group, n) => ({ key: claim(`${key}-${n + 1}`, key), items: [] as SkelItem[], group }));
      for (const step of steps) {
        step.items = step.group.map((item) => ({
          key: itemKey(chapter, item),
          item,
          ach: item.achievement ? (achBy.get(item.achievement) ?? null) : null,
        }));
      }
      return {
        key,
        title: chapter.title,
        region: chapter.region,
        cleanup: false,
        steps: steps.map(({ key: k, items }) => ({ key: k, items })),
        deadlines: deadlinesOf(chapter),
      };
    });

  const asItem = new Set(dossier.chapters.flatMap((c) => c.items.map((i) => i.achievement).filter(Boolean)));
  const loose: SkelItem[] = dossier.achievements
    .filter((a) => !asItem.has(a.apiName))
    .map((a) => ({ key: claim(`conq-${a.apiName}`, "conq"), item: null, ach: a }));

  if (loose.length > 0) {
    const key = claim("limpeza", "limpeza");
    const steps = chunk(loose, MAX_STEPS_PER_CHAPTER).map((items, n) => ({ key: claim(`${key}-${n + 1}`, key), items }));
    chapters.push({ key, title: "Limpeza", cleanup: true, steps, deadlines: [] });
  }

  const phaseClaim = keyClaimer();
  const roadmap = dossier.facts.roadmap.length > 0 ? dossier.facts.roadmap : [{ title: "Do início ao Tralked", summary: "" }];
  const phases = roadmap.map((r) => ({ key: phaseClaim(`etapa-${r.title}`, "etapa"), title: r.title, summary: r.summary }));
  if (dossier.facts.roadmap.length === 0 && loose.length > 0) {
    phases.push({ key: phaseClaim("etapa-limpeza", "etapa"), title: "Limpeza", summary: "" });
  }

  return { phases, chapters, loose };
}

// ---------------------------------------------------------------------------------------------
// What the model fills (structured outputs drop length limits: they live in the descriptions)
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
    zeradas: z.string().describe("Mínimo de zeradas, até 80 caracteres"),
    notaZeradas: z.string().describe("Até 120 caracteres"),
    horasMin: z.number().nullable(),
    horasMax: z.number().nullable(),
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
    .array(
      z.object({
        key: z.string().describe("Uma das keys de etapa dadas"),
        titulo: z.string().describe("Até 160 caracteres"),
        horas: z.string().describe("Até 40 caracteres, ex.: 10 a 12 h"),
        blocos: z.array(BlockSchema),
      }),
    )
    .describe("Uma por etapa dada, na mesma ordem"),
  capitulos: z
    .array(
      z.object({
        key: z.string().describe("Uma das keys de capítulo dadas"),
        fase: z.string().describe("A key da etapa do roadmap a que o capítulo pertence"),
        titulo: z.string().describe("Até 80 caracteres"),
        horas: z.string().describe("Até 40 caracteres"),
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
// Prompts
// ---------------------------------------------------------------------------------------------

const yes = (b: boolean) => (b ? "sim" : "não");
const pct = (n: number | null) => (n === null ? "?" : `${n}%`);
const achName = (a: DossierAchievement) => a.namePt ?? a.nameEn;

function hoursOf(dossier: GuideDossier, game: GuideDossierSource): { min: number; max: number } | null {
  const h = dossier.facts.hours?.value;
  if (h && Number.isFinite(h.min) && Number.isFinite(h.max)) {
    const min = Math.max(0, Math.round(h.min));
    return { min, max: Math.max(min, Math.round(h.max)) };
  }
  const ttb = game.game.timeToBeatCompleteMin;
  if (ttb && ttb > 0) {
    const hours = Math.floor(ttb / 60);
    return { min: hours, max: hours };
  }
  return null;
}

/** The ficha numbers, computed by code; the cover calls and the checker use the same ones. */
function fichaOf(skel: GuideSkeleton, dossier: GuideDossier, game: GuideDossierSource) {
  const achItems = skel.chapters.flatMap((c) => c.steps.flatMap((s) => s.items)).filter((i) => i.ach);
  const regions = new Set(skel.chapters.map((c) => c.region).filter(Boolean));
  return {
    achievements: dossier.achievements.length,
    hidden: dossier.achievements.filter((a) => a.hidden).length,
    missables: achItems.filter((i) => isMissable(i)).length,
    online: dossier.achievements.filter((a) => a.online).length,
    bugged: dossier.achievements.filter((a) => a.bugged).length,
    chapters: skel.chapters.filter((c) => !c.cleanup).length,
    regions: regions.size,
    hours: hoursOf(dossier, game),
  };
}

function frameMessage(skel: GuideSkeleton, dossier: GuideDossier, game: GuideDossierSource): string {
  const ficha = fichaOf(skel, dossier, game);
  const f = dossier.facts;
  const rarest = [...dossier.achievements]
    .filter((a) => a.globalPct !== null)
    .sort((a, b) => a.globalPct! - b.globalPct!)
    .slice(0, 5);
  return [
    "Escreva a moldura do guia: capa, ficha, visão geral, \"leia antes\", as etapas do roadmap e o título de cada capítulo.",
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
      `- Horas até o Tralked: ${ficha.hours ? `${ficha.hours.min} a ${ficha.hours.max}` : "sem dado"}`,
      `- Zeradas mínimas: ${f.playthroughs ? `${f.playthroughs.value.min} (${body(f.playthroughs.value.note)})` : "sem dado"}`,
      `- Dificuldade segundo as fontes (escala delas): ${f.difficulty ? `${f.difficulty.value.value} (${body(f.difficulty.value.note)})` : "sem dado"}`,
      `- Compatibilidade: ${f.compat}`,
      `- Mais raras na Steam: ${rarest.map((a) => `${a.apiName} ${pct(a.globalPct)}`).join(", ") || "sem dado"}`,
    ].join("\n"),
    [
      "## Etapas do roadmap (keys prontas)",
      ...skel.phases.map((p) => `<etapa key="${p.key}" titulo="${attr(p.title)}">${body(p.summary)}</etapa>`),
    ].join("\n"),
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

function achievementLine(a: DossierAchievement, key?: string): string {
  const attrs = [
    key ? `key="${key}"` : "",
    `apiName="${attr(a.apiName)}"`,
    `nome_pt="${attr(a.namePt ?? "")}"`,
    `nome_en="${attr(a.nameEn)}"`,
    `descricao="${attr(a.descriptionPt ?? a.description ?? "")}"`,
    `oculta="${yes(a.hidden)}"`,
    `raridade="${pct(a.globalPct)}"`,
    `perdivel="${a.missable ? `sim${a.missableUntil ? `, até ${attr(a.missableUntil)}` : ""}` : "não"}"`,
    a.bugged ? `bug="${attr(a.bugNote ?? "sim")}"` : "",
    a.online ? 'online="sim"' : "",
    `fontes="${a.sources.length}${!a.agreed || a.conflict ? " (revisar)" : ""}"`,
  ].filter(Boolean);
  return `<conquista ${attrs.join(" ")}>${body(a.howTo ?? "")}</conquista>`;
}

function itemLine(s: SkelItem): string {
  if (!s.item) return achievementLine(s.ach!, s.key).replace(/^<conquista /, "<item ").replace(/<\/conquista>$/, "</item>");
  const i = s.item;
  const attrs = [
    `key="${s.key}"`,
    `tipo="${attr(i.kind)}"`,
    `nome_en="${attr(i.nameEn ?? i.name)}"`,
    i.collectibleType ? `tipo_coletavel="${attr(i.collectibleType)}"` : "",
    i.index !== undefined && i.total !== undefined ? `numero="${i.index}/${i.total}"` : "",
    `perdivel="${i.missable ? `sim${i.missableUntil ? `, até ${attr(i.missableUntil)}` : ""}` : "não"}"`,
    `volta_depois="${yes(i.returnLater)}"`,
    s.ach ? `conquista="${attr(s.ach.apiName)}" conquista_pt="${attr(s.ach.namePt ?? "")}" conquista_en="${attr(s.ach.nameEn)}" oculta="${yes(s.ach.hidden)}"` : "",
    `fontes="${i.sources.length}${!i.agreed || i.conflict ? " (revisar)" : ""}"`,
  ].filter(Boolean);
  return `<item ${attrs.join(" ")}>${body(i.location)}</item>`;
}

function chapterMessage(skel: GuideSkeleton, chapter: SkelChapter, steps: SkelStep[], game: GuideDossierSource): string {
  const at = skel.chapters.indexOf(chapter);
  const prev = skel.chapters[at - 1];
  const next = skel.chapters[at + 1];
  const loose = chapter.cleanup ? [] : skel.loose;
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
          ...loose.map((l) => achievementLine(l.ach!, l.key)),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function problemsMessage(problems: string[]): string {
  return [
    "## Correções obrigatórias",
    "A checagem encontrou estes problemas na versão anterior do guia. Reescreva a sua parte corrigindo os que a afetam; o que o dossiê não sustenta sai do texto.",
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

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

function isMissable(s: SkelItem): boolean {
  return Boolean(s.item?.missable || s.ach?.missable);
}

/** The "until X" milestone of a missable item or achievement (the item's own first). */
function untilOf(item: DossierItem | null | undefined, ach: DossierAchievement | null | undefined): string | undefined {
  if (item?.missable && item.missableUntil) return item.missableUntil;
  if (ach?.missable && ach.missableUntil) return ach.missableUntil;
  return undefined;
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

type ItemText = ChapterText["itens"][number];

export type WriteGuideOpts = {
  models?: GuideModels;
  /** Problems of a previous attempt (checker and deterministic checks), added to every writer call. */
  problems?: string[];
  /** Server-side fallbacks; defaults to `bucket === "live"`. */
  fallbacks?: boolean;
};

/** The payload plus what the code had to fill because the model left it out (fed back as problems). */
export type WrittenGuide = { payload: GuidePayloadV2; repairs: string[] };

async function inPool<T, R>(list: T[], limit: number, run: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await run(list[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

/** Writes the guide and reports what had to be repaired. `writeGuide` is the plain version. */
export async function writeGuideDetailed(
  ai: Ai,
  dossier: GuideDossier,
  game: GuideDossierSource,
  bucket: SpendBucket,
  opts: WriteGuideOpts = {},
): Promise<WrittenGuide> {
  const models = opts.models ?? DEFAULT_GUIDE_MODELS;
  const retry = (opts.problems?.length ?? 0) > 0;
  const suffix = retry ? `\n\n${problemsMessage(opts.problems!)}` : "";
  const skel = buildSkeleton(dossier);
  const call = <T>(purpose: string, user: string, schema: z.ZodType<T>) =>
    ai.structured({
      bucket,
      purpose: retry ? `${purpose}-retry` : purpose,
      model: models.MODEL_WRITER,
      effort: "high",
      system: loadGuideStyle(),
      user: user + suffix,
      schema,
      maxTokens: WRITER_MAX_TOKENS,
      fallbacks: opts.fallbacks ?? bucket === "live",
    });

  const jobs = skel.chapters.flatMap((chapter) => chunk(chapter.steps, Math.ceil(chapter.steps.length / STEPS_PER_CALL)).map((steps) => ({ chapter, steps })));
  const [frame, texts] = await Promise.all([
    call("guide-write-frame", frameMessage(skel, dossier, game), FrameSchema),
    inPool(jobs, CONCURRENCY, (job) => call("guide-write-chapter", chapterMessage(skel, job.chapter, job.steps, game), ChapterTextSchema)),
  ]);
  return assembleGuide(skel, dossier, game, frame, jobs.map((j, n) => ({ chapter: j.chapter, text: texts[n]! })));
}

/** Writes the guide: structure and flags from the dossier, text from `MODEL_WRITER`. No images, no soundtrack. */
export async function writeGuide(
  ai: Ai,
  dossier: GuideDossier,
  game: GuideDossierSource,
  bucket: SpendBucket,
  opts: WriteGuideOpts = {},
): Promise<GuidePayloadV2> {
  return (await writeGuideDetailed(ai, dossier, game, bucket, opts)).payload;
}

/** Puts the model's text on the code's skeleton. Exported for tests; pure. */
export function assembleGuide(
  skel: GuideSkeleton,
  dossier: GuideDossier,
  game: GuideDossierSource,
  frame: Frame,
  texts: { chapter: SkelChapter; text: ChapterText }[],
): WrittenGuide {
  const repairs: string[] = [];
  const steamApiNames = new Set(dossier.achievements.map((a) => a.apiName));
  const stepKeys = new Set(skel.chapters.flatMap((c) => c.steps.map((s) => s.key)));
  const itemKeys = new Set([...skel.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => i.key))), ...skel.loose.map((l) => l.key)]);

  // --- the model's texts, by key (unknown keys are dropped) -------------------------------------------------
  const stepBlocks = new Map<string, ContentBlock[]>();
  const itemText = new Map<string, ItemText>();
  const laterNote = new Map<string, string>();
  const placement = new Map<string, string>(); // loose apiName -> step key
  const looseBy = new Map(skel.loose.map((l) => [l.ach!.apiName, l]));
  // Cleanup texts first: a loose achievement keeps the cleanup text unless a chapter places it (below).
  const ordered = [...texts.filter((t) => t.chapter.cleanup), ...texts.filter((t) => !t.chapter.cleanup)];
  for (const { chapter, text } of ordered) {
    for (const step of text.passos) if (stepKeys.has(step.key)) stepBlocks.set(step.key, toBlocks(step.blocos));
    for (const i of text.itens) if (itemKeys.has(i.key) && !itemText.has(i.key)) itemText.set(i.key, i);
    if (text.depois) laterNote.set(chapter.key, text.depois);
  }
  // The first chapter (in reading order) that puts a loose achievement in one of its steps wins, with its text.
  for (const { chapter, text } of texts) {
    if (chapter.cleanup) continue;
    for (const step of text.passos) {
      if (!chapter.steps.some((s) => s.key === step.key)) continue;
      for (const apiName of step.conquistas) {
        const l = looseBy.get(apiName);
        if (!l || placement.has(apiName)) continue;
        placement.set(apiName, step.key);
        const own = text.itens.find((i) => i.key === l.key);
        if (own) itemText.set(l.key, own);
      }
    }
  }

  // --- placement of the loose achievements --------------------------------------------------------------------
  const stepsOf = new Map<string, SkelItem[]>();
  for (const c of skel.chapters) for (const s of c.steps) stepsOf.set(s.key, c.cleanup ? [] : [...s.items]);
  const cleanup = skel.chapters.find((c) => c.cleanup);
  /** A step surely before the milestone's chapter: the end of the chapter before it, or the start of the first one. */
  const stepBefore = (title: string) => {
    const at = skel.chapters.findIndex((x) => !x.cleanup && x.title === title);
    if (at < 0) return undefined;
    const prev = skel.chapters[at - 1];
    return prev && !prev.cleanup ? prev.steps[prev.steps.length - 1]?.key : skel.chapters[at]!.steps[0]?.key;
  };
  for (const l of skel.loose) {
    const a = l.ach!;
    let target = placement.get(a.apiName);
    if (target && (stepsOf.get(target)?.length ?? MAX_ITEMS_PER_STEP) >= MAX_ITEMS_PER_STEP) target = undefined;
    if (!target && a.missable && a.deadlineChapter) {
      target = stepBefore(a.deadlineChapter);
      if (target) {
        repairs.push(
          `A conquista perdível "${achName(a)}" (${a.apiName}) não foi posta num passo; o sistema a pôs no passo ${target}, antes do capítulo "${a.deadlineChapter}". Ponha-a no passo certo, antes do ponto de não retorno.`,
        );
      }
    }
    if (!target) {
      // Its default cleanup step.
      target = cleanup!.steps.find((s) => s.items.includes(l))!.key;
    }
    stepsOf.get(target)!.push(l);
  }

  // --- items ----------------------------------------------------------------------------------------------------
  const fallbackSources = (): WalkSource[] =>
    game.game.steamAppId ? [{ name: "Steam", url: `https://steamcommunity.com/stats/${game.game.steamAppId}/achievements` }] : [];
  const compatSteamOnly = dossier.facts.compat === "steam_only";

  const buildItem = (s: SkelItem): WalkItem => {
    const t = itemText.get(s.key);
    const i = s.item;
    const a = s.ach;
    const kind = kindOf(s);
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
      repairs.push(`O item "${name}" (${s.key}) ficou sem texto próprio de local; escreva onde fica e como pegar.`);
      location = inline(i?.location || a?.howTo || a?.descriptionPt || a?.description, 400);
    }
    const index = i?.index;
    const total = i?.total;
    const counted = index !== undefined && total !== undefined && Number.isInteger(index) && Number.isInteger(total) && index >= 1 && index <= total;
    const sources = walkSources([...(i?.sourceLinks ?? []), ...(a?.sourceLinks ?? [])]);
    const review = Boolean((i && (!i.agreed || i.conflict)) || (a && (!a.agreed || a.conflict)) || sources.length === 0);
    const countsFor = [...new Set(i?.countsFor ?? [])].filter((x) => steamApiNames.has(x)).slice(0, 20);
    const achievement = a && steamApiNames.has(a.apiName) ? a.apiName : undefined;
    return {
      key: s.key,
      kind,
      name,
      ...(nameEn ? { nameEn } : {}),
      ...(i?.collectibleType && plain(i.collectibleType, 40) ? { collectibleType: plain(i.collectibleType, 40) } : {}),
      ...(counted ? { index, total } : {}),
      ...(location ? { location } : {}),
      missable: isMissable(s),
      returnLater: Boolean(i?.returnLater),
      spoiler: Boolean(t?.spoiler || a?.hidden || i?.kind.toLowerCase() === "boss"),
      ...(achievement ? { achievement } : {}),
      countsFor,
      alsoOn: a && compatSteamOnly && !a.steamOnly ? ["psn"] : [],
      sources: sources.length > 0 ? sources : fallbackSources(),
      review,
    };
  };

  // --- chapters -------------------------------------------------------------------------------------------------
  const phaseKeys = new Set(skel.phases.map((p) => p.key));
  const metaBy = new Map(frame.capitulos.map((c) => [c.key, c]));
  const chapters: WalkChapter[] = [];
  let lastPhase = skel.phases[0]!.key;
  for (const c of skel.chapters) {
    const meta = metaBy.get(c.key);
    const steps = c.steps
      .map((s) => ({ s, items: stepsOf.get(s.key)! }))
      .filter(({ items }) => !c.cleanup || items.length > 0);
    if (steps.length === 0) continue;
    let phaseKey = meta && phaseKeys.has(meta.fase) ? meta.fase : c.cleanup ? skel.phases[skel.phases.length - 1]!.key : lastPhase;
    lastPhase = phaseKey;
    let deadline = c.deadlines.length > 0 ? plain(meta?.prazo, 200) : "";
    if (c.deadlines.length > 0 && !deadline) {
      repairs.push(`O capítulo "${c.title}" tem perdíveis, mas ficou sem o prazo (ponto de não retorno).`);
      deadline = plain(c.deadlines.join("; "), 200);
    }
    const walkSteps = steps.map(({ s, items }, n) => {
      const walkItems = items.map(buildItem);
      // Room for the code's missable warning and "later" note within the site's 20 blocks.
      let blocks = (stepBlocks.get(s.key) ?? []).slice(0, 18);
      if (blocks.length === 0) {
        repairs.push(`O passo ${s.key} do capítulo "${c.title}" ficou sem texto; escreva o caminho deste passo.`);
        blocks = [{ type: "paragraph", text: walkItems.length > 0 ? `Neste ponto: ${walkItems.map((i) => i.name).join(", ")}.` : "Siga em frente pela história." }];
      }
      // The missable warning comes first in the step, before the text that leads past the point of no return.
      const warn = items.filter((s) => isMissable(s) && !s.item?.returnLater);
      if (warn.length > 0 && !blocks.some((b) => b.type === "callout" && b.tone === "aviso")) {
        const names = walkItems
          .filter((i) => warn.some((s) => s.key === i.key))
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
    if (!meta?.horas.trim()) repairs.push(`O capítulo "${c.title}" ficou sem horas estimadas.`);
    chapters.push({
      key: c.key,
      phaseKey,
      title: plain(meta?.titulo, 80) || plain(c.title, 80) || "Capítulo",
      ...(c.region && plain(c.region, 120) ? { region: plain(c.region, 120) } : {}),
      hours: plain(meta?.horas, 40) || "—",
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
      repairs.push(`A etapa "${p.title}" (${p.key}) do roadmap ficou sem texto.`);
      blocks = [{ type: "paragraph", text: "Siga os capítulos desta etapa, na ordem." }];
    }
    const achievements = [
      ...new Set(
        chapters
          .filter((c) => c.phaseKey === p.key)
          .flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => i.achievement).filter((x): x is string => Boolean(x)))),
      ),
    ].slice(0, 200);
    return { key: p.key, title: plain(t?.titulo, 160) || plain(p.title, 160) || "Etapa", hours: plain(t?.horas, 40) || "—", body: blocks.slice(0, 120), achievements };
  });

  // --- ficha and cover ----------------------------------------------------------------------------------------
  const ficha = fichaOf(skel, dossier, game);
  const missables = allItems.filter((i) => i.missable && i.kind === "achievement").length;
  const hours = ficha.hours ?? (frame.ficha.horasMin !== null && frame.ficha.horasMax !== null ? { min: Math.max(0, Math.round(frame.ficha.horasMin)), max: Math.max(0, Math.round(frame.ficha.horasMax)) } : { min: 0, max: 0 });
  hours.max = Math.max(hours.min, hours.max);
  const difficulty = Math.min(10, Math.max(1, Math.round(Number.isFinite(frame.ficha.dificuldade) ? frame.ficha.dificuldade : 5)));

  const defaults = [
    ...(missables > 0 ? [{ value: String(missables), label: missables === 1 ? "Perdível" : "Perdíveis" }] : []),
    ...(ficha.online === 0 ? [{ value: "0", label: "Online" }] : []),
    ficha.regions > 1 ? { value: String(ficha.regions), label: "Regiões" } : { value: String(ficha.chapters), label: "Capítulos" },
    { value: String(ficha.achievements), label: "Conquistas" },
    { value: `${difficulty}/10`, label: "Dificuldade" },
  ];
  // A call's number has to be one of the ficha's ("5/10" counts as 5; "1,5%" as a Steam rarity).
  const fichaNumbers = new Set(
    [
      ficha.achievements, ficha.hidden, missables, ficha.online, ficha.bugged, ficha.chapters, ficha.regions,
      hours.min, hours.max, difficulty, dossier.facts.playthroughs?.value.min ?? 1,
      ...dossier.achievements.map((a) => a.globalPct ?? -1),
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
  if (calls.length < 3) repairs.push("A capa precisa de exatamente 3 chamadas com números da ficha.");
  for (const d of defaults) {
    if (calls.length >= 3) break;
    if (!calls.some((c) => c.label.toLowerCase() === d.label.toLowerCase())) calls.push(d);
  }

  const sealHours = hours.max === 0 ? "—" : hours.min === hours.max ? `${hours.min} h` : `${hours.min}–${hours.max} h`.slice(0, 12);

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
    repairs.push('O "leia antes" ficou vazio.');
    readFirst.push({
      title: "Antes de começar",
      text: missables > 0 ? `Este guia tem ${missables} conquistas perdíveis. Os avisos aparecem antes de cada ponto de não retorno.` : "Nenhuma conquista é perdível: dá para voltar depois e pegar o que faltar.",
      tone: missables > 0 ? "aviso" : "info",
      spoiler: false,
    });
  }

  const need = (text: string, fallback: string, what: string) => {
    if (text) return text;
    repairs.push(`Faltou ${what}.`);
    return fallback;
  };

  const sourceLinks = guideSources(dossier);
  const payload: GuidePayloadV2 = {
    game: { slug: game.game.slug },
    format: 2,
    status: "review",
    facts: {
      difficulty,
      hoursMin: hours.min,
      hoursMax: hours.max,
      playthroughs: need(plain(frame.ficha.zeradas, 80), String(dossier.facts.playthroughs?.value.min ?? 1), "o número de zeradas"),
      missables,
      online: ficha.online,
    },
    overview: frame.visaoGeral.map((p) => plain(p, 1000)).filter(Boolean).slice(0, 20),
    steps,
    sources: sourceLinks,
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

/** Every page the dossier read, for the guide's "Fontes" list (the site keeps at most 30). */
function guideSources(dossier: GuideDossier): { title: string; url: string }[] {
  const links = [
    ...dossier.chapters.flatMap((c) => c.items.flatMap((i) => i.sourceLinks)),
    ...dossier.achievements.flatMap((a) => a.sourceLinks),
  ];
  return walkSources(links, 30).map((s) => ({ title: plain(s.name, 200), url: s.url }));
}

// ---------------------------------------------------------------------------------------------
// Deterministic checks (before the LLM checker)
// ---------------------------------------------------------------------------------------------

const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const ngramCache = new WeakMap<readonly string[], Map<number, Set<string>>>();

function ngrams(sources: readonly string[], n: number): Set<string> {
  let byN = ngramCache.get(sources);
  if (!byN) ngramCache.set(sources, (byN = new Map()));
  let set = byN.get(n);
  if (!set) {
    set = new Set();
    for (const source of sources) {
      const w = words(source);
      for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(" "));
    }
    byN.set(n, set);
  }
  return set;
}

/**
 * Runs of `n` or more consecutive words of `text` that also appear, in the same order, in one of the sources
 * (case, accents and punctuation ignored). The manual allows at most 8 equal words in a row, so the guide checks
 * with n = 9. Deterministic; runs before the LLM checker.
 */
export function copiedRuns(text: string, sources: readonly string[], n = 9): string[] {
  const index = ngrams(sources, n);
  const w = words(text);
  const runs: string[] = [];
  let start = -1;
  let end = -1;
  for (let i = 0; i + n <= w.length; i++) {
    if (!index.has(w.slice(i, i + n).join(" "))) continue;
    if (start >= 0 && i <= end) {
      end = i + n;
    } else {
      if (start >= 0) runs.push(w.slice(start, end).join(" "));
      start = i;
      end = i + n;
    }
  }
  if (start >= 0) runs.push(w.slice(start, end).join(" "));
  return runs;
}

/** The texts the dossier carries from the sources: what the guide may not copy when the raw pages are not given. */
export function dossierTexts(dossier: GuideDossier): string[] {
  return [
    ...dossier.chapters.flatMap((c) => c.items.map((i) => i.location)),
    ...dossier.achievements.flatMap((a) => [a.howTo ?? "", a.bugNote ?? ""]),
    ...dossier.facts.roadmap.map((r) => r.summary),
    dossier.facts.playthroughs?.value.note ?? "",
    dossier.facts.difficulty?.value.note ?? "",
  ].filter((t) => t.trim().length > 0);
}

const blockText = (b: ContentBlock) => (b.type === "paragraph" || b.type === "callout" ? b.text : "");

/** Every text the model wrote, with where it is. Names are left out: they repeat the sources on purpose. */
export function guideProse(p: GuidePayloadV2): { where: string; text: string }[] {
  const w = p.walkthrough;
  return [
    { where: "a capa", text: `${w.cover.headline}. ${w.cover.deck}` },
    { where: "a ficha", text: `${w.extraFacts.playthroughsNote} ${w.extraFacts.difficultyNote}` },
    ...(p.overview ?? []).map((text) => ({ where: "a visão geral", text })),
    ...w.readFirst.map((r) => ({ where: `o "leia antes" "${r.title}"`, text: `${r.title}. ${r.text}` })),
    ...p.steps.flatMap((s) => s.body.map((b) => ({ where: `a etapa ${s.key ?? s.title}`, text: blockText(b) }))),
    ...w.chapters.flatMap((c) => [
      { where: `o capítulo ${c.key}`, text: `${c.title}. ${c.deadline ?? ""}` },
      ...c.steps.flatMap((s) => [
        ...s.body.map((b) => ({ where: `o passo ${s.key}`, text: blockText(b) })),
        ...s.items.map((i) => ({ where: `o item ${i.key}`, text: i.location ?? "" })),
      ]),
    ]),
  ].filter((x) => x.text.trim().length > 0);
}

/** Copy (9+ equal words) and vocabulary ("platina") problems, in Portuguese, one per finding. */
export function deterministicProblems(p: GuidePayloadV2, sources: readonly string[]): string[] {
  const problems: string[] = [];
  for (const { where, text } of guideProse(p)) {
    for (const run of copiedRuns(text, sources, 9)) {
      problems.push(`Trecho copiado de uma fonte em ${where}: "${run}". Reescreva com palavras próprias (no máximo 8 palavras seguidas iguais).`);
    }
    if (/platin/i.test(text)) problems.push(`Em ${where}, use "Tralked" no lugar de "platina".`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Write and check
// ---------------------------------------------------------------------------------------------

export type GuideWriteResult = { ok: true; payload: GuidePayloadV2 } | { ok: false; problems: string[]; payload: GuidePayloadV2 };

export type WriteAndCheckOpts = Omit<WriteGuideOpts, "problems"> & {
  /** Text of the source pages, for the copy check; defaults to the source texts the dossier carries. */
  sourceTexts?: string[];
};

/**
 * Writes, checks (deterministic checks, then the LLM checker), rewrites once with every problem found and checks
 * again. `ok: false` after the second check: the pipeline marks the request `failed`.
 */
export async function writeAndCheckGuide(
  ai: Ai,
  dossier: GuideDossier,
  game: GuideDossierSource,
  bucket: SpendBucket,
  opts: WriteAndCheckOpts = {},
): Promise<GuideWriteResult> {
  const models = opts.models ?? DEFAULT_GUIDE_MODELS;
  const sources = opts.sourceTexts ?? dossierTexts(dossier);
  const check = async (written: WrittenGuide) => {
    const own = [...written.repairs, ...deterministicProblems(written.payload, sources)];
    const llm = await checkGuide(ai, written.payload, dossier, { bucket, model: models.MODEL_FAST });
    return [...own, ...llm.problems];
  };

  const first = await writeGuideDetailed(ai, dossier, game, bucket, opts);
  const firstProblems = await check(first);
  if (firstProblems.length === 0) return { ok: true, payload: first.payload };

  const second = await writeGuideDetailed(ai, dossier, game, bucket, { ...opts, problems: firstProblems });
  const secondProblems = await check(second);
  if (secondProblems.length === 0) return { ok: true, payload: second.payload };
  return { ok: false, problems: secondProblems, payload: second.payload };
}
