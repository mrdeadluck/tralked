import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeOidState = vi.fn();
const verifySteamAssertion = vi.fn();
const createSession = vi.fn();
const getSessionUser = vi.fn();
const upsertUserFromSteam = vi.fn();
const linkSteamToUser = vi.fn();
const syncUser = vi.fn();
// Runs the deferred task right away without awaiting it, like the response being sent first.
const { after, afterTasks } = vi.hoisted(() => {
  const afterTasks: Promise<unknown>[] = [];
  const after = vi.fn((task: () => Promise<unknown>) => {
    afterTasks.push(task());
  });
  return { after, afterTasks };
});

vi.mock("@/lib/auth/oid-state", () => ({ consumeOidState }));
vi.mock("@/lib/auth/openid", () => ({ verifySteamAssertion }));
vi.mock("@/lib/auth/session", () => ({ createSession, getSessionUser }));
vi.mock("@/lib/auth/upsert-user", () => ({ upsertUserFromSteam }));
vi.mock("@/lib/auth/link-steam", () => ({ linkSteamToUser }));
vi.mock("@/lib/sync/user", () => ({ syncUser }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after,
}));

const { GET } = await import("./route");
const { env } = await import("@/lib/env");

const CALLBACK = `${env.APP_URL}/api/auth/steam/callback`;

function callbackRequest({
  state = "s1",
  returnTo = "/jogador/me",
  openidReturnTo,
}: { state?: string; returnTo?: string; openidReturnTo?: string } = {}) {
  const own = new URL(CALLBACK);
  own.searchParams.set("returnTo", returnTo);
  own.searchParams.set("state", state);
  const url = new URL(CALLBACK);
  url.searchParams.set("returnTo", returnTo);
  url.searchParams.set("state", state);
  url.searchParams.set("openid.return_to", openidReturnTo ?? own.toString());
  return new NextRequest(url);
}

const location = (response: Response) => new URL(response.headers.get("location")!);

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  consumeOidState.mockResolvedValue(true);
  verifySteamAssertion.mockResolvedValue("76561198000000000");
  upsertUserFromSteam.mockResolvedValue({ id: "u1", handle: "lucas" });
  getSessionUser.mockResolvedValue(null);
  syncUser.mockResolvedValue({ status: "ok" });
});

describe("steam callback while logged in", () => {
  const googleOnly = { id: "g1", handle: "leitora", steamId: null };

  it("links Steam to a logged-in account without Steam instead of creating another account", async () => {
    getSessionUser.mockResolvedValue(googleOnly);
    linkSteamToUser.mockResolvedValue({ ok: true, user: { ...googleOnly, steamId: "76561198000000000" } });
    const response = await GET(callbackRequest({ returnTo: "/conta/conexoes" }));
    expect(linkSteamToUser).toHaveBeenCalledWith("g1", "76561198000000000");
    expect(upsertUserFromSteam).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(syncUser).toHaveBeenCalledWith("g1");
    expect(location(response).pathname).toBe("/conta/conexoes");
  });

  it.each([
    ["in_use", "steam_em_uso"],
    ["has_other", "steam_diferente"],
  ])("refuses (%s) with an explanation on /conta/conexoes", async (reason, code) => {
    getSessionUser.mockResolvedValue(googleOnly);
    linkSteamToUser.mockResolvedValue({ ok: false, reason });
    const response = await GET(callbackRequest({ returnTo: "/conta/conexoes" }));
    expect(location(response).pathname).toBe("/conta/conexoes");
    expect(location(response).searchParams.get("erro")).toBe(code);
    expect(createSession).not.toHaveBeenCalled();
    expect(syncUser).not.toHaveBeenCalled();
  });

  it("a logged-in user who already has Steam just logs in with the Steam account used", async () => {
    getSessionUser.mockResolvedValue({ id: "u9", handle: "outro", steamId: "76561198000000999" });
    const response = await GET(callbackRequest());
    expect(linkSteamToUser).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith("u1");
    expect(location(response).pathname).toBe("/jogador/lucas");
  });
});

describe("steam callback", () => {
  it("logs in and redirects to the player's page for the default returnTo", async () => {
    const response = await GET(callbackRequest());
    expect(consumeOidState).toHaveBeenCalledWith("s1");
    expect(createSession).toHaveBeenCalledWith("u1");
    expect(syncUser).toHaveBeenCalledWith("u1");
    expect(location(response).pathname).toBe("/jogador/lucas");
  });

  it("honours a valid returnTo", async () => {
    const response = await GET(callbackRequest({ returnTo: "/jogos/hollow-knight" }));
    expect(location(response).pathname).toBe("/jogos/hollow-knight");
  });

  it("still logs in when the sync fails, and logs the failure", async () => {
    syncUser.mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(callbackRequest());
    expect(location(response).pathname).toBe("/jogador/lucas");
    expect(createSession).toHaveBeenCalled();
    await Promise.all(afterTasks);
    expect(errorSpy).toHaveBeenCalledWith("Steam login: initial sync failed", expect.any(Error));
    errorSpy.mockRestore();
  });

  it("returns the session redirect without waiting for the first sync (runs after the response)", async () => {
    syncUser.mockReturnValue(new Promise(() => {})); // never resolves
    const response = await GET(callbackRequest());
    expect(location(response).pathname).toBe("/jogador/lucas");
    expect(createSession).toHaveBeenCalledWith("u1");
    expect(after).toHaveBeenCalledTimes(1);
    expect(syncUser).toHaveBeenCalledWith("u1");
  });

  it("rejects a state that does not match the cookie, before calling Steam", async () => {
    consumeOidState.mockResolvedValue(false);
    const response = await GET(callbackRequest());
    expect(location(response).search).toBe("?login=erro&motivo=estado");
    expect(verifySteamAssertion).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects when the signed return_to carries a different state", async () => {
    const other = new URL(CALLBACK);
    other.searchParams.set("state", "attacker");
    const response = await GET(callbackRequest({ openidReturnTo: other.toString() }));
    expect(location(response).search).toBe("?login=erro&motivo=estado");
    expect(verifySteamAssertion).not.toHaveBeenCalled();
  });

  it.each([
    ["a prefix-only match on the path", `${CALLBACK}-evil`],
    ["a longer path", `${CALLBACK}/extra`],
    ["another origin", "https://evil.example.com/api/auth/steam/callback"],
    ["garbage", "not a url"],
  ])("rejects return_to with %s", async (_name, openidReturnTo) => {
    const response = await GET(callbackRequest({ openidReturnTo }));
    expect(location(response).search).toBe("?login=erro&motivo=estado");
    expect(verifySteamAssertion).not.toHaveBeenCalled();
  });

  it("redirects to the error page when Steam does not validate (or times out)", async () => {
    verifySteamAssertion.mockResolvedValue(null);
    const response = await GET(callbackRequest());
    expect(location(response).search).toBe("?login=erro&motivo=steam");
    expect(createSession).not.toHaveBeenCalled();
  });
});
