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
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);

export type OptionalKeyName =
  | "STEAM_API_KEY"
  | "IGDB_CLIENT_ID"
  | "RAWG_API_KEY"
  | "SGDB_API_KEY";

export function hasKey(name: OptionalKeyName): boolean {
  return Boolean(env[name]);
}
