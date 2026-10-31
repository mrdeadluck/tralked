import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Shared Playwright setup for the two e2e modes.
 *
 * - "prod": `pnpm build && pnpm start` on port 3200. Same code path as a deploy, so it is the
 *   truth for public pages. Demo login (`/api/auth/demo`) is disabled in production by design,
 *   so routes flagged `auth` are skipped.
 * - "dev": `next dev` on port 3200. Demo login works (NODE_ENV !== "production"), so the
 *   logged-in routes run too. Production security is untouched.
 *
 * The server always points at its own database (E2E_DATABASE_URL), never at the dev server's `gamelog`.
 */
export type E2EMode = "prod" | "dev";

// E2E_PORT lets parallel worktrees run their own server without fighting over 3200.
export const PORT = Number(process.env.E2E_PORT ?? 3200);
export const BASE_URL = `http://localhost:${PORT}`;

const DEFAULT_DATABASE_URL = "postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e";

/** Signs the e2e server's session cookies (flow tests sign their own to act as any seeded user). */
export const E2E_SESSION_SECRET = "e2e-session-secret-with-at-least-32-chars";

/**
 * Where the e2e server also writes its e-mails as JSON lines `{ kind, to, subject, link }`
 * (DEV_MAIL_LOG_FILE, honored only outside production), so the flows can follow the links.
 */
export const MAIL_LOG_FILE = path.join(os.tmpdir(), `tralked-e2e-mail-${PORT}.log`);

/** The development servers' databases: e2e writes (comments, keys, intros), so never these. */
const FORBIDDEN_DATABASES = new Set(["gamelog", "gamelog_dev"]);

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    // Reported below.
  }
  if (!name || FORBIDDEN_DATABASES.has(name)) {
    throw new Error(
      `E2E_DATABASE_URL must name a dedicated test database (got "${name || url}"). ` +
        "gamelog and gamelog_dev belong to the development servers.",
    );
  }
  return url;
}

export function createConfig(mode: E2EMode) {
  // Workers re-import the config, so helpers can read the mode from the environment.
  process.env.E2E_MODE = mode;

  return defineConfig({
    testDir: "./e2e",
    outputDir: "./e2e/__results__",
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    timeout: mode === "dev" ? 120_000 : 60_000,
    expect: { timeout: 10_000 },
    reporter: [["list"]],
    use: {
      baseURL: BASE_URL,
      trace: "retain-on-failure",
      // The cookie banner already has its choice, so it never covers what a test clicks or
      // screenshots. e2e/system.spec.ts opens a fresh context to test the banner itself.
      storageState: {
        cookies: [
          { name: "tk_consent", value: "necessary", domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
        ],
        origins: [],
      },
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
      command: mode === "prod" ? `pnpm build && pnpm start -p ${PORT}` : `pnpm dev -p ${PORT}`,
      url: BASE_URL,
      // Never reuse: a stray server could be wired to another database.
      reuseExistingServer: false,
      timeout: 600_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        DATABASE_URL: e2eDatabaseUrl(),
        SESSION_SECRET: E2E_SESSION_SECRET,
        CRON_SECRET: "e2e-cron-secret",
        APP_URL: BASE_URL,
        // Blank keys keep every integration on its local fixtures (and demo login enabled in dev).
        STEAM_API_KEY: "",
        // Without a key Steam would use its public community pages; e2e stays offline.
        STEAM_MODE: "fixture",
        IGDB_CLIENT_ID: "",
        IGDB_CLIENT_SECRET: "",
        RAWG_API_KEY: "",
        SGDB_API_KEY: "",
        // No real e-mail: the dev server logs them (and writes them to MAIL_LOG_FILE); the
        // production build has e-mail off, as a deploy without the key would.
        RESEND_API_KEY: "",
        DEV_MAIL_LOG_FILE: MAIL_LOG_FILE,
      },
    },
  });
}
