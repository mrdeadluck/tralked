import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSteamLoginUrl, verifySteamAssertion } from "./openid";

const STEAM_ID = "76561198000000000";

function assertionParams(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.return_to": "http://localhost:3000/api/auth/steam/callback",
    "openid.response_nonce": "2026-10-31T00:00:00Zabc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to",
    "openid.sig": "c2ln",
    ...overrides,
  });
}

function mockFetch(body: string) {
  const fn = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("buildSteamLoginUrl", () => {
  it("targets the Steam OpenID endpoint with checkid_setup, return_to and realm", () => {
    const returnTo = "http://localhost:3000/api/auth/steam/callback?returnTo=%2Fjogos";
    const url = new URL(buildSteamLoginUrl(returnTo, "http://localhost:3000"));
    expect(url.origin + url.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.ns")).toBe("http://specs.openid.net/auth/2.0");
    expect(url.searchParams.get("openid.return_to")).toBe(returnTo);
    expect(url.searchParams.get("openid.realm")).toBe("http://localhost:3000");
    expect(url.searchParams.get("openid.identity")).toBe(
      "http://specs.openid.net/auth/2.0/identifier_select",
    );
    expect(url.searchParams.get("openid.claimed_id")).toBe(
      "http://specs.openid.net/auth/2.0/identifier_select",
    );
  });
});

describe("verifySteamAssertion", () => {
  it("returns the steamId when Steam confirms the assertion", async () => {
    const fetchMock = mockFetch("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n");
    await expect(verifySteamAssertion(assertionParams())).resolves.toBe(STEAM_ID);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://steamcommunity.com/openid/login");
    expect(init.method).toBe("POST");
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get("openid.mode")).toBe("check_authentication");
    expect(sent.get("openid.sig")).toBe("c2ln");
  });

  it("returns null when Steam says is_valid:false", async () => {
    mockFetch("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n");
    await expect(verifySteamAssertion(assertionParams())).resolves.toBeNull();
  });

  it("returns null without calling Steam when claimed_id is out of pattern", async () => {
    const fetchMock = mockFetch("is_valid:true\n");
    const bad = [
      "https://evil.example.com/openid/id/76561198000000000",
      "https://steamcommunity.com/openid/id/123",
      "https://steamcommunity.com/openid/id/76561198000000000x",
      "",
    ];
    for (const claimed of bad) {
      await expect(
        verifySteamAssertion(assertionParams({ "openid.claimed_id": claimed })),
      ).resolves.toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when mode is not id_res", async () => {
    const fetchMock = mockFetch("is_valid:true\n");
    await expect(
      verifySteamAssertion(assertionParams({ "openid.mode": "cancel" })),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the Steam request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(verifySteamAssertion(assertionParams())).resolves.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("network"))),
    );
    await expect(verifySteamAssertion(assertionParams())).resolves.toBeNull();
  });
});
