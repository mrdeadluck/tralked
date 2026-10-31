import { describe, expect, it, vi } from "vitest";
import { createPsnClient, PsnAuthError } from "./client";
import { createPsnFixture } from "./fixture";

const NPSSO = "npsso-secret-value-0123456789";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const tokenBody = (access: string) => ({
  access_token: access,
  expires_in: 3600,
  refresh_token: `refresh-${access}`,
  refresh_token_expires_in: 5_184_000,
});

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function setup(api: Handler, opts: { authorize?: Handler; token?: Handler } = {}) {
  let clock = 0;
  let issued = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/authorize")) {
      return opts.authorize
        ? opts.authorize(url, init)
        : new Response(null, {
            status: 302,
            headers: { location: "com.scee.psxandroid.scecompcall://redirect/?code=v3.CODE&cid=x" },
          });
    }
    if (url.pathname.endsWith("/oauth/token")) {
      return opts.token ? opts.token(url, init) : json(tokenBody(`T${++issued}`));
    }
    return api(url, init);
  });
  const client = createPsnClient({
    npsso: NPSSO,
    fetch: fetchMock as unknown as typeof fetch,
    now: () => clock,
  });
  return { client, fetchMock, advance: (ms: number) => (clock += ms) };
}

const profileBody = {
  profile: {
    accountId: "123",
    onlineId: "Lucas-Exemplo",
    aboutMe: "oi TRK-ABC123",
    avatarUrls: [
      { size: "s", avatarUrl: "https://img/s.png" },
      { size: "l", avatarUrl: "https://img/l.png" },
    ],
  },
};

describe("psn client", () => {
  it("exchanges the NPSSO for tokens and finds a profile by online id", async () => {
    const { client, fetchMock } = setup((url) => {
      if (url.hostname === "us-prof.np.community.playstation.net") return json(profileBody);
      if (url.pathname.endsWith("/trophyTitles")) return json({ trophyTitles: [] });
      throw new Error(`unexpected ${url}`);
    });

    await expect(client.findProfile("Lucas-Exemplo")).resolves.toEqual({
      accountId: "123",
      onlineId: "Lucas-Exemplo",
      aboutMe: "oi TRK-ABC123",
      avatarUrl: "https://img/l.png",
      isPrivate: false,
    });

    const [authorize, token, profile] = fetchMock.mock.calls;
    const authorizeUrl = new URL(String(authorize[0]));
    expect(authorizeUrl.searchParams.get("client_id")).toBe("09515159-7237-4370-9b40-3806e67c0891");
    expect(authorizeUrl.searchParams.get("scope")).toBe("psn:mobile.v2.core psn:clientapp");
    expect((authorize[1]?.headers as Record<string, string>).Cookie).toBe(`npsso=${NPSSO}`);
    expect(authorize[1]?.redirect).toBe("manual");

    const form = new URLSearchParams(String(token[1]?.body));
    expect(form.get("code")).toBe("v3.CODE");
    expect(form.get("grant_type")).toBe("authorization_code");

    const profileUrl = new URL(String(profile[0]));
    expect(profileUrl.pathname).toBe("/userProfile/v1/users/Lucas-Exemplo/profile2");
    expect((profile[1]?.headers as Record<string, string>).Authorization).toBe("Bearer T1");
    for (const [, init] of fetchMock.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null for an unknown online id and flags a private trophy list", async () => {
    const { client } = setup((url) => {
      if (url.pathname.includes("/Ninguem/")) return json({ error: {} }, 404);
      if (url.hostname === "us-prof.np.community.playstation.net") return json(profileBody);
      return json({ error: { code: 2240526 } }, 403);
    });
    await expect(client.findProfile("Ninguem")).resolves.toBeNull();
    await expect(client.findProfile("Lucas-Exemplo")).resolves.toMatchObject({ isPrivate: true });
    await expect(client.getTitles("123")).resolves.toBe("private");
  });

  it("pages through trophy titles", async () => {
    const title = (id: string) => ({
      npCommunicationId: id,
      npServiceName: "trophy",
      trophyTitleName: `Game ${id}`,
      trophyTitlePlatform: "PS4",
      progress: 50,
      definedTrophies: { bronze: 2, silver: 1, gold: 1, platinum: 1 },
      earnedTrophies: { bronze: 1 },
      lastUpdatedDateTime: "2026-01-02T03:04:05Z",
    });
    const { client, fetchMock } = setup((url) => {
      const offset = url.searchParams.get("offset");
      return offset === "0"
        ? json({ trophyTitles: [title("A")], nextOffset: 1 })
        : json({ trophyTitles: [{ ...title("B"), npServiceName: "trophy2" }] });
    });
    const titles = await client.getTitles("123");
    expect(titles).toEqual([
      {
        npTitleId: "A",
        serviceName: "trophy",
        name: "Game A",
        platform: "PS4",
        progress: 50,
        trophyCounts: { bronze: 2, silver: 1, gold: 1, platinum: 1 },
        earnedCounts: { bronze: 1, silver: 0, gold: 0, platinum: 0 },
        lastPlayed: new Date("2026-01-02T03:04:05Z"),
      },
      expect.objectContaining({ npTitleId: "B", serviceName: "trophy2" }),
    ]);
    const apiCalls = fetchMock.mock.calls.map((c) => new URL(String(c[0])));
    expect(apiCalls[2].pathname).toBe("/api/trophy/v1/users/123/trophyTitles");
    expect(apiCalls[2].searchParams.get("limit")).toBe("800");
  });

  it("merges trophy definitions with the user's earned trophies", async () => {
    const { client, fetchMock } = setup((url) => {
      if (url.pathname.includes("/users/")) {
        return json({
          trophies: [
            { trophyId: 0, earned: true, earnedDateTime: "2026-05-01T10:00:00Z", trophyEarnedRate: "1.5" },
            { trophyId: 1, earned: false, trophyEarnedRate: "40.2" },
          ],
        });
      }
      return json({
        trophies: [
          { trophyId: 0, trophyType: "platinum", trophyName: "Platina", trophyDetail: "Tudo", trophyIconUrl: "https://i/0.png" },
          { trophyId: 1, trophyType: "bronze", trophyName: "Início", trophyHidden: true },
        ],
      });
    });
    await expect(client.getTrophies("123", "NPWR1_00", "trophy")).resolves.toEqual([
      {
        trophyId: "0",
        name: "Platina",
        description: "Tudo",
        iconUrl: "https://i/0.png",
        hidden: false,
        tier: "platinum",
        earned: true,
        earnedAt: new Date("2026-05-01T10:00:00Z"),
        rarityPct: 1.5,
      },
      {
        trophyId: "1",
        name: "Início",
        description: null,
        iconUrl: null,
        hidden: true,
        tier: "bronze",
        earned: false,
        earnedAt: null,
        rarityPct: 40.2,
      },
    ]);
    const urls = fetchMock.mock.calls.slice(2).map((c) => new URL(String(c[0])));
    expect(urls[0].pathname).toBe("/api/trophy/v1/npCommunicationIds/NPWR1_00/trophyGroups/all/trophies");
    expect(urls[0].searchParams.get("npServiceName")).toBe("trophy");
    expect(urls[1].pathname).toBe(
      "/api/trophy/v1/users/123/npCommunicationIds/NPWR1_00/trophyGroups/all/trophies",
    );
  });

  it("caches the access token, then uses the refresh token once it expires", async () => {
    const { client, fetchMock, advance } = setup(() => json({ trophyTitles: [] }));
    await client.getTitles("1");
    await client.getTitles("1");
    const authCalls = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("ca.account.sony.com"));
    expect(authCalls()).toHaveLength(2); // authorize + token
    advance(3600 * 1000);
    await client.getTitles("1");
    expect(authCalls()).toHaveLength(3);
    const refresh = new URLSearchParams(String(authCalls()[2][1]?.body));
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("refresh_token")).toBe("refresh-T1");
  });

  it("never puts the NPSSO or tokens in error messages", async () => {
    const badNpsso = setup(() => json({}), {
      authorize: () => new Response(null, { status: 302, headers: { location: "https://x/?error=login_required" } }),
    });
    const authError = await badNpsso.client.getTitles("1").catch((e: Error) => e);
    expect(authError).toBeInstanceOf(PsnAuthError);
    expect(String((authError as Error).message)).not.toContain(NPSSO);

    const serverError = setup(() => json({}, 500));
    const apiError = await serverError.client.getTitles("1").catch((e: Error) => e);
    expect((apiError as Error).message).toBe("PSN trophy titles failed with HTTP 500");
    expect((apiError as Error).message).not.toContain("T1");
  });
});

describe("psn fixture", () => {
  const psn = createPsnFixture();

  it("knows the seeded account and its titles", async () => {
    const profile = await psn.findProfile("lucas-exemplo");
    expect(profile).toMatchObject({ accountId: "9000000000000000001", isPrivate: false });
    const titles = await psn.getTitles("9000000000000000001");
    expect(titles).not.toBe("private");
    const hk = (titles as Exclude<typeof titles, "private">).find((t) => t.npTitleId === "NPWR90001_00");
    expect(hk?.progress).toBe(100);
    const trophies = await psn.getTrophies("9000000000000000001", "NPWR90001_00", "trophy");
    expect(trophies).toHaveLength(8);
    expect((trophies as { earned: boolean }[]).every((t) => t.earned)).toBe(true);
  });

  it("returns null for unknown ids and private for the closed profile", async () => {
    await expect(psn.findProfile("ninguem")).resolves.toBeNull();
    await expect(psn.getTitles("9000000000000000003")).resolves.toBe("private");
  });
});
