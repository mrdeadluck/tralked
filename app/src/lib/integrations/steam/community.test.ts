import { describe, expect, it } from "vitest";
import { createSteamCommunity, parseAchievementPage, parseProfile, STEAM_ID64, xmlTag } from "./community";

describe("STEAM_ID64", () => {
  it("accepts today's ids and the next ranges, refuses anything else", () => {
    expect(STEAM_ID64.test("76561197960287930")).toBe(true);
    expect(STEAM_ID64.test("76561199999999999")).toBe(true);
    // Ids roll past 7656119… soon, up to 76561197960265728 + 2^32 - 1.
    expect(STEAM_ID64.test("76561200000000001")).toBe(true);
    expect(STEAM_ID64.test("76561202255233023")).toBe(true);
    expect(STEAM_ID64.test("76561203000000000")).toBe(false);
    expect(STEAM_ID64.test("76561100000000000")).toBe(false);
    expect(STEAM_ID64.test("7656119796028793")).toBe(false);
    expect(STEAM_ID64.test("765611979602879300")).toBe(false);
    expect(STEAM_ID64.test("12345678901234567")).toBe(false);
    expect(STEAM_ID64.test("7656119796028793a")).toBe(false);
  });
});

const REF = "76561198012210783";
const USER = "76561197993315263";

// Trimmed copies of Steam's real community XML (31/10/2026).
const profileXml = (id: string, name: string, privacy = "public") => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><profile>
	<steamID64>${id}</steamID64>
	<steamID><![CDATA[${name}]]></steamID>
	<privacyState>${privacy}</privacyState>
	<visibilityState>3</visibilityState>
	<avatarFull><![CDATA[https://avatars.fastly.steamstatic.com/abc_full.jpg]]></avatarFull>
	<groups><group isPrimary="1"><groupName><![CDATA[100% Achievements Group]]></groupName></group></groups>
</profile>`;

const achievement = (apiname: string, name: string, unlock?: number) => `
		<achievement closed="${unlock ? 1 : 0}">
			<iconClosed><![CDATA[https://shared.fastly.steamstatic.com/community_assets/images/apps/367520/${apiname}.jpg]]></iconClosed>
			<iconOpen><![CDATA[https://shared.fastly.steamstatic.com/community_assets/images/apps/367520/${apiname}_gray.jpg]]></iconOpen>
			<name><![CDATA[${name}]]></name>
			<apiname><![CDATA[${apiname}]]></apiname>
			<description><![CDATA[Defeat the "False" Knight]]></description>
			${unlock ? `<unlockTimestamp>${unlock}</unlockTimestamp>` : ""}
		</achievement>`;

const statsXml = (id: string, ...achievements: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><playerstats>
	<privacyState>public</privacyState>
	<visibilityState>3</visibilityState>
	<game><gameFriendlyName><![CDATA[367520]]></gameFriendlyName><gameName><![CDATA[Hollow Knight]]></gameName></game>
	<player><steamID64>${id}</steamID64></player>
	<achievements>${achievements.join("")}
	</achievements>
</playerstats>`;

const percentages = {
  achievementpercentages: {
    achievements: [
      { name: "FK_DEFEAT", percent: "71.3" },
      { name: "CHARMED", percent: 76.7 },
    ],
  },
};

type Route = (url: URL, init?: RequestInit) => Response | undefined;

function fakeFetch(...routes: Route[]) {
  const calls: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(url);
    for (const route of routes) {
      const res = route(new URL(url), init);
      if (res) return res;
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, calls };
}

const xml = (body: string) => new Response(body, { headers: { "content-type": "text/xml" } });
const json = (body: unknown, status = 200) => Response.json(body, { status });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

const hkPage: Route = (url) =>
  url.pathname === `/profiles/${USER}/stats/367520/achievements/`
    ? xml(statsXml(USER, achievement("fk_defeat", "Falsehood", 1757048535), achievement("charmed", "Charmed")))
    : undefined;
const hkReference: Route = (url) =>
  url.pathname === `/profiles/${REF}/stats/367520/achievements/`
    ? xml(statsXml(REF, achievement("fk_defeat", "Falsehood", 1757048535), achievement("charmed", "Charmed", 1757049779)))
    : undefined;
const hkPercentages: Route = (url) =>
  url.pathname.endsWith("/GetGlobalAchievementPercentagesForApp/v2/") && url.searchParams.get("gameid") === "367520"
    ? json(percentages)
    : undefined;

describe("parsers", () => {
  it("reads a public profile and ignores nested group fields", () => {
    expect(parseProfile(profileXml(USER, "Diguzz"))).toEqual({
      steamId: USER,
      personaName: "Diguzz",
      avatarUrl: "https://avatars.fastly.steamstatic.com/abc_full.jpg",
      profilePublic: true,
    });
    expect(parseProfile(profileXml(USER, "Diguzz", "friendsonly"))?.profilePublic).toBe(false);
    expect(parseProfile("<response><error><![CDATA[The specified profile could not be found.]]></error></response>")).toBeNull();
  });

  it("reads achievements: closed + timestamp is an unlock, CDATA text as-is, colored icon", () => {
    const page = parseAchievementPage(statsXml(USER, achievement("fk_defeat", "Falsehood", 1757048535), achievement("charmed", "Charmed")));
    expect(page).toEqual({
      status: "ok",
      achievements: [
        {
          apiName: "fk_defeat",
          name: "Falsehood",
          description: 'Defeat the "False" Knight',
          iconUrl: "https://shared.fastly.steamstatic.com/community_assets/images/apps/367520/fk_defeat.jpg",
          achieved: true,
          unlockedAt: new Date(1757048535 * 1000),
        },
        expect.objectContaining({ apiName: "charmed", achieved: false, unlockedAt: null }),
      ],
    });
  });

  it("closed without a timestamp is an unlock on an unknown date", () => {
    const page = parseAchievementPage(statsXml(USER, achievement("tf_old", "Old", 1).replace("<unlockTimestamp>1</unlockTimestamp>", "")));
    expect(page).toMatchObject({ status: "ok", achievements: [{ apiName: "tf_old", achieved: true, unlockedAt: null }] });
  });

  it("tells private pages from unavailable ones", () => {
    expect(parseAchievementPage("<playerstats><error><![CDATA[This profile is private.]]></error></playerstats>")).toEqual({ status: "private" });
    expect(parseAchievementPage("<playerstats><privacyState>friendsonly</privacyState></playerstats>")).toEqual({ status: "private" });
    expect(parseAchievementPage("<playerstats><error><![CDATA[Stats not found]]></error></playerstats>")).toEqual({ status: "unavailable" });
    expect(parseAchievementPage("<html>login</html>")).toEqual({ status: "unavailable" });
  });
});

describe("createSteamCommunity", () => {
  it("getPlayerSummary reads the profile XML; a missing profile throws", async () => {
    const { fetch } = fakeFetch((url) =>
      url.pathname === `/profiles/${USER}/` && url.searchParams.get("xml") === "1" ? xml(profileXml(USER, "Diguzz")) : undefined,
    );
    const steam = createSteamCommunity({ fetch });
    await expect(steam.getPlayerSummary(USER)).resolves.toMatchObject({ steamId: USER, personaName: "Diguzz", profilePublic: true });
    await expect(steam.getPlayerSummary("1")).rejects.toThrow(/HTTP 404/);
  });

  it("getOwnedGames is unsupported without a key", async () => {
    await expect(createSteamCommunity({ fetch: fakeFetch().fetch }).getOwnedGames(USER)).resolves.toBe("unsupported");
  });

  it("getPlayerAchievements restores Steam's apiName casing and keeps unlock times", async () => {
    const { fetch, calls } = fakeFetch(hkPage, hkPercentages);
    const steam = createSteamCommunity({ fetch });
    await expect(steam.getPlayerAchievements(USER, 367520)).resolves.toEqual([
      { apiName: "FK_DEFEAT", achieved: true, unlockedAt: new Date(1757048535 * 1000) },
      { apiName: "CHARMED", achieved: false, unlockedAt: null },
    ]);
    // Percentages are cached: a second read of the same app asks Steam once more for the page only.
    await steam.getPlayerAchievements(USER, 367520);
    expect(calls.filter((c) => c.includes("GetGlobalAchievementPercentagesForApp"))).toHaveLength(1);
  });

  it("getSchemaForGame reads the reference profile's page", async () => {
    const { fetch, calls } = fakeFetch(hkReference, hkPercentages);
    const schema = await createSteamCommunity({ fetch, referenceSteamId: REF }).getSchemaForGame(367520);
    expect(schema.map((a) => a.apiName)).toEqual(["FK_DEFEAT", "CHARMED"]);
    expect(schema[0]).toMatchObject({ name: "Falsehood", hidden: false, iconUrl: expect.stringContaining("fk_defeat.jpg") });
    expect(calls[0]).toContain(`/profiles/${REF}/stats/367520/achievements/?xml=1`);
  });

  it("follows Steam's redirect to a friendly stats name, and treats a redirect to the profile as no stats", async () => {
    const { fetch, calls } = fakeFetch(
      (url, init) => {
        if (url.pathname !== `/profiles/${USER}/stats/440/achievements/`) return undefined;
        expect(init?.redirect).toBe("manual");
        return redirect("https://steamcommunity.com/id/diguzzz/stats/TF2?tab=achievements");
      },
      (url) => (url.pathname === "/id/diguzzz/stats/TF2/achievements/" ? xml(statsXml(USER, achievement("tf_play_game_everyclass", "Head of the Class", 1300000000))) : undefined),
      (url) => (url.pathname === `/profiles/${USER}/stats/228980/achievements/` ? redirect("https://steamcommunity.com/id/diguzzz") : undefined),
      (url) => (url.pathname.endsWith("/GetGlobalAchievementPercentagesForApp/v2/") ? json({}, 403) : undefined),
    );
    const steam = createSteamCommunity({ fetch });
    await expect(steam.getPlayerAchievements(USER, 440)).resolves.toEqual([
      { apiName: "tf_play_game_everyclass", achieved: true, unlockedAt: new Date(1300000000 * 1000) },
    ]);
    expect(calls[1]).toBe("https://steamcommunity.com/id/diguzzz/stats/TF2/achievements/?xml=1");
    await expect(steam.getPlayerAchievements(USER, 228980)).resolves.toEqual([]);
    await expect(steam.getGlobalAchievementPercentages(228980)).resolves.toEqual({});
  });

  it("reports private game details, and a private reference profile is an error", async () => {
    const privatePage = xml("<playerstats><error><![CDATA[This profile is private.]]></error></playerstats>");
    const { fetch } = fakeFetch((url) => (url.pathname.includes("/stats/") ? privatePage.clone() : undefined));
    const steam = createSteamCommunity({ fetch, referenceSteamId: REF });
    await expect(steam.getPlayerAchievements(USER, 367520)).resolves.toBe("private");
    await expect(steam.getSchemaForGame(367520)).rejects.toThrow(/reference profile/);
  });

  it("getGlobalAchievementPercentages parses numbers and fails loudly on server errors", async () => {
    const steam = createSteamCommunity({ fetch: fakeFetch(hkPercentages).fetch });
    await expect(steam.getGlobalAchievementPercentages(367520)).resolves.toEqual({ FK_DEFEAT: 71.3, CHARMED: 76.7 });
    const broken = createSteamCommunity({ fetch: async () => new Response("", { status: 502 }) });
    await expect(broken.getGlobalAchievementPercentages(1)).rejects.toThrow(/HTTP 502/);
  });

  it("resolveVanity returns the SteamID64 of a custom URL", async () => {
    const { fetch } = fakeFetch((url) => (url.pathname === "/id/MrDead_/" ? xml(profileXml(REF, "MrDead_")) : undefined));
    await expect(createSteamCommunity({ fetch }).resolveVanity("MrDead_")).resolves.toBe(REF);
  });

  it("only accepts real SteamID64s and Steam CDN avatars/icons", async () => {
    const { fetch } = fakeFetch((url) =>
      url.pathname === "/id/fake/" ? xml(profileXml("12345", "Fake")) : undefined,
    );
    await expect(createSteamCommunity({ fetch }).resolveVanity("fake")).resolves.toBeNull();
    const evil = profileXml(USER, "Diguzz").replace(
      "https://avatars.fastly.steamstatic.com/abc_full.jpg",
      "javascript:alert(1)",
    );
    expect(parseProfile(evil)?.avatarUrl).toBe("");
    const page = parseAchievementPage(
      statsXml(USER, achievement("a", "A", 1).replace(/https:\/\/shared\.fastly\.steamstatic\.com/g, "http://evil.example")),
    );
    expect(page.status === "ok" && page.achievements[0].iconUrl).toBeUndefined();
  });

  it("does not follow a redirect off steamcommunity.com", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.pathname.includes("/stats/")
        ? redirect("https://evil.example/id/x/stats/TF2?tab=achievements")
        : undefined,
    );
    await expect(createSteamCommunity({ fetch }).getPlayerAchievements(USER, 440)).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("skips invalid numeric entities instead of throwing", () => {
    expect(xmlTag("<name>a&#99999999;b&#x41;</name>", "name")).toBe("abA");
  });
});
