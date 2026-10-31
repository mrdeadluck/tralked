import { afterEach, describe, expect, it, vi } from "vitest";

const keyState = vi.hoisted(() => ({ key: undefined as string | undefined }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (target, prop) => (prop === "STEAM_API_KEY" ? keyState.key : target[prop as keyof typeof target]),
    }),
    hasKey: (name: string) => name === "STEAM_API_KEY" && Boolean(keyState.key),
  };
});

const { getSteam, resetSteam, steamMode } = await import(".");

afterEach(() => {
  vi.unstubAllEnvs();
  keyState.key = undefined;
  resetSteam();
});

describe("steamMode / getSteam", () => {
  it("real key > public community pages", () => {
    vi.stubEnv("STEAM_MODE", "");
    expect(steamMode()).toBe("community");
    keyState.key = "steam-key";
    expect(steamMode()).toBe("api");
  });

  it("STEAM_MODE=fixture only replaces the community pages: a key still wins", () => {
    vi.stubEnv("STEAM_MODE", "fixture");
    expect(steamMode()).toBe("fixture");
    keyState.key = "steam-key";
    expect(steamMode()).toBe("api");
    keyState.key = undefined;
    vi.stubEnv("STEAM_MODE", "anything-else");
    expect(steamMode()).toBe("community");
  });

  it("the test suites run on the fixture (vitest sets STEAM_MODE=fixture)", async () => {
    expect(steamMode()).toBe("fixture");
    // The fixture lists owned games; the community adapter cannot.
    await expect(getSteam().getOwnedGames("76561198000000000")).resolves.toEqual(expect.any(Array));
  });

  it("the community adapter reports getOwnedGames as unsupported", async () => {
    vi.stubEnv("STEAM_MODE", "community");
    await expect(getSteam().getOwnedGames("76561198000000000")).resolves.toBe("unsupported");
  });
});
