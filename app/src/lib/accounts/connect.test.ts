import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformProfile } from "./profiles";

// The platform profiles as the service account would read them (no network in tests).
const profiles = vi.hoisted(() => ({ byHandle: new Map<string, PlatformProfile>(), calls: 0 }));
vi.mock("./profiles", () => ({
  lookupProfile: async (_platform: string, handle: string) => {
    profiles.calls++;
    return profiles.byHandle.get(handle.toLowerCase()) ?? null;
  },
}));

const { prisma } = await import("@/lib/db");
const { saveConnection, resetConnectionLimits, SAVE_LOOKUPS_PER_WINDOW } = await import("./connect");

const MARK = "tconnect_";
const T0 = new Date("2026-10-31T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const STEAM_ID = "76561198000088001";
const LEGACY_STEAM_ID = "76561198000088002";

function profile(handle: string, externalId: string, isPrivate = false) {
  profiles.byHandle.set(handle.toLowerCase(), { externalId, handle, text: "", isPrivate });
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
}

let n = 0;
const newUser = (data: { steamId?: string; passwordHash?: string | null } = {}) =>
  prisma.user.create({
    data: {
      handle: `${MARK}${++n}`,
      displayName: `Teste ${n}`,
      steamId: data.steamId,
      passwordHash: "passwordHash" in data ? data.passwordHash : "scrypt$fake",
    },
  });

const row = (userId: string, platform: string) =>
  prisma.linkedAccount.findUnique({ where: { userId_platform: { userId, platform } } });

beforeEach(async () => {
  profiles.byHandle.clear();
  profiles.calls = 0;
  resetConnectionLimits();
  await cleanup();
});
afterAll(cleanup);

describe("saveConnection: typing the profile links it at once (Exophase model)", () => {
  it("links an account instantly as an active, unverified connection; saving it again changes nothing", async () => {
    profile("Dono-Real", "acc-dono-real");
    const user = await newUser();

    expect(await saveConnection(user.id, "psn", " Dono-Real ", { now: T0 })).toEqual({
      status: "linked",
      handle: "Dono-Real",
      value: "Dono-Real",
    });
    expect(await row(user.id, "psn")).toMatchObject({
      externalId: "acc-dono-real",
      handle: "Dono-Real",
      linkedAt: T0,
      verifiedAt: null,
      verifyCode: null,
    });

    // Same account (any case): nothing to do, not even a lookup.
    expect(await saveConnection(user.id, "psn", "dono-real", { now: later(1000) })).toEqual({ status: "unchanged" });
    expect(profiles.calls).toBe(1);
  });

  it("the same account under a new name keeps the connection (and its verification), storing the new name", async () => {
    profile("Nome-Antigo", "acc-renomeada");
    const user = await newUser();
    expect((await saveConnection(user.id, "psn", "Nome-Antigo", { now: T0 })).status).toBe("linked");
    await prisma.linkedAccount.update({
      where: { userId_platform: { userId: user.id, platform: "psn" } },
      data: { verifiedAt: later(500) },
    });

    profile("Nome-Novo", "acc-renomeada");
    expect(await saveConnection(user.id, "psn", "Nome-Novo", { now: later(1000) })).toEqual({
      status: "renamed",
      handle: "Nome-Novo",
      value: "Nome-Novo",
    });
    expect(await row(user.id, "psn")).toMatchObject({
      externalId: "acc-renomeada",
      handle: "Nome-Novo",
      linkedAt: T0,
      verifiedAt: later(500),
    });
  });

  it("Steam: a profile link fills User.steamId, and the field shows the SteamID64", async () => {
    profile("novo-perfil", STEAM_ID);
    const user = await newUser();
    expect(await saveConnection(user.id, "steam", "https://steamcommunity.com/id/novo-perfil/", { now: T0 })).toEqual({
      status: "linked",
      handle: "novo-perfil",
      value: STEAM_ID,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).steamId).toBe(STEAM_ID);
    expect(await row(user.id, "steam")).toMatchObject({ externalId: STEAM_ID, linkedAt: T0, verifiedAt: null });
    expect(await saveConnection(user.id, "steam", STEAM_ID, { now: later(1000) })).toEqual({ status: "unchanged" });
  });

  it("refuses an account already connected to another profile, and the other profile keeps it", async () => {
    profile("Disputado", "xuid-disputado");
    const owner = await newUser();
    expect((await saveConnection(owner.id, "xbox", "Disputado", { now: T0 })).status).toBe("linked");

    const other = await newUser();
    expect(await saveConnection(other.id, "xbox", "Disputado", { now: later(1000) })).toEqual({ status: "taken" });
    expect(await row(other.id, "xbox")).toBeNull();
    expect(await row(owner.id, "xbox")).toMatchObject({ externalId: "xuid-disputado", linkedAt: T0 });
  });

  it("a Steam of an old Steam-login account is refused when typed: its history is only recovered by a claim", async () => {
    profile("veterano", LEGACY_STEAM_ID);
    // Old account: steamId, no credentials, no LinkedAccount row.
    const legacy = await newUser({ steamId: LEGACY_STEAM_ID, passwordHash: null });
    const fresh = await newUser();
    expect(await saveConnection(fresh.id, "steam", "veterano", { now: T0 })).toEqual({ status: "taken" });
    // Nothing moved: the old account keeps its Steam and stays without credentials.
    expect(await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({
      steamId: LEGACY_STEAM_ID,
      passwordHash: null,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fresh.id } })).steamId).toBeNull();
  });

  it("refuses malformed handles before any lookup, unknown profiles and private profiles", async () => {
    const user = await newUser();
    expect(await saveConnection(user.id, "psn", "<script>", { now: T0 })).toEqual({ status: "invalid" });
    expect(await saveConnection(user.id, "steam", "https://evil.example.com/profiles/1", { now: T0 })).toEqual({
      status: "invalid",
    });
    expect(profiles.calls).toBe(0);

    expect(await saveConnection(user.id, "retro", "Fantasma", { now: T0 })).toEqual({ status: "not_found" });
    profile("perfil-fechado", "76561198000088003", true);
    expect(await saveConnection(user.id, "steam", "perfil-fechado", { now: T0 })).toEqual({ status: "private" });
    expect(await row(user.id, "steam")).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).steamId).toBeNull();
  });

  it("clearing a field only disconnects after an explicit confirmation, voiding the XP from that account", async () => {
    profile("Sai-Daqui", "acc-sai");
    const user = await newUser();
    await saveConnection(user.id, "psn", "Sai-Daqui", { now: T0 });
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "achievement", sourceKey: "psn-a1", xp: 1000, skills: [], platform: "psn" },
    });

    expect(await saveConnection(user.id, "psn", "  ", { now: later(1000) })).toEqual({
      status: "needs_confirm",
      action: "unlink",
    });
    expect(await row(user.id, "psn")).toMatchObject({ linkedAt: T0 });

    expect(await saveConnection(user.id, "psn", "", { now: later(2000), confirmed: true })).toEqual({ status: "unlinked" });
    const after = await row(user.id, "psn");
    expect(after).toMatchObject({ linkedAt: null, verifiedAt: null });
    expect(after?.externalId.startsWith("pending:")).toBe(true);
    const entry = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId: user.id, sourceKey: "psn-a1" } });
    expect(entry.voidedAt).toEqual(later(2000));
    // The account is free again.
    const other = await newUser();
    expect((await saveConnection(other.id, "psn", "Sai-Daqui", { now: later(3000) })).status).toBe("linked");
    // An empty field with nothing connected is just unchanged.
    expect(await saveConnection(user.id, "psn", "", { now: later(4000), confirmed: true })).toEqual({ status: "unchanged" });
  });

  it("replacing a connected account by another also needs the confirmation (the old account's XP is voided)", async () => {
    profile("Primeira", "acc-primeira");
    profile("Segunda", "acc-segunda");
    const user = await newUser();
    await saveConnection(user.id, "psn", "Primeira", { now: T0 });
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "achievement", sourceKey: "psn-old", xp: 500, skills: [], platform: "psn" },
    });

    expect(await saveConnection(user.id, "psn", "Segunda", { now: later(1000) })).toEqual({
      status: "needs_confirm",
      action: "replace",
    });
    expect(await row(user.id, "psn")).toMatchObject({ externalId: "acc-primeira" });

    expect(await saveConnection(user.id, "psn", "Segunda", { now: later(2000), confirmed: true })).toMatchObject({
      status: "linked",
      handle: "Segunda",
    });
    expect(await row(user.id, "psn")).toMatchObject({ externalId: "acc-segunda", linkedAt: later(2000) });
    const old = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId: user.id, sourceKey: "psn-old" } });
    expect(old.voidedAt).toEqual(later(2000));
  });

  it("a replacement refused because the new account is taken keeps the current one", async () => {
    profile("Minha", "acc-minha");
    profile("Alheia", "acc-alheia");
    const owner = await newUser();
    await saveConnection(owner.id, "retro", "Alheia", { now: T0 });
    const user = await newUser();
    await saveConnection(user.id, "retro", "Minha", { now: T0 });
    expect(await saveConnection(user.id, "retro", "Alheia", { now: later(1000), confirmed: true })).toEqual({
      status: "taken",
    });
    expect(await row(user.id, "retro")).toMatchObject({ externalId: "acc-minha", linkedAt: T0 });
  });

  it("limits the profile lookups of a user", async () => {
    const user = await newUser();
    for (let i = 0; i < SAVE_LOOKUPS_PER_WINDOW; i++) {
      expect(await saveConnection(user.id, "retro", `Ninguem${i}`, { now: T0 })).toEqual({ status: "not_found" });
    }
    expect(await saveConnection(user.id, "retro", "MaisUm", { now: T0 })).toMatchObject({ status: "too_soon" });
    expect(profiles.calls).toBe(SAVE_LOOKUPS_PER_WINDOW);
  });

  it("a platform without a credential in production is unavailable (no lookup, nothing linked)", async () => {
    profile("Dono-Real", "acc-dono-real");
    const user = await newUser();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_FIXTURES", "");
    try {
      expect(await saveConnection(user.id, "psn", "Dono-Real", { now: T0 })).toEqual({ status: "unavailable" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(profiles.calls).toBe(0);
    expect(await row(user.id, "psn")).toBeNull();
  });

  it("an unverified Steam link syncs and pays XP like a verified one", async () => {
    const { syncUser } = await import("@/lib/sync/user");
    // The offline Steam fixture's library (vitest runs with STEAM_MODE=fixture).
    profile("tralked-teste", "76561198000000042");
    const user = await newUser();
    expect((await saveConnection(user.id, "steam", "tralked-teste", { now: T0 })).status).toBe("linked");
    const result = await syncUser(user.id);
    expect(result.status).toBe("ok");
    expect(result.newUnlocks).toBeGreaterThan(0);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: null } })).toBeGreaterThan(0);
  });
});

describe("Steam XP from a real sync (entries without a platform) leaves with the account", () => {
  const TESTE = "76561198000000042"; // offline fixture profiles: same library for any SteamID
  const DOIS = "76561198000000044";
  const paidXp = async (userId: string) =>
    (await prisma.xpLedgerEntry.aggregate({ where: { userId, voidedAt: null }, _sum: { xp: true } }))._sum.xp ?? 0;
  const statsXp = async (userId: string) =>
    (await prisma.userStats.findUnique({ where: { userId } }))?.totalXp ?? 0;

  async function linkedAndSynced(steamHandle: string, steamId: string) {
    const { syncUser } = await import("@/lib/sync/user");
    profile(steamHandle, steamId);
    const user = await newUser();
    expect((await saveConnection(user.id, "steam", steamHandle, { now: T0 })).status).toBe("linked");
    expect((await syncUser(user.id)).status).toBe("ok");
    const xp = await paidXp(user.id);
    expect(xp).toBeGreaterThan(0);
    // The Steam sync writes its entries without a platform.
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, platform: "steam" } })).toBe(0);
    expect(await statsXp(user.id)).toBe(xp);
    return { user, xp };
  }

  it("disconnecting voids it (achievements and platinum bonuses)", async () => {
    const { user } = await linkedAndSynced("tralked-teste", TESTE);
    expect(await saveConnection(user.id, "steam", "", { now: later(1000), confirmed: true })).toEqual({ status: "unlinked" });
    expect(await paidXp(user.id)).toBe(0);
    expect(await statsXp(user.id)).toBe(0);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: null } })).toBe(0);
  });

  it("replacing it voids the old account's XP, and syncing again never pays the same unlocks twice", async () => {
    const { syncUser } = await import("@/lib/sync/user");
    const { user, xp } = await linkedAndSynced("tralked-teste", TESTE);
    profile("tralked-dois", DOIS);
    expect((await saveConnection(user.id, "steam", "tralked-dois", { now: later(1000), confirmed: true })).status).toBe("linked");
    expect(await paidXp(user.id)).toBe(0);
    // Link, sync, replace, repeat: never more than one account's worth.
    await syncUser(user.id);
    expect(await paidXp(user.id)).toBeLessThanOrEqual(xp);
    expect(await statsXp(user.id)).toBe(await paidXp(user.id));
  });

  it("a claim takes it from the holder; the claimant is paid once, the holder keeps nothing", async () => {
    const { syncUser } = await import("@/lib/sync/user");
    const { startClaim } = await import("./link");
    const { confirmSteamClaim } = await import("./steam-link");
    const { user: holder, xp } = await linkedAndSynced("tralked-teste", TESTE);

    const claimant = await newUser();
    expect(await saveConnection(claimant.id, "steam", "tralked-teste", { now: T0 })).toEqual({ status: "taken" });
    const started = await startClaim(claimant.id, "steam", "tralked-teste");
    if (!started.ok) throw new Error("unreachable");
    profiles.byHandle.set("tralked-teste", { externalId: TESTE, handle: "tralked-teste", text: started.code, isPrivate: false });
    expect(await confirmSteamClaim(claimant.id)).toMatchObject({ ok: true, recovered: null });

    expect(await paidXp(holder.id)).toBe(0);
    expect(await statsXp(holder.id)).toBe(0);
    await syncUser(claimant.id);
    expect(await paidXp(claimant.id)).toBe(xp);
    expect((await paidXp(holder.id)) + (await paidXp(claimant.id))).toBe(xp);
  });
});

describe("saveConnection under concurrency", () => {
  it("a replacement whose new account is taken at the last moment rolls back: the current one and its XP stay", async () => {
    profile("Atual", "acc-atual");
    profile("Corrida", "acc-corrida");
    const user = await newUser();
    await saveConnection(user.id, "psn", "Atual", { now: T0 });
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "achievement", sourceKey: "psn-atual", xp: 700, skills: [], platform: "psn" },
    });
    // Another profile links "Corrida" right after this save checked it was free.
    const other = await newUser();
    await prisma.linkedAccount.create({ data: { userId: other.id, platform: "psn", externalId: "acc-corrida", handle: "Corrida" } });
    const original = prisma.linkedAccount.findUnique.bind(prisma.linkedAccount);
    let stale = true;
    const spy = vi.spyOn(prisma.linkedAccount, "findUnique").mockImplementation(((args: Parameters<typeof original>[0]) => {
      if (stale && "platform_externalId" in args.where && args.where.platform_externalId) {
        stale = false;
        return Promise.resolve(null);
      }
      return original(args);
    }) as unknown as typeof prisma.linkedAccount.findUnique);
    try {
      expect(await saveConnection(user.id, "psn", "Corrida", { now: later(1000), confirmed: true })).toEqual({ status: "taken" });
    } finally {
      spy.mockRestore();
    }
    expect(await row(user.id, "psn")).toMatchObject({ externalId: "acc-atual", linkedAt: T0 });
    const entry = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId: user.id, sourceKey: "psn-atual" } });
    expect(entry.voidedAt).toBeNull();
  });

  it("two saves of the same field at once: one links, the other is never reported as 'taken'", async () => {
    profile("Duplo", "acc-duplo");
    const user = await newUser();
    const results = await Promise.all([
      saveConnection(user.id, "retro", "Duplo", { now: T0 }),
      saveConnection(user.id, "retro", "Duplo", { now: T0 }),
    ]);
    expect(results.map((r) => r.status)).toContain("linked");
    expect(results.map((r) => r.status)).not.toContain("taken");
    expect(await row(user.id, "retro")).toMatchObject({ externalId: "acc-duplo" });
  });
});