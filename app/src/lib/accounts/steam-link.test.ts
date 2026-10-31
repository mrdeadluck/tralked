import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SteamPublicProfile } from "@/lib/integrations/steam/profile-lookup";

// Steam's public profiles as the connection check reads them (no network in tests).
const steam = vi.hoisted(() => ({ profiles: new Map<string, SteamPublicProfile>() }));
vi.mock("@/lib/integrations/steam/profile-lookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/steam/profile-lookup")>();
  return {
    ...actual,
    getSteamProfileLookup: () => ({
      find: async (ref: { kind: "id"; steamId: string } | { kind: "vanity"; vanity: string }) =>
        steam.profiles.get(ref.kind === "id" ? ref.steamId : ref.vanity.toLowerCase()) ?? null,
    }),
  };
});

const { prisma } = await import("@/lib/db");
const { startClaim, unlink } = await import("./link");
const { confirmSteamClaim } = await import("./steam-link");

const MARK = "tsteam_";
const T0 = new Date("2026-10-31T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const STEAM_NEW = "76561198000099001";
const STEAM_OLD = "76561198000099002";
const CODE = "TRK-AB3CD9";

function profile(steamId: string, vanity: string, summary: string, profilePublic = true) {
  const p = { steamId, personaName: `Persona ${vanity}`, summary, profilePublic };
  steam.profiles.set(steamId, p);
  steam.profiles.set(vanity.toLowerCase(), p);
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
}
beforeEach(async () => {
  steam.profiles.clear();
  await cleanup();
});
afterAll(cleanup);

let n = 0;
const newAccount = (data: { passwordHash?: string | null; googleSub?: string; steamId?: string; email?: string } = {}) =>
  prisma.user.create({
    data: {
      handle: `${MARK}${++n}`,
      displayName: `Teste ${n}`,
      email: data.email ?? `${MARK}${n}@steam.test`,
      passwordHash: "passwordHash" in data ? data.passwordHash : "scrypt$fake",
      googleSub: data.googleSub,
      steamId: data.steamId,
    },
  });

/** Starts the claim and simulates the user pasting the code in the profile "Resumo". */
async function startWithCode(userId: string, input: string) {
  const started = await startClaim(userId, "steam", input, T0);
  expect(started.ok).toBe(true);
  await prisma.linkedAccount.update({
    where: { userId_platform: { userId, platform: "steam" } },
    data: { verifyCode: CODE },
  });
}

describe("confirmSteamClaim (database)", () => {
  it("links the Steam whose Resumo shows the code: User.steamId + verified LinkedAccount", async () => {
    profile(STEAM_NEW, "novo-perfil", `Oi! ${CODE.toLowerCase()}`);
    const user = await newAccount();
    await startWithCode(user.id, "https://steamcommunity.com/id/novo-perfil/");

    expect(await confirmSteamClaim(user.id, later(1000))).toEqual({ ok: true, handle: "Persona novo-perfil", recovered: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).steamId).toBe(STEAM_NEW);
    expect(
      await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: user.id, platform: "steam" } } }),
    ).toMatchObject({ externalId: STEAM_NEW, handle: "Persona novo-perfil", verifyCode: null, verifiedAt: later(1000) });
  });

  it("refuses a missing code, an expired code and a private profile", async () => {
    profile(STEAM_NEW, "novo-perfil", "sem código aqui");
    const user = await newAccount();
    await startWithCode(user.id, STEAM_NEW);
    expect(await confirmSteamClaim(user.id, later(1000))).toEqual({ ok: false, reason: "code_missing" });

    await prisma.linkedAccount.update({
      where: { userId_platform: { userId: user.id, platform: "steam" } },
      data: { verifyExpiresAt: later(-1) },
    });
    expect(await confirmSteamClaim(user.id, later(60_000))).toEqual({ ok: false, reason: "expired" });

    profile(STEAM_OLD, "fechado", "", false);
    const other = await newAccount();
    await startWithCode(other.id, "fechado");
    expect(await confirmSteamClaim(other.id, later(1000))).toEqual({ ok: false, reason: "private" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).steamId).toBeNull();
  });

  it("a proven claim takes a Steam from an account with credentials: steamId moves, its Steam XP is voided, it is notified", async () => {
    profile(STEAM_OLD, "dono", CODE);
    const owner = await newAccount({ steamId: STEAM_OLD }); // e-mail + password
    await prisma.linkedAccount.create({
      data: { userId: owner.id, platform: "steam", externalId: STEAM_OLD, handle: "Dono", verifiedAt: T0, linkedAt: T0 },
    });
    await prisma.xpLedgerEntry.create({
      data: { userId: owner.id, source: "achievement", sourceKey: "s1", xp: 100, skills: [], platform: "steam" },
    });

    const user = await newAccount();
    await startWithCode(user.id, "dono");
    expect(await confirmSteamClaim(user.id, later(1000))).toEqual({ ok: true, handle: "Persona dono", recovered: null });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).steamId).toBe(STEAM_OLD);
    expect(
      await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: user.id, platform: "steam" } } }),
    ).toMatchObject({ externalId: STEAM_OLD, verifiedAt: later(1000), linkedAt: later(1000) });
    // The previous owner keeps its account (it has credentials), without this Steam.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).steamId).toBeNull();
    expect(
      await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: owner.id, platform: "steam" } } }),
    ).toMatchObject({ linkedAt: null, verifiedAt: null });
    const entry = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId: owner.id, sourceKey: "s1" } });
    expect(entry.voidedAt).toEqual(later(1000));
    expect(await prisma.notification.count({ where: { userId: owner.id, title: "Sua conexão Steam foi reivindicada" } })).toBe(1);
  });

  it("a Google-only account loses its Steam to a proven claim too (no recovery: it has credentials)", async () => {
    profile(STEAM_NEW, "google", CODE);
    const google = await newAccount({ passwordHash: null, googleSub: `${MARK}g`, steamId: STEAM_NEW });
    await prisma.linkedAccount.create({
      data: { userId: google.id, platform: "steam", externalId: STEAM_NEW, handle: "G", verifiedAt: T0 },
    });
    const user = await newAccount();
    await startWithCode(user.id, STEAM_NEW);
    expect(await confirmSteamClaim(user.id, later(1000))).toMatchObject({ ok: true, recovered: null });
    expect(await prisma.user.findUnique({ where: { id: google.id } })).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: google.id } })).steamId).toBeNull();
  });

  it("recovers an account of the old Steam login: credentials move to it, the new account goes away", async () => {
    profile(STEAM_OLD, "veterano", CODE);
    const legacy = await prisma.user.create({
      data: { handle: `${MARK}veterano`, displayName: "Veterano", role: "editor", steamId: STEAM_OLD },
    });
    await prisma.linkedAccount.create({
      data: { userId: legacy.id, platform: "steam", externalId: STEAM_OLD, handle: "Veterano", verifiedAt: T0 },
    });
    await prisma.xpLedgerEntry.create({ data: { userId: legacy.id, source: "seed", sourceKey: "x", xp: 500, skills: [] } });

    const fresh = await newAccount({ email: `${MARK}novo@steam.test`, passwordHash: "scrypt$novo" });
    await startWithCode(fresh.id, "veterano");

    expect(await confirmSteamClaim(fresh.id, later(1000))).toEqual({
      ok: true,
      handle: "Persona veterano",
      recovered: { userId: legacy.id, handle: `${MARK}veterano` },
    });
    expect(await prisma.user.findUnique({ where: { id: fresh.id } })).toBeNull();
    const recovered = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(recovered).toMatchObject({
      email: `${MARK}novo@steam.test`,
      passwordHash: "scrypt$novo",
      role: "editor",
      steamId: STEAM_OLD,
      handle: `${MARK}veterano`,
    });
    expect(await prisma.xpLedgerEntry.count({ where: { userId: legacy.id } })).toBe(1);
  });

  it("verifies the Steam row of a recovered account that was imported unverified", async () => {
    profile(STEAM_OLD, "importado", CODE);
    const legacy = await prisma.user.create({ data: { handle: `${MARK}importado`, displayName: "Importado", steamId: STEAM_OLD } });
    await prisma.linkedAccount.create({
      data: { userId: legacy.id, platform: "steam", externalId: STEAM_OLD, handle: "Importado" },
    });
    const fresh = await newAccount();
    await startWithCode(fresh.id, STEAM_OLD);
    expect(await confirmSteamClaim(fresh.id, later(1000))).toMatchObject({ ok: true, recovered: { userId: legacy.id } });
    expect(
      await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: legacy.id, platform: "steam" } } }),
    ).toMatchObject({ externalId: STEAM_OLD, verifiedAt: later(1000) });
  });

  it("does not merge into the old account when the new one already has activity", async () => {
    profile(STEAM_OLD, "veterano", CODE);
    const legacy = await prisma.user.create({ data: { handle: `${MARK}veterano2`, displayName: "Veterano", steamId: STEAM_OLD } });
    const busy = await newAccount();
    await prisma.xpLedgerEntry.create({ data: { userId: busy.id, source: "mission", sourceKey: "m1", xp: 10, skills: [] } });
    await startWithCode(busy.id, "veterano");
    expect(await confirmSteamClaim(busy.id, later(1000))).toEqual({ ok: false, reason: "has_activity" });
    expect(await prisma.user.findUnique({ where: { id: busy.id } })).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })).passwordHash).toBeNull();
  });
});

describe("unlink Steam (database)", () => {
  it("clears User.steamId and voids the Steam XP (never deleting the ledger)", async () => {
    profile(STEAM_NEW, "novo-perfil", CODE);
    const user = await newAccount();
    await startWithCode(user.id, "novo-perfil");
    expect((await confirmSteamClaim(user.id, later(1000))).ok).toBe(true);
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "achievement", sourceKey: "a1", xp: 100, skills: [], platform: "steam" },
    });

    expect(await unlink(user.id, "steam", later(2000))).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).steamId).toBeNull();
    const entry = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId: user.id, sourceKey: "a1" } });
    expect(entry.voidedAt).toEqual(later(2000));
    // The Steam account is free again: someone else who proves it can link it.
    const other = await newAccount();
    await startWithCode(other.id, "novo-perfil");
    expect((await confirmSteamClaim(other.id, later(60_000))).ok).toBe(true);
  });
});
