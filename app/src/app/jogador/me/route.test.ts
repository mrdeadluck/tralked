import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "http://localhost:3000" } }));

const { GET } = await import("./route");

const location = (response: Response) => new URL(response.headers.get("location")!);

beforeEach(() => vi.clearAllMocks());

describe("/jogador/me", () => {
  it("sends a visitor to the Tralked login, coming back here (never to Steam)", async () => {
    getSessionUser.mockResolvedValue(null);
    const target = location(await GET());
    expect(target.pathname).toBe("/entrar");
    expect(target.searchParams.get("returnTo")).toBe("/jogador/me");
    expect(target.origin).toBe("http://localhost:3000");
  });

  it("sends a logged-in user to their own sheet", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", handle: "Nyx_Vortex" });
    expect(location(await GET()).pathname).toBe("/jogador/Nyx_Vortex");
  });
});
