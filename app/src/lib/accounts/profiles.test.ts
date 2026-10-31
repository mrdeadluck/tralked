import { beforeEach, describe, expect, it, vi } from "vitest";

const steam = vi.hoisted(() => ({
  mode: "api" as "api" | "community" | "fixture",
  profilePublic: true,
  owned: [] as { appId: number; playtimeMin: number }[] | "private" | "unsupported",
  ownedCalls: 0,
}));

vi.mock("@/lib/integrations/steam", () => ({ steamMode: () => steam.mode }));
vi.mock("@/lib/integrations/steam/profile-lookup", () => ({
  parseSteamProfileInput: (input: string) => ({ kind: "vanity", vanity: input }),
  getSteamProfileLookup: () => ({
    find: async () => ({ steamId: "76561198000077001", personaName: "Perfil", summary: "", profilePublic: steam.profilePublic }),
  }),
}));
vi.mock("@/lib/integrations", () => ({
  getSteam: () => ({
    getOwnedGames: async () => {
      steam.ownedCalls++;
      return steam.owned;
    },
  }),
  getPsn: () => ({}),
  getXbox: () => ({}),
  getRetro: () => ({}),
}));

const { lookupProfile } = await import("./profiles");

beforeEach(() => {
  steam.mode = "api";
  steam.profilePublic = true;
  steam.owned = [];
  steam.ownedCalls = 0;
});

describe("lookupProfile (Steam)", () => {
  it("with the Web API key, a public profile whose game details are private counts as private", async () => {
    steam.owned = "private";
    expect(await lookupProfile("steam", "perfil")).toMatchObject({ externalId: "76561198000077001", isPrivate: true });
    steam.owned = [{ appId: 1, playtimeMin: 10 }];
    expect(await lookupProfile("steam", "perfil")).toMatchObject({ isPrivate: false });
  });

  it("a private profile is private without asking for the games; keyless, game details cannot be checked", async () => {
    steam.profilePublic = false;
    expect(await lookupProfile("steam", "perfil")).toMatchObject({ isPrivate: true });
    expect(steam.ownedCalls).toBe(0);

    steam.profilePublic = true;
    steam.mode = "community";
    expect(await lookupProfile("steam", "perfil")).toMatchObject({ isPrivate: false });
    expect(steam.ownedCalls).toBe(0);
  });
});
