import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import { buildGoogleAuthUrl, exchangeGoogleCode, pkceChallenge, upsertUserFromGoogle } from "./google";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const CLIENT_ID = "client-123.apps.googleusercontent.com";
const SECRET = "google-client-secret-value";
const REDIRECT = "http://localhost:3000/api/auth/google/callback";

describe("pkce and auth url", () => {
  it("computes the RFC 7636 S256 challenge", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("asks for an authorization code with PKCE, state and nonce", () => {
    const url = new URL(
      buildGoogleAuthUrl(CLIENT_ID, REDIRECT, { state: "st", nonce: "nn", verifier: "vv", returnTo: "/" }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: "openid email profile",
      state: "st",
      nonce: "nn",
      code_challenge: pkceChallenge("vv"),
      code_challenge_method: "S256",
    });
    expect(url.toString()).not.toContain("vv&");
  });
});

describe("exchangeGoogleCode", () => {
  let keys: ReturnType<typeof createLocalJWKSet>;
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "k1" }] });
  });

  const idToken = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? "https://accounts.google.com")
      .setAudience(opts.aud ?? CLIENT_ID)
      .setSubject("1234567890")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  function client(token: string | Promise<string>, status = 200) {
    const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ id_token: await token, access_token: "at" }), { status }),
    );
    return {
      fetchMock,
      config: { clientId: CLIENT_ID, clientSecret: SECRET, redirectUri: REDIRECT, fetch: fetchMock as unknown as typeof fetch, keys },
    };
  }

  it("exchanges the code with the PKCE verifier and returns the verified claims", async () => {
    const { config, fetchMock } = client(
      idToken({ nonce: "n1", email: "ana@example.com", email_verified: true, name: "Ana", picture: "https://p/a.png" }),
    );
    await expect(exchangeGoogleCode(config, "code-1", { nonce: "n1", verifier: "ver-1" })).resolves.toEqual({
      sub: "1234567890",
      email: "ana@example.com",
      emailVerified: true,
      name: "Ana",
      picture: "https://p/a.png",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("code")).toBe("code-1");
    expect(form.get("code_verifier")).toBe("ver-1");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a replayed token (nonce), another audience or another issuer", async () => {
    await expect(
      exchangeGoogleCode(client(idToken({ nonce: "other" })).config, "c", { nonce: "n1", verifier: "v" }),
    ).rejects.toThrow(/nonce/);
    await expect(
      exchangeGoogleCode(client(idToken({ nonce: "n1" }, { aud: "someone-else" })).config, "c", { nonce: "n1", verifier: "v" }),
    ).rejects.toThrow();
    await expect(
      exchangeGoogleCode(client(idToken({ nonce: "n1" }, { iss: "https://evil.example" })).config, "c", { nonce: "n1", verifier: "v" }),
    ).rejects.toThrow();
  });

  it("keeps the client secret and the code out of errors", async () => {
    const error = (await exchangeGoogleCode(client("x", 400).config, "secret-code", { nonce: "n", verifier: "v" }).catch(
      (e: Error) => e,
    )) as Error;
    expect(error.message).toBe("Google token request failed with HTTP 400");
    expect(error.message).not.toContain(SECRET);
  });
});

async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const pg = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await pg.connect();
    return true;
  } catch {
    return false;
  } finally {
    await pg.end().catch(() => {});
  }
}

const reachable = await databaseReachable();
const SUB_PREFIX = "test-google-";

describe.skipIf(!reachable)("upsertUserFromGoogle", () => {
  const cleanup = async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { googleSub: { startsWith: SUB_PREFIX } } });
    await prisma.user.deleteMany({ where: { handle: { startsWith: "test_google_" } } });
  };
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("creates a reader account, then logs the same Google account into it", async () => {
    const claims = {
      sub: `${SUB_PREFIX}1`,
      email: "leitora@example.com",
      emailVerified: true,
      name: "Test Google Leitora",
      picture: "http://insecure/p.png",
    };
    const created = await upsertUserFromGoogle(claims, null);
    if (!created.ok) throw new Error("unreachable");
    expect(created.user).toMatchObject({
      googleSub: `${SUB_PREFIX}1`,
      email: "leitora@example.com",
      steamId: null,
      role: "user",
      handle: "test_google_leitora",
      avatarUrl: null, // only https pictures are kept
    });
    const again = await upsertUserFromGoogle(claims, null);
    expect(again).toMatchObject({ ok: true, user: { id: created.user.id } });
  });

  it("does not store an unverified email", async () => {
    const result = await upsertUserFromGoogle(
      { sub: `${SUB_PREFIX}2`, email: "x@example.com", emailVerified: false, name: "Test Google Sem Email" },
      null,
    );
    expect(result).toMatchObject({ ok: true, user: { email: null } });
  });

  it("never creates or fills a second account with an e-mail that is already someone's login", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.user.create({
      data: { handle: "test_google_dona", displayName: "Dona", email: "dona@example.com", passwordHash: "scrypt$x" },
    });
    await expect(
      upsertUserFromGoogle({ sub: `${SUB_PREFIX}5`, email: "Dona@Example.com", emailVerified: true, name: "Dona" }, null),
    ).resolves.toEqual({ ok: false, reason: "email_taken" });

    const other = await prisma.user.create({ data: { handle: "test_google_outra", displayName: "Outra" } });
    const linked = await upsertUserFromGoogle({ sub: `${SUB_PREFIX}6`, email: "dona@example.com", emailVerified: true }, other.id);
    expect(linked).toMatchObject({ ok: true, user: { id: other.id, googleSub: `${SUB_PREFIX}6`, email: null } });
  });

  it("links Google to the logged-in account, and refuses a Google account owned by someone else", async () => {
    const { prisma } = await import("@/lib/db");
    const steamUser = await prisma.user.create({ data: { handle: "test_google_steam", displayName: "Steam" } });
    const linked = await upsertUserFromGoogle({ sub: `${SUB_PREFIX}3`, emailVerified: false }, steamUser.id);
    expect(linked).toMatchObject({ ok: true, user: { id: steamUser.id, googleSub: `${SUB_PREFIX}3` } });

    const other = await prisma.user.create({ data: { handle: "test_google_other", displayName: "Other" } });
    await expect(upsertUserFromGoogle({ sub: `${SUB_PREFIX}3`, emailVerified: false }, other.id)).resolves.toEqual({
      ok: false,
      reason: "taken",
    });

    // The account already has a Google link: another Google account never replaces it silently.
    await expect(upsertUserFromGoogle({ sub: `${SUB_PREFIX}4`, emailVerified: false }, steamUser.id)).resolves.toEqual({
      ok: false,
      reason: "different",
    });
    const kept = await prisma.user.findUniqueOrThrow({ where: { id: steamUser.id } });
    expect(kept.googleSub).toBe(`${SUB_PREFIX}3`);
    // Logging in again with the same Google account is fine.
    await expect(upsertUserFromGoogle({ sub: `${SUB_PREFIX}3`, emailVerified: false }, steamUser.id)).resolves.toMatchObject({
      ok: true,
    });
  });
});
