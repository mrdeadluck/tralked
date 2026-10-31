import { describe, expect, it, vi } from "vitest";
import { createXboxClient } from "./client";
import { createXboxFixture } from "./fixture";

const KEY = "openxbl-secret-key";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(handler: (url: URL) => Response) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input) => handler(new URL(String(input))),
  );
  const client = createXboxClient({ apiKey: KEY, fetch: fetchMock as unknown as typeof fetch });
  return { client, fetchMock };
}

describe("xbox client (OpenXBL)", () => {
  it("finds a profile by gamertag with its bio", async () => {
    const { client, fetchMock } = setup((url) => {
      if (url.pathname === "/api/v2/search/Lucas%20Exemplo") {
        return json({ people: [{ xuid: "999", gamertag: "Outro" }, { xuid: "123", gamertag: "Lucas Exemplo" }] });
      }
      if (url.pathname === "/api/v2/account/123") {
        return json({
          profileUsers: [
            {
              id: "123",
              settings: [
                { id: "Gamertag", value: "Lucas Exemplo" },
                { id: "Bio", value: "código TRK-XYZ789" },
                { id: "GameDisplayPicRaw", value: "https://images/pic.png" },
              ],
            },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(client.findProfile("Lucas Exemplo")).resolves.toEqual({
      xuid: "123",
      gamertag: "Lucas Exemplo",
      bio: "código TRK-XYZ789",
      avatarUrl: "https://images/pic.png",
    });
    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>)["X-Authorization"]).toBe(KEY);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("returns null when no player has the gamertag", async () => {
    const { client } = setup(() => json({ people: [{ xuid: "1", gamertag: "Parecido" }] }));
    await expect(client.findProfile("Ninguem")).resolves.toBeNull();
  });

  it("lists titles and achievements with gamerscore, unlock time and rarity", async () => {
    const { client } = setup((url) => {
      if (url.pathname === "/api/v2/achievements/player/123") {
        return json({
          titles: [
            {
              titleId: 1234,
              name: "Hollow Knight",
              achievement: { currentAchievements: 1, totalAchievements: 2, currentGamerscore: 10, totalGamerscore: 30, progressPercentage: 33 },
              titleHistory: { lastTimePlayed: "2026-03-01T10:00:00Z" },
            },
          ],
        });
      }
      return json({
        achievements: [
          {
            id: "1",
            name: "Primeiro",
            description: "Faça algo",
            progressState: "Achieved",
            progression: { timeUnlocked: "2026-02-01T12:00:00.123Z" },
            mediaAssets: [{ type: "Icon", url: "https://i/1.png" }],
            rewards: [{ type: "Gamerscore", value: "10" }],
            rarity: { currentPercentage: 4.5 },
          },
          {
            id: "2",
            name: "Segundo",
            lockedDescription: "Secreto",
            isSecret: true,
            progressState: "NotStarted",
            progression: { timeUnlocked: "0001-01-01T00:00:00.0000000Z" },
            rewards: [{ type: "Gamerscore", value: "20" }],
          },
        ],
      });
    });
    await expect(client.getTitles("123")).resolves.toEqual([
      {
        titleId: "1234",
        name: "Hollow Knight",
        currentAchievements: 1,
        totalAchievements: 2,
        currentGamerscore: 10,
        totalGamerscore: 30,
        progress: 33,
        lastPlayed: new Date("2026-03-01T10:00:00Z"),
      },
    ]);
    await expect(client.getAchievements("123", "1234")).resolves.toEqual([
      {
        id: "1",
        name: "Primeiro",
        description: "Faça algo",
        iconUrl: "https://i/1.png",
        hidden: false,
        gamerscore: 10,
        unlocked: true,
        unlockedAt: new Date("2026-02-01T12:00:00.123Z"),
        rarityPct: 4.5,
      },
      {
        id: "2",
        name: "Segundo",
        description: "Secreto",
        iconUrl: null,
        hidden: true,
        gamerscore: 20,
        unlocked: false,
        unlockedAt: null,
        rarityPct: null,
      },
    ]);
  });

  it("reports private data and keeps the key out of errors", async () => {
    const privateClient = setup(() => json({}, 403)).client;
    await expect(privateClient.getTitles("1")).resolves.toBe("private");
    await expect(privateClient.getAchievements("1", "2")).resolves.toBe("private");

    const failing = setup(() => json({}, 500)).client;
    const error = (await failing.getTitles("1").catch((e: Error) => e)) as Error;
    expect(error.message).toBe("Xbox titles failed with HTTP 500");
    expect(error.message).not.toContain(KEY);
  });
});

describe("xbox fixture", () => {
  const xbox = createXboxFixture();

  it("knows the seeded gamertag and its titles", async () => {
    const profile = await xbox.findProfile("lucas exemplo");
    expect(profile?.xuid).toBe("2535400000000001");
    const titles = await xbox.getTitles("2535400000000001");
    expect(titles).toHaveLength(2);
    const list = await xbox.getAchievements("2535400000000001", "90000003");
    expect((list as { unlocked: boolean }[]).filter((a) => a.unlocked)).toHaveLength(6);
  });

  it("returns null for unknown gamertags and private for the closed profile", async () => {
    await expect(xbox.findProfile("ninguem")).resolves.toBeNull();
    await expect(xbox.getTitles("2535400000000003")).resolves.toBe("private");
  });
});
