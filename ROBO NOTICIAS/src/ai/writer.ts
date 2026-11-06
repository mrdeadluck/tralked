import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { assemble } from "../assemble.js";
import type { Config, Source } from "../config.js";
import type { SpendBucket } from "../db.js";
import type { XPost } from "../media/xposts.js";
import { ARTICLE_CATEGORIES, ARTICLE_PLATFORMS, type ArticleCategory, type ArticlePlatform, type Insights } from "../tralked.js";
import type { Ai } from "./client.js";
import { checkDraft } from "./checker.js";
import { escapeAttr, escapeText } from "./escape.js";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** Robot news never uses GUIAS or COMUNIDADE (spec); Pautas sets its own category in code after the draft. */
export const NEWS_CATEGORIES = ["GAMES", "MERCADO", "ENTRETENIMENTO", "TECNOLOGIA"] as const satisfies readonly ArticleCategory[];
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export type DraftBlock =
  | { h: string }
  | { p: string }
  | { lista: string[] }
  | { citacao: string; autor: string }
  | { tabela: { cabecalho: string[]; linhas: string[][] } };

/** What the writer model fills. Lengths are guidance for the model; `assemble` enforces the API limits. */
export type Draft = {
  title: string;
  subtitle: string;
  excerpt: string;
  pontos: [string, string, string];
  corpo: DraftBlock[];
  noTralked: null | { casual: string | null; cacador: string | null; conquistas: string[] };
  pergunta: string;
  category: NewsCategory;
  platforms: ArticlePlatform[];
  games: string[];
  imageLabel: string;
  rumor: boolean;
};

export type StorySource = {
  name: string;
  tier: Source["tier"];
  url: string;
  publishedAt: Date | null;
  /** Full article text; empty for title-only sources. */
  text: string;
  /** Headline of the item; what a title-only source is shown with. */
  title?: string;
  /** The source has no fetchable text (ruling R15): it may only be cited as "segundo <name>". */
  textUnavailable?: true;
};

export type StoryForWriting = {
  id: number;
  headline: string;
  category: ArticleCategory;
  rumor: boolean;
  sources: StorySource[];
  candidates: { slug: string; name: string; insights: Insights | null }[];
  /** Set when updating an article that is already published; `newFacts` are the facts the update adds. */
  previous?: { title: string; blocksText: string; newFacts?: string[] };
  /** Set on a follow-up: the earlier article of the same case, context only (linked by `assemble`). */
  parent?: { title: string; blocksText: string };
  /** Pautas Tralked: the format's instructions and title, added to the user message. */
  formatBrief?: string;
  /**
   * The official video embedded in the article (a YouTube channel item of the story). `only`: the story
   * has no text source besides the video (a video story: new trailer or gameplay).
   */
  video?: { youtubeId: string; title: string; channel: string; only: boolean };
  /** Official X posts the article embeds (src/media/xposts.ts), placed by `assemble`. */
  posts?: XPost[];
};

export type Models = Pick<Config, "MODEL_WRITER" | "MODEL_FAST">;

/** Same defaults as config. Callers pass the loaded config. */
export const DEFAULT_MODELS: Models = { MODEL_WRITER: "claude-opus-5-5", MODEL_FAST: "claude-haiku-5-5" };

/** The SDK rejects larger non-streaming values; an article fits easily. */
const WRITER_MAX_TOKENS = 16000;

// ---------------------------------------------------------------------------------------------
// Schema (structured outputs drop length constraints, so the limits live in the descriptions)
// ---------------------------------------------------------------------------------------------

const DraftBlockSchema = z.union([
  z.object({ h: z.string().describe("Intertítulo curto") }),
  z.object({ p: z.string().describe("Parágrafo de 2 a 4 frases") }),
  z.object({ lista: z.array(z.string()).describe("Itens paralelos") }),
  z.object({ citacao: z.string().describe("Fala curta, sem aspas"), autor: z.string().describe("Quem disse") }),
  z.object({
    tabela: z.object({
      cabecalho: z.array(z.string()),
      linhas: z.array(z.array(z.string())).describe("Cada linha com o mesmo número de colunas do cabeçalho"),
    }),
  }),
]);

export const DraftSchema = z.object({
  title: z.string().describe("Curto: 4 a 9 palavras, até uns 60 caracteres, direto, sem clickbait"),
  subtitle: z.string().describe("Linha fina: o fato em uma frase, até 220 caracteres"),
  excerpt: z.string().describe("Resumo para os cards, até 280 caracteres"),
  pontos: z.array(z.string()).min(3).describe("Exatamente 3 frases curtas com o essencial"),
  corpo: z.array(DraftBlockSchema).min(1).describe("A matéria em blocos"),
  noTralked: z
    .object({
      casual: z.string().nullable().describe("Pra quem joga de boa, sem o rótulo; null se não houver nada útil"),
      cacador: z.string().nullable().describe("Pra quem caça 100%, sem o rótulo; null se não houver nada útil"),
      conquistas: z.array(z.string()).describe("Até 3 apiNames de `rarest` dos dados do Tralked"),
    })
    .nullable()
    .describe("null quando a notícia não tem nada útil para nenhum dos dois perfis"),
  pergunta: z.string().describe("Pergunta neutra ao leitor"),
  category: z.enum(NEWS_CATEGORIES),
  platforms: z.array(z.enum(ARTICLE_PLATFORMS)),
  games: z.array(z.string()).describe("Slugs da lista de jogos candidatos"),
  imageLabel: z.string().describe("Rótulo da capa, até 60 caracteres, minúsculas"),
  rumor: z.boolean(),
});

// ---------------------------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------------------------

let styleCache: string | null = null;

/** The editorial manual (system prompt). Cached by the API, so it must stay byte-stable. */
export function loadStyle(): string {
  styleCache ??= readFileSync(new URL("../../prompts/estilo.md", import.meta.url), "utf8");
  return styleCache;
}

const TZ = "America/Sao_Paulo";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const todayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

const attr = escapeAttr;
/** Outside text (sources, headline, names, data) may not open or close tags of the prompt. */
const body = escapeText;
const dateOf = (d: Date | null) => (d ? dayFmt.format(d) : "sem data");

const isHeadlineOnly = (s: StorySource) => s.textUnavailable === true || s.text.trim() === "";

/** The user message: sources, candidate games with Tralked data, today's date and update context. */
export function writePrompt(story: StoryForWriting, now: Date = new Date()): string {
  const full = story.sources.filter((s) => !isHeadlineOnly(s));
  const headlines = story.sources.filter((s) => isHeadlineOnly(s) && (s.title ?? s.text).trim() !== "");
  const parts: string[] = [];

  parts.push(
    [
      `Hoje é ${todayFmt.format(now)} (horário de Brasília).`,
      `Pauta: ${body(story.headline)}`,
      `Categoria sugerida pela triagem: ${story.category}`,
      `A triagem marcou como rumor: ${story.rumor ? "sim" : "não"}`,
    ].join("\n"),
  );

  parts.push(
    [
      "## Fontes com texto completo",
      "Os fatos da matéria vêm daqui.",
      ...full.map(
        (s) =>
          `<fonte nome="${attr(s.name)}" tier="${s.tier}" url="${attr(s.url)}" data="${dateOf(s.publishedAt)}">${body(s.text)}</fonte>`,
      ),
      full.length === 0 ? "(nenhuma)" : "",
    ]
      .filter((l) => l !== "")
      .join("\n\n"),
  );

  if (headlines.length > 0) {
    parts.push(
      [
        "## Fontes de manchete apenas (sem texto)",
        'Estes veículos chegaram só com o título. Não tire fatos deles: cada um só pode ser citado como "segundo <veículo>", com o que a manchete afirma.',
        ...headlines.map(
          (s) =>
            `<manchete nome="${attr(s.name)}" url="${attr(s.url)}" data="${dateOf(s.publishedAt)}">${body(s.title ?? s.text)}</manchete> (cite como "segundo ${body(s.name)}")`,
        ),
      ].join("\n\n"),
    );
  }

  parts.push(
    [
      "## Jogos candidatos",
      "Em `games`, use só slugs desta lista. Os dados do Tralked servem só para a parte \"No Tralked\" (tempos em minutos).",
      ...(story.candidates.length === 0
        ? ["(nenhum)"]
        : story.candidates.map(
            (c) =>
              `- ${body(c.name)} (${body(c.slug)}): ${c.insights ? `dados do Tralked ${body(JSON.stringify(c.insights))}` : "sem dados do Tralked"}`,
          )),
    ].join("\n"),
  );

  if (story.parent) {
    parts.push(
      [
        "## Suíte de uma matéria anterior",
        `<caso_anterior titulo="${attr(story.parent.title)}">\n${body(story.parent.blocksText)}\n</caso_anterior>`,
        "Esta matéria é a continuação de um caso que o Tralked já publicou (acima, só como contexto). Escreva uma matéria nova sobre o desenvolvimento trazido pelas fontes: o fato novo vai para o título, a linha fina e o começo do corpo. Não repita a matéria anterior; retome o caso em no máximo uma frase. O link para a matéria anterior é acrescentado automaticamente.",
      ].join("\n\n"),
    );
  }

  if (story.previous) {
    const newFacts = story.previous.newFacts ?? [];
    parts.push(
      [
        "## Atualização",
        `<materia_anterior titulo="${attr(story.previous.title)}">\n${body(story.previous.blocksText)}\n</materia_anterior>`,
        "Esta matéria já foi publicada. Reescreva-a inteira e acrescente os fatos novos das fontes acima: o fato novo vai para o título, a linha fina e o começo do corpo; o que continua válido permanece.",
        ...(newFacts.length > 0
          ? [`Fatos novos a acrescentar (confira cada um nas fontes):\n${newFacts.map((f) => `- ${body(f)}`).join("\n")}`]
          : []),
      ].join("\n\n"),
    );
  }

  if (story.video) {
    parts.push(
      [
        "## Vídeo oficial",
        `O vídeo "${body(story.video.title)}", do canal oficial ${body(story.video.channel)} no YouTube, aparece embutido na matéria logo depois do primeiro parágrafo; ele é acrescentado automaticamente, não escreva link nem código para ele.`,
        story.video.only
          ? "Esta é uma matéria sobre o vídeo (um trailer ou gameplay novo): o fato é o lançamento do vídeo. Conte o que ele apresenta a partir do título e da descrição na fonte do canal. Não descreva cenas, falas ou duração que não estejam nesse texto, e não diga que o texto é curto ou que faltam detalhes."
          : "O vídeo complementa a notícia; pode mencioná-lo numa frase (\"o trailer, logo abaixo, mostra...\") só com o que a descrição dele sustenta.",
      ].join("\n\n"),
    );
  }

  if (story.posts?.length) {
    parts.push(
      [
        "## Posts no X",
        ...story.posts.map(
          (p) => `- ${body(p.authorName)} (@${body(p.authorHandle)}${p.official === false ? ", perfil não oficial" : ""}): "${body(p.text)}"`,
        ),
        "Cada post acima aparece incorporado automaticamente na matéria, depois do parágrafo que cita o autor dele (ou logo no começo, se nenhum citar). Pode citar o autor e o que o post diz, como fonte; não escreva o link do post nem copie o post inteiro no texto.",
        ...(story.posts.some((p) => p.official === false)
          ? ["Quando o post é de perfil não oficial, deixe claro no texto quem é o autor (por exemplo, um perfil de vazamentos ou um jornalista) e trate o que ele diz como rumor, nunca como anúncio oficial."]
          : []),
      ].join("\n"),
    );
  }

  if (story.formatBrief) parts.push(`## Formato desta pauta\n\n${story.formatBrief}`);

  parts.push("Escreva a matéria seguindo o manual de redação.");
  return parts.join("\n\n");
}

/** The system prompt: the editorial manual, plus an addendum (Pautas Tralked) when given. */
function systemPrompt(extra?: string): string {
  return extra ? `${loadStyle()}\n\n${extra}` : loadStyle();
}

/** The sources as plain text for the fact-checker, escaped like the writer's source bodies. */
export function sourcesText(story: StoryForWriting): string {
  const sources = story.sources.map((s) =>
    isHeadlineOnly(s)
      ? `[${body(s.name)}] manchete apenas (${dateOf(s.publishedAt)}): ${body(s.title ?? s.text)}`
      : `[${body(s.name)}] (${s.tier}, ${dateOf(s.publishedAt)}, ${body(s.url)})\n${body(s.text)}`,
  );
  // A follow-up may recap the case in one sentence: the checker needs the earlier article to verify it.
  if (story.parent) {
    sources.push(`[Matéria anterior do Tralked] ${body(story.parent.title)}\n${body(story.parent.blocksText)}`);
  }
  return sources.join("\n\n");
}

function feedbackOf(problems: string[]): string {
  return [
    "## Correções obrigatórias",
    "A checagem de fatos encontrou estes problemas na versão anterior. Reescreva a matéria inteira corrigindo-os; o que as fontes não sustentam sai do texto.",
    ...problems.map((p) => `- ${p}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------------

export type WriteOpts = {
  models?: Models;
  now?: Date;
  /** Fact-check problems of a previous attempt, appended to the user message. */
  problems?: string[];
  /**
   * Server-side fallbacks; defaults to `bucket === "live"`. The backfill's rewrite is a live Messages call
   * (only the batch must omit fallbacks), so it passes `true`.
   */
  fallbacks?: boolean;
  /** Appended to the editorial manual in the system prompt (Pautas Tralked). */
  systemExtra?: string;
};

export async function writeDraft(ai: Ai, story: StoryForWriting, bucket: SpendBucket, opts: WriteOpts = {}): Promise<Draft> {
  const models = opts.models ?? DEFAULT_MODELS;
  const retry = (opts.problems?.length ?? 0) > 0;
  let user = writePrompt(story, opts.now);
  if (retry) user += `\n\n${feedbackOf(opts.problems!)}`;

  const raw = await ai.structured({
    bucket,
    purpose: retry ? "write-retry" : "write",
    model: models.MODEL_WRITER,
    effort: "high",
    system: systemPrompt(opts.systemExtra),
    user,
    schema: DraftSchema,
    maxTokens: WRITER_MAX_TOKENS,
    // Live calls fall back server-side on refusals; the Batches API rejects `fallbacks`.
    fallbacks: opts.fallbacks ?? bucket === "live",
  });
  return toDraft(raw);
}

/** Keeps exactly 3 `pontos` (the schema guarantees at least 3). */
function toDraft(raw: z.infer<typeof DraftSchema>): Draft {
  const [a, b, c] = raw.pontos;
  return { ...raw, pontos: [a!, b!, c!] };
}

/**
 * The backfill's Message Batches request for a story: the same system prompt, user prompt, model, effort,
 * schema and `maxTokens` as `writeDraft`, without `fallbacks` (the Batches API rejects it).
 */
export function writeBatchRequest(
  ai: Ai,
  story: StoryForWriting,
  customId: string,
  opts: Pick<WriteOpts, "models" | "now" | "systemExtra"> = {},
): ReturnType<Ai["batchRequest"]> {
  const models = opts.models ?? DEFAULT_MODELS;
  return ai.batchRequest({
    customId,
    purpose: "write",
    model: models.MODEL_WRITER,
    effort: "high",
    system: systemPrompt(opts.systemExtra),
    user: writePrompt(story, opts.now),
    schema: DraftSchema,
    maxTokens: WRITER_MAX_TOKENS,
  });
}

/** Parses a batch result's text with the writer's schema; null when it is not a valid draft. */
export function parseDraftText(text: string): Draft | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = DraftSchema.safeParse(json);
  return parsed.success ? toDraft(parsed.data) : null;
}

export type WriteResult = { ok: true; draft: Draft } | { ok: false; problems: string[] };

/** Writes and fact-checks; on a failed check rewrites once with the problems, then checks again. */
export async function writeAndCheck(
  ai: Ai,
  story: StoryForWriting,
  bucket: SpendBucket,
  opts: Omit<WriteOpts, "problems"> = {},
): Promise<WriteResult> {
  const models = opts.models ?? DEFAULT_MODELS;
  const sources = sourcesText(story);

  const first = await writeDraft(ai, story, bucket, opts);
  const check = { model: models.MODEL_FAST, candidates: story.candidates };
  const firstCheck = await checkDraft(ai, first, sources, bucket, check);
  if (firstCheck.ok) return { ok: true, draft: first };

  const second = await writeDraft(ai, story, bucket, { ...opts, problems: firstCheck.problems });
  const secondCheck = await checkDraft(ai, second, sources, bucket, check);
  if (secondCheck.ok) return { ok: true, draft: second };
  return { ok: false, problems: secondCheck.problems };
}

// ---------------------------------------------------------------------------------------------
// Sample run: `pnpm tsx src/ai/writer.ts --amostra test/fixtures/story.json` (prints, never publishes)
// ---------------------------------------------------------------------------------------------

const InsightsSchema = z.object({
  game: z.object({
    slug: z.string(),
    name: z.string(),
    releaseDate: z.string().nullable(),
    platforms: z.array(z.string()),
    achievementCount: z.number(),
    timeToBeatCompleteMin: z.number().nullable(),
  }),
  tralked: z.object({ players: z.number(), avgPlaytimeMin: z.number().nullable() }),
  rarest: z.array(z.object({ platform: z.string(), apiName: z.string(), name: z.string(), globalPct: z.number() })),
});

const StoryJsonSchema = z.object({
  id: z.number().int(),
  headline: z.string().min(1),
  category: z.enum(ARTICLE_CATEGORIES),
  rumor: z.boolean(),
  sources: z
    .array(
      z.object({
        name: z.string().min(1),
        tier: z.enum(["oficial", "portal", "outro"]),
        url: z.string().url(),
        publishedAt: z.iso.datetime({ offset: true }).nullable(),
        text: z.string(),
        title: z.string().optional(),
        textUnavailable: z.literal(true).optional(),
      }),
    )
    .min(1),
  candidates: z.array(z.object({ slug: z.string().min(1), name: z.string().min(1), insights: InsightsSchema.nullable() })),
  previous: z.object({ title: z.string(), blocksText: z.string() }).optional(),
});

/** A story from JSON (dates as ISO strings), e.g. the sample fixture. */
export function parseStory(raw: unknown): StoryForWriting {
  const story = StoryJsonSchema.parse(raw);
  return {
    ...story,
    sources: story.sources.map(({ publishedAt, ...s }) => ({ ...s, publishedAt: publishedAt ? new Date(publishedAt) : null })),
  } as StoryForWriting;
}

async function amostra(path: string): Promise<void> {
  await import("dotenv/config");
  const { loadConfig } = await import("../config.js");
  const { openDb } = await import("../db.js");
  const { createRobotAi } = await import("./backend.js");

  const config = loadConfig();
  const story = parseStory(JSON.parse(readFileSync(path, "utf8")));
  const ai = createRobotAi(config, openDb(config.DATA_DIR));

  const result = await writeAndCheck(ai, story, "live", { models: config });
  if (!result.ok) {
    console.error("Matéria reprovada na checagem:");
    for (const problem of result.problems) console.error(`- ${problem}`);
    process.exitCode = 1;
    return;
  }
  const insights = new Map(story.candidates.flatMap((c) => (c.insights ? [[c.slug, c.insights] as const] : [])));
  console.error("Rascunho do modelo:");
  console.error(JSON.stringify(result.draft, null, 2));
  console.log(JSON.stringify(assemble(result.draft, story, { insights }), null, 2));
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  const flag = process.argv.indexOf("--amostra");
  const path = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (!path) {
    console.error("Uso: pnpm tsx src/ai/writer.ts --amostra <story.json>");
    process.exitCode = 2;
  } else {
    amostra(path).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
