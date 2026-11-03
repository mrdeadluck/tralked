import { z } from "zod";
import { EFFORTS } from "../ai/client.js";
import { REFERENCE_STEAM_ID } from "./steam-aliases.js";

/** Treat empty strings (e.g. "KEY=" in .env) as unset. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);

/** Task 22: the checker's defaults (the checker and the writer's default models use these too). */
export const DEFAULT_MODEL_CHECK = "claude-sonnet-5-5";
export const DEFAULT_CHECK_EFFORT = "high" as const;

const GuideConfigSchema = z.object({
  ANTHROPIC_API_KEY: opt(z.string({ error: "ANTHROPIC_API_KEY is required" }).min(1)),
  /** Site key with the `guides:write` and `media:write` scopes (never `publish`). */
  TRALKED_GUIDES_API_KEY: opt(z.string({ error: "TRALKED_GUIDES_API_KEY is required" }).min(1)),
  TRALKED_API_URL: opt(z.string().url().default("https://tralked.com")),
  MODEL_WRITER: opt(z.string().default("claude-opus-5-5")),
  MODEL_EXTRACT: opt(z.string().default("claude-sonnet-5-5")),
  MODEL_FAST: opt(z.string().default("claude-haiku-5-5")),
  /** Task 22: the guide's fact-checker (the probe showed Haiku calling "defeito" what it described as right). */
  MODEL_CHECK: opt(z.string().default(DEFAULT_MODEL_CHECK)),
  /** The checker's effort: high by default; xhigh and max are valid too (more thinking, more output, streamed). */
  CHECK_EFFORT: opt(z.enum(EFFORTS).default(DEFAULT_CHECK_EFFORT)),
  /** Spending cap per guide request, in USD. */
  GUIDE_BUDGET_USD: opt(z.coerce.number().positive().default(25)),
  /**
   * Minutes after which a request stops adding images and the soundtrack and sends the guide it has (the run lock
   * goes stale at 180 min).
   */
  GUIDE_SOFT_DEADLINE_MIN: opt(z.coerce.number().positive().default(150)),
  /** "1": search the web for sources again even when a discovery of the last 7 days could be reused. */
  GUIDE_FORCE_DISCOVERY: opt(
    z
      .enum(["0", "1", "true", "false"])
      .default("0")
      .transform((v) => v === "1" || v === "true"),
  ),
  DATA_DIR_GUIAS: opt(z.string().default("./data-guias")),
  /** Public Steam profile whose achievement pages give the achievements' names in other languages (it must own the game). */
  GUIDE_STEAM_REFERENCE_ID: opt(
    z
      .string()
      .regex(/^7656\d{13}$/, "GUIDE_STEAM_REFERENCE_ID must be a SteamID64")
      .default(REFERENCE_STEAM_ID),
  ),
  RESEND_API_KEY: opt(z.string().min(1).optional()),
  ALERT_EMAIL: opt(z.string().min(1).optional()),
});

export type GuideConfig = z.infer<typeof GuideConfigSchema>;

function parse<T extends z.ZodType>(schema: T, env: Record<string, string | undefined>): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

export function loadGuideConfig(env: Record<string, string | undefined> = process.env): GuideConfig {
  return parse(GuideConfigSchema, env);
}

const DryRunConfigSchema = GuideConfigSchema.omit({ ANTHROPIC_API_KEY: true, TRALKED_GUIDES_API_KEY: true });
export type DryRunConfig = z.infer<typeof DryRunConfigSchema>;

/** The dry run (`--ensaio`) calls no AI and no site: it needs no keys. */
export function loadDryRunConfig(env: Record<string, string | undefined> = process.env): DryRunConfig {
  return parse(DryRunConfigSchema, env);
}
