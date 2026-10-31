import { describe, expect, it, vi } from "vitest";
import {
  createCommunityProfileLookup,
  createFixtureProfileLookup,
  parseProfileSummary,
  parseSteamProfileInput,
  steamProfileHandle,
} from "./profile-lookup";

const ID = "76561198012210783";

describe("parseSteamProfileInput", () => {
  it.each([
    [ID, { kind: "id", steamId: ID }],
    [`  ${ID} `, { kind: "id", steamId: ID }],
    [`https://steamcommunity.com/profiles/${ID}`, { kind: "id", steamId: ID }],
    [`https://steamcommunity.com/profiles/${ID}/`, { kind: "id", steamId: ID }],
    [`steamcommunity.com/profiles/${ID}/games?tab=all`, { kind: "id", steamId: ID }],
    ["http://www.steamcommunity.com/id/MrDead_/", { kind: "vanity", vanity: "MrDead_" }],
    ["https://steamcommunity.com/id/tralked-teste", { kind: "vanity", vanity: "tralked-teste" }],
    ["tralked-teste", { kind: "vanity", vanity: "tralked-teste" }],
  ])("reads %s", (input, expected) => {
    expect(parseSteamProfileInput(input)).toEqual(expected);
  });

  it.each([
    [""],
    ["a"],
    ["https://evil.example.com/profiles/76561198012210783"],
    ["https://steamcommunity.com/profiles/123"],
    ["https://steamcommunity.com/groups/tralked"],
    ["nome com espaço"],
    ["<script>"],
    ["x".repeat(33)],
  ])("refuses %s", (input) => {
    expect(parseSteamProfileInput(input)).toBeNull();
  });

  it("stores a canonical handle (the id or the custom URL name)", () => {
    expect(steamProfileHandle({ kind: "id", steamId: ID })).toBe(ID);
    expect(steamProfileHandle({ kind: "vanity", vanity: "MrDead_" })).toBe("MrDead_");
  });
});

// Trimmed copy of Steam's community profile XML (/profiles/<id>/?xml=1).
const profileXml = ({ privacy = "public", summary = "Caçador de platinas.<br>TRK-AB3CD9 &amp; mais" } = {}) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><profile>
	<steamID64>${ID}</steamID64>
	<steamID><![CDATA[MrDead_]]></steamID>
	<privacyState>${privacy}</privacyState>
	<avatarFull><![CDATA[https://avatars.fastly.steamstatic.com/abc_full.jpg]]></avatarFull>
	<summary><![CDATA[${summary}]]></summary>
</profile>`;

describe("parseProfileSummary", () => {
  it("returns the profile summary as plain text (tags dropped, entities decoded)", () => {
    expect(parseProfileSummary(profileXml())).toBe("Caçador de platinas. TRK-AB3CD9 & mais");
    expect(parseProfileSummary(profileXml({ summary: '<a href="https://x">TRK</a>-<b>AB3CD9</b>' }))).toBe("TRK - AB3CD9");
    expect(parseProfileSummary("<profile><steamID64>1</steamID64></profile>")).toBe("");
  });
});

const xmlResponse = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/xml" } });

describe("createCommunityProfileLookup", () => {
  it("reads /profiles/<id>/?xml=1 or /id/<vanity>/?xml=1", async () => {
    const fetch = vi.fn(async () => xmlResponse(profileXml()));
    const lookup = createCommunityProfileLookup({ fetch });
    expect(await lookup.find({ kind: "id", steamId: ID })).toEqual({
      steamId: ID,
      personaName: "MrDead_",
      summary: "Caçador de platinas. TRK-AB3CD9 & mais",
      profilePublic: true,
    });
    await lookup.find({ kind: "vanity", vanity: "MrDead_" });
    expect(fetch.mock.calls.map((c) => String((c as unknown[])[0]))).toEqual([
      `https://steamcommunity.com/profiles/${ID}/?xml=1`,
      "https://steamcommunity.com/id/MrDead_/?xml=1",
    ]);
  });

  it("null for a profile that does not exist; private profiles are reported as such", async () => {
    const missing = createCommunityProfileLookup({
      fetch: async () => xmlResponse("<response><error><![CDATA[The specified profile could not be found.]]></error></response>"),
    });
    expect(await missing.find({ kind: "vanity", vanity: "ninguem" })).toBeNull();
    const closed = createCommunityProfileLookup({ fetch: async () => xmlResponse(profileXml({ privacy: "private" })) });
    expect(await closed.find({ kind: "id", steamId: ID })).toMatchObject({ profilePublic: false });
  });

  it("throws when Steam is unavailable (the caller says 'try again')", async () => {
    const down = createCommunityProfileLookup({ fetch: async () => xmlResponse("", 503) });
    await expect(down.find({ kind: "id", steamId: ID })).rejects.toThrow(/503/);
  });
});

describe("createFixtureProfileLookup", () => {
  it("finds the offline profiles by id or custom URL (any case)", async () => {
    const lookup = createFixtureProfileLookup();
    const byVanity = await lookup.find({ kind: "vanity", vanity: "Tralked-Teste" });
    expect(byVanity).toMatchObject({ steamId: "76561198000000042", profilePublic: true });
    expect(byVanity?.summary).toContain("TRK-STEAM2");
    expect(await lookup.find({ kind: "id", steamId: "76561198000000042" })).toEqual(byVanity);
    expect(await lookup.find({ kind: "vanity", vanity: "perfil-fechado" })).toMatchObject({ profilePublic: false });
    expect(await lookup.find({ kind: "vanity", vanity: "nao-existe" })).toBeNull();
  });
});
