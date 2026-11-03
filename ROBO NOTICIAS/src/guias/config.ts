import { z } from "zod";
import { REFERENCE_STEAM_ID } from "./steam-aliases.js";

/** Treat empty strings (e.g. "KEY=" in .env) as unset. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);

const GuideConfigSchema = z.object({
  ANTHROPIC_API_KEY: opt(z.string({ error: "ANTHROPIC_API_KEY is required" }).min(1)),
  /** Site key with the `guides:write` and `media:write` scopes (never `publish`). */
  TRALKED_GUIDES_API_KEY: opt(z.string({ error: "TRALKED_GUIDES_API_KEY is required" }).min(1)),
  TRALKED_API_URL: opt(z.string().url().default("https://tralked.com")),
  MODEL_WRITER: opt(z.string().default("claude-opus-5-5")),
  MODEL_EXTRACT: opt(z.string().default("claude-sonnet-5-5")),
  MODEL_FAST: opt(z.string().default("claude-haiku-5-5")),
  /** Spending cap per guide request, in USD. */
  GUIDE_BUDGET_USD: opt(z.coerce.number().positive().default(25)),
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

export function loadGuideConfig(env: Record<string, string | undefined> = process.env): GuideConfig {
  const parsed = GuideConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
