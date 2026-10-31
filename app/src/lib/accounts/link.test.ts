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

describe.skipIf(!reachable)("account claims and unlinking", () => {
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

  it("a claim with the code in the profile links the account, verified", async () => {
    const { prisma } = await import("@/lib/db");
    const { confirmClaim, startClaim } = await import("./link");
    const user = await newUser();
    const started = await startClaim(user.id, "psn", " Dono-Real ", T0);
    expect(started).toMatchObject({ ok: true, expiresAt: later(30 * 60_000) });
    if (!started.ok) throw new Error("unreachable");
    expect(started.code).toMatch(/^TRK-[A-Z0-9]{6}$/);
    // A pending claim is not an active link.
    expect(await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: user.id, platform: "psn" } } }))
      .toMatchObject({ linkedAt: null, verifiedAt: null });

    profile("Dono-Real", "acc-dono-real", `Oi! ${started.code}`);
    await expect(confirmClaim(user.id, "psn", later(60_000))).resolves.toEqual({
      ok: true,
      handle: "Dono-Real",
      externalId: "acc-dono-real",
      previousHolderId: null,
    });
    const account = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: user.id, platform: "psn" } },
    });
    expect(account).toMatchObject({ externalId: "acc-dono-real", verifyCode: null, verifyExpiresAt: null });
    expect(account.verifiedAt).toEqual(later(60_000));
    expect(account.linkedAt).toEqual(later(60_000));

    // A connected account must be disconnected before claiming another.
    await expect(startClaim(user.id, "psn", "Outra-Conta", T0)).resolves.toEqual({
      ok: false,
      reason: "already_linked",
    });
  });

  it("an account typed in (active, unverified) also blocks starting a claim on that platform", async () => {
    const { prisma } = await import("@/lib/db");
    const { startClaim } = await import("./link");
    const user = await newUser();
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "retro", externalId: "ulid-digitado", handle: "Digitado" },
    });
    await expect(startClaim(user.id, "retro", "Outro", T0)).resolves.toEqual({ ok: false, reason: "already_linked" });
  });

  it("a claim refuses a platform without a credential in production (never its fixture)", async () => {
    const { startClaim } = await import("./link");
    const user = await newUser();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_FIXTURES", "");
    try {
      await expect(startClaim(user.id, "xbox", "Alguem", T0)).resolves.toEqual({ ok: false, reason: "unavailable" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses when the code is not in the profile (someone else's account)", async () => {
    const { confirmClaim, startClaim } = await import("./link");
    const user = await newUser();
    await startClaim(user.id, "xbox", "Alguem", T0);
    profile("Alguem", "xuid-alguem", "bio sem código");
    await expect(confirmClaim(user.id, "xbox", later(1000))).resolves.toEqual({ ok: false, reason: "code_missing" });
  });

  it("refuses an expired code without reading the platform", async () => {
    const { confirmClaim, startClaim } = await import("./link");
    const user = await newUser();
    const started = await startClaim(user.id, "retro", "Atrasado", T0);
    if (!started.ok) throw new Error("unreachable");
    profile("Atrasado", "ulid-atrasado", started.code);
    await expect(confirmClaim(user.id, "retro", later(30 * 60_000))).resolves.toEqual({ ok: false, reason: "expired" });
    expect(profiles.calls).toBe(0);
    // Never started: also expired (start again).
    await expect(confirmClaim(user.id, "psn", T0)).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("refuses unknown handles and private profiles", async () => {
    const { confirmClaim, startClaim } = await import("./link");
    const ghost = await newUser();
    await startClaim(ghost.id, "psn", "Fantasma", T0);
    await expect(confirmClaim(ghost.id, "psn", later(1000))).resolves.toEqual({ ok: false, reason: "not_found" });

    const closed = await newUser();
    const started = await startClaim(closed.id, "psn", "Fechado", T0);
    if (!started.ok) throw new Error("unreachable");
    profile("Fechado", "acc-fechado", started.code, true);
    await expect(confirmClaim(closed.id, "psn", later(1000))).resolves.toEqual({ ok: false, reason: "private" });
  });

  it("a proven claim moves the account: the previous profile loses it, its XP from it is voided and it is notified", async () => {
    const { prisma } = await import("@/lib/db");
    const { confirmClaim, startClaim } = await import("./link");
    const { recomputeUser } = await import("@/lib/progression/recompute");
    // The previous profile typed the gamertag in (active, unverified) and was paid for it.
    const holder = await newUser();
    await prisma.linkedAccount.create({
      data: { userId: holder.id, platform: "xbox", externalId: "xuid-disputado", handle: "Disputado", linkedAt: T0 },
    });
    await prisma.xpLedgerEntry.createMany({
      data: [
        { userId: holder.id, source: "achievement", sourceKey: "xbox-a1", xp: 1000, skills: [], platform: "xbox" },
        { userId: holder.id, source: "mission", sourceKey: "m1", xp: 300, skills: [] },
      ],
    });
    await recomputeUser(holder.id, T0);
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId: holder.id } })).totalXp).toBe(1300);

    const claimant = await newUser();
    const started = await startClaim(claimant.id, "xbox", "Disputado", T0);
    if (!started.ok) throw new Error("unreachable");
    // Without the code in the bio nothing moves.
    profile("Disputado", "xuid-disputado", "bio sem código");
    await expect(confirmClaim(claimant.id, "xbox", later(1000))).resolves.toEqual({ ok: false, reason: "code_missing" });
    expect(await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: holder.id, platform: "xbox" } } }))
      .toMatchObject({ externalId: "xuid-disputado" });

    profile("Disputado", "xuid-disputado", `É minha: ${started.code}`);
    await expect(confirmClaim(claimant.id, "xbox", later(60_000))).resolves.toEqual({
      ok: true,
      handle: "Disputado",
      externalId: "xuid-disputado",
      previousHolderId: holder.id,
    });

    expect(await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: claimant.id, platform: "xbox" } } }))
      .toMatchObject({ externalId: "xuid-disputado", linkedAt: later(60_000), verifiedAt: later(60_000), verifyCode: null });
    const previous = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: holder.id, platform: "xbox" } },
    });
    expect(previous).toMatchObject({ linkedAt: null, verifiedAt: null });
    expect(previous.externalId.startsWith("pending:")).toBe(true);
    // Voided through the unlink path (never deleted); the mission XP stays.
    const entries = await prisma.xpLedgerEntry.findMany({ where: { userId: holder.id }, orderBy: { sourceKey: "asc" } });
    expect(entries.map((e) => [e.sourceKey, e.voidedAt])).toEqual([
      ["m1", null],
      ["xbox-a1", later(60_000)],
    ]);
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId: holder.id } })).totalXp).toBe(300);
    const [notice] = await prisma.notification.findMany({ where: { userId: holder.id } });
    expect(notice).toMatchObject({ kind: "system", title: "Sua conexão Xbox foi reivindicada", href: "/conta/conexoes" });
    expect(notice.body).toContain("XP que veio dela foi anulado");
    expect(await prisma.notification.count({ where: { userId: claimant.id } })).toBe(0);
  });

  it("a pending link reserves nothing: another user can still link the account", async () => {
    const { prisma } = await import("@/lib/db");
    const { confirmClaim, startClaim } = await import("./link");
    const squatter = await newUser();
    const squat = await startClaim(squatter.id, "psn", "Vitima", T0);
    expect(squat.ok).toBe(true);

    const realOwner = await newUser();
    const own = await startClaim(realOwner.id, "psn", "Vitima", T0);
    if (!own.ok) throw new Error("unreachable");
    profile("Vitima", "acc-vitima", own.code);
    await expect(confirmClaim(realOwner.id, "psn", later(1000))).resolves.toMatchObject({ ok: true });

    // The squatter can never confirm: the profile shows another code, and the account is taken.
    await expect(confirmClaim(squatter.id, "psn", later(2000))).resolves.toEqual({ ok: false, reason: "code_missing" });
    const pending = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: squatter.id, platform: "psn" } },
    });
    expect(pending.externalId.startsWith(`pending:${squatter.id}`)).toBe(true);
    expect(pending.verifiedAt).toBeNull();
  });

  it("throttles confirmations to one per 30 s, and restarting the link does not reset it", async () => {
    const { confirmClaim, startClaim } = await import("./link");
    const user = await newUser();
    await startClaim(user.id, "retro", "Apressado", T0);
    await expect(confirmClaim(user.id, "retro", later(1000))).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(confirmClaim(user.id, "retro", later(5000))).resolves.toEqual({
      ok: false,
      reason: "too_soon",
      retryAfterSec: 26,
    });
    // Alternating start/confirm cannot bypass the cooldown.
    await startClaim(user.id, "retro", "Apressado", later(6000));
    await expect(confirmClaim(user.id, "retro", later(7000))).resolves.toMatchObject({ reason: "too_soon" });
    expect(profiles.calls).toBe(1);
    await expect(confirmClaim(user.id, "retro", later(31_000))).resolves.toEqual({ ok: false, reason: "not_found" });
    expect(profiles.calls).toBe(2);
  });

  it("allows at most 5 link starts per hour per user, over all platforms", async () => {
    const { startClaim } = await import("./link");
    const user = await newUser();
    const platforms = ["psn", "xbox", "retro", "psn", "xbox"] as const;
    for (const [i, platform] of platforms.entries()) {
      await expect(startClaim(user.id, platform, "Varios", later(i * 60_000))).resolves.toMatchObject({ ok: true });
    }
    // 6th start, 10 minutes after the first: wait until the first leaves the 1-hour window.
    await expect(startClaim(user.id, "retro", "Varios", later(10 * 60_000))).resolves.toEqual({
      ok: false,
      reason: "too_soon",
      retryAfterSec: 50 * 60,
    });
    await expect(startClaim(user.id, "retro", "Varios", later(60 * 60_000 + 1000))).resolves.toMatchObject({ ok: true });
  });

  it("a pending claim shows while its code is valid; cancelling it hides it and kills the code", async () => {
    const { cancelClaim, confirmClaim, startClaim } = await import("./link");
    const { getLinkedAccounts } = await import("./queries");
    const { connectionState } = await import("./connection-state");
    const user = await newUser();
    const started = await startClaim(user.id, "psn", "Tralked-Teste", T0);
    expect(started.ok).toBe(true);

    const [pending] = await getLinkedAccounts(user.id, later(60_000));
    expect(connectionState(pending, later(60_000))).toMatchObject({
      kind: "disconnected",
      claim: { handle: "Tralked-Teste", expiresAt: later(30 * 60_000) },
    });
    // Expired: nothing left to show.
    await expect(getLinkedAccounts(user.id, later(31 * 60_000))).resolves.toEqual([]);

    await expect(cancelClaim(user.id, "psn")).resolves.toBe(true);
    await expect(getLinkedAccounts(user.id, later(60_000))).resolves.toEqual([]);
    await expect(confirmClaim(user.id, "psn", later(60_000))).resolves.toEqual({ ok: false, reason: "expired" });
    await expect(cancelClaim(user.id, "psn")).resolves.toBe(false);
  });

  it("rejects malformed handles before anything else", async () => {
    const { startClaim } = await import("./link");
    const user = await newUser();
    await expect(startClaim(user.id, "psn", "<script>", T0)).resolves.toEqual({ ok: false, reason: "invalid_handle" });
    await expect(startClaim(user.id, "retro", "", T0)).resolves.toEqual({ ok: false, reason: "invalid_handle" });
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
    // The platform id is free again; the row only remains (inactive) for rate limiting.
    expect(await prisma.linkedAccount.count({ where: { platform: "xbox", externalId: "xuid-unlink" } })).toBe(0);
    await expect(getLinkedAccounts(user.id)).resolves.toEqual([]);
    await expect(unlink(user.id, "xbox")).resolves.toBe(false);
  });

  it("unlink also voids the reward of a mission that the platform's unlocks completed", async () => {
    const { prisma } = await import("@/lib/db");
    const { unlink } = await import("./link");
    const { recomputeUser } = await import("@/lib/progression/recompute");
    const user = await newUser();
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "xbox", externalId: "xuid-mission", handle: "Missao", verifiedAt: T0 },
    });
    const game = await prisma.game.create({
      data: {
        slug: `${HANDLE_PREFIX}mission-game`,
        name: "Jogo da missão",
        achievementCount: 0,
        platforms: ["XBOX"],
        achievements: {
          create: [0, 1, 2].map((i) => ({ platform: "xbox", apiName: `X${i}`, name: `Rara ${i}`, globalPct: 5 })),
        },
      },
      include: { achievements: true },
    });
    try {
      // Three rare Xbox unlocks today complete the daily "Desbloqueie 3 conquistas raras".
      await prisma.userAchievement.createMany({
        data: game.achievements.map((a, i) => ({ userId: user.id, achievementId: a.id, unlockedAt: later(-(i + 1) * 3_600_000) })),
      });
      await recomputeUser(user.id, T0);
      const rare = await prisma.mission.findFirstOrThrow({
        where: { userId: user.id, kind: "daily", title: "Desbloqueie 3 conquistas raras" },
      });
      expect(rare.completedAt).not.toBeNull();
      const paid = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
      expect(paid.totalXp).toBe(rare.rewardXp);

      await expect(unlink(user.id, "xbox", T0)).resolves.toBe(true);

      const reward = await prisma.xpLedgerEntry.findUniqueOrThrow({
        where: { userId_source_sourceKey: { userId: user.id, source: "mission", sourceKey: rare.id } },
      });
      expect(reward.voidedAt).toEqual(T0);
      expect(await prisma.mission.findUniqueOrThrow({ where: { id: rare.id } })).toMatchObject({
        completedAt: null,
        progress: 0,
      });
      const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
      expect(stats.totalXp).toBe(0);
    } finally {
      await prisma.game.delete({ where: { id: game.id } });
    }
  });
});
