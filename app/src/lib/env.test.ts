import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadEnvModule() {
  vi.resetModules();
  return import("./env");
}

describe("env", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hasKey returns false when the variable is empty", async () => {
    vi.stubEnv("STEAM_API_KEY", "");
    const { hasKey, env } = await loadEnvModule();
    expect(hasKey("STEAM_API_KEY")).toBe(false);
    expect(env.STEAM_API_KEY).toBeUndefined();
  });

  it("hasKey returns false when the variable is absent", async () => {
    vi.stubEnv("STEAM_API_KEY", undefined);
    const { hasKey } = await loadEnvModule();
    expect(hasKey("STEAM_API_KEY")).toBe(false);
  });

  it("hasKey returns true when the variable is defined", async () => {
    vi.stubEnv("STEAM_API_KEY", "abc123");
    const { hasKey, env } = await loadEnvModule();
    expect(hasKey("STEAM_API_KEY")).toBe(true);
    expect(env.STEAM_API_KEY).toBe("abc123");
  });

  it("falls back to dev defaults for required variables", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SESSION_SECRET", undefined);
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("CRON_SECRET", "");
    const { env } = await loadEnvModule();
    expect(env.DATABASE_URL).toBe(
      "postgresql://gamelog:gamelog@localhost:5433/gamelog",
    );
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.CRON_SECRET).not.toBe("");
  });

  describe("production secrets", () => {
    const strongSecret = "x".repeat(40);

    it("throws at runtime in production when a secret is missing", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PHASE", undefined);
      vi.stubEnv("SESSION_SECRET", "");
      vi.stubEnv("CRON_SECRET", strongSecret);
      await expect(loadEnvModule()).rejects.toThrow(/SESSION_SECRET/);

      vi.stubEnv("SESSION_SECRET", strongSecret);
      vi.stubEnv("CRON_SECRET", undefined);
      await expect(loadEnvModule()).rejects.toThrow(/CRON_SECRET/);
    });

    it("does not throw during the production build phase", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PHASE", "phase-production-build");
      vi.stubEnv("SESSION_SECRET", "");
      vi.stubEnv("CRON_SECRET", "");
      const { env } = await loadEnvModule();
      expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it("accepts provided secrets in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PHASE", undefined);
      vi.stubEnv("SESSION_SECRET", strongSecret);
      vi.stubEnv("CRON_SECRET", "cron-secret");
      const { env } = await loadEnvModule();
      expect(env.SESSION_SECRET).toBe(strongSecret);
      expect(env.CRON_SECRET).toBe("cron-secret");
    });

    it("uses the dev defaults outside production", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("SESSION_SECRET", "");
      vi.stubEnv("CRON_SECRET", "");
      const { env } = await loadEnvModule();
      expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
      expect(env.CRON_SECRET).not.toBe("");
    });
  });
});
