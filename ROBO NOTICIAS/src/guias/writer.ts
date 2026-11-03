import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Ai } from "../ai/client.js";
import { escapeAttr, escapeText } from "../ai/escape.js";
import type { SpendBucket } from "../db.js";
import type { ContentBlock } from "../tralked.js";
import { CHECK_DUE, CHECKER_RIGHT, checkScopes, FRAME_SCOPE, jobSteps, type CheckContext, type CodeWarning, type GuideProblem } from "./checker.js";
import { chronologyProblems } from "./chronology.js";
import { DEFAULT_CHECK_EFFORT, DEFAULT_MODEL_CHECK, type GuideConfig } from "./config.js";
import { WALK_ITEM_KINDS, type GuidePayloadV2, type WalkChapter, type WalkItem, type WalkItemKind, type WalkSource } from "./contract.js";
import { deterministicProblems, dossierTexts, knownNames } from "./copy-check.js";
import { steamOnlyApiNames, type DossierAchievement, type GuideDossier, type GuideDossierSource } from "./dossier.js";
import { abortOnError, inPool, type Abort } from "./pool.js";
import type { PsnWriteScope } from "./scope.js";
import { anchoredIn, buildSkeleton, isMissable, placeableIn, untilOf, writeJobs, type GuideSkeleton, type SkelItem, type WriteJob } from "./skeleton.js";

export { copiedRuns } from "./copy-check.js";

/**
 * The guide writer. The CODE owns the structure (skeleton.ts: chapters, steps, items and their keys) and every
 * number and flag the site checks; numbers come only from the dossier, the catalog (time to beat) or the code. The
 * model only writes the text: one "frame" call (cover, ficha texts, overview, read-first, roadmap, chapter titles)
 * and one call per write job (a run of at most 20 steps of a chapter). After a check, only the frame and the jobs a
 * problem points at are rewritten. Images and the soundtrack are added later by the pipeline.
 *
 * Chapters and steps keep the order of the primary script (the dossier's order); each chapter's roadmap phase only
 * moves forward. With a PSN scope (R22) the dossier holds only the PSN list's achievements and the payload says so
 * (`scope`, `psnList`, `steamOnly`); the Steam-only achievements get no item and no how-to.
 */

/** The writer's effort (its model is MODEL_WRITER). */
export const WRITER_EFFORT = "high" as const;

/** The writer's model, and the checker's model and effort (Task 22). */
export type GuideModels = Pick<GuideConfig, "MODEL_WRITER" | "MODEL_CHECK" | "CHECK_EFFORT">;
export const DEFAULT_GUIDE_MODELS: GuideModels = { MODEL_WRITER: "claude-opus-5-5", MODEL_CHECK: DEFAULT_MODEL_CHECK, CHECK_EFFORT: DEFAULT_CHECK_EFFORT };

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

function fichaOf(skel: GuideSkeleton, dossier: GuideDossier, game: GuideDossierSource, scope?: PsnWriteScope) {
  const achItems = skel.chapters.flatMap((c) => c.steps.flatMap((s) => s.items)).filter((i) => i.ach);
  return {
    /** Scope psn: the PSN trophies (platinum included), the Steam list size and the Steam-only count. */
    psn: scope ? { trophies: scope.psnList.total, steam: scope.steamTotal, steamOnly: scope.steamOnly.length } : null,
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

/**
 * Task 29: a fixed rule of every frame and job message (not the style manual, not the cache version: the writing key
 * and the saved drafts stay the same). The checker kept refusing invented PT names for achievements without
 * `nome_pt` and places translated from a Chinese-only milestone.
 */
export const NAMES_RULE =
  "## Nomes\n" +
  'Se `nome_pt` for nulo (vazio, `nome_pt=""`), use só o nome em inglês da conquista, sem tradução. ' +
  "Não traduza nem nomeie lugares, chefes ou marcos que o dossiê só traz em outro idioma: cite o marco como " +
  "'o ponto indicado pela fonte' ou use o nome em inglês que aparece no dossiê.";

function frameMessage(skel: GuideSkeleton, dossier: GuideDossier, game: GuideDossierSource, scope?: PsnWriteScope): string {
  const ficha = fichaOf(skel, dossier, game, scope);
  const f = dossier.facts;
  const rarest = [...dossier.achievements]
    .filter((a) => a.globalPct !== null)
    .sort((a, b) => a.globalPct! - b.globalPct!)
    .slice(0, 5);
  return [
    "Escreva a moldura do guia: capa, textos da ficha, visão geral, \"leia antes\", as etapas do roadmap e o título de cada capítulo. Os números da ficha são calculados pelo sistema; você só os cita.",
    NAMES_RULE,
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
      ...(ficha.psn
        ? [
            `- Troféus na lista da PSN: ${ficha.psn.trophies} (o guia segue esta lista)`,
            `- Conquistas na Steam: ${ficha.psn.steam}, das quais ${ficha.psn.steamOnly} só na Steam (fora do roteiro, sem como fazer)`,
            `- Conquistas da Steam no roteiro: ${ficha.achievements} (ocultas: ${ficha.hidden})`,
          ]
        : [`- Conquistas na Steam: ${ficha.achievements} (ocultas: ${ficha.hidden})`]),
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
    ficha.psn
      ? [
          "## Escopo: guia pela lista da PSN",
          `Nenhuma fonte explica ainda as ${ficha.psn.steamOnly} conquistas que só existem na Steam, então este guia segue a lista de troféus da PSN (${ficha.psn.trophies} troféus). Diga isso com franqueza na capa ou no "leia antes": o roteiro cobre a lista da PSN, e as conquistas só da Steam ficam num bloco à parte, sem roteiro ainda. Nunca explique como fazer uma conquista que não está nesta lista.`,
        ].join("\n")
      : "",
    [
      "## Ordem do jogo",
      `Os capítulos já estão na ordem cronológica do roteiro principal${dossier.primaryScript ? ` (${body(dossier.primaryScript.name)})` : ""}; o roadmap é o da fonte, com o mínimo de zeradas. Cada capítulo fica na mesma etapa do anterior ou numa etapa seguinte, nunca numa anterior. A limpeza (seleção de capítulo) é só para o que não dá para fazer antes.`,
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

/** A number as the guide prints it (pt-BR decimal comma). */
const numPt = (n: number) => String(n).replace(".", ",");

/** R39: "as fontes localizam 38 de 40 Sha-Chi Amber Shards; 2 sem mapa", the dossier's numbers only. */
const countFacts = (c: NonNullable<NonNullable<DossierAchievement["collect"]>["shortfallAccepted"]>) =>
  `as fontes localizam ${numPt(c.located)} de ${numPt(c.stated)} ${c.label}; ${numPt(c.missing)} sem mapa`;

/**
 * R39: the code's note on a "collect N" the gate accepted short by less than one unit: how many the sources locate,
 * of the total a source states, and how many are not mapped yet. Named (a step may hold several items).
 */
export function countNote(a: DossierAchievement): string | undefined {
  const c = a.collect?.shortfallAccepted;
  if (!c) return undefined;
  const name = plain(achName(a), 80);
  const shown = a.hidden ? `||${name}||` : `**${name}**`;
  const rest = c.missing === 1 ? "ainda não foi mapeado" : "ainda não foram mapeados";
  return inline(`${shown} — As fontes localizam ${numPt(c.located)} de ${numPt(c.stated)} ${c.label}; ${numPt(c.missing)} ${rest}.`, 2000);
}

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
    // R39: the writer knows the count is incomplete (the code's note says it in the step); never "todos os N".
    a.collect?.shortfallAccepted ? `contagem_incompleta="${attr(countFacts(a.collect.shortfallAccepted))}"` : "",
    `fontes="${a.sources.length}${!a.agreed || a.conflict ? " (revisar)" : ""}"`,
  ].filter(Boolean);
  return `<${tag} ${attrs.join(" ")}>${body(a.howTo ?? "")}</${tag}>`;
}

/** A loose achievement offered for placement: just enough to recognize where it unlocks (no howTo). */
function looseLine(l: SkelItem): string {
  const a = l.ach!;
  return `<conquista key="${l.key}" apiName="${attr(a.apiName)}" nome="${attr(achName(a))}" descricao="${attr(a.descriptionPt ?? a.description ?? "")}"${a.hidden ? ' oculta="sim"' : ""}${a.missable ? ` ${missableAttr(true, a.missableUntil)}` : ""}${a.missable && a.warnChapter ? ` comecar_em="${attr(a.warnChapter)}"` : ""}/>`;
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
    // The checker sees what the item counts toward: the writer is told too.
    i.countsFor.length > 0 ? `conta_para="${attr(i.countsFor.join(", "))}"` : "",
    `fontes="${i.sources.length}${!i.agreed || i.conflict ? " (revisar)" : ""}"`,
  ].filter(Boolean);
  return `<item ${attrs.join(" ")}>${body(i.location)}</item>`;
}

/** "a, b e c". */
const joinPt = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`);

/**
 * Task 21: how a code warning names what it warns: always by name (never "o item deste passo": a step may hold several
 * items), an achievement as one, and a spoiler (hidden achievement, boss) inside `||…||`.
 */
function warnedName(name: string, spoiler: boolean, achievement: { hidden: boolean } | null): string {
  const shown = spoiler ? `||${name}||` : `**${name}**`;
  return achievement ? `a conquista ${achievement.hidden ? "oculta " : ""}${shown}` : shown;
}

/**
 * Task 18/21: the warning at a chapter's first step for the loose missables the sources link to it (`warnChapter`).
 * Only what the dossier says: the sources link them here; where each is done is the step that holds it.
 */
function anchorWarning(anchored: DossierAchievement[]): string {
  const names = anchored.map((a) => (a.hidden ? warnedName(plain(achName(a), 80), true, a) : `**${plain(achName(a), 80)}**`));
  return inline(`Perdível: as fontes ligam ${joinPt(names)} a este capítulo; fique atento a partir daqui.`, 2000);
}

/** A block whose text is exactly `text` (a writer's copy of a code warning). */
const sameText = (b: ContentBlock, text: string | undefined) => text !== undefined && "text" in b && b.text === text;

/** The loose missables the code warns at the start of the job (only the job holding the chapter's first step). */
const anchoredInJob = (skel: GuideSkeleton, job: WriteJob) => (job.steps[0] === job.chapter.steps[0] ? anchoredIn(skel, job.chapter) : []);

function jobMessage(skel: GuideSkeleton, job: WriteJob, game: GuideDossierSource): string {
  const { chapter, steps } = job;
  const at = skel.chapters.indexOf(chapter);
  const prev = skel.chapters[at - 1];
  const next = skel.chapters[at + 1];
  const loose = placeableIn(skel, chapter);
  const anchored = anchoredInJob(skel, job).map((l) => l.ach!);
  // The code may warn a missable of these steps, or of a loose one the writer places here.
  const missables = anchored.length > 0 || steps.some((s) => s.items.some(isMissable)) || loose.some(isMissable);
  return [
    `Escreva o texto dos passos abaixo, do capítulo "${body(chapter.title)}" do guia de ${body(game.game.name)}.`,
    `<capitulo key="${chapter.key}" titulo="${attr(chapter.title)}"${chapter.region ? ` regiao="${attr(chapter.region)}"` : ""}${chapter.deadlines.length ? ` prazo="${attr(chapter.deadlines.join("; "))}"` : ""}/>`,
    `Capítulo anterior: ${prev ? body(prev.title) : "nenhum"}. Próximo: ${next ? body(next.title) : "nenhum"}.`,
    NAMES_RULE,
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
    missables
      ? [
          "## Avisos de perdível que o sistema põe",
          'O sistema põe sozinho o aviso de cada perdível de um passo que o seu texto não avisar ("Perdível: pegue … agora, antes de seguir.") e, no primeiro passo do capítulo, o aviso das conquistas perdíveis que as fontes ligam a ele. Esses avisos já estão no lugar: não os repita nem os amplie ("começam nesta região", "também começa aqui"). Seu texto diz só o que o dossiê traz sobre cada passo.',
          ...(anchored.length > 0 ? [`No passo ${steps[0]!.key}: "${body(anchorWarning(anchored))}"`] : []),
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

/** Task 30: the problems pointed at in this part before (all rounds and attempts), newest first. */
const PAST_PROBLEMS_MAX = 25;
const PAST_PROBLEM_CHARS = 300;
function pastProblemsMessage(past: string[]): string {
  return [
    "## Erros já apontados antes neste trecho: não repita nenhum",
    ...past
      .slice(-PAST_PROBLEMS_MAX)
      .reverse()
      .map((p) => `- ${p.length > PAST_PROBLEM_CHARS ? `${p.slice(0, PAST_PROBLEM_CHARS - 1)}…` : p}`),
  ].join("\n");
}

/** Task 30: a part flagged in this many rounds (this rewrite is its 3rd or later) is written in strict mode. */
export const STRICT_AFTER_REWRITES = 3;
export const STRICT_MODE =
  "## Modo estrito\n" +
  "Escreva só o que o dossiê diz, com frases curtas; não acrescente localização, requisito, possibilidade de voltar, contagem de fontes ou tradução que não esteja escrita no dossiê; nomes que o dossiê só traz em chinês ou russo ficam como estão ou são omitidos.";

/**
 * Task 30: per part (frame or job id), what was pointed at in it before and in how many rounds (drafts.ts
 * `problemHistory`). Only the rewrite's message uses it: never the writing key.
 */
export type ProblemHistory = Map<string, { problems: string[]; flagged: number }>;

/** Adds one round's problems to a history (the writer adds its own rounds the same way). */
export function addProblems(history: ProblemHistory, problems: GuideProblem[]): void {
  const blocking = problems.filter((p) => p.kind !== CHECK_DUE && p.kind !== CHECKER_RIGHT && p.kind !== "nota");
  for (const scope of new Set(blocking.map((p) => p.scope))) {
    const entry = history.get(scope) ?? { problems: [], flagged: 0 };
    entry.flagged++;
    for (const p of blocking) {
      const said = p.kind === undefined || p.kind === "checador" || p.kind === "copia";
      if (p.scope === scope && said && !entry.problems.includes(p.text)) entry.problems.push(p.text);
    }
    history.set(scope, entry);
  }
}

/** The rewrite's message: the current fixes, every earlier problem of the part not among them, strict mode if stubborn. */
function rewriteMessage(user: string, fixes: string[], past: { problems: string[]; flagged: number } | undefined): string {
  const earlier = (past?.problems ?? []).filter((p) => !fixes.includes(p));
  return [
    user,
    problemsMessage(fixes),
    earlier.length > 0 ? pastProblemsMessage(earlier) : "",
    (past?.flagged ?? 0) >= STRICT_AFTER_REWRITES ? STRICT_MODE : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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

/** A closed `||spoiler||` span (the site's INLINE_SPOILER). */
const SPOILER_SPAN = /\|\|(?=\S)(.+?)\|\|/g;
const SPAN_MARK = "\u0001";

/**
 * Keeps the closed `||spoiler||` spans and drops any `||` that closes nothing (a cut by the length
 * limit, a slip of the model): the site refuses an unclosed spoiler.
 */
function closeSpoilers(text: string): string {
  return text
    .replace(SPOILER_SPAN, (span) => span.replaceAll("||", SPAN_MARK))
    .replaceAll("||", "")
    .replaceAll(SPAN_MARK, "||");
}

/** Inline text: **bold**, *italic* and ||spoiler|| only, no HTML, no script schemes, no links. */
function inline(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const t = text
    .replace(/[\u0000-\u0008\u000B-\u001F]/g, " ")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1")
    .replace(/<(?=[a-zA-Z!/?])/g, "< ")
    .replace(/(javascript|vbscript)\s*:/gi, "$1 ")
    .trim();
  return closeSpoilers(truncate(t, max));
}

/** Text compared for a mention: no markup, lowercase, no accents. */
const comparable = (text: string) =>
  text
    .replace(/[*|]/g, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** `name` appears in `text` as whole words ("old lantern" is not in "old lanternkeeper"); both `comparable`. */
const mentions = (text: string, name: string) =>
  name.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(text);

/** Text without **bold** / *italic* markers and line breaks. */
const unmark = (text: string) =>
  text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\n+/g, " ");

/**
 * Plain text: no markup at all. A `||spoiler||` is unwrapped (its text stays, R19): names, chapter
 * titles, region, overview and cover are shown as is and feed search, so the manual keeps bosses out
 * of them instead.
 */
export function plain(text: string | null | undefined, max: number): string {
  return text ? inline(unmark(text).replaceAll("||", ""), max) : "";
}

/**
 * Plain text that keeps its closed `||spoiler||` spans: the roadmap phase titles and the chapter
 * deadline, which the walkthrough page masks like step text (and search gets unwrapped).
 */
function plainWithSpoilers(text: string | null | undefined, max: number): string {
  return text ? inline(unmark(text), max) : "";
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
  /** R22: write the guide from the PSN list (the dossier already holds only its achievements, see scope.ts). */
  scope?: PsnWriteScope;
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
  scope?: PsnWriteScope;
};

/** The model's texts: the frame and one answer per write job (by job id). */
type Texts = { frame: Frame; jobs: Map<string, ChapterText> };
/** Texts of a draft that may lack parts: a probe's (frame + a few chapters), or a saved draft read back. */
type PartialTexts = { frame: Frame | null; jobs: Map<string, ChapterText> };

/** A draft's texts as saved in the GuideDb (JSON): what a later attempt resumes from. */
export type SavedTexts = { frame: Frame | null; jobs: Record<string, ChapterText> };

/** A saved draft's texts, validated part by part (an invalid part is dropped and written again); undefined if unusable. */
export function parseSavedTexts(raw: unknown): SavedTexts | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as { frame?: unknown; jobs?: unknown };
  const frame = FrameSchema.safeParse(value.frame);
  const jobs: Record<string, ChapterText> = {};
  if (value.jobs && typeof value.jobs === "object") {
    for (const [id, text] of Object.entries(value.jobs as Record<string, unknown>)) {
      const parsed = ChapterTextSchema.safeParse(text);
      if (parsed.success) jobs[id] = parsed.data;
    }
  }
  return { frame: frame.success ? frame.data : null, jobs };
}

const toSaved = (t: PartialTexts): SavedTexts => ({ frame: t.frame, jobs: Object.fromEntries(t.jobs) });
const fromSaved = (t: SavedTexts): PartialTexts => ({ frame: t.frame, jobs: new Map(Object.entries(t.jobs)) });

/** A job the probe did not write: no text (assemble fills the gaps; their repairs are out of the probe's scope). */
const NO_TEXT: ChapterText = { passos: [], itens: [], depois: null };

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
    scope: opts.scope,
  };
}

/** The parts a draft round (re)wrote. */
type Redone = { frame: boolean; jobs: WriteJob[] };

/**
 * Asks the model for the texts. Without `previous`, everything (within `only`, the probe's jobs); with it, only the
 * frame and the jobs some problem points at (each call gets only its own problems) and the parts `previous` lacks,
 * keeping the other texts. A part that had a text before is a "-retry". The first failing call stops the rest.
 */
async function draft(
  ctx: Ctx,
  previous: PartialTexts | undefined,
  problems: GuideProblem[] = [],
  only?: Set<string>,
  history: ProblemHistory = new Map(),
): Promise<{ texts: Texts; redone: Redone }> {
  const own = (scope: string) => [...new Set(problems.filter((p) => p.scope === scope).map((p) => p.text))];
  const call = <T>(purpose: string, retry: boolean, user: string, schema: z.ZodType<T>, scope: string) =>
    ctx.ai.structured({
      bucket: ctx.bucket,
      purpose: retry ? `${purpose}-retry` : purpose,
      model: ctx.models.MODEL_WRITER,
      effort: WRITER_EFFORT,
      system: loadGuideStyle(),
      user: own(scope).length > 0 ? rewriteMessage(user, own(scope), history.get(scope)) : user,
      schema,
      maxTokens: WRITER_MAX_TOKENS,
      fallbacks: ctx.fallbacks,
    });

  const redoFrame = !previous?.frame || own(FRAME_SCOPE).length > 0;
  const redoJobs = ctx.jobs.filter((j) => (!only || only.has(j.id)) && (!previous?.jobs.has(j.id) || own(j.id).length > 0));
  const abort: Abort = { aborted: false };
  const [frame, answers] = await Promise.all([
    redoFrame
      ? abortOnError(
          call("guide-write-frame", Boolean(previous?.frame), frameMessage(ctx.skel, ctx.dossier, ctx.game, ctx.scope), FrameSchema, FRAME_SCOPE),
          abort,
        )
      : Promise.resolve(previous!.frame!),
    inPool(
      redoJobs,
      CONCURRENCY,
      (job) => call("guide-write-chapter", Boolean(previous?.jobs.has(job.id)), jobMessage(ctx.skel, job, ctx.game), ChapterTextSchema, job.id),
      abort,
    ),
  ]);
  const jobs = new Map(previous?.jobs ?? []);
  redoJobs.forEach((job, n) => jobs.set(job.id, answers[n]!));
  return { texts: { frame, jobs }, redone: { frame: redoFrame, jobs: redoJobs } };
}

// ---------------------------------------------------------------------------------------------
// Assembly: the model's text on the code's skeleton
// ---------------------------------------------------------------------------------------------

/**
 * The payload plus what the code had to fill or correct, as problems scoped to the call that should fix it, and the
 * warning callouts the code wrote (Task 21: the checker gets them apart, with their basis, and does not judge them).
 */
export type WrittenGuide = { payload: GuidePayloadV2; repairs: GuideProblem[]; codeWarnings: CodeWarning[] };

/** The dossier facts behind the code's warning of a missable item or achievement of a step. */
function stepWarningBase(x: SkelItem, name: string): Record<string, unknown> {
  const until = untilOf(x.item, x.ach);
  return {
    key: x.key,
    nome: name,
    ...(x.ach ? { apiName: x.ach.apiName, oculta: x.ach.hidden } : {}),
    perdivel: true,
    ...(until ? { ate: until } : {}),
    ...(x.item?.deadlineAssumed || x.ach?.deadlineAssumed ? { prazo_suposto: true } : {}),
  };
}

/** The dossier facts behind the code's warning at a chapter's start: why the code anchored the achievement there. */
function anchorWarningBase(a: DossierAchievement): Record<string, unknown> {
  return {
    apiName: a.apiName,
    nome: achName(a),
    oculta: a.hidden,
    perdivel: true,
    ...(a.missableUntil ? { ate: a.missableUntil } : {}),
    avisar_em: a.warnChapter,
    ...(a.doneChapter ? { concluir_em: a.doneChapter } : {}),
    ...(a.deadlineAssumed ? { prazo_suposto: true } : {}),
  };
}

function assemble(ctx: Ctx, texts: Texts): WrittenGuide {
  const { skel, dossier, game, jobs } = ctx;
  const frame = texts.frame;
  const repairs: GuideProblem[] = [];
  const codeWarnings: CodeWarning[] = [];
  const jobOfStep = new Map(jobs.flatMap((j) => j.steps.map((s) => [s.key, j.id] as const)));
  const scopeOfStep = (stepKey: string) => jobOfStep.get(stepKey) ?? FRAME_SCOPE;
  const steamApiNames = new Set(dossier.achievements.map((a) => a.apiName));
  const itemKeys = new Set([...skel.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => i.key))), ...skel.loose.map((l) => l.key)]);
  const chapterAt = (title: string) => skel.chapters.findIndex((c) => !c.cleanup && c.title === title);

  // --- the model's texts, by key (unknown keys are dropped) -------------------------------------------------
  const stepBlocks = new Map<string, ContentBlock[]>();
  const itemText = new Map<string, ChapterText["itens"][number]>();
  const laterNote = new Map<string, string>();
  const answered = jobs.map((job) => ({ job, text: texts.jobs.get(job.id) ?? NO_TEXT }));
  // Only the job holding a chapter's last step writes its "later" note (it is shown there).
  const lastJobOf = new Map(skel.chapters.map((c) => [c.key, jobs.filter((j) => j.chapter === c).at(-1)?.id]));
  // Cleanup texts first: a loose achievement keeps the cleanup text unless a chapter places it (below).
  const ordered = [...answered.filter((a) => a.job.chapter.cleanup), ...answered.filter((a) => !a.job.chapter.cleanup)];
  for (const { job, text } of ordered) {
    const own = new Set(job.steps.map((s) => s.key));
    for (const step of text.passos) if (own.has(step.key)) stepBlocks.set(step.key, toBlocks(step.blocos));
    for (const i of text.itens) if (itemKeys.has(i.key) && !itemText.has(i.key)) itemText.set(i.key, i);
    if (text.depois && lastJobOf.get(job.chapter.key) === job.id) laterNote.set(job.chapter.key, text.depois);
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
      // Task 20: placed by the code before its point of no return, it is a note (recorded, no rewrite): the problem
      // would go to the job of that step, which may not hold the right place and could never clear it.
      repairs.push(
        target
          ? {
              scope: scopeOfStep(target),
              kind: "nota",
              text: `A conquista perdível "${achName(a)}" (${a.apiName}) não foi posta num passo pelo escritor; o sistema a pôs no passo ${target}, antes do capítulo "${a.deadlineChapter}".`,
            }
          : {
              scope: FRAME_SCOPE,
              text: `A conquista perdível "${achName(a)}" (${a.apiName}) não coube em nenhum passo antes do capítulo "${a.deadlineChapter}" e ficou na limpeza.`,
            },
      );
    } else if (a.missable && a.doneChapter) {
      // Task 18: no limit, only the last place its texts name: the end of that chapter (its warning stays at the anchor).
      const at = chapterAt(a.doneChapter);
      const steps = at >= 0 ? skel.chapters[at]!.steps : [];
      target = withRoomFrom(steps[steps.length - 1]?.key);
      if (target) {
        repairs.push({
          scope: scopeOfStep(target),
          kind: "nota",
          text: `A conquista perdível "${achName(a)}" (${a.apiName}) não foi posta num passo pelo escritor; o sistema a pôs no passo ${target}, no fim do capítulo "${a.doneChapter}".`,
        });
      }
    }
    // Otherwise its default cleanup step (one loose achievement per step, so always with room).
    target ??= skel.chapters.find((c) => c.cleanup)!.steps.find((s) => s.items.includes(l))!.key;
    stepsOf.get(target)!.push(l);
  }

  // --- items ----------------------------------------------------------------------------------------------------
  const cleanupStepOf = new Map(skel.chapters.filter((c) => c.cleanup).flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => [i.key, s.key] as const))));
  const fallbackSources = (): WalkSource[] =>
    game.game.steamAppId ? [{ name: "Steam", url: `https://steamcommunity.com/stats/${game.game.steamAppId}/achievements` }] : [];
  const compatSteamOnly = dossier.facts.compat === "steam_only";
  const notOnPsn = steamOnlyApiNames(dossier);

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
    const location = inline(t?.local, 400);
    if (!location) {
      // Task 20: a loose achievement's text is the cleanup job's (a chapter that places it may write its own): that
      // job is asked for it. No fallback text: the sources' own sentences (location, how-to) would fail the copy check
      // in another job's scope, and a guide with this repair never goes out anyway.
      const owner = cleanupStepOf.get(s.key) ?? stepKey;
      repairs.push({ scope: scopeOfStep(owner), text: `O item "${name}" (${s.key}) ficou sem texto próprio de local; escreva onde fica e como pegar.` });
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
      alsoOn: a && compatSteamOnly && !notOnPsn.has(a.apiName) ? ["psn"] : [],
      sources: sources.length > 0 ? sources : fallbackSources(),
      // R20: a deadline the code assumed (its own chapter) is reviewed too, and so are a revisit placed by the code,
      // a number the code gave (R28), a "collect N" link by a type that only loosely is the thing (Task 18) and a
      // "collect N" the gate accepted short (R39).
      review: Boolean(
        (i && (!i.agreed || i.conflict || i.deadlineAssumed || i.orderAssumed || i.numberAssumed || i.countedByType === "ambiguous")) ||
          (a && (!a.agreed || a.conflict || a.deadlineAssumed || a.collect?.byType || a.collect?.shortfallAccepted)) ||
          sources.length === 0,
      ),
    };
  };

  // --- chapters -------------------------------------------------------------------------------------------------
  const phaseAt = new Map(skel.phases.map((p, i) => [p.key, i]));
  const metaBy = new Map(frame.capitulos.map((c) => [c.key, c]));
  const chapters: WalkChapter[] = [];
  let lastPhase = skel.phases[0]!.key;
  for (const c of skel.chapters) {
    const meta = metaBy.get(c.key);
    const steps = c.steps.map((s) => ({ s, items: stepsOf.get(s.key)! })).filter(({ items }) => !c.cleanup || items.length > 0);
    if (steps.length === 0) continue;
    let phaseKey = meta && phaseAt.has(meta.fase) ? meta.fase : c.cleanup ? skel.phases[skel.phases.length - 1]!.key : lastPhase;
    // The roadmap only moves forward: a chapter never goes back to an earlier phase.
    if (phaseAt.get(phaseKey)! < phaseAt.get(lastPhase)!) {
      repairs.push({
        scope: FRAME_SCOPE,
        text: `O capítulo ${c.key} foi posto na etapa ${phaseKey}, antes da etapa ${lastPhase} do capítulo anterior; ficou na ${lastPhase}. As etapas seguem o roadmap, na ordem.`,
      });
      phaseKey = lastPhase;
    }
    lastPhase = phaseKey;
    let deadline = c.deadlines.length > 0 ? plainWithSpoilers(meta?.prazo, 200) : "";
    if (c.deadlines.length > 0 && !deadline) {
      repairs.push({ scope: FRAME_SCOPE, text: `O capítulo "${c.title}" (${c.key}) tem perdíveis, mas ficou sem o prazo (ponto de não retorno).` });
      deadline = plain(c.deadlines.join("; "), 200);
    }
    // Task 18: loose missables anchored here are warned at the chapter's start (they may be done later).
    const anchored = anchoredIn(skel, c).map((l) => l.ach!);
    const walkSteps = steps.map(({ s, items }, n) => {
      const walkItems = items.map((item) => buildItem(item, s.key));
      const anchor = n === 0 && anchored.length > 0;
      const anchorText = anchor ? anchorWarning(anchored) : undefined;
      // R39: the code's note on each "collect N" of the step accepted short.
      const counts = items.flatMap((x) => {
        const text = x.ach ? countNote(x.ach) : undefined;
        return text ? [{ a: x.ach!, text }] : [];
      });
      // Room for the code's missable warnings, count notes and "later" note within the site's 20 blocks. A writer's
      // block that only repeats a code text (the job message shows the anchor's text) is dropped: never shown twice.
      let blocks = (stepBlocks.get(s.key) ?? [])
        .filter((b) => !sameText(b, anchorText) && !counts.some((c) => sameText(b, c.text)))
        .slice(0, Math.max(1, (anchor ? 17 : 18) - counts.length));
      if (blocks.length === 0) {
        repairs.push({ scope: scopeOfStep(s.key), text: `O passo ${s.key} do capítulo "${c.title}" ficou sem texto; escreva o caminho deste passo.` });
        blocks = [{ type: "paragraph", text: walkItems.length > 0 ? `Neste ponto: ${walkItems.map((i) => i.name).join(", ")}.` : "Siga em frente pela história." }];
      }
      // The missable warning comes first in the step, before the text that leads past the point of no return.
      // Task 20 review: a writer's "aviso" about something else does not replace it; an item the writer's warnings
      // already cite (by its name or its English name) needs no second one.
      const warnings = blocks.filter((b) => b.type === "callout" && b.tone === "aviso").map((b) => comparable((b as { text: string }).text));
      const cited = (i: WalkItem) => [i.name, i.nameEn].some((n) => n && warnings.some((w) => mentions(w, comparable(n))));
      // Only what the dossier marks missable is warned, each by its name (Task 21: never "o item deste passo").
      const warn = items.filter((x) => isMissable(x) && !x.item?.returnLater);
      const unwarned = walkItems.flatMap((i) => {
        const x = warn.find((w) => w.key === i.key);
        return x && !cited(i) ? [{ i, x }] : [];
      });
      if (unwarned.length > 0) {
        const names = joinPt(unwarned.map(({ i, x }) => warnedName(i.name, i.spoiler, x.ach)));
        // No milestone here: it often names a boss (spoiler). The chapter's `deadline` carries it.
        const text = inline(`Perdível: pegue ${names} agora, antes de seguir.`, 2000);
        blocks = [{ type: "callout", tone: "aviso", text }, ...blocks.filter((b) => !sameText(b, text))];
        codeWarnings.push({ step: s.key, text, base: unwarned.map(({ i, x }) => stepWarningBase(x, i.name)) });
      }
      if (anchorText) {
        const text = anchorText;
        blocks = [{ type: "callout", tone: "aviso", text }, ...blocks];
        codeWarnings.push({ step: s.key, text, base: anchored.map(anchorWarningBase) });
      }
      for (const { a, text } of counts) {
        blocks = [...blocks, { type: "callout", tone: "info", text }];
        const sa = a.collect!.shortfallAccepted!;
        codeWarnings.push({
          step: s.key,
          text,
          base: [{ apiName: a.apiName, nome: achName(a), pede: a.collect!.target, localizados: sa.located, declarados: sa.stated, faltam: sa.missing, tipo: sa.label, fonte: sa.source }],
        });
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
    return { key: p.key, title: plainWithSpoilers(t?.titulo, 160) || plain(p.title, 160) || "Etapa", hours: NO_DATA, body: blocks.slice(0, 120), achievements };
  });

  // --- ficha and cover ----------------------------------------------------------------------------------------
  const ficha = fichaOf(skel, dossier, game, ctx.scope);
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
      ...(ficha.psn ? [ficha.psn.trophies, ficha.psn.steam, ficha.psn.steamOnly] : []),
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
    // Scope psn: the count the guide covers is the PSN list's (the Steam total stays in the ficha text).
    ficha.psn ? { value: String(ficha.psn.trophies), label: "Troféus PSN" } : { value: String(ficha.achievements), label: "Conquistas" },
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
      ...(ctx.scope ? { scope: "psn" as const, psnList: ctx.scope.psnList, steamOnly: ctx.scope.steamOnly } : {}),
      readFirst,
      chapters,
    },
  };
  return { payload, repairs: repairs.map((r) => ({ ...r, kind: r.kind ?? "reparo" })), codeWarnings };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * The writer's calls without calling anything (the dry run's cost estimate): the system prompt, the frame message
 * and each write job's message, with the job's step and item counts.
 */
export function writerPlan(
  dossier: GuideDossier,
  game: GuideDossierSource,
  scope?: PsnWriteScope,
): { system: string; frame: string; jobs: { message: string; steps: number; items: number }[] } {
  const skel = buildSkeleton(dossier);
  return {
    system: loadGuideStyle(),
    frame: frameMessage(skel, dossier, game, scope),
    jobs: writeJobs(skel).map((job) => ({
      message: jobMessage(skel, job, game),
      steps: job.steps.length,
      items: job.steps.reduce((n, s) => n + s.items.length, 0),
    })),
  };
}

/** Writes the guide and reports what the code had to fill or correct (as scoped problems). */
export async function writeGuideDetailed(
  ai: Ai,
  dossier: GuideDossier,
  game: GuideDossierSource,
  bucket: SpendBucket,
  opts: WriteGuideOpts = {},
): Promise<WrittenGuide> {
  const ctx = context(ai, dossier, game, bucket, opts);
  return assemble(ctx, (await draft(ctx, undefined)).texts);
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

/**
 * One write-and-check round, as the GuideDb keeps it (Task 20): what was paid for is never lost, and a later attempt
 * resumes from it. `problems` are the blocking ones (scope + kind), what the next round rewrites; `repairs` everything
 * the code filled or corrected (notes included); `texts` the model's answers (a probe's lack the unwritten chapters).
 */
export type DraftRound = {
  round: number;
  ok: boolean;
  /** Written by a probe (`probe`): only the frame and the first chapters. */
  probe: boolean;
  texts: SavedTexts;
  payload: GuidePayloadV2;
  problems: GuideProblem[];
  repairs: GuideProblem[];
  internalErrors: string[];
  /**
   * A probe resumed from a failed draft: the earlier problems outside its chapters, still owed (their texts are kept
   * as they were). Not the probe's verdict; the next run rewrites them. Always empty outside a probe.
   */
  pending: GuideProblem[];
};

/**
 * `internalErrors`: chronology violations of the code's own structure (chapter order, phases, the skeleton's items):
 * a robot bug, not the model's to rewrite. The guide still goes to review, with them in the report. `draft`: the last
 * round (absent only from test fakes).
 */
export type GuideWriteResult = (
  | { ok: true; payload: GuidePayloadV2 }
  | { ok: false; problems: string[]; payload: GuidePayloadV2 }
) & { internalErrors?: string[]; draft?: DraftRound };

export type WriteAndCheckOpts = WriteGuideOpts & {
  /** Text of the source pages, for the copy check; defaults to the source texts the dossier carries. */
  sourceTexts?: string[];
  /**
   * Task 20: a saved draft of the same writing key. Its accepted parts are kept; only the parts its problems point at
   * and the parts it lacks are written (then checked); a failure still gets one more rewrite.
   */
  resume?: { texts: SavedTexts; problems: GuideProblem[] };
  /** The cheap probe: only the frame and the first `chapters` story chapters, checked once, never rewritten. */
  probe?: { chapters: number };
  /** Called after each round is checked (the pipeline saves it at once: a later failure loses nothing paid). */
  onRound?: (round: DraftRound) => void;
  /**
   * Task 30: what the saved rounds of this request and base key already pointed at, per part (drafts.ts
   * `problemHistory`); this run's rounds are added as they are checked. Rewrites see all of it.
   */
  history?: ProblemHistory;
};

/**
 * The job's steps as rendered in the payload (texts, items and their texts): a job whose rendering changed must be
 * checked again, even when another job wrote the change (a loose achievement's text comes from the cleanup job).
 */
function jobSignature(payload: GuidePayloadV2, job: WriteJob): string {
  return JSON.stringify(jobSteps(payload, job));
}

/** A frame with no text: only to render a saved draft whose frame is unusable, to compare its jobs. */
const BLANK_FRAME: Frame = {
  capa: { chamadas: [], manchete: "", linhaFina: "" },
  ficha: { dificuldade: 5, justificativaDificuldade: "", notaZeradas: "", maisDificil: null },
  visaoGeral: [],
  leiaAntes: [],
  etapas: [],
  capitulos: [],
};

/**
 * Writes and checks: the code's repairs, the deterministic checks (copy, vocabulary, the model's chronology slips),
 * then the LLM checker per frame and per job. With problems, rewrites once only the frame and the jobs they point at,
 * then checks again (the LLM only where the text or the items changed). `ok: false` after that: the pipeline marks
 * the request `failed`. With `resume`, the first round writes only what the saved draft still needs; with `probe`,
 * one round over the frame and the first chapters.
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
  // Task 23: the proper names the guide must cite never count as copy.
  const names = knownNames(dossier);
  // The ficha counts the frame writer was told to cite (the frame message's "## Ficha").
  const ficha = fichaOf(ctx.skel, dossier, game, ctx.scope);
  const checkContext: CheckContext = {
    game: { name: game.game.name, developer: game.game.developer, publisher: game.game.publisher, summary: game.game.summary },
    ficha: {
      conquistas: ficha.achievements,
      ocultas: ficha.hidden,
      perdiveis: ficha.missables,
      online: ficha.online,
      comBug: ficha.bugged,
      capitulos: ficha.chapters,
      regioes: ficha.regions,
      ...(ficha.psn ? { trofeusPsn: ficha.psn.trophies, conquistasSteam: ficha.psn.steam, soNaSteam: ficha.psn.steamOnly } : {}),
    },
  };
  const checkOpts = { bucket, model: ctx.models.MODEL_CHECK, effort: ctx.models.CHECK_EFFORT, context: checkContext };

  // The probe: the frame and the jobs of the first N story chapters; problems of other parts are not its own.
  const probed = opts.probe ? new Set(ctx.skel.chapters.filter((c) => !c.cleanup).slice(0, Math.max(1, opts.probe.chapters))) : undefined;
  const only = probed ? new Set(ctx.jobs.filter((j) => probed.has(j.chapter)).map((j) => j.id)) : undefined;
  const inScope = (scope: string) => !only || scope === FRAME_SCOPE || only.has(scope);

  const jobOfStep = new Map(ctx.jobs.flatMap((j) => j.steps.map((s) => [s.key, j.id] as const)));
  /** A walkthrough key's scope (an item's goes to the job of its step; null is the frame). */
  const scoper = (written: WrittenGuide) => {
    const stepOfItem = new Map(written.payload.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => [i.key, s.key] as const))));
    return (key: string | null) => (key === null ? FRAME_SCOPE : (jobOfStep.get(stepOfItem.get(key) ?? key) ?? FRAME_SCOPE));
  };
  /** The copy and vocabulary findings, scoped. */
  const textChecks = (written: WrittenGuide): GuideProblem[] => {
    const scopeOf = scoper(written);
    return deterministicProblems(written.payload, sources, names).map((p) => ({ text: p.text, scope: scopeOf(p.key), kind: p.kind }));
  };
  const blocking = (written: WrittenGuide): GuideProblem[] => {
    const scopeOf = scoper(written);
    const byWriter = chronologyProblems(written.payload, ctx.skel, ctx.dossier)
      .filter((p) => p.owner === "writer")
      .map((p) => ({ text: p.text, scope: scopeOf(p.key), kind: "cronologia" as const }));
    return [
      // A note is the code's own honest placement: recorded with the draft, never a reason to rewrite.
      ...written.repairs.filter((r) => r.kind !== "nota"),
      ...textChecks(written),
      ...byWriter,
    ];
  };
  /** The code's own chronology violations: reported, never sent to the model. */
  const internalOf = (written: WrittenGuide) =>
    chronologyProblems(written.payload, ctx.skel, ctx.dossier).filter((p) => p.owner === "code").map((p) => p.text);

  let texts: PartialTexts | undefined = opts.resume ? fromSaved(opts.resume.texts) : undefined;
  let problems: GuideProblem[] = opts.resume ? opts.resume.problems.filter((p) => inScope(p.scope)) : [];
  // Jobs a probe left to be checked again (their rendering changed outside its chapters): checked, not rewritten.
  const due = new Set(problems.filter((p) => p.kind === CHECK_DUE).map((p) => p.scope));
  problems = problems.filter((p) => p.kind !== CHECK_DUE);
  // Task 20 review: a probe resumed from a failed draft keeps the failures outside its chapters (its texts keep those
  // parts): they never trigger a rewrite in the probe nor count in its verdict, but the next full run rewrites them.
  const pending = opts.resume ? opts.resume.problems.filter((p) => !inScope(p.scope)) : [];
  // What the previous texts render to (a blank frame when the saved one is unusable): a job whose rendering changed
  // is checked again.
  let before: WrittenGuide | undefined = texts ? assemble(ctx, { frame: texts.frame ?? BLANK_FRAME, jobs: texts.jobs }) : undefined;
  // Task 23: the saved draft's copy and vocabulary findings are redone on its texts with the current check: one it no
  // longer makes costs no rewrite, one it still makes is rewritten in the first round.
  if (before && texts) {
    const written = new Set([...(texts.frame ? [FRAME_SCOPE] : []), ...texts.jobs.keys()]);
    problems = [
      ...problems.filter((p) => p.kind !== "copia" && p.kind !== "vocabulario"),
      ...textChecks(before).filter((p) => written.has(p.scope) && inScope(p.scope)),
    ];
  }
  // Task 30: a copy (this run's rounds are added to it, the caller's map stays as it was).
  const history: ProblemHistory = new Map([...(opts.history ?? [])].map(([k, v]) => [k, { problems: [...v.problems], flagged: v.flagged }]));
  let last: DraftRound | undefined;
  for (let round = 1; round <= (opts.probe ? 1 : 2); round++) {
    const next = await draft(ctx, texts, problems, only, history);
    const written = assemble(ctx, next.texts);
    const recheck = ctx.jobs.filter(
      (j) =>
        (!only || only.has(j.id)) &&
        (next.redone.jobs.includes(j) ||
          (round === 1 && due.has(j.id)) ||
          (before !== undefined && jobSignature(before.payload, j) !== jobSignature(written.payload, j))),
    );
    // Task 20 review: in a probe, a kept job outside its chapters whose rendering changed (a loose achievement the
    // probe's rewrite stopped placing went there, with the cleanup's text) is owed a check by the next run.
    const owed: GuideProblem[] = only
      ? ctx.jobs
          .filter((j) => !only.has(j.id) && next.texts.jobs.has(j.id) && !pending.some((p) => p.scope === j.id))
          .filter((j) => before !== undefined && jobSignature(before.payload, j) !== jobSignature(written.payload, j))
          .map((j) => ({
            scope: j.id,
            kind: CHECK_DUE,
            text: `O trecho ${j.id} mudou com a sonda (um item foi posto nele ou saiu dele) e precisa ser checado de novo.`,
          }))
      : [];
    const checked = (
      await checkScopes(ai, written.payload, dossier, ctx.skel, { frame: next.redone.frame, jobs: recheck }, { ...checkOpts, codeWarnings: written.codeWarnings })
    ).filter((p) => inScope(p.scope));
    // What the checker listed as right is recorded with the notes (auditable), never a reason to rewrite.
    const right = checked.filter((p) => p.kind === CHECKER_RIGHT);
    const found = [...blocking(written).filter((p) => inScope(p.scope)), ...checked.filter((p) => p.kind !== CHECKER_RIGHT)];
    last = {
      round,
      ok: found.length === 0,
      probe: Boolean(opts.probe),
      texts: toSaved(next.texts),
      payload: written.payload,
      problems: found,
      repairs: [...written.repairs.filter((r) => inScope(r.scope)), ...right],
      internalErrors: internalOf(written),
      pending: [...pending, ...owed],
    };
    opts.onRound?.(last);
    addProblems(history, found);
    texts = next.texts;
    problems = found;
    before = written;
    if (found.length === 0) break;
  }
  const done = last!;
  const internal = done.internalErrors.length > 0 ? { internalErrors: done.internalErrors } : {};
  if (done.ok) return { ok: true, payload: done.payload, ...internal, draft: done };
  return { ok: false, problems: [...new Set(done.problems.map((p) => p.text))], payload: done.payload, ...internal, draft: done };
}
