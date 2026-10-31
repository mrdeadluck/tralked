import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSteamLoginUrl, verifySteamAssertion } from "./openid";

const STEAM_ID = "76561198000000000";
const NOW = new Date("2026-10-31T12:00:00Z");

function assertionParams(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.return_to": "http://localhost:3000/api/auth/steam/callback",
    "openid.response_nonce": "2026-10-31T12:00:00Zabc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2ln",
    ...overrides,
  });
}

function mockFetch(body: string) {
  const fn = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get("openid.mode")).toBe("check_authentication");
    expect(sent.get("openid.sig")).toBe("c2ln");
  });

  it("forwards only openid.* fields to Steam", async () => {
    const fetchMock = mockFetch("is_valid:true\n");
    const params = assertionParams();
    params.set("state", "abc");
    params.set("returnTo", "/jogos");
    await verifySteamAssertion(params);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = new URLSearchParams(init.body as string);
    expect([...sent.keys()].every((key) => key.startsWith("openid."))).toBe(true);
  });

  it("returns null when Steam says is_valid:false", async () => {
    mockFetch("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n");
    await expect(verifySteamAssertion(assertionParams())).resolves.toBeNull();
  });

  describe("rejects without calling Steam", () => {
    const rejected: [string, () => URLSearchParams][] = [
      ["claimed_id on another host", () =>
        assertionParams({ "openid.claimed_id": `https://evil.example.com/openid/id/${STEAM_ID}` })],
      ["claimed_id with too few digits", () =>
        assertionParams({ "openid.claimed_id": "https://steamcommunity.com/openid/id/123" })],
      ["claimed_id with trailing junk", () =>
        assertionParams({ "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}x` })],
      ["empty claimed_id", () => assertionParams({ "openid.claimed_id": "" })],
      ["mode other than id_res", () => assertionParams({ "openid.mode": "cancel" })],
      ["foreign op_endpoint", () =>
        assertionParams({ "openid.op_endpoint": "https://evil.example.com/openid/login" })],
      ["identity different from claimed_id", () =>
        assertionParams({ "openid.identity": "https://steamcommunity.com/openid/id/76561198999999999" })],
      ["missing identity", () => {
        const p = assertionParams();
        p.delete("openid.identity");
        return p;
      }],
      ...["claimed_id", "identity", "return_to", "response_nonce"].map(
        (field): [string, () => URLSearchParams] => [
          `signed list without ${field}`,
          () =>
            assertionParams({
              "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce"
                .split(",")
                .filter((f) => f !== field)
                .join(","),
            }),
        ],
      ),
      ["response_nonce older than 5 minutes", () =>
        assertionParams({ "openid.response_nonce": "2026-10-31T11:54:00Zabc" })],
      ["response_nonce without timestamp", () =>
        assertionParams({ "openid.response_nonce": "garbage" })],
      ["duplicate claimed_id (attacker first)", () => {
        const p = new URLSearchParams();
        p.append("openid.claimed_id", `https://steamcommunity.com/openid/id/${STEAM_ID}`);
        for (const [k, v] of assertionParams()) p.append(k, v);
        return p;
      }],
      ["duplicate claimed_id (attacker last)", () => {
        const p = assertionParams();
        p.append("openid.claimed_id", "https://steamcommunity.com/openid/id/76561198999999999");
        return p;
      }],
      ["duplicate mode", () => {
        const p = assertionParams();
        p.append("openid.mode", "id_res");
        return p;
      }],
      ["duplicate sig", () => {
        const p = assertionParams();
        p.append("openid.sig", "other");
        return p;
      }],
    ];

    it.each(rejected)("%s", async (_name, build) => {
      const fetchMock = mockFetch("is_valid:true\n");
      await expect(verifySteamAssertion(build())).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("accepts a response_nonce just inside the 5 minute window", async () => {
    mockFetch("is_valid:true\n");
    await expect(
      verifySteamAssertion(assertionParams({ "openid.response_nonce": "2026-10-31T11:55:30Zabc" })),
    ).resolves.toBe(STEAM_ID);
  });

  it("returns null when the Steam request fails or times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(verifySteamAssertion(assertionParams())).resolves.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("network"))),
    );
    await expect(verifySteamAssertion(assertionParams())).resolves.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))),
    );
    await expect(verifySteamAssertion(assertionParams())).resolves.toBeNull();
  });
});
