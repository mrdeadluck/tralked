import { readFileSync } from "node:fs";
import { z } from "zod";

/** Treat empty strings (e.g. "KEY=" in .env) as unset. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: opt(z.string({ error: "ANTHROPIC_API_KEY is required" }).min(1)),
  TRALKED_API_URL: opt(z.string().url().default("https://tralked.com")),
  TRALKED_API_KEY: opt(z.string({ error: "TRALKED_API_KEY is required" }).min(1)),
  MODEL_WRITER: opt(z.string().default("claude-opus-5-5")),
  MODEL_FAST: opt(z.string().default("claude-haiku-5-5")),
  DAILY_BUDGET_USD: opt(z.coerce.number().positive().default(5)),
  BACKFILL_BUDGET_USD: opt(z.coerce.number().positive().default(70)),
  MAX_PER_DAY: opt(z.coerce.number().int().positive().default(15)),
  SLOT_FIRST_HOUR: opt(z.coerce.number().int().min(0).max(23).default(6)),
  SLOT_LAST_HOUR: opt(z.coerce.number().int().min(0).max(23).default(23)),
  BACKFILL_DAYS: opt(z.coerce.number().int().positive().default(90)),
  BACKFILL_TOTAL: opt(z.coerce.number().int().positive().default(750)),
  RESEND_API_KEY: opt(z.string().min(1).optional()),
  ALERT_EMAIL: opt(z.string().min(1).optional()),
  DATA_DIR: opt(z.string().default("./data")),
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
  active: z.boolean(),
});

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
