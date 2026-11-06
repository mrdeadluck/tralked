import { describe, expect, it, vi } from "vitest";
import { createPsnClient, parsePlayDuration, PsnAuthError, PsnHttpError } from "./client";
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

  it("reads ISO 8601 play durations as whole minutes", () => {
    expect(parsePlayDuration("PT228H56M33S")).toBe(228 * 60 + 56);
    expect(parsePlayDuration("P1DT2H")).toBe(26 * 60);
    expect(parsePlayDuration("PT59S")).toBe(0);
    expect(parsePlayDuration("PT45M")).toBe(45);
    expect(parsePlayDuration("PT1.5S")).toBe(0);
    expect(parsePlayDuration("")).toBeNull();
    expect(parsePlayDuration("PT")).toBeNull();
    expect(parsePlayDuration("1 hour")).toBeNull();
    expect(parsePlayDuration(undefined)).toBeNull();
  });

  it("pages through the played games (gamelist v2) with their play time", async () => {
    const played = (id: string, duration: string) => ({
      titleId: id,
      name: `Game ${id}`,
      localizedName: `Jogo ${id}`,
      category: "ps5_native_game",
      playDuration: duration,
      firstPlayedDateTime: "2025-01-01T10:00:00Z",
      lastPlayedDateTime: "2026-02-03T04:05:06.12Z",
    });
    const concept = { id: 201930, titleIds: ["CUSA00419_00", "PPSA1", 7], name: "Grand Theft Auto V" };
    const { client, fetchMock } = setup((url) => {
      expect(url.pathname).toBe("/api/gamelist/v2/users/123/titles");
      return url.searchParams.get("offset") === "0"
        ? json({
            titles: [{ ...played("PPSA1", "PT10H5M"), concept }, { titleId: "X", playDuration: "PT1H" }],
            nextOffset: 2,
            totalItemCount: 3,
          })
        : json({ titles: [played("CUSA2", "PT0S")], totalItemCount: 3 });
    });
    await expect(client.getPlayedGames("123")).resolves.toEqual([
      {
        titleId: "PPSA1",
        name: "Jogo PPSA1",
        category: "ps5_native_game",
        playtimeMin: 605,
        firstPlayedAt: new Date("2025-01-01T10:00:00Z"),
        lastPlayedAt: new Date("2026-02-03T04:05:06.12Z"),
        conceptId: 201930,
        conceptTitleIds: ["CUSA00419_00", "PPSA1"],
        conceptName: "Grand Theft Auto V",
      },
      expect.objectContaining({ titleId: "CUSA2", playtimeMin: 0, conceptId: null, conceptTitleIds: [], conceptName: null }),
    ]);
    const calls = fetchMock.mock.calls.map((c) => new URL(String(c[0]))).filter((u) => u.pathname.includes("gamelist"));
    expect(calls.map((u) => u.searchParams.get("offset"))).toEqual(["0", "2"]);
    expect(calls[0].searchParams.get("categories")).toBe("ps4_game,ps5_native_game");
  });

  it("reports a hidden gaming history as private", async () => {
    const { client } = setup(() => json({ error: {} }, 403));
    await expect(client.getPlayedGames("123")).resolves.toBe("private");
  });

  const listsOf = (ids: string[]) => ({
    titles: ids.map((id) => ({
      npTitleId: id,
      trophyTitles: [{ npCommunicationId: `NPWR_${id}`, trophyTitleName: `Jogo ${id}`, trophyTitlePlatform: null }],
    })),
  });

  it("maps title ids in batches of five", async () => {
    const { client, fetchMock } = setup((url) => {
      expect(url.pathname).toBe("/api/trophy/v1/users/123/titles/trophyTitles");
      const ids = url.searchParams.get("npTitleIds")!.split(",");
      // PSN answers 400 past five ids; an id it lists with no trophy list comes back empty.
      if (ids.length > 5) return json({ error: { code: 2240513 } }, 400);
      return json({ titles: [...listsOf(ids.filter((id) => id !== "CUSA3")).titles, { npTitleId: "CUSA3", trophyTitles: [] }] });
    });
    const ids = ["CUSA1", "CUSA2", "CUSA3", "CUSA4", "CUSA5", "PPSA6", "PPSA7", "CUSA1"];
    const lists = await client.getTrophyListsOfTitles("123", ids);
    expect(lists).toEqual(
      new Map([
        ["CUSA1", ["NPWR_CUSA1"]],
        ["CUSA2", ["NPWR_CUSA2"]],
        ["CUSA3", []],
        ["CUSA4", ["NPWR_CUSA4"]],
        ["CUSA5", ["NPWR_CUSA5"]],
        ["PPSA6", ["NPWR_PPSA6"]],
        ["PPSA7", ["NPWR_PPSA7"]],
      ]),
    );
    const asked = fetchMock.mock.calls
      .map((c) => new URL(String(c[0])))
      .filter((u) => u.pathname.endsWith("/titles/trophyTitles"))
      .map((u) => u.searchParams.get("npTitleIds"));
    expect(asked).toEqual(["CUSA1,CUSA2,CUSA3,CUSA4,CUSA5", "PPSA6,PPSA7"]);
  });

  it("retries one by one when a batch answers 404", async () => {
    const { client, fetchMock } = setup((url) => {
      const ids = url.searchParams.get("npTitleIds")!.split(",");
      // One id PSN does not know (for this player) fails the whole batch.
      if (ids.includes("CUSA29862_00")) {
        return json({ error: { code: 2240525, message: "Resource not found (npTitleId='CUSA29862_00')" } }, 404);
      }
      return json(listsOf(ids));
    });
    const lists = await client.getTrophyListsOfTitles("123", ["PPSA1", "CUSA29862_00", "CUSA2"]);
    expect(lists).toEqual(
      new Map([
        ["PPSA1", ["NPWR_PPSA1"]],
        ["CUSA29862_00", []],
        ["CUSA2", ["NPWR_CUSA2"]],
      ]),
    );
    const asked = fetchMock.mock.calls
      .map((c) => new URL(String(c[0])))
      .filter((u) => u.pathname.endsWith("/titles/trophyTitles"))
      .map((u) => u.searchParams.get("npTitleIds"));
    expect(asked).toEqual(["PPSA1,CUSA29862_00,CUSA2", "PPSA1", "CUSA29862_00", "CUSA2"]);

    const hidden = setup(() => json({ error: {} }, 403));
    await expect(hidden.client.getTrophyListsOfTitles("123", ["PPSA1"])).resolves.toBe("private");
  });

  const askedBatches = (fetchMock: { mock: { calls: unknown[][] } }) =>
    fetchMock.mock.calls
      .map((c) => new URL(String(c[0])))
      .filter((u) => u.pathname.endsWith("/titles/trophyTitles"))
      .map((u) => u.searchParams.get("npTitleIds"));

  it("starts no batch past the deadline: the ids not asked are left out", async () => {
    let advance = (ms: number) => ms;
    const run = setup((url) => {
      advance(1000); // each answer takes a second
      return json(listsOf(url.searchParams.get("npTitleIds")!.split(",")));
    });
    advance = run.advance;
    const ids = ["A1", "A2", "A3", "A4", "A5", "B1", "B2"];
    const lists = await run.client.getTrophyListsOfTitles("123", ids, { deadline: 500 });
    expect([...(lists as Map<string, string[]>).keys()]).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expect(askedBatches(run.fetchMock)).toEqual(["A1,A2,A3,A4,A5"]);

    // The one-by-one retries of a 404 batch stop at the deadline too.
    const retry = setup((url) => {
      advance(1000);
      const asked = url.searchParams.get("npTitleIds")!.split(",");
      return asked.length > 1 ? json({ error: {} }, 404) : json(listsOf(asked));
    });
    advance = retry.advance;
    const partial = await retry.client.getTrophyListsOfTitles("123", ["C1", "C2", "C3"], { deadline: 1500 });
    expect([...(partial as Map<string, string[]>).keys()]).toEqual(["C1"]);
  });

  it("a failing batch is skipped; the batches answered are kept", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { client } = setup((url) => {
        const ids = url.searchParams.get("npTitleIds")!.split(",");
        return ids.includes("B1") ? json({}, 500) : json(listsOf(ids));
      });
      const ids = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5", "C1"];
      const lists = await client.getTrophyListsOfTitles("123", ids);
      expect([...(lists as Map<string, string[]>).keys()]).toEqual(["A1", "A2", "A3", "A4", "A5", "C1"]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("an answer only counts for the ids of its own batch", async () => {
    const { client } = setup((url) => {
      const ids = url.searchParams.get("npTitleIds")!.split(",");
      // The second batch's answer also names an id of the first one.
      const extra = ids.includes("B1") ? [{ npTitleId: "A1", trophyTitles: [{ npCommunicationId: "NPWR_OTHER" }] }] : [];
      return json({ titles: [...listsOf(ids).titles, ...extra] });
    });
    const lists = await client.getTrophyListsOfTitles("123", ["A1", "A2", "A3", "A4", "A5", "B1"]);
    expect((lists as Map<string, string[]>).get("A1")).toEqual(["NPWR_A1"]);
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
    // Sony's reason is kept, so an expired NPSSO is told apart from other refusals.
    expect((authError as Error).message).toBe("PSN authentication failed at authorize (HTTP 302): login_required");
    expect(String((authError as Error).message)).not.toContain(NPSSO);

    const serverError = setup(() => json({}, 500));
    const apiError = await serverError.client.getTitles("1").catch((e: Error) => e);
    expect((apiError as Error).message).toBe("PSN trophy titles failed with HTTP 500");
    expect((apiError as Error).message).not.toContain("T1");
  });
});

describe("psn catalog list info", () => {
  it("reads name, platform and counts of any list, on the asked service", async () => {
    const { client, fetchMock } = setup((url) => {
      if (url.pathname.endsWith("/npCommunicationIds/NPWR10000_00/trophyGroups") && url.searchParams.get("npServiceName") === "trophy") {
        return json({ trophyTitleName: "Fairune", trophyTitlePlatform: "PSVITA", definedTrophies: { bronze: 10, silver: 2, gold: 1, platinum: 1 } });
      }
      if (url.pathname.endsWith("/trophyGroups")) return json({ error: { message: "not found" } }, 404);
      throw new Error(`unexpected ${url}`);
    });
    await expect(client.getListInfo("NPWR10000_00", "trophy")).resolves.toEqual({
      npTitleId: "NPWR10000_00",
      serviceName: "trophy",
      name: "Fairune",
      platform: "PSVITA",
      trophyCounts: { bronze: 10, silver: 2, gold: 1, platinum: 1 },
    });
    await expect(client.getListInfo("NPWR10000_00", "trophy2")).resolves.toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("npServiceName"))).toBe(true);
  });

  it("getListTrophies reads a list's definitions without a player, and says null when Sony has none", async () => {
    const { client, fetchMock } = setup((url) => {
      if (url.pathname.includes("/users/")) throw new Error("no player involved");
      if (url.pathname.includes("NPWR10000_00") && url.pathname.endsWith("/trophyGroups/all/trophies")) {
        return json({
          trophies: [
            { trophyId: 0, trophyType: "platinum", trophyName: "Tudo", trophyDetail: "Ganhe todos", trophyIconUrl: "https://i/NPWR10000_00.png", trophyHidden: false },
            { trophyId: 1, trophyType: "bronze", trophyHidden: true },
          ],
        });
      }
      return json({}, 404);
    });
    await expect(client.getListTrophies("NPWR10000_00", "trophy")).resolves.toEqual([
      { trophyId: "0", name: "Tudo", description: "Ganhe todos", iconUrl: "https://i/NPWR10000_00.png", hidden: false, tier: "platinum", earned: false, earnedAt: null, rarityPct: null },
      { trophyId: "1", name: "Troféu 1", description: null, iconUrl: null, hidden: true, tier: "bronze", earned: false, earnedAt: null, rarityPct: null },
    ]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("npServiceName=trophy"))).toBe(true);
    await expect(client.getListTrophies("NPWR10001_00", "trophy2")).resolves.toBeNull();
    const refused = setup(() => json({ error: { message: "forbidden" } }, 403));
    await expect(refused.client.getListTrophies("NPWR10000_00", "trophy2")).rejects.toMatchObject({ status: 403 });
  });

  it("getListTrophies throws PsnHttpError on 429 and 5xx (with Retry-After), like every other read", async () => {
    const limited = setup(() => new Response("{}", { status: 429, headers: { "retry-after": "20" } }));
    await expect(limited.client.getListTrophies("NPWR10000_00", "trophy2")).rejects.toMatchObject({ status: 429, retryAfterMs: 20_000 });
    const down = setup(() => new Response("{}", { status: 503 }));
    const error = await down.client.getListTrophies("NPWR10000_00", "trophy2").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PsnHttpError);
    expect((error as Error).message).toBe("PSN list trophies failed with HTTP 503");
    // The other reads keep their message too (now a PsnHttpError).
    await expect(down.client.getTitles("1")).rejects.toThrow("PSN trophy titles failed with HTTP 503");
  });

  it("throws PsnHttpError with the status and Retry-After on 429 and 5xx", async () => {
    const { client } = setup(() => new Response("{}", { status: 429, headers: { "retry-after": "30" } }));
    await expect(client.getListInfo("NPWR10000_00", "trophy2")).rejects.toMatchObject({ status: 429, retryAfterMs: 30_000 });
    await expect(client.getListInfo("NPWR10000_00", "trophy2")).rejects.toBeInstanceOf(PsnHttpError);
    const down = setup(() => new Response("{}", { status: 503 }));
    await expect(down.client.getListInfo("NPWR10000_00", "trophy2")).rejects.toMatchObject({ status: 503, retryAfterMs: null });
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
