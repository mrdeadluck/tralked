import { afterEach, describe, expect, it, vi } from "vitest";

// Which service-account credentials are "set" (the real env is never read).
const keys = vi.hoisted(() => ({ values: {} as Record<string, string | undefined> }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (target, prop) => (typeof prop === "string" && prop in keys.values ? keys.values[prop] : target[prop as keyof typeof target]),
    }),
    hasKey: (name: string) => Boolean(keys.values[name]),
  };
});

const { getPsn, getRetro, getXbox, resetIntegrations } = await import(".");
const { fixturesAllowed, platformAvailable, PlatformNotConfiguredError } = await import("./availability");
const { PSN_FIXTURE_ACCOUNTS } = await import("./psn/fixture");

const NO_KEYS = { PSN_NPSSO: undefined, XBOX_OPENXBL_KEY: undefined, RA_API_KEY: undefined, RA_USERNAME: undefined };

afterEach(() => {
  vi.unstubAllEnvs();
  keys.values = {};
  resetIntegrations();
});

describe("PSN / Xbox / RetroAchievements clients without a credential", () => {
  it("use the offline fixtures outside production (development, tests)", async () => {
    keys.values = { ...NO_KEYS };
    vi.stubEnv("NODE_ENV", "development");
    expect(fixturesAllowed()).toBe(true);
    for (const platform of ["psn", "xbox", "retro"] as const) expect(platformAvailable(platform)).toBe(true);
    await expect(getPsn().findProfile(PSN_FIXTURE_ACCOUNTS[0].onlineId)).resolves.toMatchObject({
      accountId: PSN_FIXTURE_ACCOUNTS[0].accountId,
    });
    expect(getXbox()).toBeDefined();
    expect(getRetro()).toBeDefined();
  });

  it("never fall back to a fixture in production: the platform is unavailable and the factory throws", () => {
    keys.values = { ...NO_KEYS };
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_FIXTURES", "");
    expect(fixturesAllowed()).toBe(false);
    for (const platform of ["psn", "xbox", "retro"] as const) expect(platformAvailable(platform)).toBe(false);
    expect(() => getPsn()).toThrow(PlatformNotConfiguredError);
    expect(() => getXbox()).toThrow(PlatformNotConfiguredError);
    expect(() => getRetro()).toThrow(PlatformNotConfiguredError);
  });

  it("a fixture memoized outside production is not reused once the process runs as production", () => {
    keys.values = { ...NO_KEYS };
    vi.stubEnv("NODE_ENV", "development");
    getPsn();
    resetIntegrations();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getPsn()).toThrow(PlatformNotConfiguredError);
  });

  it("production uses fixtures only in the explicit test mode (PLATFORM_FIXTURES=1)", () => {
    keys.values = { ...NO_KEYS };
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_FIXTURES", "1");
    expect(platformAvailable("psn")).toBe(true);
    expect(() => getPsn()).not.toThrow();
    vi.stubEnv("PLATFORM_FIXTURES", "true");
    resetIntegrations();
    expect(() => getPsn()).toThrow(PlatformNotConfiguredError);
  });

  it("with a credential, production uses the real client and only that platform is available", () => {
    keys.values = { ...NO_KEYS, PSN_NPSSO: "npsso-of-the-service-account" };
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_FIXTURES", "");
    expect(platformAvailable("psn")).toBe(true);
    expect(platformAvailable("xbox")).toBe(false);
    expect(platformAvailable("retro")).toBe(false);
    expect(() => getPsn()).not.toThrow();
    expect(() => getXbox()).toThrow(PlatformNotConfiguredError);
  });
});
