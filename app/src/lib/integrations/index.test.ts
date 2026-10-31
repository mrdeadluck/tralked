import { beforeEach, describe, expect, it, vi } from "vitest";

// Real clients (not fixtures): every key is set.
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  const env = {
    ...actual.env,
    STEAM_API_KEY: "steam-key",
    IGDB_CLIENT_ID: "igdb-id",
    IGDB_CLIENT_SECRET: "igdb-secret",
    RAWG_API_KEY: "rawg-key",
    SGDB_API_KEY: "sgdb-key",
  };
  return { ...actual, env, hasKey: () => true };
});

const { getIgdb, getRawg, getSgdb, getSteam, resetIntegrations } = await import(".");

beforeEach(() => resetIntegrations());

describe("integration getters", () => {
  it("return one memoized instance per process, so the IGDB token cache and limiter are shared", () => {
    expect(getIgdb()).toBe(getIgdb());
    expect(getSteam()).toBe(getSteam());
    expect(getRawg()).toBe(getRawg());
    expect(getSgdb()).toBe(getSgdb());
  });

  it("resetIntegrations drops the memoized instances (tests)", () => {
    const first = getIgdb();
    resetIntegrations();
    expect(getIgdb()).not.toBe(first);
  });
});
