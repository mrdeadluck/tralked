import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cookieStore = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.values.has(name) ? { value: cookieStore.values.get(name) } : undefined),
    set: (name: string, value: string) => cookieStore.values.set(name, value),
    delete: (name: string) => cookieStore.values.delete(name),
  }),
}));

// Outside a real request there is no request scope for `connection()`.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  cookieStore.values.clear();
});

describe("/api/auth/google", () => {
  it("answers 404 when Google login is not configured", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const { GET } = await import("./route");
    const { GET: callback } = await import("./callback/route");
    expect((await GET(new NextRequest("http://localhost:3000/api/auth/google"))).status).toBe(404);
    expect((await callback(new NextRequest("http://localhost:3000/api/auth/google/callback?code=x&state=y"))).status).toBe(404);
  });

  it("redirects to Google with PKCE and remembers state in an httpOnly cookie", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost:3000/api/auth/google?returnTo=//evil.example"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.toString()).not.toContain("secret");
    const stored = JSON.parse(cookieStore.values.get("gl_google_oauth")!);
    expect(stored.state).toBe(location.searchParams.get("state"));
    expect(stored.returnTo).toBe("/jogador/me"); // open redirect sanitized
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    cookieStore.values.set(
      "gl_google_oauth",
      JSON.stringify({ state: "good", nonce: "n", verifier: "v", returnTo: "/" }),
    );
    const { GET } = await import("./callback/route");
    const res = await GET(new NextRequest("http://localhost:3000/api/auth/google/callback?code=c&state=forged"));
    expect(new URL(res.headers.get("location")!).search).toBe("?login=erro");
    expect(cookieStore.values.has("gl_google_oauth")).toBe(false);
  });
});
