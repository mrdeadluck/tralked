import { readFileSync } from "node:fs";
import { z } from "zod";

/** Treat empty strings (e.g. "KEY=" in .env) as unset. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);

const ConfigSchema = z.object({
  /**
   * Where the AI runs: "claude-code" (default since 05/11/2026: `claude -p` on Lucas's PC, billed to his
   * subscription) or "api" (Anthropic API credits; needs ANTHROPIC_API_KEY).
   */
  AI_BACKEND: opt(z.enum(["claude-code", "api"]).default("claude-code")),
  ANTHROPIC_API_KEY: opt(z.string().min(1).optional()),
  /** The Claude Code executable (absolute path when the scheduler's PATH does not have it). */
  CLAUDE_BIN: opt(z.string().min(1).default("claude")),
  CLAUDE_TIMEOUT_MS: opt(z.coerce.number().int().positive().default(600_000)),
  /** The robot stops once this share of the weekly subscription window is used (the rest is Lucas's). */
  CLAUDE_WEEKLY_STOP: opt(z.coerce.number().gt(0).max(1).default(0.9)),
  TRALKED_API_URL: opt(z.string().url().default("https://tralked.com")),
  TRALKED_API_KEY: opt(z.string({ error: "TRALKED_API_KEY is required" }).min(1)),
  MODEL_WRITER: opt(z.string().default("claude-opus-5-5")),
  MODEL_FAST: opt(z.string().default("claude-haiku-5-5")),
  /** The visual check of an article's candidate images (one call per article). */
  MODEL_VISION: opt(z.string().default("claude-sonnet-5-5")),
  DAILY_BUDGET_USD: opt(z.coerce.number().positive().default(5)),
  BACKFILL_BUDGET_USD: opt(z.coerce.number().positive().default(70)),
  MAX_PER_DAY: opt(z.coerce.number().int().positive().default(20)),
  /** `publica` leaves at least this many minutes between two articles (bombs are exempt). */
  PUBLISH_GAP_MINUTES: opt(z.coerce.number().int().positive().default(21)),
  /** News older than this (since its first item) is never published: daily news only, no backdated stories. */
  NEWS_MAX_AGE_HOURS: opt(z.coerce.number().positive().default(12)),
  SLOT_FIRST_HOUR: opt(z.coerce.number().int().min(0).max(23).default(6)),
  SLOT_LAST_HOUR: opt(z.coerce.number().int().min(0).max(23).default(23)),
  BACKFILL_DAYS: opt(z.coerce.number().int().positive().default(90)),
  BACKFILL_TOTAL: opt(z.coerce.number().int().positive().default(750)),
  RESEND_API_KEY: opt(z.string().min(1).optional()),
  ALERT_EMAIL: opt(z.string().min(1).optional()),
  DATA_DIR: opt(z.string().default("./data")),
}).superRefine((c, ctx) => {
  if (c.AI_BACKEND === "api" && !c.ANTHROPIC_API_KEY) {
    ctx.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "ANTHROPIC_API_KEY is required" });
  }
});

export type Config = z.infer<typeof ConfigSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

const SourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["rss", "listing"]),
  url: z.string().url(),
  tier: z.enum(["oficial", "portal", "outro"]),
  category: z.enum(["GAMES", "MERCADO", "ENTRETENIMENTO", "TECNOLOGIA"]),
  gamingFilter: z.boolean(),
  backfill: z.object({ kind: z.literal("sitemap"), url: z.string().url() }).optional(),
  listingSelector: z.string().optional(),
  /** Item links are Google News redirect URLs; the collector must resolve the publisher URL. */
  linkResolve: z.literal("google-news").optional(),
  /**
   * Engagement signal only (Reddit hot lists): its items count toward a story's sources and score,
   * never give text to the writer and never show in "Fontes".
   */
  signalOnly: z.boolean().optional(),
  /**
   * An official YouTube channel feed: only new trailers and gameplay videos are kept (`isTrailerVideo`),
   * their pages are never downloaded, and the video is embedded in the article.
   */
  video: z.boolean().optional(),
  /** Language of the source's titles; a story with videos in several languages embeds the `pt` one. */
  lang: z.enum(["pt", "en", "ja"]).optional(),
  active: z.boolean(),
})
  .refine((s) => s.linkResolve !== "google-news" || (URL.canParse(s.url) && new URL(s.url).hostname === "news.google.com"), {
    message: 'linkResolve "google-news" requires a news.google.com url',
    path: ["linkResolve"],
  })
  .refine((s) => !s.video || isYoutubeChannelFeed(s.url), {
    message: "video requires a https://www.youtube.com/feeds/videos.xml?channel_id=... url",
    path: ["video"],
  });

/** `https://www.youtube.com/feeds/videos.xml?channel_id=UC...` (a channel's Atom feed). */
export function isYoutubeChannelFeed(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const u = new URL(url);
  return (
    u.protocol === "https:" &&
    u.hostname === "www.youtube.com" &&
    u.pathname === "/feeds/videos.xml" &&
    /^UC[A-Za-z0-9_-]{22}$/.test(u.searchParams.get("channel_id") ?? "")
  );
}

export type Source = z.infer<typeof SourceSchema>;

export function loadSources(path = "config/fontes.json"): Source[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = z.array(SourceSchema).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid sources file ${path}: ${formatIssues(parsed.error)}`);
  }
  const seen = new Set<string>();
  for (const s of parsed.data) {
    if (seen.has(s.id)) throw new Error(`Invalid sources file ${path}: duplicate source id "${s.id}"`);
    seen.add(s.id);
  }
  return parsed.data;
}
