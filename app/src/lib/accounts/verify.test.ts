import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import type { PlatformProfile } from "./profiles";

// Needs Postgres up and migrated (see db.test.ts); skipped when unreachable.
async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const reachable = await databaseReachable();

// The connected profile as the service account would read it (no network in tests).
const profiles = vi.hoisted(() => ({
  byId: new Map<string, PlatformProfile | Error | "hang">(),
  calls: [] as { platform: string; externalId: string; handle: string }[],
}));
vi.mock("./profiles", () => ({
  lookupProfile: async () => null,
  readConnectedProfile: async (platform: string, account: { externalId: string; handle: string }) => {
    profiles.calls.push({ platform, ...account });
    const found = profiles.byId.get(account.externalId);
    if (found === "hang") return new Promise(() => {});
    if (found instanceof Error) throw found;
    return found ?? null;
  },
}));

const HANDLE_PREFIX = "test_verify_";

describe("verification read deadline", () => {
  it("a slow platform is cut short so the request stays short", async () => {
    vi.useFakeTimers();
    try {
      const { within, VERIFY_READ_TIMEOUT_MS } = await import("./verify");
      const pending = within(new Promise(() => {}), VERIFY_READ_TIMEOUT_MS);
      const outcome = expect(pending).rejects.toThrow(/longer than/);
      await vi.advanceTimersByTimeAsync(VERIFY_READ_TIMEOUT_MS + 1);
      await outcome;
      await expect(within(Promise.resolve("ok"), VERIFY_READ_TIMEOUT_MS)).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
const T0 = new Date("2026-11-02T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

describe.skipIf(!reachable)("Verificar agora (ownership of an active connection)", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE_PREFIX } } });
  }

  /** A user with an active, unverified connection typed in. */
  async function connected(platform: "psn" | "xbox" | "retro" | "steam" = "psn", over: { verifiedAt?: Date } = {}) {
    const { prisma } = await import("@/lib/db");
    counter++;
    const user = await prisma.user.create({ data: { handle: `${HANDLE_PREFIX}${counter}`, displayName: "Teste" } });
    const externalId = `${HANDLE_PREFIX}ext-${counter}`;
    const account = await prisma.linkedAccount.create({
      data: { userId: user.id, platform, externalId, handle: `Jogador${counter}`, linkedAt: T0, ...over },
    });
    return { user, account, externalId };
  }

  const said = (externalId: string, text: string, over: Partial<PlatformProfile> = {}) =>
    profiles.byId.set(externalId, { externalId, handle: "Jogador", text, isPrivate: false, ...over });

  beforeAll(cleanup);
  beforeEach(async () => {
    profiles.byId.clear();
    profiles.calls = [];
    const { resetVerifyLimits } = await import("./verify");
    resetVerifyLimits();
  });
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("verifies a typed-in connection once the code shows up in the profile", async () => {
    const { prisma } = await import("@/lib/db");
    const { checkVerification, startVerification } = await import("./verify");
    const { user, account, externalId } = await connected("psn");

    const started = await startVerification(user.id, "psn", T0);
    expect(started).toMatchObject({ ok: true, expiresAt: later(24 * 60 * 60_000) });
    if (!started.ok) throw new Error("unreachable");
    expect(started.code).toMatch(/^TRK-[A-HJ-NP-Z2-9]{6}$/);
    // Still connected and unverified: nothing else changes while the code waits.
    expect(await prisma.linkedAccount.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
      linkedAt: T0,
      verifiedAt: null,
      verifyCode: started.code,
      externalId,
    });

    // Not there yet: recorded as a failure with its reason.
    said(externalId, "Só jogo de luta.");
    await expect(checkVerification(user.id, "psn", later(60_000))).resolves.toEqual({ ok: false, reason: "code_missing" });
    expect(await prisma.linkedAccount.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
      verifyFailure: "code_missing",
      verifyCheckedAt: later(60_000),
      verifiedAt: null,
    });

    said(externalId, `Só jogo de luta. ${started.code.toLowerCase()}`);
    await expect(checkVerification(user.id, "psn", later(120_000))).resolves.toEqual({ ok: true, handle: "Jogador" });
    expect(await prisma.linkedAccount.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
      verifiedAt: later(120_000),
      verifyCode: null,
      verifyExpiresAt: null,
      verifyFailure: null,
      linkedAt: T0,
      externalId,
    });
    // The read went by the connected account's own id and handle.
    expect(profiles.calls.at(-1)).toEqual({ platform: "psn", externalId, handle: account.handle });

    // Verified: no new code, and checking again is a no-op success.
    await expect(startVerification(user.id, "psn", later(130_000))).resolves.toEqual({ ok: false, reason: "already_verified" });
    await expect(checkVerification(user.id, "psn", later(200_000))).resolves.toEqual({ ok: true, handle: account.handle });
  });

  it("refuses without an active connection", async () => {
    const { prisma } = await import("@/lib/db");
    const { checkVerification, startVerification } = await import("./verify");
    counter++;
    const user = await prisma.user.create({ data: { handle: `${HANDLE_PREFIX}${counter}`, displayName: "Teste" } });
    await expect(startVerification(user.id, "xbox", T0)).resolves.toEqual({ ok: false, reason: "not_connected" });
    await expect(checkVerification(user.id, "xbox", T0)).resolves.toEqual({ ok: false, reason: "not_connected" });
    // An inactive row (a claim waiting for its code) is not a connection to verify.
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "xbox", externalId: `pending:${user.id}`, handle: "Alguem", linkedAt: null, verifyCode: "TRK-AAAAAA", verifyExpiresAt: later(60_000) },
    });
    await expect(checkVerification(user.id, "xbox", T0)).resolves.toEqual({ ok: false, reason: "not_connected" });
    expect(profiles.calls).toHaveLength(0);
  });

  it("an expired or missing code asks for a new one, without reading the platform", async () => {
    const { checkVerification, startVerification } = await import("./verify");
    const { user } = await connected("retro");
    await expect(checkVerification(user.id, "retro", T0)).resolves.toEqual({ ok: false, reason: "expired" });
    await startVerification(user.id, "retro", T0);
    await expect(checkVerification(user.id, "retro", later(24 * 60 * 60_000 + 1))).resolves.toEqual({ ok: false, reason: "expired" });
    expect(profiles.calls).toHaveLength(0);
  });

  it("rate-limits checks per connection (atomic cooldown) and per user", async () => {
    const { prisma } = await import("@/lib/db");
    const { checkVerification, startVerification, VERIFY_CHECKS_PER_HOUR, VERIFY_COOLDOWN_MS } = await import("./verify");
    const { user, externalId, account } = await connected("xbox");
    await startVerification(user.id, "xbox", T0);
    said(externalId, "nada");

    // Two checks at the same moment: only one reaches the platform.
    const [a, b] = await Promise.all([checkVerification(user.id, "xbox", T0), checkVerification(user.id, "xbox", T0)]);
    expect([a, b].filter((r) => !r.ok && r.reason === "too_soon")).toHaveLength(1);
    expect(profiles.calls).toHaveLength(1);
    await expect(checkVerification(user.id, "xbox", later(10_000))).resolves.toEqual({
      ok: false,
      reason: "too_soon",
      retryAfterSec: 20,
    });

    // A new code does not reset the cooldown.
    await startVerification(user.id, "xbox", later(11_000));
    await expect(checkVerification(user.id, "xbox", later(12_000))).resolves.toMatchObject({ reason: "too_soon" });

    // Past the per-user hourly cap, refused before the platform is read.
    for (let i = 1; i < VERIFY_CHECKS_PER_HOUR; i++) {
      await checkVerification(user.id, "xbox", later(i * VERIFY_COOLDOWN_MS + 1));
    }
    const calls = profiles.calls.length;
    expect(calls).toBe(VERIFY_CHECKS_PER_HOUR);
    const refused = await checkVerification(user.id, "xbox", later(VERIFY_CHECKS_PER_HOUR * VERIFY_COOLDOWN_MS + 1));
    expect(refused).toMatchObject({ ok: false, reason: "too_soon" });
    expect(profiles.calls).toHaveLength(calls);
    expect((await prisma.linkedAccount.findUniqueOrThrow({ where: { id: account.id } })).verifiedAt).toBeNull();
  });

  it("limits how many codes a user asks for", async () => {
    const { startVerification, VERIFY_STARTS_PER_HOUR } = await import("./verify");
    const { user } = await connected("psn");
    for (let i = 0; i < VERIFY_STARTS_PER_HOUR; i++) {
      expect((await startVerification(user.id, "psn", later(i))).ok).toBe(true);
    }
    await expect(startVerification(user.id, "psn", later(VERIFY_STARTS_PER_HOUR))).resolves.toMatchObject({
      ok: false,
      reason: "too_soon",
    });
  });

  it("tells why a check failed: another account, not found, private Steam, platform error", async () => {
    const { prisma } = await import("@/lib/db");
    const { checkVerification, startVerification, VERIFY_COOLDOWN_MS } = await import("./verify");

    // The stored online id now belongs to someone else, who even has the code in the profile.
    const psn = await connected("psn");
    const code = await startVerification(psn.user.id, "psn", T0);
    if (!code.ok) throw new Error("unreachable");
    profiles.byId.set(psn.externalId, { externalId: "outra-conta", handle: "Jogador", text: code.code, isPrivate: false });
    await expect(checkVerification(psn.user.id, "psn", T0)).resolves.toEqual({ ok: false, reason: "different" });

    const xbox = await connected("xbox");
    await startVerification(xbox.user.id, "xbox", T0);
    await expect(checkVerification(xbox.user.id, "xbox", T0)).resolves.toEqual({ ok: false, reason: "not_found" });

    const steam = await connected("steam");
    await startVerification(steam.user.id, "steam", T0);
    said(steam.externalId, "", { isPrivate: true });
    await expect(checkVerification(steam.user.id, "steam", T0)).resolves.toEqual({ ok: false, reason: "private" });

    const retro = await connected("retro");
    await startVerification(retro.user.id, "retro", T0);
    profiles.byId.set(retro.externalId, new Error("RetroAchievements API_GetUserProfile failed with HTTP 503"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(checkVerification(retro.user.id, "retro", T0)).resolves.toEqual({ ok: false, reason: "error" });
    quiet.mockRestore();
    expect(await prisma.linkedAccount.findUniqueOrThrow({ where: { id: retro.account.id } })).toMatchObject({
      verifyFailure: "error",
      verifiedAt: null,
    });

    // A new code clears the last failure.
    await startVerification(retro.user.id, "retro", later(VERIFY_COOLDOWN_MS));
    expect((await prisma.linkedAccount.findUniqueOrThrow({ where: { id: retro.account.id } })).verifyFailure).toBeNull();
  });

  it("changing or disconnecting the account drops the code; a verification never survives a new account", async () => {
    const { prisma } = await import("@/lib/db");
    const { checkVerification, startVerification } = await import("./verify");
    const { unlink } = await import("./link");
    const { user, externalId, account } = await connected("retro");
    const started = await startVerification(user.id, "retro", T0);
    if (!started.ok) throw new Error("unreachable");
    await unlink(user.id, "retro", later(1_000));
    expect(await prisma.linkedAccount.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
      linkedAt: null,
      verifiedAt: null,
      verifyCode: null,
      verifyFailure: null,
    });
    said(externalId, started.code);
    await expect(checkVerification(user.id, "retro", later(2_000))).resolves.toEqual({ ok: false, reason: "not_connected" });
  });

  it("cancel drops the pending code and keeps the connection", async () => {
    const { prisma } = await import("@/lib/db");
    const { cancelVerification, checkVerification, startVerification } = await import("./verify");
    const { user, account } = await connected("xbox");
    await expect(cancelVerification(user.id, "xbox")).resolves.toBe(false);
    await startVerification(user.id, "xbox", T0);
    await expect(cancelVerification(user.id, "xbox")).resolves.toBe(true);
    expect(await prisma.linkedAccount.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
      linkedAt: T0,
      verifyCode: null,
      verifyExpiresAt: null,
    });
    await expect(checkVerification(user.id, "xbox", T0)).resolves.toEqual({ ok: false, reason: "expired" });
  });
});
