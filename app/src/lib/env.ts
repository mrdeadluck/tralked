import { z } from "zod";

// Empty strings (e.g. `STEAM_API_KEY=` in .env) are treated as "not set".
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const required = (schema: z.ZodString, devDefault: string) =>
  z.preprocess(blankToUndefined, schema.default(devDefault));

const optional = () =>
  z.preprocess(blankToUndefined, z.string().optional());

const schema = z.object({
  DATABASE_URL: required(
    z.string().min(1),
    "postgresql://gamelog:gamelog@localhost:5433/gamelog",
  ),
  // Dev-only constant: set a real random secret (>= 32 chars) in production.
  SESSION_SECRET: required(
    z.string().min(32),
    "dev-only-session-secret-change-me-in-production",
  ),
  APP_URL: required(z.string().url(), "http://localhost:3000"),
  CRON_SECRET: required(z.string().min(1), "dev-only-cron-secret"),
  STEAM_API_KEY: optional(),
  IGDB_CLIENT_ID: optional(),
  IGDB_CLIENT_SECRET: optional(),
  RAWG_API_KEY: optional(),
  SGDB_API_KEY: optional(),
  // PlayStation Network service account (its NPSSO cookie, exchanged server-side for tokens).
  PSN_NPSSO: optional(),
  // OpenXBL (xbl.io) API key of the Tralked service account.
  XBOX_OPENXBL_KEY: optional(),
  // RetroAchievements Web API: the service account's username and web API key.
  RA_USERNAME: optional(),
  RA_API_KEY: optional(),
  // Google OAuth client (login of readers). Both must be set, otherwise Google login is off.
  GOOGLE_CLIENT_ID: optional(),
  GOOGLE_CLIENT_SECRET: optional(),
});

export type Env = z.infer<typeof schema>;

const SECRETS_REQUIRED_IN_PRODUCTION = ["SESSION_SECRET", "CRON_SECRET"] as const;

// Dev defaults for secrets are publicly known, so a real deployment must never
// fall back to them. `next build` is exempt: it runs without runtime secrets.
function assertProductionSecrets(source: NodeJS.ProcessEnv) {
  if (source.NODE_ENV !== "production") return;
  if (source.NEXT_PHASE === "phase-production-build") return;

  const missing = SECRETS_REQUIRED_IN_PRODUCTION.filter(
    (name) => blankToUndefined(source[name]) === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s) in production: ${missing.join(", ")}`,
    );
  }
}

assertProductionSecrets(process.env);

export const env: Env = schema.parse(process.env);

export type OptionalKeyName =
  | "STEAM_API_KEY"
  | "IGDB_CLIENT_ID"
  | "RAWG_API_KEY"
  | "SGDB_API_KEY"
  | "PSN_NPSSO"
  | "XBOX_OPENXBL_KEY"
  | "RA_API_KEY"
  | "GOOGLE_CLIENT_ID";

export function hasKey(name: OptionalKeyName): boolean {
  return Boolean(env[name]);
}
