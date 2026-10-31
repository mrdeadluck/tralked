import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string) => void store.set(name, value));
const cookieDelete = vi.fn((name: string) => void store.delete(name));
const findUnique = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: cookieSet,
    delete: cookieDelete,
  }),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));

const {
  SESSION_COOKIE,
  createSession,
  destroySession,
  getSessionUser,
  signSessionToken,
  verifySessionToken,
} = await import("./session");
const { env } = await import("@/lib/env");

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("session token", () => {
  it("round-trips the user id", async () => {
    const token = await signSessionToken("user-1");
    await expect(verifySessionToken(token)).resolves.toBe("user-1");
  });

  it("rejects a tampered token", async () => {
    const token = await signSessionToken("user-1");
    const [h, p, s] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url");
    await expect(verifySessionToken(`${h}.${forgedPayload}.${s}`)).resolves.toBeNull();
    await expect(verifySessionToken(`${h}.${p}.${s.slice(0, -2)}xx`)).resolves.toBeNull();
    await expect(verifySessionToken("not-a-jwt")).resolves.toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const other = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("another-secret-another-secret-0123456789"));
    await expect(verifySessionToken(other)).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(new TextEncoder().encode(env.SESSION_SECRET));
    await expect(verifySessionToken(expired)).resolves.toBeNull();
  });
});

describe("cookie session", () => {
  it("createSession sets a httpOnly, lax, 30-day cookie", async () => {
    await createSession("user-1");
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, , options] = cookieSet.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe(SESSION_COOKIE);
    expect(SESSION_COOKIE).toBe("gl_session");
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      secure: env.APP_URL.startsWith("https"),
    });
  });

  it("getSessionUser returns the user for a valid cookie", async () => {
    const user = { id: "user-1", handle: "lucas" };
    findUnique.mockResolvedValue(user);
    await createSession("user-1");
    await expect(getSessionUser()).resolves.toBe(user);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "user-1" } });
  });

  it("getSessionUser returns null without a cookie, or with a tampered one", async () => {
    await expect(getSessionUser()).resolves.toBeNull();
    store.set(SESSION_COOKIE, "garbage.token.value");
    await expect(getSessionUser()).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("destroySession removes the cookie", async () => {
    await createSession("user-1");
    await destroySession();
    expect(cookieDelete).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});
