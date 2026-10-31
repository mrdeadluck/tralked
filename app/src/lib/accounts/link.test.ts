import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import type { PlatformProfile } from "./profiles";

// Needs Postgres up and seeded (see db.test.ts); skipped when unreachable.
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

// The platform profile as the service account would read it (no network in tests).
const profiles = vi.hoisted(() => ({ byHandle: new Map<string, PlatformProfile>(), calls: 0 }));
vi.mock("./profiles", () => ({
  lookupProfile: async (_platform: string, handle: string) => {
    profiles.calls++;
    return profiles.byHandle.get(handle.toLowerCase()) ?? null;
  },
}));

const HANDLE_PREFIX = "test_link_";
const T0 = new Date("2026-10-31T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

function profile(handle: string, externalId: string, text: string, isPrivate = false) {
  profiles.byHandle.set(handle.toLowerCase(), { externalId, handle, text, isPrivate });
}

describe("link helpers", () => {
  it("generates TRK- codes without ambiguous characters", async () => {
    const { generateLinkCode } = await import("./link");
    for (let i = 0; i < 50; i++) expect(generateLinkCode()).toMatch(/^TRK-[A-HJ-NP-Z2-9]{6}$/);
  });

  it("finds the code in profile text regardless of case and spacing", async () => {
    const { containsCode } = await import("./link");
    expect(containsCode("Meu código: trk-ab3cd9 :)", "TRK-AB3CD9")).toBe(true);
    expect(containsCode("TRK AB3CD9", "TRK-AB3CD9")).toBe(true);
    expect(containsCode("TRK-AB3CD8", "TRK-AB3CD9")).toBe(false);
  });
});

describe.skipIf(!reachable)("account linking", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE_PREFIX } } });
  }

  async function newUser() {
    const { prisma } = await import("@/lib/db");
    counter++;
    return prisma.user.create({ data: { handle: `${HANDLE_PREFIX}${counter}`, displayName: "Teste" } });
  }

  beforeAll(cleanup);
  beforeEach(() => {
    profiles.byHandle.clear();
    profiles.calls = 0;
  });
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("links an account once the code is in the profile", async () => {
    const { prisma } = await import("@/lib/db");
    const { confirmLink, startLink } = await import("./link");
    const user = await newUser();
    const started = await startLink(user.id, "psn", " Dono-Real ", T0);
    expect(started).toMatchObject({ ok: true, expiresAt: later(30 * 60_000) });
    if (!started.ok) throw new Error("unreachable");
    expect(started.code).toMatch(/^TRK-[A-Z0-9]{6}$/);

    profile("Dono-Real", "acc-dono-real", `Oi! ${started.code}`);
    await expect(confirmLink(user.id, "psn", later(60_000))).resolves.toEqual({
      ok: true,
      handle: "Dono-Real",
      externalId: "acc-dono-real",
    });
    const account = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: user.id, platform: "psn" } },
    });
    expect(account).toMatchObject({ externalId: "acc-dono-real", verifyCode: null, verifyExpiresAt: null });
    expect(account.verifiedAt).toEqual(later(60_000));

    // A verified account must be unlinked before linking another.
    await expect(startLink(user.id, "psn", "Outra-Conta", T0)).resolves.toEqual({
      ok: false,
      reason: "already_linked",
    });
  });

  it("refuses when the code is not in the profile (someone else's account)", async () => {
    const { confirmLink, startLink } = await import("./link");
    const user = await newUser();
    await startLink(user.id, "xbox", "Alguem", T0);
    profile("Alguem", "xuid-alguem", "bio sem código");
    await expect(confirmLink(user.id, "xbox", later(1000))).resolves.toEqual({ ok: false, reason: "code_missing" });
  });

  it("refuses an expired code without reading the platform", async () => {
    const { confirmLink, startLink } = await import("./link");
    const user = await newUser();
    const started = await startLink(user.id, "retro", "Atrasado", T0);
    if (!started.ok) throw new Error("unreachable");
    profile("Atrasado", "ulid-atrasado", started.code);
    await expect(confirmLink(user.id, "retro", later(30 * 60_000))).resolves.toEqual({ ok: false, reason: "expired" });
    expect(profiles.calls).toBe(0);
    // Never started: also expired (start again).
    await expect(confirmLink(user.id, "psn", T0)).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("refuses unknown handles and private profiles", async () => {
    const { confirmLink, startLink } = await import("./link");
    const ghost = await newUser();
    await startLink(ghost.id, "psn", "Fantasma", T0);
    await expect(confirmLink(ghost.id, "psn", later(1000))).resolves.toEqual({ ok: false, reason: "not_found" });

    const closed = await newUser();
    const started = await startLink(closed.id, "psn", "Fechado", T0);
    if (!started.ok) throw new Error("unreachable");
    profile("Fechado", "acc-fechado", started.code, true);
    await expect(confirmLink(closed.id, "psn", later(1000))).resolves.toEqual({ ok: false, reason: "private" });
  });

  it("refuses an account already linked to another user", async () => {
    const { confirmLink, startLink } = await import("./link");
    const owner = await newUser();
    const first = await startLink(owner.id, "xbox", "Disputado", T0);
    if (!first.ok) throw new Error("unreachable");
    profile("Disputado", "xuid-disputado", first.code);
    await expect(confirmLink(owner.id, "xbox", later(1000))).resolves.toMatchObject({ ok: true });

    // The owner even leaves the other user's code in the bio: still refused.
    const intruder = await newUser();
    const second = await startLink(intruder.id, "xbox", "Disputado", T0);
    if (!second.ok) throw new Error("unreachable");
    profile("Disputado", "xuid-disputado", `${first.code} ${second.code}`);
    await expect(confirmLink(intruder.id, "xbox", later(2000))).resolves.toEqual({ ok: false, reason: "taken" });
  });

  it("a pending link reserves nothing: another user can still link the account", async () => {
    const { prisma } = await import("@/lib/db");
    const { confirmLink, startLink } = await import("./link");
    const squatter = await newUser();
    const squat = await startLink(squatter.id, "psn", "Vitima", T0);
    expect(squat.ok).toBe(true);

    const realOwner = await newUser();
    const own = await startLink(realOwner.id, "psn", "Vitima", T0);
    if (!own.ok) throw new Error("unreachable");
    profile("Vitima", "acc-vitima", own.code);
    await expect(confirmLink(realOwner.id, "psn", later(1000))).resolves.toMatchObject({ ok: true });

    // The squatter can never confirm: the profile shows another code, and the account is taken.
    await expect(confirmLink(squatter.id, "psn", later(2000))).resolves.toEqual({ ok: false, reason: "code_missing" });
    const pending = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: squatter.id, platform: "psn" } },
    });
    expect(pending.externalId.startsWith(`pending:${squatter.id}`)).toBe(true);
    expect(pending.verifiedAt).toBeNull();
  });

  it("throttles confirmations to one per 30 s, and restarting the link does not reset it", async () => {
    const { confirmLink, startLink } = await import("./link");
    const user = await newUser();
    await startLink(user.id, "retro", "Apressado", T0);
    await expect(confirmLink(user.id, "retro", later(1000))).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(confirmLink(user.id, "retro", later(5000))).resolves.toEqual({
      ok: false,
      reason: "too_soon",
      retryAfterSec: 26,
    });
    // Alternating start/confirm cannot bypass the cooldown.
    await startLink(user.id, "retro", "Apressado", later(6000));
    await expect(confirmLink(user.id, "retro", later(7000))).resolves.toMatchObject({ reason: "too_soon" });
    expect(profiles.calls).toBe(1);
    await expect(confirmLink(user.id, "retro", later(31_000))).resolves.toEqual({ ok: false, reason: "not_found" });
    expect(profiles.calls).toBe(2);
  });

  it("allows at most 5 link starts per hour per user, over all platforms", async () => {
    const { startLink } = await import("./link");
    const user = await newUser();
    const platforms = ["psn", "xbox", "retro", "psn", "xbox"] as const;
    for (const [i, platform] of platforms.entries()) {
      await expect(startLink(user.id, platform, "Varios", later(i * 60_000))).resolves.toMatchObject({ ok: true });
    }
    // 6th start, 10 minutes after the first: wait until the first leaves the 1-hour window.
    await expect(startLink(user.id, "retro", "Varios", later(10 * 60_000))).resolves.toEqual({
      ok: false,
      reason: "too_soon",
      retryAfterSec: 50 * 60,
    });
    await expect(startLink(user.id, "retro", "Varios", later(60 * 60_000 + 1000))).resolves.toMatchObject({ ok: true });
  });

  it("an expired code is shown as expired; cancelling a pending link hides it and kills the code", async () => {
    const { cancelPendingLink, confirmLink, startLink } = await import("./link");
    const { getLinkedAccounts } = await import("./queries");
    const { connectionState } = await import("./connection-state");
    const user = await newUser();
    const started = await startLink(user.id, "psn", "Tralked-Teste", T0);
    expect(started.ok).toBe(true);

    const [pending] = await getLinkedAccounts(user.id, later(60_000));
    expect(connectionState(pending, later(60_000))).toMatchObject({ kind: "pending", handle: "Tralked-Teste" });
    const [expired] = await getLinkedAccounts(user.id, later(31 * 60_000));
    expect(connectionState(expired, later(31 * 60_000))).toEqual({ kind: "disconnected", expiredHandle: "Tralked-Teste" });

    await expect(cancelPendingLink(user.id, "psn")).resolves.toBe(true);
    await expect(getLinkedAccounts(user.id, later(60_000))).resolves.toEqual([]);
    await expect(confirmLink(user.id, "psn", later(60_000))).resolves.toEqual({ ok: false, reason: "expired" });
    await expect(cancelPendingLink(user.id, "psn")).resolves.toBe(false);
  });

  it("rejects malformed handles before anything else", async () => {
    const { startLink } = await import("./link");
    const user = await newUser();
    await expect(startLink(user.id, "psn", "<script>", T0)).resolves.toEqual({ ok: false, reason: "invalid_handle" });
    await expect(startLink(user.id, "retro", "", T0)).resolves.toEqual({ ok: false, reason: "invalid_handle" });
  });

  it("unlink voids the platform's ledger entries (never deletes) and frees the account", async () => {
    const { prisma } = await import("@/lib/db");
    const { unlink } = await import("./link");
    const { getLinkedAccounts } = await import("./queries");
    const user = await newUser();
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "xbox", externalId: "xuid-unlink", handle: "Sai", verifiedAt: T0 },
    });
    await prisma.xpLedgerEntry.createMany({
      data: [
        { userId: user.id, source: "achievement", sourceKey: "a1", xp: 1000, skills: [], platform: "xbox" },
        { userId: user.id, source: "achievement", sourceKey: "a2", xp: 500, skills: [], platform: "xbox", voidedAt: T0 },
        { userId: user.id, source: "mission", sourceKey: "m1", xp: 300, skills: [] },
      ],
    });

    await expect(unlink(user.id, "xbox", later(1000))).resolves.toBe(true);
    const entries = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id }, orderBy: { sourceKey: "asc" } });
    expect(entries.map((e) => [e.sourceKey, e.voidedAt !== null])).toEqual([
      ["a1", true],
      ["a2", true],
      ["m1", false],
    ]);
    expect(entries[1].voidedAt).toEqual(T0); // an earlier void keeps its time
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.totalXp).toBe(300);
    // The platform id is free again; the row only remains (unverified) for rate limiting.
    expect(await prisma.linkedAccount.count({ where: { platform: "xbox", externalId: "xuid-unlink" } })).toBe(0);
    await expect(getLinkedAccounts(user.id)).resolves.toEqual([]);
    await expect(unlink(user.id, "xbox")).resolves.toBe(false);
  });
});
